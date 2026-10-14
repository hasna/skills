import { afterEach, expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client.js";
import { revisionIdOf, type RevisionContent } from "./revision.js";
import { metadataPatch } from "./skill-metadata-update.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function fixture(options: { permission?: boolean; etag?: boolean; outcome?: "transport" | "500" | "409" | "alter-body" } = {}) {
  let content: RevisionContent = { slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "Development Tools", tags: ["old"],
    source: "custom", kind: "instruction", version: "1.0.0", skillMd: "Synthetic instruction body", bundleSha256: "a".repeat(64), bundleByteSize: 42 };
  const original = structuredClone(content);
  const calls: Array<{ method: string; body?: any; guard?: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    if (path.endsWith("/whoami")) return Response.json({ organization: { id: "fixture-org" } });
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"], permissions: { publish: options.permission ?? true } });
    if (!path.endsWith("/fixture-skill")) throw Error("Unexpected endpoint");
    const payload = () => ({ ...content, source: "remote", publishedSource: content.source, revisionId: revisionIdOf(content) });
    const headers = (): Record<string, string> => options.etag === false ? {} : { ETag: `"${revisionIdOf(content)}"` };
    calls.push({ method, ...(method === "PATCH" ? { body: JSON.parse(String(init?.body)), guard: new Headers(init?.headers).get("if-match") } : {}) });
    if (method === "PATCH") {
      if (options.outcome === "409") return Response.json({ code: "REVISION_CONFLICT" }, { status: 409 });
      expect(new Headers(init?.headers).get("if-match")).toBe(`"${revisionIdOf(content)}"`);
      content = { ...content, ...JSON.parse(String(init?.body)) };
      if (options.outcome === "alter-body") content.skillMd = "Unexpected changed body";
      if (options.outcome === "transport") throw new TypeError("Synthetic connection reset after commit");
      if (options.outcome === "500") return new Response(null, { status: 500 });
    }
    return Response.json(payload(), { headers: headers() });
  }) as typeof fetch;
  return { client: new RemoteSkillsClient("synthetic", "https://example.invalid"), calls, original, current: () => content,
    change: () => { content = { ...content, description: "Concurrent change" }; } };
}
test("preview is read-only; apply sends only category/tags with the exact ETag and preserves body/version/bundle", async () => {
  const f = fixture();
  const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { category: "Productivity & Organization", tags: ["new"] });
  expect(f.calls.map(call => call.method)).toEqual(["GET"]);
  expect(plan.before.skillMd).toBe(f.original.skillMd);
  expect(JSON.parse(plan.originalDocument).skillMd).toBe(f.original.skillMd);
  expect(await f.client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied", revisionId: revisionIdOf(f.current()) });
  expect(f.calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([{ category: "Productivity & Organization", tags: ["new"] }]);
  expect({ ...f.current(), category: f.original.category, tags: f.original.tags }).toEqual(f.original);
});
for (const outcome of ["transport", "500"] as const) test(`an ambiguous ${outcome} commit is reconciled once with no duplicate PATCH`, async () => {
  const f = fixture({ outcome }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  expect(await f.client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "reconciled" });
  expect(f.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});
test("a missing server ETag refuses preview", async () => {
  const f = fixture({ etag: false });
  await expect(f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] })).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
});
test("a stale plan refuses before PATCH", async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] }); f.change();
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_REVISION_CONFLICT" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
});
test("server conflict is definitive and never retried", async () => {
  const f = fixture({ outcome: "409" }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ status: 409 });
  expect(f.calls.map(call => call.method)).toEqual(["GET", "GET", "PATCH"]);
});
test("publish refusal prevents PATCH", async () => {
  const f = fixture({ permission: false }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "SKILLS_PERMISSION_DENIED" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
});
test("an immutable body change is unconfirmed even when the server reports success", async () => {
  const f = fixture({ outcome: "alter-body" }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_UPDATE_UNCONFIRMED" });
  expect(f.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});
test("authority/organization and missing revision guards cannot be substituted", async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  for (const changed of [{ ...plan, expectedRevisionId: "" }, { ...plan, authority: "https://other.invalid" }, { ...plan, organizationId: "other-org" }, { ...plan, originalDocument: "{}" }]) {
    await expect(f.client.applySkillMetadataUpdate(changed)).rejects.toThrow();
  }
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
});
test("unknown patch fields and invalid tags refuse", () => {
  for (const value of [{ version: "2.0.0" }, { tags: [1] }, { tags: ["x", "x"] }, { category: "" }, {}]) expect(() => metadataPatch(value)).toThrow();
});
