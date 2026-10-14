import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { SkillBundleInspectionError } from "./skill-bundle.js";
import { isValidSkillVersion } from "./skill-version.js";
import { MAX_CACHED_PROFILE_AGE_MS, verifySelectionBundleResponse, nextSkillSessionGeneration, readProjectSelection, readSelectionJson, readSelectionProfile, readSkillSessionSnapshot, readSkillSessionSnapshotIfExists, replaceSkillSession, selectionCacheRoot, selectionKey, skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, withSkillSessionWriteLock, writeSelectionJson, type SelectionCacheOptions, type SkillSessionReceipt, type SkillSessionSnapshot } from "./selection-cache.js";

export interface SessionReconciliationInput {
  sessionId: string;
  fromProfile: string;
  fromRevision: string;
  receiptSha256: string;
  selectionProfile: string;
  profileRevision: string;
  apply?: boolean;
  planDigest?: string;
  planIssuedAt?: string;
  planExpiresAt?: string;
}
export interface SessionReconciliationOptions extends SelectionCacheOptions { client?: ProfileClient }
export const SESSION_RECONCILIATION_PLAN_TTL_MS = 5 * 60 * 1000;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function exactTimestamp(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "The reviewed plan must include its exact canonical issuedAt and expiresAt timestamps.");
  }
  return parsed;
}
function assertPlanWindow(issuedAt: string, expiresAt: string, now: number): void {
  const issued = exactTimestamp(issuedAt), expires = exactTimestamp(expiresAt);
  if (expires - issued !== SESSION_RECONCILIATION_PLAN_TTL_MS) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "A session reconciliation approval is valid for exactly five minutes and cannot be extended by the caller.");
  }
  if (now < issued || now >= expires) {
    throw new SkillSelectionError("SESSION_PLAN_EXPIRED", "The reviewed session reconciliation plan is not currently valid; inspect the receipt and prepare a new plan.");
  }
}

/** Exact bundle identity only; never spread receipt, policy or payload fields. */
export interface SessionSelectionMetadata { slug: string; version: string; bundleDigest: string }
export interface SessionSelectionDelta {
  selection: SessionSelectionMetadata;
  loaded: boolean;
  outcome: "retained" | "retired" | "unloaded";
  reason: "same-bundle" | "selection-removed" | "bundle-changed";
  replacement?: SessionSelectionMetadata;
}
function selectionMetadata(selection: ResolvedSkillSelection): SessionSelectionMetadata {
  return { slug: selection.slug, version: selection.version, bundleDigest: selection.bundleDigest };
}

/** Metadata only: inspection never displays skill payloads or resolves credentials. */
export function inspectSkillSession(sessionId: string, options: SelectionCacheOptions = {}) {
  const snapshot = readSkillSessionSnapshot(sessionId, options), { receipt } = snapshot;
  const loaded = new Set(receipt.loaded);
  return {
    sessionId, path: snapshot.path, receiptSha256: snapshot.sha256, generation: snapshot.generation, verifiedAt: receipt.verifiedAt,
    authority: receipt.profile.authority, workspaceId: receipt.profile.workspaceId,
    profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision,
    selectionCount: receipt.profile.selections.length, loadedCount: receipt.loaded.length,
    selections: receipt.profile.selections.map(selection => ({ ...selectionMetadata(selection), loaded: loaded.has(selectionKey(selection)) })),
  };
}

/** Fits inside the managed context child's 6.5-second ceiling, including CLI work. */
export const SESSION_RENEWAL_TIMEOUT_MS = 4_000;
/**
 * Only a real deadline or abort signal of the renewal reports the spent
 * budget: an AbortError or TimeoutError, a bundle inspection timeout or abort,
 * or SKILLS_API_UNAVAILABLE whose cause is an aborted or timed-out request.
 * An authority that answered (HTTP 429/5xx), invalid data and programming
 * errors keep their own codes even after the deadline.
 */
