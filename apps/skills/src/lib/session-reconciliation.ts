import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import { MAX_CACHED_PROFILE_AGE_MS, verifySelectionBundleResponse, nextSkillSessionGeneration, readSkillSessionSnapshot, readSkillSessionSnapshotIfExists, replaceSkillSession, selectionKey, skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, type SelectionCacheOptions, type SkillSessionReceipt } from "./selection-cache.js";

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

/** Metadata only: inspection never displays skill payloads or resolves credentials. */
export function inspectSkillSession(sessionId: string, options: SelectionCacheOptions = {}) {
  const snapshot = readSkillSessionSnapshot(sessionId, options), { receipt } = snapshot;
  return {
    sessionId, path: snapshot.path, receiptSha256: snapshot.sha256, generation: snapshot.generation, verifiedAt: receipt.verifiedAt,
    authority: receipt.profile.authority, workspaceId: receipt.profile.workspaceId,
    profileId: receipt.profile.profileId, profileRevision: receipt.profile.profileRevision,
    selectionCount: receipt.profile.selections.length, loadedCount: receipt.loaded.length,
  };
}

/** Fits inside the managed context child's 6.5-second ceiling, including CLI work. */
export const SESSION_RENEWAL_TIMEOUT_MS = 4_000;
const SESSION_RENEWAL_CONCURRENCY = 4;

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
  const deadline = performance.now() + SESSION_RENEWAL_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutError = () => new SkillSelectionError("SKILLS_API_UNAVAILABLE", "Skills session authorization could not finish within the managed hook renewal window; the existing pin is unchanged.");
  const assertActive = () => { if (controller.signal.aborted || performance.now() >= deadline) throw timeoutError(); };
  let rejectTimeout!: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { controller.abort(); rejectTimeout(timeoutError()); }, SESSION_RENEWAL_TIMEOUT_MS);
  async function renew(): Promise<boolean> {
    const client = options.client ?? await createProfileClient(controller.signal);
    assertActive();
    const target = structuredClone(await client.resolveProfile(profileId));
    assertActive();
    validateResolvedProfile(target, client.authority);
    if (target.profileId !== profileId || target.authority !== old.profile.authority || target.workspaceId !== old.profile.workspaceId) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The authenticated Skills profile does not match this session's profile, authority and workspace.");
    }
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
  const replacementGeneration = nextSkillSessionGeneration(snapshot.generation);
  const plan = {
    schemaVersion: 1, issuedAt, expiresAt, sessionId: input.sessionId, sessionPath: snapshot.path,
    before: { receiptSha256: snapshot.sha256, generation: snapshot.generation, profileId: old.profile.profileId, profileRevision: old.profile.profileRevision, selectionCount: old.profile.selections.length },
    target: { authority: target.authority, workspaceId: target.workspaceId, profileId: target.profileId, profileRevision: target.profileRevision, profileSha256: digest(target), selectionCount: target.selections.length },
    replacementGeneration, retainedLoadedCount: loaded.length, retiredLoadedCount: old.loaded.length - loaded.length,
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
