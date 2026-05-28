import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const migrationsDir = join(process.cwd(), "drizzle");
const databaseUrl = process.env.DATABASE_URL;

const expectedTables = [
  "agent_mcp_registrations",
  "approval_decisions",
  "approval_events",
  "approval_requests",
  "billing_customers",
  "credit_balances",
  "credit_transactions",
  "invoices",
  "organizations",
  "payment_events",
  "pin_events",
  "run_artifacts",
  "run_events",
  "run_logs",
  "run_steps",
  "skill_aliases",
  "skill_artifacts",
  "skill_entitlements",
  "skill_pins",
  "skill_runs",
  "skill_sources",
  "skill_versions",
  "skills",
  "subscriptions",
];

const rlsProtectedTables = [
  "agent_mcp_registrations",
  "approval_decisions",
  "approval_events",
  "approval_requests",
  "billing_customers",
  "credit_balances",
  "credit_transactions",
  "invoices",
  "organizations",
  "payment_events",
  "pin_events",
  "run_artifacts",
  "run_events",
  "run_logs",
  "run_steps",
  "sessions",
  "skill_entitlements",
  "skill_pins",
  "skill_runs",
  "api_keys",
  "users",
  "subscriptions",
];

function requireDatabaseUrl() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return databaseUrl;
}

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function loadMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}`);
  }

  return files.map((file) => {
    const path = join(migrationsDir, file);
    const sql = readFileSync(path, "utf8");
    return {
      id: file,
      path,
      sql,
      checksum: checksum(sql),
    };
  });
}

async function verifyExpectedTables(client: Client) {
  const expectedTablePlaceholders = expectedTables
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  const verification = await client.query<{ count: string }>(
    `select count(*) from information_schema.tables where table_schema = 'public' and table_name in (${expectedTablePlaceholders})`,
    expectedTables,
  );
  const actualCount = Number(verification.rows[0]?.count ?? 0);

  if (actualCount !== expectedTables.length) {
    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    throw new Error(
      `Expected ${expectedTables.length} platform tables, found ${actualCount}: ${tables.rows
        .map((row) => row.table_name)
        .join(", ")}`,
    );
  }

  return actualCount;
}

async function verifyRowLevelSecurity(client: Client) {
  const enabledRows = await client.query<{ table_name: string }>(
    `
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity = true
        and c.relname = any($1::text[])
    `,
    [rlsProtectedTables],
  );
  const enabled = new Set(enabledRows.rows.map((row) => row.table_name));
  const missingRls = rlsProtectedTables.filter((table) => !enabled.has(table));
  if (missingRls.length > 0) {
    throw new Error(`Missing row-level security on tables: ${missingRls.join(", ")}`);
  }

  const forcedRows = await client.query<{ table_name: string }>(
    `
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relforcerowsecurity = true
        and c.relname = any($1::text[])
    `,
    [rlsProtectedTables],
  );
  const forced = new Set(forcedRows.rows.map((row) => row.table_name));
  const missingForcedRls = rlsProtectedTables.filter((table) => !forced.has(table));
  if (missingForcedRls.length > 0) {
    throw new Error(`Missing forced row-level security on tables: ${missingForcedRls.join(", ")}`);
  }

  const policyRows = await client.query<{ tablename: string }>(
    `
      select tablename
      from pg_policies
      where schemaname = 'public'
        and policyname = 'org_isolation'
        and tablename = any($1::text[])
    `,
    [rlsProtectedTables],
  );
  const withPolicy = new Set(policyRows.rows.map((row) => row.tablename));
  const missingPolicy = rlsProtectedTables.filter((table) => !withPolicy.has(table));
  if (missingPolicy.length > 0) {
    throw new Error(`Missing org_isolation RLS policy on tables: ${missingPolicy.join(", ")}`);
  }
}

async function main() {
  const client = new Client({
    connectionString: requireDatabaseUrl(),
  });

  await client.connect();

  try {
    await client.query(`
      create table if not exists platform_schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const migrations = loadMigrations();
    let applied = 0;
    let skipped = 0;

    for (const migration of migrations) {
      const existing = await client.query<{ checksum: string }>(
        "select checksum from platform_schema_migrations where id = $1",
        [migration.id],
      );

      if (existing.rowCount === 1) {
        if (existing.rows[0].checksum !== migration.checksum) {
          throw new Error(`Checksum mismatch for already-applied migration ${migration.id}`);
        }
        skipped += 1;
        continue;
      }

      console.log(`Applying migration ${migration.id}`);
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into platform_schema_migrations (id, checksum) values ($1, $2)",
          [migration.id, migration.checksum],
        );
        await client.query("commit");
        applied += 1;
      } catch (error) {
        await client.query("rollback");
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.id} failed: ${message}`);
      }
    }

    const actualCount = await verifyExpectedTables(client);
    await verifyRowLevelSecurity(client);

    console.log(
      `Applied ${applied} migrations, skipped ${skipped}, verified ${actualCount} tables and ${rlsProtectedTables.length} forced RLS policies.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