function renewalDeadlineSignal(error: unknown): boolean {
  if (error instanceof SkillSelectionError) return error.code === "SKILLS_API_UNAVAILABLE" && error.cause !== undefined && renewalDeadlineSignal(error.cause);
  if (error instanceof SkillBundleInspectionError) return error.code === "BUNDLE_TIMEOUT" || error.code === "BUNDLE_ABORTED";
  const name = (error as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
const SESSION_RENEWAL_CONCURRENCY = 4;

/**
 * A definitive automatic renewal refusal is remembered briefly so the managed
 * hook does not resolve the whole profile again on every prompt. The record
 * only ever repeats that refusal: it never authorizes, renews or writes a pin.
 * It binds the exact receipt bytes, profile, authority, workspace and the
 * locally synced profile revision, and lapses after a fixed window that the
 * file cannot extend. Anything unexpected is ignored and the authority is asked.
 *
 * Two kinds exist. A renewal refusal says only that this pin cannot be renewed
 * as it is, so it is repeated only while migration is off. A refusal of the
 * managed hook's migration itself (a project lock, a rotated epoch, a planner
 * refusal or anything else that is not transient) also implies the renewal
 * refusal, so it is repeated in either mode. Timeouts, an unavailable
 * authority, write-lock contention and other transient failures are never
 * remembered.
 */
export const SESSION_RENEWAL_REFUSAL_TTL_MS = 5 * 60 * 1000;
/** A refusal record is about 600 bytes; anything larger is ignored unread. */
const SESSION_RENEWAL_REFUSAL_MAX_BYTES = 4 * 1024;
const RENEWAL_REFUSAL = "managed-hook-renewal-refusal", MIGRATION_REFUSAL = "managed-hook-migration-refusal";
type SessionRenewalRefusalKind = typeof RENEWAL_REFUSAL | typeof MIGRATION_REFUSAL;
interface SessionRenewalRefusal {
  schemaVersion: 1; kind: SessionRenewalRefusalKind; code: "SESSION_RECONCILIATION_REQUIRED";
  sessionId: string; receiptSha256: string; profileId: string; authority: string; workspaceId: string;
  refusedRevision: string; localProfileRevision: string | null; recordedAt: string; expiresAt: string;
}
const REFUSAL_KEYS = ["authority", "code", "expiresAt", "kind", "localProfileRevision", "profileId", "receiptSha256", "recordedAt", "refusedRevision", "schemaVersion", "sessionId", "workspaceId"];
function renewalRefusalPath(sessionId: string, options: SelectionCacheOptions): string {
  return join(selectionCacheRoot(options), "session-renewal-refusals", `${digest(sessionId)}.json`);
}
/** `undefined` means the synced revision cannot be read, so no refusal record applies. */
function localProfileRevision(profileId: string, options: SelectionCacheOptions): string | null | undefined {
  try { return readSelectionProfile(profileId, options)?.profile.profileRevision ?? null; } catch { return undefined; }
}
function currentRenewalRefusal(snapshot: SkillSessionSnapshot, profileId: string, localRevision: string | null | undefined, now: number, options: SelectionCacheOptions, kinds: readonly SessionRenewalRefusalKind[]): SessionRenewalRefusal | null {
  if (localRevision === undefined) return null;
  let value: SessionRenewalRefusal | null;
  try { value = readSelectionJson<SessionRenewalRefusal>(renewalRefusalPath(snapshot.sessionId, options), SESSION_RENEWAL_REFUSAL_MAX_BYTES); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== REFUSAL_KEYS.join(",")
    || value.schemaVersion !== 1 || !kinds.includes(value.kind) || value.code !== "SESSION_RECONCILIATION_REQUIRED"
    || typeof value.refusedRevision !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.refusedRevision)
    || typeof value.recordedAt !== "string" || typeof value.expiresAt !== "string") return null;
  const recorded = Date.parse(value.recordedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(recorded) || new Date(recorded).toISOString() !== value.recordedAt || expires - recorded !== SESSION_RENEWAL_REFUSAL_TTL_MS
    || new Date(expires).toISOString() !== value.expiresAt || now < recorded || now >= expires) return null;
  const pinned = snapshot.receipt.profile;
  if (value.sessionId !== snapshot.sessionId || value.receiptSha256 !== snapshot.sha256 || value.profileId !== profileId
    || value.authority !== pinned.authority || value.workspaceId !== pinned.workspaceId || value.localProfileRevision !== localRevision) return null;
  return value;
}
function recordRenewalRefusal(snapshot: SkillSessionSnapshot, profileId: string, refusedRevision: string, localRevision: string | null | undefined, now: number, options: SelectionCacheOptions, kind: SessionRenewalRefusalKind): void {
  if (localRevision === undefined) return;
  const pinned = snapshot.receipt.profile;
  const record: SessionRenewalRefusal = {
    schemaVersion: 1, kind, code: "SESSION_RECONCILIATION_REQUIRED",
    sessionId: snapshot.sessionId, receiptSha256: snapshot.sha256, profileId, authority: pinned.authority, workspaceId: pinned.workspaceId,
    refusedRevision, localProfileRevision: localRevision,
    recordedAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_RENEWAL_REFUSAL_TTL_MS).toISOString(),
  };
  // Best effort: failing to remember a refusal only costs another authority read.
  try { writeSelectionJson(renewalRefusalPath(snapshot.sessionId, options), record); } catch { /* the refusal itself still propagates */ }
}

/**
 * A managed-hook migration that retired loaded skills leaves one notice for the
 * session, delivered with the next successful context and then marked
 * delivered. Only the writer that commits the pin publishes it: it is written
 * under the session write lock, after the exact receipt precondition held and
 * immediately before the pin itself, so a concurrent migrator that loses that
 * precondition never touches it. Delivery marks it under the same lock. It
 * applies only once the pin really holds the migrated profile, revision and
 * generation, so a failed commit or a later intentional change never shows it.
 * It carries metadata only; it authorizes nothing and is ignored unless every
 * field is exact.
 */
