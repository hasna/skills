import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packSkillBundle } from "./skill-bundle.js";
import { reconcileSkillSessionIfSafe, SESSION_RENEWAL_TIMEOUT_MS } from "./session-reconciliation.js";
import { cacheSelectionBundle, readSkillSessionSnapshot, selectionKey, sessionReceiptPath, skillSessionSnapshotBinding, writeSelectionJson, writeSkillSession } from "./selection-cache.js";
import { buildSkillContext } from "./skill-context.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-pin-renewal-")); roots.push(root);
  const source = join(root, "source"), cacheDir = join(root, "cache"); mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: review-code\ndescription: Review code\nkind: instruction\n---\nHistorical body only.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "review-code", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const oldProfile: ResolvedSkillProfile = { authority: "https://skills.example.com/api/v1", workspaceId: "org-test", profileId: "fleet", profileRevision: "old", selections: [] };
  oldProfile.selections.push({ authority: oldProfile.authority, workspaceId: oldProfile.workspaceId, profileRevision: oldProfile.profileRevision,
    slug: "review-code", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: ["review"] }, authorizationEpoch: "e".repeat(32) });
  const target = structuredClone(oldProfile); target.profileRevision = "current";
  target.selections[0] = { ...target.selections[0]!, version: "2.0.0", bundleDigest: `sha256:${"b".repeat(64)}`, profileRevision: "current" };
  const response = () => new Response(bundle.bytes, { headers: { "X-Skill-Authorization-Epoch": "e".repeat(32), "X-Skill-Version": "1.0.0", "X-Skill-Bundle-Sha256": bundle.sha256 } });
  const old = { schemaVersion: 1 as const, verifiedAt: new Date(0).toISOString(), profile: oldProfile, sessionId: "session", generation: 7, loaded: [selectionKey(oldProfile.selections[0]!)] };
  await cacheSelectionBundle(oldProfile.selections[0]!, response(), { cacheDir });
  writeSelectionJson(sessionReceiptPath("session", { cacheDir }), old);
  const before = readFileSync(sessionReceiptPath("session", { cacheDir }));
  const requests: string[] = [];
  const client: ProfileClient = { authority: oldProfile.authority, supportsPinRenewal: async () => true, resolveProfile: async () => target, getBundle: async (slug, version) => { requests.push(`${slug}@${version}`); return response(); }, recordStation: async () => { throw Error("No station write permitted"); } };
  return { cacheDir, old, target, response, before, client, requests };
}

test("renewal preserves the complete historical pin, parent custody, dedup keys and restored body", async () => {
  const f = await fixture();
  const parent = { sessionId: "parent", generation: 4, receiptSha256: "d".repeat(64) };
  writeSelectionJson(sessionReceiptPath("session", f), { ...f.old, parent });
  const before = readFileSync(sessionReceiptPath("session", f));
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "session", restore: true }, { ...f, cached: true, authority: f.client.authority })).rejects.toMatchObject({ code: "CACHED_PROFILE_EXPIRED" });
  expect(await reconcileSkillSessionIfSafe("session", "fleet", f)).toBe(true);
  const current = readSkillSessionSnapshot("session", f);
  expect(current.receipt.profile).toEqual(f.old.profile); expect(current.receipt.loaded).toEqual(f.old.loaded);
  expect(current.receipt.parent).toEqual(parent); expect(current.generation).toBe(8);
  expect(f.requests).toEqual(["review-code@1.0.0"]);
  const archiveRoot = join(f.cacheDir, "session-reconciliations"), operation = join(archiveRoot, readdirSync(archiveRoot)[0]!);
  expect(readFileSync(join(operation, "original.json"))).toEqual(before);
  const result = await buildSkillContext({ profileId: "fleet", sessionId: "session", restore: true }, { ...f, cached: true, authority: f.client.authority });
  expect(result.context).toContain("Historical body only."); expect(result.receipt.profileRevision).toBe("old");
});

