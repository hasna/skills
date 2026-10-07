import pkg from "../../package.json" with { type: "json" };
import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../lib/remote-run-contract.js";
import { signBundleBytes } from "../lib/skill-bundles.js";
import { createCancelService } from "../sdk/cancel.js";
import { GOVERNANCE_ERROR_CODES, GovernanceError } from "../sdk/governance.js";
import { createGovernanceStore, type GovernanceStore } from "../sdk/governance-store.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { authenticateRequest, permitsSkillsRoute } from "./auth.js";
import { handleExecutionGrantApi } from "./execution-grants-api.js";
import { handleProfileApi } from "./profile-api.js";
import { createRuntimeService, handleRuntimeApiRequest, handleRuntimeWorkerRequest, type RuntimeService } from "./runtime-api.js";
import { resolveServerConfig, type SkillsServerConfig } from "./config.js";
import { resolveDatabaseTarget } from "./database-url.js";
import { LEGACY_EXECUTION_GUIDANCE, LEGACY_EXECUTION_RETIRED } from "./handlers.js";
import {
  SkillRequestError,
  assertPublishableSlug,
  getMergedSkill,
  getMergedSkillMd,
  listMergedSkills,
  listMergedSkillsByTag,
  listOrgTags,
  listPinsByTag,
  parseIfMatch,
  parsePublishRequest,
  pinMetadataField,
  pinPayload,
  readPublishedBundle,
  listSkillVersionsPayload,
  readSkillVersion,
  readSkillVersionBundle,
  skillVersionPayload,
  resolvePublishedSkill,
  revisionEtag,
  storePublishedSkill,
  deletePublishedSkill,
  publishedPayload,
  skillSummary,
  skillLifecyclePatch,
} from "./skills-api.js";
import { createStore, type MemorySkillsStore } from "./store.js";
import { SkillLifecycleConflictError, SkillRevisionConflictError, SkillVersionExistsError, StaleLeaseGenerationError, type ApiPrincipal, type ServerRunRecord, type SkillsProductStore } from "./types.js";

export interface SkillsServerOptions {
  /** Overrides the artifact storage (tests inject an in-memory S3 stand-in). */
  artifactStorage?: ArtifactStorage;
  config?: Partial<SkillsServerConfig>;
  store?: SkillsProductStore;
  /** Lifecycle ledger and ceiling reads for governance surfaces (cancellation). Defaults to the store's database. */
  governanceStore?: GovernanceStore;
  /** Inject a configured cloud runtime, or null to explicitly disable cloud execution. */
  runtime?: RuntimeService | null;
}

export type SkillsFetchHandler = ((request: Request) => Promise<Response>) & { close(): Promise<void> };

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
  if (!backend || backend.durable) return;
  assertDurableTarget(backend, config);
}

/** The same refusal, expressed against a resolved target so it can run before anything opens. */
export function assertDurableTarget(
  target: { durable: boolean; label: string },
  config: Pick<SkillsServerConfig, "allowEphemeralStore">,
): void {
  if (target.durable || config.allowEphemeralStore) return;
  throw new Error(
    `refusing to start: the configured store is ${target.label} and does not survive a restart. ` +
      "Leave HASNA_SKILLS_DATABASE_URL unset to use the durable SQLite database in the skills data " +
      "directory, or point it at a postgres:// URL. Set HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1 only if " +
      "losing every run on restart is genuinely what you want.",
  );
}

