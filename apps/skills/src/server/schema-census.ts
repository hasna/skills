import { SQL } from "bun";

/**
 * One fixed, closed census of the Skills database maintenance surface.
 *
 * Why it exists (I6-00024): a production migration is held until the exact
 * current registry, version ledger and migration ledger are read from the live
 * database. The enrollment inspection answers a different question (one
 * operator key), and no existing reader returns the fixed aggregate + ledger
 * census. This module is that reader, and it is deliberately shaped so it
 * cannot become a general SQL console:
 *
 *   - No target, query, schema or table input exists. The only argument is the
 *     database URL, and the operation refuses to run unless the connection
 *     resolves to the fixed public schema the Skills store uses.
 *   - Every owned-table read is schema-qualified to `public`. A connection whose
 *     search path falls through to a later schema cannot substitute another
 *     schema's tables: a missing public table refuses (CENSUS_SCHEMA_UNAVAILABLE)
 *     instead of counting rows that do not belong to the fixed target.
 *   - The transaction is READ ONLY, REPEATABLE READ, with a five-second
 *     statement timeout and a one-second lock timeout, asserted from inside the
 *     read path rather than assumed.
 *   - The output is a closed shape with per-field size bounds, a bounded
 *     migration ledger and a total serialized-size gate. Nothing is truncated
 *     silently: a census that would exceed a bound refuses instead.
 *   - Nothing imports the application store: no initialization, migrations,
 *     backfills or writes happen on this path.
 */
export interface SchemaCensusResult {
  status: "inspected";
  database: string;
  role: string;
  serverVersion: string;
  schema: "public";
  transaction: {
    readOnly: true;
    isolation: "repeatable read";
    statementTimeoutMs: number;
    lockTimeoutMs: number;
  };
  migrations: { count: number; versions: string[] };
  registry: { rows: number };
  versions: { rows: number };
  lifecycle: {
    active: { live: number; tombstoned: number };
    archived: { live: number; tombstoned: number };
  };
  authorizationEpoch: { exists: false } | { exists: true; nullCount: number };
}

type CensusCode =
  | "CENSUS_POSTGRES_REQUIRED"
  | "CENSUS_SCHEMA_UNAVAILABLE"
  | "CENSUS_ACCESS_DENIED"
  | "CENSUS_WRITE_REFUSED"
  | "CENSUS_TIMEOUT"
  | "CENSUS_CONNECTION_FAILED"
  | "CENSUS_TARGET_MISMATCH"
  | "CENSUS_INVALID_RESULT"
  | "CENSUS_OUTPUT_UNBOUNDED"
  | "CENSUS_FAILED";

export class SchemaCensusError extends Error {
  constructor(readonly code: CensusCode) {
    super(code);
    this.name = "SchemaCensusError";
  }
}

const refuse: (code: CensusCode) => never = (code) => { throw new SchemaCensusError(code); };

/** The Skills store lives in the default public schema; any other resolution is a different target. */
const FIXED_SCHEMA = "public";
const STATEMENT_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 1_000;
/** Closed output bounds. A census over these limits refuses; it never truncates. */
const MAX_MIGRATION_VERSIONS = 128;
const MAX_MIGRATION_VERSION_CHARS = 64;
const MAX_IDENTIFIER_CHARS = 128;
const MAX_SERVER_VERSION_CHARS = 256;
const MAX_CENSUS_BYTES = 16 * 1024;

/** Shape violations are invalid results; size violations are unbounded output. Neither is truncated. */
const boundedText = (value: unknown, max: number): string => {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) return refuse("CENSUS_INVALID_RESULT");
  if (value.length > max) return refuse("CENSUS_OUTPUT_UNBOUNDED");
  return value;
};

const boundedCount = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return refuse("CENSUS_INVALID_RESULT");
  return value;
};

/**
 * Census metadata only. Deliberately does not import or initialize the application store.
 *
 * @param databaseUrl explicit PostgreSQL URL; there is no implicit localhost fallback.
 */
