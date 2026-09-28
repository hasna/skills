import { expect, test } from "bun:test";
import { SQL } from "bun";
import { useDefaultTestTimeout } from "../test-preload.js";
import { inspectEnrollment } from "./enrollment-inspection.js";
useDefaultTestTimeout();

// Never use the application's database variable or an implicit localhost service.
// The runner must provision a fresh disposable cluster/database for this test.
const url = process.env.HASNA_SKILLS_INSPECTION_TEST_DATABASE_URL;
const input = { keyId: "fixture-key", orgId: "fixture-org", enrollmentOperationId: "fixture-operation", enrollmentManifestDigest: "a".repeat(64) };

test.skipIf(!url)("isolated PostgreSQL inspection is bounded, ordered, sanitized and enforced read-only", async () => {
  const target = new URL(url!);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.pathname).toBe("/skills_inspection_fixture");
  expect(target.username).toBe("inspection_fixture");
  const sql = new SQL(url!, { max: 1 });
  try {
    // No IF NOT EXISTS: a reused/nonempty fixture is a refusal, not permission to clear it.
    await sql.unsafe("CREATE TABLE api_keys (id text, org_id text, scopes_json jsonb, revoked_at timestamptz)");
    await sql.unsafe("CREATE TABLE skills_audit_events (org_id text, target_type text, target_id text, action text, operator_operation_id text, metadata_json jsonb)");
    await sql.unsafe("CREATE TABLE skills_registry (slug text, revision_id text)");
    await sql`INSERT INTO skills_registry VALUES ('legacy-fixture', '')`;
    const originalRegistry = await sql`SELECT * FROM skills_registry`;
    expect(await inspectEnrollment(url!, input)).toEqual({ status: "inspected", target: { state: "absent" }, audit: { state: "absent" } });

    const scopes = ["stations:write", "skills:read", "runs:write"];
    await sql`INSERT INTO api_keys VALUES (${input.keyId}, ${input.orgId}, ${JSON.stringify(scopes)}::text::jsonb, NULL)`;
    const originalTarget = await sql`SELECT * FROM api_keys`;
    expect((await inspectEnrollment(url!, input)).target).toEqual({ state: "found", scopes });
    expect((await inspectEnrollment(url!, { ...input, orgId: "other-fixture-org" })).target).toEqual({ state: "mismatched" });
    await sql`INSERT INTO api_keys VALUES ('revoked-fixture', ${input.orgId}, '[]'::jsonb, now())`;
    expect((await inspectEnrollment(url!, { ...input, keyId: "revoked-fixture" })).target).toEqual({ state: "revoked" });

    const metadata = { target_manifest_digest: input.enrollmentManifestDigest, unrelated: "PRIVATE_FIXTURE_SENTINEL" };
    await sql`INSERT INTO skills_audit_events VALUES (${input.orgId}, 'api_key', ${input.keyId}, 'api_key_scopes_added', ${input.enrollmentOperationId}, ${JSON.stringify(metadata)}::text::jsonb)`;
    const originalAudit = await sql`SELECT * FROM skills_audit_events`;
    const matching = await inspectEnrollment(url!, input);
    expect(matching.audit).toEqual({ state: "matching" });
    expect(JSON.stringify(matching)).not.toContain("PRIVATE_FIXTURE_SENTINEL");
    expect((await inspectEnrollment(url!, { ...input, enrollmentManifestDigest: "b".repeat(64) })).audit).toEqual({ state: "mismatched" });
    expect((await inspectEnrollment(url!, { ...input, keyId: "other-fixture-key" })).audit).toEqual({ state: "mismatched" });
    expect((await inspectEnrollment(url!, { ...input, orgId: "other-fixture-org" })).audit).toEqual({ state: "mismatched" });
    expect(await sql`SELECT * FROM api_keys WHERE id = ${input.keyId}`).toEqual(originalTarget);
    expect(await sql`SELECT * FROM skills_audit_events`).toEqual(originalAudit);
    expect(await sql`SELECT * FROM skills_registry`).toEqual(originalRegistry);

    for (const [key, value] of [["bad-object", {}], ["bad-scope", ["not a scope"]], ["too-many", Array(33).fill("skills:read")], ["too-large", ["x".repeat(9000)]]]) {
      await sql`INSERT INTO api_keys VALUES (${key as string}, ${input.orgId}, ${JSON.stringify(value)}::text::jsonb, NULL)`;
      await expect(inspectEnrollment(url!, { ...input, keyId: key as string })).rejects.toMatchObject({ code: "INVALID_INSPECTION_RESULT", message: "INVALID_INSPECTION_RESULT" });
    }
    await sql`INSERT INTO skills_audit_events VALUES (${input.orgId}, 'api_key', ${input.keyId}, 'api_key_scopes_added', 'bad-audit', '{}'::jsonb)`;
    await expect(inspectEnrollment(url!, { ...input, enrollmentOperationId: "bad-audit" })).rejects.toMatchObject({ code: "INVALID_INSPECTION_RESULT" });
    await sql`INSERT INTO api_keys SELECT * FROM api_keys WHERE id = ${input.keyId}`;
    await sql`INSERT INTO skills_audit_events SELECT * FROM skills_audit_events WHERE operator_operation_id = ${input.enrollmentOperationId}`;
    expect(await inspectEnrollment(url!, input)).toEqual({ status: "inspected", target: { state: "ambiguous" }, audit: { state: "ambiguous" } });

    // A read path which attempts a write must be blocked by PostgreSQL itself.
    await sql.unsafe("ALTER TABLE api_keys RENAME TO fixture_keys");
    await sql.unsafe(`CREATE FUNCTION inspection_write_probe() RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN UPDATE skills_registry SET revision_id = 'must-not-change'; RETURN '[]'::jsonb; END $$`);
    await sql.unsafe("CREATE VIEW api_keys AS SELECT 'probe-key'::text AS id, 'fixture-org'::text AS org_id, inspection_write_probe() AS scopes_json, NULL::timestamptz AS revoked_at");
    await expect(inspectEnrollment(url!, { ...input, keyId: "probe-key" })).rejects.toMatchObject({ code: "INSPECTION_WRITE_REFUSED", message: "INSPECTION_WRITE_REFUSED" });
    expect(await sql`SELECT * FROM skills_registry`).toEqual(originalRegistry);
    // Also prove the transaction settings seen within the actual read path.
    await sql.unsafe(`CREATE OR REPLACE FUNCTION inspection_write_probe() RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('transaction_read_only') <> 'on' OR current_setting('transaction_isolation') <> 'repeatable read'
          OR current_setting('statement_timeout') <> '5s' OR current_setting('lock_timeout') <> '1s'
        THEN RAISE EXCEPTION 'fixture transaction boundary absent'; END IF;
        RETURN '["skills:read"]'::jsonb;
      END $$`);
    expect((await inspectEnrollment(url!, { ...input, keyId: "probe-key", enrollmentOperationId: "absent-operation" })).target).toEqual({ state: "found", scopes: ["skills:read"] });
    expect(await sql`SELECT * FROM skills_registry`).toEqual(originalRegistry);

    // Exercise the driver's actual SQLSTATE surface, retaining no message or cause.
    for (const [state, code] of [
      ["42P01", "INSPECTION_SCHEMA_UNAVAILABLE"], ["42703", "INSPECTION_SCHEMA_UNAVAILABLE"],
      ["42501", "INSPECTION_ACCESS_DENIED"], ["57014", "INSPECTION_TIMEOUT"],
      ["55P03", "INSPECTION_TIMEOUT"], ["28000", "INSPECTION_CONNECTION_FAILED"],
      ["28P01", "INSPECTION_CONNECTION_FAILED"], ["08006", "INSPECTION_CONNECTION_FAILED"],
      ["P0001", "INSPECTION_FAILED"],
    ]) {
      // Both literals come from the closed synthetic table above, never caller input.
      await sql.unsafe(`CREATE OR REPLACE FUNCTION inspection_write_probe() RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'PRIVATE_FIXTURE_SENTINEL' USING ERRCODE = '${state}'; END $$`);
      let failure: unknown;
      try { await inspectEnrollment(url!, { ...input, keyId: "probe-key" }); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ name: "EnrollmentInspectionError", message: code, code });
      expect(JSON.stringify(failure)).not.toContain("PRIVATE_FIXTURE_SENTINEL");
      expect(failure).not.toHaveProperty("cause");
    }
  } finally {
    await sql.close({ timeout: 1 });
  }
});
