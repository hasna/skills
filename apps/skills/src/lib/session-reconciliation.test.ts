import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { inspectSessionWriteLock, readSkillSession, readSkillSessionSnapshot, recoverSessionWriteLock, selectionKey, sessionReceiptPath, skillSessionSnapshotBinding, writeSelectionJson, writeSkillSession, type SkillSessionReceipt } from "./selection-cache.js";
import { buildSkillContext } from "./skill-context.js";
import { packSkillBundle } from "./skill-bundle.js";
import { reconcileSkillSession, reconcileSkillSessionIfSafe, inspectSkillSession } from "./session-reconciliation.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(loaded = true) {
  const cacheDir = mkdtempSync(join(tmpdir(), "skills-session-reconcile-")); roots.push(cacheDir);
  const profile: ResolvedSkillProfile = {
    authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileId: "legacy", profileRevision: "old-revision",
    selections: [{ authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileRevision: "old-revision", slug: "example", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }],
  };
  const old: SkillSessionReceipt = { schemaVersion: 1, verifiedAt: "2026-01-01T00:00:00Z", profile, sessionId: "root", loaded: loaded ? [selectionKey(profile.selections[0]!)] : [] };
  writeSelectionJson(sessionReceiptPath("root", { cacheDir }), old);
  const target = { ...profile, profileId: "shared", profileRevision: "new-revision", selections: profile.selections.map(selection => ({ ...selection, profileRevision: "new-revision" })) };
  const client: ProfileClient = { authority: profile.authority, resolveProfile: async () => target, getBundle: async () => { throw new Error("This metadata operation must not fetch bundles"); }, recordStation: async () => { throw new Error("This local operation must not report station state"); } };
  const before = readFileSync(sessionReceiptPath("root", { cacheDir }));
  const input = { sessionId: "root", fromProfile: "legacy", fromRevision: "old-revision", receiptSha256: createHash("sha256").update(before).digest("hex"), selectionProfile: "shared", profileRevision: "new-revision" };
  return { cacheDir, old, target, client, before, input };
}

function approval(planned: Awaited<ReturnType<typeof reconcileSkillSession>>) {
  return { planDigest: planned.planDigest, planIssuedAt: planned.plan.issuedAt, planExpiresAt: planned.plan.expiresAt };
}

test("safe hook reconciliation archives an expired pin and preserves loaded skills across unrelated profile changes", async () => {
  const f = fixture();
  const unselected = { ...f.old.profile.selections[0]!, slug: "unloaded" };
  const oldProfile = { ...f.old.profile, selections: [...f.old.profile.selections, unselected] };
  const old = { ...f.old, profile: oldProfile };
  writeSelectionJson(sessionReceiptPath("root", f), old);
  const before = readFileSync(sessionReceiptPath("root", f));
  const target = { ...oldProfile, profileRevision: "new-revision", selections: [
    { ...oldProfile.selections[0]!, profileRevision: "new-revision" },
    { ...unselected, profileRevision: "new-revision" },
    { ...unselected, slug: "new-skill", profileRevision: "new-revision" },
  ] };
  const client = { ...f.client, resolveProfile: async () => target };
  expect(await reconcileSkillSessionIfSafe("root", "legacy", { cacheDir: f.cacheDir, client })).toBe(true);
  const current = readSkillSessionSnapshot("root", f);
  expect(current.receipt.profile).toEqual(target);
  expect(current.receipt.loaded).toEqual(old.loaded);
  expect(current.generation).toBe(1);
  const archived = join(f.cacheDir, "session-reconciliations", readdirSync(join(f.cacheDir, "session-reconciliations"))[0]!, "original.json");
  expect(readFileSync(archived)).toEqual(before);
});

