import type { OwnedBytes } from "../lib/skill-bundle.js";
import type { ExecutionGrantStore } from "./execution-grant-store.js";
import type { SkillSelectionStore } from "./selection-store.js";

export const SERVER_RUN_STATUSES = [
  "queued",
  "waiting_for_approval",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "retrying",
  "expired",
  "refunded",
] as const;

export type ServerRunStatus = (typeof SERVER_RUN_STATUSES)[number];

/**
 * A fenced transition was refused because the run's lease_generation moved on.
 *
 * The worker that throws this is writing against a run it no longer owns: a
 * newer claim took it, or a cancellation fenced it. The run is not missing -
 * that is the null return - it has simply left the writer behind.
 */
export class StaleLeaseGenerationError extends Error {
  readonly runId: string;
  readonly expectedGeneration: number;
  readonly currentGeneration: number;
  readonly status: ServerRunStatus;

  constructor(runId: string, expectedGeneration: number, currentGeneration: number, status: ServerRunStatus) {
    super(
      `late transition rejected for run ${runId}: expected lease_generation ${expectedGeneration}, ` +
        `current ${currentGeneration} (status ${status})`,
    );
    this.name = "StaleLeaseGenerationError";
    this.runId = runId;
    this.expectedGeneration = expectedGeneration;
    this.currentGeneration = currentGeneration;
    this.status = status;
  }
}

/**
 * A publish or update was refused because it would silently overwrite a newer revision.
 *
 * The optimistic-concurrency guard (todos d061fcda): a write to an existing, live row
 * must carry If-Match naming the current revision_id (the ETag the server issued). A
 * missing guard, or one naming a different revision, is refused with this error instead
 * of being applied. `currentRevisionId` is null when the row is absent or tombstoned —
 * those are the two cases where the guard does not apply — and carries the live
 * revision otherwise, so the caller can name what the writer was racing against.
 */
export class SkillRevisionConflictError extends Error {
  readonly slug: string;
  readonly expectedRevisionId: string | null | undefined;
  readonly currentRevisionId: string | null;

  constructor(slug: string, expectedRevisionId: string | null | undefined, currentRevisionId: string | null) {
    super(
      `revision conflict for '${slug}': expected revision ${expectedRevisionId ?? "(none)"}, ` +
        `current is ${currentRevisionId ?? "(none)"}. Refused rather than silently overwriting a newer revision.`,
    );
    this.name = "SkillRevisionConflictError";
    this.slug = slug;
    this.expectedRevisionId = expectedRevisionId;
    this.currentRevisionId = currentRevisionId;
  }
}

/**
 * A publish was refused because (org, slug, version) already exists with a DIFFERENT bundle
 * digest. Versions are immutable (hasna/apps#1630): the same digest is idempotent, a new
 * digest needs a new version. Carries the stored digest so the client can say which.
 */
export class SkillVersionExistsError extends Error {
  constructor(
    readonly slug: string,
    readonly version: string,
    readonly existingSha256: string,
    readonly attemptedSha256: string,
  ) {
    super(
      `version conflict for '${slug}@${version}': already published with bundle ${existingSha256}, ` +
        `refusing to overwrite it with ${attemptedSha256}. Publish a new version instead.`,
    );
    this.name = "SkillVersionExistsError";
  }
}

export class SkillLifecycleConflictError extends Error {
  constructor(readonly slug: string, readonly profiles: string[]) {
    super(`cannot archive '${slug}' while active profiles reference it: ${profiles.join(", ")}`);
    this.name = "SkillLifecycleConflictError";
  }
}

export interface ApiPrincipal {
  apiKeyId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  userId: string;
  email: string;
  role: string;
  scopes: string[];
}

export type ApiKeyScopeUpdateResult =
  | { kind: "updated"; scopes: string[] }
  | { kind: "not_found" }
  | { kind: "stale"; scopes: string[] };

/**
 * A maintenance task's provenance is deliberately separate from ApiPrincipal.
 * An ECS task is not a user and must never be represented by impersonating an
 * API key, user id, or role in the audit row.
 */
export interface OperatorScopeEnrollmentInput {
  keyId: string;
  stationId: string;
  orgId: string;
  expectedScopes: string[];
  operationId: string;
  manifestDigest: string;
  operatorJobId: string;
  operatorTaskArn: string;
}

