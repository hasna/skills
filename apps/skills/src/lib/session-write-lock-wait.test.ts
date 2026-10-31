/**
 * Concurrent hooks of one session (a prompt and the subagents it starts) must
 * not drop context on a session write lock that another Skills process holds
 * for a moment. Each case holds a real, structurally valid lock from another
 * process and releases it (or not) from there.
 */
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packSkillBundle } from "./skill-bundle.js";
import { activateSelectionProfile, cacheSelectionBundle, readSkillSessionSnapshot, readSkillSessionSnapshotIfExists, selectionKey, SESSION_WRITE_LOCK_WAIT_MS, sessionReceiptPath, writeSelectionJson, writeSkillSession, type SkillSessionReceipt } from "./selection-cache.js";
import { buildSkillContext, SESSION_WRITE_BUSY_NOTICE } from "./skill-context.js";
import { loadSelectedSkill } from "./selection-resolver.js";
import { inspectSkillSession } from "./session-reconciliation.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
const releasers: Array<ReturnType<typeof Bun.spawn>> = [];
afterEach(async () => {
  for (const child of releasers.splice(0)) { child.kill(); await child.exited; }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const AUTHORITY = "https://skills.example.com/api/v1";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-lock-wait-")); roots.push(root);
  const cacheDir = join(root, "cache"), source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: fixture\ndescription: Fixture\nkind: instruction\n---\nFixture body.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const profile: ResolvedSkillProfile = { authority: AUTHORITY, workspaceId: "org-test", profileId: "fleet", profileRevision: "r1", selections: ["alpha-skill", "beta-skill"].map(slug => ({
    authority: AUTHORITY, workspaceId: "org-test", profileRevision: "r1", slug, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: [slug.replace("-", " ")] },
  })) };
  activateSelectionProfile(profile, { cacheDir });
  await cacheSelectionBundle(profile.selections[0]!, new Response(bundle.bytes), { cacheDir });
  writeSelectionJson(sessionReceiptPath("parent", { cacheDir }), { schemaVersion: 1, verifiedAt: new Date().toISOString(), profile, sessionId: "parent", generation: 1, loaded: [selectionKey(profile.selections[0]!)] });
  const options = { cacheDir, cached: true, authority: AUTHORITY };
  /** A live writer's lock: valid ownership metadata, private mode, recent. */
  const hold = (sessionId: string, releaseAfterMs?: number) => {
    const path = `${sessionReceiptPath(sessionId, { cacheDir })}.write-lock`;
    const bytes = `${JSON.stringify({ schemaVersion: 1, operationId: randomUUID(), sessionId, pid: process.pid })}\n`;
    writeFileSync(path, bytes, { mode: 0o600 });
    if (releaseAfterMs !== undefined) {
      releasers.push(Bun.spawn([process.execPath, "--no-install", "-e", `await Bun.sleep(${releaseAfterMs}); require("node:fs").unlinkSync(${JSON.stringify(path)});`], { cwd: root, stdout: "ignore", stderr: "ignore" }));
    }
    return { path, bytes };
  };
  return { cacheDir, profile, options, hold };
}

test("a prompt that loads a skill waits for a briefly held session lock instead of refusing", async () => {
  const f = await fixture();
  f.hold("parent", 400);
  const started = performance.now();
  const result = await buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the beta skill" }, f.options);
  expect(result.selections.map(selection => selection.slug)).toEqual(["beta-skill"]);
  expect(performance.now() - started).toBeGreaterThan(300);
  expect(readSkillSessionSnapshot("parent", f.options).receipt.loaded).toContain(selectionKey(f.profile.selections[1]!));
});

test("parallel subagents wait for their parent's briefly held lock and each records its pin", async () => {
  const f = await fixture();
  f.hold("parent", 400);
  const children = await Promise.all(Array.from({ length: 4 }, (_, index) => buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: `child-${index}` }, f.options)));
  expect(children.map(child => child.selections.map(selection => selection.reason))).toEqual(Array(4).fill(["subagent-inherit"]));
  for (let index = 0; index < 4; index++) expect(readSkillSessionSnapshot(`parent:child-${index}`, f.options).receipt.parent?.sessionId).toBe("parent");
});