test("safe hook reconciliation refuses changed loaded skills, changed identity and ambiguous concurrent writes", async () => {
  for (const change of ["removed", "trigger", "workspace", "profile", "concurrent"] as const) {
    const f = fixture();
    const target = { ...f.old.profile, profileRevision: "new-revision", selections: f.old.profile.selections.map(selection => ({ ...selection, profileRevision: "new-revision" })) };
    if (change === "removed") target.selections = [];
    if (change === "trigger") target.selections[0] = { ...target.selections[0]!, triggers: { always: true } };
    if (change === "workspace") {
      target.workspaceId = "other-workspace";
      target.selections[0] = { ...target.selections[0]!, workspaceId: "other-workspace" };
    }
    if (change === "profile") target.profileId = "other-profile";
    const client = { ...f.client, resolveProfile: async () => {
      if (change === "concurrent") {
        const current = readSkillSessionSnapshot("root", f);
        writeSkillSession(current.receipt, { current: skillSessionSnapshotBinding(current) }, f);
      }
      return target;
    } };
    const before = readFileSync(sessionReceiptPath("root", f));
    await expect(reconcileSkillSessionIfSafe("root", "legacy", { cacheDir: f.cacheDir, client }))
      .rejects.toMatchObject({ code: change === "concurrent" ? "SESSION_RECEIPT_CHANGED"
        : change === "workspace" || change === "profile" ? "PROFILE_IDENTITY_MISMATCH" : "SESSION_RECONCILIATION_REQUIRED" });
    if (change !== "concurrent") expect(readFileSync(sessionReceiptPath("root", f))).toEqual(before);
    expect(existsSync(join(f.cacheDir, "session-reconciliations"))).toBe(false);
  }
});

test("an intentional root migration archives exact bytes and permits new children without relaxing old pin checks", async () => {
  const f = fixture(false);
  await expect(buildSkillContext({ profileId: "shared", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: f.client })).rejects.toMatchObject({ code: "PROFILE_LOCK_MISMATCH" });
  const planned = await reconcileSkillSession(f.input, { cacheDir: f.cacheDir, client: f.client });
  expect(planned.applied).toBe(false);
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const result = await reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { cacheDir: f.cacheDir, client: f.client });
  expect(result.applied).toBe(true);
  expect(readFileSync(result.archivePath!)).toEqual(f.before);
  expect(lstatSync(result.archivePath!).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(result.receiptPath!, "utf8")).status).toBe("applied");
  expect(readSkillSession("root", f)?.loaded).toEqual(f.old.loaded);
  expect(inspectSkillSession("root", f).profileId).toBe("shared");
  expect((await buildSkillContext({ profileId: "shared", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: f.client })).receipt.profileRevision).toBe("new-revision");
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root" }, { cacheDir: f.cacheDir, client: f.client })).rejects.toMatchObject({ code: "PROFILE_LOCK_MISMATCH" });
});


test("a child resolution cannot commit an old parent pin after parent reconciliation", async () => {
  const f = fixture(false);
  const source = mkdtempSync(join(tmpdir(), "skills-session-race-bundle-")); roots.push(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: example\ndescription: Deterministic race fixture\nkind: instruction\n---\n\nReview carefully.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "example", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const oldProfile = { ...f.old.profile, selections: f.old.profile.selections.map(selection => ({ ...selection, bundleDigest: `sha256:${bundle.sha256}` })) };
  const old = { ...f.old, profile: oldProfile, loaded: [selectionKey(oldProfile.selections[0]!)] };
  writeSelectionJson(sessionReceiptPath("root", f), old);
  const before = readFileSync(sessionReceiptPath("root", f));
  const input = { ...f.input, receiptSha256: createHash("sha256").update(before).digest("hex") };
  const target = { ...f.target, selections: f.target.selections.map(selection => ({ ...selection, bundleDigest: `sha256:${bundle.sha256}` })) };
  const reconcileClient = { ...f.client, resolveProfile: async () => target };
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const childClient: ProfileClient = {
    ...f.client,
    resolveProfile: async () => oldProfile,
    getBundle: async () => { entered(); await blocked; return new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": "1.0.0" } }); },
  };
  const child = buildSkillContext({ profileId: "legacy", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: childClient });
  await started;
  const plan = await reconcileSkillSession(input, { cacheDir: f.cacheDir, client: reconcileClient });
  await reconcileSkillSession({ ...input, apply: true, ...approval(plan) }, { cacheDir: f.cacheDir, client: reconcileClient });
  release();
  await expect(child).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(readSkillSession("root:child", f)).toBeNull();
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
});

test("child commit refuses an ABA parent profile when the receipt generation advanced", async () => {
  const f = fixture(false);
  const originalSnapshot = readSkillSessionSnapshot("root", f);
  const forward = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(forward) }, f);
  const current = readSkillSessionSnapshot("root", f);
  const backInput = {
    sessionId: "root", fromProfile: "shared", fromRevision: "new-revision", receiptSha256: current.sha256,
    selectionProfile: "legacy", profileRevision: "old-revision",
  };
  const backClient = { ...f.client, resolveProfile: async () => f.old.profile };
  const back = await reconcileSkillSession(backInput, { ...f, client: backClient });
  await reconcileSkillSession({ ...backInput, apply: true, ...approval(back) }, { ...f, client: backClient });
  const restored = readSkillSessionSnapshot("root", f);
  expect(restored.receipt.profile).toEqual(f.old.profile);
  expect(restored.generation).toBe(2);
  const child: SkillSessionReceipt = { ...f.old, sessionId: "root:aba-child", loaded: [] };
  expect(() => writeSkillSession(child, { current: null, parent: skillSessionSnapshotBinding(originalSnapshot) }, f))
    .toThrow(expect.objectContaining({ code: "SESSION_PARENT_CHANGED" }));
  expect(readSkillSession("root:aba-child", f)).toBeNull();
});