const MIGRATION_NOTICE_MAX_BYTES = 32 * 1024;
const MIGRATION_NOTICE_MAX_ENTRIES = 50;
const MIGRATION_NOTICE_SHOWN_ENTRIES = 20;
const NOTICE_KEYS = ["authority", "fromRevision", "generation", "kind", "profileId", "recordedAt", "retired", "retiredCount", "schemaVersion", "sessionId", "toRevision", "workspaceId"];
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NOTICE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
interface SessionPinMigrationNoticeEntry { slug: string; version: string; replacementVersion?: string }
interface SessionPinMigrationNoticeRecord {
  schemaVersion: 1; kind: "session-pin-migration-notice"; sessionId: string;
  profileId: string; authority: string; workspaceId: string; fromRevision: string; toRevision: string; generation: number;
  retiredCount: number; retired: SessionPinMigrationNoticeEntry[]; recordedAt: string; deliveredAt?: string;
}
function migrationNoticePath(sessionId: string, options: SelectionCacheOptions): string {
  return join(selectionCacheRoot(options), "session-pin-migration-notices", `${digest(sessionId)}.json`);
}
/** Build and bound the notice before any write; publication happens at the commit. */
function sessionPinMigrationNotice(snapshot: SkillSessionSnapshot, target: ResolvedSkillProfile, generation: number, retired: SessionSelectionDelta[], now: number): SessionPinMigrationNoticeRecord {
  const record: SessionPinMigrationNoticeRecord = {
    schemaVersion: 1, kind: "session-pin-migration-notice", sessionId: snapshot.sessionId,
    profileId: target.profileId, authority: target.authority, workspaceId: target.workspaceId,
    fromRevision: snapshot.receipt.profile.profileRevision, toRevision: target.profileRevision, generation,
    retiredCount: retired.length,
    retired: retired.slice(0, MIGRATION_NOTICE_MAX_ENTRIES).map(row => ({ slug: row.selection.slug, version: row.selection.version,
      ...(row.replacement ? { replacementVersion: row.replacement.version } : {}) })),
    recordedAt: new Date(now).toISOString(),
  };
  // A notice its reader would ignore must not stand in for telling the session.
  if (Buffer.byteLength(`${JSON.stringify(record)}\n`) > MIGRATION_NOTICE_MAX_BYTES || !validNotice(record, snapshot.sessionId)) {
    throw new SkillSelectionError("RECEIPT_TOO_LARGE", "The session pin migration notice exceeds its bounds.");
  }
  return record;
}
function validNoticeEntry(entry: unknown): entry is SessionPinMigrationNoticeEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const value = entry as Record<string, unknown>, keys = Object.keys(value).sort().join(",");
  return (keys === "slug,version" || keys === "replacementVersion,slug,version")
    && typeof value.slug === "string" && value.slug.length <= 128 && NOTICE_SLUG.test(value.slug)
    && isValidSkillVersion(value.version) && (value.replacementVersion === undefined || isValidSkillVersion(value.replacementVersion));
}
function validNotice(value: unknown, sessionId: string): value is SessionPinMigrationNoticeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => key !== "deliveredAt").sort().join(",");
  const timestamp = (stamp: unknown) => typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) && new Date(Date.parse(stamp)).toISOString() === stamp;
  return keys === NOTICE_KEYS.join(",") && record.schemaVersion === 1 && record.kind === "session-pin-migration-notice" && record.sessionId === sessionId
    && [record.profileId, record.authority, record.workspaceId, record.fromRevision, record.toRevision].every(field => typeof field === "string" && field.length > 0)
    && Number.isSafeInteger(record.generation) && (record.generation as number) > 0 && timestamp(record.recordedAt)
    && (record.deliveredAt === undefined || timestamp(record.deliveredAt))
    && Array.isArray(record.retired) && record.retired.length > 0 && record.retired.length <= MIGRATION_NOTICE_MAX_ENTRIES && record.retired.every(validNoticeEntry)
    && Number.isSafeInteger(record.retiredCount) && (record.retiredCount as number) >= record.retired.length;
}
function renderSessionPinMigrationNotice(record: SessionPinMigrationNoticeRecord): string {
  const profile = SAFE_LABEL.test(record.profileId) ? record.profileId : undefined;
  const revision = SAFE_LABEL.test(record.toRevision) ? ` (revision ${record.toRevision})` : "";
  const shown = record.retired.slice(0, MIGRATION_NOTICE_SHOWN_ENTRIES);
  const more = record.retiredCount - shown.length;
  return [
    `Skills: this session's pin was migrated to the current ${profile ? `${profile} ` : ""}profile${revision} because loaded skills changed or were removed. Their earlier instructions are retired; do not rely on them:`,
    ...shown.map(entry => entry.replacementVersion === undefined
      ? `- ${entry.slug}@${entry.version}: no longer selected.`
      : `- ${entry.slug}@${entry.version}: now ${entry.replacementVersion}${entry.replacementVersion === entry.version ? " with changed content" : ""}; reload with skills load ${entry.slug}@${entry.replacementVersion}${profile ? ` --selection-profile ${profile}` : ""} if it is still needed.`),
    ...(more > 0 ? [`- ${more} more retired loaded skill(s), listed in this session's reconciliation receipt.`] : []),
  ].join("\n");
}

/**
 * Return the pending migration notice for this session once its pin holds the
 * migrated profile, then mark it delivered. Anything unexpected returns null.
 */