export async function createSkillsFetchHandler(options: SkillsServerOptions = {}): Promise<SkillsFetchHandler> {
  const config = { ...resolveServerConfig(), ...options.config };
  // Refuse before opening anything. Resolving the target is pure, so a configuration we
  // are going to reject never gets as far as creating a database file or a connection
  // pool that nothing then closes.
  if (!options.store) assertDurableTarget(resolveDatabaseTarget(config.databaseUrl), config);
  if (!config.publicBaseUrl) {
    throw new Error("refusing to start: set SKILLS_PUBLIC_BASE_URL to this Skills server's public API origin; a bound socket is not an authority for client receipts.");
  }
  const store = options.store ?? await createStore({
    databaseUrl: config.databaseUrl,
    bootstrapApiKey: config.bootstrapApiKey,
  });
  assertDurableStore(store, config);
  // Governance surfaces (cancellation) need the append-only lifecycle ledger and
  // the ceiling reads over the same database the product store writes. The
  // dialect resolution mirrors createStore's: postgres:// URL -> Postgres, no
  // URL -> the durable SQLite file in the data directory.
  const governanceStore = options.governanceStore ?? (await createGovernanceStore(config.databaseUrl));
  const artifactStorage = options.artifactStorage ?? new ArtifactStorage({
    bucket: config.artifactBucket,
    prefix: config.artifactPrefix,
    runPrefix: config.runArtifactPrefix,
  });
  const runtime = options.runtime !== undefined ? options.runtime : await createRuntimeService({ databaseUrl: config.databaseUrl, productStore: store, artifacts: artifactStorage });
  // Startup creates authentication and storage only. Skill content enters an
  // organization through its authenticated publish API, never the server's home.

  const fetch = async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // API-FIRST aliases delegate to the existing handlers and credential gate.
    // The fleet gateway strips only /skills; standalone /api routes stay valid.
    const versionedAliases: Record<string, string> = {
      "/v1/health": "/health",
      "/v1/auth/whoami": "/api/auth/whoami",
    };
    const alias = versionedAliases[url.pathname]
      ?? (url.pathname === "/v1" || url.pathname.startsWith("/v1/") ? `/api${url.pathname}` : undefined);
    if (alias) {
      url.pathname = alias;
      request = new Request(url, request);
    }
    const segments = pathSegments(url.pathname);

    try {
      const callback = await handleRuntimeWorkerRequest(request, runtime);
      if (callback) return callback;
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "skills", time: new Date().toISOString() });
      }

      if (request.method === "GET" && url.pathname === "/ready") {
        return json({ ok: true, service: "skills" });
      }

      // Deploy-gate contract (todos O15-03836): the fleet deploy gate verifies a
      // live build by GET /version -> 200 with the service identity and the
      // package version. It previously fell through to the 404 handler, so the
      // gate could never pass at skills.hasna.xyz.
      if (request.method === "GET" && url.pathname === "/version") {
        return json({ ok: true, service: "skills", version: pkg.version });
      }

      if (url.pathname.startsWith("/api/")) {
        const principal = await authenticateRequest(store, request);
        if (!principal) return json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 });

        const execution = await handleRuntimeApiRequest(request, principal, runtime);
        if (execution) return execution;

        if (request.method === "GET" && url.pathname === "/api/v1/capabilities") {
          const response = await handleProfileApi(store, principal, request, ["capabilities"], config);
          const payload = await response!.json() as Record<string, any>;
          return json({ ...payload, cloudExecution: Boolean(runtime), cloudExecutionContracts: runtime ? ["pdf.v1", "regex-test.v1"] : [], capabilities: [...payload.capabilities, ...(runtime ? ["skills.cloud-execution"] : [])] });
        }

        if (request.method === "GET" && url.pathname === "/api/auth/whoami") {
          return json(identityPayload(principal));
        }

        if (segments[0] === "api" && segments[1] === "v1") {
          return await handleApiV1(store, governanceStore, principal, request, segments.slice(2), config, artifactStorage);
        }
      }

      return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
    } catch (error) {
      // A SkillRequestError is a statement about the request, not a server fault. Left to
      // the generic handler below, "bundle is 40000000 bytes, over the 25000000 byte
      // limit" would come back as a 500 and read as our bug rather than the caller's.
      if (error instanceof SkillRequestError) {
        return json({ error: error.message, code: error.code }, { status: error.status });
      }
      // The optimistic-concurrency refusal (todos d061fcda): a write raced a newer
      // revision. 409 is the contract's answer — the caller must re-read and retry
      // with the current revision — never the generic 500 a conflict would otherwise
      // read as.
      if (error instanceof SkillVersionExistsError) {
        return json(
          {
            error: error.message,
            code: "SKILL_VERSION_EXISTS",
            slug: error.slug,
            version: error.version,
            existingBundleSha256: error.existingSha256,
            attemptedBundleSha256: error.attemptedSha256,
          },
          { status: 409 },
        );
      }
      if (error instanceof SkillLifecycleConflictError) {
        return json({ error: error.message, code: "SKILL_ARCHIVE_PROFILE_CONFLICT", profiles: error.profiles }, { status: 409 });
      }
      if (error instanceof SkillRevisionConflictError) {
        return json(
          {
            error: error.message,
            code: "REVISION_CONFLICT",
            slug: error.slug,
            ...(error.currentRevisionId ? { currentRevisionId: error.currentRevisionId } : {}),
          },
          { status: 409 },
        );
      }
      return json({ error: "internal server error", detail: (error as Error).message }, { status: 500 });
    }
  };
  let closed = false;
  return Object.assign(fetch, { async close() {
    if (closed) return;
    closed = true;
    if (options.runtime === undefined) await runtime?.close?.();
    if (!options.governanceStore) await governanceStore.close?.();
    if (!options.store) await store.close?.();
  } });
}

