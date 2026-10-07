import { MemoryExecutionGrantStore, PostgresExecutionGrantStore } from "./execution-grant-store.js";
import { randomUUID } from "node:crypto";
import { MemorySkillSelectionStore, PostgresSkillSelectionStore } from "./selection-store.js";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  PublishSkillInput,
  PublishedSkillSelection,
  PublishedSkillSelectionState,
  RunTransitionPatch,
  ServerArtifact,
  ServerPin,
  ServerRunLog,
  ServerRunRecord,
  ServerSkillBundle,
  ServerSkillRecord,
  ServerSkillVersion,
  ApiKeyScopeUpdateResult,
  OperatorScopeEnrollmentInput,
  OperatorScopeEnrollmentResult,
  OperatorScopeTargetSnapshot,
  SkillsProductStore,
  StoreBackendInfo,
  UpdateSkillPatch,
} from "./types.js";
import { SkillLifecycleConflictError, SkillRevisionConflictError, SkillVersionExistsError, StaleLeaseGenerationError, type SkillLifecyclePatch } from "./types.js";
import { hashApiKey, publicPrincipal } from "./auth.js";
import { resolveDatabaseTarget, type DatabaseTarget } from "./database-url.js";
import { artifactId, nowIso, normalizeLimit, rowToArtifact, rowToLog, rowToPin, rowToRun, rowToSkill, rowToSkillBundle, rowToSkillVersion, rowToPublishedSelectionState, parseJsonArray, runId } from "./rows.js";
import { MAX_PROFILE_SELECTIONS } from "../lib/profile-limits.js";
import { revisionIdOfRecord, type RevisionContent } from "../lib/revision.js";
import { SqliteSkillsStore, type SqliteStoreOptions } from "./sqlite-store.js";
import { validOperatorScopeEnrollmentInput } from "./types.js";

/**
 * The content fields a revision id is computed over, resolved from a publish input
 * (with the carried-forward bundle, so a metadata-only re-publish hashes the same
 * content the row will hold).
 */
function recordFieldsOf(input: PublishSkillInput, carriedBundle: { bundleSha256?: string; bundleByteSize?: number }, carriedSkillMd?: string): RevisionContent {
  return {
    slug: input.slug,
    displayName: input.displayName,
    description: input.description,
    category: input.category,
    tags: input.tags,
    source: input.source,
    kind: input.kind,
    ...(input.version ? { version: input.version } : {}),
    ...(carriedSkillMd ? { skillMd: carriedSkillMd } : {}),
    bundleSha256: input.bundle?.sha256 ?? carriedBundle.bundleSha256,
    bundleByteSize: input.bundle?.byteSize ?? carriedBundle.bundleByteSize,
  };
}

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe(query: string): Promise<Record<string, unknown>[]>;
  /**
   * Run a callback against one reserved connection inside a transaction.
   *
   * Declared rather than reached for via `unsafe("BEGIN")`. This store's client is
   * pooled (resolvePoolMax(), 4 by default), so `unsafe("BEGIN")` opens a transaction on
   * whichever connection the pool happened to hand out and the statements that follow
   * are free to land on the other three - a "transaction" that wraps nothing and commits
   * nothing, silently. migrate.ts gets away with the bare form only because it
   * constructs its client with `max: 1`.
   */
  begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
  close?: () => Promise<void>;
};

function resolvePoolMax(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.HASNA_SKILLS_DATABASE_POOL_MAX || env.SKILLS_DATABASE_POOL_MAX || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

/**
 * Bounded retries for a log sequence lost to a concurrent writer. Generous, because each
 * retry only loses when another writer wins, and a run producing many simultaneous log
 * lines is exactly when losing one matters least and dropping the run matters most.
 */
const LOG_SEQUENCE_ATTEMPTS = 12;

export function createArtifactId(): string {
  return artifactId();
}

export interface StoreOptions {
  databaseUrl?: string;
  bootstrapApiKey?: string;
  /** SQLite tuning, forwarded when the resolved target is SQLite. */
  sqlite?: SqliteStoreOptions;
}

/**
 * Build the store an operator's configuration asks for.
 *
 * The old body was `options.databaseUrl ? Postgres : Memory`, which meant that the
 * single most common way to start this server - run it with nothing set - produced a
 * process that looked healthy and forgot everything on restart. There is no longer any
 * input that yields a non-durable store by accident:
 *
 *   - a postgres:// URL         -> Postgres, and a failure to reach it is fatal here
 *   - a sqlite path / file: URL -> SQLite at that path, migrated on open
 *   - nothing at all            -> SQLite at ~/.hasna/skills/server.db, migrated on open
 *   - "memory:" or ":memory:"   -> non-durable, and only because it was named
 *   - anything else             -> throws, naming what is supported
 */
export async function createStore(options: StoreOptions = {}): Promise<SkillsProductStore> {
  const target = resolveDatabaseTarget(options.databaseUrl);
  const store = instantiateStore(target, options.sqlite);
  await store.verifyConnectivity?.();
  if (options.bootstrapApiKey && store.ensureBootstrapApiKey) {
    await store.ensureBootstrapApiKey(options.bootstrapApiKey);
  }
  return store;
}

export type OperatorScopeMaintenanceStore = Required<Pick<SkillsProductStore,
  "inspectOperatorScopeTarget" | "enrollPublishScopeByOperator" | "close">>;

/** Open only the existing scope-maintenance surface; never initialize or backfill the application store. */
export function openOperatorScopeMaintenance(databaseUrl: string): OperatorScopeMaintenanceStore {
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new Error("maintenance requires an explicit Postgres database");
  }
  const store = new PostgresSkillsStore(databaseUrl, {
    max: 1, connectionTimeout: 5, idleTimeout: 5,
    connection: { statement_timeout: "5s", lock_timeout: "1s" },
  });
  return {
    inspectOperatorScopeTarget: (keyId, orgId) => store.inspectOperatorScopeTarget(keyId, orgId),
    enrollPublishScopeByOperator: (input) => store.enrollPublishScopeByOperator(input),
    close: () => store.close(),
  };
}

function instantiateStore(target: DatabaseTarget, sqliteOptions?: SqliteStoreOptions): SkillsProductStore {
  switch (target.kind) {
    case "postgres":
      return new PostgresSkillsStore(target.url);
    case "sqlite":
      return new SqliteSkillsStore(target.path, sqliteOptions);
    case "memory":
      return new MemorySkillsStore();
  }
}

export class MemorySkillsStore implements SkillsProductStore {
  readonly selectionStore = new MemorySkillSelectionStore();
  readonly executionGrantStore = new MemoryExecutionGrantStore();
  readonly backend: StoreBackendInfo = { kind: "memory", durable: false, label: "memory (non-durable)" };
  private apiKeys = new Map<string, ApiPrincipal>();
  private runs = new Map<string, ServerRunRecord>();
  private logs = new Map<string, ServerRunLog[]>();
  private artifacts = new Map<string, ServerArtifact[]>();
  private idempotency = new Map<string, string>();
  private skills = new Map<string, ServerSkillRecord>();
  private bundles = new Map<string, ServerSkillBundle>();
  private versions = new Map<string, ServerSkillVersion>();
  private pins = new Map<string, ServerPin>();
  private operatorEnrollments = new Map<string, { keyId: string; manifestDigest: string }>();

  constructor(apiKeys: Array<{ token: string; principal?: Partial<ApiPrincipal> }> = []) {
    for (const key of apiKeys) this.addApiKey(key.token, key.principal);
  }

  addApiKey(token: string, principal?: Partial<ApiPrincipal>): ApiPrincipal {
    const resolved = publicPrincipal(principal);
    this.apiKeys.set(hashApiKey(token), resolved);
    return resolved;
  }

  async ensureBootstrapApiKey(token: string, principal?: Partial<ApiPrincipal>): Promise<void> {
    this.addApiKey(token, principal);
  }

  async authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null> {
    return this.apiKeys.get(hash) ?? null;
  }

  async updateApiKeyScopes(actor: ApiPrincipal, keyId: string, expectedScopes: string[], addScopes: string[]): Promise<ApiKeyScopeUpdateResult> {
    for (const [hash, target] of this.apiKeys) {
      if (target.apiKeyId !== keyId || target.orgId !== actor.orgId) continue;
      if (target.scopes.length !== expectedScopes.length || target.scopes.some((scope, index) => scope !== expectedScopes[index])) {
        return { kind: "stale", scopes: [...target.scopes] };
      }
      const scopes = [...target.scopes, ...addScopes.filter((scope) => !target.scopes.includes(scope))];
      const updated = { ...target, scopes };
      this.apiKeys.set(hash, updated);
      return { kind: "updated", scopes };
    }
    return { kind: "not_found" };
  }

  async enrollPublishScopeByOperator(input: OperatorScopeEnrollmentInput): Promise<OperatorScopeEnrollmentResult> {
    if (!validOperatorScopeEnrollmentInput(input)) return { kind: "invalid" };
    const previous = this.operatorEnrollments.get(input.operationId);
    if (previous) {
      if (previous.keyId !== input.keyId || previous.manifestDigest !== input.manifestDigest) return { kind: "target_mismatch" };
      for (const target of this.apiKeys.values()) {
        if (target.apiKeyId === input.keyId && target.orgId === input.orgId && target.scopes.includes("skills:publish")) {
          return { kind: "already_applied", scopes: [...target.scopes] };
        }
      }
      return { kind: "stale", scopes: [] };
    }
    for (const [hash, target] of this.apiKeys) {
      if (target.apiKeyId !== input.keyId || target.orgId !== input.orgId) continue;
      if (target.scopes.length !== input.expectedScopes.length || target.scopes.some((scope, index) => scope !== input.expectedScopes[index])) {
        return { kind: "stale", scopes: [...target.scopes] };
      }
      const scopes = target.scopes.includes("skills:publish") ? [...target.scopes] : [...target.scopes, "skills:publish"];
      this.apiKeys.set(hash, { ...target, scopes });
      this.operatorEnrollments.set(input.operationId, { keyId: input.keyId, manifestDigest: input.manifestDigest });
      return { kind: "updated", scopes };
    }
    return { kind: "not_found" };
  }

