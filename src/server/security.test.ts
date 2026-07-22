import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashApiKey } from "./auth.js";
import { redactForClient } from "./redaction.js";
import { MemorySkillsStore } from "./store.js";

describe("self-hosted security helpers", () => {
  test("hashes API keys before lookup", async () => {
    const store = new MemorySkillsStore([{ token: "sk_test_secret_value", principal: { orgId: "org_a" } }]);
    expect(await store.authenticateApiKeyHash("sk_test_secret_value")).toBeNull();
    expect(await store.authenticateApiKeyHash(hashApiKey("sk_test_secret_value"))).toMatchObject({ orgId: "org_a" });
  });

  test("uses a self-hosted operator principal instead of an internal identity", async () => {
    const store = new MemorySkillsStore([{ token: "sk_test_operator" }]);
    const principal = await store.authenticateApiKeyHash(hashApiKey("sk_test_operator"));

    expect(principal).toMatchObject({
      orgSlug: "self-hosted",
      orgName: "Self-hosted operator",
      email: "operator@localhost.invalid",
      role: "owner",
      scopes: ["skills:read", "runs:read", "runs:write", "artifacts:read"],
    });
    expect(principal?.apiKeyId).not.toBe("key_dev");
    expect(principal?.orgId).not.toBe("org_dev");
    expect(principal?.userId).not.toBe("user_dev");
    expect(JSON.stringify(principal)).not.toContain("skills.hasna.xyz");
  });

  test("migrates only the exact legacy internal bootstrap identity", () => {
    const migration = readFileSync(join(process.cwd(), "migrations/0002_api_key_read_scopes.sql"), "utf8");

    expect(migration).toContain('SET DEFAULT \'["skills:read","runs:read","runs:write","artifacts:read"]\'::jsonb');
    expect(migration).toContain("k.id = 'key_dev'");
    expect(migration).toContain("k.org_id = 'org_dev'");
    expect(migration).toContain("k.user_id = 'user_dev'");
    expect(migration).toContain("k.name = 'bootstrap'");
    expect(migration).toContain("o.slug = 'dev'");
    expect(migration).toContain("md5(u.email) = 'bd437459aededa5b92dd7459452f7b50'");
    expect(migration).toContain('k.scopes_json = \'["skills:read","runs:write"]\'::jsonb');
    expect(migration).toContain("'org_self_hosted'");
    expect(migration).toContain("'user_operator'");
    expect(migration).toContain("'operator@localhost.invalid'");
    expect(migration).toContain("'key_' || substr(k.key_hash, 1, 20)");
    expect(migration).not.toMatch(/UPDATE api_keys\s+SET scopes_json[^;]+WHERE name = 'bootstrap'/s);
  });

  test("uses one conflict-safe PostgreSQL insert for idempotent run creation", () => {
    const storeSource = readFileSync(join(process.cwd(), "src/server/store.ts"), "utf8");
    const postgresCreateRun = storeSource.slice(
      storeSource.indexOf("export class PostgresSkillsStore"),
      storeSource.indexOf("  async listRuns", storeSource.indexOf("export class PostgresSkillsStore")),
    );

    expect(postgresCreateRun).toContain("ON CONFLICT (org_id, idempotency_key)");
    expect(postgresCreateRun).toContain("WHERE idempotency_key IS NOT NULL");
    expect(postgresCreateRun).toContain("DO NOTHING");
  });

  test("redacts common credentials and signed URLs from client-visible logs", () => {
    const text = redactForClient("Authorization=sk-proj-secretvalue DATABASE_URL=postgres://user:pass@host/db https://s3/x?X-Amz-Signature=abc");
    expect(text).not.toContain("sk-proj-secretvalue");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).toContain("credential");
  });
});
