import { randomUUID } from "node:crypto";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  PublishSkillInput,
  ServerArtifact,
  ServerRunLog,
  ServerRunRecord,
  ServerSkillBundle,
  ServerSkillRecord,
  SkillsProductStore,
  StoreBackendInfo,
  UpdateSkillPatch,
} from "./types.js";
import { hashApiKey, publicPrincipal } from "./auth.js";
import { resolveDatabaseTarget, type DatabaseTarget } from "./database-url.js";
import { artifactId, nowIso, normalizeLimit, rowToArtifact, rowToLog, rowToRun, rowToSkill, rowToSkillBundle, parseJsonArray, runId } from "./rows.js";
import { SqliteSkillsStore, type SqliteStoreOptions } from "./sqlite-store.js";

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
  readonly backend: StoreBackendInfo = { kind: "memory", durable: false, label: "memory (non-durable)" };
  private apiKeys = new Map<string, ApiPrincipal>();
  private runs = new Map<string, ServerRunRecord>();
  private logs = new Map<string, ServerRunLog[]>();
  private artifacts = new Map<string, ServerArtifact[]>();
  private idempotency = new Map<string, string>();
  private skills = new Map<string, ServerSkillRecord>();
  private bundles = new Map<string, ServerSkillBundle>();

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
    return this.patchRun(run.id, { status: "running", startedAt: run.startedAt ?? nowIso() });
  }

  async updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null> {
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
      ...(input.skillMd ? { skillMd: input.skillMd } : {}),
      // Absent bundle means "unchanged", so the previous digest is carried forward -
      // the same COALESCE the SQL backends do.
      ...(input.bundle
        ? { bundleSha256: input.bundle.sha256, bundleByteSize: input.bundle.byteSize }
        : previous?.bundleSha256
          ? { bundleSha256: previous.bundleSha256, ...(previous.bundleByteSize === undefined ? {} : { bundleByteSize: previous.bundleByteSize }) }
          : {}),
      publishedByUserId: input.principal.userId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.skills.set(key, record);
    if (previous?.bundleSha256 && input.bundle && previous.bundleSha256 !== input.bundle.sha256) {
      this.collectOrphanBundle(input.principal.orgId, previous.bundleSha256);
    }
    return record;
  }

  async listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    return Array.from(this.skills.values())
      .filter((skill) => skill.orgId === principal.orgId)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null> {
    const skill = this.skills.get(skillKey(principal.orgId, slug));
    return skill && skill.orgId === principal.orgId ? skill : null;
  }

  async updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch): Promise<ServerSkillRecord | null> {
    const current = await this.getSkill(principal, slug);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.skills.set(skillKey(principal.orgId, slug), next);
    return next;
  }

  async deleteSkill(principal: ApiPrincipal, slug: string): Promise<boolean> {
    const current = await this.getSkill(principal, slug);
    if (!current) return false;
    this.skills.delete(skillKey(principal.orgId, slug));
    if (current.bundleSha256) this.collectOrphanBundle(principal.orgId, current.bundleSha256);
    return true;
  }

  async getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null> {
    const bundle = this.bundles.get(skillKey(principal.orgId, sha256));
    return bundle && bundle.orgId === principal.orgId ? bundle : null;
  }

  private collectOrphanBundle(orgId: string, sha256: string): void {
    const referenced = Array.from(this.skills.values()).some((skill) => skill.orgId === orgId && skill.bundleSha256 === sha256);
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

export class PostgresSkillsStore implements SkillsProductStore {
  readonly backend: StoreBackendInfo = { kind: "postgres", durable: true, label: "postgres" };
  private sql: SqlTag;

  constructor(databaseUrl: string) {
    const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => SqlTag };
    this.sql = new bunWithSql.SQL(databaseUrl, { max: resolvePoolMax() });
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

  async createRun(input: CreateRunInput): Promise<ServerRunRecord> {
    if (input.idempotencyKey) {
      const existing = await this.sql`
        SELECT * FROM skills_runs
        WHERE org_id = ${input.principal.orgId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) return rowToRun(existing[0]);
    }
    const id = runId();
    const rows = await this.sql`
      INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, input_json, args_json, idempotency_key, correlation_id)
      VALUES (${id}, ${input.principal.orgId}, ${input.principal.userId}, ${input.slug}, ${input.slug}, ${"queued"}, ${JSON.stringify(input.input)}::jsonb, ${JSON.stringify(input.args)}::jsonb, ${input.idempotencyKey ?? null}, ${randomUUID()})
      RETURNING *
    `;
    return rowToRun(rows[0]);
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    const rows = await this.sql`
      SELECT * FROM skills_runs WHERE org_id = ${principal.orgId}
      ORDER BY created_at DESC LIMIT ${normalizeLimit(limit)}
    `;
    return rows.map(rowToRun);
  }

  async getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const rows = await this.sql`
      SELECT * FROM skills_runs WHERE id = ${runId} AND org_id = ${principal.orgId} LIMIT 1
    `;
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async claimNextRun(input: ClaimRunInput): Promise<ServerRunRecord | null> {
    const rows = await this.sql`
      UPDATE skills_runs
      SET status = ${"running"}, started_at = COALESCE(started_at, now()), locked_by = ${input.workerId}, locked_at = now()
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
  }

  async updateRun(runId: string, patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>): Promise<ServerRunRecord | null> {
    const current = await this.sql`SELECT * FROM skills_runs WHERE id = ${runId} LIMIT 1`;
    if (!current[0]) return null;
    const run = { ...rowToRun(current[0]), ...patch };
    const rows = await this.sql`
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
        const rows = await this.sql`
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
        return rowToLog(rows[0]);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]> {
    const rows = await this.sql`
      SELECT l.* FROM skills_run_logs l
      JOIN skills_runs r ON r.id = l.run_id AND r.org_id = ${principal.orgId}
      WHERE l.run_id = ${runId}
      ORDER BY l.sequence ASC
    `;
    return rows.map(rowToLog);
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    const rows = await this.sql`
      INSERT INTO skills_artifacts (id, run_id, org_id, file_name, relative_path, content_type, byte_size, sha256, storage_kind, storage_key, body_text)
      VALUES (${artifact.id}, ${artifact.runId}, ${artifact.orgId}, ${artifact.fileName}, ${artifact.relativePath}, ${artifact.contentType}, ${artifact.byteSize}, ${artifact.sha256}, ${artifact.storageKind}, ${artifact.storageKey ?? null}, ${artifact.bodyText ?? null})
      RETURNING *
    `;
    return rowToArtifact(rows[0]);
  }

  async listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]> {
    const rows = await this.sql`
      SELECT a.* FROM skills_artifacts a
      JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
      WHERE a.run_id = ${runId}
      ORDER BY a.created_at ASC
    `;
    return rows.map(rowToArtifact);
  }

  async getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null> {
    const rows = await this.sql`
      SELECT a.* FROM skills_artifacts a
      JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
      WHERE a.run_id = ${runId} AND a.id = ${artifactId}
      LIMIT 1
    `;
    return rows[0] ? rowToArtifact(rows[0]) : null;
  }

  async publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord> {
    const orgId = input.principal.orgId;
    return await this.sql.begin(async (tx) => {
      const previousRows = await tx`SELECT bundle_sha256 FROM skills_registry WHERE org_id = ${orgId} AND slug = ${input.slug} LIMIT 1`;
      const previousSha = typeof previousRows[0]?.bundle_sha256 === "string" ? String(previousRows[0]!.bundle_sha256) : null;

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

      const rows = await tx`
        INSERT INTO skills_registry (org_id, slug, display_name, description, category, tags_json, source, kind, version, skill_md,
                                     bundle_sha256, bundle_byte_size, published_by_user_id, updated_at)
        VALUES (${orgId}, ${input.slug}, ${input.displayName}, ${input.description}, ${input.category}, ${JSON.stringify(input.tags)}::jsonb,
                ${input.source}, ${input.kind}, ${input.version ?? null}, ${input.skillMd ?? null},
                ${input.bundle?.sha256 ?? null}, ${input.bundle?.byteSize ?? null}, ${input.principal.userId}, now())
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
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      if (previousSha && input.bundle && previousSha !== input.bundle.sha256) {
        await tx`
          DELETE FROM skills_bundles
          WHERE org_id = ${orgId} AND sha256 = ${previousSha}
            AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${orgId} AND bundle_sha256 = ${previousSha})
        `;
      }
      return rowToSkill(rows[0]!);
    });
  }

  async listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    const rows = await this.sql`SELECT * FROM skills_registry WHERE org_id = ${principal.orgId} ORDER BY slug ASC`;
    return rows.map(rowToSkill);
  }

  async getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null> {
    const rows = await this.sql`SELECT * FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug} LIMIT 1`;
    return rows[0] ? rowToSkill(rows[0]) : null;
  }

  async updateSkill(principal: ApiPrincipal, slug: string, patch: UpdateSkillPatch): Promise<ServerSkillRecord | null> {
    const current = await this.getSkill(principal, slug);
    if (!current) return null;
    const next = { ...current, ...patch };
    const rows = await this.sql`
      UPDATE skills_registry
      SET display_name = ${next.displayName}, description = ${next.description}, category = ${next.category},
          tags_json = ${JSON.stringify(next.tags)}::jsonb, kind = ${next.kind}, version = ${next.version ?? null},
          skill_md = ${next.skillMd ?? null}, updated_at = now()
      WHERE org_id = ${principal.orgId} AND slug = ${slug}
      RETURNING *
    `;
    return rows[0] ? rowToSkill(rows[0]) : null;
  }

  async deleteSkill(principal: ApiPrincipal, slug: string): Promise<boolean> {
    // One transaction, matching the SQLite twin. As two statements on the pooled tag the
    // DELETE and the orphan collection could land on different connections with a
    // concurrent publish in between, and the NOT EXISTS guard narrows that window without
    // closing it.
    return await this.sql.begin(async (tx) => {
      const rows = await tx`
        DELETE FROM skills_registry WHERE org_id = ${principal.orgId} AND slug = ${slug}
        RETURNING bundle_sha256
      `;
      if (!rows[0]) return false;
      const sha = rows[0].bundle_sha256;
      if (typeof sha === "string") {
        await tx`
          DELETE FROM skills_bundles
          WHERE org_id = ${principal.orgId} AND sha256 = ${sha}
            AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${principal.orgId} AND bundle_sha256 = ${sha})
        `;
      }
      return true;
    });
  }

  async getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null> {
    const rows = await this.sql`SELECT * FROM skills_bundles WHERE org_id = ${principal.orgId} AND sha256 = ${sha256} LIMIT 1`;
    return rows[0] ? rowToSkillBundle(rows[0]) : null;
  }

  /** Drop a bundle no remaining skill in the org points at. See the SQLite twin. */
  private async collectOrphanBundle(orgId: string, sha256: string): Promise<void> {
    await this.sql`
      DELETE FROM skills_bundles
      WHERE org_id = ${orgId} AND sha256 = ${sha256}
        AND NOT EXISTS (SELECT 1 FROM skills_registry WHERE org_id = ${orgId} AND bundle_sha256 = ${sha256})
    `;
  }
}

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
