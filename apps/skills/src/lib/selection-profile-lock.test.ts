/**
 * The cached selection profile's write lock and snapshot precondition
 * (E-00534). Every activation compares the profile with the snapshot its
 * writer read and replaces it under one lock; a stale writer is refused and
 * writes nothing; a held lock is waited for within a bound and never replaced;
 * a dead holder's lock is preserved, not deleted; readers never wait.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  activateSelectionProfile, inspectProfileWriteLock, PROFILE_WRITE_LOCK_WAIT_MS, readSelectionProfile, readSelectionProfileSnapshot, selectionProfilePrecondition,
  type SelectionProfilePrecondition,
} from "./selection-cache.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const AUTHORITY = "https://skills.example.com/api/v1";
const DIGEST = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];
const helpers: Array<ReturnType<typeof Bun.spawn>> = [];
afterEach(async () => {
  for (const child of helpers.splice(0)) await child.exited;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const profile = (revision: string): ResolvedSkillProfile => ({
  authority: AUTHORITY, workspaceId: "org-test", profileId: "fleet", profileRevision: revision,
  selections: [{ authority: AUTHORITY, workspaceId: "org-test", profileRevision: revision, slug: "alpha", version: "1.0.0", bundleDigest: DIGEST }],
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-profile-lock-")); roots.push(root);
  const options = { cacheDir: join(root, "cache") };
  activateSelectionProfile(profile("revision-A"), null, options);
  const file = join(options.cacheDir, "profiles", `${createHash("sha256").update(JSON.stringify("fleet")).digest("hex")}.json`);
  const lockPath = `${file}.write-lock`;
  const snapshotA = selectionProfilePrecondition(readSelectionProfileSnapshot("fleet", options))!;
  /** Another writer's lock: private, structurally valid. */
  const hold = (marker: Record<string, unknown>, ageMs = 0) => {
    const bytes = `${JSON.stringify(marker)}\n`;
    writeFileSync(lockPath, bytes, { mode: 0o600 });
    if (ageMs) { const old = new Date(Date.now() - ageMs); utimesSync(lockPath, old, old); }
    return bytes;
  };
  return { root, options, file, lockPath, snapshotA, bytesA: readFileSync(file), hold };
}
/** The host identity a v2 lock binds, read the way the cache reads it. */
function hostIdentity(): { host: string; bootId: string; pidNamespace?: string; selfStart: string } {
  if (process.platform === "linux") {
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    return { host: hostname(), bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), pidNamespace: readlinkSync("/proc/self/ns/pid"),
      selfStart: `linux:${stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]}` };
  }
  const boot = spawnSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", env: { LC_ALL: "C" } }).stdout;
  const start = spawnSync("/bin/ps", ["-p", String(process.pid), "-o", "lstart="], { encoding: "utf8", env: { LC_ALL: "C" } }).stdout.trim();
  return { host: hostname(), bootId: `darwin:${/\bsec\s*=\s*(\d+)\b/.exec(boot)![1]}`, selfStart: `darwin:${start}` };
}
const hostBound = process.platform === "linux" || process.platform === "darwin";
/** A pid this test saw exit, so its holder is provably gone (darwin ps reports an out-of-range pid as unknown, not absent). */
function exitedPid(): number {
  return Number(spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim());
}

test("a stale writer is refused with SELECTION_PROFILE_CHANGED and writes nothing", () => {
  const f = fixture();
  activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options);
  const bytesB = readFileSync(f.file);
  expect(() => activateSelectionProfile(profile("revision-C"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "SELECTION_PROFILE_CHANGED" }));
  expect(() => activateSelectionProfile(profile("revision-C"), null, f.options)).toThrow(expect.objectContaining({ code: "SELECTION_PROFILE_CHANGED" }));
  expect(readFileSync(f.file)).toEqual(bytesB);
  expect(readdirSync(join(f.options.cacheDir, "profiles"))).toEqual([f.file.split("/").pop()!]);
});

