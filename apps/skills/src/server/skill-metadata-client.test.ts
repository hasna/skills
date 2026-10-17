import { expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { MemorySkillsStore } from "./store.js";
import { MemoryGovernanceStore } from "../sdk/governance-store.js";
import { publicPrincipal } from "./auth.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";

for (const [label, description] of [
  ["short", "Synthetic"],
  ["long", "x".repeat(700)],
  ["multiline", "First line\nSecond line"],
] as const) test(`owned client and server preserve a ${label} description during a guarded metadata update`, async () => {
  const principal = publicPrincipal({ orgId: "fixture-org", scopes: ["skills:read", "skills:publish"], role: "owner" });
  const store = new MemorySkillsStore([{ token: "synthetic", principal }]);
  await store.publishSkill({ principal, slug: "fixture-skill", displayName: "Fixture", description, category: "old", tags: [],
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
    expect(plan.before.description).toBe(description);
    expect(await client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied" });
    const current = await store.getSkill(principal, "fixture-skill");
    expect(current?.category).toBe("new"); expect(current?.tags).toEqual(["curated"]);
    expect(current?.description).toBe(description);
    expect(current?.skillMd).toBe(original?.skillMd); expect(current?.version).toBe(original?.version);
    expect(current?.bundleSha256).toBe(original?.bundleSha256);
    await expect(client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_REVISION_CONFLICT" });
    expect(methods.filter(method => method === "PATCH")).toHaveLength(1);
  } finally { globalThis.fetch = originalFetch; await handler.close(); }
});

for (const [label, tag] of [
  ["short", "old"],
  ["long", "x".repeat(700)],
  ["multiline", "First line\nSecond line"],
] as const) test(`a server-published ${label} tag permits a guarded correction`, async () => {
  const principal = publicPrincipal({ orgId: "fixture-org", scopes: ["skills:read", "skills:publish"], role: "owner" });
  const store = new MemorySkillsStore([{ token: "synthetic", principal }]);
  const handler = await createSkillsFetchHandler({ store, governanceStore: new MemoryGovernanceStore(), runtime: null,
    config: { publicBaseUrl: "https://example.invalid", allowEphemeralStore: true } });
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  try {
    const published = await handler(new Request("https://example.invalid/api/v1/skills", { method: "POST",
      headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "fixture-skill", description: "Synthetic", tags: [tag], skillMd: "Synthetic instruction body", kind: "instruction" }) }));
    expect(published.status).toBe(201);
    expect((await published.json()).tags).toEqual([tag]);
    const original = await store.getSkill(principal, "fixture-skill");
    if (!original) throw new Error("Published fixture missing");
    globalThis.fetch = (async (input, init) => {
      methods.push(init?.method ?? "GET");
      return handler(new Request(String(input), init));
    }) as typeof fetch;
    const client = new RemoteSkillsClient("synthetic", "https://example.invalid");
    const plan = await client.prepareSkillMetadataUpdate("fixture-skill", { tags: ["curated"] });
    expect(plan.before.tags).toEqual([tag]);
    expect(methods.every(method => method === "GET")).toBe(true);
    expect(await client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied" });
    const current = await store.getSkill(principal, "fixture-skill");
    if (!current) throw new Error("Updated fixture missing");
    expect(current.tags).toEqual(["curated"]);
    expect(current.revisionNumber).toBe((original.revisionNumber ?? 0) + 1);
    expect({ ...current, tags: original.tags, revisionId: original.revisionId, revisionNumber: original.revisionNumber,
      updatedAt: original.updatedAt }).toEqual(original);
    expect(methods.filter(method => method === "PATCH")).toHaveLength(1);
  } finally { globalThis.fetch = originalFetch; await handler.close(); }
});
