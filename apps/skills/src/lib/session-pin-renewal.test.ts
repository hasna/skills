import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packSkillBundle, SkillBundleInspectionError } from "./skill-bundle.js";
import { createHash } from "node:crypto";
import { reconcileSkillSession, reconcileSkillSessionIfSafe, SESSION_RENEWAL_REFUSAL_TTL_MS, SESSION_RENEWAL_TIMEOUT_MS } from "./session-reconciliation.js";
import { activateSelectionProfile, cacheSelectionBundle, readSkillSessionSnapshot, selectionKey, sessionReceiptPath, skillSessionSnapshotBinding, SkillSelectionError, writeSelectionJson, writeSkillSession } from "./selection-cache.js";
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
  await expect(reconcileSkillSessionIfSafe("session", "fleet", { ...f, client: { ...f.client, resolveProfile: async () => { await stalled; return f.target; } } })).rejects.toMatchObject({ code: "SESSION_RENEWAL_TIMEOUT" });
  expect(performance.now() - start).toBeLessThan(SESSION_RENEWAL_TIMEOUT_MS + 1500);
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
  expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
  // A spent budget is not a definitive answer, so it is never remembered.
  expect(existsSync(join(f.cacheDir, "session-renewal-refusals"))).toBe(false);
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
  await expect(reconcileSkillSessionIfSafe("session", "fleet", f)).rejects.toMatchObject({ code: "SESSION_RENEWAL_TIMEOUT" });
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

// Remembered refusals: the managed hook must not resolve the whole profile on
// every prompt after a definitive refusal, and the record must never grant.
const T0 = Date.parse("2026-10-07T12:00:00.000Z");
const refusalPath = (cacheDir: string) => join(cacheDir, "session-renewal-refusals", `${createHash("sha256").update(JSON.stringify("session")).digest("hex")}.json`);
function counted(f: Awaited<ReturnType<typeof fixture>>, target: () => ResolvedSkillProfile = () => f.target) {
  let reads = 0;
  const client: ProfileClient = { ...f.client, resolveProfile: async () => { reads++; return structuredClone(target()); } };
  return { reads: () => reads, at: (ms: number) => ({ ...f, client, now: () => T0 + ms }) };
}

test("a definitive refusal is reused for the exact receipt inside its window without another authority read", async () => {
  const f = await fixture(); f.target.selections = [];
  const c = counted(f);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(0))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(1);
  for (const ms of [1, 60_000, SESSION_RENEWAL_REFUSAL_TTL_MS - 1]) {
    await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(ms))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  }
  expect(c.reads()).toBe(1);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
  expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
});

for (const change of ["removed", "revoked"] as const) test(`a ${change} skill still refuses after the refusal window lapses`, async () => {
  const f = await fixture();
  if (change === "removed") f.target.selections = [];
  else f.target.selections[0]!.authorizationEpoch = "f".repeat(32); // deletion or archive rotates the epoch
  const c = counted(f);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(0))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(SESSION_RENEWAL_REFUSAL_TTL_MS))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(2);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(SESSION_RENEWAL_REFUSAL_TTL_MS + 1))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(2);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
  expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
});

test("a remembered refusal never authorizes: an authority that would now renew is asked only after the window", async () => {
  const f = await fixture(), removed = structuredClone(f.target); removed.selections = [];
  let current = removed;
  const c = counted(f, () => current);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(0))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  current = f.target;
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(SESSION_RENEWAL_REFUSAL_TTL_MS - 1))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(1);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
  expect(await reconcileSkillSessionIfSafe("session", "fleet", c.at(SESSION_RENEWAL_REFUSAL_TTL_MS))).toBe(true);
  expect(c.reads()).toBe(3);
  const renewed = readSkillSessionSnapshot("session", f).receipt;
  expect(renewed.profile).toEqual(f.old.profile); expect(renewed.verifiedAt).toBe(new Date(T0 + SESSION_RENEWAL_REFUSAL_TTL_MS).toISOString());
});

for (const change of ["receipt", "revision"] as const) test(`a changed ${change} invalidates the remembered refusal`, async () => {
  const f = await fixture(); f.target.selections = [];
  activateSelectionProfile({ ...f.target, profileRevision: "current" }, f);
  const c = counted(f);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(0))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(1))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(1);
  if (change === "receipt") { const snapshot = readSkillSessionSnapshot("session", f); writeSkillSession(snapshot.receipt, { current: skillSessionSnapshotBinding(snapshot) }, f); }
  else activateSelectionProfile({ ...f.target, profileRevision: "synced-later", selections: [] }, f);
  const before = readFileSync(sessionReceiptPath("session", f));
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(2))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(2);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(before);
});