export function takeSessionPinMigrationNotice(sessionId: string, options: SelectionCacheOptions = {}): string | null {
  const path = migrationNoticePath(sessionId, options);
  const pending = (): SessionPinMigrationNoticeRecord | null => {
    const record = readSelectionJson<unknown>(path, MIGRATION_NOTICE_MAX_BYTES);
    return validNotice(record, sessionId) && record.deliveredAt === undefined ? record : null;
  };
  // Most prompts have nothing pending and take no lock.
  try { if (!pending()) return null; } catch { return null; }
  try {
    // Publication holds the same lock, so marking this notice delivered can
    // never overwrite one a later migration has just committed. A busy lock
    // leaves the notice pending for a later prompt.
    return withSkillSessionWriteLock(sessionId, options, assertOwned => {
      const record = pending();
      if (!record) return null;
      const current = readSkillSessionSnapshotIfExists(sessionId, options);
      const pin = current?.receipt.profile;
      if (!current || !pin || pin.profileId !== record.profileId || pin.authority !== record.authority || pin.workspaceId !== record.workspaceId
        || pin.profileRevision !== record.toRevision || current.generation < record.generation) return null;
      assertOwned();
      // Best effort: a failed marker only repeats this notice on a later prompt.
      try { writeSelectionJson(path, { ...record, deliveredAt: new Date((options.now ?? Date.now)()).toISOString() }); } catch { /* still delivered now */ }
      return renderSessionPinMigrationNotice(record);
    });
  } catch { return null; }
}

/**
 * Renew authorization for the complete immutable pin; never manufacture a
 * profile combining historical loaded versions with current unloaded versions.
 * Current profile membership/lifecycle authorizes unchanged pins. Historical
 * versions additionally require the authenticated exact-version bundle read.
 */
export async function reconcileSkillSessionIfSafe(sessionId: string, profileId: string, options: SessionReconciliationOptions = {}): Promise<boolean> {
  return (await renewSkillSessionPin(sessionId, profileId, { ...options, migrate: false })).outcome !== "unchanged";
}

/** Metadata only: what an automatic migration retired, never payloads. */
export interface SessionPinMigration {
  profileId: string; fromRevision: string; toRevision: string;
  retainedLoadedCount: number; retiredLoadedCount: number;
  retired: SessionSelectionDelta[];
  archivePath: string; receiptPath: string;
}
export type SessionPinRenewalOutcome =
  | { outcome: "unchanged" }
  | { outcome: "renewed" }
  | { outcome: "migrated"; migration: SessionPinMigration };
export interface SessionPinRenewalOptions extends SessionReconciliationOptions {
  /**
   * Managed hooks only: when renewal is refused because the same profile moved
   * on, apply the explicit reconciliation plan to the authenticated current
   * revision instead. Every other failure keeps its existing refusal.
   */
  migrate?: boolean;
  /**
   * Required for `migrate`: the prompt's directory (the hook input's cwd).
   * Without it, or while it or an ancestor holds a project lock, migration
   * does not run.
   */
  projectDir?: string;
}

/**
 * A project lock (`.skills/selection.lock.json`, written by `skills pin`,
 * `skills install --project` and `skills sync --project`) is an intentional
 * pin that keeps exact versions until it is explicitly changed, and sessions
 * started in that project inherit it. Automatic migration never moves such a
 * pin, so this keeps today's refusal when:
 * - the session recorded at creation that its pin came from a lock (its child
 *   sessions inherit that record), whatever the prompt's directory now is; or
 * - for any session without that record, including those created before it
 *   existed, a lock is present in the prompt's directory or any ancestor up to
 *   the filesystem root, or one of them cannot be read. Receipts never stored a
 *   creation directory, so a nearby lock is the remaining sign; or
 * - the prompt's directory is not named.
 * Only a confirmed absence lets migration run, and it is confirmed three times:
 * before the authority read, after it, and under the session write lock
 * immediately before the pin is written. A lock for another profile at the
 * prompt's directory is already refused earlier as PROFILE_LOCK_MISMATCH.
 */
function pinFollowsProjectLock(receipt: SkillSessionReceipt, projectDir: string | undefined): boolean {
  if (Object.hasOwn(receipt, "projectLock") || projectDir === undefined) return true;
  try {
    for (let directory = resolve(projectDir); ; directory = dirname(directory)) {
      if (readProjectSelection(directory) !== null) return true;
      if (dirname(directory) === directory) return false;
    }
  } catch { return true; }
}

/**
 * A known lifecycle epoch is never revived silently. Deletion and archive
 * rotate it, and renewal refuses the rotation even when the restored bytes
 * match. The planner keys retention on exact bundle identity, so such a loaded
 * selection would be retained without telling the session; it keeps the
 * refusal for explicit `skills sessions reconcile` instead.
 */
function retainsRotatedLoadedEpoch(old: SkillSessionReceipt, target: ResolvedSkillProfile): boolean {
  const loaded = new Set(old.loaded);
  const targetBySlug = new Map(target.selections.map(selection => [selection.slug, selection]));
  return old.profile.selections.some(previous => {
    const current = targetBySlug.get(previous.slug);
    return previous.authorizationEpoch !== undefined && loaded.has(selectionKey(previous)) && current !== undefined
      && selectionKey(current) === selectionKey(previous) && current.authorizationEpoch !== previous.authorizationEpoch;
  });
}