test("child creation requires an exact existing parent and never falls through to an API pin", async () => {
  const f = fixture(false);
  rmSync(sessionReceiptPath("root", f));
  let resolved = false;
  const client = { ...f.client, resolveProfile: async () => { resolved = true; return f.old.profile; } };
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root", agentId: "missing-parent" }, { cacheDir: f.cacheDir, client }))
    .rejects.toMatchObject({ code: "SESSION_PARENT_NOT_FOUND" });
  expect(resolved).toBe(false);
  expect(readSkillSession("root:missing-parent", f)).toBeNull();
});

test("deterministic parent-child lock ordering releases earlier locks when a later lock is busy", () => {
  const f = fixture(false), parent = readSkillSessionSnapshot("root", f);
  const childId = "root:lock-order", child: SkillSessionReceipt = { ...f.old, sessionId: childId, loaded: [] };
  const locks = [sessionReceiptPath("root", f), sessionReceiptPath(childId, f)].map(path => `${path}.write-lock`).sort();
  writeFileSync(locks[1]!, "busy-later-lock", { mode: 0o600 });
  expect(() => writeSkillSession(child, { current: null, parent: skillSessionSnapshotBinding(parent) }, f))
    .toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
  expect(existsSync(locks[0]!)).toBe(false);
  expect(readFileSync(locks[1]!, "utf8")).toBe("busy-later-lock");
  expect(readSkillSession(childId, f)).toBeNull();
});

