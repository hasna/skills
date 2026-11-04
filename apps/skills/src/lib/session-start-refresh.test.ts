/**
 * When session start refreshes the station's cached profile, and the marker
 * that lets concurrent session starts on one station share one refresh.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activateSelectionProfile, profileRefreshLockPath } from "./selection-cache.js";
import {
  SESSION_START_REFRESH_LOCK_STALE_MS, SESSION_START_SYNC_MAX_AGE_ENV, sessionStartRefreshDue, sessionStartSyncMaxAgeMs,
  tryAcquireSessionStartRefresh, waitForSessionStartRefresh,
} from "./session-start-refresh.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const AUTHORITY = "https://skills.example.com/api/v1";
const profile = (profileId = "fleet"): ResolvedSkillProfile => ({ authority: AUTHORITY, workspaceId: "org-test", profileId, profileRevision: "r1", selections: [] });
function cache() { const root = mkdtempSync(join(tmpdir(), "skills-session-start-refresh-")); roots.push(root); return { cacheDir: join(root, "cache") }; }
const MINUTE = 60_000;

test("the refresh age comes only from whole minutes within the cached profile's 24-hour bound; anything else refreshes every session start", () => {
  expect(sessionStartSyncMaxAgeMs({})).toBe(0);
  expect(sessionStartSyncMaxAgeMs({ [SESSION_START_SYNC_MAX_AGE_ENV]: "0" })).toBe(0);
  expect(sessionStartSyncMaxAgeMs({ [SESSION_START_SYNC_MAX_AGE_ENV]: "60" })).toBe(60 * MINUTE);
  expect(sessionStartSyncMaxAgeMs({ [SESSION_START_SYNC_MAX_AGE_ENV]: "1440" })).toBe(1440 * MINUTE);
  for (const value of ["1441", "9999", "-5", "60.5", "1e3", "", " 60", "abc", "12345"]) {
    expect(sessionStartSyncMaxAgeMs({ [SESSION_START_SYNC_MAX_AGE_ENV]: value })).toBe(0);
  }
});

test("a cached profile is due unless it is valid, for exactly this profile, and younger than the bound", () => {
  const options = cache(), start = Date.parse("2026-11-04T12:00:00.000Z");
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, options)).toBe(true);
  activateSelectionProfile(profile(), { ...options, now: () => start });
  const at = (offset: number) => ({ ...options, now: () => start + offset });
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, at(5 * MINUTE))).toBe(false);
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, at(60 * MINUTE - 1))).toBe(false);
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, at(60 * MINUTE))).toBe(true);
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, at(2 * 60 * MINUTE))).toBe(true);
  // Default: every session start refreshes, however young the cache.
  expect(sessionStartRefreshDue("fleet", 0, at(1))).toBe(true);
  // A pointer dated in the future is not trusted as fresh.
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, at(-MINUTE))).toBe(true);
  // Another profile's pointer never satisfies this one.
  expect(sessionStartRefreshDue("other", 60 * MINUTE, at(MINUTE))).toBe(true);
});

test("a refresh another session start finished after this one started satisfies it, even at the every-start default", () => {
  const options = cache(), start = Date.parse("2026-11-04T12:00:00.000Z");
  activateSelectionProfile(profile(), { ...options, now: () => start });
  const now = () => start + 2_000;
  expect(sessionStartRefreshDue("fleet", 0, { ...options, now, verifiedSince: start - 1_000 })).toBe(false);
  expect(sessionStartRefreshDue("fleet", 0, { ...options, now, verifiedSince: start })).toBe(false);
  expect(sessionStartRefreshDue("fleet", 0, { ...options, now, verifiedSince: start + 1 })).toBe(true);
});

test("an unreadable cached pointer is due, so the refresh and its own checks decide", () => {
  const options = cache();
  activateSelectionProfile(profile(), options);
  const pointer = profileRefreshLockPath("fleet", options).replace(/\.refresh\.lock$/, ".json");
  writeFileSync(pointer, "{not json");
  expect(sessionStartRefreshDue("fleet", 60 * MINUTE, options)).toBe(true);
});

test("one session start holds the marker; others wait and the holder's release lets the next one in", async () => {
  const options = cache();
  const first = tryAcquireSessionStartRefresh("fleet", options);
  expect(first).not.toBeNull();
  expect(tryAcquireSessionStartRefresh("fleet", options)).toBeNull();
  // A marker for another profile is independent.
  const other = tryAcquireSessionStartRefresh("other", options);
  expect(other).not.toBeNull(); other!.release();
  expect(await waitForSessionStartRefresh("fleet", Date.now() + 250, options)).toBe(false);
  setTimeout(() => first!.release(), 150);
  const started = Date.now();
  expect(await waitForSessionStartRefresh("fleet", Date.now() + 5_000, options)).toBe(true);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(existsSync(profileRefreshLockPath("fleet", options))).toBe(false);
  const next = tryAcquireSessionStartRefresh("fleet", options);
  expect(next).not.toBeNull(); next!.release();
});

test("a marker left by a hook that no longer runs is taken over; a release never removes someone else's marker", async () => {
  const options = cache(), path = profileRefreshLockPath("fleet", options);
  const dead = tryAcquireSessionStartRefresh("fleet", options)!;
  const old = (Date.now() - SESSION_START_REFRESH_LOCK_STALE_MS - 5_000) / 1000;
  utimesSync(path, old, old);
  expect(await waitForSessionStartRefresh("fleet", Date.now() + 50, options)).toBe(true);
  const taken = tryAcquireSessionStartRefresh("fleet", options);
  expect(taken).not.toBeNull();
  // The dead holder's late release leaves the new holder's marker in place.
  dead.release();
  expect(existsSync(path)).toBe(true);
  expect(tryAcquireSessionStartRefresh("fleet", options)).toBeNull();
  taken!.release();
  expect(existsSync(path)).toBe(false);
});

test("a marker that cannot be written leaves the refresh unguarded instead of failing session start", () => {
  const options = cache();
  // A file where the cache root's directory should be: no marker can be created.
  writeFileSync(join(options.cacheDir, "..", "blocked"), "");
  const blocked = { cacheDir: join(options.cacheDir, "..", "blocked", "cache") };
  const lock = tryAcquireSessionStartRefresh("fleet", blocked);
  expect(lock).not.toBeNull();
  expect(() => lock!.release()).not.toThrow();
  expect(tryAcquireSessionStartRefresh("fleet", blocked)).not.toBeNull();
});
