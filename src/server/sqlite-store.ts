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
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashApiKey, publicPrincipal } from "./auth.js";
import { SQLITE_MEMORY_PATH } from "./database-url.js";
import { resolveMigrationsDir } from "./migrations-dir.js";
import { nowIso, normalizeLimit, rowToArtifact, rowToLog, rowToRun, runId } from "./rows.js";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  ServerArtifact,
  ServerRunLog,
  ServerRunRecord,
  SkillsProductStore,
  StoreBackendInfo,
} from "./types.js";

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

/** How stale api_keys.last_used_at is allowed to get before authentication refreshes it. */
const LAST_USED_RESOLUTION_MS = 60_000;

export class SqliteSkillsStore implements SkillsProductStore {
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

    this.backend = {
      kind: "sqlite",
      durable: !inMemory,
      label: inMemory ? "sqlite (in-memory)" : `sqlite (${path})`,
    };
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
         SET status = 'running', started_at = COALESCE(started_at, ?), locked_by = ?, locked_at = ?
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
      `INSERT INTO skills_artifacts (id, run_id, org_id, file_name, relative_path, content_type, byte_size, sha256, storage_kind, storage_key, body_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