test("a busy session lock refuses both reconciliation and ordinary context writes", async () => {
  const f = fixture(false);
  const plan = await reconcileSkillSession(f.input, f);
  const lock = `${sessionReceiptPath("root", f)}.write-lock`;
  writeFileSync(lock, "existing writer", { mode: 0o600 });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root" }, { ...f, client: { ...f.client, resolveProfile: async () => f.old.profile } })).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  expect(readFileSync(lock, "utf8")).toBe("existing writer");
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

function staleLock(cacheDir: string, marker: Record<string, unknown>) {
  const path = `${sessionReceiptPath("root", { cacheDir })}.write-lock`;
  const bytes = Buffer.from(`${JSON.stringify(marker)}\n`);
  writeFileSync(path, bytes, { mode: 0o600 });
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
  return { path, bytes };
}

// The Darwin ps executable cannot run inside a write-confined macOS sandbox.
// Model only the exact synthetic absent PID; every other subprocess stays real.
function absentWriterProbe(pid: number) {
  const spawn = childProcess.spawnSync;
  return spyOn(childProcess, "spawnSync").mockImplementation(((command, args, options) => {
    if (process.platform === "darwin" && command === "/bin/ps" && JSON.stringify(args) === JSON.stringify(["-p", String(pid), "-o", "lstart="])) {
      return { pid: 0, status: 1, signal: null, output: [null, "", ""], stdout: "", stderr: "" };
    }
    return spawn(command, args, options);
  }) as typeof childProcess.spawnSync);
}

test("reviewed legacy recovery archives only a dead local writer lock and preserves receipt bytes", () => {
  const f = fixture(false);
  const lock = staleLock(f.cacheDir, { schemaVersion: 1, operationId: randomUUID(), sessionId: "root", pid: 99_999_999 });
  const review = inspectSessionWriteLock("root", f);
  expect(review.schemaVersion).toBe(1);
  expect(review.hostBound).toBe(false);
  const probe = absentWriterProbe(99_999_999);
  let archive: string;
  try { archive = recoverSessionWriteLock("root", review.reviewDigest, f); }
  finally { probe.mockRestore(); }
  expect(existsSync(lock.path)).toBe(false);
  expect(readFileSync(archive, "utf8")).toBe(lock.bytes.toString("utf8"));
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  expect(JSON.parse(readFileSync(join(archive, "..", "recovery.json"), "utf8"))).toMatchObject({
    lockSha256: review.lockSha256, receiptSha256: review.receiptSha256, status: "prepared",
  });
  const current = readSkillSessionSnapshot("root", f);
  writeSkillSession(f.old, { current: skillSessionSnapshotBinding(current) }, f);
  expect(readSkillSessionSnapshot("root", f).generation).toBe(1);
});

test("session lock becomes visible only with complete ownership and retains its descriptor through release", () => {
  const f = fixture(false), path = `${sessionReceiptPath("root", f)}.write-lock`;
  const open = fs.openSync, link = fs.linkSync, unlink = fs.unlinkSync, close = fs.closeSync;
  const visible: number[] = [], descriptors = new Set<number>();
  let releasedWithDescriptor = false;
  const a = spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
    const fd = open(...args); descriptors.add(fd);
    if (args[0] === path && existsSync(path)) visible.push(readFileSync(path).length);
    return fd;
  }) as typeof fs.openSync);
  const b = spyOn(fs, "linkSync").mockImplementation((source, destination) => {
    link(source, destination);
    if (destination === path) {
      visible.push(readFileSync(path).length);
      expect(inspectSessionWriteLock("root", f).pid).toBe(process.pid);
      // A contender sees a complete live owner and cannot overwrite it.
      expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(readSkillSessionSnapshot("root", f)) }, f))
        .toThrow(expect.objectContaining({ code: "SESSION_WRITE_BUSY" }));
    }
  });
  const c = spyOn(fs, "closeSync").mockImplementation(fd => { descriptors.delete(fd); close(fd); });
  const d = spyOn(fs, "unlinkSync").mockImplementation(target => {
    if (target === path) {
      const ino = lstatSync(path).ino;
      releasedWithDescriptor = [...descriptors].some(fd => { try { return fs.fstatSync(fd).ino === ino; } catch { return false; } });
    }
    unlink(target);
  });
  const rename = fs.renameSync;
  const e = spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (destination === sessionReceiptPath("root", f)) {
      // 0.10.31's ordinary lock reader requires one link. The new staging
      // witness must be retired before entering the protected write action.
      expect(lstatSync(path).nlink).toBe(1);
    }
    rename(source, destination);
  });
  try {
    writeSkillSession(f.old, { current: skillSessionSnapshotBinding(readSkillSessionSnapshot("root", f)) }, f);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every(bytes => bytes > 0)).toBe(true);
    expect(releasedWithDescriptor).toBe(true);
    expect(existsSync(path)).toBe(false);
  } finally { a.mockRestore(); b.mockRestore(); c.mockRestore(); d.mockRestore(); e.mockRestore(); }
});

test("failed marker write or durability never publishes a lock or leaves its staging inode", () => {
  for (const failure of ["partial-write", "fsync"]) {
    const f = fixture(false), path = `${sessionReceiptPath("root", f)}.write-lock`;
    const before = readdirSync(join(path, "..")), write = fs.writeFileSync;
    const hook = failure === "fsync"
      ? spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("synthetic marker failure"); })
      : spyOn(fs, "writeFileSync").mockImplementation(((file, data, options) => {
        if (typeof file === "number") { write(file, "{"); throw new Error("synthetic marker failure"); }
        write(file, data, options);
      }) as typeof fs.writeFileSync);
    try {
      expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(readSkillSessionSnapshot("root", f)) }, f))
        .toThrow("synthetic marker failure");
      expect(existsSync(path)).toBe(false);
      expect(readdirSync(join(path, ".."))).toEqual(before);
      expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
    } finally { hook.mockRestore(); }
  }
});

