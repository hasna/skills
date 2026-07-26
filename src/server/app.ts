import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../lib/remote-run-contract.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { authenticateRequest } from "./auth.js";
import { resolveServerConfig, type SkillsServerConfig } from "./config.js";
import { executeRun } from "./handlers.js";
import { quoteServerSkill, getServerSkill, getServerSkillMd, listServerSkills } from "./registry.js";
import { createStore, type MemorySkillsStore } from "./store.js";
import type { ApiPrincipal, ServerRunRecord, SkillsProductStore } from "./types.js";

export interface SkillsServerOptions {
  config?: Partial<SkillsServerConfig>;
  store?: SkillsProductStore;
}

/**
 * Refuse to serve traffic from storage that will not survive a restart.
 *
 * /health answering `ok: true` from a process backed by a Map is worse than a crash: it
 * satisfies every load balancer, container orchestrator, and smoke test we have, right
 * up until the process restarts and every run, log, and artifact is gone. Failing at
 * startup puts the problem where an operator will see it.
 *
 * A store that declares no backend is assumed durable - see StoreBackendInfo. This
 * guard's job is to make our own defaults safe, not to audit somebody else's store.
 */
export function assertDurableStore(store: SkillsProductStore, config: Pick<SkillsServerConfig, "allowEphemeralStore">): void {
  const backend = store.backend;
  if (!backend || backend.durable || config.allowEphemeralStore) return;
  throw new Error(
    `refusing to start: the configured store is ${backend.label} and does not survive a restart. ` +
      "Leave HASNA_SKILLS_DATABASE_URL unset to use the durable SQLite database in the skills data " +
      "directory, or point it at a postgres:// URL. Set HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1 only if " +
      "losing every run on restart is genuinely what you want.",
  );
}

export async function createSkillsFetchHandler(options: SkillsServerOptions = {}): Promise<(request: Request) => Promise<Response>> {
  const config = { ...resolveServerConfig(), ...options.config };
  const store = options.store ?? await createStore({
    databaseUrl: config.databaseUrl,
    bootstrapApiKey: config.bootstrapApiKey,
  });
  assertDurableStore(store, config);
  const artifactStorage = new ArtifactStorage({
    bucket: config.artifactBucket,
    prefix: config.artifactPrefix,
  });

  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const segments = pathSegments(url.pathname);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "open-skills", time: new Date().toISOString() });
      }

      if (request.method === "GET" && url.pathname === "/ready") {
        return json({ ok: true, service: "open-skills" });
      }

      if (url.pathname.startsWith("/api/")) {
        const principal = await authenticateRequest(store, request);
        if (!principal) return json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });

        if (request.method === "GET" && url.pathname === "/api/auth/whoami") {
          return json(identityPayload(principal));
        }

        if (segments[0] === "api" && segments[1] === "v1") {
          return await handleApiV1(store, principal, request, segments.slice(2), config, artifactStorage);
        }
      }

      return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
    } catch (error) {
      return json({ error: "internal server error", detail: (error as Error).message }, { status: 500 });
    }
  };
}

export async function startSkillsServer(options: SkillsServerOptions = {}): Promise<Bun.Server<undefined>> {
  const config = { ...resolveServerConfig(), ...options.config };
  const fetch = await createSkillsFetchHandler({ ...options, config });
  return Bun.serve({ hostname: config.host, port: config.port, fetch });
}

async function handleApiV1(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  request: Request,
  parts: string[],
  config: SkillsServerConfig,
  artifactStorage: ArtifactStorage,
): Promise<Response> {
  const [resource, id, subresource, childId] = parts;

  if (resource === "skills") {
    if (request.method === "GET" && !id) return json(listServerSkills());
    if (request.method === "GET" && id && subresource === "skill.md") {
      const docs = getServerSkillMd(id);
      return docs ? new Response(docs, { headers: { "Content-Type": "text/markdown; charset=utf-8" } }) : json({ error: "skill not found" }, { status: 404 });
    }
    if (request.method === "GET" && id && !subresource) {
      const skill = getServerSkill(id);
      return skill ? json(skill) : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }
    if (request.method === "POST" && id && subresource === "quote") return json(quoteServerSkill(id));
  }

  if (resource === "runs") {
    if (request.method === "GET" && !id) {
      const limit = clampInt(new URL(request.url).searchParams.get("limit"), 20, 100);
      return json((await store.listRuns(principal, limit)).map(runPayload));
    }

    if (request.method === "POST" && id && !subresource) {
      const body = await readJson(request, config.requestBodyLimitBytes);
      const input = isRecord(body.input) ? body.input : {};
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      const run = await store.createRun({
        principal,
        slug: id,
        input,
        args,
        idempotencyKey: request.headers.get("idempotency-key") || stringField(body.idempotencyKey),
      });
      if (config.inlineWorker) void executeRun(store, run, artifactStorage);
      return json(runPayload(run), { status: 202 });
    }

    if (request.method === "GET" && id && !subresource) {
      const run = await store.getRun(principal, id);
      return run ? json(runPayload(run)) : json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "GET" && id && subresource === "logs") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      return json(await store.listLogs(principal, id));
    }

    if (request.method === "GET" && id && subresource === "artifacts" && !childId) {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      const artifacts = await store.listArtifacts(principal, id);
      return json(artifacts.map(({ bodyText, ...artifact }) => artifact));
    }

    if (request.method === "GET" && id && subresource === "artifacts" && childId) {
      const artifact = await store.getArtifact(principal, id, childId);
      if (!artifact) return json({ error: "artifact not found", code: "ARTIFACT_NOT_FOUND" }, { status: 404 });
      const body = await artifactStorage.readText(artifact);
      if (body === null) {
        return json({ error: "artifact storage backend unavailable", code: "ARTIFACT_BACKEND_UNAVAILABLE" }, { status: 503 });
      }
      return new Response(body, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName.replace(/"/g, "")}"`,
        },
      });
    }

    if (request.method === "POST" && id && subresource === "cancel") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      const next = await store.updateRun(id, { status: "cancel_requested" });
      return json(runPayload(next ?? run));
    }
  }

  if (resource === "billing") {
    if (request.method === "GET" && id === "status") {
      return json({ plan: "self-hosted", balanceCents: 0, balance: "$0.00", subscription: null, hasPaymentMethod: false });
    }
    if (request.method === "GET" && id === "credits") {
      return json({ packs: [] });
    }
    if (request.method === "POST") {
      return json({ error: "billing is not configured for this deployment", code: "BILLING_NOT_CONFIGURED" }, { status: 501 });
    }
  }

  return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
}

function identityPayload(principal: ApiPrincipal): Record<string, unknown> {
  return {
    user: { id: principal.userId, email: principal.email, role: principal.role },
    organization: { id: principal.orgId, slug: principal.orgSlug, name: principal.orgName },
  };
}

function runPayload(run: ServerRunRecord): Record<string, unknown> {
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    id: run.id,
    skill: run.skill,
    requestedSlug: run.requestedSlug,
    status: run.status,
    correlationId: run.correlationId,
    costCents: run.costCents,
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.outputType ? { outputType: run.outputType } : {}),
    ...(run.outputPreview ? { outputPreview: run.outputPreview } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode, code: run.errorCode } : {}),
    ...(run.errorMessage ? { errorMessage: run.errorMessage, error: run.errorMessage } : {}),
  };
}

async function readJson(request: Request, limitBytes: number): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > limitBytes) throw new Error("request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limitBytes) throw new Error("request body too large");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  return isRecord(parsed) ? parsed : {};
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clampInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export type { MemorySkillsStore };
