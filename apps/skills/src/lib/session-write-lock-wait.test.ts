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
import { activateSelectionProfile, cacheSelectionBundle, readSkillSessionSnapshot, readSkillSessionSnapshotIfExists, selectionKey, SESSION_WRITE_LOCK_WAIT_MS, sessionReceiptPath, writeSelectionJson } from "./selection-cache.js";
import { buildSkillContext } from "./skill-context.js";
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

test("context read from an unchanged pin is delivered when only its bookkeeping write lost the lock race", async () => {
  const f = await fixture();
  const lock = f.hold("parent");
  const before = readFileSync(sessionReceiptPath("parent", f.options));
  const result = await buildSkillContext({ profileId: "fleet", sessionId: "parent", prompt: "use the beta skill" }, f.options);
  expect(result.selections.map(selection => selection.slug)).toEqual(["beta-skill"]);
  expect(result.context).toContain("Fixture body.");
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
