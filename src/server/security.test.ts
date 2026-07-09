import { describe, expect, test } from "bun:test";
import { hashApiKey } from "./auth.js";
import { redactForClient } from "./redaction.js";
import { MemorySkillsStore } from "./store.js";

describe("self-hosted security helpers", () => {
  test("hashes API keys before lookup", async () => {
    const store = new MemorySkillsStore([{ token: "sk_test_secret_value", principal: { orgId: "org_a" } }]);
    expect(await store.authenticateApiKeyHash("sk_test_secret_value")).toBeNull();
    expect(await store.authenticateApiKeyHash(hashApiKey("sk_test_secret_value"))).toMatchObject({ orgId: "org_a" });
  });

  test("redacts common credentials and signed URLs from client-visible logs", () => {
    const text = redactForClient("Authorization=sk-proj-secretvalue DATABASE_URL=postgres://user:pass@host/db https://s3/x?X-Amz-Signature=abc");
    expect(text).not.toContain("sk-proj-secretvalue");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).toContain("credential");
  });
});