export async function startSkillsServer(options: SkillsServerOptions = {}): Promise<Bun.Server<undefined>> {
  const config = { ...resolveServerConfig(), ...options.config };
  const fetch = await createSkillsFetchHandler({ ...options, config });
  return Bun.serve({ hostname: config.host, port: config.port, fetch, ...skillsServeLimits(config) });
}

/**
 * Socket-level body ceiling, derived from the same setting the publish route enforces.
 *
 * Without this the configured bundle limit was only ever advisory: Bun.serve defaults to
 * 128 MB, a chunked request sends no Content-Length for the early check to read, and
 * `request.formData()` materialises the whole body before any per-part check can run. So
 * a 25 MB configured cap admitted 128 MB of buffered request per connection. This refuses
 * it at the socket, before any of that is allocated.
 *
 * Exported so an embedder calling Bun.serve() with our fetch handler gets the same
 * ceiling instead of silently inheriting the default.
 */
export function skillsServeLimits(config: Pick<SkillsServerConfig, "skillBundleLimitBytes" | "requestBodyLimitBytes">): { maxRequestBodySize: number } {
  return { maxRequestBodySize: Math.max(config.skillBundleLimitBytes, config.requestBodyLimitBytes) + BODY_LIMIT_HEADROOM_BYTES };
}

/**
 * Slack between the configured payload cap and the socket cap, for multipart framing:
 * boundaries, per-part headers, and the manifest part that travels beside the bundle. Too
 * small and a bundle exactly at the limit is rejected by the transport with a message
 * about the wrong thing.
 */
const BODY_LIMIT_HEADROOM_BYTES = 1_000_000;

