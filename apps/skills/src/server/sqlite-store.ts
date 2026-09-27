import { SqliteExecutionGrantStore } from "./execution-grant-store.js";
/**
 * SQLite implementation of SkillsProductStore.
 *
 * This is the zero-config default: a single operator runs `skills-server` with nothing
 * configured and gets a durable database at ~/.hasna/skills/server.db. Point
 * HASNA_SKILLS_DATABASE_URL at a postgres:// URL and the same server becomes the shared
 * multi-worker deployment. The database is an adapter choice, not a product variant -
 * the schema shape, the org scoping, and the run lifecycle are identical either way.
 *
 * Semantics are matched to PostgresSkillsStore method for method, including the places
 * where Postgres does something arguably odd (updateRun is not org-scoped; it is the
 * worker's write path and the worker has already been handed the run). Parity is the
 * requirement; changing Postgres behaviour is not this module's job.
 */
import { Database } from "bun:sqlite";
import { SqliteSkillSelectionStore } from "./selection-store.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashApiKey, publicPrincipal } from "./auth.js";
import { SQLITE_MEMORY_PATH } from "./database-url.js";
import { resolveMigrationsDir } from "./migrations-dir.js";
import { nowIso, normalizeLimit, rowToArtifact, rowToLog, rowToPin, rowToRun, rowToSkill, rowToSkillBundle,
  rowToSkillVersion, rowToPublishedSelectionState, runId } from "./rows.js";
import { MAX_PROFILE_SELECTIONS } from "../lib/profile-limits.js";
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
  ServerSkillVersion,
  ApiKeyScopeUpdateResult,
  OperatorScopeEnrollmentInput,
  OperatorScopeEnrollmentResult,
  OperatorScopeTargetSnapshot,
  ServerSkillRecord,
  SkillLifecyclePatch,
  SkillsProductStore,
  StoreBackendInfo,
  UpdateSkillPatch,
} from "./types.js";
import { SkillLifecycleConflictError, SkillRevisionConflictError, SkillVersionExistsError, StaleLeaseGenerationError } from "./types.js";
import { revisionIdOfRecord } from "../lib/revision.js";
import { validOperatorScopeEnrollmentInput } from "./types.js";

export interface SqliteStoreOptions {
  /** Apply pending migrations on open. Default true - it is what makes zero-config work. */
  migrate?: boolean;
  /** Override the migrations directory. Tests and embedders only. */
  migrationsDir?: string;
  /**
   * How long a writer waits for another connection's write lock before giving up.
   *
   * Not decoration. SQLite serialises writers; without a busy timeout a second worker
   * process calling claimNextRun() at the same moment gets SQLITE_BUSY immediately and
   * the claim fails rather than queueing. Five seconds is far longer than a claim
   * transaction (three statements, no I/O beyond the page cache) can plausibly take.
   */
  busyTimeoutMs?: number;
}

/**
 * Bounded retry for the "another claimer took the row between our SELECT and our
 * UPDATE" case.
 *
 * Unreachable by construction today, and stated as such rather than implied: while
 * BEGIN IMMEDIATE holds the write lock nothing else can change the row, so the
 * conditional UPDATE always reports one row and this loop always exits on its first
 * pass. It is defence in depth for the day someone weakens the transaction - which is a
 * plausible edit, since the isolation is one keyword - and it is why a weakened
 * transaction would degrade into retries rather than into two workers running the same
 * skill. Being unreachable, it is also untested; do not read a green suite as evidence
 * that this path works.
 */
const CLAIM_ATTEMPTS = 8;

const CLAIMABLE_STATUSES = ["queued", "retrying"] as const;

/**
 * A value no real revision id can equal, substituted for an absent If-Match in the
 * upsert guard. See the same constant in store.ts: keeps the SQL WHERE from ever
 * matching a legacy '' marker row if the JS pre-read and the SQL guard ever diverge.
 */
const NO_REVISION_SENTINEL = "0000000000000000000000000000000000000000000000000000000000000000";

/** How stale api_keys.last_used_at is allowed to get before authentication refreshes it. */
const LAST_USED_RESOLUTION_MS = 60_000;

export class SqliteSkillsStore implements SkillsProductStore {
  get selectionStore() { return new SqliteSkillSelectionStore(this.db); }
  get executionGrantStore() { return new SqliteExecutionGrantStore(this.db); }
  readonly backend: StoreBackendInfo;
  private db: Database;
  private closed = false;

  constructor(path: string = SQLITE_MEMORY_PATH, options: SqliteStoreOptions = {}) {
    const inMemory = path === SQLITE_MEMORY_PATH;
    if (!inMemory) mkdirSync(dirname(path), { recursive: true });

    this.db = openDatabase(path);

    // busy_timeout MUST be installed before anything that takes a lock, and the very
    // next statement takes the strongest one there is.
    //
    // Switching a fresh database into WAL needs an exclusive lock. With no busy handler
    // yet, a second process opening the same new file gets SQLITE_BUSY immediately and
    // throws a bare "database is locked" - and the zero-config topology starts exactly
    // two processes against a brand-new file at once (`skills-server` and
    // `skills-worker`). Measured with the pragmas in the other order: 8 of 10 concurrent
    // first opens failed. It is a first-start-only race, because once the file is in WAL
    // the conversion is a no-op, which is precisely what makes it the kind of bug that
    // survives every test run on an already-initialised database.
    this.db.exec(`PRAGMA busy_timeout = ${Math.max(0, options.busyTimeoutMs ?? 5000)}`);
    // WAL lets readers proceed while a writer holds the lock, which is what keeps the
    // API process responsive while a worker is mid-claim. Meaningless for :memory:,
    // where SQLite silently keeps journal_mode=memory.
    if (!inMemory) enableWalMode(this.db);
    // SQLite ignores foreign keys unless asked. The schema declares org_id/user_id
    // references on every table; without this pragma the org model would be decorative
    // on SQLite and enforced on Postgres - exactly the kind of silent cross-backend
    // divergence this store exists to avoid.
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA synchronous = NORMAL");

    if (options.migrate !== false) {
      applySqliteMigrations(this.db, options.migrationsDir);
    }
    this.backfillLegacyRevisions();

    this.backend = {
      kind: "sqlite",
      durable: !inMemory,
      label: inMemory ? "sqlite (in-memory)" : `sqlite (${path})`,
    };
  }

