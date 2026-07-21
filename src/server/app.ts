import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../lib/remote-run-contract.js";
import { getSelfHostedExecutionCapability } from "../lib/self-hosted-capabilities.js";
import type { ApiKeyScope } from "../lib/api-key-scopes.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { authenticateRequest, principalHasScope } from "./auth.js";
import { resolveServerConfig, type SkillsServerConfig } from "./config.js";
import { executeRun } from "./handlers.js";
import { quoteServerSkill, getServerSkill, getServerSkillMd, listServerSkills } from "./registry.js";
import { createStore, type MemorySkillsStore } from "./store.js";
import type { ApiPrincipal, ServerRunRecord, SkillsProductStore } from "./types.js";

export interface SkillsServerOptions {
  config?: Partial<SkillsServerConfig>;
  store?: SkillsProductStore;
}

export async function createSkillsFetchHandler(options: SkillsServerOptions = {}): Promise<(request: Request) => Promise<Response>> {
  const config = { ...resolveServerConfig(), ...options.config };
  const store = options.store ?? await createStore({
    databaseUrl: config.databaseUrl,
    bootstrapApiKey: config.bootstrapApiKey,
  });
  const artifactStorage = new ArtifactStorage({
    bucket: config.artifactBucket,
    prefix: config.artifactPrefix,
  });

  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const segments = pathSegments(url.pathname);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "open-skills", mode: "self-hosted", time: new Date().toISOString() });
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
  const [resource, id, subresource, childId, action] = parts;

  if (resource === "skills") {
    const denied = requireScope(principal, "skills:read");
    if (denied) return denied;
    if (request.method === "GET" && parts.length === 1) return json(listServerSkills());
    if (request.method === "GET" && parts.length === 3 && id && subresource === "skill.md") {
      const docs = getServerSkillMd(id);
      return docs ? new Response(docs, { headers: { "Content-Type": "text/markdown; charset=utf-8" } }) : json({ error: "skill not found" }, { status: 404 });
    }
    if (request.method === "GET" && parts.length === 2 && id) {
      const skill = getServerSkill(id);
      return skill ? json(skill) : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }
    if (request.method === "POST" && parts.length === 3 && id && subresource === "quote") return json(quoteServerSkill(id));
  }

  if (resource === "runs") {
    const requiredScope: ApiKeyScope | null = request.method === "POST"
      ? "runs:write"
      : request.method === "GET" && subresource === "artifacts"
        ? "artifacts:read"
        : request.method === "GET"
          ? "runs:read"
          : null;
    if (requiredScope) {
      const denied = requireScope(principal, requiredScope);
      if (denied) return denied;
    }

    if (request.method === "GET" && parts.length === 1) {
      const limit = clampInt(new URL(request.url).searchParams.get("limit"), 20, 100);
      return json((await store.listRuns(principal, limit)).map(runPayload));
    }

    if (request.method === "POST" && parts.length === 2 && id) {
      const skill = getServerSkill(id);
      if (!skill) return json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
      if (!getSelfHostedExecutionCapability(id)) {
        return json({
          error: "This self-hosted deployment has no executable handler for that skill.",
          code: "HANDLER_UNAVAILABLE",
        }, { status: 503 });
      }
      const body = await readJson(request, config.requestBodyLimitBytes);
      const input = isRecord(body.input) ? body.input : {};
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      const { run, created } = await store.createRun({
        principal,
        slug: id,
        input,
        args,
        idempotencyKey: request.headers.get("idempotency-key") || stringField(body.idempotencyKey),
      });
      if (config.inlineWorker && created) void executeRun(store, run, artifactStorage);
      return json(runPayload(run), { status: 202 });
    }

    if (request.method === "GET" && parts.length === 2 && id) {
      const run = await store.getRun(principal, id);
      return run ? json(runPayload(run)) : json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "GET" && parts.length === 3 && id && subresource === "logs") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      return json(await store.listLogs(principal, id));
    }

    if (request.method === "GET" && parts.length === 3 && id && subresource === "artifacts") {
      const run = await store.getRun(principal, id);
      if (!run) return json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
      const artifacts = await store.listArtifacts(principal, id);
      return json(artifacts.map(({ bodyText, ...artifact }) => ({
        ...artifact,
        type: "generated_output",
      })));
    }

    if (request.method === "GET" && parts.length === 5 && id && subresource === "artifacts" && childId && action === "download") {
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
          "X-Skills-Artifact-Type": "generated_output",
        },
      });
    }

    if (request.method === "POST" && parts.length === 3 && id && subresource === "cancel") {
      const next = await store.requestCancellation(principal, id);
      return next
        ? json(runPayload(next))
        : json({ error: "run not found", code: "RUN_NOT_FOUND" }, { status: 404 });
    }
  }

  if (resource === "billing") {
    if (request.method === "GET" && parts.length === 2 && id === "status") {
      return json({ plan: "self-hosted", creditBalance: 0, subscription: null, hasPaymentMethod: false });
    }
    if (request.method === "GET" && parts.length === 2 && id === "credits") {
      return json({ packs: [], mode: "self-hosted" });
    }
    if (
      request.method === "POST"
      && parts.length === 2
      && (id === "checkout" || id === "portal" || id === "credits")
    ) {
      return json({ error: "billing is not configured for this self-hosted deployment", code: "BILLING_NOT_CONFIGURED" }, { status: 501 });
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

function requireScope(principal: ApiPrincipal, requiredScope: ApiKeyScope): Response | null {
  if (principalHasScope(principal, requiredScope)) return null;
  return json({
    error: `API key requires the ${requiredScope} scope`,
    code: "INSUFFICIENT_SCOPE",
    requiredScope,
  }, { status: 403 });
}

function runPayload(run: ServerRunRecord): Record<string, unknown> {
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    id: run.id,
    skill: run.skill,
    requestedSlug: run.requestedSlug,
    status: run.status,
    correlationId: run.correlationId,
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
