import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { openOperatorScopeMaintenance, PostgresSkillsStore } from "./store.js";
import type { ApiPrincipal } from "./types.js";
useDefaultTestTimeout();

test("operator maintenance refuses implicit, local and non-PostgreSQL stores", () => {
  for (const url of ["", "memory:", "file:fixture.db", "sqlite://fixture.db", "https://example.invalid", "postgres:"]) {
    expect(() => openOperatorScopeMaintenance(url)).toThrow("maintenance requires an explicit Postgres database");
  }
});

// The runner supplies a new disposable cluster. Never read the application's database variable.
const url = process.env.HASNA_SKILLS_MAINTENANCE_TEST_DATABASE_URL;
const scopes = ["stations:write", "skills:read", "runs:write"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function inputs(operationId: string, keyId = "fixture-key", expectedScopes = scopes) {
  const dir = mkdtempSync(join(tmpdir(), "enrollment-input-"));
  const manifest: Record<string, unknown> = {
    app: "skills", operation: "enroll-publish", manifestVersion: 1,
    operationId, keyId, stationId: "fixture-station", orgId: "fixture-org", expectedScopes,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  manifest.manifestDigest = hash(JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))));
  const bytes = JSON.stringify(manifest);
  const manifestPath = join(dir, "manifest.json"), receiptPath = join(dir, "receipt.json");
  writeFileSync(manifestPath, bytes);
  writeFileSync(receiptPath, JSON.stringify({ manifestBytesSha256: hash(bytes), operatorJobId: "fixture-job",
    operatorTaskArn: "fixture-task", taskDefinitionArn: "fixture-definition", verifiedAt: new Date().toISOString() }));
  return { manifestPath, receiptPath, manifestDigest: manifest.manifestDigest };
}
async function invoke(input: ReturnType<typeof inputs>, apply = false) {
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "maintenance.ts"),
    "maintenance", "enroll-publish", "--manifest", input.manifestPath, "--operator-receipt", input.receiptPath,
    "--json", ...(apply ? ["--apply"] : [])], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, HASNA_SKILLS_DATABASE_URL: url },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(stdout).not.toContain("PRIVATE_FIXTURE_SENTINEL");
  return { code, result: JSON.parse(stdout) };
}