  async inspectOperatorScopeTarget(keyId: string, orgId: string): Promise<OperatorScopeTargetSnapshot> {
    for (const target of this.apiKeys.values()) {
      if (target.apiKeyId !== keyId) continue;
      return target.orgId === orgId ? { kind: "found", scopes: [...target.scopes] } : { kind: "target_mismatch" };
    }
    return { kind: "not_found" };
  }

  async createRun(input: CreateRunInput): Promise<ServerRunRecord> {
    const idemKey = input.idempotencyKey?.trim();
    const idemMapKey = idemKey ? `${input.principal.orgId}:${idemKey}` : undefined;
    if (idemMapKey) {
      const existing = this.idempotency.get(idemMapKey);
      if (existing) return this.runs.get(existing)!;
    }
    const now = nowIso();
    const run: ServerRunRecord = {
      id: runId(),
      orgId: input.principal.orgId,
      userId: input.principal.userId,
      skill: input.slug,
      requestedSlug: input.slug,
      status: "queued",
      input: input.input,
      args: input.args,
      ...(idemKey ? { idempotencyKey: idemKey } : {}),
      correlationId: randomUUID(),
      costCents: 0,
      leaseGeneration: 0,
      createdAt: now,
    };
    this.runs.set(run.id, run);
    this.logs.set(run.id, []);
    this.artifacts.set(run.id, []);
    if (idemMapKey) this.idempotency.set(idemMapKey, run.id);
    return run;
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    return Array.from(this.runs.values())
      .filter((run) => run.orgId === principal.orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      // Normalised like the SQL backends: Array#slice reads a negative end as an offset
      // from the tail, so `slice(0, -1)` silently dropped the newest run instead of
      // returning nothing.
      .slice(0, normalizeLimit(limit));
  }

  async getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const run = this.runs.get(runId);
    return run && run.orgId === principal.orgId ? run : null;
  }

