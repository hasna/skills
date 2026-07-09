#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveServerConfig } from "./config.js";

type SqlTag = {
  unsafe(query: string): Promise<unknown>;
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

export async function runMigrations(databaseUrl: string, migrationsDir = join(process.cwd(), "migrations")): Promise<string[]> {
  if (!existsSync(migrationsDir)) throw new Error(`migrations directory not found: ${migrationsDir}`);
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => SqlTag };
  const sql = new bunWithSql.SQL(databaseUrl, { max: 1 });
  await sql.unsafe("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const appliedRows = await sql`SELECT version FROM schema_migrations`;
  const applied = new Set((appliedRows as Array<{ version: string }>).map((row) => row.version));
  const appliedNow: string[] = [];

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
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
}

if (import.meta.main) {
  const config = resolveServerConfig();
  if (!config.databaseUrl) throw new Error("HASNA_SKILLS_DATABASE_URL or DATABASE_URL is required for migrations");
  const applied = await runMigrations(config.databaseUrl);
  console.log(JSON.stringify({ applied, count: applied.length }, null, 2));
}