  /**
   * Give rows written before migration 0004 a real content revision id.
   *
   * The migration adds revision_id with DEFAULT '', which would make If-Match vacuous
   * for legacy rows (every stale client matches the same empty string). This replaces
   * the marker with a content sha, idempotently: new code always writes a full id, so
   * the marker never reappears. Mirrors PostgresSkillsStore.backfillLegacyRevisions.
   */
  private backfillLegacyRevisions(): void {
    const rows = this.all("SELECT * FROM skills_registry WHERE revision_id = ''", []);
    for (const row of rows) {
      const record = rowToSkill(row);
      this.db.run("UPDATE skills_registry SET revision_id = ? WHERE org_id = ? AND slug = ?", [
        revisionIdOfRecord(record),
        record.orgId,
        record.slug,
      ]);
    }
  }

  /** Escape hatch for tests and for tooling that needs raw SQL against the same handle. */
  get database(): Database {
    return this.db;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close(false);
  }

  async ensureBootstrapApiKey(token: string, principal?: Partial<ApiPrincipal>): Promise<void> {
    const resolved = publicPrincipal(principal);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO organizations (id, slug, name) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, name = excluded.name`,
        [resolved.orgId, resolved.orgSlug, resolved.orgName],
      );
      this.db.run(
        `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET email = excluded.email`,
        [resolved.userId, resolved.email, resolved.email],
      );
      this.db.run(
        `INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role`,
        [resolved.orgId, resolved.userId, resolved.role],
      );
      this.db.run(
        `INSERT INTO api_keys (id, org_id, user_id, name, key_hash, scopes_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (key_hash) DO NOTHING`,
        [resolved.apiKeyId, resolved.orgId, resolved.userId, "bootstrap", hashApiKey(token), JSON.stringify(resolved.scopes)],
      );
    })();
  }

  async authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null> {
    const row = this.get(
      `SELECT k.id AS api_key_id, k.scopes_json, k.last_used_at, o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
              u.id AS user_id, u.email, m.role
       FROM api_keys k
       JOIN organizations o ON o.id = k.org_id
       JOIN users u ON u.id = k.user_id
       LEFT JOIN organization_members m ON m.org_id = k.org_id AND m.user_id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL
       LIMIT 1`,
      [hash],
    );
    if (!row) return null;

    // last_used_at is refreshed at most once per LAST_USED_RESOLUTION_MS, not on every
    // request.
    //
    // bun:sqlite is synchronous, so a write here does not merely await - it blocks the
    // entire JS thread until it lands. Measured with another process holding BEGIN
    // IMMEDIATE, one authentication took 1937ms during which a 10ms interval fired zero
    // times: every other in-flight request on the server was frozen too, and past
    // busy_timeout the whole thing becomes a 500. Authentication runs on every /api/*
    // request, so an unconditional write turned the busiest read path into the busiest
    // write path.
    //
    // The column exists to answer "is this key still in use", which a minute's
    // resolution answers just as well as a millisecond's.
    const lastUsed = typeof row.last_used_at === "string" ? Date.parse(row.last_used_at) : Number.NaN;
    if (!Number.isFinite(lastUsed) || Date.now() - lastUsed >= LAST_USED_RESOLUTION_MS) {
      this.db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [nowIso(), String(row.api_key_id)]);
    }
    return {
      apiKeyId: String(row.api_key_id),
      orgId: String(row.org_id),
      orgSlug: String(row.org_slug),
      orgName: String(row.org_name),
      userId: String(row.user_id),
      email: String(row.email),
      role: typeof row.role === "string" ? row.role : "member",
      scopes: parseScopes(row.scopes_json),
    };
  }

  async updateApiKeyScopes(actor: ApiPrincipal, keyId: string, expectedScopes: string[], addScopes: string[]): Promise<ApiKeyScopeUpdateResult> {
    const row = this.get("SELECT scopes_json FROM api_keys WHERE id = ? AND org_id = ? AND revoked_at IS NULL LIMIT 1", [keyId, actor.orgId]);
    if (!row) return { kind: "not_found" };
    const current = parseScopes(row.scopes_json);
    if (current.length !== expectedScopes.length || current.some((scope, index) => scope !== expectedScopes[index])) {
      return { kind: "stale", scopes: current };
    }
    const scopes = [...current, ...addScopes.filter((scope) => !current.includes(scope))];
    const tx = this.db.transaction(() => {
      const changed = this.db.run(
        "UPDATE api_keys SET scopes_json = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL AND scopes_json = ?",
        [JSON.stringify(scopes), keyId, actor.orgId, JSON.stringify(expectedScopes)],
      );
      if (changed.changes !== 1) return false;
      this.db.run(
        "INSERT INTO skills_audit_events (org_id, user_id, api_key_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [actor.orgId, actor.userId, actor.apiKeyId, "api_key_scopes_added", "api_key", keyId, JSON.stringify({ added: addScopes, scopes })],
      );
      return true;
    });
    if (!tx()) {
      const latest = this.get("SELECT scopes_json FROM api_keys WHERE id = ? AND org_id = ? AND revoked_at IS NULL LIMIT 1", [keyId, actor.orgId]);
      return { kind: "stale", scopes: latest ? parseScopes(latest.scopes_json) : current };
    }
    return { kind: "updated", scopes };
  }

  async enrollPublishScopeByOperator(input: OperatorScopeEnrollmentInput): Promise<OperatorScopeEnrollmentResult> {
    if (!validOperatorScopeEnrollmentInput(input)) return { kind: "invalid" };
    if (input.expectedScopes.includes("skills:publish")) return { kind: "stale", scopes: input.expectedScopes };
    const operation = this.get("SELECT org_id, target_id FROM skills_audit_events WHERE action = ? AND operator_operation_id = ? LIMIT 1", ["api_key_scopes_added", input.operationId]);
    if (operation && (String(operation.org_id) !== input.orgId || String(operation.target_id) !== input.keyId)) return { kind: "target_mismatch" };
    const row = this.get("SELECT id, org_id, name, scopes_json FROM api_keys WHERE id = ? AND revoked_at IS NULL LIMIT 1", [input.keyId]);
    if (!row) return { kind: "not_found" };
    if (String(row.org_id) !== input.orgId) return { kind: "target_mismatch" };
    const current = parseScopes(row.scopes_json);
    const prior = this.get("SELECT metadata_json FROM skills_audit_events WHERE action = ? AND target_type = ? AND target_id = ? AND json_extract(metadata_json, '$.operator_operation_id') = ? LIMIT 1", ["api_key_scopes_added", "api_key", input.keyId, input.operationId]);
    if (prior) {
      try {
        if (JSON.parse(String(prior.metadata_json)).target_manifest_digest !== input.manifestDigest) return { kind: "target_mismatch" };
      } catch {
        return { kind: "target_mismatch" };
      }
      return current.includes("skills:publish") ? { kind: "already_applied", scopes: current } : { kind: "stale", scopes: current };
    }
    if (current.length !== input.expectedScopes.length || current.some((scope, index) => scope !== input.expectedScopes[index])) return { kind: "stale", scopes: current };
    const scopes = [...current, "skills:publish"];
    const tx = this.db.transaction(() => {
      const changed = this.db.run("UPDATE api_keys SET scopes_json = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL AND scopes_json = ?", [JSON.stringify(scopes), input.keyId, input.orgId, JSON.stringify(input.expectedScopes)]);
      if (changed.changes !== 1) return false;
      this.db.run("INSERT INTO skills_audit_events (org_id, user_id, api_key_id, action, target_type, target_id, operator_operation_id, metadata_json) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)", [input.orgId, "api_key_scopes_added", "api_key", input.keyId, input.operationId, JSON.stringify({ added: ["skills:publish"], scopes, operator_operation_id: input.operationId, operator_job_id: input.operatorJobId, operator_task_arn: input.operatorTaskArn, target_manifest_digest: input.manifestDigest, station_id: input.stationId })]);
      return true;
    });
    if (!tx()) {
      const latest = this.get("SELECT scopes_json FROM api_keys WHERE id = ? AND org_id = ? AND revoked_at IS NULL LIMIT 1", [input.keyId, input.orgId]);
      return { kind: "stale", scopes: latest ? parseScopes(latest.scopes_json) : current };
    }
    return { kind: "updated", scopes };
  }

  async inspectOperatorScopeTarget(keyId: string, orgId: string): Promise<OperatorScopeTargetSnapshot> {
    const row = this.get("SELECT org_id, scopes_json FROM api_keys WHERE id = ? AND revoked_at IS NULL LIMIT 1", [keyId]);
    if (!row) return { kind: "not_found" };
    if (String(row.org_id) !== orgId) return { kind: "target_mismatch" };
    return { kind: "found", scopes: parseScopes(row.scopes_json) };
  }

  async createRun(input: CreateRunInput): Promise<ServerRunRecord> {
    if (input.idempotencyKey) {
      const existing = this.get(
        "SELECT * FROM skills_runs WHERE org_id = ? AND idempotency_key = ? LIMIT 1",
        [input.principal.orgId, input.idempotencyKey],
      );
      if (existing) return rowToRun(existing);
    }
    const row = this.get(
      `INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, input_json, args_json, idempotency_key, correlation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        runId(),
        input.principal.orgId,
        input.principal.userId,
        input.slug,
        input.slug,
        "queued",
        JSON.stringify(input.input),
        JSON.stringify(input.args),
        input.idempotencyKey ?? null,
        randomUUID(),
        nowIso(),
      ],
    );
    return rowToRun(row!);
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    // rowid is SQLite's monotonic insertion counter, so it breaks created_at ties in
    // true insertion order. created_at alone has millisecond resolution and two runs
    // submitted in the same millisecond would otherwise come back in arbitrary order.
    return this.all(
      "SELECT * FROM skills_runs WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      [principal.orgId, normalizeLimit(limit)],
    ).map(rowToRun);
  }

  async getRun(principal: ApiPrincipal, id: string): Promise<ServerRunRecord | null> {
    const row = this.get("SELECT * FROM skills_runs WHERE id = ? AND org_id = ? LIMIT 1", [id, principal.orgId]);
    return row ? rowToRun(row) : null;
  }

  /**
   * Claim the oldest runnable job for a worker, exactly once.
   *
   * Postgres does this with `FOR UPDATE SKIP LOCKED`: the row is locked at SELECT time,
   * and a competing transaction skips past it to the next candidate. SQLite has no row
   * locks and no SKIP LOCKED - it has one write lock for the whole database - so the
   * equivalent guarantee has to be built from what SQLite does have:
   *
   *   1. BEGIN IMMEDIATE takes the database's RESERVED write lock up front, rather than
   *      at the first write the way a deferred transaction does. Two claimers therefore
   *      serialise from their first statement, not from their UPDATE, which is what
   *      closes the read-then-write race. A plain BEGIN would let both claimers run
   *      their SELECT, both see the same row, and one of them fail late (or, in WAL
   *      mode, succeed - both having decided they own the run).
   *   2. The UPDATE claims BY ID and re-asserts the status predicate
   *      (`AND status IN ('queued','retrying')`). A claim is only real if that statement
   *      reports changes === 1. This makes exclusivity a property of the write itself
   *      rather than a property of the surrounding transaction, so it holds even if the
   *      isolation above were ever weakened.
   *   3. A bounded retry moves to the next candidate when changes === 0, so losing a
   *      race never reports "queue empty" while runnable work is sitting there.
   *
   * Not org-scoped, matching Postgres: a worker serves every org on the instance. The
   * org boundary is enforced on the read paths a principal can reach.
   */
  async claimNextRun(input: ClaimRunInput): Promise<ServerRunRecord | null> {
    // Ids whose conditional UPDATE reported 0 rows this call. Excluded by id rather
    // than skipped by OFFSET: a lost row is no longer a candidate, so offsetting past
    // it would skip the *next* still-queued run instead and leave real work sitting.
    const lost = new Set<string>();
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const claimed = this.claimOnce(input.workerId, lost);
      if (claimed === "empty") return null;
      if (claimed) return claimed;
    }
    // Every attempt lost its race, which means other claimers are draining the queue.
    // Reporting "nothing to do" is correct: the work was taken, not dropped.
    return null;
  }

  private claimOnce(workerId: string, lost: Set<string>): ServerRunRecord | "empty" | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const excluded = [...lost];
      const candidate = this.get(
        `SELECT id FROM skills_runs
         WHERE status IN (${CLAIMABLE_STATUSES.map(() => "?").join(", ")})
           ${excluded.length ? `AND id NOT IN (${excluded.map(() => "?").join(", ")})` : ""}
         ORDER BY created_at ASC, rowid ASC
         LIMIT 1`,
        [...CLAIMABLE_STATUSES, ...excluded],
      );
      if (!candidate) {
        this.db.exec("COMMIT");
        return "empty";
      }

      const id = String(candidate.id);
      const now = nowIso();
      const result = this.db.run(
        `UPDATE skills_runs
         SET status = 'running', started_at = COALESCE(started_at, ?), locked_by = ?, locked_at = ?,
             lease_generation = lease_generation + 1
         WHERE id = ? AND status IN (${CLAIMABLE_STATUSES.map(() => "?").join(", ")})`,
        [now, workerId, now, id, ...CLAIMABLE_STATUSES],
      );
      if (result.changes !== 1) {
        this.db.exec("ROLLBACK");
        lost.add(id);
        return null;
      }

      const row = this.get("SELECT * FROM skills_runs WHERE id = ? LIMIT 1", [id]);
      if (!row) {
        // Unreachable: the UPDATE above just reported one row changed for this id,
        // inside this transaction. Returning null here would COMMIT the claim and then
        // tell the caller the queue was empty, orphaning a run as `running` with a
        // locked_by and no worker - silent work loss with no error anywhere. Roll back
        // and raise instead, so the impossible case is loud rather than lossy.
        this.db.exec("ROLLBACK");
        throw new Error(`claimed run ${id} vanished within its own transaction; refusing to report a lost claim as an empty queue`);
      }
      this.db.exec("COMMIT");
      return rowToRun(row);
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    }
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">>,
  ): Promise<ServerRunRecord | null> {
    const current = this.get("SELECT * FROM skills_runs WHERE id = ? LIMIT 1", [id]);
    if (!current) return null;
    const run = { ...rowToRun(current), ...patch };
    const row = this.get(
      `UPDATE skills_runs
       SET status = ?, output_type = ?, output_preview = ?, error_code = ?, error_message = ?, started_at = ?, completed_at = ?
       WHERE id = ?
       RETURNING *`,
      [
        run.status,
        run.outputType ?? null,
        run.outputPreview ?? null,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        id,
      ],
    );
    return row ? rowToRun(row) : null;
  }

  /**
   * Generation-fenced transition: the WHERE re-asserts the caller's expected
   * lease_generation, so a write from a worker whose claim was fenced (by a
   * cancellation, or by a newer claim) reports zero rows and is refused.
   *
   * Unlike updateRun, the patch may also move lease_generation - that is how
   * the cancel service fences the current worker. The fence bump and the
   * status move land in the same statement, so there is no instant where the
   * status says cancelled and the generation still admits the old worker.
   */
  async transitionRun(id: string, patch: RunTransitionPatch, expectedGeneration: number): Promise<ServerRunRecord | null> {
    const current = this.get("SELECT * FROM skills_runs WHERE id = ? LIMIT 1", [id]);
    if (!current) return null;
    const stored = rowToRun(current);
    if (stored.leaseGeneration !== expectedGeneration) {
      throw new StaleLeaseGenerationError(id, expectedGeneration, stored.leaseGeneration, stored.status);
    }
    const run = { ...stored, ...patch };
    const row = this.get(
      `UPDATE skills_runs
       SET status = ?, output_type = ?, output_preview = ?, error_code = ?, error_message = ?, started_at = ?, completed_at = ?,
           lease_generation = ?
       WHERE id = ? AND lease_generation = ?
       RETURNING *`,
      [
        run.status,
        run.outputType ?? null,
        run.outputPreview ?? null,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.leaseGeneration,
        id,
        expectedGeneration,
      ],
    );
    return row ? rowToRun(row) : null;
  }

  async appendLog(id: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog> {
    // One statement rather than Postgres's MAX+1-then-INSERT pair: the subquery is
    // evaluated inside the INSERT's implicit transaction, so the sequence cannot be
    // handed out twice under the UNIQUE (run_id, sequence) constraint.
    const row = this.get(
      `INSERT INTO skills_run_logs (run_id, org_id, sequence, level, message, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM skills_run_logs WHERE run_id = ?), ?, ?, ?)
       RETURNING *`,
      [id, orgId, id, level, message, nowIso()],
    );
    return rowToLog(row!);
  }

  async listLogs(principal: ApiPrincipal, id: string): Promise<ServerRunLog[]> {
    return this.all(
      `SELECT l.* FROM skills_run_logs l
       JOIN skills_runs r ON r.id = l.run_id AND r.org_id = ?
       WHERE l.run_id = ?
       ORDER BY l.sequence ASC`,
      [principal.orgId, id],
    ).map(rowToLog);
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    const row = this.get(
      `INSERT INTO skills_artifacts (id, run_id, org_id, file_name, relative_path, content_type, byte_size, sha256, storage_kind, storage_key, body_text, visibility, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        artifact.id,
        artifact.runId,
        artifact.orgId,
        artifact.fileName,
        artifact.relativePath,
        artifact.contentType,
        artifact.byteSize,
        artifact.sha256,
        artifact.storageKind,
        artifact.storageKey ?? null,
        artifact.bodyText ?? null,
        artifact.visibility,
        artifact.expiresAt ?? null,
        nowIso(),
      ],
    );
    return rowToArtifact(row!);
  }

  async listArtifacts(principal: ApiPrincipal, id: string): Promise<ServerArtifact[]> {
    return this.all(
      `SELECT a.* FROM skills_artifacts a
       JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ?
       WHERE a.run_id = ?
       ORDER BY a.created_at ASC, a.rowid ASC`,
      [principal.orgId, id],
    ).map(rowToArtifact);
  }

  async getArtifact(principal: ApiPrincipal, id: string, artifact: string): Promise<ServerArtifact | null> {
    const row = this.get(
      `SELECT a.* FROM skills_artifacts a
       JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ?
       WHERE a.run_id = ? AND a.id = ?
       LIMIT 1`,
      [principal.orgId, id, artifact],
    );
    return row ? rowToArtifact(row) : null;
  }

  async publishSkill(input: PublishSkillInput): Promise<ServerSkillRecord> {
    const orgId = input.principal.orgId;
    const now = nowIso();
    return this.db.transaction(() => {
      // Read the outgoing digest before overwriting it, so the bundle it pointed at can
      // be collected if this republish leaves it referenced by nothing.
      const previous = this.get(
        "SELECT revision_id, revision_number, bundle_sha256, bundle_byte_size, skill_md, tombstoned_at, source FROM skills_registry WHERE org_id = ? AND slug = ?",
        [orgId, input.slug],
      );
      const previousSha = typeof previous?.bundle_sha256 === "string" ? previous.bundle_sha256 : null;
      const previousRevisionId = typeof previous?.revision_id === "string" && previous.revision_id ? previous.revision_id : null;
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
      const carriedSkillMd = typeof input.skillMd === "string" ? input.skillMd : (typeof previous?.skill_md === "string" ? previous.skill_md : null);
      // A live existing row requires If-Match naming its current revision. The pre-read
      // is only for the carried-forward bundle and the revision number: the ACTUAL guard
      // is the WHERE clause on the upsert below, evaluated against the row as it stands
      // at write time. SQLite has one writer (BEGIN IMMEDIATE), so the read-then-write
      // race the Postgres guard closes cannot happen here; the SQL guard is kept anyway
      // so the two backends enforce the same contract in the same place.
      if (previous && !tombstoned && input.expectedRevisionId !== previousRevisionId) {
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, previousRevisionId);
      }
      const carriedSha = input.bundle?.sha256 ?? previousSha;
      // Immutable versions (hasna/apps#1630), checked before any write.
      if (input.version && carriedSha) {
        const existingVersion = this.get(
          "SELECT bundle_sha256 FROM skills_versions WHERE org_id = ? AND slug = ? AND version = ? LIMIT 1",
          [orgId, input.slug, input.version],
        );
        const existingSha = typeof existingVersion?.bundle_sha256 === "string" ? existingVersion.bundle_sha256 : null;
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
        // Content-addressed: an identical digest is identical bytes, so re-uploading the
        // same bundle is a no-op rather than a conflict or a second copy.
        this.db.run(
          `INSERT INTO skills_bundles (org_id, sha256, byte_size, content_type, storage_kind, storage_key, body_blob, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (org_id, sha256) DO UPDATE SET
             byte_size = excluded.byte_size,
             content_type = excluded.content_type,
             storage_kind = excluded.storage_kind,
             storage_key = excluded.storage_key,
             body_blob = excluded.body_blob`,
          [
            orgId,
            input.bundle.sha256,
            input.bundle.byteSize,
            input.bundle.contentType,
            input.bundle.storageKind,
            input.bundle.storageKey ?? null,
            input.bundle.bytes ?? null,
            now,
          ],
        );
      }

      const row = this.get(
        `INSERT INTO skills_registry (org_id, slug, display_name, description, category, tags_json, source, kind, version, skill_md,
                                      bundle_sha256, bundle_byte_size, published_by_user_id, revision_id, revision_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (org_id, slug) DO UPDATE SET
           display_name = excluded.display_name,
           description = excluded.description,
           category = excluded.category,
           tags_json = excluded.tags_json,
           source = excluded.source,
           kind = excluded.kind,
           version = excluded.version,
           skill_md = excluded.skill_md,
           -- COALESCE, not a straight assignment. A publish that carries no bundle is a
           -- metadata update, not an instruction to discard the stored one: the plain
           -- assignment nulled bundle_sha256 and then handed the old digest to orphan
           -- collection, so re-publishing metadata over an existing skill deleted its
           -- tarball and left every client with a 404.
           bundle_sha256 = COALESCE(excluded.bundle_sha256, skills_registry.bundle_sha256),
           bundle_byte_size = COALESCE(excluded.bundle_byte_size, skills_registry.bundle_byte_size),
           published_by_user_id = excluded.published_by_user_id,
           revision_id = excluded.revision_id,
           -- Current + 1, not the inserted 1: on the update path the ACTUAL row's
           -- counter is the truth (it may have advanced since the pre-read, which is
           -- exactly what the WHERE guard below detects).
           revision_number = skills_registry.revision_number + 1,
           tombstoned_at = NULL,
           tombstone_purge_after = NULL,
           updated_at = excluded.updated_at
         WHERE (skills_registry.tombstoned_at IS NOT NULL OR skills_registry.revision_id = ?)
           AND (? = 0 OR (skills_registry.tombstoned_at IS NULL AND skills_registry.source = 'bundled'
             AND skills_registry.revision_id = ?))
         RETURNING *`,
        [
          orgId,
          input.slug,
          input.displayName,
          input.description,
          input.category,
          JSON.stringify(input.tags),
          input.source,
          input.kind,
          input.version ?? null,
          carriedSkillMd,
          input.bundle?.sha256 ?? null,
          input.bundle?.byteSize ?? null,
          input.principal.userId,
          revisionId,
          now,
          now,
          input.expectedRevisionId ?? NO_REVISION_SENTINEL,
          input.seedBundledOnly ? 1 : 0,
          input.expectedRevisionId ?? NO_REVISION_SENTINEL,
        ],
      );
      if (!row) {
        // WHERE matched nothing: the row is live and its revision moved on (or no guard
        // was supplied). Re-read for the truthful current id to report.
        const current = this.get("SELECT revision_id FROM skills_registry WHERE org_id = ? AND slug = ?", [orgId, input.slug]);
        const currentId = typeof current?.revision_id === "string" ? current.revision_id : null;
        throw new SkillRevisionConflictError(input.slug, input.expectedRevisionId, currentId);
      }
      // Only when this publish actually replaced the bundle. `input.bundle` being
      // absent now means "unchanged", so there is nothing superseded to collect.
      if (input.version && carriedSha) {
        this.db.run(
          `INSERT OR IGNORE INTO skills_versions (org_id, slug, version, bundle_sha256, bundle_byte_size, storage_kind, storage_key, manifest_json, published_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orgId,
            input.slug,
            input.version,
            carriedSha,
            carriedSize ?? 0,
            input.versionStorage?.storageKind ?? "db",
            input.versionStorage?.storageKey ?? null,
            JSON.stringify(input.versionManifest ?? {}),
            input.principal.userId ?? null,
            now,
          ],
        );
      }
      if (previousSha && input.bundle && previousSha !== input.bundle.sha256) this.collectOrphanBundle(orgId, previousSha);

      // Keep the tag projection (migration 0005) in step with the upsert, in
      // the same transaction: replace, never merge, so the projection is
      // exactly the row's current tags.
      this.db.run("DELETE FROM skills_tags WHERE org_id = ? AND slug = ?", [orgId, input.slug]);
      const insertTag = this.db.prepare("INSERT OR IGNORE INTO skills_tags (org_id, slug, tag) VALUES (?, ?, ?)");
      for (const tag of input.tags) {
        if (!tag.trim()) continue;
        insertTag.run(orgId, input.slug, tag);
      }
      return rowToSkill(row!);
    })();
  }

  async listSkills(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    await this.purgeExpiredTombstones(principal);
    return this.all(
      "SELECT * FROM skills_registry WHERE org_id = ? AND tombstoned_at IS NULL ORDER BY slug ASC",
      [principal.orgId],
    ).map(rowToSkill);
  }

  async getSkill(principal: ApiPrincipal, slug: string): Promise<ServerSkillRecord | null> {
    const row = this.get("SELECT * FROM skills_registry WHERE org_id = ? AND slug = ? LIMIT 1", [principal.orgId, slug]);
    return row ? rowToSkill(row) : null;
  }

  async setSkillLifecycle(principal: ApiPrincipal, slug: string, patch: SkillLifecyclePatch, expectedRevisionId?: string) {
    return this.db.transaction(() => {
      const rowCurrent = this.get("SELECT * FROM skills_registry WHERE org_id=? AND slug=? LIMIT 1", [principal.orgId, slug]);
      const current = rowCurrent ? rowToSkill(rowCurrent) : null;
      if (!current || current.tombstonedAt) return null;
      if (expectedRevisionId !== current.revisionId) throw new SkillRevisionConflictError(slug, expectedRevisionId, current.revisionId);
      if (patch.lifecycle === "archived" && current.lifecycle !== "archived") {
        const profiles = this.db.query("SELECT profile_id,selections_json FROM skills_profiles WHERE org_id=?").all(principal.orgId) as Array<{ profile_id: unknown; selections_json: unknown }>;
        const referencing = profiles.filter((profile) => {
          const selections = typeof profile.selections_json === "string" ? JSON.parse(profile.selections_json) : profile.selections_json;
          return Array.isArray(selections) && selections.some((selection) => selection?.slug === slug);
        }).map((profile) => String(profile.profile_id)).sort();
        if (referencing.length) throw new SkillLifecycleConflictError(slug, referencing);
      }
      const next = { ...current, lifecycle: patch.lifecycle, updatedAt: nowIso(), ...(patch.lifecycle === "archived" ? { archivedAt: current.archivedAt ?? nowIso(), ...(patch.reason ? { archiveReason: patch.reason } : {}), ...(patch.replacementSlug ? { replacementSlug: patch.replacementSlug } : {}) } : {}) };
      if (patch.lifecycle === "active") { delete next.archivedAt; delete next.archiveReason; delete next.replacementSlug; }
      const row = this.get("UPDATE skills_registry SET lifecycle=?, archived_at=?, archive_reason=?, replacement_slug=?, revision_id=?, revision_number=revision_number+1, updated_at=? WHERE org_id=? AND slug=? AND tombstoned_at IS NULL AND revision_id=? RETURNING *", [next.lifecycle, next.archivedAt ?? null, next.archiveReason ?? null, next.replacementSlug ?? null, revisionIdOfRecord(next), next.updatedAt, principal.orgId, slug, current.revisionId]);
      if (!row) throw new SkillRevisionConflictError(slug, expectedRevisionId, this.getSkillSync(principal, slug)?.revisionId ?? null);
      return rowToSkill(row);
    }).immediate();
  }

  private getSkillSync(principal: ApiPrincipal, slug: string): ServerSkillRecord | null {
    const row = this.get("SELECT * FROM skills_registry WHERE org_id=? AND slug=? LIMIT 1", [principal.orgId, slug]);
    return row ? rowToSkill(row) : null;
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
    return this.db.transaction(() => {
      const revisionId = revisionIdOfRecord(next);
      const row = this.get(
        `UPDATE skills_registry
         SET display_name = ?, description = ?, category = ?, tags_json = ?, kind = ?, version = ?, skill_md = ?,
             revision_id = ?, revision_number = revision_number + 1, updated_at = ?
         WHERE org_id = ? AND slug = ? AND tombstoned_at IS NULL AND revision_id = ?
         RETURNING *`,
        [
          next.displayName,
          next.description,
          next.category,
          JSON.stringify(next.tags),
          next.kind,
          next.version ?? null,
          next.skillMd ?? null,
          revisionId,
          nowIso(),
          principal.orgId,
          slug,
          current.revisionId,
        ],
      );
      if (!row) {
        // The WHERE guard matched nothing: between the pre-read above and this UPDATE the
        // row's revision advanced (a concurrent writer landed) or the row was tombstoned/
        // purged. A stale write must be a 409 REVISION_CONFLICT, never a 404 that falsely
        // claims the skill vanished — and never a silent overwrite. The read and UPDATE are
        // synchronous here, so this is defence for parity with the Postgres twin's race.
        const nowRow = this.get("SELECT revision_id, tombstoned_at FROM skills_registry WHERE org_id = ? AND slug = ? LIMIT 1", [
          principal.orgId,
          slug,
        ]);
        if (nowRow && nowRow.tombstoned_at == null) {
          const currentId = typeof nowRow.revision_id === "string" ? nowRow.revision_id : null;
          throw new SkillRevisionConflictError(slug, expectedRevisionId, currentId);
        }
        return null;
      }
      this.db.run("DELETE FROM skills_tags WHERE org_id = ? AND slug = ?", [principal.orgId, slug]);
      const insertTag = this.db.prepare("INSERT OR IGNORE INTO skills_tags (org_id, slug, tag) VALUES (?, ?, ?)");
      for (const tag of next.tags) {
        if (!tag.trim()) continue;
        insertTag.run(principal.orgId, slug, tag);
      }
      return rowToSkill(row);
    })();
  }

  async deleteSkill(principal: ApiPrincipal, slug: string, tombstoneWindowMs: number): Promise<ServerSkillRecord | null> {
    return this.db.transaction(() => {
      const existing = this.get("SELECT tombstoned_at FROM skills_registry WHERE org_id = ? AND slug = ?", [principal.orgId, slug]);
      if (!existing) return null;
      if (existing.tombstoned_at != null) {
        // Idempotent re-delete: keep the original tombstone (the window is not extended).
        const row = this.get("SELECT * FROM skills_registry WHERE org_id = ? AND slug = ? LIMIT 1", [principal.orgId, slug]);
        return rowToSkill(row!);
      }
      const tombstonedAt = nowIso();
      const purgeAfter = new Date(Date.now() + tombstoneWindowMs).toISOString();
      const row = this.get(
        `UPDATE skills_registry
         SET tombstoned_at = ?, tombstone_purge_after = ?, updated_at = ?
         WHERE org_id = ? AND slug = ?
         RETURNING *`,
        [tombstonedAt, purgeAfter, tombstonedAt, principal.orgId, slug],
      );
      return rowToSkill(row!);
    })();
  }

  async purgeExpiredTombstones(principal: ApiPrincipal): Promise<ServerSkillRecord[]> {
    return this.db.transaction(() => {
      const now = nowIso();
      const expired = this.all(
        "SELECT * FROM skills_registry WHERE org_id = ? AND tombstoned_at IS NOT NULL AND tombstone_purge_after <= ?",
        [principal.orgId, now],
      );
      const purged: ServerSkillRecord[] = [];
      for (const row of expired) {
        const record = rowToSkill(row);
        this.db.run("DELETE FROM skills_registry WHERE org_id = ? AND slug = ?", [principal.orgId, record.slug]);
        // The tag projection (migration 0005) dies with the purged row.
        this.db.run("DELETE FROM skills_tags WHERE org_id = ? AND slug = ?", [principal.orgId, record.slug]);
        if (record.bundleSha256) this.collectOrphanBundle(principal.orgId, record.bundleSha256);
        purged.push(record);
      }
      return purged;
    })();
  }

  async getSkillBundle(principal: ApiPrincipal, sha256: string): Promise<ServerSkillBundle | null> {
    const row = this.get("SELECT * FROM skills_bundles WHERE org_id = ? AND sha256 = ? LIMIT 1", [principal.orgId, sha256]);
    return row ? rowToSkillBundle(row) : null;
  }

  async listSkillVersions(principal: ApiPrincipal, slug: string): Promise<ServerSkillVersion[]> {
    return this.all(
      "SELECT * FROM skills_versions WHERE org_id = ? AND slug = ? ORDER BY created_at DESC, version DESC",
      [principal.orgId, slug],
    ).map(rowToSkillVersion);
  }

  async getSkillVersion(principal: ApiPrincipal, slug: string, version: string): Promise<ServerSkillVersion | null> {
    const row = this.get(
      "SELECT * FROM skills_versions WHERE org_id = ? AND slug = ? AND version = ? LIMIT 1",
      [principal.orgId, slug, version],
    );
    return row ? rowToSkillVersion(row) : null;
  }

  async getPublishedSelectionStates(principal: ApiPrincipal, selections: readonly PublishedSkillSelection[]): Promise<PublishedSkillSelectionState[]> {
    if (selections.length > MAX_PROFILE_SELECTIONS) throw new RangeError("Published selection lookup exceeds the profile selection limit");
    if (!selections.length) return [];
    const requested = JSON.stringify(selections.map(({ slug, version }) => ({ slug, version })));
    return this.all(
      `SELECT json_extract(q.value, '$.slug') AS slug, json_extract(q.value, '$.version') AS version,
         r.slug IS NOT NULL AS skill_exists, r.lifecycle, r.tombstoned_at,
         v.bundle_sha256, b.sha256 IS NOT NULL AS bundle_available
       FROM json_each(?) q
       LEFT JOIN skills_registry r ON r.org_id = ? AND r.slug = json_extract(q.value, '$.slug')
       LEFT JOIN skills_versions v ON v.org_id = ?
         AND v.slug = json_extract(q.value, '$.slug') AND v.version = json_extract(q.value, '$.version')
       LEFT JOIN skills_bundles b ON b.org_id = ? AND b.sha256 = v.bundle_sha256
       ORDER BY CAST(q.key AS INTEGER)`,
      [requested, principal.orgId, principal.orgId, principal.orgId],
    ).map(rowToPublishedSelectionState);
  }

  /*
   * Pins. Mirrors the Postgres twin statement for statement; the schema is
   * shared and the ON CONFLICT target is the composite primary key in both
   * dialects. Single statements, so no transaction is needed for atomicity.
   */
  async pinSkill(principal: ApiPrincipal, slug: string, metadata: Record<string, unknown> = {}): Promise<ServerPin> {
    const row = this.get(
      `INSERT INTO skills_pins (org_id, principal, slug, pinned_at, metadata_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (org_id, principal, slug) DO UPDATE SET
         pinned_at = excluded.pinned_at,
         metadata_json = excluded.metadata_json
       RETURNING *`,
      [principal.orgId, principal.apiKeyId, slug, nowIso(), JSON.stringify(metadata)],
    );
    return rowToPin(row!);
  }

  async unpinSkill(principal: ApiPrincipal, slug: string): Promise<boolean> {
    const result = this.db.run(
      "DELETE FROM skills_pins WHERE org_id = ? AND principal = ? AND slug = ?",
      [principal.orgId, principal.apiKeyId, slug],
    );
    return result.changes > 0;
  }

  async listPins(principal: ApiPrincipal): Promise<ServerPin[]> {
    return this.all(
      "SELECT * FROM skills_pins WHERE org_id = ? AND principal = ? ORDER BY slug ASC",
      [principal.orgId, principal.apiKeyId],
    ).map(rowToPin);
  }

  async listTags(principal: ApiPrincipal): Promise<string[]> {
    // Indexed: skills_tags_org_tag_idx (org_id, tag) serves the org filter;
    // the projection is kept in step by every write path below. sqlite cannot
    // index json_each() over the JSON column, which is why the projection
    // exists (migration 0005). Expired tombstones are purged first, like every
    // other read path in this store.
    await this.purgeExpiredTombstones(principal);
    return this.all(
      "SELECT DISTINCT t.tag FROM skills_tags t JOIN skills_registry s ON s.org_id=t.org_id AND s.slug=t.slug WHERE t.org_id = ? AND s.lifecycle='active' ORDER BY t.tag ASC",
      [principal.orgId],
    ).map((row) => String(row.tag));
  }

  async listSkillsByTag(principal: ApiPrincipal, tag: string): Promise<ServerSkillRecord[]> {
    await this.purgeExpiredTombstones(principal);
    return this.all(
      `SELECT s.* FROM skills_registry s
       JOIN skills_tags t ON t.org_id = s.org_id AND t.slug = s.slug
       WHERE t.org_id = ? AND t.tag = ? AND s.tombstoned_at IS NULL AND s.lifecycle = 'active'
       ORDER BY s.slug ASC`,
      [principal.orgId, tag],
    ).map(rowToSkill);
  }

  async listPinsByTag(principal: ApiPrincipal, tag: string): Promise<ServerPin[]> {
    // A pin whose slug has no live registry row (e.g. a bundled-only skill, or
    // a tombstoned one) carries no tags here; the app layer adds the
    // bundled-corpus half of that set.
    await this.purgeExpiredTombstones(principal);
    return this.all(
      `SELECT p.* FROM skills_pins p
       JOIN skills_tags t ON t.org_id = p.org_id AND t.slug = p.slug
       JOIN skills_registry s ON s.org_id = p.org_id AND s.slug = p.slug
       WHERE p.org_id = ? AND p.principal = ? AND t.tag = ? AND s.tombstoned_at IS NULL AND s.lifecycle = 'active'
       ORDER BY p.slug ASC`,
      [principal.orgId, principal.apiKeyId, tag],
    ).map(rowToPin);
  }

  async listPublishedSlugs(principal: ApiPrincipal): Promise<string[]> {
    return this.all(
      "SELECT slug FROM skills_registry WHERE org_id = ? AND tombstoned_at IS NULL ORDER BY slug ASC",
      [principal.orgId],
    ).map((row) => String(row.slug));
  }

  /**
   * Drop a bundle no remaining skill in the org points at.
   *
   * The reference count is over skills_registry rather than a stored counter: a counter
   * would be a second source of truth for something one COUNT(*) answers exactly, and a
   * drifted counter either leaks blobs forever or deletes a bundle still in use.
   */
  private collectOrphanBundle(orgId: string, sha256: string): void {
    const referenced = this.get(
      "SELECT 1 AS present FROM skills_registry WHERE org_id = ? AND bundle_sha256 = ? LIMIT 1",
      [orgId, sha256],
    ) ?? this.get(
      "SELECT 1 AS present FROM skills_versions WHERE org_id = ? AND bundle_sha256 = ? LIMIT 1",
      [orgId, sha256],
    );
    if (referenced) return;
    this.db.run("DELETE FROM skills_bundles WHERE org_id = ? AND sha256 = ?", [orgId, sha256]);
  }

  private get(sql: string, params: unknown[]): Record<string, unknown> | null {
    return (this.db.query(sql).get(...(params as never[])) as Record<string, unknown> | null) ?? null;
  }

  private all(sql: string, params: unknown[]): Record<string, unknown>[] {
    return this.db.query(sql).all(...(params as never[])) as Record<string, unknown>[];
  }

  private rollbackQuietly(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back, or the transaction never opened. The original error is the
      // one worth surfacing; masking it with a rollback failure helps nobody.
    }
  }
}

