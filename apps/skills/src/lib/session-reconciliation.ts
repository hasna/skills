import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { SkillBundleInspectionError } from "./skill-bundle.js";
import { MAX_CACHED_PROFILE_AGE_MS, verifySelectionBundleResponse, nextSkillSessionGeneration, readSelectionJson, readSelectionProfile, readSkillSessionSnapshot, readSkillSessionSnapshotIfExists, replaceSkillSession, selectionCacheRoot, selectionKey, skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, writeSelectionJson, type SelectionCacheOptions, type SkillSessionReceipt, type SkillSessionSnapshot } from "./selection-cache.js";

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
 */
export const SESSION_RENEWAL_REFUSAL_TTL_MS = 5 * 60 * 1000;
/** A refusal record is about 600 bytes; anything larger is ignored unread. */
const SESSION_RENEWAL_REFUSAL_MAX_BYTES = 4 * 1024;
interface SessionRenewalRefusal {
  schemaVersion: 1; kind: "managed-hook-renewal-refusal"; code: "SESSION_RECONCILIATION_REQUIRED";
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
function currentRenewalRefusal(snapshot: SkillSessionSnapshot, profileId: string, localRevision: string | null | undefined, now: number, options: SelectionCacheOptions): SessionRenewalRefusal | null {
  if (localRevision === undefined) return null;
  let value: SessionRenewalRefusal | null;
  try { value = readSelectionJson<SessionRenewalRefusal>(renewalRefusalPath(snapshot.sessionId, options), SESSION_RENEWAL_REFUSAL_MAX_BYTES); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== REFUSAL_KEYS.join(",")
    || value.schemaVersion !== 1 || value.kind !== "managed-hook-renewal-refusal" || value.code !== "SESSION_RECONCILIATION_REQUIRED"
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
function recordRenewalRefusal(snapshot: SkillSessionSnapshot, profileId: string, refusedRevision: string, localRevision: string | null | undefined, now: number, options: SelectionCacheOptions): void {
  if (localRevision === undefined) return;
  const pinned = snapshot.receipt.profile;
  const record: SessionRenewalRefusal = {
    schemaVersion: 1, kind: "managed-hook-renewal-refusal", code: "SESSION_RECONCILIATION_REQUIRED",
    sessionId: snapshot.sessionId, receiptSha256: snapshot.sha256, profileId, authority: pinned.authority, workspaceId: pinned.workspaceId,
    refusedRevision, localProfileRevision: localRevision,
    recordedAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_RENEWAL_REFUSAL_TTL_MS).toISOString(),
  };
  // Best effort: failing to remember a refusal only costs another authority read.
  try { writeSelectionJson(renewalRefusalPath(snapshot.sessionId, options), record); } catch { /* the refusal itself still propagates */ }
}

/**
 * Renew authorization for the complete immutable pin; never manufacture a
 * profile combining historical loaded versions with current unloaded versions.
 * Current profile membership/lifecycle authorizes unchanged pins. Historical
 * versions additionally require the authenticated exact-version bundle read.
 */
export async function reconcileSkillSessionIfSafe(sessionId: string, profileId: string, options: SessionReconciliationOptions = {}): Promise<boolean> {
  const existing = readSkillSessionSnapshotIfExists(sessionId, options);
  if (!existing) return false;
  const snapshot = existing;
  const old = snapshot.receipt;
  if (old.profile.profileId !== profileId) throw new SkillSelectionError("PROFILE_LOCK_MISMATCH", "The session is pinned to a different Skills profile.");
  const now = (options.now ?? Date.now)();
  const age = now - Date.parse(old.verifiedAt);
  if (age >= 0 && age <= MAX_CACHED_PROFILE_AGE_MS) return false;
  if (age < 0) throw new SkillSelectionError("INVALID_RECEIPT", "The session receipt has a future timestamp; inspect it before changing its pin.");
  const localRevision = localProfileRevision(profileId, options);
  const refusal = currentRenewalRefusal(snapshot, profileId, localRevision, now, options);
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
  let comparedRevision: string | undefined;
  async function renew(): Promise<boolean> {
    const client = options.client ?? await createProfileClient(controller.signal);
    assertActive();
    const target = structuredClone(await client.resolveProfile(profileId));
    assertActive();
    validateResolvedProfile(target, client.authority);
    if (target.profileId !== profileId || target.authority !== old.profile.authority || target.workspaceId !== old.profile.workspaceId) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The authenticated Skills profile does not match this session's profile, authority and workspace.");
    }
    comparedRevision = target.profileRevision;
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
    return true;
  }
  try { return await Promise.race([renew(), expired]); }
  catch (error) {
    if (error instanceof SkillSelectionError && error.code === "SESSION_RECONCILIATION_REQUIRED" && comparedRevision !== undefined) {
      recordRenewalRefusal(snapshot, profileId, comparedRevision, localRevision, now, options);
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
    schemaVersion: 1, issuedAt, expiresAt, sessionId: input.sessionId, sessionPath: snapshot.path,
    before: { receiptSha256: snapshot.sha256, generation: snapshot.generation, profileId: old.profile.profileId, profileRevision: old.profile.profileRevision, selectionCount: old.profile.selections.length },
    target: { authority: target.authority, workspaceId: target.workspaceId, profileId: target.profileId, profileRevision: target.profileRevision, profileSha256: digest(target), selectionCount: target.selections.length },
    replacementGeneration, retainedLoadedCount: loaded.length, retiredLoadedCount: old.loaded.length - loaded.length,
    selectionDelta, addedSelections: target.selections.filter(selection => !previousSlugs.has(selection.slug)).map(selectionMetadata),
    scope: "Only this receipt; existing child sessions, project locks, shared profiles, hooks and running processes are unchanged.",
  };
  const planDigest = digest(plan);
  if (input.planDigest !== undefined && input.planDigest !== planDigest) throw new SkillSelectionError("SESSION_PLAN_CHANGED", "The session reconciliation plan differs from the reviewed plan.");
  if (!input.apply) return { applied: false as const, plan, planDigest, archivePath: undefined, receiptPath: undefined, beforeSha256: snapshot.sha256, afterSha256: undefined };
  assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)());
  const replacement: SkillSessionReceipt = {
    ...old, generation: replacementGeneration, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile: target, loaded,
  };
  const result = replaceSkillSession(skillSessionSnapshotBinding(snapshot), replacement, { ...plan, planDigest }, options,
    () => assertPlanWindow(issuedAt, expiresAt, (options.now ?? Date.now)()));
  return { applied: true as const, plan, planDigest, ...result };
}
