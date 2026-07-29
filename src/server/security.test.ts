import { describe, expect, test } from "bun:test";
import { hashApiKey } from "./auth.js";
import { redactForClient } from "./redaction.js";
import { resolveStoreBackends } from "./store-fixtures.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const backends = await resolveStoreBackends();

describe("server security helpers", () => {
  for (const backend of backends) {
    test(`hashes API keys before lookup (${backend.name})`, async () => {
      const fixture = await backend.create([{ token: "sk_test_secret_value", principal: { orgId: "org_a" } }]);
      try {
        // The raw token must never be a valid lookup key: if it were, a store dump
        // would hand an attacker working credentials rather than hashes.
        expect(await fixture.store.authenticateApiKeyHash("sk_test_secret_value")).toBeNull();
        expect(await fixture.store.authenticateApiKeyHash(hashApiKey("sk_test_secret_value"))).toMatchObject({ orgId: "org_a" });
      } finally {
        await fixture.close();
      }
    });

    test(`rejects revoked and unknown key hashes (${backend.name})`, async () => {
      const fixture = await backend.create([{ token: "sk_test_known", principal: { orgId: "org_a" } }]);
      try {
        expect(await fixture.store.authenticateApiKeyHash(hashApiKey("sk_test_never_issued"))).toBeNull();
        expect(await fixture.store.authenticateApiKeyHash("")).toBeNull();
      } finally {
        await fixture.close();
      }
    });
  }

  test("redacts common credentials and signed URLs from client-visible logs", () => {
    const text = redactForClient("Authorization=sk-proj-secretvalue DATABASE_URL=postgres://user:pass@host/db https://s3/x?X-Amz-Signature=abc");
    expect(text).not.toContain("sk-proj-secretvalue");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).toContain("credential");
  });
});
