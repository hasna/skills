import { afterEach, expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client.js";
import { revisionIdOf, type RevisionContent } from "./revision.js";
import { metadataPatch, metadataPlan, metadataSnapshot } from "./skill-metadata-update.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
/** Well-formed quoted revision that names no fixture content. */
const mismatchedEtag = `"${"0".repeat(64)}"`;
function fixture(options: { permission?: boolean; permissions?: "absent" | "without-publish"; etag?: boolean; outcome?: "transport" | "500" | "unparseable" | "409" | "alter-body" | "mismatch-etag-after-patch"
  | "500-uncommitted" | "transport-uncommitted" | "unparseable-uncommitted"; servedSlug?: string } = {}) {
  let content: RevisionContent = { slug: options.servedSlug ?? "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "Development Tools", tags: ["old"],
    source: "custom", kind: "instruction", version: "1.0.0", skillMd: "Synthetic instruction body", bundleSha256: "a".repeat(64), bundleByteSize: 42 };
  const original = structuredClone(content);
  const calls: Array<{ method: string; body?: any; guard?: string | null }> = [];
  let etagOverride: string | undefined;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    if (path.endsWith("/whoami")) return Response.json({ organization: { id: "fixture-org" } });
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"],
      ...(options.permissions === "absent" ? {} : { permissions: options.permissions === "without-publish" ? { read: true } : { publish: options.permission ?? true } }) });
    if (!path.endsWith("/fixture-skill")) throw Error("Unexpected endpoint");
    const payload = () => ({ ...content, source: "remote", publishedSource: content.source, revisionId: revisionIdOf(content) });
    const headers = (): Record<string, string> => options.etag === false ? {} : { ETag: etagOverride ?? `"${revisionIdOf(content)}"` };
    calls.push({ method, ...(method === "PATCH" ? { body: JSON.parse(String(init?.body)), guard: new Headers(init?.headers).get("if-match") } : {}) });
    if (method === "PATCH") {
      if (options.outcome === "409") return Response.json({ code: "REVISION_CONFLICT" }, { status: 409 });
      if (options.outcome === "500-uncommitted") return new Response(null, { status: 500 });
      if (options.outcome === "transport-uncommitted") throw new TypeError("Synthetic connection reset before commit");
      if (options.outcome === "unparseable-uncommitted") return new Response("not json", { status: 200 });
      expect(new Headers(init?.headers).get("if-match")).toBe(`"${revisionIdOf(content)}"`);
      content = { ...content, ...JSON.parse(String(init?.body)) };
      if (options.outcome === "alter-body") content.skillMd = "Unexpected changed body";
      if (options.outcome === "mismatch-etag-after-patch") etagOverride = mismatchedEtag;
      if (options.outcome === "transport") throw new TypeError("Synthetic connection reset after commit");
      if (options.outcome === "500") return new Response(null, { status: 500 });
      if (options.outcome === "unparseable") return new Response("not json", { status: 200 });
    }
    return Response.json(payload(), { headers: headers() });
  }) as typeof fetch;
  return { client: new RemoteSkillsClient("synthetic", "https://example.invalid"), calls, original, current: () => content,
    change: () => { content = { ...content, description: "Concurrent change" }; }, mismatchEtag: () => { etagOverride = mismatchedEtag; } };
}
test("preview is read-only; apply sends only category/tags with the exact ETag and preserves body/version/bundle", async () => {
  const f = fixture();
  const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { category: "Productivity & Organization", tags: ["new"] });
  expect(f.calls.map(call => call.method)).toEqual(["GET"]);
  expect(plan.before.skillMd).toBe(f.original.skillMd);
  expect(JSON.parse(plan.originalDocument).skillMd).toBe(f.original.skillMd);
  expect(await f.client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied", revisionId: revisionIdOf(f.current()) });
  expect(f.calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([{ category: "Productivity & Organization", tags: ["new"] }]);
  expect(f.calls.map(call => call.method)).toEqual(["GET", "GET", "PATCH", "GET"]);
  expect({ ...f.current(), category: f.original.category, tags: f.original.tags }).toEqual(f.original);
});
for (const outcome of ["transport", "500", "unparseable"] as const) test(`an ambiguous ${outcome} commit is reconciled once with no duplicate PATCH`, async () => {
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
  for (const value of [{ version: "2.0.0" }, { tags: [1] }, { tags: ["x", "x"] }, { category: "" }, {},
    { category: "x".repeat(513) }, { category: "First\nSecond" }, { tags: ["x".repeat(513)] }, { tags: ["First\nSecond"] }]) {
    expect(() => metadataPatch(value)).toThrow();
  }
});
for (const field of ["displayName", "description", "category", "source"] as const) test(`published ${field} content is preserved while invalid types and revisions refuse`, () => {
  const content: RevisionContent = { slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "old", tags: [],
    source: "custom", kind: "instruction", [field]: `${"x".repeat(700)}\nPublished details` };
  const revisionId = revisionIdOf(content), etag = `"${revisionId}"`;
  const snapshot = { ...content, publishedSource: content.source, revisionId };
  expect(metadataSnapshot(snapshot, etag).content).toEqual(content);
  const serverField = field === "source" ? "publishedSource" : field;
  for (const value of [null, 42, undefined, {}, "Changed after revision"]) {
    expect(() => metadataSnapshot({ ...snapshot, [serverField]: value }, etag)).toThrow();
  }
});
test("published tags preserve their strings while malformed arrays and changed revisions refuse", () => {
  const content: RevisionContent = { slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "old", tags: [],
    source: "custom", kind: "instruction" };
  for (const tags of [["x".repeat(700)], ["First line\nSecond line"], []]) {
    const published = { ...content, tags }, revisionId = revisionIdOf(published), etag = `"${revisionId}"`;
    const snapshot = { ...published, publishedSource: published.source, revisionId };
    expect(metadataSnapshot(snapshot, etag).content.tags).toEqual(tags);
    expect(() => metadataSnapshot({ ...snapshot, tags: ["Changed after revision"] }, etag)).toThrow();
  }
  for (const tags of [null, "tag", [42], [null], [{}], [undefined]]) {
    const malformed = { ...content, tags }, revisionId = revisionIdOf(malformed as unknown as RevisionContent);
    expect(() => metadataSnapshot({ ...malformed, publishedSource: content.source, revisionId }, `"${revisionId}"`)).toThrow();
  }
});
for (const [field, value] of [["skillMd", "Tampered body that was never published"], ["description", "Tampered description"], ["category", "Tampered"],
  ["tags", ["tampered"]], ["version", "9.9.9"], ["bundleSha256", "b".repeat(64)]] as const) test(`a plan whose before.${field} no longer matches its expected revision refuses before PATCH`, async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { category: "Productivity & Organization" });
  const tampered = { ...plan, before: { ...plan.before, [field]: value } };
  // metadataPlan re-validates before through metadataSnapshot bound to expectedRevisionId, so the refusal carries its code.
  expect(() => metadataPlan(tampered)).toThrow(expect.objectContaining({ code: "INVALID_METADATA_SNAPSHOT" }));
  await expect(f.client.applySkillMetadataUpdate(tampered)).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
  expect(f.current()).toEqual(f.original);
});
test("preview refuses a readback whose slug differs from the requested slug", async () => {
  const f = fixture({ servedSlug: "other-skill" });
  await expect(f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] })).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.map(call => call.method)).toEqual(["GET"]);
});
test("a plan that changes nothing returns unchanged without sending a PATCH", async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { category: f.original.category, tags: [...f.original.tags] });
  expect(await f.client.applySkillMetadataUpdate(plan)).toEqual({ status: "unchanged", revisionId: revisionIdOf(f.original) });
  expect(f.calls.map(call => call.method)).toEqual(["GET", "GET"]);
  expect(f.current()).toEqual(f.original);
});
test("a present but mismatched server ETag refuses preview", async () => {
  const f = fixture(); f.mismatchEtag();
  await expect(f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] })).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.map(call => call.method)).toEqual(["GET"]);
});
test("a present but mismatched server ETag at apply refuses before PATCH", async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] }); f.mismatchEtag();
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
  expect(f.current()).toEqual(f.original);
});
test("a mismatched ETag on the write response and readback is never confirmation", async () => {
  const f = fixture({ outcome: "mismatch-etag-after-patch" }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_UPDATE_UNCONFIRMED" });
  expect(f.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});
for (const permissions of ["absent", "without-publish"] as const) test(`capabilities ${permissions === "absent" ? "with no permissions field" : "with permissions but no publish"} refuse before PATCH`, async () => {
  const f = fixture({ permissions }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "SKILLS_PERMISSION_DENIED" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
  expect(f.current()).toEqual(f.original);
});
test("a patch whose getters change between reads is captured once and only the validated value is sent", async () => {
  const invalid = `${"x".repeat(611)}\n`;
  const shifting = () => {
    let categoryReads = 0, tagsReads = 0;
    return { get category() { return categoryReads++ === 0 ? "Productivity & Organization" : invalid; },
      get tags() { return tagsReads++ === 0 ? ["curated"] : [invalid]; } };
  };
  const validated = { category: "Productivity & Organization", tags: ["curated"] };
  expect(metadataPatch(shifting())).toEqual(validated);
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", shifting());
  expect(plan.patch).toEqual(validated);
  expect(await f.client.applySkillMetadataUpdate(plan)).toMatchObject({ status: "applied" });
  expect(f.calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([validated]);
  expect(f.current()).toMatchObject(validated);
});
// The server's PATCH also accepts skillMd, version, kind and description, so apply must send the copy it validated before its first await.
test("apply sends its validated patch copy even when the caller mutates the plan after calling apply", async () => {
  const validated = { category: "Productivity & Organization" };
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { ...validated });
  const pending = f.client.applySkillMetadataUpdate(plan);
  (plan.patch as Record<string, unknown>).skillMd = "Injected after validation";
  const result = await pending.catch((error: unknown) => error);
  expect(f.calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([validated]);
  expect(f.current()).toEqual({ ...f.original, ...validated });
  expect(result).toMatchObject({ status: "applied" });
});
test("a plan handed straight to apply whose getters shift after validation sends only the validated copy", async () => {
  const validated = { category: "Productivity & Organization" };
  const f = fixture(); const prepared = await f.client.prepareSkillMetadataUpdate("fixture-skill", { ...validated });
  let patchReads = 0, categoryReads = 0;
  const shiftingPatch = { get category() { return categoryReads++ === 0 ? validated.category : "Shifted after validation"; } };
  const plan = { ...prepared, get patch() { return patchReads++ === 0 ? shiftingPatch : { ...validated, skillMd: "Injected after validation" }; } };
  const result = await f.client.applySkillMetadataUpdate(plan).catch((error: unknown) => error);
  expect(f.calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([validated]);
  expect(f.current()).toEqual({ ...f.original, ...validated });
  expect(result).toMatchObject({ status: "applied" });
});
for (const outcome of ["500-uncommitted", "transport-uncommitted", "unparseable-uncommitted"] as const) test(`an ambiguous ${outcome.replace("-uncommitted", "")} PATCH that did not commit is unconfirmed after one PATCH and one readback`, async () => {
  const f = fixture({ outcome }); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  await expect(f.client.applySkillMetadataUpdate(plan)).rejects.toMatchObject({ code: "METADATA_UPDATE_UNCONFIRMED" });
  expect(f.calls.map(call => call.method)).toEqual(["GET", "GET", "PATCH", "GET"]);
  expect(f.current()).toEqual(f.original);
});
for (const [field, value] of [["skillMd", "Tampered preserved body"], ["description", "Tampered description"], ["version", "9.9.9"]] as const) test(`a plan whose originalDocument keeps its revisionId but has an edited ${field} refuses before PATCH`, async () => {
  const f = fixture(); const plan = await f.client.prepareSkillMetadataUpdate("fixture-skill", { tags: [] });
  const document = JSON.parse(plan.originalDocument);
  expect(document.revisionId).toBe(plan.expectedRevisionId);
  const tampered = { ...plan, originalDocument: JSON.stringify({ ...document, [field]: value }) };
  // The preserved original is re-hashed, so an intact revisionId field cannot vouch for edited content.
  expect(() => metadataPlan(tampered)).toThrow(expect.objectContaining({ code: "INVALID_METADATA_SNAPSHOT" }));
  await expect(f.client.applySkillMetadataUpdate(tampered)).rejects.toMatchObject({ code: "INVALID_METADATA_SNAPSHOT" });
  expect(f.calls.some(call => call.method === "PATCH")).toBe(false);
  expect(f.current()).toEqual(f.original);
});
test("tags accept at most 100 entries", () => {
  const tags = (count: number) => Array.from({ length: count }, (_, index) => `tag-${index}`);
  expect(metadataPatch({ tags: tags(100) }).tags).toEqual(tags(100));
  expect(() => metadataPatch({ tags: tags(101) })).toThrow(expect.objectContaining({ code: "INVALID_METADATA_PATCH" }));
});
test("non-array tags refuse with the patch code", () => {
  for (const tags of ["solo", 5, null, {}]) expect(() => metadataPatch({ tags })).toThrow(expect.objectContaining({ code: "INVALID_METADATA_PATCH" }));
});
test("the validated patch owns its tags array", () => {
  const tags = ["curated"]; const patch = metadataPatch({ tags });
  tags.push("First line\nSecond line");
  expect(patch.tags).toEqual(["curated"]);
});