export function validOperatorScopeEnrollmentInput(input: OperatorScopeEnrollmentInput): boolean {
  const bounded = (value: string, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  return bounded(input.keyId) && bounded(input.stationId) && bounded(input.orgId) && bounded(input.operationId) && bounded(input.manifestDigest, 64) && /^[a-f0-9]{64}$/.test(input.manifestDigest) && bounded(input.operatorJobId) && bounded(input.operatorTaskArn, 512) && input.expectedScopes.length > 0 && input.expectedScopes.length <= 32 && input.expectedScopes.every((scope) => bounded(scope, 128) && /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope));
}

export function validOperatorScopeList(scopes: unknown): scopes is string[] {
  return Array.isArray(scopes) && scopes.length <= 32 && scopes.every((scope) => typeof scope === "string" && scope.length > 0 && scope.length <= 128 && /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope));
}

export type OperatorScopeEnrollmentResult =
  | { kind: "updated"; scopes: string[] }
  | { kind: "already_applied"; scopes: string[] }
  | { kind: "not_found" }
  | { kind: "target_mismatch" }
  | { kind: "invalid" }
  | { kind: "stale"; scopes: string[] };

export type OperatorScopeTargetSnapshot =
  | { kind: "not_found" }
  | { kind: "target_mismatch" }
  | { kind: "found"; scopes: string[] };