for (const forgery of ["control", "extended", "foreign-receipt", "future", "other-profile", "other-authority", "extra-field", "malformed", "oversized"] as const) {
  test(`a ${forgery} refusal record ${forgery === "control" ? "is honoured only as a refusal" : "is ignored and the authority decides"}`, async () => {
    const f = await fixture(), c = counted(f), snapshot = readSkillSessionSnapshot("session", f);
    const record: Record<string, unknown> = { schemaVersion: 1, kind: "managed-hook-renewal-refusal", code: "SESSION_RECONCILIATION_REQUIRED",
      sessionId: "session", receiptSha256: snapshot.sha256, profileId: "fleet", authority: f.old.profile.authority, workspaceId: f.old.profile.workspaceId,
      refusedRevision: "current", localProfileRevision: null, recordedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + SESSION_RENEWAL_REFUSAL_TTL_MS).toISOString() };
    if (forgery === "extended") record.expiresAt = new Date(T0 + 24 * 60 * 60 * 1000).toISOString();
    if (forgery === "foreign-receipt") record.receiptSha256 = "0".repeat(64);
    if (forgery === "future") { record.recordedAt = new Date(T0 + 10_000).toISOString(); record.expiresAt = new Date(T0 + 10_000 + SESSION_RENEWAL_REFUSAL_TTL_MS).toISOString(); }
    if (forgery === "other-profile") record.profileId = "other-profile";
    if (forgery === "other-authority") record.authority = "https://other.example.com/api/v1";
    if (forgery === "extra-field") record.authorized = true;
    if (forgery === "malformed") { mkdirSync(join(f.cacheDir, "session-renewal-refusals"), { recursive: true }); writeFileSync(refusalPath(f.cacheDir), "{not json", { mode: 0o600 }); }
    // Otherwise valid, but padded beyond the 4 KiB record bound.
    else if (forgery === "oversized") { mkdirSync(join(f.cacheDir, "session-renewal-refusals"), { recursive: true }); writeFileSync(refusalPath(f.cacheDir), `${JSON.stringify(record)}${" ".repeat(5000)}\n`, { mode: 0o600 }); }
    else writeSelectionJson(refusalPath(f.cacheDir), record);
    if (forgery === "control") {
      await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(1))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
      expect(c.reads()).toBe(0); expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
    } else {
      expect(await reconcileSkillSessionIfSafe("session", "fleet", c.at(1))).toBe(true);
      expect(c.reads()).toBe(2);
    }
  });
}

test("explicit session reconciliation ignores a remembered refusal and supersedes it", async () => {
  const f = await fixture(); f.target.selections = [];
  const c = counted(f);
  await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(0))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  const remembered = readFileSync(refusalPath(f.cacheDir));
  const input = { sessionId: "session", fromProfile: "fleet", fromRevision: "old", receiptSha256: readSkillSessionSnapshot("session", f).sha256, selectionProfile: "fleet", profileRevision: "current" };
  const planned = await reconcileSkillSession(input, c.at(1));
  expect(planned.applied).toBe(false); expect(planned.plan.retiredLoadedCount).toBe(1);
  const applied = await reconcileSkillSession({ ...input, apply: true, planDigest: planned.planDigest, planIssuedAt: planned.plan.issuedAt, planExpiresAt: planned.plan.expiresAt }, c.at(2));
  expect(applied.applied).toBe(true);
  expect(readFileSync(refusalPath(f.cacheDir))).toEqual(remembered);
  // The reviewed receipt is fresh and has different bytes; the old record cannot apply to it.
  expect(await reconcileSkillSessionIfSafe("session", "fleet", c.at(3))).toBe(false);
});