async function handleApiV1(
  store: SkillsProductStore,
  governanceStore: GovernanceStore,
  principal: ApiPrincipal,
  request: Request,
  parts: string[],
  config: SkillsServerConfig,
  artifactStorage: ArtifactStorage,
): Promise<Response> {
  const [resource, id, subresource, childId] = parts;

  // Router boundary (defence in depth): no decoded path segment may carry a path
  // separator or `..`. pathSegments() decodes each segment AFTER splitting on '/', so an
  // encoded `%2F`/`%2E%2E` would otherwise smuggle a traversal past the split and into a
  // handler as one opaque segment. Reject before any dispatch, before touching the store
  // or the registry.
  if (parts.some(segmentEscapesPath)) {
    return json({ error: "invalid path segment", code: "INVALID_PATH" }, { status: 400 });
  }

  // Existing-key publication admission is deliberately separate from ordinary
  // skill writes. It changes only metadata on one tenant's existing key; it never
  // accepts a token, signing material, or a replacement scope set.
  if (parts.length === 4 && resource === "admin" && id === "keys" && subresource && childId === "scopes" && request.method === "PATCH") {
    const adminScope = principal.scopes.includes("*") || principal.scopes.includes("skills:keys.admin");
    if (!adminScope || !["owner", "admin"].includes(principal.role)) {
      return json({ error: "Key scope administration requires an owner/admin key with skills:keys.admin", code: "KEY_ADMIN_REQUIRED" }, { status: 403 });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(subresource)) {
      return json({ error: "Key id must be url-safe (letters, digits, '_' or '-')", code: "INVALID_KEY_ID" }, { status: 400 });
    }
    const body = await readJson(request, config.requestBodyLimitBytes);
    const expected = body.expected_scopes;
    const additions = body.add_scopes;
    if (!Array.isArray(expected) || !expected.every((scope) => typeof scope === "string") || !Array.isArray(additions) || !additions.every((scope) => typeof scope === "string")) {
      return json({ error: "expected_scopes and add_scopes must be arrays of scope strings", code: "INVALID_KEY_SCOPE_UPDATE" }, { status: 400 });
    }
    if (additions.length !== 1 || additions[0] !== "skills:publish") {
      return json({ error: "Only adding skills:publish to an existing Skills key is supported", code: "INVALID_KEY_SCOPE_UPDATE" }, { status: 400 });
    }
    const update = await store.updateApiKeyScopes?.(principal, subresource, expected, additions);
    if (!update) return json({ error: "Key scope administration is unavailable", code: "KEY_SCOPE_UPDATE_UNAVAILABLE" }, { status: 501 });
    if (update.kind === "not_found") return json({ error: "API key not found", code: "API_KEY_NOT_FOUND" }, { status: 404 });
    if (update.kind === "stale") return json({ error: "API key scopes changed; re-read and retry with expected_scopes", code: "API_KEY_SCOPE_CONFLICT", keyId: subresource, scopes: update.scopes }, { status: 409 });
    return json({ keyId: subresource, orgId: principal.orgId, scopes: update.scopes, updated: true });
  }

  if (!permitsSkillsRoute(principal, request.method, resource ?? "")) {
    return json({error:"The API key does not allow this operation",code:"INSUFFICIENT_SCOPE"}, {status:403});
  }
  const grantResponse = await handleExecutionGrantApi(store, principal, request, parts, config, artifactStorage);
  if (grantResponse) return grantResponse;
  const profileResponse = await handleProfileApi(store, principal, request, parts, config);
  if (profileResponse) return profileResponse;

  if (resource === "skills") {
    if (request.method === "GET" && !id) {
      const tag = new URL(request.url).searchParams.get("tag");
      if (tag !== null && tag !== "") return json(await listMergedSkillsByTag(store, principal, tag));
      return json(await listMergedSkills(store, principal));
    }

    // Publish. The only route that reads config.skillBundleLimitBytes. Guarded by the
    // optimistic-concurrency contract (todos d061fcda): a publish against a slug this
    // org already has live must carry If-Match naming the current revision, or the
    // write is refused with 409 - never a silent overwrite.
    if (request.method === "POST" && !id) {
      const expectedRevisionId = parseIfMatch(request.headers.get("if-match"));
      const parsed = await parsePublishRequest(request, config);
      const { record, alreadyPublished } = await storePublishedSkill(store, artifactStorage, principal, parsed, expectedRevisionId);
      return json(publishedPayload(record, { alreadyPublished }), { status: 201, headers: { ETag: revisionEtag(record.revisionId) } });
    }

    if (request.method === "GET" && id && subresource === "skill.md") {
      // The router rejects path escapes; document reads resolve only through the
      // authenticated organization's store and never construct filesystem paths.
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      const docs = await getMergedSkillMd(store, artifactStorage, principal, id);
      return docs
        ? new Response(docs, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } })
        : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "GET" && id && subresource === "versions" && !childId) {
      return json(await listSkillVersionsPayload(store, principal, id));
    }

    if (request.method === "PATCH" && id && subresource === "lifecycle" && !childId) {
      if (!["owner", "admin"].includes(principal.role)) return json({ error: "Only organization owners or admins may change skill lifecycle", code: "LIFECYCLE_ROLE_REQUIRED" }, { status: 403 });
      const expectedRevisionId = parseIfMatch(request.headers.get("if-match"));
      const updated = await store.setSkillLifecycle(principal, id, skillLifecyclePatch(await readJson(request, config.requestBodyLimitBytes)), expectedRevisionId);
      return updated
        ? json(publishedPayload(updated), { headers: { ETag: revisionEtag(updated.revisionId) } })
        : json({ error: "published skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }
    if (request.method === "GET" && id && subresource === "versions" && childId && !parts[4]) {
      const version = await readSkillVersion(store, principal, id, childId);
      const current = (await store.getSkill(principal, id))?.bundleSha256;
      return json(skillVersionPayload(version, current));
    }
    if (request.method === "GET" && id && subresource === "versions" && childId && parts[4] === "bundle" && !parts[5]) {
      const { version, bytes, authorizationEpoch } = await readSkillVersionBundle(store, artifactStorage, principal, id, childId);
      const headers: Record<string, string> = {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${version.slug}-${version.version}.tar.gz"`,
        "X-Skill-Bundle-Sha256": version.bundleSha256,
        "X-Skill-Version": version.version,
        ...(authorizationEpoch ? { "X-Skill-Authorization-Epoch": authorizationEpoch } : {}),
        ETag: `"${version.bundleSha256}"`,
        "Cache-Control": "no-store",
      };
      if (config.bundleSigningKey) headers["X-Skill-Bundle-Signature"] = signBundleBytes(bytes, config.bundleSigningKey);
      return new Response(bytes, { headers });
    }
    if (request.method === "GET" && id && subresource === "bundle") {
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      if (resolved.kind === "absent") {
        return json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
      }
      const { record, bytes } = await readPublishedBundle(store, artifactStorage, principal, id);
      const headers: Record<string, string> = {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${record.slug}.tar.gz"`,
        // The digest a client should verify against, so an intermediary cannot swap the
        // body without the client being able to notice.
        "X-Skill-Bundle-Sha256": record.bundleSha256 ?? "",
        // Revision identity (todos d061fcda): the same ETag GET /skills/:slug issues,
        // so a pull can prove WHICH revision the bytes belong to and record it in its
        // marker. Also the plain ETag, for generic HTTP caching semantics.
        "X-Skill-Revision-Id": record.revisionId,
        "X-Skill-Revision-Number": String(record.revisionNumber),
        ETag: revisionEtag(record.revisionId),
        "Cache-Control": "no-store",
      };
      // Sign the exact bytes being served so a client holding the same key can tell this
      // server's bundle from anything else, even if the digest header is stripped in
      // transit. The key is never echoed anywhere.
      if (config.bundleSigningKey) {
        headers["X-Skill-Bundle-Signature"] = signBundleBytes(bytes, config.bundleSigningKey);
      }
      return new Response(bytes, { headers });
    }

    if (request.method === "GET" && id && !subresource) {
      const resolved = await resolvePublishedSkill(store, artifactStorage, principal, id);
      if (resolved.kind === "tombstone") {
        return json({ error: "skill was deleted", ...resolved.payload }, { status: 410 });
      }
      if (resolved.kind === "published") {
        return json(publishedPayload(resolved.record), { headers: { ETag: revisionEtag(resolved.record.revisionId) } });
      }
      // Resolve only the authenticated organization's published catalog.
      const skill = await getMergedSkill(store, artifactStorage, principal, id);
      return skill ? json(skill) : json({ error: "skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    if ((request.method === "PUT" || request.method === "PATCH") && id && !subresource) {
      const expectedRevisionId = parseIfMatch(request.headers.get("if-match"));
      const body = await readJson(request, config.requestBodyLimitBytes);
      const updated = await store.updateSkill(principal, id, skillPatch(body), expectedRevisionId);
      // 404 rather than an implicit create: PUT against a slug this org has not published
      // would otherwise silently mint a bundle-less skill from a typo'd name.
      return updated
        ? json(publishedPayload(updated), { headers: { ETag: revisionEtag(updated.revisionId) } })
        : json({ error: "published skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }

    if (request.method === "DELETE" && id && !subresource) {
      const removed = await deletePublishedSkill(store, artifactStorage, principal, id, config.tombstoneWindowMs);
      return removed
        ? json({
            deleted: true,
            slug: id,
            ...(removed.tombstonedAt ? { tombstonedAt: removed.tombstonedAt, tombstonePurgeAfter: removed.tombstonePurgeAfter } : {}),
          })
        : json({ error: "published skill not found", code: "SKILL_NOT_FOUND" }, { status: 404 });
    }
  }

  if (resource === "pins") {
    if (request.method === "GET" && !id) {
      const tag = new URL(request.url).searchParams.get("tag");
      if (tag !== null && tag !== "") return json(await listPinsByTag(store, principal, tag));
      return json((await store.listPins(principal)).map(pinPayload));
    }

    if (request.method === "PUT" && id && !subresource) {
      // The slug grammar is the published-skill one, re-asserted here: a pin
      // names the same space of slugs, and the route never builds a path or a
      // storage key from it, but an unanchored slug could still smuggle
      // separators into a future consumer. Reject before touching the store.
      assertPublishableSlug(id);
      const body = await readJson(request, config.requestBodyLimitBytes);
      const pin = await store.pinSkill(principal, id, pinMetadataField(body));
      return json(pinPayload(pin));
    }

    if (request.method === "DELETE" && id && !subresource) {
      assertPublishableSlug(id);
      const removed = await store.unpinSkill(principal, id);
      return removed
        ? json({ deleted: true, slug: id })
        : json({ error: "pin not found", code: "PIN_NOT_FOUND" }, { status: 404 });
    }
  }

  if (resource === "tags") {
    if (request.method === "GET" && !id) {
      return json(await listOrgTags(store, principal));
    }

    if (request.method === "GET" && id && subresource === "skills") {
      // The tag is a decoded path segment (traversal-checked at the router
      // boundary) but not slug-validated: a tag is free text, and the store
      // filters exact-match. Empty results, never an error, for an unknown tag.
      return json((await listMergedSkillsByTag(store, principal, id)).map(skillSummary));
    }
  }

  if (resource === "runs") {
    if (request.method === "GET" && !id) {
      const limit = clampInt(new URL(request.url).searchParams.get("limit"), 20, 100);
      return json((await store.listRuns(principal, limit)).map(runPayload));
    }

    if (request.method === "POST" && id && !subresource) {
      return json({ error: LEGACY_EXECUTION_GUIDANCE, code: LEGACY_EXECUTION_RETIRED }, { status: 410 });
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
      // The shipped cancel service fences the run's lease_generation in the same
      // statement that moves it to cancel_requested, then transitions it to the
      // terminal cancelled state, quarantines partial artifacts, and appends a
      // cancellation receipt. An unfenced updateRun here let a worker that
      // finished after the cancel overwrite the cancellation, and stranded
      // queued runs in the non-terminal cancel_requested state forever (todos
      // b72cc950).
      try {
        const outcome = await createCancelService({ store, governanceStore, storage: artifactStorage }).cancel(principal, id, principal.email);
        return json(runPayload(outcome.run));
      } catch (error) {
        // A generation race while cancelling (the run moved between the read
        // above and the fenced transition) is the caller's problem to re-read,
        // not a server fault.
        if (error instanceof GovernanceError && error.code === GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION) {
          return json({ error: error.message, code: error.code }, { status: 409 });
        }
        if (error instanceof StaleLeaseGenerationError) {
          return json({ error: error.message, code: GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION }, { status: 409 });
        }
        throw error;
      }
    }
  }

  return json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
}

function identityPayload(principal: ApiPrincipal): Record<string, unknown> {
  const safeKeyId = /^[A-Za-z0-9_-]{1,256}$/.test(principal.apiKeyId) ? principal.apiKeyId : undefined;
  const safeScopes = principal.scopes.length <= 32 && principal.scopes.every((scope) => scope.length <= 128 && /^(?:\*|[a-z][a-z0-9_-]*:(?:\*|[a-z][a-z0-9_-]*))$/.test(scope)) ? [...new Set(principal.scopes)] : undefined;
  return {
    user: { id: principal.userId, email: principal.email, role: principal.role },
    ...(safeKeyId && safeScopes ? { apiKey: { id: safeKeyId, scopes: safeScopes } } : {}),
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

/**
 * Metadata-only patch from a JSON body.
 *
 * Absent keys are absent, not null: spreading `{version: undefined}` over the current
 * record would erase the version on every PATCH that did not mention it.
 */
function skillPatch(body: Record<string, unknown>): Parameters<SkillsProductStore["updateSkill"]>[2] {
  const patch: Record<string, unknown> = {};
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.category === "string") patch.category = body.category;
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof body.version === "string") patch.version = body.version;
  if (typeof body.skillMd === "string") patch.skillMd = body.skillMd;
  if (body.kind === "executable" || body.kind === "instruction") patch.kind = body.kind;
  return patch;
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
  return pathname.split("/").filter(Boolean).map(decodeSegment);
}

/**
 * decodeURIComponent throws URIError on malformed input — a lone `%`, a truncated
 * `%2`, or an overlong UTF-8 sequence like `%c0%af`. This runs before the request
 * try/catch, so a throw here would surface as a 500 with a stack trace rather than a
 * clean rejection. A malformed segment is never a legitimate route, so keep it in its
 * raw (still-encoded) form: it then fails segmentEscapesPath (if it still carries `..`)
 * or the isValidSkillSlug guard (its `%` is not slug-shaped), yielding a 400/404.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A decoded path segment that must never reach a handler: one carrying a path separator
 * (`/` or `\`) or a `..` parent reference. After pathSegments() decodes, these can only
 * appear when a client percent-encoded them to slip past the split-on-'/' — i.e. a
 * traversal attempt. Legitimate segments (slugs, run ids, `skill.md`) contain none.
 */
function segmentEscapesPath(segment: string): boolean {
  return segment.includes("/") || segment.includes("\\") || segment.includes("..");
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