test("a lock held past the bounded wait still refuses a new session and is never replaced", async () => {
  const f = await fixture();
  const lock = f.hold("parent");
  const started = performance.now();
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "child" }, f.options)).rejects.toMatchObject({ code: "SESSION_WRITE_BUSY" });
  expect(performance.now() - started).toBeGreaterThanOrEqual(SESSION_WRITE_LOCK_WAIT_MS - 50);
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes);
  expect(readSkillSessionSnapshotIfExists("parent:child", f.options)).toBeNull();
});

test("after a lost lock race only bodies the receipt already records are delivered; newly read skills become load commands under one notice", async () => {
  const f = await fixture();
  // A structurally valid legacy lock that never clears by itself.
  const lock = f.hold("parent");
  const before = readFileSync(sessionReceiptPath("parent", f.options));
  const result = await buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the beta skill" }, f.options);
  // Nothing new is delivered unrecorded: every delivered key is in the receipt's loaded set.
  expect(result.selections).toEqual([]);
  expect(result.context).toBe(SESSION_WRITE_BUSY_NOTICE);
  expect(result.omitted.map(entry => [entry.slug, entry.reason, entry.loadCommand])).toEqual([["beta-skill", "write-busy", "skills load beta-skill@1.0.0 --selection-profile fleet --cache-first --session parent"]]);
  expect(inspectSkillSession("parent", f.options).selections.filter(selection => selection.loaded).map(selection => selection.slug)).toEqual(["alpha-skill"]);
  // An explicit re-delivery of a recorded skill is still delivered beside the new one.
  const mixed = await buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the beta skill with $alpha-skill" }, f.options);
  expect(mixed.selections.map(selection => [selection.slug, selection.reason])).toEqual([["alpha-skill", "explicit"]]);
  expect(mixed.context.startsWith(`${SESSION_WRITE_BUSY_NOTICE}\n\nSkill alpha-skill@1.0.0`)).toBe(true);
  expect(mixed.omitted.map(entry => [entry.slug, entry.reason])).toEqual([["beta-skill", "write-busy"]]);
  const loaded = new Set(readSkillSessionSnapshot("parent", f.options).receipt.loaded);
  for (const selection of [...result.selections, ...mixed.selections]) expect(loaded.has(selectionKey(selection))).toBe(true);
  // The receipt and the other writer's lock are untouched.
  expect(readFileSync(sessionReceiptPath("parent", f.options))).toEqual(before);
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes);
});

test("a read-only prompt reads past a live writer's valid lock without waiting, and damaged lock state still refuses it", async () => {
  const f = await fixture();
  const lock = f.hold("parent");
  const before = readFileSync(sessionReceiptPath("parent", f.options));
  const started = performance.now();
  // alpha-skill is already loaded: nothing new, so nothing to write.
  const result = await buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the alpha skill" }, f.options);
  expect(result.selections).toEqual([]);
  expect(performance.now() - started).toBeLessThan(SESSION_WRITE_LOCK_WAIT_MS / 2);
  expect(readFileSync(sessionReceiptPath("parent", f.options))).toEqual(before);
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes);
  // Not a writer lock at all: refused as before, whether or not the prompt writes.
  writeFileSync(lock.path, "damaged", { mode: 0o600 });
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the alpha skill" }, f.options)).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  expect(readFileSync(lock.path, "utf8")).toBe("damaged");
  expect(readFileSync(sessionReceiptPath("parent", f.options))).toEqual(before);
});

test("context is not delivered after a lost lock race when the pin changed meanwhile", async () => {
  const f = await fixture();
  const lock = f.hold("parent");
  // Another writer migrates the pin after this context resolved it.
  const migrated = { ...f.profile, profileRevision: "r2", selections: f.profile.selections.map(selection => ({ ...selection, profileRevision: "r2" })) };
  const onResolved = () => writeSelectionJson(sessionReceiptPath("parent", f.options), { schemaVersion: 1, verifiedAt: new Date().toISOString(), profile: migrated, sessionId: "parent", generation: 2, loaded: [] });
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the beta skill" }, { ...f.options, onResolved })).rejects.toMatchObject({ code: "SESSION_WRITE_BUSY" });
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes);
});