test("empty and nonempty malformed locks remain protected without rewriting ownership", () => {
  for (const text of ["", "{", "null", "[]"]) {
    const f = fixture(false), path = `${sessionReceiptPath("root", f)}.write-lock`;
    writeFileSync(path, text, { mode: 0o600 });
    const original = lstatSync(path), names = readdirSync(join(path, ".."));
    expect(() => inspectSessionWriteLock("root", f)).toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
    expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(readSkillSessionSnapshot("root", f)) }, f))
      .toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(lstatSync(path).ino).toBe(original.ino);
    expect(readdirSync(join(path, ".."))).toEqual(names);
    expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  }
});

test("interrupted publication accepts only the exact private staging inode and archives both links", () => {
  const f = fixture(false), operationId = randomUUID();
  const marker = { schemaVersion: 1, operationId, sessionId: "root", pid: 99_999_999, publication: "hard-link-v1" };
  const lock = staleLock(f.cacheDir, marker), prepared = `${lock.path}.${operationId}.prepared`;
  const unrelated = join(f.cacheDir, "unrelated-link");
  fs.linkSync(lock.path, unrelated);
  expect(() => inspectSessionWriteLock("root", f)).toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
  fs.renameSync(unrelated, prepared);
  const review = inspectSessionWriteLock("root", f);
  expect(review.pid).toBe(marker.pid);
  fs.linkSync(lock.path, unrelated);
  expect(() => inspectSessionWriteLock("root", f)).toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
  rmSync(unrelated);
  const ownerProbe = absentWriterProbe(marker.pid);
  let archive: string;
  try { archive = recoverSessionWriteLock("root", review.reviewDigest, f); }
  finally { ownerProbe.mockRestore(); }
  expect(readFileSync(archive)).toEqual(lock.bytes);
  expect(readFileSync(join(archive, "..", "publication.write-lock"))).toEqual(lock.bytes);
  expect(existsSync(lock.path)).toBe(false); expect(existsSync(prepared)).toBe(false);
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

for (const change of ["different-bytes", "same-bytes-new-inode", "missing", "extra-link"] as const) {
  test(`reviewed recovery rejects changed publication witnesses: ${change}`, () => {
    const f = fixture(false), operationId = randomUUID();
    const marker = { schemaVersion: 1, operationId, sessionId: "root", pid: 99_999_999, publication: "hard-link-v1" };
    const lock = staleLock(f.cacheDir, marker), prepared = `${lock.path}.${operationId}.prepared`;
    fs.linkSync(lock.path, prepared);
    const review = inspectSessionWriteLock("root", f);
    const replacement = join(f.cacheDir, "replacement-witness"), preserved = join(f.cacheDir, "preserved-witness");
    const replacementBytes = change === "same-bytes-new-inode" ? lock.bytes : Buffer.from("unrelated synthetic witness\n");
    if (change === "different-bytes" || change === "same-bytes-new-inode") writeFileSync(replacement, replacementBytes, { mode: 0o600 });
    if (change === "same-bytes-new-inode") {
      const original = lstatSync(lock.path);
      utimesSync(replacement, original.atime, original.mtime);
    }
    const rename = fs.renameSync;
    let archive: string | undefined;
    const hook = spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if (source !== lock.path) return;
      archive = String(destination);
      if (change === "missing") rename(prepared, preserved);
      else if (change === "extra-link") fs.linkSync(prepared, preserved);
      else if (change === "same-bytes-new-inode") {
        // Both inodes retain two links and identical bytes: only exact inode
        // continuity distinguishes the replacement from the reviewed owner.
        rename(prepared, preserved);
        rename(replacement, prepared);
        fs.linkSync(prepared, replacement);
        const original = lstatSync(String(destination)), substituted = lstatSync(prepared);
        for (const field of ["dev", "size", "mtimeMs", "mode", "uid", "gid", "nlink"] as const) {
          expect(substituted[field]).toBe(original[field]);
        }
        expect(readFileSync(prepared)).toEqual(lock.bytes);
        expect(substituted.ino).not.toBe(original.ino);
      }
      else rename(replacement, prepared);
    });
    const ownerProbe = absentWriterProbe(marker.pid);
    try {
      expect(() => recoverSessionWriteLock("root", review.reviewDigest, f))
        .toThrow(expect.objectContaining({ code: "SESSION_LOCK_RECOVERY_INCOMPLETE" }));
    } finally { hook.mockRestore(); ownerProbe.mockRestore(); }
    expect(archive).toBeDefined();
    expect(readFileSync(archive!)).toEqual(lock.bytes);
    const companion = join(archive!, "..", "publication.write-lock");
    if (change === "missing") expect(readFileSync(preserved)).toEqual(lock.bytes);
    else expect(readFileSync(companion)).toEqual(change === "extra-link" ? lock.bytes : replacementBytes);
    expect(JSON.parse(readFileSync(join(archive!, "..", "recovery.json"), "utf8")).status).toBe("prepared");
    expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
    expect(readSkillSessionSnapshot("root", f).generation).toBe(0);
  });
}

