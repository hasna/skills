/**
 * Session pin renewal off the prompt's critical path.
 *
 * A managed hook never runs a whole renewal inside its prompt budget. It
 * starts one detached worker (`skills sessions renew-background`) per session
 * and, for an expired pin, waits a short bounded time for it. The worker runs
 * the same renewSkillSessionPin as before, with the same authenticated checks,
 * archive and exact receipt precondition, but with a budget large enough for
 * a large pin on a slow authority, and it is not thrown away when a prompt's
 * window ends. A root session is also renewed ahead of expiry, while its pin
 * is still valid and its prompts keep receiving context from it.
 *
 * Nothing here authorizes anything. The lock only avoids duplicate work: two
 * workers for one session are still safe, because the commit is an exact
 * receipt compare-and-swap. The state record only reports what a worker did;
 * a reader still rereads and verifies the receipt itself. Until a renewal
 * commits, an expired pin delivers no payload.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import {
  createExclusiveSelectionJson, MAX_CACHED_PROFILE_AGE_MS, readSelectionFileSnapshot, readSkillSessionSnapshotIfExists,
  removeSelectionFileIfUnchanged, selectionCacheRoot, sessionReceiptPath, SkillSelectionError, writeSelectionJson, type SelectionCacheOptions,
} from "./selection-cache.js";
import {
  BACKGROUND_SESSION_RENEWAL_BUDGET_MS, renewSkillSessionPin, SESSION_RENEW_AHEAD_AGE_MS, SessionPinMigrationTimeout,
  type SessionPinMigration, type SessionReconciliationOptions,
} from "./session-reconciliation.js";
import { selfSpawnCommand } from "./self-spawn.js";

/** The longest an expired-pin prompt waits for its background renewal. */
export const BACKGROUND_RENEWAL_WAIT_MS = 3_000;
/** A lock older than this belongs to no live worker (the worker's own budget plus margin). */
export const BACKGROUND_RENEWAL_LOCK_TTL_MS = BACKGROUND_SESSION_RENEWAL_BUDGET_MS + 60_000;
/** A lock whose worker never reported a process within this window was not started. */
const SPAWN_GRACE_MS = 15_000;
/** A failed attempt for the same pin is reported again, not retried, within these windows. */
export const EXPIRED_RENEWAL_RETRY_MS = 30_000;
export const AHEAD_RENEWAL_RETRY_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 100;
const STATE_MAX_BYTES = 64 * 1024;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export type BackgroundRenewalMode = "expired" | "ahead";
export type BackgroundRenewalStatus = "running" | "renewed" | "migrated" | "unchanged" | "failed";
export interface BackgroundRenewalState {
  schemaVersion: 1; kind: "session-pin-background-renewal";
  sessionId: string; profileId: string; operationId: string;
  /** verifiedAt of the exact pin this attempt renews. */
  pinVerifiedAt: string;
  mode: BackgroundRenewalMode; status: BackgroundRenewalStatus;
  startedAt: string; finishedAt?: string; workerPid?: number;
  code?: string; migrationTimeout?: true; migration?: SessionPinMigration;
  /** No worker could be started; such a record never delays the next attempt. */
  notStarted?: true;
  /**
   * The exact request this attempt answers: the receipt bytes, mode,
   * migration setting and prompt directory. A recorded failure is reused only
   * for the same request; any change (a rewritten receipt, migration turned
   * on, another directory) asks again at once.
   */
  requestDigest?: string;
}
interface BackgroundRenewalLock { schemaVersion: 1; kind: "session-pin-background-renewal-lock"; sessionId: string; operationId: string; createdAt: string; spawnerPid: number }
export interface BackgroundRenewalRequest {
  sessionId: string; profileId: string; pinVerifiedAt: string; mode: BackgroundRenewalMode;
  /** SHA-256 of the exact receipt bytes this request read. */
  receiptSha256: string;
  /** Expired pins only: the managed hook's automatic migration of a refused renewal. */
  migrate?: boolean;
  /** The prompt's directory, which migration requires (project locks keep the refusal). */
  projectDir?: string;
}
export interface BackgroundRenewalOptions extends SelectionCacheOptions {
  /** Tests replace the detached worker; production spawns `skills sessions renew-background`. */
  spawnWorker?: (args: string[]) => void;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const SHA256 = /^[a-f0-9]{64}$/;
/** The identity of one renewal request; equal digests ask the authority the same question. */
export function backgroundRenewalRequestDigest(request: BackgroundRenewalRequest): string {
  if (!SHA256.test(request.receiptSha256)) throw new SkillSelectionError("INVALID_RECEIPT", "A background renewal request needs the exact receipt SHA-256.");
  const migrate = request.mode === "expired" && request.migrate === true;
  return digest(JSON.stringify({ sessionId: request.sessionId, profileId: request.profileId, receiptSha256: request.receiptSha256, mode: request.mode, migrate, projectDir: request.projectDir ?? null }));
}
function renewalPaths(sessionId: string, options: SelectionCacheOptions) {
  sessionReceiptPath(sessionId, options); // validates the session id
  const base = join(selectionCacheRoot(options), "session-renewals", digest(sessionId));
  return { lock: `${base}.lock`, state: `${base}.json` };
}
function exactTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

/** The last recorded attempt for this session, or null when absent or not exact. */
export function readBackgroundRenewalState(sessionId: string, options: SelectionCacheOptions = {}): BackgroundRenewalState | null {
  let snapshot;
  try { snapshot = readSelectionFileSnapshot(renewalPaths(sessionId, options).state, STATE_MAX_BYTES); } catch { return null; }
  if (!snapshot) return null;
  let value: BackgroundRenewalState;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes)); } catch { return null; }
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.kind !== "session-pin-background-renewal"
    || value.sessionId !== sessionId || typeof value.profileId !== "string" || typeof value.operationId !== "string"
    || !exactTimestamp(value.pinVerifiedAt) || !exactTimestamp(value.startedAt) || (value.finishedAt !== undefined && !exactTimestamp(value.finishedAt))
    || !["expired", "ahead"].includes(value.mode) || !["running", "renewed", "migrated", "unchanged", "failed"].includes(value.status)
    || (value.code !== undefined && !CODE.test(value.code)) || (value.notStarted !== undefined && value.notStarted !== true)
    || (value.requestDigest !== undefined && !SHA256.test(value.requestDigest))) return null;
  return value;
}
function writeState(state: BackgroundRenewalState, options: SelectionCacheOptions): void {
  writeSelectionJson(renewalPaths(state.sessionId, options).state, state);
}