test("authority failures keep their codes, are retried and are never remembered", async () => {
  const f = await fixture(); let reads = 0;
  const client: ProfileClient = { ...f.client, resolveProfile: async () => { reads++; throw new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Skills API request failed (HTTP 503)"); } };
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(reconcileSkillSessionIfSafe("session", "fleet", { ...f, client, now: () => T0 + attempt })).rejects.toMatchObject({ code: "SKILLS_API_UNAVAILABLE" });
  }
  expect(reads).toBe(2);
  expect(existsSync(join(f.cacheDir, "session-renewal-refusals"))).toBe(false);
  expect(readFileSync(sessionReceiptPath("session", f))).toEqual(f.before);
});

test("an unreadable synced profile disables refusal reuse rather than guessing its revision", async () => {
  const f = await fixture(); f.target.selections = [];
  const profiles = join(f.cacheDir, "profiles"); mkdirSync(profiles, { recursive: true });
  writeFileSync(join(profiles, `${createHash("sha256").update(JSON.stringify("fleet")).digest("hex")}.json`), "{not json", { mode: 0o600 });
  const c = counted(f);
  for (const ms of [0, 1]) await expect(reconcileSkillSessionIfSafe("session", "fleet", c.at(ms))).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_REQUIRED" });
  expect(c.reads()).toBe(2);
  expect(existsSync(join(f.cacheDir, "session-renewal-refusals"))).toBe(false);
});

// After-deadline mapping: block the event loop past the renewal deadline so the
// renewal timer cannot run, then throw each error class from the authority read.
const cutShort = (name: "AbortError" | "TimeoutError") => new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Unable to reach the configured Skills API", { cause: new DOMException("cut short", name) });
const deadlineCases: Array<[string, () => unknown, "timeout" | "same"]> = [
  ["AbortError", () => new DOMException("aborted", "AbortError"), "timeout"],
  ["TimeoutError", () => new DOMException("timed out", "TimeoutError"), "timeout"],
  ["BUNDLE_TIMEOUT", () => new SkillBundleInspectionError("BUNDLE_TIMEOUT", "Bundle inspection deadline exceeded"), "timeout"],
  ["BUNDLE_ABORTED", () => new SkillBundleInspectionError("BUNDLE_ABORTED", "Bundle inspection aborted"), "timeout"],
  ["aborted request", () => cutShort("AbortError"), "timeout"],
  ["timed-out request", () => cutShort("TimeoutError"), "timeout"],
  ["HTTP 503", () => new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Skills API request failed (HTTP 503)"), "same"],
  ["HTTP 429", () => new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Skills API request failed (HTTP 429)"), "same"],
  ["refused connection", () => new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Unable to reach the configured Skills API"), "same"],
  ["BUNDLE_INVALID", () => new SkillBundleInspectionError("BUNDLE_INVALID", "Invalid or truncated gzip bundle"), "same"],
  ["BUNDLE_DIGEST_MISMATCH", () => new SkillSelectionError("BUNDLE_DIGEST_MISMATCH", "The skill bundle does not match its selected digest."), "same"],
  ["PROFILE_IDENTITY_MISMATCH", () => new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "mismatch"), "same"],
  ["plain Error", () => new Error("The Skills API returned an invalid profile response"), "same"],
  ["TypeError", () => new TypeError("undefined is not an object"), "same"],
];

test("after the deadline only real deadline or abort signals become SESSION_RENEWAL_TIMEOUT", async () => {
  const fixtures = await Promise.all(deadlineCases.map(() => fixture()));
  const thrown = deadlineCases.map(([, make]) => make());
  const blockUntil = performance.now() + SESSION_RENEWAL_TIMEOUT_MS + 100;
  const outcomes = await Promise.allSettled(fixtures.map((f, index) => reconcileSkillSessionIfSafe("session", "fleet", { ...f, client: { ...f.client,
    resolveProfile: async () => {
      await Promise.resolve(); // every renewal has computed its deadline before the loop blocks
      while (performance.now() < blockUntil) { /* the renewal timer cannot run */ }
      throw thrown[index];
    } } })));
  deadlineCases.forEach(([name, , expected], index) => {
    const outcome = outcomes[index]!;
    expect(outcome.status, name).toBe("rejected");
    const reason = (outcome as PromiseRejectedResult).reason;
    if (expected === "timeout") expect(reason, name).toMatchObject({ code: "SESSION_RENEWAL_TIMEOUT" });
    else expect(reason, name).toBe(thrown[index]);
    expect(readFileSync(sessionReceiptPath("session", fixtures[index]!)), name).toEqual(fixtures[index]!.before);
    expect(existsSync(join(fixtures[index]!.cacheDir, "session-renewal-refusals")), name).toBe(false);
  });
}, 30_000);

test("before the deadline a deadline-shaped error is not relabelled", async () => {
  for (const [name, make] of deadlineCases.filter(([, , expected]) => expected === "timeout")) {
    const f = await fixture(), error = make();
    await expect(reconcileSkillSessionIfSafe("session", "fleet", { ...f, client: { ...f.client, resolveProfile: async () => { throw error; } } }), name).rejects.toBe(error);
  }
});