test("publication failure after linking releases only its initialized inode", () => {
  const f = fixture(false), path = `${sessionReceiptPath("root", f)}.write-lock`;
  const sync = fs.fsyncSync;
  let linked = false;
  const hook = spyOn(fs, "fsyncSync").mockImplementation(fd => {
    if (existsSync(path)) { linked = true; expect(JSON.parse(readFileSync(path, "utf8")).sessionId).toBe("root"); throw new Error("synthetic publication sync failure"); }
    sync(fd);
  });
  try {
    expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(readSkillSessionSnapshot("root", f)) }, f)).toThrow("synthetic publication sync failure");
    expect(linked).toBe(true); expect(existsSync(path)).toBe(false);
    expect(readdirSync(join(path, "..")).filter(name => name.includes("write-lock"))).toEqual([]);
    expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  } finally { hook.mockRestore(); }
});

test("legacy lock recovery refuses a live PID and a changed reviewed receipt", () => {
  const f = fixture(false);
  const lock = staleLock(f.cacheDir, { schemaVersion: 1, operationId: randomUUID(), sessionId: "root", pid: process.pid });
  const review = inspectSessionWriteLock("root", f);
  expect(() => recoverSessionWriteLock("root", review.reviewDigest, f)).toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes.toString("utf8"));
  const old = new Date(Date.now() - 60_000);
  writeFileSync(lock.path, `${JSON.stringify({ schemaVersion: 1, operationId: randomUUID(), sessionId: "root", pid: 99_999_999 })}\n`);
  utimesSync(lock.path, old, old);
  expect(() => recoverSessionWriteLock("root", review.reviewDigest, f)).toThrow(expect.objectContaining({ code: "SESSION_LOCK_REVIEW_CHANGED" }));
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

if (process.platform === "linux") test("future host-bound dead locks recover automatically, while live or foreign-boot locks stay closed", () => {
  const f = fixture(false);
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const marker = { schemaVersion: 2, operationId: randomUUID(), sessionId: "root", pid: 99_999_999,
    host: hostname(), bootId, pidNamespace: readlinkSync("/proc/self/ns/pid"), processStart: "linux:1" };
  const lock = staleLock(f.cacheDir, marker);
  const current = readSkillSessionSnapshot("root", f);
  writeSkillSession(f.old, { current: skillSessionSnapshotBinding(current) }, f);
  const archiveDir = join(f.cacheDir, "session-lock-recoveries", readdirSync(join(f.cacheDir, "session-lock-recoveries"))[0]!);
  expect(readFileSync(join(archiveDir, "original.write-lock"), "utf8")).toBe(lock.bytes.toString("utf8"));
  expect(readSkillSessionSnapshot("root", f).generation).toBe(1);

  const currentAgain = readSkillSessionSnapshot("root", f);
  const selfStat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const selfStart = selfStat.slice(selfStat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  for (const owner of [{ ...marker, pid: process.pid, processStart: `linux:${selfStart}` },
    { ...marker, bootId: randomUUID() }, { ...marker, pidNamespace: "pid:[1]" }]) {
    const blocked = staleLock(f.cacheDir, owner);
    expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(currentAgain) }, f))
      .toThrow(expect.objectContaining({ code: "SESSION_WRITE_BUSY" }));
    expect(readFileSync(blocked.path, "utf8")).toBe(blocked.bytes.toString("utf8"));
    rmSync(blocked.path);
  }
  expect(readSkillSessionSnapshot("root", f).generation).toBe(1);
});