/**
 * A refused renewal whose automatic migration could not finish within the
 * renewal deadline. It keeps the refusal code; the fixed `migration` marker
 * lets the hook say why without carrying free text across its boundary.
 */
export class SessionPinMigrationTimeout extends SkillSelectionError {
  readonly migration = "timeout" as const;
  constructor() {
    super("SESSION_RECONCILIATION_REQUIRED", "A loaded skill changed or was removed, and automatic migration of this session pin did not finish within the managed hook renewal window; the existing pin is unchanged and the next prompt retries it.");
  }
}
/** Outcomes that may already have committed are never relabelled as a refusal. */
const AMBIGUOUS_MIGRATION_FAILURES = new Set(["SESSION_RECONCILIATION_INCOMPLETE", "SESSION_LOCK_RECOVERY_INCOMPLETE"]);
/**
 * Migration failures that say nothing lasting about this pin: write-lock
 * state, a concurrent receipt change and the spent budget. They keep the
 * refusal (or their own code) but are never remembered. Failures that are not
 * Skills errors (I/O) are treated the same way.
 */
const TRANSIENT_MIGRATION_FAILURES = new Set(["SESSION_WRITE_BUSY", "SESSION_WRITE_LOCKED", "SESSION_WRITE_LOCK_CHANGED", "SESSION_RECEIPT_CHANGED", "SESSION_GENERATION_CHANGED", "SESSION_RENEWAL_TIMEOUT"]);