interface LockSnapshot { lock: BackgroundRenewalLock | null; sha256: string; dev: number; ino: number; mtimeMs: number }
function readLock(sessionId: string, options: SelectionCacheOptions): LockSnapshot | null {
  const snapshot = readSelectionFileSnapshot(renewalPaths(sessionId, options).lock);
  if (!snapshot) return null;
  let lock: BackgroundRenewalLock | null = null;
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
    if (value?.schemaVersion === 1 && value.kind === "session-pin-background-renewal-lock" && value.sessionId === sessionId
      && typeof value.operationId === "string" && exactTimestamp(value.createdAt) && Number.isSafeInteger(value.spawnerPid)) lock = value;
  } catch { /* a lock being written, or damaged: judged by its age below */ }
  return { lock, sha256: snapshot.sha256, dev: snapshot.dev, ino: snapshot.ino, mtimeMs: snapshot.mtimeMs };
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function lockIsStale(snapshot: LockSnapshot, state: BackgroundRenewalState | null, now: number): boolean {
  const created = snapshot.lock ? Date.parse(snapshot.lock.createdAt) : snapshot.mtimeMs;
  const age = now - Math.min(created, snapshot.mtimeMs);
  if (age > BACKGROUND_RENEWAL_LOCK_TTL_MS || !snapshot.lock) return age > SPAWN_GRACE_MS;
  const own = state?.operationId === snapshot.lock.operationId ? state : null;
  if (own && own.status !== "running") return true;
  if (own?.workerPid !== undefined) return !processAlive(own.workerPid);
  return age > SPAWN_GRACE_MS;
}

export type BackgroundRenewalStart =
  /** `operationId` names the attempt to wait for, when its lock is readable. */
  | { status: "started" | "running"; operationId?: string }
  /** `notStarted`: no worker could be started, so the caller may renew inline instead. */
  | { status: "failed"; state: BackgroundRenewalState; notStarted?: true };

/**
 * Start the session's background renewal unless one is running, or report a
 * recent failure of the same pin without starting another.
 */