export async function inspectSchemaCensus(databaseUrl: string): Promise<SchemaCensusResult> {
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) refuse("CENSUS_POSTGRES_REQUIRED");
  } catch {
    refuse("CENSUS_POSTGRES_REQUIRED");
  }

  let sql: SQL | undefined;
  try {
    sql = new SQL(databaseUrl, { max: 1, connectionTimeout: 5, idleTimeout: 5 });
    return await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx): Promise<SchemaCensusResult> => {
      await tx.unsafe("SET LOCAL statement_timeout = '5s'");
      await tx.unsafe("SET LOCAL lock_timeout = '1s'");
      // Assert the transaction boundary from inside the read path; report it only after this passes.
      const mode = await tx`SELECT current_setting('transaction_read_only') AS read_only,
        current_setting('transaction_isolation') AS isolation,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout`;
      if (mode.length !== 1 || mode[0].read_only !== "on" || mode[0].isolation !== "repeatable read"
          || mode[0].statement_timeout !== "5s" || mode[0].lock_timeout !== "1s") {
        refuse("CENSUS_FAILED");
      }

      const identity = await tx`SELECT current_database() AS database, current_user AS role,
        version() AS server_version, current_schema() AS schema`;
      if (identity.length !== 1) refuse("CENSUS_INVALID_RESULT");
      const database = boundedText(identity[0].database, MAX_IDENTIFIER_CHARS);
      const role = boundedText(identity[0].role, MAX_IDENTIFIER_CHARS);
      const serverVersion = boundedText(identity[0].server_version, MAX_SERVER_VERSION_CHARS);
      if (identity[0].schema !== FIXED_SCHEMA) refuse("CENSUS_TARGET_MISMATCH");

      // Ordered ledger: one extra row distinguishes "too many versions" from a complete read.
      // Every owned-table read below is qualified to the fixed schema; search_path never selects it.
      const ledger = await tx`SELECT version FROM public.schema_migrations ORDER BY version LIMIT ${MAX_MIGRATION_VERSIONS + 1}`;
      if (ledger.length > MAX_MIGRATION_VERSIONS) refuse("CENSUS_OUTPUT_UNBOUNDED");
      const versions = ledger.map((row: { version?: unknown }) => boundedText(row.version, MAX_MIGRATION_VERSION_CHARS));

      const registryCount = await tx`SELECT count(*)::int AS rows FROM public.skills_registry`;
      const versionCount = await tx`SELECT count(*)::int AS rows FROM public.skills_versions`;
      if (registryCount.length !== 1 || versionCount.length !== 1) refuse("CENSUS_INVALID_RESULT");
      const registryRows = boundedCount(registryCount[0].rows);
      const versionRows = boundedCount(versionCount[0].rows);

      // Two lifecycle values times two tombstone states is the whole closed group space.
      const groups = await tx`SELECT lifecycle, (tombstoned_at IS NOT NULL) AS tombstoned, count(*)::int AS rows
        FROM public.skills_registry GROUP BY 1, 2 LIMIT 5`;
      if (groups.length > 4) refuse("CENSUS_INVALID_RESULT");
      const lifecycle: SchemaCensusResult["lifecycle"] = { active: { live: 0, tombstoned: 0 }, archived: { live: 0, tombstoned: 0 } };
      for (const group of groups as Array<{ lifecycle?: unknown; tombstoned?: unknown; rows?: unknown }>) {
        const name = group.lifecycle;
        const tombstoned = group.tombstoned;
        if ((name !== "active" && name !== "archived") || typeof tombstoned !== "boolean") return refuse("CENSUS_INVALID_RESULT");
        lifecycle[name][tombstoned ? "tombstoned" : "live"] = boundedCount(group.rows);
      }

      // Pre-0011 databases have no epoch column; the census reports that instead of inventing a count.
      const epochColumn = await tx`SELECT count(*)::int AS rows FROM information_schema.columns
        WHERE table_schema = ${FIXED_SCHEMA} AND table_name = 'skills_registry' AND column_name = 'authorization_epoch'`;
      if (epochColumn.length !== 1) refuse("CENSUS_INVALID_RESULT");
      const epochPresent = boundedCount(epochColumn[0].rows);
      if (epochPresent > 1) refuse("CENSUS_INVALID_RESULT");
      let authorizationEpoch: SchemaCensusResult["authorizationEpoch"];
      if (epochPresent === 0) authorizationEpoch = { exists: false };
      else {
        const epochNulls = await tx`SELECT count(*)::int AS rows FROM public.skills_registry WHERE authorization_epoch IS NULL`;
        if (epochNulls.length !== 1) refuse("CENSUS_INVALID_RESULT");
        authorizationEpoch = { exists: true, nullCount: boundedCount(epochNulls[0].rows) };
      }

      const result: SchemaCensusResult = {
        status: "inspected",
        database,
        role,
        serverVersion,
        schema: FIXED_SCHEMA,
        transaction: { readOnly: true, isolation: "repeatable read", statementTimeoutMs: STATEMENT_TIMEOUT_MS, lockTimeoutMs: LOCK_TIMEOUT_MS },
        migrations: { count: versions.length, versions },
        registry: { rows: registryRows },
        versions: { rows: versionRows },
        lifecycle,
        authorizationEpoch,
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_CENSUS_BYTES) refuse("CENSUS_OUTPUT_UNBOUNDED");
      return result;
    });
  } catch (error) {
    if (error instanceof SchemaCensusError) throw error;
    // Never retain a driver message, cause, query, URL or unrecognized code.
    const state = error instanceof SQL.PostgresError ? error.errno : undefined;
    const code: CensusCode = state === "42P01" || state === "42703" ? "CENSUS_SCHEMA_UNAVAILABLE"
      : state === "42501" ? "CENSUS_ACCESS_DENIED"
      : state === "25006" ? "CENSUS_WRITE_REFUSED"
      : state === "57014" || state === "55P03" ? "CENSUS_TIMEOUT"
      : ["08000", "08001", "08003", "08004", "08006", "08007", "08P01", "28000", "28P01", "57P03"].includes(state ?? "")
        ? "CENSUS_CONNECTION_FAILED" : "CENSUS_FAILED";
    throw new SchemaCensusError(code);
  } finally {
    try { await sql?.close({ timeout: 1 }); }
    catch { throw new SchemaCensusError("CENSUS_FAILED"); }
  }
}