export async function renewSkillSessionPin(sessionId: string, profileId: string, options: SessionPinRenewalOptions = {}): Promise<SessionPinRenewalOutcome> {
  const existing = readSkillSessionSnapshotIfExists(sessionId, options);
  if (!existing) return { outcome: "unchanged" };
  const snapshot = existing;
  const old = snapshot.receipt;
  if (old.profile.profileId !== profileId) throw new SkillSelectionError("PROFILE_LOCK_MISMATCH", "The session is pinned to a different Skills profile.");
  const now = (options.now ?? Date.now)();
  const age = now - Date.parse(old.verifiedAt);
  if (age >= 0 && age <= MAX_CACHED_PROFILE_AGE_MS) return { outcome: "unchanged" };
  if (age < 0) throw new SkillSelectionError("INVALID_RECEIPT", "The session receipt has a future timestamp; inspect it before changing its pin.");
  // A pin that follows a project lock is exactly the renewal without migration.
  const migrate = options.migrate === true && !pinFollowsProjectLock(old, options.projectDir);
  // A remembered refusal spares the authority read for a pin that will keep
  // refusing. With migration on, only a refusal of the migration itself
  // applies: a renewal refusal remembered while migration was off says nothing
  // about whether the pin can migrate.
  const localRevision = localProfileRevision(profileId, options);
  const refusal = currentRenewalRefusal(snapshot, profileId, localRevision, now, options, migrate ? [MIGRATION_REFUSAL] : [RENEWAL_REFUSAL, MIGRATION_REFUSAL]);
  if (refusal) {
    throw new SkillSelectionError("SESSION_RECONCILIATION_REQUIRED", `Renewal of this exact session pin was refused at ${refusal.recordedAt} by profile revision ${refusal.refusedRevision}; the existing pin is unchanged. The authority is asked again after ${refusal.expiresAt}, or sooner when the receipt or the synced profile revision changes. Review skills sessions reconcile for an intentional change.`);
  }
  const deadline = performance.now() + SESSION_RENEWAL_TIMEOUT_MS;
  const controller = new AbortController();
  // A spent renewal budget is not a network or HTTP failure of the authority.
  const timeoutError = () => new SkillSelectionError("SESSION_RENEWAL_TIMEOUT", "Skills session renewal did not finish within the managed hook renewal window; the existing pin is unchanged and the next prompt retries it.");
  const budgetSpent = () => controller.signal.aborted || performance.now() >= deadline;
  const assertActive = () => { if (budgetSpent()) throw timeoutError(); };
  let rejectTimeout!: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { controller.abort(); rejectTimeout(timeoutError()); }, SESSION_RENEWAL_TIMEOUT_MS);
  // Set once the authenticated target passed identity checks; only refusals
  // from comparing the pin with this exact target may be remembered or migrated.
  let comparedTarget: ResolvedSkillProfile | undefined;
  async function renew(): Promise<SessionPinRenewalOutcome> {
    const client = options.client ?? await createProfileClient(controller.signal);
    assertActive();
    const target = structuredClone(await client.resolveProfile(profileId));
    assertActive();
    validateResolvedProfile(target, client.authority);
    if (target.profileId !== profileId || target.authority !== old.profile.authority || target.workspaceId !== old.profile.workspaceId) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The authenticated Skills profile does not match this session's profile, authority and workspace.");
    }
    comparedTarget = target;
    const supportsEpochs = await client.supportsPinRenewal?.() ?? false;
    assertActive();
    if (supportsEpochs && target.selections.some(selection => !selection.authorizationEpoch)) {
      throw new SkillSelectionError("SKILLS_API_UNAVAILABLE", "The Skills authority did not provide its advertised lifecycle fences.");
    }
    const legacy = old.profile.selections.some(selection => !selection.authorizationEpoch);
    const targetBySlug = new Map(target.selections.map(selection => [selection.slug, selection]));
    const historical: ResolvedSkillSelection[] = [];
    // Check every selectable old entry, not only loaded ones: cached context may
    // select an as-yet-unloaded entry after this authorization is renewed.
    for (const previous of old.profile.selections) {
      const current = targetBySlug.get(previous.slug);
      if (!current) throw new SkillSelectionError("SESSION_RECONCILIATION_REQUIRED", "A pinned Skills selection was removed; review skills sessions reconcile before changing this session's pin.");
      // A known epoch is never replaced from current state, even when bytes match.
      if (previous.authorizationEpoch && (!supportsEpochs || previous.authorizationEpoch !== current.authorizationEpoch)) {
        throw new SkillSelectionError("SESSION_RECONCILIATION_REQUIRED", "A pinned skill's lifecycle authorization changed; review skills sessions reconcile before changing this session's pin.");
      }
      const changedVersion = selectionKey(previous) !== selectionKey(current);
      if (changedVersion && (!supportsEpochs || legacy)) {
        throw new SkillSelectionError("SESSION_RECONCILIATION_REQUIRED", "This legacy session has no verified lifecycle continuity for its older version; review skills sessions reconcile once to migrate its pin.");
      }
      const expected = { ...previous, version: current.version, bundleDigest: current.bundleDigest, profileRevision: target.profileRevision,
        // Only exact-current legacy bytes gain genuine current authorization now.
        ...(!previous.authorizationEpoch && current.authorizationEpoch ? { authorizationEpoch: current.authorizationEpoch } : {}),
      };
      if (!isDeepStrictEqual(expected, current)) {
        throw new SkillSelectionError("SESSION_RECONCILIATION_REQUIRED", "A pinned skill's selection policy changed; review skills sessions reconcile before changing this session's pin.");
      }
      if (changedVersion) historical.push(previous);
    }
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(SESSION_RENEWAL_CONCURRENCY, historical.length) }, async () => {
      while (next < historical.length) {
        assertActive();
        const selection = historical[next++]!;
        const response = await client.getBundle(selection.slug, selection.version);
        assertActive();
        await verifySelectionBundleResponse(selection, response, controller.signal, deadline);
        assertActive();
      }
    }));
    // Detect a removal, metadata change or authority drift during historical
    // reads before extending validity. Never retry against an unreviewed target.
    const confirmed = await client.resolveProfile(profileId);
    assertActive();
    validateResolvedProfile(confirmed, client.authority);
    if (!isDeepStrictEqual(target, confirmed)) throw new SkillSelectionError("SESSION_TARGET_CHANGED", "The authenticated Skills profile changed during session authorization; the existing pin is unchanged.");
    const replacement: SkillSessionReceipt = {
      ...old, generation: nextSkillSessionGeneration(snapshot.generation),
      profile: legacy || !supportsEpochs ? target : old.profile,
      // Age starts at the first authorization read, not at completion.
      verifiedAt: new Date(now).toISOString(),
    };
    replaceSkillSession(skillSessionSnapshotBinding(snapshot), replacement, {
      schemaVersion: 1, kind: "managed-hook-pin-authorization-renewal", sessionId,
      profileRevision: old.profile.profileRevision,
      authorizedByProfileRevision: target.profileRevision, authorizedByProfileSha256: digest(target),
      historicalVersionCount: historical.length,
      authorizationMode: legacy || !supportsEpochs ? "exact-current-authorization" : "continuous-immutable-pin",
      ...(legacy && supportsEpochs ? { epochsFirstVerifiedAt: new Date(now).toISOString() } : {}),
      retainedLoadedCount: old.loaded.length, retiredLoadedCount: 0,
    }, options, assertActive);
    return { outcome: "renewed" };
  }
  /**
   * Apply the explicit reconciliation plan to the target this renewal already
   * authenticated and validated (same profile, authority and workspace) with no
   * further authority read. Unchanged loaded bundles are retained and changed or
   * removed ones retired; the archive, exact receipt precondition and lock are
   * the explicit applier's own. Any failure that cannot have committed keeps the
   * original refusal, or says the budget ran out.
   */
  function migratePin(target: ResolvedSkillProfile, refusal: SkillSelectionError): SessionPinRenewalOutcome {
    // A deterministic refusal is remembered like a renewal refusal, so later
    // prompts in its window repeat it without resolving the profile again.
    const refuse = (): never => {
      recordRenewalRefusal(snapshot, profileId, target.profileRevision, localRevision, now, options, MIGRATION_REFUSAL);
      throw refusal;
    };
    // The authority read was awaited: a project lock created meanwhile governs now.
    if (retainsRotatedLoadedEpoch(old, target) || pinFollowsProjectLock(old, options.projectDir)) refuse();
    let planned: ReturnType<typeof planSessionReconciliation> | undefined;
    try {
      assertActive();
      planned = planSessionReconciliation(snapshot, target, new Date(now).toISOString(), new Date(now + SESSION_RECONCILIATION_PLAN_TTL_MS).toISOString());
      const retired = planned.plan.selectionDelta.filter(row => row.outcome === "retired");
      const notice = retired.length ? sessionPinMigrationNotice(snapshot, target, planned.plan.replacementGeneration, retired, now) : undefined;
      assertActive();
      const result = applySessionReconciliation(snapshot, target, planned,
        { kind: "managed-hook-session-pin-migration", ...planned.plan, planDigest: planned.planDigest, refusedRenewal: refusal.message },
        // Age starts at the first authorization read, not at completion.
        new Date(now).toISOString(), options, () => {
          // Under the session write lock, after the exact receipt precondition
          // held and immediately before the pin is written. A project lock
          // created since the last check still keeps the refusal. Only this
          // committing writer publishes the notice, before its pin, so a
          // committed migration can always tell the session what it retired.
          assertActive();
          if (pinFollowsProjectLock(old, options.projectDir)) throw refusal;
          if (notice) writeSelectionJson(migrationNoticePath(snapshot.sessionId, options), notice);
        });
      return { outcome: "migrated", migration: {
        profileId, fromRevision: old.profile.profileRevision, toRevision: target.profileRevision,
        retainedLoadedCount: planned.plan.retainedLoadedCount, retiredLoadedCount: planned.plan.retiredLoadedCount,
        retired, archivePath: result.archivePath, receiptPath: result.receiptPath,
      } };
    } catch (error) {
      if (error instanceof SkillSelectionError && AMBIGUOUS_MIGRATION_FAILURES.has(error.code)) throw error;
      // A failure after the pin was written (such as releasing the write lock)
      // is not a refusal: the migration may have committed.
      if (planned && holdsReplacement(planned.plan.replacementGeneration, target)) {
        throw new SkillSelectionError("SESSION_RECONCILIATION_INCOMPLETE", "The session pin was migrated, but the managed hook could not confirm the operation; inspect skills sessions show and the session's reconciliation receipt before any retry.");
      }
      // Another writer holds this session: keep its own code; a later prompt retries.
      if (error instanceof SkillSelectionError && error.code === "SESSION_WRITE_BUSY") throw error;
      if (budgetSpent()) throw new SessionPinMigrationTimeout();
      if (error === refusal || (error instanceof SkillSelectionError && !TRANSIENT_MIGRATION_FAILURES.has(error.code))) refuse();
      throw refusal;
    }
  }
  /** Whether the receipt now holds this migration's exact replacement pin. */
  function holdsReplacement(generation: number, target: ResolvedSkillProfile): boolean {
    try {
      const current = readSkillSessionSnapshotIfExists(sessionId, options);
      return current !== null && current.generation === generation && current.receipt.verifiedAt === new Date(now).toISOString()
        && isDeepStrictEqual(current.receipt.profile, target);
    } catch { return false; }
  }
  try { return await Promise.race([renew(), expired]); }
  catch (error) {
    if (error instanceof SkillSelectionError && error.code === "SESSION_RECONCILIATION_REQUIRED" && comparedTarget !== undefined) {
      if (migrate) return migratePin(comparedTarget, error);
      recordRenewalRefusal(snapshot, profileId, comparedTarget.profileRevision, localRevision, now, options, RENEWAL_REFUSAL);
      throw error;
    }
    // Inner deadlines are rounded up to the renewal deadline and never fire
    // early, so a deadline signal from this renewal means its budget is spent.
    if (budgetSpent() && renewalDeadlineSignal(error)) throw timeoutError();
    throw error;
  }
  finally { clearTimeout(timer); controller.abort(); }
}

