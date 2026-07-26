#!/usr/bin/env bun
/**
 * Schema migration for whichever backend is configured.
 *
 * Migrations are per-dialect files, not one file rewritten at runtime. Both approaches
 * were on the table; the parallel set won because a runtime translator would have to
 * turn `jsonb`, `timestamptz`, `bigserial`, `::jsonb` casts, `now()` defaults, and
 * `CREATE EXTENSION` into SQLite as a text transformation, and would silently mistranslate
 * the first construct a future migration used that the translator had never seen - on
 * the operator's machine, at migrate time, against their real data. Two hand-written
 * files fail at review time instead, and src/server/schema-parity.test.ts executes the
 * SQLite one and diffs its real introspected shape against the Postgres DDL so the pair
 * cannot drift.
 *
 * Applied-version keys are file basenames, so migrations/0001_*.sql moving into
 * migrations/postgres/ did not orphan databases that had already applied it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveServerConfig } from "./config.js";
import { resolveDatabaseTarget, type DatabaseTarget } from "./database-url.js";
import { resolveMigrationsDir } from "./migrations-dir.js";
import { SqliteSkillsStore, applySqliteMigrations } from "./sqlite-store.js";

type SqlTag = {
  unsafe(query: string): Promise<unknown>;
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  close?: () => Promise<void>;
};

export interface MigrationResult {
  backend: DatabaseTarget["kind"];
  applied: string[];
}

/**
 * Apply pending migrations to whatever backend `databaseUrl` names.
 *
 * @param migrationsDir override for the directory holding this dialect's .sql files.
 * Defaults to the dialect subdirectory of the package's migrations/ folder.
 */
export async function runMigrations(databaseUrl?: string, migrationsDir?: string): Promise<MigrationResult> {
  const target = resolveDatabaseTarget(databaseUrl);
  if (target.kind === "memory") {
    throw new Error("the memory store has no schema to migrate; configure a sqlite path or a postgres:// URL");
  }
  if (target.kind === "sqlite") {
    // Opening the store is the migration: SqliteSkillsStore applies pending files on
    // construction, which is what makes an unconfigured `skills-server` work with no
    // separate migrate step. Running it here too is a no-op for an up-to-date database
    // and the whole job for a fresh one.
    const store = new SqliteSkillsStore(target.path, { migrate: false, ...(migrationsDir ? { migrationsDir } : {}) });
    try {
      const applied = applySqliteMigrations(store.database, migrationsDir ?? resolveMigrationsDir("sqlite"));
      return { backend: "sqlite", applied };
    } finally {
      await store.close();
    }
  }
  return { backend: "postgres", applied: await runPostgresMigrations(target.url, migrationsDir ?? resolveMigrationsDir("postgres")) };
}

async function runPostgresMigrations(databaseUrl: string, migrationsDir: string): Promise<string[]> {
  if (!existsSync(migrationsDir)) throw new Error(`migrations directory not found: ${migrationsDir}`);
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => SqlTag };
  const sql = new bunWithSql.SQL(databaseUrl, { max: 1 });
  try {
    await sql.unsafe("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const appliedRows = await sql`SELECT version FROM schema_migrations`;
    const applied = new Set((appliedRows as Array<{ version: string }>).map((row) => row.version));
    const appliedNow: string[] = [];

    const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    if (files.length === 0) throw new Error(`no .sql migrations found in ${migrationsDir}`);

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;
      const sqlText = readFileSync(join(migrationsDir, file), "utf8");
      await sql.unsafe("BEGIN");
      try {
        await sql.unsafe(sqlText);
        await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
        await sql.unsafe("COMMIT");
        appliedNow.push(version);
      } catch (error) {
        await sql.unsafe("ROLLBACK");
        throw error;
      }
    }
    return appliedNow;
  } finally {
    await sql.close?.();
  }
}

if (import.meta.main) {
  const config = resolveServerConfig();
  const result = await runMigrations(config.databaseUrl);
  console.log(JSON.stringify({ ...result, count: result.applied.length }, null, 2));
}
