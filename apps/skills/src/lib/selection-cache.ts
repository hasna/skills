/** Immutable, credential-authority/workspace scoped objects. Authoring corpus is never read or written. */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getDataDirReadOnly } from "./config.js";
import { inspectSkillBundle, sha256Hex, SKILL_BUNDLE_INSPECTION_LIMITS, type SkillBundleEntry } from "./skill-bundle.js";
import { isValidSkillVersion } from "./skill-version.js";
import { selectionAliasError } from "./selection-aliases.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, MAX_RESOLVED_PROFILE_BYTES, MAX_SKILL_SESSION_ID_CHARS, profileDocumentBytes } from "./profile-limits.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";

export class SkillSelectionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SkillSelectionError"; }
}
export interface SelectionCacheOptions { cacheDir?: string; now?: () => number }
export interface CachedSelectionProfile { schemaVersion: 1; verifiedAt: string; profile: ResolvedSkillProfile }
export interface SkillSessionParentBinding { sessionId: string; generation: number; receiptSha256: string }
export interface SkillSessionReceipt extends CachedSelectionProfile {
  sessionId: string;
  loaded: string[];
  /** Monotonic across sanctioned receipt writes. Legacy receipts without it are generation zero. */
  generation?: number;
  /** Private local metadata binding a child receipt to the exact parent snapshot it inherited. */
  parent?: SkillSessionParentBinding;
}
export interface SkillSessionSnapshot extends SkillSessionParentBinding { path: string; bytes: Uint8Array; receipt: SkillSessionReceipt; sha256: string }
export interface SkillSessionWritePrecondition { current: SkillSessionParentBinding | null; parent?: SkillSessionParentBinding }
export const MAX_CACHED_PROFILE_AGE_MS = 24 * 60 * 60 * 1000;
export const SELECTION_LOCK_FILE = "selection.lock.json";

export function selectionCacheRoot(options: SelectionCacheOptions = {}): string {
  return resolve(options.cacheDir ?? join(getDataDirReadOnly(), "selection-cache"));
}
export function selectionKey(selection: ResolvedSkillSelection): string {
  validateSelection(selection);
  return hash([selection.authority, selection.workspaceId, selection.slug, selection.version, selection.bundleDigest]);
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function validateSelection(selection: ResolvedSkillSelection): void {
  if (!selection || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.slug)
      || !isValidSkillVersion(selection.version) || !/^sha256:[a-f0-9]{64}$/.test(selection.bundleDigest)
      || typeof selection.workspaceId !== "string" || !selection.workspaceId.trim()
      || typeof selection.profileRevision !== "string" || !selection.profileRevision.trim()) {
    throw new SkillSelectionError("INVALID_SELECTION", "A skill selection must carry an exact version, digest, workspace and profile revision.");
  }
  const aliasError = selectionAliasError([selection]);
  if (aliasError) throw new SkillSelectionError("INVALID_SELECTION_ALIASES", aliasError);
  try {
    const url = new URL(selection.authority);
    if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)
      || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
  } catch { throw new SkillSelectionError("INVALID_SELECTION", "The skill selection authority is invalid."); }
}
export function validateResolvedProfile(profile: ResolvedSkillProfile, authority?: string): void {
  if (!profile || typeof profile.profileId !== "string" || !profile.profileId.trim() || !Array.isArray(profile.selections)
      || profile.selections.length > MAX_PROFILE_SELECTIONS || typeof profile.workspaceId !== "string" || !profile.workspaceId.trim()
      || typeof profile.profileRevision !== "string" || !profile.profileRevision.trim()
      || typeof profile.authority !== "string" || (authority !== undefined && profile.authority !== authority)) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The resolved profile does not match the configured Skills authority.");
  }
  if (profileDocumentBytes(profile) > MAX_RESOLVED_PROFILE_BYTES) throw new SkillSelectionError("RECEIPT_TOO_LARGE", "The resolved Skills profile exceeds its size limit.");
  const slugs = new Set<string>();
  for (const selection of profile.selections) {
    validateSelection(selection);
    if (selection.authority !== profile.authority || selection.workspaceId !== profile.workspaceId
      || selection.profileRevision !== profile.profileRevision || slugs.has(selection.slug)) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The resolved profile contains conflicting selection identities.");
    }
    slugs.add(selection.slug);
  }
  const aliasError = selectionAliasError(profile.selections);
  if (aliasError) throw new SkillSelectionError("INVALID_SELECTION_ALIASES", aliasError);
}
export function selectionBundlePath(selection: ResolvedSkillSelection, options: SelectionCacheOptions = {}): string {
  validateSelection(selection);
  return join(selectionCacheRoot(options), "objects", hash(selection.authority), hash(selection.workspaceId), `${selection.bundleDigest.slice(7)}.tar.gz`);
}