/** Explicit review for changed loaded selections or intentional profile migration. */
export async function reconcileSkillSession(input: SessionReconciliationInput, options: SessionReconciliationOptions = {}) {
  if (![input.fromProfile, input.fromRevision, input.selectionProfile, input.profileRevision].every(value => typeof value === "string" && value.trim())
      || !/^[a-f0-9]{64}$/.test(input.receiptSha256)) {
    throw new SkillSelectionError("INVALID_SESSION_RECONCILIATION", "Name the exact old receipt SHA256, old profile/revision and intended target profile/revision.");
  }
  if (input.apply && (!input.planDigest || !input.planIssuedAt || !input.planExpiresAt)) {
    throw new SkillSelectionError("SESSION_PLAN_REQUIRED", "Review the session reconciliation plan and provide its exact digest, issuedAt and expiresAt before applying it.");
  }
  if (!input.apply && (input.planDigest !== undefined || input.planIssuedAt !== undefined || input.planExpiresAt !== undefined)) {
    throw new SkillSelectionError("SESSION_PLAN_WINDOW_INVALID", "Plan timestamps are minted by the planner and may only be replayed with --apply.");
  }
  const now = (options.now ?? Date.now)();
  const issuedAt = input.apply ? input.planIssuedAt! : new Date(now).toISOString();
  const expiresAt = input.apply ? input.planExpiresAt! : new Date(now + SESSION_RECONCILIATION_PLAN_TTL_MS).toISOString();
  if (input.apply) assertPlanWindow(issuedAt, expiresAt, now);
  const snapshot = readSkillSessionSnapshot(input.sessionId, options), old = snapshot.receipt;
  if (snapshot.sha256 !== input.receiptSha256 || old.profile.profileId !== input.fromProfile || old.profile.profileRevision !== input.fromRevision) {
    throw new SkillSelectionError("SESSION_RECEIPT_CHANGED", "The current session receipt does not match the reviewed old bytes, profile and revision.");
  }
  const client = options.client ?? await createProfileClient();
  const target = structuredClone(await client.resolveProfile(input.selectionProfile));
  validateResolvedProfile(target, client.authority);
  if (target.profileId !== input.selectionProfile || target.profileRevision !== input.profileRevision) {
    throw new SkillSelectionError("SESSION_TARGET_CHANGED", "The API selection profile does not match the intended target revision; review the current selection before proceeding.");
  }
  const planned = planSessionReconciliation(snapshot, target, issuedAt, expiresAt);
  const { plan, planDigest } = planned;
  if (input.planDigest !== undefined && input.planDigest !== planDigest) throw new SkillSelectionError("SESSION_PLAN_CHANGED", "The session reconciliation plan differs from the reviewed plan.");
  if (!input.apply) return { applied: false as const, plan, planDigest, archivePath: undefined, receiptPath: undefined, beforeSha256: snapshot.sha256, afterSha256: undefined };
  assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)());
  const result = applySessionReconciliation(snapshot, target, planned, { ...plan, planDigest }, new Date((options.now ?? Date.now)()).toISOString(), options,
    () => assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)()));
  return { applied: true as const, plan, planDigest, ...result };
}

