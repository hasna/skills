import { expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { MemorySkillsStore } from "./store.js";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { publicPrincipal } from "./auth.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";

test("owned client and server compose a guarded category/tags update without changing the publication", async () => {
  const principal = publicPrincipal({ orgId: "fixture-org", scopes: ["skills:read", "skills:publish"], role: "owner" });
  const store = new MemorySkillsStore([{ token: "synthetic", principal }]);
  await store.publishSkill({ principal, slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "old", tags: [],
    source: "custom", kind: "instruction", version: "1.0.0", skillMd: "Synthetic instruction body" });
  const original = await store.getSkill(principal, "fixture-skill");
  const handler = await createSkillsFetchHandler({ store, governanceStore: new MemoryGovernanceStore(), runtime: null,
    config: { publicBaseUrl: "https://example.invalid", allowEphemeralStore: true } });
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (input, init) => {
    methods.push(init?.method ?? "GET");
    return handler(new Request(String(input), init));
  }) as typeof fetch;
  try {
    const client = new RemoteSkillsClient("synthetic", "https://example.invalid");
    const plan = await client.prepareSkillMetadataUpdate("fixture-skill", { category: "new", tags: ["curated"] });
    expect(methods.every(method => method === "GET")).toBe(true);
    expect(await client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied" });
    const current = await store.getSkill(principal, "fixture-skill");
    expect(current?.category).toBe("new"); expect(current?.tags).toEqual(["curated"]);
    expect(current?.skillMd).toBe(original?.skillMd); expect(current?.version).toBe(original?.version);
    expect(current?.bundleSha256).toBe(original?.bundleSha256);
    await expect(client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_REVISION_CONFLICT" });
    expect(methods.filter(method => method === "PATCH")).toHaveLength(1);
  } finally { globalThis.fetch = originalFetch; await handler.close(); }
});