test("the precondition binds the file, not only its bytes: identical bytes at a new inode are refused", () => {
  const f = fixture();
  const copy = `${f.file}.copy`;
  copyFileSync(f.file, copy); renameSync(copy, f.file);
  expect(sha256(readFileSync(f.file))).toBe(f.snapshotA.sha256);
  expect(() => activateSelectionProfile(profile("revision-C"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "SELECTION_PROFILE_CHANGED" }));
  expect(readFileSync(f.file)).toEqual(f.bytesA);
});

test("a profile already holding the same selection is kept when fresh and re-stamped when expired; neither is a refusal", () => {
  const f = fixture();
  // Another writer committed the same selection after this writer read A.
  const same = (verifiedAt: string) => {
    const copy = join(f.root, "same.json");
    writeFileSync(copy, `${JSON.stringify({ schemaVersion: 1, verifiedAt, profile: profile("revision-A") })}\n`, { mode: 0o600 });
    renameSync(copy, f.file);
    return readFileSync(f.file);
  };
  const fresh = same(new Date(Date.now() - 1_000).toISOString());
  const kept = activateSelectionProfile(profile("revision-A"), f.snapshotA, f.options);
  expect(readFileSync(f.file)).toEqual(fresh);
  expect(kept).toEqual(JSON.parse(fresh.toString("utf8")));
  const stale = selectionProfilePrecondition(readSelectionProfileSnapshot("fleet", f.options))!;
  same("2026-01-01T00:00:00.000Z");
  const restamped = activateSelectionProfile(profile("revision-A"), stale, f.options);
  expect(Date.parse(restamped.verifiedAt)).toBeGreaterThan(Date.now() - 60_000);
  expect(readSelectionProfile("fleet", f.options)).toEqual(restamped);
  // A different selection is still a stale overwrite.
  expect(() => activateSelectionProfile(profile("revision-C"), stale, f.options)).toThrow(expect.objectContaining({ code: "SELECTION_PROFILE_CHANGED" }));
});

test("an activation that names no precondition, or a malformed one, is refused and writes nothing", () => {
  const f = fixture();
  for (const expected of [undefined, {}, { sha256: "x", dev: 1, ino: 1 }, { sha256: f.snapshotA.sha256, dev: "1", ino: 1 }]) {
    expect(() => activateSelectionProfile(profile("revision-C"), expected as unknown as SelectionProfilePrecondition, f.options))
      .toThrow(expect.objectContaining({ code: "INVALID_PROFILE_PRECONDITION" }));
  }
  expect(readFileSync(f.file)).toEqual(f.bytesA);
});

test("a live holder past the bounded wait refuses PROFILE_WRITE_BUSY; the lock and profile stay, and readers never wait", () => {
  const f = fixture();
  const lock = f.hold({ schemaVersion: 1, operationId: randomUUID(), profileId: "fleet", pid: process.pid });
  const read = performance.now();
  expect(readSelectionProfile("fleet", f.options)?.profile.profileRevision).toBe("revision-A");
  expect(performance.now() - read).toBeLessThan(250);
  const started = performance.now();
  expect(() => activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "PROFILE_WRITE_BUSY", message: expect.stringContaining(f.lockPath) }));
  expect(performance.now() - started).toBeGreaterThanOrEqual(PROFILE_WRITE_LOCK_WAIT_MS - 50);
  expect(inspectProfileWriteLock("fleet", f.options)).toMatchObject({ profileId: "fleet", path: f.lockPath, locked: true, schemaVersion: 1, pid: process.pid, holder: "alive", hostBound: false, recoverableAutomatically: false });
  expect(readFileSync(f.lockPath, "utf8")).toBe(lock);
  expect(readFileSync(f.lockPath, "utf8")).toBe(lock);
  expect(readFileSync(f.file)).toEqual(f.bytesA);
});

test("a briefly held lock is waited for, then the activation applies and releases its own lock", () => {
  const f = fixture();
  f.hold({ schemaVersion: 1, operationId: randomUUID(), profileId: "fleet", pid: process.pid });
  helpers.push(Bun.spawn([process.execPath, "--no-install", "-e", `await Bun.sleep(400); require("node:fs").unlinkSync(${JSON.stringify(f.lockPath)});`], { cwd: f.root, stdout: "ignore", stderr: "ignore" }));
  const started = performance.now();
  activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options);
  expect(performance.now() - started).toBeGreaterThan(300);
  expect(readSelectionProfile("fleet", f.options)?.profile.profileRevision).toBe("revision-B");
  expect(readdirSync(join(f.options.cacheDir, "profiles"))).toEqual([f.file.split("/").pop()!]);
});