test.skipIf(!url)("PostgreSQL enrollment has no initialization writes and retains atomic CAS, audit, replay and rollback", async () => {
  const target = new URL(url!);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.username).toBe("maintenance_fixture");
  expect(target.pathname).toBe("/skills_maintenance_fixture");
  const sql = new SQL(url!, { max: 1 });
  try {
    // No IF NOT EXISTS, cleanup or real schema migration: refuse a reused fixture database.
    await sql.unsafe("CREATE TABLE api_keys (id text PRIMARY KEY, org_id text, name text, scopes_json jsonb, revoked_at timestamptz)");
    await sql.unsafe("CREATE TABLE skills_audit_events (id bigserial PRIMARY KEY, org_id text, user_id text, api_key_id text, action text, target_type text, target_id text, operator_operation_id text UNIQUE, metadata_json jsonb)");
    // Deliberately incomplete registry rows would break or be rewritten by application-store initialization.
    await sql.unsafe("CREATE TABLE skills_registry (slug text, revision_id text)");
    await sql`INSERT INTO skills_registry VALUES ('legacy-fixture', '')`;
    await sql`INSERT INTO api_keys VALUES ('fixture-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::text::jsonb, NULL)`;
    const before = await sql`SELECT * FROM api_keys`;
    const registry = await sql`SELECT * FROM skills_registry`;
    const dry = await invoke(inputs("dry"));
    expect(dry.code).toBe(0);
    expect(dry.result).toMatchObject({ status: "dry-run", currentScopes: scopes });
    expect(await sql`SELECT * FROM api_keys`).toEqual(before);
    expect(await sql`SELECT * FROM skills_registry`).toEqual(registry);
    expect(await sql`SELECT * FROM skills_audit_events`).toHaveLength(0);
    expect((await invoke(inputs("stale", "fixture-key", [...scopes].reverse()), true)).result.status).toBe("stale");
    expect(await sql`SELECT * FROM api_keys`).toEqual(before);

    await sql.unsafe(`CREATE FUNCTION require_maintenance_limits() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_setting('statement_timeout') <> '5s' OR current_setting('lock_timeout') <> '1s'
        THEN RAISE EXCEPTION 'PRIVATE_FIXTURE_SENTINEL'; END IF; RETURN NEW; END $$`);
    await sql.unsafe("CREATE TRIGGER scope_limits BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION require_maintenance_limits()");
    const apply = inputs("apply");
    const updated = await invoke(apply, true);
    expect(updated.result.status).toBe("updated");
    expect(updated.code).toBe(0);
    expect(updated.result).toMatchObject({ status: "updated", scopes: [...scopes, "skills:publish"] });
    expect((await sql`SELECT scopes_json FROM api_keys WHERE id = 'fixture-key'`)[0].scopes_json).toEqual([...scopes, "skills:publish"]);
    const audit = await sql`SELECT * FROM skills_audit_events`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: null, api_key_id: null, operator_operation_id: "apply", target_id: "fixture-key" });
    expect(audit[0].metadata_json.added).toEqual(["skills:publish"]);
    expect(audit[0].metadata_json.target_manifest_digest).toBe(apply.manifestDigest);
    expect((await invoke(apply, true)).result.status).toBe("already_applied");
    expect(await sql`SELECT * FROM skills_audit_events`).toEqual(audit);
    expect(await sql`SELECT * FROM skills_registry`).toEqual(registry);

    await sql`INSERT INTO api_keys VALUES ('race-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::text::jsonb, NULL)`;
    const race = await Promise.all([invoke(inputs("race-a", "race-key"), true), invoke(inputs("race-b", "race-key"), true)]);
    expect(race.map(x => x.result.status).sort()).toEqual(["stale", "updated"]);
    expect(await sql`SELECT * FROM skills_audit_events WHERE target_id = 'race-key'`).toHaveLength(1);

    // Older writes may have stored the serialized array as a JSON string. Accept that exact
    // prior representation for CAS, then normalize the successful write to a native JSON array.
    await sql`INSERT INTO api_keys VALUES ('legacy-operator-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::jsonb, NULL)`;
    expect((await sql`SELECT jsonb_typeof(scopes_json) AS kind FROM api_keys WHERE id = 'legacy-operator-key'`)[0].kind).toBe("string");
    const legacyInput = inputs("legacy-apply", "legacy-operator-key");
    const legacyApply = await invoke(legacyInput, true);
    expect(legacyApply.result.status).toBe("updated");
    expect(legacyApply.result.scopes).toEqual([...scopes, "skills:publish"]);
    expect((await sql`SELECT jsonb_typeof(scopes_json) AS kind, scopes_json FROM api_keys WHERE id = 'legacy-operator-key'`)[0]).toEqual({
      kind: "array", scopes_json: [...scopes, "skills:publish"],
    });
    const legacyAudit = await sql`SELECT jsonb_typeof(metadata_json) AS kind, metadata_json FROM skills_audit_events WHERE target_id = 'legacy-operator-key'`;
    expect(legacyAudit).toHaveLength(1);
    expect(legacyAudit[0].kind).toBe("object");
    expect((await invoke(legacyInput, true)).result.status).toBe("already_applied");

    // The authenticated update path shares the same CAS; it must retain an object audit too.
    await sql`INSERT INTO api_keys VALUES ('admin-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::text::jsonb, NULL)`;
    await sql`INSERT INTO api_keys VALUES ('legacy-admin-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::jsonb, NULL)`;
    expect((await sql`SELECT jsonb_typeof(scopes_json) AS kind FROM api_keys WHERE id = 'legacy-admin-key'`)[0].kind).toBe("string");
    const admin = new PostgresSkillsStore(url!, { max: 1, connection: { statement_timeout: "5s", lock_timeout: "1s" } });
    try {
      const actor = { orgId: "fixture-org", userId: "fixture-admin", apiKeyId: "fixture-admin-key" } as ApiPrincipal;
      expect(await admin.updateApiKeyScopes(actor, "admin-key", scopes, ["skills:publish"])).toEqual({ kind: "updated", scopes: [...scopes, "skills:publish"] });
      expect(await admin.updateApiKeyScopes(actor, "admin-key", scopes, ["skills:publish"])).toMatchObject({ kind: "stale" });
      const rows = await sql`SELECT * FROM skills_audit_events WHERE target_id = 'admin-key'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: actor.userId, api_key_id: actor.apiKeyId, operator_operation_id: null });
      expect(rows[0].metadata_json).toEqual({ added: ["skills:publish"], scopes: [...scopes, "skills:publish"] });
      expect(await admin.updateApiKeyScopes(actor, "legacy-admin-key", scopes, ["skills:publish"])).toEqual({ kind: "updated", scopes: [...scopes, "skills:publish"] });
      expect((await sql`SELECT jsonb_typeof(scopes_json) AS kind, scopes_json FROM api_keys WHERE id = 'legacy-admin-key'`)[0]).toEqual({
        kind: "array", scopes_json: [...scopes, "skills:publish"],
      });
      const legacyAdminAudit = await sql`SELECT jsonb_typeof(metadata_json) AS kind, metadata_json FROM skills_audit_events WHERE target_id = 'legacy-admin-key'`;
      expect(legacyAdminAudit).toHaveLength(1);
      expect(legacyAdminAudit[0].kind).toBe("object");
      expect(legacyAdminAudit[0].metadata_json).toEqual({ added: ["skills:publish"], scopes: [...scopes, "skills:publish"] });
      expect(await admin.updateApiKeyScopes(actor, "legacy-admin-key", scopes, ["skills:publish"])).toMatchObject({ kind: "stale" });
      expect(await sql`SELECT * FROM skills_audit_events WHERE target_id = 'legacy-admin-key'`).toHaveLength(1);
    } finally { await admin.close(); }

    await sql`INSERT INTO api_keys VALUES ('rollback-key', 'fixture-org', 'fixture', ${JSON.stringify(scopes)}::text::jsonb, NULL)`;
    await sql.unsafe(`CREATE FUNCTION refuse_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.target_id = 'rollback-key' THEN RAISE EXCEPTION 'PRIVATE_FIXTURE_SENTINEL'; END IF; RETURN NEW; END $$`);
    await sql.unsafe("CREATE TRIGGER refuse_audit BEFORE INSERT ON skills_audit_events FOR EACH ROW EXECUTE FUNCTION refuse_fixture_audit()");
    const rollback = await invoke(inputs("rollback", "rollback-key"), true);
    expect(rollback).toEqual({ code: 1, result: { status: "failed", code: "MAINTENANCE_FAILED" } });
    expect((await sql`SELECT scopes_json FROM api_keys WHERE id = 'rollback-key'`)[0].scopes_json).toEqual(scopes);
    expect(await sql`SELECT * FROM skills_audit_events WHERE target_id = 'rollback-key'`).toHaveLength(0);
    await sql.unsafe("ALTER TABLE skills_audit_events RENAME TO fixture_audit");
    expect(await invoke(inputs("missing-schema", "rollback-key"), true)).toEqual({ code: 1, result: { status: "failed", code: "MAINTENANCE_SCHEMA_UNAVAILABLE" } });
    expect(await sql`SELECT * FROM skills_registry`).toEqual(registry);
  } finally { await sql.close({ timeout: 1 }); }
});