/** Reject symlinks throughout the path, including a user-supplied cache root. */
function assertRegularPath(path: string, createParents = false): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  const segments = absolute.slice(root.length).split("/");
  for (let index = 0; index < segments.length; index++) {
    cursor = join(cursor, segments[index]!);
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
        throw new SkillSelectionError("UNSAFE_CACHE_PATH", "Skills cache paths must not traverse symlinks or non-directories.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (createParents && index < segments.length - 1) mkdirSync(cursor, { mode: 0o700 });
    }
  }
}
function readRegularFile(path: string, limit: number): Uint8Array | null {
  assertRegularPath(path);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new SkillSelectionError("INVALID_CACHE_FILE", "The Skills cache contains an invalid or oversized file.");
    // Bound the actual read too: a growing file must not bypass the stat limit.
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > stat.size) throw new SkillSelectionError("INVALID_CACHE_FILE", "The Skills cache file grew during its bounded read.");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
export function writeSelectionJson(path: string, value: unknown): void {
  // Compact encoding keeps the admitted profile plus its reserved session
  // envelope within one bound. Existing pretty-printed receipts still read.
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_PROFILE_DOCUMENT_BYTES) throw new SkillSelectionError("RECEIPT_TOO_LARGE", "The Skills selection receipt exceeds its size limit.");
  atomicWrite(path, bytes, 0o600);
}
function atomicWrite(path: string, bytes: Uint8Array, mode: number, durable = false): void {
  assertRegularPath(path, true);
  const temporary = join(dirname(path), `.selection-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try { writeFileSync(fd, bytes); if (durable) fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    if (durable) syncDirectory(dirname(path));
  } finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
export function readSelectionJson<T>(path: string): T | null {
  const bytes = readRegularFile(path, MAX_PROFILE_DOCUMENT_BYTES);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
  catch { throw new SkillSelectionError("INVALID_RECEIPT", "The Skills selection receipt is unreadable; sync the profile again."); }
}

async function verifiedEntries(selection: ResolvedSkillSelection, bytes: Uint8Array): Promise<SkillBundleEntry[]> {
  if (`sha256:${sha256Hex(bytes)}` !== selection.bundleDigest) throw new SkillSelectionError("BUNDLE_DIGEST_MISMATCH", "The skill bundle does not match its selected digest.");
  const bundle = await inspectSkillBundle(bytes);
  // Executable versions can ship README.md/CLAUDE.md, or only runtime files.
  // Cache validity is archive safety and exact identity; document reads decide
  // which documentation is available without executing the package.
  return bundle.entries;
}
export async function readCachedSelection(selection: ResolvedSkillSelection, options: SelectionCacheOptions = {}): Promise<SkillBundleEntry[] | null> {
  const bytes = readRegularFile(selectionBundlePath(selection, options), SKILL_BUNDLE_INSPECTION_LIMITS.compressedBytes);
  return bytes ? verifiedEntries(selection, bytes) : null;
}
export async function cacheSelectionBundle(selection: ResolvedSkillSelection, response: Response | null, options: SelectionCacheOptions = {}): Promise<SkillBundleEntry[]> {
  validateSelection(selection);
  if (!response?.ok) throw new SkillSelectionError("BUNDLE_UNAVAILABLE", `The selected skill bundle is unavailable${response ? ` (HTTP ${response.status})` : ""}.`);
  const declared = response.headers.get("X-Skill-Bundle-Sha256");
  const version = response.headers.get("X-Skill-Version");
  if ((declared && `sha256:${declared}` !== selection.bundleDigest) || (version && version !== selection.version)) {
    await response.body?.cancel();
    throw new SkillSelectionError("BUNDLE_IDENTITY_MISMATCH", "The returned bundle does not match the selected version and digest.");
  }
  const maximum = SKILL_BUNDLE_INSPECTION_LIMITS.compressedBytes;
  const reader = response.body?.getReader();
  if (!reader) throw new SkillSelectionError("BUNDLE_UNAVAILABLE", "The selected bundle response has no body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) throw new SkillSelectionError("BUNDLE_TOO_LARGE", "The selected bundle exceeds the cache size limit.");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const entries = await verifiedEntries(selection, bytes);
  const path = selectionBundlePath(selection, options);
  const existing = readRegularFile(path, maximum);
  if (existing) await verifiedEntries(selection, existing);
  else atomicWrite(path, bytes, 0o400);
  return entries;
}

function profilePath(profileId: string, options: SelectionCacheOptions): string {
  return join(selectionCacheRoot(options), "profiles", `${hash(profileId)}.json`);
}
export function activateSelectionProfile(profile: ResolvedSkillProfile, options: SelectionCacheOptions = {}): CachedSelectionProfile {
  validateResolvedProfile(profile);
  const receipt: CachedSelectionProfile = { schemaVersion: 1, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile };
  writeSelectionJson(profilePath(profile.profileId, options), receipt);
  return receipt;
}
export function readSelectionProfile(profileId: string, options: SelectionCacheOptions = {}): CachedSelectionProfile | null {
  const receipt = readSelectionJson<CachedSelectionProfile>(profilePath(profileId, options));
  if (receipt) validateSelectionReceipt(receipt);
  return receipt;
}
export function validateSelectionReceipt(receipt: CachedSelectionProfile): void {
  if (!receipt || receipt.schemaVersion !== 1 || !Number.isFinite(Date.parse(receipt.verifiedAt))) throw new SkillSelectionError("INVALID_RECEIPT", "The Skills selection receipt is invalid.");
  validateResolvedProfile(receipt.profile);
}
export function assertFreshCachedProfile(receipt: CachedSelectionProfile, options: SelectionCacheOptions & { maxAgeMs?: number } = {}): void {
  validateSelectionReceipt(receipt);
  const age = (options.now ?? Date.now)() - Date.parse(receipt.verifiedAt);
  const maximum = options.maxAgeMs ?? MAX_CACHED_PROFILE_AGE_MS;
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > MAX_CACHED_PROFILE_AGE_MS) throw new SkillSelectionError("INVALID_CONTEXT_BUDGET", "The cached profile maximum age must be positive and within the supported bound.");
  if (!Number.isFinite(age) || age < 0) throw new SkillSelectionError("INVALID_RECEIPT", "The cached profile verification timestamp is invalid or in the future.");
  if (age > maximum) {
    throw new SkillSelectionError("CACHED_PROFILE_EXPIRED", "The cached Skills profile has expired; authenticate and sync it again.");
  }
}
export function projectSelectionLockPath(projectDir: string): string { return join(resolve(projectDir), ".skills", SELECTION_LOCK_FILE); }
export function readProjectSelection(projectDir: string): CachedSelectionProfile | null {
  const receipt = readSelectionJson<CachedSelectionProfile>(projectSelectionLockPath(projectDir));
  if (receipt) validateSelectionReceipt(receipt);
  return receipt;
}
export function sessionReceiptPath(sessionId: string, options: SelectionCacheOptions = {}): string {
  if (!sessionId.trim() || sessionId.length > MAX_SKILL_SESSION_ID_CHARS) throw new SkillSelectionError("INVALID_SESSION", `A Skills session id must contain 1–${MAX_SKILL_SESSION_ID_CHARS} characters.`);
  return join(selectionCacheRoot(options), "sessions", `${hash(sessionId)}.json`);
}
export function readSkillSession(sessionId: string, options: SelectionCacheOptions = {}): SkillSessionReceipt | null {
  return readSkillSessionSnapshotIfExists(sessionId, options)?.receipt ?? null;
}
function skillSessionGeneration(receipt: SkillSessionReceipt): number { return receipt.generation ?? 0; }
function validateSkillSessionBinding(binding: SkillSessionParentBinding): void {
  if (!binding || typeof binding.sessionId !== "string" || !binding.sessionId.trim() || binding.sessionId.length > MAX_SKILL_SESSION_ID_CHARS
      || !Number.isSafeInteger(binding.generation) || binding.generation < 0 || !/^[a-f0-9]{64}$/.test(binding.receiptSha256)) {
    throw new SkillSelectionError("INVALID_RECEIPT", "The Skills session receipt contains an invalid parent snapshot binding.");
  }
}
function validateSkillSessionReceipt(receipt: SkillSessionReceipt, sessionId: string): void {
  validateSelectionReceipt(receipt);
  const keys = new Set(receipt.profile.selections.map(selectionKey));
  if (receipt.sessionId !== sessionId || !Array.isArray(receipt.loaded) || receipt.loaded.length > keys.size
      || new Set(receipt.loaded).size !== receipt.loaded.length || !receipt.loaded.every(key => keys.has(key))
      || (receipt.generation !== undefined && (!Number.isSafeInteger(receipt.generation) || receipt.generation < 1))) {
    throw new SkillSelectionError("INVALID_RECEIPT", "The Skills session receipt is invalid.");
  }
  if (receipt.parent) {
    validateSkillSessionBinding(receipt.parent);
    if (receipt.parent.sessionId === sessionId) throw new SkillSelectionError("INVALID_RECEIPT", "A Skills child session cannot name itself as its parent.");
  }
}

export function readSkillSessionSnapshotIfExists(sessionId: string, options: SelectionCacheOptions = {}): SkillSessionSnapshot | null {
  const path = sessionReceiptPath(sessionId, options), bytes = readRegularFile(path, MAX_PROFILE_DOCUMENT_BYTES);
  if (!bytes) return null;
  let receipt: SkillSessionReceipt;
  try { receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new SkillSelectionError("INVALID_RECEIPT", "The Skills session receipt is unreadable."); }
  validateSkillSessionReceipt(receipt, sessionId);
  const sha256 = sha256Hex(bytes);
  return { path, bytes, receipt, sha256, sessionId, generation: skillSessionGeneration(receipt), receiptSha256: sha256 };
}
export function readSkillSessionSnapshot(sessionId: string, options: SelectionCacheOptions = {}): SkillSessionSnapshot {
  const snapshot = readSkillSessionSnapshotIfExists(sessionId, options);
  if (!snapshot) throw new SkillSelectionError("SESSION_NOT_FOUND", "The requested Skills session receipt does not exist.");
  return snapshot;
}
export function skillSessionSnapshotBinding(snapshot: SkillSessionSnapshot): SkillSessionParentBinding {
  return { sessionId: snapshot.sessionId, generation: snapshot.generation, receiptSha256: snapshot.receiptSha256 };
}

interface OwnedSessionLock { path: string; fd: number; dev: number; ino: number }
interface SessionLockMarker {
  schemaVersion: 1 | 2; operationId: string; sessionId: string; pid: number;
  host?: string; bootId?: string; pidNamespace?: string; processStart?: string;
}
interface SessionLockSnapshot {
  path: string; bytes: Uint8Array; marker: SessionLockMarker; sha256: string;
  dev: number; ino: number; mtimeMs: number;
}
const SESSION_LOCK_MAX_BYTES = 4096;
const SESSION_LOCK_MIN_AGE_MS = 30_000;

function localBootId(): string | null {
  try {
    if (process.platform === "linux") {
      const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return /^[a-f0-9-]{36}$/i.test(value) ? value : null;
    }
    if (process.platform === "darwin") {
      const result = spawnSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 3000, env: { LC_ALL: "C" } });
      if (result.status !== 0 || result.error) return null;
      const seconds = /\bsec\s*=\s*(\d+)\b/.exec(result.stdout)?.[1];
      return seconds ? `darwin:${seconds}` : null;
    }
  } catch { /* Unknown host identity must fail closed. */ }
  return null;
}

function processStart(pid: number): { state: "alive"; start: string } | { state: "absent" | "unknown" } {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "unknown" };
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const start = close < 0 ? undefined : stat.slice(close + 2).trim().split(/\s+/)[19];
      return start && /^\d+$/.test(start) ? { state: "alive", start: `linux:${start}` } : { state: "unknown" };
    } catch (error) { return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown" }; }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 3000, env: { LC_ALL: "C" } });
    if (result.error || result.signal) return { state: "unknown" };
    const start = result.stdout.trim();
    if (result.status === 1 && !start && !result.stderr.trim()) return { state: "absent" };
    return result.status === 0 && start ? { state: "alive", start: `darwin:${start}` } : { state: "unknown" };
  }
  return { state: "unknown" };
}

function localLockIdentity(): Pick<SessionLockMarker, "host" | "bootId" | "pidNamespace" | "processStart"> | null {
  const bootId = localBootId(), owner = processStart(process.pid);
  if (!bootId || owner.state !== "alive") return null;
  let pidNamespace: string | undefined;
  if (process.platform === "linux") {
    try { pidNamespace = readlinkSync("/proc/self/ns/pid"); }
    catch { return null; }
    if (!/^pid:\[\d+\]$/.test(pidNamespace)) return null;
  }
  return { host: hostname(), bootId, pidNamespace, processStart: owner.start };
}

function readSessionLock(sessionId: string, options: SelectionCacheOptions): SessionLockSnapshot | null {
  const path = `${sessionReceiptPath(sessionId, options)}.write-lock`;
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (!before) return null;
  if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || (process.getuid && before.uid !== process.getuid())) {
    throw new SkillSelectionError("SESSION_WRITE_LOCKED", "The session lock is not a private regular file; recovery requires review.");
  }
  const bytes = readRegularFile(path, SESSION_LOCK_MAX_BYTES);
  const after = lstatSync(path, { throwIfNoEntry: false });
  if (!bytes || !after?.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode || before.uid !== after.uid || before.gid !== after.gid || before.nlink !== after.nlink) {
    throw new SkillSelectionError("SESSION_WRITE_LOCKED", "The session lock changed during inspection; recovery requires review.");
  }
  let marker: SessionLockMarker;
  try { marker = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new SkillSelectionError("SESSION_WRITE_LOCKED", "The session lock is unreadable; recovery requires review."); }
  if (!marker || ![1, 2].includes(marker.schemaVersion) || marker.sessionId !== sessionId
      || !/^[a-f0-9-]{36}$/i.test(marker.operationId) || !Number.isSafeInteger(marker.pid) || marker.pid <= 0
      || (marker.schemaVersion === 2 && (!marker.host || !marker.bootId || !marker.processStart
        || (process.platform === "linux" && !marker.pidNamespace)))) {
    throw new SkillSelectionError("SESSION_WRITE_LOCKED", "The session lock has invalid ownership metadata; recovery requires review.");
  }
  return { path, bytes, marker, sha256: sha256Hex(bytes), dev: after.dev, ino: after.ino, mtimeMs: after.mtimeMs };
}

function writerIsGone(lock: SessionLockSnapshot, explicitLocalHost: boolean): boolean {
  if (Date.now() - lock.mtimeMs < SESSION_LOCK_MIN_AGE_MS) return false;
  const owner = processStart(lock.marker.pid);
  if (owner.state === "unknown") return false;
  if (lock.marker.schemaVersion === 1) return explicitLocalHost && owner.state === "absent";
  const local = localLockIdentity();
  if (!local || lock.marker.host !== local.host || lock.marker.bootId !== local.bootId
      || lock.marker.pidNamespace !== local.pidNamespace) return false;
  return owner.state === "absent" || (owner.state === "alive" && owner.start !== lock.marker.processStart);
}

function lockReviewDigest(lock: SessionLockSnapshot, receipt: SkillSessionSnapshot | null): string {
  return hash({ sessionId: lock.marker.sessionId, lockSha256: lock.sha256, lockDev: lock.dev,
    lockIno: lock.ino, lockMtimeMs: lock.mtimeMs, receiptSha256: receipt?.sha256 ?? null, receiptGeneration: receipt?.generation ?? null });
}

export function inspectSessionWriteLock(sessionId: string, options: SelectionCacheOptions = {}) {
  const receipt = readSkillSessionSnapshotIfExists(sessionId, options), lock = readSessionLock(sessionId, options);
  if (!lock) throw new SkillSelectionError("SESSION_WRITE_LOCK_NOT_FOUND", "The session has no write lock to recover.");
  return { sessionId, schemaVersion: lock.marker.schemaVersion, pid: lock.marker.pid,
    lockSha256: lock.sha256, lockMtime: new Date(lock.mtimeMs).toISOString(),
    receiptSha256: receipt?.sha256 ?? null, receiptGeneration: receipt?.generation ?? null,
    reviewDigest: lockReviewDigest(lock, receipt), hostBound: lock.marker.schemaVersion === 2 };
}

function archiveSessionLock(lock: SessionLockSnapshot, receipt: SkillSessionSnapshot | null, explicitLocalHost: boolean): string | null {
  const guardPath = `${lock.path}.recovery-guard`;
  let guardFd: number;
  try { guardFd = openSync(guardPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return null; throw error; }
  const guardStat = fstatSync(guardFd);
  try {
    writeFileSync(guardFd, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, operationId: randomUUID() })}\n`);
    fsyncSync(guardFd);
    const cacheOptions = { cacheDir: dirname(dirname(lock.path)) };
    const current = readSessionLock(lock.marker.sessionId, cacheOptions);
    if (!current || current.dev !== lock.dev || current.ino !== lock.ino || current.sha256 !== lock.sha256
        || current.mtimeMs !== lock.mtimeMs || !writerIsGone(current, explicitLocalHost)) return null;
    const currentReceipt = readSkillSessionSnapshotIfExists(lock.marker.sessionId, cacheOptions);
    if (currentReceipt?.sha256 !== receipt?.sha256 || currentReceipt?.generation !== receipt?.generation) return null;
    const directory = join(dirname(dirname(lock.path)), "session-lock-recoveries", randomUUID());
    const archivePath = join(directory, "original.write-lock");
    const recordPath = join(directory, "recovery.json");
    assertRegularPath(archivePath, true);
    archiveBytes(recordPath, Buffer.from(`${JSON.stringify({ schemaVersion: 1, sessionId: lock.marker.sessionId,
      originalPath: lock.path, lockSha256: lock.sha256, lockMtime: new Date(lock.mtimeMs).toISOString(),
      lockPid: lock.marker.pid, receiptSha256: receipt?.sha256 ?? null, receiptGeneration: receipt?.generation ?? null,
      status: "prepared" })}\n`));
    syncDirectory(directory); syncDirectory(dirname(directory));
    const finalLock = readSessionLock(lock.marker.sessionId, cacheOptions);
    if (!finalLock || finalLock.dev !== lock.dev || finalLock.ino !== lock.ino || finalLock.sha256 !== lock.sha256
        || readSkillSessionSnapshotIfExists(lock.marker.sessionId, cacheOptions)?.sha256 !== receipt?.sha256) return null;
    let moved = false;
    try {
      renameSync(lock.path, archivePath);
      moved = true;
      syncDirectory(directory); syncDirectory(dirname(lock.path));
      if (sha256Hex(readRegularFile(archivePath, SESSION_LOCK_MAX_BYTES)!) !== lock.sha256) {
        throw new Error("Archived lock bytes changed");
      }
    } catch (error) {
      if (moved) throw new SkillSelectionError("SESSION_LOCK_RECOVERY_INCOMPLETE", "The lock moved, but durable recovery could not be confirmed; inspect the preserved recovery directory and session receipt.");
      throw error;
    }
    return archivePath;
  } finally {
    closeSync(guardFd);
    const current = lstatSync(guardPath, { throwIfNoEntry: false });
    if (current?.isFile() && current.dev === guardStat.dev && current.ino === guardStat.ino) unlinkSync(guardPath);
  }
}

