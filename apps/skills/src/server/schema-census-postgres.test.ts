import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { inspectSchemaCensus } from "./schema-census.js";
useDefaultTestTimeout();

// Never use the application's database variable or an implicit localhost service.
// The runner must provision a fresh disposable cluster/database whose login role owns the
// database: the fixture creates schemas and views, so CREATE on the database (not merely on
// the public schema) is part of the contract.
const url = process.env.HASNA_SKILLS_CENSUS_TEST_DATABASE_URL;

function fixtureUrl(): string {
  const target = new URL(url!);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.pathname).toBe("/skills_census_fixture");
  expect(target.username).toBe("census_fixture");
  return url!;
}

const ledger = ["0003_skill_versions", "0001_open_skills_self_hosted", "0002_org_scoped_skill_registry"];

test.skipIf(!url)("census reports the fixed migration ledger and aggregates without leaking row content", async () => {
  const fixture = fixtureUrl();
  const sql = new SQL(fixture, { max: 1 });
  try {
    // No IF NOT EXISTS and no cleanup: a reused or nonempty fixture is a refusal, not permission to clear it.
    await sql.unsafe("CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await sql.unsafe(`CREATE TABLE skills_registry (
      org_id text NOT NULL, slug text NOT NULL, display_name text NOT NULL DEFAULT '',
      lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived')),
      tombstoned_at timestamptz, revision_id text NOT NULL DEFAULT '', revision_number integer NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, slug))`);
    await sql.unsafe(`CREATE TABLE skills_versions (
      org_id text NOT NULL, slug text NOT NULL, version text NOT NULL, bundle_sha256 text NOT NULL DEFAULT '',
      PRIMARY KEY (org_id, slug, version))`);
    for (const version of ledger) await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
    await sql`INSERT INTO skills_registry VALUES ('org-fixture', 'live-one', 'PRIVATE_FIXTURE_SENTINEL', 'active', NULL, '', 0)`;
    await sql`INSERT INTO skills_registry VALUES ('org-fixture', 'buried-one', '', 'active', '2026-01-01T00:00:00Z', '', 0)`;
    await sql`INSERT INTO skills_registry VALUES ('org-fixture', 'archived-one', '', 'archived', NULL, '', 0)`;
    await sql`INSERT INTO skills_versions VALUES ('org-fixture', 'live-one', '1.0.0', 'a')`;
    await sql`INSERT INTO skills_versions VALUES ('org-fixture', 'live-one', '1.1.0', 'b')`;

    const census = await inspectSchemaCensus(fixture);
    expect(census).toEqual({
      status: "inspected",
      database: "skills_census_fixture",
      role: "census_fixture",
      serverVersion: expect.any(String),
      schema: "public",
      transaction: { readOnly: true, isolation: "repeatable read", statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
      migrations: { count: 3, versions: [...ledger].sort() },
      registry: { rows: 3 },
      versions: { rows: 2 },
      lifecycle: { active: { live: 1, tombstoned: 1 }, archived: { live: 1, tombstoned: 0 } },
      authorizationEpoch: { exists: false },
    });
    expect(census.serverVersion).toContain("PostgreSQL");
    // Row content is never part of the census: a distinguishing value in the row must not surface.
    expect(JSON.stringify(census)).not.toContain("PRIVATE_FIXTURE_SENTINEL");

    // The native command path: the protected wrapper's invocation, its own manifest and receipt,
    // and the fixed authorization echo.
    const dir = mkdtempSync(join(tmpdir(), "census-fixture-"));
    const manifest: Record<string, unknown> = {
      app: "skills", operation: "inspect-schema", manifestVersion: 1,
      operationId: "fixture-census", stationId: "fixture-station", keyId: "fixture-key", orgId: "fixture-org",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    manifest.manifestDigest = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
    const manifestBytes = JSON.stringify(manifest);
    writeFileSync(join(dir, "manifest.json"), manifestBytes);
    writeFileSync(join(dir, "receipt.json"), JSON.stringify({
      manifestBytesSha256: createHash("sha256").update(manifestBytes).digest("hex"),
      operatorJobId: "fixture-job", operatorTaskArn: "fixture-task",
      taskDefinitionArn: "fixture-definition", verifiedAt: new Date().toISOString(),
    }));
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "maintenance.ts"),
      "maintenance", "inspect-schema", "--manifest", join(dir, "manifest.json"),
      "--operator-receipt", join(dir, "receipt.json"), "--json"], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, HASNA_SKILLS_DATABASE_URL: fixture },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "inspected", database: "skills_census_fixture", schema: "public",
      operationId: "fixture-census", keyId: "fixture-key", orgId: "fixture-org", stationId: "fixture-station",
      migrations: { count: 3 },
    });

    // The epoch column is reported only when it exists; 0011 adds it as NOT NULL, but the census
    // reports the observed null count rather than assuming it, so both states are exercised.
    await sql.unsafe("ALTER TABLE skills_registry ADD COLUMN authorization_epoch text");
    expect((await inspectSchemaCensus(fixture)).authorizationEpoch).toEqual({ exists: true, nullCount: 3 });
    await sql`UPDATE skills_registry SET authorization_epoch = ${"a".repeat(32)}`;
    expect((await inspectSchemaCensus(fixture)).authorizationEpoch).toEqual({ exists: true, nullCount: 0 });

    // Bounded output: an over-long ledger or an over-long version refuses instead of truncating.
    for (let index = 0; index < 126; index++) await sql`INSERT INTO schema_migrations (version) VALUES (${`over-${String(index).padStart(3, "0")}`})`;
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_OUTPUT_UNBOUNDED", message: "CENSUS_OUTPUT_UNBOUNDED" });
    await sql`DELETE FROM schema_migrations WHERE version LIKE 'over-%'`;
    await sql`INSERT INTO schema_migrations (version) VALUES (${"v".repeat(65)})`;
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_OUTPUT_UNBOUNDED" });
    await sql`DELETE FROM schema_migrations WHERE version = ${"v".repeat(65)}`;
    expect((await inspectSchemaCensus(fixture)).migrations.count).toBe(3);
  } finally {
    await sql.close({ timeout: 1 });
  }
});

test.skipIf(!url)("census refuses a moved table, a substituted schema and a write through its read path", async () => {
  const fixture = fixtureUrl();
  const sql = new SQL(fixture, { max: 1 });
  try {
    // A table that resolves outside the fixed public schema is a different target, not a census.
    await sql.unsafe("CREATE SCHEMA census_other");
    await sql.unsafe("ALTER TABLE skills_registry SET SCHEMA census_other");
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_SCHEMA_UNAVAILABLE", message: "CENSUS_SCHEMA_UNAVAILABLE" });
    await sql.unsafe("ALTER TABLE census_other.skills_registry SET SCHEMA public");

    // "$user" ahead of public in the search path substitutes another schema as the fixed target.
    await sql.unsafe("CREATE SCHEMA census_fixture");
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_TARGET_MISMATCH", message: "CENSUS_TARGET_MISMATCH" });
    await sql.unsafe("DROP SCHEMA census_fixture");
    expect((await inspectSchemaCensus(fixture)).schema).toBe("public");

    // A read path that attempts a write must be blocked by PostgreSQL itself, not by query shape.
    await sql.unsafe("ALTER TABLE skills_registry RENAME TO census_registry_base");
    await sql.unsafe(`CREATE FUNCTION census_write_probe(lifecycle text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN UPDATE census_registry_base SET revision_id = 'must-not-change'; RETURN lifecycle; END $$`);
    await sql.unsafe(`CREATE VIEW skills_registry AS
      SELECT org_id, slug, census_write_probe(lifecycle) AS lifecycle, tombstoned_at FROM census_registry_base`);
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_WRITE_REFUSED", message: "CENSUS_WRITE_REFUSED" });
    const unchanged = await sql.unsafe<Array<{ n: number }>>("SELECT count(*)::int AS n FROM census_registry_base WHERE revision_id = 'must-not-change'");
    expect(unchanged).toEqual([{ n: 0 }]);
    await sql.unsafe("DROP VIEW skills_registry");
    await sql.unsafe("DROP FUNCTION census_write_probe(text)");
    await sql.unsafe("ALTER TABLE census_registry_base RENAME TO skills_registry");
  } finally {
    await sql.close({ timeout: 1 });
  }
});

test.skipIf(!url)("census runs READ ONLY REPEATABLE READ and keeps one snapshot across its registry reads", async () => {
  const fixture = fixtureUrl();
  const sql = new SQL(fixture, { max: 1 });
  try {
    await sql.unsafe("ALTER TABLE skills_registry RENAME TO census_registry_base");

    // Instrument control: the probe is really executed by both registry reads, so a settings
    // assertion that follows cannot pass vacuously.
    await sql.unsafe(`CREATE FUNCTION census_settings_probe(lifecycle text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'PRIVATE_FIXTURE_SENTINEL'; END $$`);
    await sql.unsafe(`CREATE VIEW skills_registry AS
      SELECT org_id, slug, census_settings_probe(lifecycle) AS lifecycle, tombstoned_at FROM census_registry_base`);
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_FAILED" });

    // The transaction boundary is asserted from inside the read path: read-only, repeatable-read
    // and both timeouts, exactly as the operation requires them.
    await sql.unsafe(`CREATE OR REPLACE FUNCTION census_settings_probe(lifecycle text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('transaction_read_only') <> 'on' OR current_setting('transaction_isolation') <> 'repeatable read'
          OR current_setting('statement_timeout') <> '5s' OR current_setting('lock_timeout') <> '1s'
        THEN RAISE EXCEPTION 'fixture transaction boundary absent'; END IF;
        RETURN lifecycle;
      END $$`);
    const settings = await inspectSchemaCensus(fixture);
    expect(settings.transaction).toEqual({ readOnly: true, isolation: "repeatable read", statementTimeoutMs: 5000, lockTimeoutMs: 1000 });
    expect(settings.lifecycle).toEqual({ active: { live: 1, tombstoned: 1 }, archived: { live: 1, tombstoned: 0 } });
    expect(settings.registry.rows).toBe(3);
    await sql.unsafe("DROP VIEW skills_registry");
    await sql.unsafe("DROP FUNCTION census_settings_probe(text)");

    // Repeatability: the probe sleeps once, on the census's first registry read. While it sleeps,
    // this connection commits a new archived row. The census's second registry read starts after
    // that commit; a read-committed transaction would report the new row, the snapshot cannot.
    await sql.unsafe(`CREATE FUNCTION census_repeat_probe(lifecycle text) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('transaction_read_only') <> 'on' OR current_setting('transaction_isolation') <> 'repeatable read'
        THEN RAISE EXCEPTION 'fixture transaction boundary absent'; END IF;
        IF current_setting('census.repeat_synced', true) IS NULL THEN
          PERFORM set_config('census.repeat_synced', '1', true);
          PERFORM pg_sleep(3);
        END IF;
        RETURN lifecycle;
      END $$`);
    await sql.unsafe(`CREATE VIEW skills_registry AS
      SELECT org_id, slug, census_repeat_probe(lifecycle) AS lifecycle, tombstoned_at FROM census_registry_base`);

    const pending = inspectSchemaCensus(fixture);
    let observed = 0;
    for (let attempt = 0; attempt < 200 && observed === 0; attempt++) {
      const rows = await sql`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND datname = current_database() AND state = 'active'
          AND query ILIKE ${"%count(*)::int AS rows FROM public.skills_registry%"} AND query NOT ILIKE ${"%GROUP BY%"}`;
      observed = rows[0].n;
      if (observed === 0) await Bun.sleep(25);
    }
    expect(observed).toBeGreaterThan(0);
    await sql`INSERT INTO census_registry_base (org_id, slug, display_name, lifecycle, tombstoned_at, revision_id, revision_number)
      VALUES ('org-fixture', 'late-one', '', 'archived', NULL, '', 0)`;
    const result = await pending;
    expect(result.registry.rows).toBe(3);
    expect(result.lifecycle).toEqual({ active: { live: 1, tombstoned: 1 }, archived: { live: 1, tombstoned: 0 } });
    // The committed row is visible to this connection, so the exclusion above is repeatability,
    // not a missing commit.
    const total = await sql.unsafe<Array<{ n: number }>>("SELECT count(*)::int AS n FROM census_registry_base");
    expect(total).toEqual([{ n: 4 }]);

    await sql`DELETE FROM census_registry_base WHERE slug = 'late-one'`;
    await sql.unsafe("DROP VIEW skills_registry");
    await sql.unsafe("DROP FUNCTION census_repeat_probe(text)");
    await sql.unsafe("ALTER TABLE census_registry_base RENAME TO skills_registry");
    expect((await inspectSchemaCensus(fixture)).registry.rows).toBe(3);

    // Control: the same two-read shape in a read-committed transaction reports the row committed
    // between its reads, so the exclusion above is the isolation level, not a missing commit.
    const control = new SQL(fixture, { max: 1 });
    try {
      const seen = await control.begin("ISOLATION LEVEL READ COMMITTED", async (tx) => {
        const before = await tx`SELECT count(*)::int AS n FROM skills_registry`;
        await sql`INSERT INTO skills_registry (org_id, slug, display_name, lifecycle, tombstoned_at, revision_id, revision_number)
          VALUES ('org-fixture', 'control-one', '', 'archived', NULL, '', 0)`;
        const after = await tx`SELECT count(*)::int AS n FROM skills_registry`;
        return { before: before[0].n, after: after[0].n };
      });
      expect(seen).toEqual({ before: 3, after: 4 });
    } finally {
      await control.close({ timeout: 1 });
      await sql`DELETE FROM skills_registry WHERE slug = 'control-one'`;
    }
  } finally {
    await sql.close({ timeout: 1 });
  }
});

test.skipIf(!url)("census refuses a search_path fall-through instead of counting a later schema's tables", async () => {
  const fixture = fixtureUrl();
  const sql = new SQL(fixture, { max: 1 });
  try {
    // The reviewer's disposable scenario: an owned table is absent from public, a later
    // search_path entry holds a same-named table with rows, and new connections resolve it.
    await sql.unsafe("CREATE SCHEMA evil");
    await sql.unsafe("ALTER TABLE public.skills_versions SET SCHEMA evil");
    for (let index = 0; index < 5; index++) await sql`INSERT INTO evil.skills_versions VALUES ('org-fixture', 'evil-one', ${`9.${index}.0`}, 'c')`;
    await sql.unsafe("ALTER ROLE census_fixture SET search_path = public, evil");
    const probe = new SQL(fixture, { max: 1 });
    try {
      const resolved = await probe`SELECT (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.oid = to_regclass('skills_versions')) AS schema, count(*)::int AS rows FROM skills_versions`;
      expect(resolved).toEqual([{ schema: "evil", rows: 7 }]);
    } finally {
      await probe.close({ timeout: 1 });
    }

    // Fail closed: the qualified read of public.skills_versions finds no table, so the census
    // refuses with CENSUS_SCHEMA_UNAVAILABLE and never counts the other schema's rows.
    await expect(inspectSchemaCensus(fixture)).rejects.toMatchObject({ code: "CENSUS_SCHEMA_UNAVAILABLE", message: "CENSUS_SCHEMA_UNAVAILABLE" });

    await sql.unsafe("ALTER ROLE census_fixture RESET search_path");
    await sql`DELETE FROM evil.skills_versions WHERE slug = 'evil-one'`;
    await sql.unsafe("ALTER TABLE evil.skills_versions SET SCHEMA public");
    await sql.unsafe("DROP SCHEMA evil");
    expect((await inspectSchemaCensus(fixture)).versions.rows).toBe(2);
  } finally {
    await sql.close({ timeout: 1 });
  }
});