export function startBackgroundRenewal(request: BackgroundRenewalRequest, options: BackgroundRenewalOptions = {}): BackgroundRenewalStart {
  const now = (options.now ?? Date.now)();
  const paths = renewalPaths(request.sessionId, options);
  const requestDigest = backgroundRenewalRequestDigest(request);
  const state = readBackgroundRenewalState(request.sessionId, options);
  const held = readLock(request.sessionId, options);
  if (held && !lockIsStale(held, state, now)) return { status: "running", ...(held.lock ? { operationId: held.lock.operationId } : {}) };
  // Only the same request within its window reuses a recorded failure.
  if (state && state.status === "failed" && !state.notStarted && state.requestDigest === requestDigest && state.finishedAt !== undefined) {
    const since = now - Date.parse(state.finishedAt);
    if (since >= 0 && since < (request.mode === "expired" ? EXPIRED_RENEWAL_RETRY_MS : AHEAD_RENEWAL_RETRY_MS)) return { status: "failed", state };
  }
  if (held) removeSelectionFileIfUnchanged(paths.lock, held);
  const operationId = randomUUID();
  const lock: BackgroundRenewalLock = { schemaVersion: 1, kind: "session-pin-background-renewal-lock", sessionId: request.sessionId, operationId, createdAt: new Date(now).toISOString(), spawnerPid: process.pid };
  if (!createExclusiveSelectionJson(paths.lock, lock)) return { status: "running" };
  const running: BackgroundRenewalState = {
    schemaVersion: 1, kind: "session-pin-background-renewal", sessionId: request.sessionId, profileId: request.profileId, operationId,
    pinVerifiedAt: request.pinVerifiedAt, mode: request.mode, status: "running", startedAt: new Date(now).toISOString(), requestDigest,
  };
  const args = ["sessions", "renew-background", request.sessionId, "--selection-profile", request.profileId, "--operation-id", operationId,
    ...(request.mode === "expired" && request.migrate ? ["--migrate"] : []), ...(request.projectDir ? ["--project-dir", request.projectDir] : []), "--json"];
  try {
    writeState(running, options);
    (options.spawnWorker ?? spawnDetachedWorker)(args);
  } catch {
    const failed: BackgroundRenewalState = { ...running, status: "failed", code: "SKILLS_CONTEXT_FAILED", notStarted: true, finishedAt: new Date((options.now ?? Date.now)()).toISOString() };
    try { writeState(failed, options); } catch { /* the refusal below still stands */ }
    const current = readSelectionFileSnapshot(paths.lock);
    if (current) removeSelectionFileIfUnchanged(paths.lock, current);
    return { status: "failed", state: failed, notStarted: true };
  }
  return { status: "started", operationId };
}

function spawnDetachedWorker(args: string[]): void {
  // Pinned flags, trusted cwd and the allowlisted environment, exactly as the
  // managed hook starts its context child. No stdio is shared, so the hook's
  // pipes close when the prompt's work is done, and the worker's own session
  // keeps it alive after the hook returns.
  const self = selfSpawnCommand(args);
  const child = spawn(self.command[0]!, self.command.slice(1), { cwd: self.cwd, env: { ...self.env, NO_COLOR: "1" }, detached: true, stdio: "ignore" });
  child.on("error", () => { /* a worker that never started leaves a lock that expires */ });
  child.unref();
}

export type BackgroundRenewalWait = { status: "running" | "changed" } | { status: Exclude<BackgroundRenewalStatus, "running">; state: BackgroundRenewalState };
/**
 * Wait up to waitMs for the attempt renewing this exact pin to finish, or for
 * the session receipt to stop holding that pin. With an operation id, only
 * that attempt's outcome counts.
 */
export async function awaitBackgroundRenewal(sessionId: string, pinVerifiedAt: string, waitMs: number, options: SelectionCacheOptions = {}, operationId?: string): Promise<BackgroundRenewalWait> {
  const deadline = performance.now() + Math.max(0, Math.min(waitMs, BACKGROUND_RENEWAL_WAIT_MS));
  const receiptPath = sessionReceiptPath(sessionId, options);
  let seen: string | undefined;
  while (true) {
    const state = readBackgroundRenewalState(sessionId, options);
    if (state && state.pinVerifiedAt === pinVerifiedAt && state.status !== "running" && (operationId === undefined || state.operationId === operationId)) return { status: state.status, state };
    // Reread the receipt only when its file changed since the last look
    // (receipt writes replace the file, so its inode changes).
    let stamp: string;
    try { const stat = lstatSync(receiptPath, { throwIfNoEntry: false }); stamp = stat ? `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}` : "absent"; }
    catch { stamp = "unreadable"; }
    if (stamp !== seen) {
      seen = stamp;
      try { if (readSkillSessionSnapshotIfExists(sessionId, options)?.receipt.verifiedAt !== pinVerifiedAt) return { status: "changed" }; }
      catch { return { status: "changed" }; }
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { status: "running" };
    await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)));
  }
}