test("the comparison runs under the lock: a writer that replaces the profile while holding it makes the stale activation refuse", () => {
  const f = fixture();
  f.hold({ schemaVersion: 1, operationId: randomUUID(), profileId: "fleet", pid: process.pid });
  const replacement = join(f.root, "replacement.json");
  writeFileSync(replacement, `${JSON.stringify({ schemaVersion: 1, verifiedAt: new Date().toISOString(), profile: profile("revision-B") })}\n`, { mode: 0o600 });
  // The holder publishes B by rename, then releases its lock.
  helpers.push(Bun.spawn([process.execPath, "--no-install", "-e",
    `const fs = require("node:fs"); await Bun.sleep(400); fs.renameSync(${JSON.stringify(replacement)}, ${JSON.stringify(f.file)}); fs.unlinkSync(${JSON.stringify(f.lockPath)});`],
  { cwd: f.root, stdout: "ignore", stderr: "ignore" }));
  expect(() => activateSelectionProfile(profile("revision-C"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "SELECTION_PROFILE_CHANGED" }));
  expect(readSelectionProfile("fleet", f.options)?.profile.profileRevision).toBe("revision-B");
});

test("a lock that is not a private regular file is refused as PROFILE_WRITE_LOCKED and left in place", () => {
  const f = fixture();
  writeFileSync(f.lockPath, "{}\n", { mode: 0o644 });
  expect(() => activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "PROFILE_WRITE_LOCKED", message: expect.stringContaining(f.lockPath) }));
  expect(readFileSync(f.lockPath, "utf8")).toBe("{}\n");
  expect(readFileSync(f.file)).toEqual(f.bytesA);
});

if (hostBound) test("a dead holder's host-bound lock is preserved in profile-lock-recoveries, then the activation applies", () => {
  const f = fixture();
  const { selfStart: _, ...identity } = hostIdentity();
  const pid = exitedPid();
  const lock = f.hold({ schemaVersion: 2, operationId: randomUUID(), profileId: "fleet", pid, ...identity, processStart: "gone:1" }, 60_000);
  expect(inspectProfileWriteLock("fleet", f.options)).toMatchObject({ locked: true, schemaVersion: 2, pid, holder: "absent", hostBound: true, sameHostAndBoot: true, recoverableAutomatically: true });
  activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options);
  expect(readSelectionProfile("fleet", f.options)?.profile.profileRevision).toBe("revision-B");
  const recoveries = join(f.options.cacheDir, "profile-lock-recoveries");
  const [directory] = readdirSync(recoveries);
  expect(readFileSync(join(recoveries, directory!, "original.write-lock"), "utf8")).toBe(lock);
  expect(JSON.parse(readFileSync(join(recoveries, directory!, "recovery.json"), "utf8"))).toMatchObject({ profileId: "fleet", lockPid: pid, profileSha256: f.snapshotA.sha256, status: "prepared" });
});

if (hostBound) test("a live, recent or foreign-boot holder is never replaced, however old its lock", () => {
  const f = fixture();
  const { selfStart, ...identity } = hostIdentity();
  const dead = { schemaVersion: 2, operationId: randomUUID(), profileId: "fleet", pid: exitedPid(), ...identity, processStart: "gone:1" };
  for (const [owner, ageMs] of [[{ ...dead, pid: process.pid, processStart: selfStart }, 60_000], [{ ...dead, bootId: randomUUID() }, 60_000], [dead, 0]] as const) {
    const lock = f.hold(owner, ageMs);
    expect(() => activateSelectionProfile(profile("revision-B"), f.snapshotA, f.options)).toThrow(expect.objectContaining({ code: "PROFILE_WRITE_BUSY" }));
    expect(readFileSync(f.lockPath, "utf8")).toBe(lock);
  }
  expect(readFileSync(f.file)).toEqual(f.bytesA);
  expect(readdirSync(f.options.cacheDir)).not.toContain("profile-lock-recoveries");
});