  /**
   * Exclusive only by accident: nothing here takes a lock, and it is safe purely
   * because the read and the write happen in one synchronous turn of a single event
   * loop. That is not a claiming strategy, it is a property of there being exactly one
   * process and one Map. It is left as-is because this store is now explicitly
   * non-durable and test-only - the durable backends implement claiming properly
   * (Postgres via FOR UPDATE SKIP LOCKED, SQLite via BEGIN IMMEDIATE plus a conditional
   * claim by id). Do not use this as the model for a new backend.
   *
   * startedAt is preserved on re-claim to match both durable backends' COALESCE.
   */
  async claimNextRun(_input: ClaimRunInput): Promise<ServerRunRecord | null> {
    const run = Array.from(this.runs.values())
      .filter((candidate) => candidate.status === "queued" || candidate.status === "retrying")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!run) return null;
    return this.patchRun(run.id, { status: "running", startedAt: run.startedAt ?? nowIso(), leaseGeneration: run.leaseGeneration + 1 });
  }

  async updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null> {
    return this.patchRun(runId, patch);
  }

  /**
   * Fenced transition. The memory store's exclusivity is one event-loop turn,
   * which makes the read-then-check atomic by construction; the generation
   * predicate is still re-asserted so the semantics match the SQL backends.
   */
  async transitionRun(runId: string, patch: RunTransitionPatch, expectedGeneration: number): Promise<ServerRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (run.leaseGeneration !== expectedGeneration) {
      throw new StaleLeaseGenerationError(runId, expectedGeneration, run.leaseGeneration, run.status);
    }
    return this.patchRun(runId, patch);
  }

  async appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog> {
    const entries = this.logs.get(runId) ?? [];
    const log = { runId, sequence: entries.length + 1, level, message, createdAt: nowIso() };
    entries.push(log);
    this.logs.set(runId, entries);
    return log;
  }

  async listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]> {
    const run = await this.getRun(principal, runId);
    return run ? [...(this.logs.get(runId) ?? [])] : [];
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    const next = { ...artifact, createdAt: nowIso() };
    const artifacts = this.artifacts.get(artifact.runId) ?? [];
    artifacts.push(next);
    this.artifacts.set(artifact.runId, artifacts);
    return next;
  }
  async listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]> {
    const run = await this.getRun(principal, runId);
    return run ? [...(this.artifacts.get(runId) ?? [])] : [];
  }

  async getArtifact(principal: ApiPrincipal, runId: string, id: string): Promise<ServerArtifact | null> {
    const artifacts = await this.listArtifacts(principal, runId);
    return artifacts.find((artifact) => artifact.id === id) ?? null;
  }

  async publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord> {
    const key = skillKey(input.principal.orgId, input.slug);
    const now = nowIso();
    const previous = this.skills.get(key);
    if (input.seedBundledOnly && input.expectedRevisionId && !previous) {
      throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, null);
    }
    if (input.seedBundledOnly && previous && (previous.tombstonedAt || previous.source !== "bundled")) {
      throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, previous.revisionId);
    }
    // Optimistic concurrency, matching the SQL backends: a live existing row requires
    // If-Match naming its current revision. The memory store is single-threaded, so the
    // read-then-check is atomic by construction (same property the run claims rely on);
    // the SQL backends enforce the same guard in their upsert WHERE clause.
    if (previous && !previous.tombstonedAt && input.expectedRevisionId !== previous.revisionId) {
      throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, previous.revisionId);
    }
    // Immutable versions (hasna/apps#1630): the digest a version was first published with is
    // the digest it keeps. Checked before any write so a refused publish leaves nothing behind.
    const versionSha = input.bundle?.sha256 ?? previous?.bundleSha256;
    if (input.version && versionSha) {
      const existing = this.versions.get(versionKey(input.principal.orgId, input.slug, input.version));
      if (existing && existing.bundleSha256 !== versionSha) {
        throw new SkillVersionExistsError(input.slug, input.version, existing.bundleSha256, versionSha);
      }
    }
    if (input.bundle) {
      const bundleMapKey = skillKey(input.principal.orgId, input.bundle.sha256);
      // Overwrite rather than skip, matching the SQL backends' DO UPDATE: the digest
      // proves the bytes are the same, so the only thing a re-upload can carry that is
      // worth keeping is a corrected placement (db vs s3, and the key).
      this.bundles.set(bundleMapKey, {
        ...this.bundles.get(bundleMapKey),
        ...input.bundle,
        orgId: input.principal.orgId,
        createdAt: this.bundles.get(bundleMapKey)?.createdAt ?? now,
      });
    }
    const carriedBundle = !input.bundle && previous?.bundleSha256
      ? { bundleSha256: previous.bundleSha256, ...(previous.bundleByteSize === undefined ? {} : { bundleByteSize: previous.bundleByteSize }) }
      : {};
    // The document travels with the row the way the bundle does: a publish that omits
    // skillMd is a metadata update, not an instruction to discard the published
    // document. The effective document enters BOTH the record and the revision hash,
    // so the recorded revision keeps identifying the stored bytes.
    const carriedSkillMd = typeof input.skillMd === "string" ? input.skillMd : previous?.skillMd;
    const record: ServerSkillRecord = {
      orgId: input.principal.orgId,
      slug: input.slug,
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      tags: [...input.tags],
      source: input.source,
      kind: input.kind,
      ...(input.version ? { version: input.version } : {}),
      ...(carriedSkillMd ? { skillMd: carriedSkillMd } : {}),
      // Absent bundle means "unchanged", so the previous digest is carried forward -
      // the same COALESCE the SQL backends do.
      ...(input.bundle
        ? { bundleSha256: input.bundle.sha256, bundleByteSize: input.bundle.byteSize }
        : carriedBundle),
      publishedByUserId: input.principal.userId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      revisionId: revisionIdOfRecord(recordFieldsOf(input, carriedBundle, carriedSkillMd)),
      revisionNumber: (previous?.revisionNumber ?? 0) + 1,
      authorizationEpoch: previous?.authorizationEpoch ?? randomUUID().replaceAll("-", ""),
      lifecycle: previous?.lifecycle ?? "active",
      ...(previous?.archivedAt ? { archivedAt: previous.archivedAt } : {}),
      ...(previous?.archiveReason ? { archiveReason: previous.archiveReason } : {}),
      ...(previous?.replacementSlug ? { replacementSlug: previous.replacementSlug } : {}),
    };
    this.skills.set(key, record);
    if (input.version && versionSha && !this.versions.has(versionKey(input.principal.orgId, input.slug, input.version))) {
      this.versions.set(versionKey(input.principal.orgId, input.slug, input.version), {
        orgId: input.principal.orgId,
        slug: input.slug,
        version: input.version,
        bundleSha256: versionSha,
        bundleByteSize: input.bundle?.byteSize ?? previous?.bundleByteSize ?? 0,
        storageKind: input.versionStorage?.storageKind ?? "db",
        ...(input.versionStorage?.storageKey ? { storageKey: input.versionStorage.storageKey } : {}),
        manifest: { ...(input.versionManifest ?? {}) },
        ...(input.principal.userId ? { publishedByUserId: input.principal.userId } : {}),
        createdAt: now,
      });
    }
    if (previous?.bundleSha256 && input.bundle && previous.bundleSha256 !== input.bundle.sha256) {
      this.collectOrphanBundle(input.principal.orgId, previous.bundleSha256);
    }
    return record;
  }

  async listSkillVersions(principal: ApiPrincipal, slug: string): Promise<ServerSkillVersion[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.orgId === principal.orgId && v.slug === slug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version.localeCompare(a.version));
  }

  async getSkillVersion(principal: ApiPrincipal, slug: string, version: string): Promise<ServerSkillVersion | null> {
    const found = this.versions.get(versionKey(principal.orgId, slug, version));
    return found && found.orgId === principal.orgId ? found : null;
  }

  async getPublishedSelectionStates(principal: ApiPrincipal, selections: readonly PublishedSkillSelection[]): Promise<PublishedSkillSelectionState[]> {
    if (selections.length > MAX_PROFILE_SELECTIONS) throw new RangeError("Published selection lookup exceeds the profile selection limit");
    return selections.map(({ slug, version }) => {
      const current = this.skills.get(skillKey(principal.orgId, slug));
      const selectedVersion = this.versions.get(versionKey(principal.orgId, slug, version));
      const bundle = selectedVersion && this.bundles.get(skillKey(principal.orgId, selectedVersion.bundleSha256));
      return {
        slug, version,
        current: current?.orgId === principal.orgId ? {
          authorizationEpoch: current.authorizationEpoch,
          lifecycle: current.lifecycle,
          ...(current.tombstonedAt ? { tombstonedAt: current.tombstonedAt } : {}),
        } : null,
        versionBundleSha256: selectedVersion?.orgId === principal.orgId ? selectedVersion.bundleSha256 : null,
        bundleAvailable: bundle?.orgId === principal.orgId,
      };
    });
  }

  async listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    return Array.from(this.skills.values())
      .filter((skill) => skill.orgId === principal.orgId && !skill.tombstonedAt)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null> {
    const skill = this.skills.get(skillKey(principal.orgId, slug));
    return skill && skill.orgId === principal.orgId ? skill : null;
  }

  async setSkillLifecycle(principal: ApiPrincipal, slug: string, patch: SkillLifecyclePatch, expectedRevisionId?: string) {
    const current = await this.getSkill(principal, slug);
    if (!current || current.tombstonedAt) return null;
    if (expectedRevisionId !== current.revisionId) throw new SkillRevisionConflictError(slug, expectedRevisionId, current.revisionId);
    if (patch.lifecycle === "archived" && current.lifecycle !== "archived") {
      const profiles = await this.selectionStore.profilesReferencingSkill(principal, slug);
      if (profiles.length) throw new SkillLifecycleConflictError(slug, profiles);
    }
    const next: ServerSkillRecord = {
      ...current,
      authorizationEpoch: current.lifecycle === patch.lifecycle ? current.authorizationEpoch : randomUUID().replaceAll("-", ""),
      lifecycle: patch.lifecycle,
      updatedAt: nowIso(),
      revisionId: revisionIdOfRecord({ ...current, lifecycle: patch.lifecycle, archiveReason: patch.reason, replacementSlug: patch.replacementSlug }),
      revisionNumber: current.revisionNumber + 1,
      ...(patch.lifecycle === "archived" ? { archivedAt: current.archivedAt ?? nowIso(), ...(patch.reason ? { archiveReason: patch.reason } : {}), ...(patch.replacementSlug ? { replacementSlug: patch.replacementSlug } : {}) } : {}),
    };
    if (patch.lifecycle === "active") { delete next.archivedAt; delete next.archiveReason; delete next.replacementSlug; }
    this.skills.set(skillKey(principal.orgId, slug), next);
    return next;
  }

  async updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch, expectedRevisionId?: string): Promise<ServerSkillRecord | null> {
    const current = await this.getSkill(principal, slug);
    if (!current || current.tombstonedAt) return null;
    if (expectedRevisionId !== current.revisionId) {
      throw new SkillRevisionConflictError(slug, expectedRevisionId, current.revisionId);
    }
    // Between the read and the write the map can advance (a re-entrant concurrent
    // writer). The write is based on the LATEST row, and a stale guard is a 409 — the
    // same contract as the SQL backends' guarded UPDATE.
    const latest = this.skills.get(skillKey(principal.orgId, slug));
    if (!latest || latest.tombstonedAt) return null;
    if (latest.revisionId !== current.revisionId) {
      throw new SkillRevisionConflictError(slug, expectedRevisionId, latest.revisionId);
    }
    const next: ServerSkillRecord = {
      ...latest,
      ...patch,
      updatedAt: nowIso(),
      revisionId: revisionIdOfRecord({ ...latest, ...patch }),
      revisionNumber: latest.revisionNumber + 1,
    };
    this.skills.set(skillKey(principal.orgId, slug), next);
    return next;
  }

  async deleteSkill(principal: ApiPrincipal, slug: string, tombstoneWindowMs: number): Promise<ServerSkillRecord | null> {
    const current = await this.getSkill(principal, slug);
    if (!current) return null;
    if (!current.tombstonedAt) {
      const tombstoned = nowIso();
      const purgeAfter = new Date(Date.now() + tombstoneWindowMs).toISOString();
      const next = { ...current, authorizationEpoch: randomUUID().replaceAll("-", ""), tombstonedAt: tombstoned, tombstonePurgeAfter: purgeAfter, updatedAt: tombstoned };
      this.skills.set(skillKey(principal.orgId, slug), next);
      return next;
    }
    // Idempotent re-delete: the window is NOT extended; the original tombstone stands.
    return current;
  }

  async purgeExpiredTombstones(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    const now = nowIso();
    const purged: ServerSkillRecord[] = [];
    for (const [key, skill] of this.skills) {
      if (skill.orgId !== principal.orgId || !skill.tombstonedAt || !skill.tombstonePurgeAfter) continue;
      if (skill.tombstonePurgeAfter > now) continue;
      this.skills.delete(key);
      if (skill.bundleSha256) this.collectOrphanBundle(principal.orgId, skill.bundleSha256);
      purged.push(skill);
    }
    return purged;
  }

  async getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null> {
    const bundle = this.bundles.get(skillKey(principal.orgId, sha256));
    return bundle && bundle.orgId === principal.orgId ? bundle : null;
  }

  async pinSkill(principal: ApiPrincipal, slug: string, metadata: Record<string, unknown> = {}): Promise<ServerPin> {
    // Upsert, matching the SQL backends' ON CONFLICT DO UPDATE: re-pinning
    // refreshes pinned_at and replaces the metadata with what was sent.
    const pin: ServerPin = { orgId: principal.orgId, principal: principal.apiKeyId, slug, pinnedAt: nowIso(), metadata: { ...metadata } };
    this.pins.set(pinKey(principal.orgId, principal.apiKeyId, slug), pin);
    return pin;
  }

  async unpinSkill(principal: ApiPrincipal, slug: string): Promise<boolean> {
    return this.pins.delete(pinKey(principal.orgId, principal.apiKeyId, slug));
  }

  async listPins(principal: ApiPrincipal): Promise<ServerPin[]> {
    return Array.from(this.pins.values())
      .filter((pin) => pin.orgId === principal.orgId && pin.principal === principal.apiKeyId)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async listTags(principal: ApiPrincipal): Promise<string[]> {
    // Mirror the durable backends: expired tombstones are purged before the
    // read, and live tombstones keep their tags until purge (the projection
    // retains them), so the memory answer matches the SQL backends' exactly.
    await this.purgeExpiredTombstones(principal);
    const tags = new Set<string>();
    for (const skill of this.skills.values()) {
      if (skill.orgId !== principal.orgId || skill.lifecycle !== "active") continue;
      for (const tag of skill.tags) {
        if (tag.trim()) tags.add(tag);
      }
    }
    return [...tags].sort();
  }

  async listSkillsByTag(principal: ApiPrincipal, tag: string): Promise<ServerSkillRecord[]> {
    await this.purgeExpiredTombstones(principal);
    return Array.from(this.skills.values())
      .filter((skill) => skill.orgId === principal.orgId && !skill.tombstonedAt && skill.lifecycle === "active" && skill.tags.includes(tag))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async listPinsByTag(principal: ApiPrincipal, tag: string): Promise<ServerPin[]> {
    // The durable backends resolve this through the skills_tags projection;
    // the memory store has no tables, so the same predicate runs over its
    // maps. Behaviour parity is what the parity suite asserts.
    await this.purgeExpiredTombstones(principal);
    const taggedSlugs = new Set<string>();
    for (const skill of this.skills.values()) {
      if (skill.orgId === principal.orgId && !skill.tombstonedAt && skill.lifecycle === "active" && skill.tags.includes(tag)) taggedSlugs.add(skill.slug);
    }
    return Array.from(this.pins.values())
      .filter((pin) => pin.orgId === principal.orgId && pin.principal === principal.apiKeyId && taggedSlugs.has(pin.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async listPublishedSlugs(principal: ApiPrincipal): Promise<string[]> {
    return Array.from(this.skills.values())
      .filter((skill) => skill.orgId === principal.orgId && !skill.tombstonedAt)
      .map((skill) => skill.slug)
      .sort();
  }

  private collectOrphanBundle(orgId: string, sha256: string): void {
    const referenced = Array.from(this.skills.values()).some((skill) => skill.orgId === orgId && skill.bundleSha256 === sha256)
      || Array.from(this.versions.values()).some((v) => v.orgId === orgId && v.bundleSha256 === sha256);
    if (!referenced) this.bundles.delete(skillKey(orgId, sha256));
  }

  private patchRun(runId: string, patch: Partial<ServerRunRecord>): ServerRunRecord | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const next = { ...run, ...patch };
    this.runs.set(runId, next);
    return next;
  }
}

/**
 * Composite map key for the in-process store.
 *
 * Length-prefixed rather than joined on a separator. Any separator character can appear
 * in an org id supplied through ensureBootstrapApiKey(), and for an org-scoped map two
 * inputs collapsing to one key is a cross-tenant read, not a cosmetic collision: org
 * "a:b" + slug "c" and org "a" + slug "b:c" are the same string under a ":" join.
 * Prefixing the org id's length makes the split unambiguous with no byte excluded from
 * either field.
 *
 * A NUL separator would also be unambiguous and is deliberately not used: the first
 * version of this function used one, which made store.ts a binary file to git - `git
 * diff` refused to show it and every text-based scanner in scripts/release-guard.ts
 * skips it while still reporting the file as clean.
 */
function skillKey(orgId: string, slug: string): string {
  return `${orgId.length}:${orgId}:${slug}`;
}

/**
 * Composite map key for a pin: org + principal + slug, length-prefixed for the
 * same reason skillKey's org id is. Each variable-length field is prefixed with
 * its own length, so no combination of separators-in-field-values can collide:
 * org "a:b" + principal "c" + slug "d" and org "a" + principal "b:c" + slug "d"
 * are different keys. (Slug needs no prefix: everything before it is
 * length-delimited, so the first two fields split unambiguously and the rest of
 * the string is the slug.)
 */
function pinKey(orgId: string, principal: string, slug: string): string {
  return `${orgId.length}:${orgId}:${principal.length}:${principal}:${slug}`;
}

/** Composite map key for a version row, length-prefixed for the same reason pinKey is. */
function versionKey(orgId: string, slug: string, version: string): string {
  return `${orgId.length}:${orgId}:${slug.length}:${slug}:${version}`;
}

export class PostgresSkillsStore implements SkillsProductStore {
  get selectionStore() { return new PostgresSkillSelectionStore(this.sql); }
  get executionGrantStore() { return new PostgresExecutionGrantStore(this.sql); }
  readonly backend: StoreBackendInfo = { kind: "postgres", durable: true, label: "postgres" };
  private sql: SqlTag;

  constructor(databaseUrl: string, connectionOptions: {
    max?: number; connectionTimeout?: number; idleTimeout?: number; connection?: Record<string, string>;
  } = {}) {
    const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: typeof connectionOptions) => SqlTag };
    this.sql = new bunWithSql.SQL(databaseUrl, { max: resolvePoolMax(), ...connectionOptions });
  }

  /**
   * Bun's SQL client connects lazily, so constructing this store proves nothing about
   * the database being there. Without an explicit probe, a wrong host or a down
   * instance produced a server that started, answered /health with ok:true, and 500ed
   * on the first API call.
   *
   * The error deliberately carries no URL: a Postgres URL is a credential, the driver's
   * own messages sometimes echo it, and this string ends up in logs.
   */
  async verifyConnectivity(): Promise<void> {
    try {
      await this.sql`SELECT 1`;
    } catch (error) {
      throw new Error(
        "cannot reach the configured Postgres database. The server will not start with an unreachable " +
          "database rather than fall back to another backend and silently split your data across two stores. " +
          `Check HASNA_SKILLS_DATABASE_URL and that the instance is accepting connections. Driver reported: ${connectionFailureSummary(error)}`,
      );
    }

    // Reachable is not the same as usable, and `SELECT 1` only proves the former.
    //
    // SQLite migrates itself when the store opens it; Postgres does not, because
    // several replicas auto-migrating a shared database concurrently is not something
    // to do implicitly. That asymmetry means a Postgres deployment can be pointed at an
    // empty database, and without this check it produced exactly the symptom the block
    // above exists to prevent: /health answering ok:true and the first API call
    // returning 500 `relation "api_keys" does not exist`.
    try {
      await this.sql`SELECT 1 FROM api_keys LIMIT 0`;
    } catch (error) {
      throw new Error(
        "the configured Postgres database is reachable but has no skills schema. Run `skills-migrate` against it " +
          "before starting the server - unlike SQLite, Postgres is not migrated automatically, so that several " +
          `replicas cannot race to migrate a shared database. Driver reported: ${connectionFailureSummary(error)}`,
      );
    }
    await this.backfillLegacyRevisions();
  }

  /**
   * Give rows written before migration 0004 a real content revision id.
   *
   * The migration adds revision_id with DEFAULT '', which would make If-Match vacuous
   * for legacy rows (every stale client matches the same empty string). This replaces
   * the marker with a content sha, idempotently: new code always writes a full id, so
   * the marker never reappears and the sweep costs one index scan on later opens.
   */
  private async backfillLegacyRevisions(): Promise<void> {
    const rows = await this.sql`SELECT * FROM skills_registry WHERE revision_id = ${""}`;
    for (const row of rows) {
      const record = rowToSkill(row);
      await this.sql`UPDATE skills_registry SET revision_id = ${revisionIdOfRecord(record)} WHERE org_id = ${record.orgId} AND slug = ${record.slug}`;
    }
  }

  async close(): Promise<void> {
    await this.sql.close?.();
  }

  async ensureBootstrapApiKey(token: string, principal?: Partial<ApiPrincipal>): Promise<void> {
    const resolved = publicPrincipal(principal);
    await this.sql`
      INSERT INTO organizations (id, slug, name)
      VALUES (${resolved.orgId}, ${resolved.orgSlug}, ${resolved.orgName})
      ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name
    `;
    await this.sql`
      INSERT INTO users (id, email, name)
      VALUES (${resolved.userId}, ${resolved.email}, ${resolved.email})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
    `;
    await this.sql`
      INSERT INTO organization_members (org_id, user_id, role)
      VALUES (${resolved.orgId}, ${resolved.userId}, ${resolved.role})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    await this.sql`
      INSERT INTO api_keys (id, org_id, user_id, name, key_hash, scopes_json)
      VALUES (${resolved.apiKeyId}, ${resolved.orgId}, ${resolved.userId}, ${"bootstrap"}, ${hashApiKey(token)}, ${JSON.stringify(resolved.scopes)}::jsonb)
      ON CONFLICT (key_hash) DO NOTHING
    `;
  }

  async authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null> {
    const rows = await this.sql`
      SELECT k.id AS api_key_id, k.scopes_json, o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
             u.id AS user_id, u.email, m.role
      FROM api_keys k
      JOIN organizations o ON o.id = k.org_id
      JOIN users u ON u.id = k.user_id
      LEFT JOIN organization_members m ON m.org_id = k.org_id AND m.user_id = k.user_id
      WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await this.sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${String(row.api_key_id)}`;
    return {
      apiKeyId: String(row.api_key_id),
      orgId: String(row.org_id),
      orgSlug: String(row.org_slug),
      orgName: String(row.org_name),
      userId: String(row.user_id),
      email: String(row.email),
      role: typeof row.role === "string" ? row.role : "member",
      scopes: parseJsonArray(row.scopes_json),
    };
  }

  async updateApiKeyScopes(actor: ApiPrincipal, keyId: string, expectedScopes: string[], addScopes: string[]): Promise<ApiKeyScopeUpdateResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT scopes_json FROM api_keys
        WHERE id = ${keyId} AND org_id = ${actor.orgId} AND revoked_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return { kind: "not_found" };
      const current = parseJsonArray(row.scopes_json);
      if (current.length !== expectedScopes.length || current.some((scope, index) => scope !== expectedScopes[index])) {
        return { kind: "stale", scopes: current };
      }
      const updated = await this.casUpdateApiKeyScopes(tx, keyId, actor.orgId, expectedScopes, addScopes);
      if (!updated[0]) {
        const latest = await tx`SELECT scopes_json FROM api_keys WHERE id = ${keyId} AND org_id = ${actor.orgId} AND revoked_at IS NULL LIMIT 1`;
        return { kind: "stale", scopes: latest[0] ? parseJsonArray(latest[0].scopes_json) : current };
      }
      await tx`
        INSERT INTO skills_audit_events (org_id, user_id, api_key_id, action, target_type, target_id, metadata_json)
        VALUES (${actor.orgId}, ${actor.userId}, ${actor.apiKeyId}, ${"api_key_scopes_added"}, ${"api_key"}, ${keyId}, ${JSON.stringify({ added: addScopes, scopes: parseJsonArray(updated[0].scopes_json) })}::text::jsonb)
      `;
      return { kind: "updated", scopes: parseJsonArray(updated[0].scopes_json) };
    });
  }

  private async casUpdateApiKeyScopes(tx: SqlTag, keyId: string, orgId: string, expectedScopes: string[], addScopes: string[]): Promise<Record<string, unknown>[]> {
    const current = expectedScopes;
    const scopes = [...current, ...addScopes.filter((scope) => !current.includes(scope))];
    const expectedScopesJson = JSON.stringify(expectedScopes);
    return tx`
      UPDATE api_keys SET scopes_json = ${JSON.stringify(scopes)}::text::jsonb
      WHERE id = ${keyId} AND org_id = ${orgId} AND revoked_at IS NULL
        AND (scopes_json = ${expectedScopesJson}::text::jsonb
          OR scopes_json = to_jsonb(${expectedScopesJson}::text))
      RETURNING scopes_json
    `;
  }

  async enrollPublishScopeByOperator(input: OperatorScopeEnrollmentInput): Promise<OperatorScopeEnrollmentResult> {
    if (!validOperatorScopeEnrollmentInput(input)) return { kind: "invalid" };
    if (input.expectedScopes.includes("skills:publish")) return { kind: "stale", scopes: input.expectedScopes };
    return this.sql.begin(async (tx) => {
      const operation = await tx`
        SELECT org_id, target_id FROM skills_audit_events
        WHERE action = ${"api_key_scopes_added"} AND operator_operation_id = ${input.operationId}
        LIMIT 1
      `;
      if (operation[0] && (String(operation[0].org_id) !== input.orgId || String(operation[0].target_id) !== input.keyId)) return { kind: "target_mismatch" };
      const rows = await tx`
        SELECT id, org_id, name, scopes_json FROM api_keys
        WHERE id = ${input.keyId} AND revoked_at IS NULL
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return { kind: "not_found" };
      if (String(row.org_id) !== input.orgId) return { kind: "target_mismatch" };
      const current = parseJsonArray(row.scopes_json);
      const prior = await tx`
        SELECT metadata_json, metadata_json->>'target_manifest_digest' AS manifest_digest FROM skills_audit_events
        WHERE action = ${"api_key_scopes_added"} AND target_type = ${"api_key"} AND target_id = ${input.keyId}
          AND operator_operation_id = ${input.operationId}
        LIMIT 1
      `;
      if (prior[0]) {
        const priorMetadata = typeof prior[0].metadata_json === "string" ? JSON.parse(prior[0].metadata_json) as Record<string, unknown> : prior[0].metadata_json as Record<string, unknown>;
        const priorDigest = prior[0].manifest_digest ?? priorMetadata?.target_manifest_digest;
        if (String(priorDigest) !== input.manifestDigest) return { kind: "target_mismatch" };
        if (!current.includes("skills:publish")) return { kind: "stale", scopes: current };
        return { kind: "already_applied", scopes: current };
      }
      if (current.length !== input.expectedScopes.length || current.some((scope, index) => scope !== input.expectedScopes[index])) {
        return { kind: "stale", scopes: current };
      }
      const updated = await this.casUpdateApiKeyScopes(tx, input.keyId, input.orgId, input.expectedScopes, ["skills:publish"]);
      if (!updated[0]) return { kind: "stale", scopes: current };
      const scopes = parseJsonArray(updated[0].scopes_json);
      await tx`
        INSERT INTO skills_audit_events (org_id, user_id, api_key_id, action, target_type, target_id, operator_operation_id, metadata_json)
        VALUES (${input.orgId}, NULL, NULL, ${"api_key_scopes_added"}, ${"api_key"}, ${input.keyId}, ${input.operationId}, ${JSON.stringify({
          added: ["skills:publish"], scopes, operator_operation_id: input.operationId, operator_job_id: input.operatorJobId,
          operator_task_arn: input.operatorTaskArn, target_manifest_digest: input.manifestDigest, station_id: input.stationId,
        })}::text::jsonb)
      `;
      return { kind: "updated", scopes };
    });
  }

  async inspectOperatorScopeTarget(keyId: string, orgId: string): Promise<OperatorScopeTargetSnapshot> {
    const rows = await this.sql`SELECT org_id, scopes_json FROM api_keys WHERE id = ${keyId} AND revoked_at IS NULL LIMIT 1`;
    const row = rows[0];
    if (!row) return { kind: "not_found" };
    if (String(row.org_id) !== orgId) return { kind: "target_mismatch" };
    return { kind: "found", scopes: parseJsonArray(row.scopes_json) };
  }

  /**
   * Run a callback under an RLS tenant or worker context, on one pooled
   * connection, for the duration of one transaction only.
   *
   * Migration 0003 arms RLS on skills_runs and skills_artifacts: a statement
   * whose session has no `app.skills_org_id` and no `app.skills_claim_context`
   * sees zero rows. SET LOCAL (the `true` third argument) confines the setting
   * to this transaction, which is what keeps one pooled connection from
   * carrying tenant A's context into tenant B's next request - a session-wide
   * SET would be exactly the cross-tenant leak RLS exists to prevent.
   */
  private async withContext<T>(orgId: string | null, worker: boolean, fn: (tx: SqlTag) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.skills_org_id', ${orgId ?? ""}, true)`;
      await tx`SELECT set_config('app.skills_claim_context', ${worker ? "worker" : ""}, true)`;
      return await fn(tx);
    });
  }

  async createRun(input: CreateRunInput): Promise<ServerRunRecord> {
    // The idempotency pre-read must live inside the same RLS tenant transaction as
    // the INSERT. A pooled connection carries no context between requests, so a
    // bare-pool pre-read sees zero rows under the 0003 policy and a replay of an
    // existing key falls through to the INSERT, which then violates the partial
    // unique index skills_runs_org_idempotency_idx instead of returning the first
    // run. Both statements on `tx` keep the read and the write under one
    // transaction-local tenant context.
    return this.withContext(input.principal.orgId, false, async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx`
          SELECT * FROM skills_runs
          WHERE org_id = ${input.principal.orgId} AND idempotency_key = ${input.idempotencyKey}
          LIMIT 1
        `;
        if (existing[0]) return rowToRun(existing[0]);
      }
      const id = runId();
      const rows = await tx`
        INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, input_json, args_json, idempotency_key, correlation_id)
        VALUES (${id}, ${input.principal.orgId}, ${input.principal.userId}, ${input.slug}, ${input.slug}, ${"queued"}, ${JSON.stringify(input.input)}::jsonb, ${JSON.stringify(input.args)}::jsonb, ${input.idempotencyKey ?? null}, ${randomUUID()})
        RETURNING *
      `;
      return rowToRun(rows[0]);
    });
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    return this.withContext(principal.orgId, false, async (tx) => {
      const rows = await tx`
        SELECT * FROM skills_runs WHERE org_id = ${principal.orgId}
        ORDER BY created_at DESC LIMIT ${normalizeLimit(limit)}
      `;
      return rows.map(rowToRun);
    });
  }

  async getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    return this.withContext(principal.orgId, false, async (tx) => {
      const rows = await tx`
        SELECT * FROM skills_runs WHERE id = ${runId} AND org_id = ${principal.orgId} LIMIT 1
      `;
      return rows[0] ? rowToRun(rows[0]) : null;
    });
  }

  async claimNextRun(input: ClaimRunInput): Promise<ServerRunRecord | null> {
    // The claim path is the deliberate cross-tenant exception (a worker serves
    // every org), so it runs under the claim context, not a tenant context.
    return this.withContext(null, true, async (tx) => {
      const rows = await tx`
        UPDATE skills_runs
        SET status = ${"running"}, started_at = COALESCE(started_at, now()), locked_by = ${input.workerId}, locked_at = now(),
            lease_generation = lease_generation + 1
        WHERE id = (
          SELECT id FROM skills_runs
          WHERE status IN (${"queued"}, ${"retrying"})
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `;
      return rows[0] ? rowToRun(rows[0]) : null;
    });
  }

  async updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null> {
    return this.withContext(null, true, async (tx) => {
      const current = await tx`SELECT * FROM skills_runs WHERE id = ${runId} LIMIT 1`;
      if (!current[0]) return null;
      const run = { ...rowToRun(current[0]), ...patch };
      const rows = await tx`
        UPDATE skills_runs
        SET status = ${run.status},
            output_type = ${run.outputType ?? null},
            output_preview = ${run.outputPreview ?? null},
            error_code = ${run.errorCode ?? null},
            error_message = ${run.errorMessage ?? null},
            started_at = ${run.startedAt ?? null},
            completed_at = ${run.completedAt ?? null}
        WHERE id = ${runId}
        RETURNING *
      `;
      return rows[0] ? rowToRun(rows[0]) : null;
    });
  }

  /**
   * Generation-fenced transition. Same semantics as the SQLite twin: the WHERE
   * re-asserts lease_generation, and a stale worker gets StaleLeaseGenerationError
   * instead of silently overwriting a cancelled or re-claimed run.
   */
  async transitionRun(runId: string, patch: RunTransitionPatch, expectedGeneration: number): Promise<ServerRunRecord | null> {
    return this.withContext(null, true, async (tx) => {
      const current = await tx`SELECT * FROM skills_runs WHERE id = ${runId} LIMIT 1`;
      if (!current[0]) return null;
      const stored = rowToRun(current[0]);
      if (stored.leaseGeneration !== expectedGeneration) {
        throw new StaleLeaseGenerationError(runId, expectedGeneration, stored.leaseGeneration, stored.status);
      }
      const run = { ...stored, ...patch };
      const rows = await tx`
        UPDATE skills_runs
        SET status = ${run.status},
            output_type = ${run.outputType ?? null},
            output_preview = ${run.outputPreview ?? null},
            error_code = ${run.errorCode ?? null},
            error_message = ${run.errorMessage ?? null},
            started_at = ${run.startedAt ?? null},
            completed_at = ${run.completedAt ?? null},
            lease_generation = ${run.leaseGeneration}
        WHERE id = ${runId} AND lease_generation = ${expectedGeneration}
        RETURNING *
      `;
      return rows[0] ? rowToRun(rows[0]) : null;
    });
  }

  /**
   * Append a log line, retrying when another writer took the sequence number first.
   *
   * This was `SELECT MAX(sequence)+1` and then a separate `INSERT`, with an await in
   * between. Measured with five concurrent appendLog calls on one run: one succeeded and
   * four threw `duplicate key value violates unique constraint`, which executeRun's catch
   * turns into a failed run - a skill killed by its own logging.
   *
   * Folding the MAX into the INSERT helps but does not fix it: under READ COMMITTED each
   * statement takes its own snapshot, so concurrent inserts still compute the same MAX
   * (measured: 2 of 5 succeeded). SQLite has one writer and needs no retry; Postgres does,
   * so the loop lives here rather than in shared code. Bounded, and only ever retried for
   * a uniqueness conflict - any other error propagates on the first attempt.
   */
  async appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog> {
    let lastError: unknown;
    for (let attempt = 0; attempt < LOG_SEQUENCE_ATTEMPTS; attempt += 1) {
      try {
        const rows = await this.withContext(orgId, true, async (tx) => {
          return await tx`
            INSERT INTO skills_run_logs (run_id, org_id, sequence, level, message)
            VALUES (
              ${runId},
              ${orgId},
              (SELECT COALESCE(MAX(sequence), 0) + 1 FROM skills_run_logs WHERE run_id = ${runId}),
              ${level},
              ${message}
            )
            RETURNING *
          `;
        });
        return rowToLog(rows[0]);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]> {
    return this.withContext(principal.orgId, false, async (tx) => {
      const rows = await tx`
        SELECT l.* FROM skills_run_logs l
        JOIN skills_runs r ON r.id = l.run_id AND r.org_id = ${principal.orgId}
        WHERE l.run_id = ${runId}
        ORDER BY l.sequence ASC
      `;
      return rows.map(rowToLog);
    });
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    return this.withContext(artifact.orgId, true, async (tx) => {
      const rows = await tx`
        INSERT INTO skills_artifacts (id, run_id, org_id, file_name, relative_path, content_type, byte_size, sha256, storage_kind, storage_key, body_text, visibility, expires_at)
        VALUES (${artifact.id}, ${artifact.runId}, ${artifact.orgId}, ${artifact.fileName}, ${artifact.relativePath}, ${artifact.contentType}, ${artifact.byteSize}, ${artifact.sha256}, ${artifact.storageKind}, ${artifact.storageKey ?? null}, ${artifact.bodyText ?? null}, ${artifact.visibility}, ${artifact.expiresAt ?? null})
        RETURNING *
      `;
      return rowToArtifact(rows[0]);
    });
  }

  async listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]> {
    return this.withContext(principal.orgId, false, async (tx) => {
      const rows = await tx`
        SELECT a.* FROM skills_artifacts a
        JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
        WHERE a.run_id = ${runId}
        ORDER BY a.created_at ASC
      `;
      return rows.map(rowToArtifact);
    });
  }

  async getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null> {
    return this.withContext(principal.orgId, false, async (tx) => {
      const rows = await tx`
        SELECT a.* FROM skills_artifacts a
        JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
        WHERE a.run_id = ${runId} AND a.id = ${artifactId}
        LIMIT 1
      `;
      return rows[0] ? rowToArtifact(rows[0]) : null;
    });
  }

  async publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord> {
    const orgId = input.principal.orgId;
    return await this.sql.begin(async (tx) => {
      const previousRows = await tx`
        SELECT revision_id, revision_number, bundle_sha256, bundle_byte_size, skill_md, tombstoned_at, source
        FROM skills_registry WHERE org_id = ${orgId} AND slug = ${input.slug} LIMIT 1
      `;
      const previous = previousRows[0] as Record<string, unknown> | undefined;
      const previousSha = typeof previous?.bundle_sha256 === "string" ? String(previous.bundle_sha256) : null;
      const previousRevisionId = typeof previous?.revision_id === "string" && previous.revision_id ? String(previous.revision_id) : null;
      const tombstoned = previous?.tombstoned_at != null;
      if (input.seedBundledOnly && input.expectedRevisionId && !previous) {
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, null);
      }
      if (input.seedBundledOnly && previous && (tombstoned || previous.source !== "bundled")) {
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, previousRevisionId);
      }
      // The document travels with the row the way the bundle does: a publish that omits
      // skillMd is a metadata update, not an instruction to discard the published
      // document. The effective document enters BOTH the stored row and the revision
      // hash, so the recorded revision keeps identifying the stored bytes.
      const carriedSkillMd = typeof input.skillMd === "string" ? input.skillMd : (typeof previous?.skill_md === "string" ? String(previous.skill_md) : null);
      // A live existing row requires If-Match naming its current revision. The pre-read
      // is only for the carried-forward bundle and the revision number: the ACTUAL guard
      // is the WHERE clause on the upsert below, which is evaluated against the row as it
      // stands at write time. A second writer that lands between this read and the
      // upsert changes revision_id, the WHERE stops matching, zero rows are returned and
      // the conflict is thrown here instead of silently overwriting.
      if (previous && !tombstoned && input.expectedRevisionId !== previousRevisionId) {
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, previousRevisionId);
      }
      const carriedSha = input.bundle?.sha256 ?? previousSha;
      // Immutable versions (hasna/apps#1630), checked before any write.
      if (input.version && carriedSha) {
        const existingVersion = await tx`
          SELECT bundle_sha256 FROM skills_versions WHERE org_id = ${orgId} AND slug = ${input.slug} AND version = ${input.version} LIMIT 1
        `;
        const existingSha = existingVersion[0] && typeof existingVersion[0].bundle_sha256 === "string" ? String(existingVersion[0].bundle_sha256) : null;
        if (existingSha && existingSha !== carriedSha) {
          throw new SkillVersionExistsError(input.slug, input.version, existingSha, carriedSha);
        }
      }
      // The carried size travels with the carried digest into the revision hash: the row
      // keeps its old size on a metadata-only re-publish, and a client recomputing the
      // revision id from the payload (which carries both) must get the same value.
      const carriedSize = input.bundle?.byteSize ?? (previous?.bundle_byte_size == null ? null : Number(previous.bundle_byte_size));
      const revisionId = revisionIdOfRecord({
        slug: input.slug,
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        tags: input.tags,
        source: input.source,
        kind: input.kind,
        ...(input.version ? { version: input.version } : {}),
        ...(carriedSkillMd ? { skillMd: carriedSkillMd } : {}),
        ...(carriedSha ? { bundleSha256: carriedSha } : {}),
        ...(carriedSize === null || carriedSize === undefined ? {} : { bundleByteSize: carriedSize }),
      });

      if (input.bundle) {
        // Content-addressed: the same digest is the same bytes, so a re-upload is a
        // no-op rather than a conflict or a duplicate blob.
        await tx`
          INSERT INTO skills_bundles (org_id, sha256, byte_size, content_type, storage_kind, storage_key, body_blob)
          VALUES (${orgId}, ${input.bundle.sha256}, ${input.bundle.byteSize}, ${input.bundle.contentType}, ${input.bundle.storageKind}, ${input.bundle.storageKey ?? null}, ${input.bundle.bytes ?? null})
          ON CONFLICT (org_id, sha256) DO UPDATE SET
            byte_size = EXCLUDED.byte_size,
            content_type = EXCLUDED.content_type,
            storage_kind = EXCLUDED.storage_kind,
            storage_key = EXCLUDED.storage_key,
            body_blob = EXCLUDED.body_blob
        `;
      }

      // Match ordinary publication's lock order (bundle, then registry) so a seed
      // cannot deadlock a concurrent publisher by taking those locks in reverse.
      // Lock before the upsert: a purge cannot turn an expected update into an insert.
      if (input.seedBundledOnly) {
        const seedRows = await tx`SELECT revision_id FROM skills_registry WHERE org_id = ${orgId} AND slug = ${input.slug} FOR UPDATE`;
        if (input.expectedRevisionId && !seedRows[0]) {
          throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, null);
        }
      }
      const rows = await tx`
        INSERT INTO skills_registry (org_id, slug, display_name, description, category, tags_json, source, kind, version, skill_md,
                                     bundle_sha256, bundle_byte_size, published_by_user_id, revision_id, revision_number, updated_at)
        VALUES (${orgId}, ${input.slug}, ${input.displayName}, ${input.description}, ${input.category}, ${JSON.stringify(input.tags)}::jsonb,
                ${input.source}, ${input.kind}, ${input.version ?? null}, ${carriedSkillMd},
                ${input.bundle?.sha256 ?? null}, ${input.bundle?.byteSize ?? null}, ${input.principal.userId}, ${revisionId}, 1, now())
        ON CONFLICT (org_id, slug) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          tags_json = EXCLUDED.tags_json,
          source = EXCLUDED.source,
          kind = EXCLUDED.kind,
          version = EXCLUDED.version,
          skill_md = EXCLUDED.skill_md,
          -- COALESCE: see the SQLite twin. A bundle-less publish is a metadata update,
          -- not an instruction to discard the stored tarball.
          bundle_sha256 = COALESCE(EXCLUDED.bundle_sha256, skills_registry.bundle_sha256),
          bundle_byte_size = COALESCE(EXCLUDED.bundle_byte_size, skills_registry.bundle_byte_size),
          published_by_user_id = EXCLUDED.published_by_user_id,
          revision_id = EXCLUDED.revision_id,
          -- Current + 1, not EXCLUDED.revision_number: the insert path minted 1, but on
          -- the update path the ACTUAL row's counter is the truth (it may have advanced
          -- since the pre-read, which is exactly what the WHERE guard below detects).
          revision_number = skills_registry.revision_number + 1,
          tombstoned_at = NULL,
          tombstone_purge_after = NULL,
          updated_at = EXCLUDED.updated_at
        WHERE (skills_registry.tombstoned_at IS NOT NULL
           OR skills_registry.revision_id = ${input.expectedRevisionId ?? NO_REVISION_SENTINEL})
          AND (NOT ${Boolean(input.seedBundledOnly)} OR
            (skills_registry.tombstoned_at IS NULL AND skills_registry.source = 'bundled'
             AND skills_registry.revision_id = ${input.expectedRevisionId ?? NO_REVISION_SENTINEL}))
        RETURNING *
      `;
      if (!rows[0]) {
        // WHERE matched nothing: the row is live and its revision moved on (or no guard
        // was supplied). Re-read for the truthful current id to report.
        const current = await tx`SELECT revision_id FROM skills_registry WHERE org_id = ${orgId} AND slug = ${input.slug} LIMIT 1`;
        const currentId = current[0] && typeof current[0].revision_id === "string" ? String(current[0].revision_id) : null;
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, currentId);
      }
      if (input.version && carriedSha) {
        await tx`
          INSERT INTO skills_versions (org_id, slug, version, bundle_sha256, bundle_byte_size, storage_kind, storage_key, manifest_json, published_by_user_id)
          VALUES (${orgId}, ${input.slug}, ${input.version}, ${carriedSha}, ${carriedSize ?? 0}, ${input.versionStorage?.storageKind ?? "db"},
                  ${input.versionStorage?.storageKey ?? null}, ${JSON.stringify(input.versionManifest ?? {})}::jsonb, ${input.principal.userId})
          ON CONFLICT (org_id, slug, version) DO NOTHING
        `;
      }
      if (previousSha && input.bundle && previousSha !== input.bundle.sha256) {
        await tx`
          DELETE FROM skills_bundles
          WHERE org_id = ${orgId} AND sha256 = ${previousSha}
            AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${orgId} AND bundle_sha256 = ${previousSha})
            AND NOT EXISTS (SELECT 1 FROM skills_versions WHERE org_id = ${orgId} AND bundle_sha256 = ${previousSha})
        `;
      }

      // Keep the tag projection (migration 0005) in step with the upsert, in
      // the same transaction: replace, never merge, so the projection is
      // exactly the row's current tags.
      await tx`DELETE FROM skills_tags WHERE org_id = ${orgId} AND slug = ${input.slug}`;
      for (const tag of input.tags) {
        if (!tag.trim()) continue;
        await tx`
          INSERT INTO skills_tags (org_id, slug, tag) VALUES (${orgId}, ${input.slug}, ${tag})
          ON CONFLICT DO NOTHING
        `;
      }
      return rowToSkill(rows[0]!);
    });
  }

  async listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    await this.purgeExpiredTombstones(principal);
    const rows = await this.sql`
      SELECT * FROM skills_registry WHERE org_id = ${principal.orgId} AND tombstoned_at IS NULL ORDER BY slug ASC
    `;
    return rows.map(rowToSkill);
  }

  async getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null> {
    const rows = await this.sql`SELECT * FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug} LIMIT 1`;
    return rows[0] ? rowToSkill(rows[0]) : null;
  }

  async setSkillLifecycle(principal: ApiPrincipal, slug: string, patch: SkillLifecyclePatch, expectedRevisionId?: string) {
    return this.sql.begin(async (tx) => {
      // Lock the registry row before reading profiles. Profile writes acquire
      // this same row lock for every selected skill, forming the lifecycle
      // fence across both operations.
      const currentRows = await tx`SELECT * FROM skills_registry WHERE org_id=${principal.orgId} AND slug=${slug} LIMIT 1 FOR UPDATE`;
      const current = currentRows[0] ? rowToSkill(currentRows[0]) : null;
      if (!current || current.tombstonedAt) return null;
      if (expectedRevisionId !== current.revisionId) throw new SkillRevisionConflictError(slug, expectedRevisionId, current.revisionId);
      if (patch.lifecycle === "archived" && current.lifecycle !== "archived") {
        const profiles = await tx`SELECT profile_id,selections_json FROM skills_profiles WHERE org_id=${principal.orgId}`;
        const referencing = profiles.filter((profile) => {
          const selections = typeof profile.selections_json === "string" ? JSON.parse(profile.selections_json) : profile.selections_json;
          return Array.isArray(selections) && selections.some((selection) => selection?.slug === slug);
        }).map((profile) => String(profile.profile_id)).sort();
        if (referencing.length) throw new SkillLifecycleConflictError(slug, referencing);
      }
      const next: ServerSkillRecord = {
        ...current,
        lifecycle: patch.lifecycle,
        updatedAt: nowIso(),
        revisionId: revisionIdOfRecord({ ...current, lifecycle: patch.lifecycle, archiveReason: patch.reason, replacementSlug: patch.replacementSlug }),
        revisionNumber: current.revisionNumber + 1,
        ...(patch.lifecycle === "archived" ? { archivedAt: current.archivedAt ?? nowIso(), ...(patch.reason ? { archiveReason: patch.reason } : {}), ...(patch.replacementSlug ? { replacementSlug: patch.replacementSlug } : {}) } : {}),
      };
      if (patch.lifecycle === "active") { delete next.archivedAt; delete next.archiveReason; delete next.replacementSlug; }
      const rows = await tx`UPDATE skills_registry SET lifecycle=${next.lifecycle}, archived_at=${next.archivedAt ?? null}, archive_reason=${next.archiveReason ?? null}, replacement_slug=${next.replacementSlug ?? null}, revision_id=${next.revisionId}, revision_number=revision_number+1, updated_at=${next.updatedAt} WHERE org_id=${principal.orgId} AND slug=${slug} AND tombstoned_at IS NULL AND revision_id=${current.revisionId} RETURNING *`;
      if (!rows[0]) throw new SkillRevisionConflictError(slug, expectedRevisionId, (await this.getSkill(principal, slug))?.revisionId ?? null);
      return rowToSkill(rows[0]);
    });
  }

  async updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch, expectedRevisionId?: string): Promise<ServerSkillRecord | null> {
    const current = await this.getSkill(principal, slug);
    if (!current || current.tombstonedAt) return null;
    if (expectedRevisionId !== current.revisionId) {
      throw new SkillRevisionConflictError(slug, expectedRevisionId, current.revisionId);
    }
    const next = { ...current, ...patch };
    // Registry row and tag projection move in one transaction so the indexed
    // tag reads can never see a tags_json that disagrees with skills_tags.
    return await this.sql.begin(async (tx) => {
      const revisionId = revisionIdOfRecord(next);
      const updated = await tx`
        UPDATE skills_registry
        SET display_name = ${next.displayName}, description = ${next.description}, category = ${next.category},
            tags_json = ${JSON.stringify(next.tags)}::jsonb, kind = ${next.kind}, version = ${next.version ?? null},
            skill_md = ${next.skillMd ?? null}, revision_id = ${revisionId}, revision_number = revision_number + 1, updated_at = now()
        WHERE org_id = ${principal.orgId} AND slug = ${slug} AND tombstoned_at IS NULL AND revision_id = ${current.revisionId}
        RETURNING *
      `;
      if (!updated[0]) {
        // The WHERE guard matched nothing: between the pre-read above and this UPDATE the
        // row's revision advanced (a concurrent writer landed) or the row was tombstoned/
        // purged. A stale write must be a 409 REVISION_CONFLICT, never a 404 that falsely
        // claims the skill vanished — and never a silent overwrite.
        const nowRows = await tx`
          SELECT revision_id, tombstoned_at FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug} LIMIT 1
        `;
        if (nowRows[0] && nowRows[0].tombstoned_at == null) {
          const currentId = String(nowRows[0].revision_id);
          throw new SkillRevisionConflictError(slug, expectedRevisionId, currentId);
        }
        return null;
      }
      await tx`DELETE FROM skills_tags WHERE org_id = ${principal.orgId} AND slug = ${slug}`;
      for (const tag of next.tags) {
        if (!tag.trim()) continue;
        await tx`
          INSERT INTO skills_tags (org_id, slug, tag) VALUES (${principal.orgId}, ${slug}, ${tag})
          ON CONFLICT DO NOTHING
        `;
      }
      return rowToSkill(updated[0]);
    });
  }

  async deleteSkill(principal: ApiPrincipal, slug: string, tombstoneWindowMs: number): Promise<ServerSkillRecord | null> {
    // One transaction, matching the SQLite twin. As two statements on the pooled tag the
    // As a single transaction on the pooled tag, the read and the write cannot land on
    // different connections with a concurrent publish in between. Tombstoning keeps the
    // row (and its tag projection) alive for the tombstone window; the purge path below
    // drops both together.
    return await this.sql.begin(async (tx) => {
      const existingRows = await tx`
        SELECT tombstoned_at FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug} LIMIT 1
      `;
      if (!existingRows[0]) return null;
      if (existingRows[0].tombstoned_at != null) {
        // Idempotent re-delete: keep the original tombstone (the window is not extended).
        const rows = await tx`SELECT * FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug} LIMIT 1`;
        return rowToSkill(rows[0]!);
      }
      const rows = await tx`
        UPDATE skills_registry
        SET tombstoned_at = now(), tombstone_purge_after = now() + (${tombstoneWindowMs}::int * interval '1 millisecond'), updated_at = now()
        WHERE org_id = ${principal.orgId} AND slug = ${slug}
        RETURNING *
      `;
      return rows[0] ? rowToSkill(rows[0]) : null;
    });
  }

  async purgeExpiredTombstones(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    return await this.sql.begin(async (tx) => {
      const expiredRows = await tx`
        SELECT * FROM skills_registry
        WHERE org_id = ${principal.orgId} AND tombstoned_at IS NOT NULL AND tombstone_purge_after <= now()
      `;
      if (!expiredRows.length) return [];
      const purged: ServerSkillRecord[] = [];
      for (const row of expiredRows) {
        const record = rowToSkill(row);
        await tx`
          DELETE FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${record.slug} AND tombstone_purge_after <= now()
        `;
        // The tag projection (migration 0005) dies with the purged row.
        await tx`DELETE FROM skills_tags WHERE org_id = ${principal.orgId} AND slug = ${record.slug}`;
        await tx`
          DELETE FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${record.slug} AND tombstone_purge_after <= now()
        `;
        if (record.bundleSha256) {
          await tx`
            DELETE FROM skills_bundles
            WHERE org_id = ${principal.orgId} AND sha256 = ${record.bundleSha256}
              AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${principal.orgId} AND bundle_sha256 = ${record.bundleSha256})
              AND NOT EXISTS (SELECT 1 FROM skills_versions WHERE org_id = ${principal.orgId} AND bundle_sha256 = ${record.bundleSha256})
          `;
        }
        purged.push(record);
      }
      return purged;
    });
  }

  async getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null> {
    const rows = await this.sql`SELECT * FROM skills_bundles WHERE org_id = ${principal.orgId} AND sha256 = ${sha256} LIMIT 1`;
    return rows[0] ? rowToSkillBundle(rows[0]) : null;
  }

  async listSkillVersions(principal: ApiPrincipal, slug: string): Promise<ServerSkillVersion[]> {
    const rows = await this.sql`
      SELECT * FROM skills_versions WHERE org_id = ${principal.orgId} AND slug = ${slug}
      ORDER BY created_at DESC, version DESC
    `;
    return rows.map((row) => rowToSkillVersion(row as Record<string, unknown>));
  }

  async getSkillVersion(principal: ApiPrincipal, slug: string, version: string): Promise<ServerSkillVersion | null> {
    const rows = await this.sql`
      SELECT * FROM skills_versions WHERE org_id = ${principal.orgId} AND slug = ${slug} AND version = ${version} LIMIT 1
    `;
    return rows[0] ? rowToSkillVersion(rows[0] as Record<string, unknown>) : null;
  }

  async getPublishedSelectionStates(principal: ApiPrincipal, selections: readonly PublishedSkillSelection[]): Promise<PublishedSkillSelectionState[]> {
    if (selections.length > MAX_PROFILE_SELECTIONS) throw new RangeError("Published selection lookup exceeds the profile selection limit");
    if (!selections.length) return [];
    const requested = JSON.stringify(selections.map(({ slug, version }) => ({ slug, version })));
    // Bind serialized JSON as text first: Bun.SQL otherwise JSON-encodes the
    // string as a jsonb scalar rather than the requested array.
    const rows = await this.sql`
      SELECT q.value->>'slug' AS slug, q.value->>'version' AS version,
        r.slug IS NOT NULL AS skill_exists, r.lifecycle, r.tombstoned_at, r.authorization_epoch,
        v.bundle_sha256, b.sha256 IS NOT NULL AS bundle_available
      FROM jsonb_array_elements(${requested}::text::jsonb) WITH ORDINALITY AS q(value, ordinal)
      LEFT JOIN skills_registry r ON r.org_id = ${principal.orgId} AND r.slug = q.value->>'slug'
      LEFT JOIN skills_versions v ON v.org_id = ${principal.orgId}
        AND v.slug = q.value->>'slug' AND v.version = q.value->>'version'
      LEFT JOIN skills_bundles b ON b.org_id = ${principal.orgId} AND b.sha256 = v.bundle_sha256
      ORDER BY q.ordinal
    `;
    return rows.map(rowToPublishedSelectionState);
  }

  /*
   * Pins. Same pattern as the registry surface: the org/principal predicates
   * live in the store, and no withContext() is needed because skills_pins is
   * not under RLS - it is written and read only by the API under the
   * requesting principal's org, exactly like skills_registry.
   */
  async pinSkill(principal: ApiPrincipal, slug: string, metadata: Record<string, unknown> = {}): Promise<ServerPin> {
    const rows = await this.sql`
      INSERT INTO skills_pins (org_id, principal, slug, pinned_at, metadata_json)
      VALUES (${principal.orgId}, ${principal.apiKeyId}, ${slug}, now(), ${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT (org_id, principal, slug) DO UPDATE SET
        pinned_at = now(),
        metadata_json = EXCLUDED.metadata_json
      RETURNING *
    `;
    return rowToPin(rows[0]!);
  }

  async unpinSkill(principal: ApiPrincipal, slug: string): Promise<boolean> {
    const rows = await this.sql`
      DELETE FROM skills_pins WHERE org_id = ${principal.orgId} AND principal = ${principal.apiKeyId} AND slug = ${slug}
      RETURNING 1 AS present
    `;
    return rows.length > 0;
  }

  async listPins(principal: ApiPrincipal): Promise<ServerPin[]> {
    const rows = await this.sql`
      SELECT * FROM skills_pins WHERE org_id = ${principal.orgId} AND principal = ${principal.apiKeyId} ORDER BY slug ASC
    `;
    return rows.map(rowToPin);
  }

  async listTags(principal: ApiPrincipal): Promise<string[]> {
    // Indexed: the skills_tags_org_tag_idx (org_id, tag) index serves the org
    // filter, and the projection is kept in step by every write path. Expired
    // tombstones are purged first, like every other read path in this store.
    await this.purgeExpiredTombstones(principal);
    const rows = await this.sql`
      SELECT DISTINCT t.tag FROM skills_tags t JOIN skills_registry s ON s.org_id = t.org_id AND s.slug = t.slug WHERE t.org_id = ${principal.orgId} AND s.lifecycle = 'active' ORDER BY t.tag ASC
    `;
    return rows.map((row) => String(row.tag));
  }

  async listSkillsByTag(principal: ApiPrincipal, tag: string): Promise<ServerSkillRecord[]> {
    // Indexed: the projection's (org_id, slug, tag) primary key / org_tag index
    // resolves membership; the registry row is then fetched by its own key.
    // Tombstoned rows are excluded, matching listSkills.
    await this.purgeExpiredTombstones(principal);
    const rows = await this.sql`
      SELECT s.* FROM skills_registry s
      JOIN skills_tags t ON t.org_id = s.org_id AND t.slug = s.slug
      WHERE t.org_id = ${principal.orgId} AND t.tag = ${tag} AND s.tombstoned_at IS NULL AND s.lifecycle = 'active'
      ORDER BY s.slug ASC
    `;
    return rows.map(rowToSkill);
  }

  async listPinsByTag(principal: ApiPrincipal, tag: string): Promise<ServerPin[]> {
    // Indexed: membership via the projection, pins via their own composite key.
    // A pin whose slug has no live registry row (e.g. a bundled-only skill, or
    // a tombstoned one) carries no tags here; the app layer adds the
    // bundled-corpus half of that set.
    await this.purgeExpiredTombstones(principal);
    const rows = await this.sql`
      SELECT p.* FROM skills_pins p
      JOIN skills_tags t ON t.org_id = p.org_id AND t.slug = p.slug
      JOIN skills_registry s ON s.org_id = p.org_id AND s.slug = p.slug
      WHERE p.org_id = ${principal.orgId} AND p.principal = ${principal.apiKeyId}
        AND t.tag = ${tag} AND s.tombstoned_at IS NULL AND s.lifecycle = 'active'
      ORDER BY p.slug ASC
    `;
    return rows.map(rowToPin);
  }

  async listPublishedSlugs(principal: ApiPrincipal): Promise<string[]> {
    const rows = await this.sql`
      SELECT slug FROM skills_registry WHERE org_id = ${principal.orgId} AND tombstoned_at IS NULL ORDER BY slug ASC
    `;
    return rows.map((row) => String(row.slug));
  }

  /** Drop a bundle no remaining skill in the org points at. See the SQLite twin. */
  private async collectOrphanBundle(orgId: string, sha256: string): Promise<void> {
    await this.sql`
      DELETE FROM skills_bundles
      WHERE org_id = ${orgId} AND sha256 = ${sha256}
        AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${orgId} AND bundle_sha256 = ${sha256})
        AND NOT EXISTS (SELECT 1 FROM skills_versions WHERE org_id = ${orgId} AND bundle_sha256 = ${sha256})
    `;
  }
}

/**
 * A value no real revision id can equal, substituted for an absent If-Match in the SQL
 * guard. The JS pre-read already refuses the absent-guard case; this keeps the SQL WHERE
 * from ever matching a legacy '' marker row if the two ever diverge. 64 zeros is not a
 * sha-256 of any content this registry has ever minted.
 */
const NO_REVISION_SENTINEL = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * One-line, credential-free summary of a connection failure.
 *
 * A Postgres URL is a credential and drivers routinely echo the whole DSN back in the
 * error message. This keeps the class and a short reason - enough to tell "host is
 * down" from "password rejected" - and drops anything that looks like a URL.
 */
/** Postgres SQLSTATE 23505. Matched on the code where the driver exposes it, message otherwise. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; errno?: unknown })?.code;
  if (code === "23505" || code === 23505) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key value violates unique constraint/i.test(message);
}

function connectionFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<redacted-url>").split("\n")[0]!.slice(0, 200);
}