export interface BackgroundRenewalRun { status: BackgroundRenewalStatus | "superseded"; code?: string }
/**
 * The worker: renew (or, for an expired pin with migration on, migrate) one
 * session pin with the background budget, record the outcome, release the lock.
 */
export async function runBackgroundRenewal(sessionId: string, profileId: string, operationId: string, request: { migrate?: boolean; projectDir?: string }, options: SessionReconciliationOptions = {}): Promise<BackgroundRenewalRun> {
  const paths = renewalPaths(sessionId, options);
  const held = readLock(sessionId, options);
  if (!held?.lock || held.lock.operationId !== operationId) return { status: "superseded" };
  const clock = options.now ?? Date.now;
  const previous = readBackgroundRenewalState(sessionId, options);
  let state: BackgroundRenewalState = previous?.operationId === operationId ? { ...previous, workerPid: process.pid } : {
    schemaVersion: 1, kind: "session-pin-background-renewal", sessionId, profileId, operationId, pinVerifiedAt: new Date(0).toISOString(),
    mode: "expired", status: "running", startedAt: new Date(clock()).toISOString(), workerPid: process.pid,
  };
  try {
    const snapshot = readSkillSessionSnapshotIfExists(sessionId, options);
    if (!snapshot) { state = { ...state, status: "unchanged" }; return { status: "unchanged" }; }
    const age = clock() - Date.parse(snapshot.receipt.verifiedAt);
    const expired = age > MAX_CACHED_PROFILE_AGE_MS;
    state = { ...state, pinVerifiedAt: snapshot.receipt.verifiedAt, mode: expired ? "expired" : "ahead" };
    writeState(state, options);
    const outcome = await renewSkillSessionPin(sessionId, profileId, {
      ...options, background: true, budgetMs: BACKGROUND_SESSION_RENEWAL_BUDGET_MS,
      renewAfterMs: expired ? MAX_CACHED_PROFILE_AGE_MS : SESSION_RENEW_AHEAD_AGE_MS,
      migrate: expired && request.migrate === true, projectDir: request.projectDir,
    });
    state = { ...state, status: outcome.outcome, ...(outcome.outcome === "migrated" ? { migration: outcome.migration } : {}) };
    return { status: outcome.outcome };
  } catch (error) {
    const storageFull = error instanceof Error && ["ENOSPC", "EDQUOT"].includes((error as NodeJS.ErrnoException).code ?? "");
    const code = error instanceof SkillSelectionError && CODE.test(error.code) ? error.code : storageFull ? "SKILLS_STORAGE_FULL" : "SKILLS_CONTEXT_FAILED";
    state = { ...state, status: "failed", code, ...(error instanceof SessionPinMigrationTimeout ? { migrationTimeout: true as const } : {}) };
    return { status: "failed", code };
  } finally {
    state = { ...state, finishedAt: new Date(clock()).toISOString() };
    try { writeState(state, options); } catch { /* the lock below still expires */ }
    const current = readLock(sessionId, options);
    if (current?.lock?.operationId === operationId) removeSelectionFileIfUnchanged(paths.lock, current);
  }
}

/**
 * An expired pin whose background renewal is still running. It keeps the
 * renewal timeout's code (fixed codes cross the hook boundary) and a fixed
 * marker so the hook can say the renewal continues instead of restarting.
 */
export class SessionRenewalInBackground extends SkillSelectionError {
  readonly renewal = "background" as const;
  constructor() {
    super("SESSION_RENEWAL_TIMEOUT", "Renewal of this session's expired pin is running in the background; the existing pin is unchanged and a later prompt uses the renewed pin once it commits.");
  }
}
/** The recorded failure of a background attempt, as the error the inline renewal would have raised. */
export function backgroundRenewalError(state: BackgroundRenewalState): SkillSelectionError {
  if (state.code === "SESSION_RECONCILIATION_REQUIRED" && state.migrationTimeout) return new SessionPinMigrationTimeout();
  const code = state.code && CODE.test(state.code) ? state.code : "SKILLS_CONTEXT_FAILED";
  return new SkillSelectionError(code, `The background renewal of this session pin failed with ${code} at ${state.finishedAt ?? state.startedAt}; the existing pin is unchanged. It is retried after a short interval.`);
}

/** The pin's age class, from its verifiedAt; null when it is neither due nor expired. */
export function renewalModeFor(verifiedAt: string, now: number): BackgroundRenewalMode | null {
  const age = now - Date.parse(verifiedAt);
  if (!Number.isFinite(age) || age < SESSION_RENEW_AHEAD_AGE_MS) return null;
  return age > MAX_CACHED_PROFILE_AGE_MS ? "expired" : "ahead";
}