export function recoverSessionWriteLock(sessionId: string, reviewDigest: string, options: SelectionCacheOptions = {}): string {
  const receipt = readSkillSessionSnapshotIfExists(sessionId, options), lock = readSessionLock(sessionId, options);
  if (!lock || lockReviewDigest(lock, receipt) !== reviewDigest) {
    throw new SkillSelectionError("SESSION_LOCK_REVIEW_CHANGED", "The lock or receipt changed after review; inspect the session lock again.");
  }
  const archivePath = archiveSessionLock(lock, receipt, true);
  if (!archivePath) throw new SkillSelectionError("SESSION_WRITE_LOCKED", "The lock is live, too recent, or changed during recovery; leave it in place and inspect again.");
  return archivePath;
}
function withSessionWriteLocks<T>(sessionIds: string[], options: SelectionCacheOptions, action: (assertOwned: () => void) => T): T {
  const operationId = randomUUID();
  const locks = [...new Set(sessionIds)].map(sessionId => ({ sessionId, path: `${sessionReceiptPath(sessionId, options)}.write-lock` }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const owned: OwnedSessionLock[] = [];
  const assertOwned = () => {
    for (const lock of owned) {
      const current = lstatSync(lock.path, { throwIfNoEntry: false });
      if (!current?.isFile() || current.dev !== lock.dev || current.ino !== lock.ino) {
        throw new SkillSelectionError("SESSION_WRITE_LOCK_CHANGED", "A session write lock changed during the operation; no replacement is permitted.");
      }
    }
  };
  try {
    for (const lock of locks) {
      assertRegularPath(lock.path, true);
      let fd: number;
      try { fd = openSync(lock.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const stale = readSessionLock(lock.sessionId, options);
          const receipt = stale && readSkillSessionSnapshotIfExists(lock.sessionId, options);
          if (stale?.marker.schemaVersion === 2 && writerIsGone(stale, false)) {
            archiveSessionLock(stale, receipt, false);
          }
        } catch (recoveryError) {
          // A failed or ambiguous recovery never grants permission to replace the lock.
          if (recoveryError instanceof SkillSelectionError && recoveryError.code === "SESSION_LOCK_RECOVERY_INCOMPLETE") throw recoveryError;
        }
        try { fd = openSync(lock.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
        catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
            // Only a readable, structurally valid lock is a delivery conflict.
            // Symlinks, malformed ownership and changing markers remain hard.
            if (!readSessionLock(lock.sessionId, options)) throw new SkillSelectionError("SESSION_WRITE_LOCK_CHANGED", "The session lock changed during acquisition.");
            throw new SkillSelectionError("SESSION_WRITE_BUSY", "Another Skills process owns a required session write lock; retry after it completes. A surviving legacy lock requires explicit recovery review.");
          }
          throw retryError;
        }
      }
      const stat = fstatSync(fd);
      owned.push({ path: lock.path, fd, dev: stat.dev, ino: stat.ino });
      const identity = localLockIdentity();
      writeFileSync(fd, `${JSON.stringify({ schemaVersion: identity ? 2 : 1, operationId, sessionId: lock.sessionId, pid: process.pid, ...identity })}\n`);
    }
    return action(assertOwned);
  } finally {
    for (const lock of owned.reverse()) {
      closeSync(lock.fd);
      const current = lstatSync(lock.path, { throwIfNoEntry: false });
      if (current?.isFile() && current.dev === lock.dev && current.ino === lock.ino) unlinkSync(lock.path);
    }
  }
}
function withSessionWriteLock<T>(sessionId: string, options: SelectionCacheOptions, action: (assertOwned: () => void) => T): T {
  return withSessionWriteLocks([sessionId], options, action);
}
function sameSnapshot(actual: SkillSessionSnapshot | null, expected: SkillSessionParentBinding | null): boolean {
  return actual === null ? expected === null : expected !== null && actual.sessionId === expected.sessionId
    && actual.generation === expected.generation && actual.receiptSha256 === expected.receiptSha256;
}
export function nextSkillSessionGeneration(generation: number): number {
  if (!Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) {
    throw new SkillSelectionError("SESSION_GENERATION_EXHAUSTED", "The Skills session generation cannot advance safely; preserve the receipt and review recovery before continuing.");
  }
  return generation + 1;
}
function parentChanged(): never {
  throw new SkillSelectionError("SESSION_PARENT_CHANGED", "The parent Skills session changed while the child was resolving; resolve the child again from the current parent pin.");
}

/** Receipt creation and updates are exact-snapshot CAS operations. Child creation also fences its parent. */
export function writeSkillSession(receipt: SkillSessionReceipt, expected: SkillSessionWritePrecondition, options: SelectionCacheOptions = {}): void {
  validateSkillSessionReceipt(receipt, receipt.sessionId);
  if (expected.parent) validateSkillSessionBinding(expected.parent);
  if (expected.parent?.sessionId === receipt.sessionId) throw new SkillSelectionError("INVALID_RECEIPT", "A Skills child session cannot name itself as its parent.");
  const lockIds = expected.parent ? [receipt.sessionId, expected.parent.sessionId] : [receipt.sessionId];
  withSessionWriteLocks(lockIds, options, assertOwned => {
    const current = readSkillSessionSnapshotIfExists(receipt.sessionId, options);
    if (!sameSnapshot(current, expected.current) || (current && !isDeepStrictEqual(current.receipt.profile, receipt.profile))) {
      throw new SkillSelectionError("SESSION_CONTEXT_CONFLICT", "The Skills session receipt changed while context was loading; resolve context again without replacing the current pin.");
    }
    let parent: SkillSessionSnapshot | null = null;
    if (expected.parent) {
      parent = readSkillSessionSnapshotIfExists(expected.parent.sessionId, options);
      if (!sameSnapshot(parent, expected.parent) || !parent || !isDeepStrictEqual(parent.receipt.profile, receipt.profile)) parentChanged();
    }
    const generation = nextSkillSessionGeneration(current?.generation ?? 0);
    const next: SkillSessionReceipt = current
      ? { ...current.receipt, generation, loaded: [...new Set([...current.receipt.loaded, ...receipt.loaded])] }
      : { ...receipt, generation, ...(expected.parent ? { parent: expected.parent } : {}) };
    assertOwned();
    if (expected.parent) {
      parent = readSkillSessionSnapshotIfExists(expected.parent.sessionId, options);
      if (!sameSnapshot(parent, expected.parent)) parentChanged();
    }
    writeSelectionJson(sessionReceiptPath(receipt.sessionId, options), next);
  });
}

function syncDirectory(path: string): void {
  assertRegularPath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function archiveBytes(path: string, bytes: Uint8Array): void {
  assertRegularPath(path, true);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Preserve both sides before the single atomic replacement; failures retain recovery evidence. */
export function replaceSkillSession(expected: SkillSessionParentBinding, replacement: SkillSessionReceipt, plan: unknown, options: SelectionCacheOptions = {}, beforeCommit: () => void = () => {}) {
  validateSkillSessionReceipt(replacement, replacement.sessionId);
  const bytes = Buffer.from(`${JSON.stringify(replacement)}\n`);
  if (bytes.length > MAX_PROFILE_DOCUMENT_BYTES) throw new SkillSelectionError("RECEIPT_TOO_LARGE", "The Skills selection receipt exceeds its size limit.");
  return withSessionWriteLock(replacement.sessionId, options, assertOwned => {
    const before = readSkillSessionSnapshot(replacement.sessionId, options);
    if (!sameSnapshot(before, expected)) throw new SkillSelectionError("SESSION_RECEIPT_CHANGED", "The Skills session receipt generation or bytes changed after review; inspect it and prepare a new plan.");
    if (replacement.generation !== nextSkillSessionGeneration(before.generation)) throw new SkillSelectionError("SESSION_GENERATION_CHANGED", "The replacement Skills session must advance exactly one generation.");
    if (before.receipt.profile.authority !== replacement.profile.authority || before.receipt.profile.workspaceId !== replacement.profile.workspaceId) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "A session reconciliation cannot change its Skills authority or workspace.");
    }
    const directory = join(selectionCacheRoot(options), "session-reconciliations", randomUUID());
    const archivePath = join(directory, "original.json"), replacementPath = join(directory, "replacement.json"), receiptPath = join(directory, "receipt.json");
    const afterSha256 = sha256Hex(bytes);
    archiveBytes(archivePath, before.bytes);
    archiveBytes(replacementPath, bytes);
    const receipt = { schemaVersion: 1, status: "prepared", sessionId: replacement.sessionId, beforeGeneration: before.generation, afterGeneration: replacement.generation, beforeSha256: before.sha256, afterSha256, archivePath, replacementPath, plan };
    archiveBytes(receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`));
    syncDirectory(directory); syncDirectory(dirname(directory)); syncDirectory(selectionCacheRoot(options));
    if (sha256Hex(readRegularFile(archivePath, MAX_PROFILE_DOCUMENT_BYTES)!) !== before.sha256
        || !sameSnapshot(readSkillSessionSnapshot(replacement.sessionId, options), expected)) {
      throw new SkillSelectionError("SESSION_RECEIPT_CHANGED", "The session or its preservation archive changed before replacement; retained evidence must be reviewed.");
    }
    beforeCommit();
    assertOwned();
    try {
      atomicWrite(before.path, bytes, 0o600, true);
      atomicWrite(receiptPath, Buffer.from(`${JSON.stringify({ ...receipt, status: "applied" })}\n`), 0o600, true);
    } catch {
      throw new SkillSelectionError("SESSION_RECONCILIATION_INCOMPLETE", `Inspect sessions show and the preserved operation receipt at ${receiptPath} before any retry; replacement may already have committed.`);
    }
    return { archivePath, receiptPath, beforeSha256: before.sha256, afterSha256 };
  });
}