if (process.platform === "linux") test("a dead lock left before the first receipt is also recoverable", () => {
  const f = fixture(false);
  rmSync(sessionReceiptPath("root", f));
  const lock = staleLock(f.cacheDir, { schemaVersion: 2, operationId: randomUUID(), sessionId: "root", pid: 99_999_999,
    host: hostname(), bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    pidNamespace: readlinkSync("/proc/self/ns/pid"), processStart: "linux:1" });
  writeSkillSession(f.old, { current: null }, f);
  expect(readSkillSessionSnapshot("root", f).generation).toBe(1);
  const directory = join(f.cacheDir, "session-lock-recoveries", readdirSync(join(f.cacheDir, "session-lock-recoveries"))[0]!);
  expect(readFileSync(join(directory, "original.write-lock"), "utf8")).toBe(lock.bytes.toString("utf8"));
  expect(JSON.parse(readFileSync(join(directory, "recovery.json"), "utf8")).receiptSha256).toBeNull();
});

if (process.platform === "linux") test("a competing recovery guard keeps a stale lock and receipt untouched", () => {
  const f = fixture(false);
  const lock = staleLock(f.cacheDir, { schemaVersion: 2, operationId: randomUUID(), sessionId: "root", pid: 99_999_999,
    host: hostname(), bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    pidNamespace: readlinkSync("/proc/self/ns/pid"), processStart: "linux:1" });
  writeFileSync(`${lock.path}.recovery-guard`, "other recovery", { mode: 0o600 });
  const current = readSkillSessionSnapshot("root", f);
  expect(() => writeSkillSession(f.old, { current: skillSessionSnapshotBinding(current) }, f))
    .toThrow(expect.objectContaining({ code: "SESSION_WRITE_BUSY" }));
  expect(readFileSync(lock.path, "utf8")).toBe(lock.bytes.toString("utf8"));
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("session symlinks are refused without changing their targets", async () => {
  const f = fixture();
  const path = sessionReceiptPath("root", f), target = join(f.cacheDir, "untouched.json");
  writeFileSync(target, f.before); rmSync(path); symlinkSync(target, path);
  await expect(reconcileSkillSession(f.input, f)).rejects.toMatchObject({ code: "UNSAFE_CACHE_PATH" });
  expect(readFileSync(target)).toEqual(f.before);
});

test("a changed target with the same revision invalidates the reviewed plan", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, f);
  f.target.selections[0]!.bundleDigest = `sha256:${"b".repeat(64)}`;
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("a final receipt failure preserves both sides and reports the committed outcome as incomplete", async () => {
  const f = fixture(false), plan = await reconcileSkillSession(f.input, f);
  const rename = fs.renameSync;
  const fault = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("/receipt.json")) throw new Error("Synthetic final journal write failure");
    return rename(from, to);
  });
  try {
    await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_INCOMPLETE" });
  } finally { fault.mockRestore(); }
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
  const directory = join(f.cacheDir, "session-reconciliations");
  const archive = join(directory, readdirSync(directory)[0]!);
  expect(readFileSync(join(archive, "original.json"))).toEqual(f.before);
  expect(readFileSync(join(archive, "replacement.json"))).toEqual(readFileSync(sessionReceiptPath("root", f)));
  expect(JSON.parse(readFileSync(join(archive, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("only identical loaded selections survive the explicit migration", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f);
  expect(readSkillSession("root", f)?.loaded).toEqual(f.old.loaded);
  const changed = fixture();
  changed.target.selections[0]!.bundleDigest = `sha256:${"b".repeat(64)}`;
  const changedPlan = await reconcileSkillSession(changed.input, changed);
  await reconcileSkillSession({ ...changed.input, apply: true, ...approval(changedPlan) }, changed);
  expect(readSkillSession("root", changed)?.loaded).toEqual([]);
});

test("failure to persist the archive parent refuses replacement and retains the old session", async () => {
  const f = fixture(false), plan = await reconcileSkillSession(f.input, f);
  const root = lstatSync(f.cacheDir), sync = fs.fsyncSync;
  const fault = spyOn(fs, "fsyncSync").mockImplementation(fd => {
    const current = fs.fstatSync(fd);
    if (current.dev === root.dev && current.ino === root.ino) throw new Error("Synthetic archive parent sync failure");
    sync(fd);
  });
  try {
    await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toThrow("Synthetic archive parent sync failure");
  } finally { fault.mockRestore(); }
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const directory = join(f.cacheDir, "session-reconciliations");
  const archive = join(directory, readdirSync(directory)[0]!);
  expect(readFileSync(join(archive, "original.json"))).toEqual(f.before);
  expect(JSON.parse(readFileSync(join(archive, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("a context read already in flight cannot overwrite the migrated session", async () => {
  const f = fixture(false);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const oldClient = { ...f.client, resolveProfile: async () => { entered(); await blocked; return f.old.profile; } };
  const context = buildSkillContext({ profileId: "legacy", sessionId: "root" }, { ...f, client: oldClient });
  await started;
  const plan = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f);
  release();
  await expect(context).rejects.toMatchObject({ code: "SESSION_CONTEXT_CONFLICT" });
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
});

test("receipt drift while resolving the API cannot overwrite concurrent changes", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, { cacheDir: f.cacheDir, client: f.client });
  const concurrent = { ...f.old, loaded: [] };
  f.client.resolveProfile = async () => { writeSelectionJson(sessionReceiptPath("root", f), concurrent); return f.target; };
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_RECEIPT_CHANGED" });
  expect(readSkillSession("root", f)).toEqual(concurrent);
});

test.each(["fromProfile", "fromRevision", "receiptSha256", "profileRevision"] as const)("requires the exact reviewed %s", async field => {
  const f = fixture();
  await expect(reconcileSkillSession({ ...f.input, [field]: field === "receiptSha256" ? "b".repeat(64) : "different" }, f)).rejects.toBeInstanceOf(Error);
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("reviewed plans bind a five-minute issuedAt/expiresAt window and expire at the replay boundary", async () => {
  const f = fixture(false), issued = Date.parse("2026-09-18T14:00:00.000Z");
  const planned = await reconcileSkillSession(f.input, { ...f, now: () => issued });
  expect(planned.plan.issuedAt).toBe("2026-09-18T14:00:00.000Z");
  expect(planned.plan.expiresAt).toBe("2026-09-18T14:05:00.000Z");
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { ...f, now: () => issued + 5 * 60 * 1000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_EXPIRED" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned), planExpiresAt: "2026-09-18T14:06:00.000Z" }, { ...f, now: () => issued + 1000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_WINDOW_INVALID" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned),
    planIssuedAt: "2026-09-18T14:00:01.000Z", planExpiresAt: "2026-09-18T14:05:01.000Z" }, { ...f, now: () => issued + 2000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("a plan expiring during durable preparation is refused immediately before the receipt commit", async () => {
  const f = fixture(false), issued = Date.parse("2026-09-18T14:00:00.000Z");
  const planned = await reconcileSkillSession(f.input, { ...f, now: () => issued });
  let reads = 0;
  const now = () => ++reads >= 4 ? issued + 5 * 60 * 1000 : issued + 1000;
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { ...f, now }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_EXPIRED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const operation = join(f.cacheDir, "session-reconciliations", readdirSync(join(f.cacheDir, "session-reconciliations"))[0]!);
  expect(JSON.parse(readFileSync(join(operation, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("apply needs the matching plan and may not cross authority or workspace", async () => {
  const f = fixture();
  await expect(reconcileSkillSession({ ...f.input, apply: true }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_REQUIRED" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(await reconcileSkillSession(f.input, f)), planDigest: "c".repeat(64) }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  f.target.workspaceId = "another-workspace";
  f.target.selections = f.target.selections.map(selection => ({ ...selection, workspaceId: f.target.workspaceId }));
  await expect(reconcileSkillSession(f.input, f)).rejects.toMatchObject({ code: "PROFILE_IDENTITY_MISMATCH" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});