test("a load whose record is stuck behind a lock refuses when the pin moved during the wait, and otherwise returns its content", async () => {
  const f = await fixture();
  const bundleOptions = { ...f.options, sessionId: "parent" };
  // Still the same pin: the lock outlasts the wait, and the content comes back unrecorded.
  const held = f.hold("parent");
  const kept = await loadSelectedSkill("alpha-skill@1.0.0", "fleet", bundleOptions);
  expect(kept.content).toContain("Fixture body.");
  expect(kept.sessionRecorded).toBe(false);
  rmSync(held.path);
  // Another writer moves the pin while this load waits on its lock.
  const migrated = { ...f.profile, profileRevision: "r2", selections: f.profile.selections.map(selection => ({ ...selection, profileRevision: "r2" })) };
  const staged = `${sessionReceiptPath("parent", f.options)}.staged`;
  writeSelectionJson(staged, { schemaVersion: 1, verifiedAt: new Date().toISOString(), profile: migrated, sessionId: "parent", generation: 2, loaded: [] });
  f.hold("parent");
  releasers.push(Bun.spawn([process.execPath, "--no-install", "-e", `await Bun.sleep(300); require("node:fs").renameSync(${JSON.stringify(staged)}, ${JSON.stringify(sessionReceiptPath("parent", f.options))});`], { stdout: "ignore", stderr: "ignore" }));
  await expect(loadSelectedSkill("alpha-skill@1.0.0", "fleet", bundleOptions)).rejects.toMatchObject({ code: "SESSION_CONTEXT_CONFLICT" });
});

/** A parent receipt write with the same pin: a recorded load, or a renewal moving verifiedAt. */
function touchParent(f: Awaited<ReturnType<typeof fixture>>, change: (receipt: SkillSessionReceipt) => SkillSessionReceipt) {
  const current = readSkillSessionSnapshot("parent", f.options);
  writeSelectionJson(sessionReceiptPath("parent", f.options), { ...change(current.receipt), generation: current.generation + 1 });
}

test("a new child whose parent recorded a load while it resolved is resolved once more from the current parent pin", async () => {
  const f = await fixture();
  let resolves = 0;
  const onResolved = () => { if (resolves++ === 0) touchParent(f, receipt => ({ ...receipt, loaded: [...receipt.loaded, selectionKey(f.profile.selections[1]!)] })); };
  const child = await buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "child" }, { ...f.options, onResolved });
  expect(resolves).toBe(2);
  // The child inherits from, and is bound to, the parent receipt as it is now.
  const parent = readSkillSessionSnapshot("parent", f.options);
  expect(child.selections.map(selection => [selection.slug, selection.reason])).toEqual([["beta-skill", "subagent-inherit"]]);
  expect(readSkillSessionSnapshot("parent:child", f.options).receipt.parent).toMatchObject({ sessionId: "parent", generation: parent.generation, receiptSha256: parent.sha256 });
});

test("a new child whose parent renewal committed while it resolved is resolved once more", async () => {
  const f = await fixture();
  let resolves = 0;
  const renewedAt = new Date(Date.now() - 1_000).toISOString();
  const onResolved = () => { if (resolves++ === 0) touchParent(f, receipt => ({ ...receipt, verifiedAt: renewedAt })); };
  await buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "child" }, { ...f.options, onResolved });
  expect(resolves).toBe(2);
  expect(readSkillSessionSnapshot("parent:child", f.options).receipt.verifiedAt).toBe(renewedAt);
});

