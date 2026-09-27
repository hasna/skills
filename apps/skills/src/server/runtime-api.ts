import type { ApiPrincipal, SkillsProductStore } from "./types.js";
import { ArtifactStorage } from "./artifact-storage.js";
import {
  RuntimeExecutionStore,
  type RuntimeJob,
  type RuntimeResult,
} from "./runtime-store.js";
import {
  createSubmitRunService,
  digestInput,
} from "../sdk/execution/admission.js";
import { createImageProfileRegistry } from "../sdk/execution/image-profile.js";
import {
  EcsDispatcher,
  createAwsEcsClient,
  type EcsRunTaskClient,
} from "../sdk/execution/dispatchers/ecs.js";
import {
  hashBytes,
  readRuntimeConfig,
  runtimeInput,
  runtimeToken,
  verifyRuntimeToken,
  RUNTIME_MAX_ARTIFACT_BYTES,
  RUNTIME_MAX_BUNDLE_BYTES,
  RUNTIME_MAX_LOG_BYTES,
  RUNTIME_TIMEOUT_MS,
  type RuntimeConfig,
} from "./runtime-policy.js";
import { PURE_DESCRIPTOR, PURE_LIMITS, pureInput, uniqueJson,
  inspectPureBundle, validatePureOutput, assertPureAdmission } from "./runtime-pure-contract.js";
import type { FrozenAdmission, PureExecutionContract } from "../sdk/execution/types.js";
import { isTerminalStatus } from "../sdk/execution/types.js";
export interface RuntimeService {
  config: RuntimeConfig;
  signingKey: string;
  store: RuntimeExecutionStore;
  productStore: SkillsProductStore;
  artifacts: ArtifactStorage;
  dispatcher: EcsDispatcher;
  close?: () => Promise<void>;
}
export async function createRuntimeService(options: {
  databaseUrl?: string;
  productStore: SkillsProductStore;
  artifacts?: ArtifactStorage;
  env?: Record<string, string | undefined>;
  executionStore?: RuntimeExecutionStore;
  ecsClient?: EcsRunTaskClient;
}): Promise<RuntimeService | null> {
  const env = options.env ?? process.env,
    config = readRuntimeConfig(env);
  if (!config) return null;
  const signingKey =
    env.HASNA_SKILLS_RUNTIME_SIGNING_KEY ?? env.HASNA_SKILLS_API_SIGNING_KEY;
  if (!signingKey || Buffer.byteLength(signingKey) < 32)
    throw Error("Runtime signing key is missing or too short");
  const store =
    options.executionStore ??
    (await RuntimeExecutionStore.open(options.databaseUrl));
  if (!store.durable && !options.executionStore)
    throw Error("Cloud execution requires durable storage");
  const dispatcher = new EcsDispatcher(
    config,
    options.ecsClient ??
      createAwsEcsClient(config.region, { cluster: config.cluster }),
    {
      store,
      supervisorEnvironment: (admission, attempt) => [
        {
          name: "SKILLS_RUNTIME_API_ORIGIN",
          value: config.apiOrigin.replace(/\/+$/, ""),
        },
        {
          name: "SKILLS_RUNTIME_TOKEN",
          value: runtimeToken(signingKey, admission, attempt),
        },
      ],
    },
  );
  const service: RuntimeService = {
    config,
    signingKey,
    store,
    productStore: options.productStore,
    artifacts: options.artifacts ?? new ArtifactStorage(),
    dispatcher,
  };
  if (!options.executionStore) {
    let reconciling = false;
    const timer = setInterval(async () => {
      if (reconciling) return;
      reconciling = true;
      try {
        await reconcileRuntimeJobs(service);
      } catch {
        /* durable intents remain for the next pass */
      } finally {
        reconciling = false;
      }
    }, 5000);
    timer.unref();
    service.close = async () => {
      clearInterval(timer);
      await store.close();
    };
  }
  return service;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const refusal = (code: string, status: number, error = code) =>
  json({ code, error }, status);
function path(request: Request): string[] {
  return new URL(request.url).pathname
    .replace(/^\/skills\/v1(?=\/|$)/, "/api/v1")
    .replace(/^\/v1(?=\/|$)/, "/api/v1")
    .split("/")
    .filter(Boolean);
}
async function body(request: Request, max: number): Promise<unknown> {
  if (!request.body) throw Error("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const v = await reader.read();
    if (v.done) break;
    size += v.value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("Request body limit exceeded");
    }
    chunks.push(v.value);
  }
  return uniqueJson(Buffer.concat(chunks).toString("utf8"));
}
const scope = (p: ApiPrincipal, action: string) =>
  p.scopes.includes("*") ||
  p.scopes.includes("runs:*") ||
  p.scopes.includes(action) ||
  (action === "runs:read" && p.scopes.includes("skills:read"));