for (const change of ["removed", "unloaded-removed", "trigger", "alias", "authority", "workspace", "profile", "denied", "deleted", "digest", "header", "profile-race", "session-race", "epoch-mismatch", "epoch-missing", "bundle-epoch", "no-capability", "legacy-upgrade"] as const) {
  test(`renewal refuses ${change} without refreshing or replacing the old pin`, async () => {
    const f = await fixture(); let reads = 0;
    if (change === "unloaded-removed") { f.old.loaded = []; writeSelectionJson(sessionReceiptPath("session", f), f.old); }
    if (change === "legacy-upgrade") { delete f.old.profile.selections[0]!.authorizationEpoch; writeSelectionJson(sessionReceiptPath("session", f), f.old); }
    const before = readFileSync(sessionReceiptPath("session", f));
    if (change === "removed" || change === "unloaded-removed") f.target.selections = [];
    if (change === "trigger") f.target.selections[0]!.triggers = { always: true };
    if (change === "alias") f.target.selections[0]!.aliases = ["changed-alias"];
    if (change === "authority") f.target.authority = "https://other.example.com/api/v1";
    if (change === "workspace") { f.target.workspaceId = "other-org"; f.target.selections[0]!.workspaceId = "other-org"; }
    if (change === "epoch-mismatch") f.target.selections[0]!.authorizationEpoch = "f".repeat(32);
    if (change === "epoch-missing") delete f.target.selections[0]!.authorizationEpoch;
    if (change === "no-capability") f.client.supportsPinRenewal = async () => false;
    if (change === "profile") f.target.profileId = "other-profile";
    const client: ProfileClient = { ...f.client,
      resolveProfile: async () => {
        reads++;
        return change === "profile-race" && reads > 1 ? { ...f.target, profileRevision: "raced", selections: [] } : f.target;
      },
      getBundle: async () => {
        if (change === "bundle-epoch") { const r = f.response(); r.headers.delete("X-Skill-Authorization-Epoch"); return r; }
        if (change === "denied" || change === "deleted") return new Response("Untrusted refusal content", { status: change === "denied" ? 403 : 410 });
        if (change === "digest") return new Response("Untrusted substituted bytes");
        if (change === "header") return new Response("no", { headers: { "X-Skill-Version": "2.0.0" } });
        if (change === "session-race") { const snapshot = readSkillSessionSnapshot("session", f); writeSkillSession(snapshot.receipt, { current: skillSessionSnapshotBinding(snapshot) }, f); }
        return f.response();
      },
    };
    await expect(reconcileSkillSessionIfSafe("session", "fleet", { ...f, client })).rejects.toThrow();
    if (change !== "session-race") expect(readFileSync(sessionReceiptPath("session", f))).toEqual(before);
    else expect(readSkillSessionSnapshot("session", f).receipt.verifiedAt).toBe(f.old.verifiedAt);
    expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
  });
}

test("renewal has a finite shared deadline and no delayed renewal after a stalled authority responds", async () => {
  const f = await fixture(); let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  const start = performance.now();
  await expect(reconcileSkillSessionIfSafe("session", "fleet", { ...f, client: { ...f.client, resolveProfile: async () => { await stalled; return f.target; } } })).rejects.toMatchObject({ code: "SKILLS_API_UNAVAILABLE" });
  expect(performance.now() - start).toBeLessThan(SESSION_RENEWAL_TIMEOUT_MS + 1500);
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
  expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
});

for (const epochs of [true, false]) test(`legacy exact-current renewal is fresh authorization, epochs=${epochs}`, async () => {
  const f = await fixture();
  delete f.old.profile.selections[0]!.authorizationEpoch;
  writeSelectionJson(sessionReceiptPath("session", f), f.old);
  f.target.selections[0] = { ...f.old.profile.selections[0]!, profileRevision: f.target.profileRevision,
    ...(epochs ? { authorizationEpoch: "e".repeat(32) } : {}) };
  f.client.supportsPinRenewal = async () => epochs;
  expect(await reconcileSkillSessionIfSafe("session", "fleet", f)).toBe(true);
  expect(readSkillSessionSnapshot("session", f).receipt.profile).toEqual(f.target);
  expect(f.requests).toEqual([]);
});

test("same-version known epoch mismatch refuses revival rather than treating it as legacy", async () => {
  const f = await fixture();
  f.target.selections[0] = { ...f.old.profile.selections[0]!, profileRevision: f.target.profileRevision, authorizationEpoch: "f".repeat(32) };
  await expect(reconcileSkillSessionIfSafe("session", "fleet", f)).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
});

test("shared deadline cancels a stalled authenticated bundle body without renewing", async () => {
  const f = await fixture(); let cancelled = false;
  f.client.getBundle = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "X-Skill-Authorization-Epoch": "e".repeat(32) } });
  await expect(reconcileSkillSessionIfSafe("session", "fleet", f)).rejects.toMatchObject({ code: "SKILLS_API_UNAVAILABLE" });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(cancelled).toBe(true);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
});

test("historical authorization bounds concurrent reads and checks every old selection", async () => {
  const f = await fixture(); const original = f.old.profile.selections[0]!;
  f.old.profile.selections = Array.from({ length: 9 }, (_, i) => ({ ...original, slug: `fixture-${i}` }));
  f.old.loaded = []; writeSelectionJson(sessionReceiptPath("session", f), f.old);
  f.target.selections = f.old.profile.selections.map(selection => ({ ...selection, version: "2.0.0", bundleDigest: `sha256:${"b".repeat(64)}`, profileRevision: f.target.profileRevision }));
  let active = 0, maximum = 0, count = 0;
  f.client.getBundle = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; count++; return f.response(); };
  expect(await reconcileSkillSessionIfSafe("session", "fleet", f)).toBe(true);
  expect(maximum).toBe(4); expect(count).toBe(9);
  expect(readSkillSessionSnapshot("session", f).receipt.profile).toEqual(f.old.profile);
});