/**
 * Apply pending migrations/sqlite/*.sql to an open database.
 *
 * The applied-version key is the file's basename, identical to the Postgres migrator's,
 * so moving migrations/0001_*.sql into migrations/postgres/ did not orphan any database
 * that had already applied it.
 */
export function applySqliteMigrations(db: Database, migrationsDir = resolveMigrationsDir("sqlite")): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no .sql migrations found in ${migrationsDir}`);
  }

  const appliedNow: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const text = readFileSync(join(migrationsDir, file), "utf8");

    // IMMEDIATE, and the already-applied check happens INSIDE the transaction.
    //
    // Migrating on open means several processes can migrate the same fresh file at the
    // same moment - which is exactly what the zero-config topology does, starting
    // `skills-server` and `skills-worker` together. Reading the applied set once up
    // front and then opening a deferred transaction let every process decide "not
    // applied" before any of them wrote: the DDL survived on CREATE TABLE IF NOT EXISTS,
    // and then every loser died on `UNIQUE constraint failed: schema_migrations.version`.
    // Measured: 5 of 6 concurrent first opens failed that way.
    //
    // BEGIN IMMEDIATE takes the write lock before the check, so exactly one process is
    // ever deciding; the others block on busy_timeout and then find the row present and
    // skip. Re-reading inside the transaction is the load-bearing half - without it the
    // lock would only serialise the same wrong decision.
    const apply = db.transaction(() => {
      const already = db.query("SELECT 1 AS present FROM schema_migrations WHERE version = ? LIMIT 1").get(version);
      if (already) return false;
      db.exec(text);
      db.run("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
      return true;
    });
    if (apply.immediate()) appliedNow.push(version);
  }
  return appliedNow;
}

/**
 * Switch the database into WAL, retrying while another connection is converting it.
 *
 * busy_timeout does not cover this. SQLite's busy handler is not invoked for a
 * journal_mode change - the statement returns SQLITE_BUSY immediately if any other
 * connection has the database open - so setting busy_timeout first is necessary but not
 * sufficient. Measured with the timeout set and no retry: 6 of 12 barrier-synchronised
 * rounds had at least one of six processes die with a bare "database is locked".
 *
 * The retry is a synchronous sleep because bun:sqlite is synchronous and this runs
 * inside a constructor at startup. The window it covers is one process's conversion of
 * an empty file; once any process has converted it, every other `PRAGMA journal_mode =
 * WAL` is a no-op that returns "wal" immediately.
 *
 * Returns false rather than throwing if the conversion never succeeds. WAL is a
 * concurrency optimisation, not a correctness requirement: claiming is safe in
 * rollback-journal mode too, because it rests on BEGIN IMMEDIATE and busy_timeout. A
 * slower server beats a server that will not start.
 */
function enableWalMode(db: Database, attempts = 50, pauseMs = 10): boolean {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (journalMode(db) === "wal") return true;
    try {
      if (String((db.query("PRAGMA journal_mode = WAL").get() as { journal_mode?: string } | null)?.journal_mode).toLowerCase() === "wal") {
        return true;
      }
    } catch {
      // SQLITE_BUSY: another connection is converting, or holds a read lock on a
      // database still in rollback-journal mode. Both clear on their own.
    }
    Bun.sleepSync(pauseMs);
  }
  return false;
}

function journalMode(db: Database): string {
  try {
    return String((db.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null)?.journal_mode ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Open the database file, turning SQLite's context-free errors into ones an operator
 * can act on.
 *
 * Raw bun:sqlite reports "unable to open database file" identically for a read-only
 * mount, a missing parent directory, and a path that is a directory, and "file is not a
 * database" with no indication of which file. Since this path is now reached by every
 * server that starts with no configuration at all, the message has to say what was
 * being opened and which setting moves it.
 */
function openDatabase(path: string): Database {
  try {
    return new Database(path, { create: true, readwrite: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot open the skills database at ${path}: ${reason}. ` +
        "Check that the directory exists and is writable. Set HASNA_SKILLS_DATABASE_URL to choose a " +
        "different path or a postgres:// URL, or HASNA_SKILLS_DIR to relocate the whole data directory.",
      { cause: error },
    );
  }
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