function publicJob(job: RuntimeJob) {
  const a = job.execution.admission;
  return {
    contractVersion: 1,
    id: a.runId,
    target: "cloud",
    skill: a.skillId,
    version: a.skillVersion,
    bundleDigest: a.bundleDigest,
    inputDigest: a.inputDigest,
    runtimeImageDigest: a.runtimeImageDigest,
    executionContract: a.executionContract ?? { id: "pdf.v1" },
    status: job.execution.status,
    createdAt: a.createdAt,
    updatedAt: job.execution.updatedAt,
    attemptId: job.execution.currentAttemptId,
    policy: a.policy,
    limits: a.limits,
    ...(job.result
      ? { exitCode: job.result.exitCode, error: job.result.error }
      : {}),
    artifacts: (job.result?.artifacts ?? []).map(({ base64, ...meta }) => meta),
  };
}
function findReview(service: RuntimeService, tenant: string, slug: string, version: string, sha256: string) {
  return service.config.reviewedBundles.find(b => b.slug === slug && b.version === version && b.sha256 === sha256 &&
    (!b.executionContract || (b.tenantId === tenant && b.imageDigest === service.config.imageDigest)));
}
function sameContract(admission: FrozenAdmission, contract: PureExecutionContract | undefined, image: string): boolean {
  return digestInput(admission.executionContract ?? null) === digestInput(contract ?? null) &&
    (!contract || admission.runtimeImageDigest === image);
}
class RuntimeBundleError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
async function reviewedBytes(service: RuntimeService, principal: ApiPrincipal, digest: string): Promise<Uint8Array> {
  const bundle = await service.productStore.getSkillBundle(principal, digest);
  if (!bundle) throw new RuntimeBundleError("BUNDLE_UNAVAILABLE", 503);
  if (bundle.byteSize > RUNTIME_MAX_BUNDLE_BYTES) throw new RuntimeBundleError("BUNDLE_LIMIT", 413);
  const bytes = await service.artifacts.readBundle(bundle);
  if (!bytes || bytes.length > RUNTIME_MAX_BUNDLE_BYTES || hashBytes(bytes) !== digest)
    throw new RuntimeBundleError("BUNDLE_INTEGRITY_FAILED", 503);
  return bytes;
}
/** Called after normal bearer authentication. Dedicated paths avoid changing /runs. */
export async function handleRuntimeApiRequest(
  request: Request,
  principal: ApiPrincipal,
  service: RuntimeService | null,
): Promise<Response | null> {
  const segments = path(request);
  if (
    segments[0] !== "api" ||
    segments[1] !== "v1" ||
    segments[2] !== "executions"
  )
    return null;
  if (!scope(principal, request.method === "GET" ? "runs:read" : "runs:write"))
    return refusal("SCOPE_REQUIRED", 403);
  if (!service) return refusal("RUNTIME_NOT_CONFIGURED", 503);
  const id = segments[3],
    sub = segments[4];
  if (!id || segments.length > 6 || !/^[a-z0-9_-]+$/.test(id))
    return refusal("INVALID_EXECUTION_PATH", 400);
  try {
    if (request.method === "GET" && sub === "eligibility" && segments.length === 5) {
      const query = new URL(request.url).searchParams;
      const versionName = query.get("version");
      if (!versionName || !/^\d+\.\d+\.\d+$/.test(versionName)) return refusal("REVIEWED_VERSION_REQUIRED", 400);
      const skill = await service.productStore.getSkill(principal, id);
      if (skill?.lifecycle === "archived") return refusal("SKILL_ARCHIVED", 410);
      const version = skill && !skill.tombstonedAt && await service.productStore.getSkillVersion(principal, id, versionName);
      if (!version) return refusal("SKILL_VERSION_NOT_FOUND", 404);
      const pinned = query.get("bundleDigest");
      if (pinned && pinned.replace(/^sha256:/, "") !== version.bundleSha256) return refusal("SELECTION_DIGEST_MISMATCH", 409);
      const review = findReview(service, principal.orgId, id, versionName, version.bundleSha256);
      if (!review) return json({ contractVersion: 1, eligible: false, reason: "BUNDLE_NOT_REVIEWED_FOR_CLOUD",
        skill: id, version: versionName, bundleDigest: version.bundleSha256 });
      if (review.executionContract) {
        const bytes = await reviewedBytes(service, principal, version.bundleSha256);
        await inspectPureBundle(bytes, review.executionContract);
      }
      return json({ contractVersion: 1, eligible: true, skill: id, version: versionName, bundleDigest: version.bundleSha256,
        runtimeImageDigest: service.config.imageDigest, executionContract: review.executionContract ?? { id: "pdf.v1" },
        secrets: "none", egress: "deny", ...(review.executionContract ? { descriptor: PURE_DESCRIPTOR, limits: PURE_LIMITS } : {}) });
    }
    if (request.method === "POST" && !sub) {
      const raw = (await body(request, 150_000)) as Record<string, unknown>;
      if (
        typeof raw.version !== "string" ||
        !/^\d+\.\d+\.\d+$/.test(raw.version)
      )
        return refusal("REVIEWED_VERSION_REQUIRED", 400);
      if (
        Object.keys(raw).some(
          (k) =>
            ![
              "version",
              "input",
              "idempotencyKey",
              "bundleDigest",
              "workspaceId",
            ].includes(k),
        )
      )
        return refusal("UNSUPPORTED_EXECUTION_FIELD", 400);
      if (raw.workspaceId !== undefined && raw.workspaceId !== principal.orgId)
        return refusal("SELECTION_WORKSPACE_MISMATCH", 409);
      const key = request.headers.get("idempotency-key") ?? raw.idempotencyKey;
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
        return refusal("IDEMPOTENCY_KEY_REQUIRED", 400);
      const skill = await service.productStore.getSkill(principal, id);
      if (!skill || skill.tombstonedAt) return refusal("SKILL_NOT_FOUND", 404);
      if (skill.lifecycle === "archived") return refusal("SKILL_ARCHIVED", 410);
      const version = await service.productStore.getSkillVersion(
        principal,
        id,
        raw.version,
      );
      if (!version) return refusal("SKILL_VERSION_NOT_FOUND", 404);
      if (
        raw.bundleDigest !== undefined &&
        (typeof raw.bundleDigest !== "string" ||
          raw.bundleDigest.replace(/^sha256:/, "") !== version.bundleSha256)
      )
        return refusal("SELECTION_DIGEST_MISMATCH", 409);
      const review = findReview(service, principal.orgId, id, raw.version, version.bundleSha256);
      if (!review) return refusal("BUNDLE_NOT_REVIEWED_FOR_CLOUD", 403);
      const contract = review.executionContract;
      // Pure calls pin both the selected workspace and exact content; no ambient selection.
      if (contract && (raw.workspaceId !== principal.orgId || typeof raw.bundleDigest !== "string"))
        return refusal("PURE_SELECTION_REQUIRED", 400);
      const input = contract ? pureInput(raw.input) : runtimeInput(raw.input);
      const existing = await service.store.getRunByKey(principal.orgId, key);
      if (
        existing &&
        (existing.admission.skillId !== id ||
          existing.admission.skillVersion !== raw.version ||
          existing.admission.bundleDigest !== version.bundleSha256 ||
          existing.admission.inputDigest !== digestInput(input) ||
          !sameContract(existing.admission, contract, service.config.imageDigest))
      )
        return refusal("IDEMPOTENCY_CONFLICT", 409);
      const bytes = await reviewedBytes(service, principal, version.bundleSha256);
      if (contract) await inspectPureBundle(bytes, contract);
      const admission = createSubmitRunService({
        store: service.store,
        imageProfiles: createImageProfileRegistry({
          runtimes: [
            {
              runtime: "bun",
              version: "1.3.14",
              imageDigest: service.config.imageDigest,
            },
          ],
          dependencyLayers: {},
        }),
      });
      const { run } = await admission.submit({
        tenantId: principal.orgId,
        skillId: id,
        skillVersion: raw.version,
        bundleDigest: version.bundleSha256,
        input,
        idempotencyKey: key,
        runtime: "bun",
        ...(contract ? { executionContract: contract } : {}),
        limits: contract ? PURE_LIMITS : {
          maxDurationMs: RUNTIME_TIMEOUT_MS,
          maxArtifactsBytes: RUNTIME_MAX_ARTIFACT_BYTES,
        },
      });
      // Another request can win the same key after the earlier lookup. The
      // stored admission remains authoritative before attaching any input bytes.
      if (
        run.tenantId !== principal.orgId ||
        run.skillId !== id ||
        run.skillVersion !== raw.version ||
        run.bundleDigest !== version.bundleSha256 ||
        run.inputDigest !== digestInput(input) ||
        !sameContract(run, contract, service.config.imageDigest)
      )
        return refusal("IDEMPOTENCY_CONFLICT", 409);
      await service.store.mutate(run.runId, (j) => {
        if (!j.input) {
          j.input = input;
          j.bundleBase64 = Buffer.from(bytes).toString("base64");
        }
      });
      const state = await service.store.getRun(run.runId);
      const dispatched =
        state && isTerminalStatus(state.status)
          ? null
          : await service.dispatcher.submit(run);
      const job = await service.store.job(run.runId);
      if (!job) throw Error("Execution admission disappeared");
      return json(
        {
          ...publicJob(job),
          ...(dispatched
            ? { dispatch: { accepted: dispatched.accepted } }
            : {}),
        },
        202,
      );
    }
    const job = await service.store.job(id);
    if (!job || job.execution.admission.tenantId !== principal.orgId)
      return refusal("EXECUTION_NOT_FOUND", 404);
    if (
      request.method === "POST" &&
      sub === "cancel" &&
      segments.length === 5
    ) {
      const result = await service.dispatcher.cancel(id);
      return json(
        {
          ...publicJob((await service.store.job(id))!),
          cancelAccepted: result.accepted,
        },
        result.accepted ? 200 : 202,
      );
    }
    if (request.method !== "GET") return refusal("METHOD_NOT_ALLOWED", 405);
    if (!sub) {
      if (!isTerminalStatus(job.execution.status)) {
        const attempt = job.attempts.find(
          (a) => a.attemptId === job.execution.currentAttemptId,
        );
        if (attempt) {
          const observation = await service.dispatcher.reconcile(
            job.execution.admission,
            attempt,
          );
          if (observation.kind === "previous-terminal")
            await service.store.mutate(id, (j) => {
              if (isTerminalStatus(j.execution.status) || j.result) return;
              j.result = {
                exitCode: 1,
                stdout: "",
                stderr: "",
                artifacts: [],
                error: "Task stopped without a completion receipt",
              };
              const now = new Date().toISOString();
              j.execution.status = "failed";
              j.execution.updatedAt = now;
              j.execution.terminalReceiptId = attempt.attemptId;
              const receipt = j.receipts.find(
                (r) => r.attemptId === attempt.attemptId,
              );
              if (receipt)
                Object.assign(receipt, {
                  completedAt: now,
                  exitCode: 1,
                  status: "failed",
                });
              for (const a of j.attempts) a.status = "terminal";
            });
        }
      }
      if (
        !isTerminalStatus(job.execution.status) &&
        Date.now() - Date.parse(job.execution.admission.createdAt) >
          20 * 60 * 1000
      ) {
        const stopped = await service.dispatcher.cancel(id);
        if (!stopped.accepted)
          return json({ ...publicJob(job), reconciliationRequired: true });
      }
      return json(publicJob((await service.store.job(id))!));
    }
    if (sub === "logs" && segments.length === 5)
      return json({
        stdout: job.result?.stdout ?? "",
        stderr: job.result?.stderr ?? "",
      });
    if (sub === "artifacts" && segments.length === 5)
      return json(
        (job.result?.artifacts ?? []).map(({ base64, ...meta }) => meta),
      );
    if (sub === "artifacts" && segments.length === 6) {
      const a = job.result?.artifacts.find((a) => a.name === segments[5]);
      if (!a) return refusal("ARTIFACT_NOT_FOUND", 404);
      return new Response(Buffer.from(a.base64, "base64"), {
        headers: {
          "content-type": a.contentType,
          "content-disposition": `attachment; filename="${a.name}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      });
    }
    return refusal("EXECUTION_ROUTE_NOT_FOUND", 404);
  } catch (error) {
    if (error instanceof RuntimeBundleError) return refusal(error.code, error.status);
    if ((error as Error).message === "Runtime concurrency limit reached")
      return refusal("RUNTIME_CONCURRENCY_LIMIT", 429);
    return refusal(
      "EXECUTION_REQUEST_FAILED",
      400,
      (error as Error).message.startsWith("PDF ")
        ? (error as Error).message
        : "Execution request could not be completed",
    );
  }
}
/** Worker-only route, before ordinary API-key auth. The token is bound to one
 * run, attempt, generation and deadline; it cannot read the registry or another run. */
export async function handleRuntimeWorkerRequest(
  request: Request,
  service: RuntimeService | null,
): Promise<Response | null> {
  const s = path(request);
  if (s[0] !== "api" || s[1] !== "v1" || s[2] !== "runtime") return null;
  if (
    !service ||
    s.length !== 5 ||
    !/^run_[a-z0-9_]+$/.test(s[3] ?? "") ||
    !["work", "complete"].includes(s[4] ?? "")
  )
    return refusal("RUNTIME_ROUTE_NOT_FOUND", 404);
  const job = await service.store.job(s[3]!);
  const attempt = job?.attempts.find(
    (a) => a.attemptId === job.execution.currentAttemptId,
  );
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (
    !job ||
    !attempt ||
    !token ||
    !verifyRuntimeToken(
      token,
      service.signingKey,
      job.execution.admission,
      attempt,
    )
  )
    return refusal("RUNTIME_AUTH_REQUIRED", 401);
  if (job.execution.status === "cancelled")
    return refusal("EXECUTION_CANCELLED", 409);
  if (request.method === "GET" && s[4] === "work") {
    if (
      isTerminalStatus(job.execution.status) ||
      !job.input ||
      !job.bundleBase64
    )
      return refusal("EXECUTION_NOT_RUNNABLE", 409);
    await service.store.setRunStatus(s[3]!, "running");
    return json({
      admission: job.execution.admission,
      input: job.input,
      bundleBase64: job.bundleBase64,
    });
  }
  if (request.method === "POST" && s[4] === "complete") {
    try {
      const result = validatedResult(await body(request, 3_000_000), job);
      await service.store.mutate(s[3]!, (j) => {
        if (j.execution.status === "cancelled")
          throw Error("Execution cancelled");
        if (j.result) {
          if (JSON.stringify(j.result) !== JSON.stringify(result))
            throw Error("Conflicting completion");
          return;
        }
        const receipt = j.receipts.find(
          (r) => r.attemptId === attempt.attemptId,
        );
        if (!receipt) throw Error("Launch receipt missing");
        const latest = j.attempts.find(
          (a) => a.attemptId === attempt.attemptId,
        );
        if (
          !latest ||
          !latest.taskId ||
          latest.leaseGeneration !== attempt.leaseGeneration
        )
          throw Error("Stale worker");
        const now = new Date().toISOString(),
          status = result.exitCode === 0 ? "succeeded" : "failed";
        j.result = result;
        j.execution.status = status;
        j.execution.updatedAt = now;
        j.execution.terminalReceiptId = attempt.attemptId;
        Object.assign(receipt, {
          taskId: latest.taskId,
          completedAt: now,
          exitCode: result.exitCode,
          status,
          artifactPointers: result.artifacts.map(
            (a) => `executions/${s[3]}/artifacts/${a.name}`,
          ),
          logPointers: [`executions/${s[3]}/logs`],
        });
        latest.status = "terminal";
      });
      return json({ ok: true });
    } catch {
      return refusal("RUNTIME_COMPLETION_REJECTED", 409);
    }
  }
  return refusal("METHOD_NOT_ALLOWED", 405);
}
function validatedResult(value: unknown, job: RuntimeJob): RuntimeResult {
  if (!value || typeof value !== "object") throw Error("Invalid result");
  const v = value as RuntimeResult;
  if (
    !Number.isInteger(v.exitCode) ||
    v.exitCode < 0 ||
    v.exitCode > 255 ||
    typeof v.stdout !== "string" ||
    typeof v.stderr !== "string" ||
    Buffer.byteLength(v.stdout) > RUNTIME_MAX_LOG_BYTES ||
    Buffer.byteLength(v.stderr) > RUNTIME_MAX_LOG_BYTES ||
    !Array.isArray(v.artifacts) ||
    v.artifacts.length > 2
  )
    throw Error("Invalid result");
  if (job.execution.admission.executionContract) {
    assertPureAdmission(job.execution.admission);
    if (v.artifacts.length || Buffer.byteLength(v.stdout) > PURE_DESCRIPTOR.stdoutBytes ||
        Buffer.byteLength(v.stderr) > PURE_DESCRIPTOR.stderrBytes) throw Error("Invalid pure result limits");
    if (v.exitCode === 0) validatePureOutput(v.stdout, pureInput(job.input));
    return { exitCode: v.exitCode, stdout: v.stdout, stderr: v.stderr, artifacts: [],
      ...(typeof v.error === "string" ? { error: v.error.slice(0, 500) } : {}) };
  }
  if (job.execution.admission.skillId !== "pdf-generate") throw Error("Missing execution contract");
  let total = 0;
  const seen = new Set<string>();
  for (const a of v.artifacts) {
    if (
      !["document.pdf", "document.html"].includes(a.name) ||
      seen.has(a.name) ||
      typeof a.base64 !== "string" ||
      a.base64.length > 3_000_000
    )
      throw Error("Invalid artifact");
    seen.add(a.name);
    const bytes = Buffer.from(a.base64, "base64");
    total += bytes.length;
    if (
      hashBytes(bytes) !== a.sha256 ||
      bytes.length !== a.byteSize ||
      total > RUNTIME_MAX_ARTIFACT_BYTES
    )
      throw Error("Artifact integrity failed");
    if (
      a.name === "document.pdf" &&
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw Error("Invalid PDF");
    a.contentType = a.name.endsWith(".pdf")
      ? "application/pdf"
      : "text/html; charset=utf-8";
  }
  if (v.exitCode === 0 && !seen.has("document.pdf")) throw Error("Missing PDF");
  return {
    exitCode: v.exitCode,
    stdout: v.stdout,
    stderr: v.stderr,
    artifacts: v.artifacts,
    ...(typeof v.error === "string" ? { error: v.error.slice(0, 500) } : {}),
  };
}

/** Replays persisted launch intents after an API restart and settles tasks that
 * stop before they can send a completion. Lost launch observations remain
 * unresolved: an empty eventual ECS listing must never cause a second launch. */
export async function reconcileRuntimeJobs(
  service: RuntimeService,
): Promise<void> {
  for (const job of await service.store.activeJobs()) {
    const id = job.execution.admission.runId,
      age = Date.now() - Date.parse(job.execution.admission.createdAt);
    try {
      if (age > 20 * 60 * 1000) {
        await service.dispatcher.cancel(id);
        continue;
      }
      if (!job.input || !job.bundleBase64) continue;
      const outcome = await service.dispatcher.launchAttempt(id);
      if (outcome.kind === "previous-terminal")
        await service.store.mutate(id, (j) => {
          if (isTerminalStatus(j.execution.status) || j.result) return;
          const now = new Date().toISOString();
          j.result = {
            exitCode: 1,
            stdout: "",
            stderr: "",
            artifacts: [],
            error: "Task stopped without a completion receipt",
          };
          j.execution.status = "failed";
          j.execution.updatedAt = now;
          j.execution.terminalReceiptId = outcome.attemptId;
          const receipt = j.receipts.find(
            (r) => r.attemptId === outcome.attemptId,
          );
          if (receipt)
            Object.assign(receipt, {
              completedAt: now,
              exitCode: 1,
              status: "failed",
            });
          for (const a of j.attempts) a.status = "terminal";
        });
    } catch {
      /* another replica may have completed or cancelled this exact generation */
    }
  }
}
