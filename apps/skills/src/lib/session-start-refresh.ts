/**
 * When a managed hook refreshes the station's selection profile at session
 * start, and how concurrent session starts on one station share that refresh.
 *
 * The refresh itself is the ordinary `skills sync --selection-profile <id>`
 * child, so it keeps every check that command makes. This module only decides
 * whether the cached profile pointer is old enough to need it, and lets one
 * session start refresh while the others wait for its result.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  createExclusiveSelectionJson, profileRefreshLockPath, readSelectionFileSnapshot, readSelectionProfile,
  removeSelectionFileIfUnchanged, MAX_CACHED_PROFILE_AGE_MS, type SelectionCacheOptions,
} from "./selection-cache.js";

/** Whole minutes; 0 (the default) refreshes at every session start. */
export const SESSION_START_SYNC_MAX_AGE_ENV = "SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES";
/**
 * Every session start refreshes by default. That is also where a new session
 * re-checks its authorization (prompt hooks read the verified cache), so a
 * station opts into skipping it, for a cached profile younger than its
 * setting, only through SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES.
 */
export const SESSION_START_SYNC_DEFAULT_MAX_AGE_MS = 0;
/**
 * A refresh marker older than this belongs to a hook that is no longer
 * running: every managed hook ends within its own 12-second deadline.
 */
export const SESSION_START_REFRESH_LOCK_STALE_MS = 30_000;
const SESSION_START_REFRESH_POLL_MS = 100;

/**
 * The cached-profile age after which session start refreshes, from
 * SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES: whole minutes from 0 to 1440 (the
 * cached profile's own 24-hour bound). Unset or anything else keeps the
 * default, a refresh at every session start.
 */
export function sessionStartSyncMaxAgeMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[SESSION_START_SYNC_MAX_AGE_ENV];
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return SESSION_START_SYNC_DEFAULT_MAX_AGE_MS;
  const ms = Number(raw) * 60_000;
  return ms <= MAX_CACHED_PROFILE_AGE_MS ? ms : SESSION_START_SYNC_DEFAULT_MAX_AGE_MS;
}

/**
 * True unless this station holds a valid cached pointer for exactly this
 * profile that was verified less than maxAgeMs ago, or at or after
 * verifiedSince (a refresh another session start finished while this one
 * waited). A missing, unreadable, invalid or future-dated pointer is due, so
 * the refresh and its own checks decide.
 */
export function sessionStartRefreshDue(profileId: string, maxAgeMs: number, options: SelectionCacheOptions & { verifiedSince?: number } = {}): boolean {
  if (!(maxAgeMs > 0) && options.verifiedSince === undefined) return true;
  try {
    const receipt = readSelectionProfile(profileId, options);
    if (!receipt || receipt.profile.profileId !== profileId) return true;
    const verified = Date.parse(receipt.verifiedAt), now = (options.now ?? Date.now)();
    if (!Number.isFinite(verified) || verified > now) return true;
    if (options.verifiedSince !== undefined && verified >= options.verifiedSince) return false;
    return !(maxAgeMs > 0 && now - verified < maxAgeMs);
  } catch { return true; }
}

export interface SessionStartRefreshLock { release(): void }

/**
 * Take this station's refresh marker for the profile, or null while another
 * session start holds it. A marker past SESSION_START_REFRESH_LOCK_STALE_MS is
 * replaced only while it still holds the exact bytes and inode that were read.
 * The marker only saves duplicate work, so when it cannot be written or read
 * (a read-only sandbox, say) the refresh runs unguarded, as it did before the
 * marker existed, and the sync child's own checks decide.
 */
export function tryAcquireSessionStartRefresh(profileId: string, options: SelectionCacheOptions = {}): SessionStartRefreshLock | null {
  const unguarded: SessionStartRefreshLock = { release: () => {} };
  try {
    const path = profileRefreshLockPath(profileId, options);
    const create = (): SessionStartRefreshLock | null => {
      if (!createExclusiveSelectionJson(path, { pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), nonce: randomUUID() })) return null;
      const mine = readSelectionFileSnapshot(path);
      return { release: () => { try { if (mine) removeSelectionFileIfUnchanged(path, mine); } catch { /* a stale marker expires */ } } };
    };
    const created = create();
    if (created) return created;
    const held = readSelectionFileSnapshot(path);
    if (!held) return create();
    if (Date.now() - held.mtimeMs <= SESSION_START_REFRESH_LOCK_STALE_MS) return null;
    return removeSelectionFileIfUnchanged(path, held) ? create() : null;
  } catch { return unguarded; }
}

/** Wait until no session start holds the marker, or until the absolute deadline. True when it was released. */
export async function waitForSessionStartRefresh(profileId: string, deadline: number, options: SelectionCacheOptions = {}): Promise<boolean> {
  for (;;) {
    let held: ReturnType<typeof readSelectionFileSnapshot>;
    try { held = readSelectionFileSnapshot(profileRefreshLockPath(profileId, options)); } catch { return true; }
    if (!held || Date.now() - held.mtimeMs > SESSION_START_REFRESH_LOCK_STALE_MS) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(SESSION_START_REFRESH_POLL_MS, left)));
  }
}