/**
 * The one reconciliation planner, shared by explicit review and the managed
 * hook's automatic migration. Metadata only; it never reads payloads or writes.
 */
function planSessionReconciliation(snapshot: SkillSessionSnapshot, target: ResolvedSkillProfile, issuedAt: string, expiresAt: string) {
  const old = snapshot.receipt;
  if (old.profile.authority !== target.authority || old.profile.workspaceId !== target.workspaceId) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "A session reconciliation cannot change its Skills authority or workspace.");
  }
  const targetKeys = new Set(target.selections.map(selectionKey));
  const loaded = old.loaded.filter(key => targetKeys.has(key));
  const previouslyLoaded = new Set(old.loaded);
  const targetBySlug = new Map(target.selections.map(selection => [selection.slug, selection]));
  const previousSlugs = new Set(old.profile.selections.map(selection => selection.slug));
  const selectionDelta: SessionSelectionDelta[] = old.profile.selections.map(previous => {
    const current = targetBySlug.get(previous.slug);
    const wasLoaded = previouslyLoaded.has(selectionKey(previous));
    const reason = !current ? "selection-removed" : selectionKey(previous) === selectionKey(current) ? "same-bundle" : "bundle-changed";
    return {
      selection: selectionMetadata(previous), loaded: wasLoaded,
      outcome: !wasLoaded ? "unloaded" : reason === "same-bundle" ? "retained" : "retired", reason,
      ...(reason === "bundle-changed" ? { replacement: selectionMetadata(current!) } : {}),
    };
  });
  const replacementGeneration = nextSkillSessionGeneration(snapshot.generation);
  const plan = {
    schemaVersion: 1, issuedAt, expiresAt, sessionId: snapshot.sessionId, sessionPath: snapshot.path,
    before: { receiptSha256: snapshot.sha256, generation: snapshot.generation, profileId: old.profile.profileId, profileRevision: old.profile.profileRevision, selectionCount: old.profile.selections.length },
    target: { authority: target.authority, workspaceId: target.workspaceId, profileId: target.profileId, profileRevision: target.profileRevision, profileSha256: digest(target), selectionCount: target.selections.length },
    replacementGeneration, retainedLoadedCount: loaded.length, retiredLoadedCount: old.loaded.length - loaded.length,
    selectionDelta, addedSelections: target.selections.filter(selection => !previousSlugs.has(selection.slug)).map(selectionMetadata),
    scope: "Only this receipt; existing child sessions, project locks, shared profiles, hooks and running processes are unchanged.",
  };
  return { plan, planDigest: digest(plan), loaded };
}

/** The one applier: preserve the exact old receipt, then atomically write the planned pin. */
function applySessionReconciliation(snapshot: SkillSessionSnapshot, target: ResolvedSkillProfile, planned: ReturnType<typeof planSessionReconciliation>,
  record: unknown, verifiedAt: string, options: SelectionCacheOptions, beforeCommit: () => void) {
  const replacement: SkillSessionReceipt = { ...snapshot.receipt, generation: planned.plan.replacementGeneration, verifiedAt, profile: target, loaded: planned.loaded };
  return replaceSkillSession(skillSessionSnapshotBinding(snapshot), replacement, record, options, beforeCommit);
}