export interface ServerRunRecord {
  id: string;
  orgId: string;
  userId: string;
  skill: string;
  requestedSlug: string;
  status: ServerRunStatus;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
  correlationId: string;
  costCents: number;
  /**
   * The cancellation fence. Bumped by every claim and by every cancellation; a
   * worker that transitions a run while carrying an older generation is writing
   * against a run it no longer owns and is rejected (see transitionRun).
   */
  leaseGeneration: number;
  outputType?: string;
  outputPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ServerRunLog {
  runId: string;
  sequence: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface ServerArtifact {
  id: string;
  runId: string;
  orgId: string;
  fileName: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageKind: "db" | "s3";
  storageKey?: string;
  bodyText?: string;
  /**
   * Output visibility. Runs' outputs are PRIVATE by default: the value is set at
   * write time from the governance default and persisted, never inferred at read
   * time. "public" is the explicit opt-in for artifacts the tenant intends to
   * share; it is not a default on any path.
   */
  visibility: "private" | "public";
  /**
   * Finite retention, set at write time as createdAt + configured TTL. Absent
   * only when the writing path opted out explicitly; the expiry sweep deletes
   * artifacts whose expiresAt is in the past and records a deletion receipt.
   */
  expiresAt?: string;
  createdAt: string;
}

/** Where bytes actually live. Same vocabulary as ServerArtifact, same meaning. */
export type BlobStorageKind = "db" | "s3";

/**
 * A skill published to this instance by one organization.
 *
 * Distinct from `SkillMeta` (src/lib/registry-types.ts), which describes a skill the CLI
 * knows about from any source. This is the row: it always belongs to an org, and it
 * always carries the provenance of who put it there.
 */
export interface ServerSkillRecord {
  orgId: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  kind: "executable" | "instruction";
  version?: string;
  /** The agent-facing document, served verbatim by GET /skills/:slug/skill.md. */
  skillMd?: string;
  /** Digest of the stored bundle. Absent for a metadata-only publish. */
  bundleSha256?: string;
  bundleByteSize?: number;
  publishedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Immutable content-addressed revision identity (sha-256 over the published content,
   * computed in server/revision.ts). Same content -> same id; any content change mints
   * a new one. This is the ETag every read issues and every guarded write must match.
   */
  revisionId: string;
  /**
   * Monotonic per-slug write counter. Every publish and every metadata update bumps it,
   * even when the content hash is unchanged, so "how many writes happened to this slug"
   * is a number, not a digest comparison.
   */
  revisionNumber: number;
  /**
   * Present when the slug was deleted within the tombstone window (todos d061fcda).
   * Reads must answer 410 with the marker so a client's pull can reconcile; the row and
   * its bundle are purged once tombstonePurgeAfter passes. A re-publish clears both
   * fields and revives the slug as a fresh revision.
   */
  tombstonedAt?: string;
  tombstonePurgeAfter?: string;
  /** Changes on lifecycle breaks, not ordinary immutable-version publication. */
  authorizationEpoch?: string;
  /** Catalog lifecycle state. Archived rows retain versions and bundles for explicit reads. */
  lifecycle: "active" | "archived";
  archivedAt?: string;
  archiveReason?: string;
  replacementSlug?: string;
}

export interface SkillLifecyclePatch {
  lifecycle: "active" | "archived";
  reason?: string;
  replacementSlug?: string;
}

/**
 * Bundle bytes, addressed by their own digest.
 *
 * `bytes` is present only when the bundle is stored in the database (`storageKind: "db"`).
 * For S3 the row is a pointer and SkillBundleStorage.read() fetches the object - the same
 * split ServerArtifact makes between `bodyText` and `storageKey`, except that a bundle is
 * a gzipped tar and so cannot be a string at any layer.
 */
/**
 * A skill the principal pinned on the hosted instance.
 *
 * The cloud-side twin of the local `.skills/project.json` pin: metadata-only,
 * never content. `principal` is the api_keys.id of the API key that pinned
 * (ApiPrincipal.apiKeyId) - a pin is a fact about a specific principal's
 * selection, and two API keys in one org each have their own pin set.
 */
export interface ServerPin {
  orgId: string;
  principal: string;
  slug: string;
  pinnedAt: string;
  metadata: Record<string, unknown>;
}

export interface ServerSkillBundle {
  orgId: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  storageKind: BlobStorageKind;
  storageKey?: string;
  bytes?: OwnedBytes;
  createdAt: string;
}

/**
 * One immutable published version of a skill (hasna/apps#1630). The registry row is the
 * mutable "current" pointer; these rows are the history: each (org, slug, version) exactly once,
 * pointing at a content-addressed bundle that orphan collection must keep alive.
 */
export interface ServerSkillVersion {
  orgId: string;
  slug: string;
  version: string;
  bundleSha256: string;
  bundleByteSize: number;
  storageKind: BlobStorageKind;
  storageKey?: string;
  /** Files (path -> sha256), byte counts and provenance the publisher sent; never secret. */
  manifest: Record<string, unknown>;
  publishedByUserId?: string;
  createdAt: string;
}

/** Exact version lookup, independent of the registry's mutable current version. */
export interface PublishedSkillSelection {
  slug: string;
  version: string;
}

/** Metadata only: bundle availability means its tenant-owned storage row exists. */
export interface PublishedSkillSelectionState extends PublishedSkillSelection {
  current: Pick<ServerSkillRecord, "lifecycle" | "tombstonedAt" | "authorizationEpoch"> | null;
  versionBundleSha256: string | null;
  bundleAvailable: boolean;
}

export interface PublishSkillInput {
  /** Internal boot-seed precondition: never revive or replace non-bundled records. */
  seedBundledOnly?: true;
  principal: ApiPrincipal;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  kind: ServerSkillRecord["kind"];
  version?: string;
  skillMd?: string;
  /** Omitted for a metadata-only publish or update. */
  bundle?: Omit<ServerSkillBundle, "orgId" | "createdAt">;
  /**
   * Publisher-supplied version manifest (file digests, provenance). Stored verbatim on the
   * version row when `version` is set; ignored otherwise.
   */
  versionManifest?: Record<string, unknown>;
  /** Version-addressed object key the API wrote (S3 mode); recorded on the version row. */
  versionStorage?: { storageKind: BlobStorageKind; storageKey?: string };
  /**
   * Optimistic-concurrency guard (todos d061fcda): the revision_id (ETag) the writer
   * read. A publish against an existing, LIVE row requires the guard to name that row's
   * current revision_id; missing or mismatched is a SkillRevisionConflictError, never a
   * silent overwrite. The guard is not required for a first publish (no row exists) or
   * against a tombstoned row (nothing live to overwrite - the publish revives the slug
   * as a fresh revision).
   */
  expectedRevisionId?: string;
}

/** Metadata-only patch. Never touches the bundle; republish to change bytes. */
export type UpdateSkillPatch = Partial<
  Pick<ServerSkillRecord, "displayName" | "description" | "category" | "tags" | "version" | "kind" | "skillMd">
>;

export interface CreateRunInput {
  principal: ApiPrincipal;
  slug: string;
  input: Record<string, unknown>;
  args: string[];
  idempotencyKey?: string;
}

export interface ClaimRunInput {
  workerId: string;
}

/**
 * Fields a fenced transition may write, plus the lease_generation the fence
 * itself bumps on cancellation. Everything updateRun can write plus the
 * generation counter; the worker never patches the generation, the cancel
 * service does.
 */
export type RunTransitionPatch = Partial<
  Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt" | "leaseGeneration">
>;

/**
 * What a store is, in the only two dimensions the server needs at boot: which backend
 * it is (for logs and diagnostics) and whether it survives a restart.
 *
 * `durable` exists because the server used to boot onto an in-process Map, report
 * `ok: true` at /health, and lose every run on restart with no warning at any point. A
 * store that knows it is non-durable can now say so, and startSkillsServer() refuses it
 * unless the operator explicitly opted in.
 */
export interface StoreBackendInfo {
  /**
   * The three bundled backends are named for autocomplete; the open `string` arm is
   * deliberate. This interface is a published seam, and a third-party store must be able
   * to declare what it is - "mysql", "dynamodb" - without either a type error or having
   * to misreport itself as one of ours. A closed union would make the seam implementable
   * only by us, which is the test R3 sets for it.
   */
  kind: "postgres" | "sqlite" | "memory" | (string & {});
  /** False when the data does not survive process exit. */
  durable: boolean;
  /** Credential-free description, safe to put in logs and error messages. */
  label: string;
}

export interface SkillsProductStore {
  /**
   * Optional so a third-party store implementing this seam keeps compiling. An
   * undeclared backend is treated as durable: we can refuse what a store tells us is
   * ephemeral, and cannot infer it about somebody else's implementation. The hazard
   * actually being closed is our own default, which is now SQLite on disk.
   */
  readonly backend?: StoreBackendInfo;
  /** Optional for third-party stores; profile APIs fail closed when absent. */
  readonly selectionStore?: SkillSelectionStore;
  readonly executionGrantStore?: ExecutionGrantStore;
  /** Release connections and file handles. Optional; not every backend holds any. */
  close?(): Promise<void>;
  /**
   * Prove the backend is actually reachable, throwing if it is not.
   *
   * Called once at startup. Bun's SQL client connects lazily, so without this a
   * Postgres URL pointing at a dead host produced a server that started happily and
   * then 500ed on the first request.
   */
  verifyConnectivity?(): Promise<void>;
  authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null>;
  /** Guarded metadata-only scope admission for an existing key. */
  updateApiKeyScopes?(
    actor: ApiPrincipal,
    keyId: string,
    expectedScopes: string[],
    addScopes: string[],
  ): Promise<ApiKeyScopeUpdateResult>;
  /** Add only skills:publish to an existing key from a protected maintenance task. */
  enrollPublishScopeByOperator?(
    input: OperatorScopeEnrollmentInput,
  ): Promise<OperatorScopeEnrollmentResult>;
  inspectOperatorScopeTarget?(keyId: string, orgId: string): Promise<OperatorScopeTargetSnapshot>;
  ensureBootstrapApiKey?(token: string, principal?: Partial<ApiPrincipal>): Promise<void>;
  createRun(input: CreateRunInput): Promise<ServerRunRecord>;
  listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]>;
  getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
  claimNextRun(input: ClaimRunInput): Promise<ServerRunRecord | null>;
  updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null>;
  /**
   * Generation-fenced transition, the cancellation gate.
   *
   * Optional so a third-party store implementing this seam keeps compiling; the
   * cancel service requires it and refuses to run without it (FENCING_UNSUPPORTED)
   * rather than cancelling unfenced. When present it is the ONLY transition the
   * worker paths use: the UPDATE re-asserts `lease_generation = <expected>` and
   * reports zero rows when the generation moved on (a newer claim, or a
   * cancellation), so a late write from a stale worker never lands.
   *
   * Returns null when the run does not exist; throws StaleLeaseGenerationError
   * when the generation no longer matches. The distinction matters: "nothing
   * there" and "you lost the fence" are different facts.
   */
  transitionRun?(runId: string, patch: RunTransitionPatch, expectedGeneration: number): Promise<ServerRunRecord | null>;
  appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog>;
  listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]>;
  addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact>;
  listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]>;
  getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null>;

  /*
   * Published skills.
   *
   * Required rather than optional, unlike the lifecycle hooks above. A store that
   * silently cannot persist a skill would give `skills push` a 2xx and lose the upload,
   * and there is no safe default behaviour to fall back to. Every read here takes a
   * principal and is scoped to its org, exactly as the run reads are: a private team
   * skill visible to another tenant is the failure this whole surface has to not have.
   */
  publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord>;
  listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]>;
  getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null>;
  /**
   * Metadata-only patch, guarded by the same optimistic concurrency as publish: the
   * row's current revision_id must match `expectedRevisionId` or
   * SkillRevisionConflictError is thrown (409), never a silent overwrite. The revision
   * advances on every successful update (new content sha, number + 1). Returns null
   * when the org has no skill by that slug, or when the row is tombstoned.
   */
  updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch, expectedRevisionId?: string): Promise<ServerSkillRecord | null>;
  setSkillLifecycle(principal: ApiPrincipal, slug: string, patch: SkillLifecyclePatch, expectedRevisionId?: string): Promise<ServerSkillRecord | null>;
  /**
   * Tombstone a skill instead of hard-deleting it (todos d061fcda): the row is stamped
   * tombstoned_at + tombstone_purge_after (now + tombstoneWindowMs) and kept, so reads
   * can answer 410 with the marker and a pulling client can reconcile, and the bundle
   * survives until the purge. Returns the tombstoned record, or null when the org has
   * no row by that slug. A second delete of an already-tombstoned slug returns the
   * existing tombstone (idempotent; the window is not extended).
   */
  deleteSkill(principal: ApiPrincipal, slug: string, tombstoneWindowMs: number): Promise<ServerSkillRecord | null>;
  /**
   * Drop every tombstoned row whose window has expired, collecting the bundles nothing
   * (live or tombstoned) references. Called on the read paths and by listSkills so the
   * purge is lazy but does not wait for a slug to be read. Returns the purged records so
   * the caller can discard their stored objects (S3).
   */
  purgeExpiredTombstones(principal: ApiPrincipal): Promise<ServerSkillRecord[]>;
  getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null>;
  /** Every published version of a slug, newest first (hasna/apps#1630). */
  listSkillVersions(principal: ApiPrincipal, slug: string): Promise<ServerSkillVersion[]>;
  getSkillVersion(principal: ApiPrincipal, slug: string, version: string): Promise<ServerSkillVersion | null>;
  /**
   * Read at most MAX_PROFILE_SELECTIONS exact selections in one database snapshot,
   * scoped to the principal's org at every join. Returns one row per input in input
   * order, including missing selections and duplicates. Never reads bundle bytes or
   * substitutes the latest version; callers retain lifecycle/digest error policy.
   */
  getPublishedSelectionStates(principal: ApiPrincipal, selections: readonly PublishedSkillSelection[]): Promise<PublishedSkillSelectionState[]>;

  /*
   * Pins.
   *
   * Required rather than optional, for the same reason publishSkill is: a store
   * that silently cannot persist a pin would hand PUT /api/v1/pins/:slug a 2xx
   * and lose the selection - the client would believe the cloud remembers what
   * it pinned when it does not. Every read takes a principal and is scoped to
   * (org, principal), so one tenant's pin set is never another's.
   */
  pinSkill(principal: ApiPrincipal, slug: string, metadata?: Record<string, unknown>): Promise<ServerPin>;
  /** False when this principal has no pin by that slug. */
  unpinSkill(principal: ApiPrincipal, slug: string): Promise<boolean>;
  listPins(principal: ApiPrincipal): Promise<ServerPin[]>;

  /*
   * Tag surface (T7).
   *
   * Distinct tags across the org's published skills, the published skills
   * carrying an exact tag, and the principal's pins whose published skill
   * carries it. These are the store half of the hosted tag routes, and every
   * query runs against the skills_tags projection (migration 0005) whose
   * (org_id, tag) index makes the membership lookup an indexed read in both
   * dialects; the app layer merges the result with the bundled corpus the way
   * it does for every other registry read. Tags match exactly - the value as
   * stored - so the tag list returned by listTags() is the vocabulary callers
   * can filter with.
   */
  listTags(principal: ApiPrincipal): Promise<string[]>;
  listSkillsByTag(principal: ApiPrincipal, tag: string): Promise<ServerSkillRecord[]>;
  listPinsByTag(principal: ApiPrincipal, tag: string): Promise<ServerPin[]>;
  /**
   * The slugs of the org's live (non-tombstoned) published skills. The tag
   * routes use this to resolve merged-view precedence: a bundled skill whose
   * slug a published row occupies must not resurface under a tag filter or in
   * the tag list. A single-column scan of the (org_id, slug) primary key.
   */
  listPublishedSlugs(principal: ApiPrincipal): Promise<string[]>;
}