test("a child is resolved again only once, never past its deadline, and never past a parent whose pin itself changed", async () => {
  // A parent that changes on every attempt keeps the refusal after one retry.
  const f = await fixture();
  let resolves = 0;
  const always = () => { resolves++; touchParent(f, receipt => ({ ...receipt, verifiedAt: new Date(Date.now() - resolves * 1_000).toISOString() })); };
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "child" }, { ...f.options, onResolved: always })).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(resolves).toBe(2);
  expect(readSkillSessionSnapshotIfExists("parent:child", f.options)).toBeNull();
  // No time left: no retry.
  let late = 0;
  const once = () => { if (late++ === 0) touchParent(f, receipt => ({ ...receipt, verifiedAt: new Date(Date.now() - 60_000).toISOString() })); };
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "late" }, { ...f.options, onResolved: once, resolveAgainBefore: performance.now() - 1 })).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(late).toBe(1);
  // A migrated parent pin is not resolved again here.
  let migrated = 0;
  const migrate = () => { if (migrated++ === 0) touchParent(f, receipt => ({ ...receipt, profile: { ...receipt.profile, profileRevision: "r2", selections: receipt.profile.selections.map(selection => ({ ...selection, profileRevision: "r2" })) } })); };
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "moved" }, { ...f.options, onResolved: migrate })).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(migrated).toBe(1);
  expect(readSkillSessionSnapshotIfExists("parent:moved", f.options)).toBeNull();
});

test("writers waiting for a lock that other processes keep publishing and releasing never refuse it as damaged", async () => {
  const f = await fixture();
  // Another process takes and releases the parent's real write lock in a
  // tight loop, so this process keeps meeting it mid-publication (a second
  // link) and mid-release (a change between two looks).
  const module = join(import.meta.dir, "selection-cache.ts");
  const stop = join(f.cacheDir, "stop-churn");
  const churn = `const { withSkillSessionWriteLock } = await import(${JSON.stringify(module)});
const { existsSync } = await import("node:fs");
let rounds = 0;
while (!existsSync(${JSON.stringify(stop)}) && rounds < 200000) { rounds++; try { withSkillSessionWriteLock("parent", { cacheDir: ${JSON.stringify(f.cacheDir)} }, () => {}); } catch {} }`;
  for (let index = 0; index < 3; index++) releasers.push(Bun.spawn([process.execPath, "--no-install", "-e", churn], { cwd: f.cacheDir, stdout: "ignore", stderr: "ignore" }));
  await Bun.sleep(300);
  const codes: Record<string, number> = {};
  try {
    for (let index = 0; index < 80; index++) {
      const child: SkillSessionReceipt = { ...readSkillSessionSnapshot("parent", f.options).receipt, sessionId: `parent:churn-${index}`, loaded: [] };
      delete child.parent; delete child.generation;
      let code = "OK";
      try { writeSkillSession(child, { current: null, parent: { sessionId: "parent", ...bindingOf(f) } }, f.options); }
      catch (error) { code = (error as { code?: string }).code ?? "ERROR"; }
      codes[code] = (codes[code] ?? 0) + 1;
    }
  } finally { writeFileSync(stop, ""); }
  console.log(`[lock-churn] 80 child creations under lock churn: ${JSON.stringify(codes)}`);
  expect(codes.SESSION_WRITE_LOCKED ?? 0).toBe(0);
  expect(codes.OK ?? 0).toBeGreaterThan(0);
});

function bindingOf(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = readSkillSessionSnapshot("parent", f.options);
  return { generation: snapshot.generation, receiptSha256: snapshot.sha256 };
}

test("a writer still refuses a damaged lock promptly, without waiting it out as busy, and never replaces it", async () => {
  const f = await fixture();
  const path = `${sessionReceiptPath("parent", f.options)}.write-lock`;
  writeFileSync(path, "damaged", { mode: 0o600 });
  const started = performance.now();
  await expect(buildSkillContext({ profileId: "fleet", sessionId: "parent", agentId: "child" }, f.options)).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  expect(performance.now() - started).toBeLessThan(SESSION_WRITE_LOCK_WAIT_MS / 2);
  expect(readFileSync(path, "utf8")).toBe("damaged");
  expect(readSkillSessionSnapshotIfExists("parent:child", f.options)).toBeNull();
});
