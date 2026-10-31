/** One resolution path for API-selected content. Local drafts cannot shadow a published selection. */
import { isDeepStrictEqual } from "node:util";
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { getSkillRequirementsFromContent } from "./skillinfo.js";
import { findCloseSkillNames } from "./search.js";
import { readSelectedDocument } from "./selected-document.js";
import {
  activateSelectionProfile, assertFreshCachedProfile, cacheSelectionBundle, projectSelectionLockPath,
  readCachedSelection, readProjectSelectionSnapshot, readSelectionProfile, readSkillSessionSnapshotIfExists, selectionKey,
  skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, writeSelectionJson, writeSkillSession,
  type CachedSelectionProfile, type SelectionCacheOptions, type SkillSessionParentBinding, type SkillSessionProjectLock, type SkillSessionReceipt,
} from "./selection-cache.js";

export interface SelectionResolverOptions extends SelectionCacheOptions {
  client?: ProfileClient;
  cached?: boolean;
  /** Explicit cached authority binding, checked even when no credential is read. */
  authority?: string;
  workspaceId?: string;
  maxAgeMs?: number;
  projectDir?: string;
  sessionId?: string;
  /** A newly spawned subagent inherits the parent's pinned snapshot, never its dedup state. */
  parentSessionId?: string;
  nativeParentSessionId?: string | null;
}
export interface SyncSelectionProfileOptions extends SelectionCacheOptions {
  client?: ProfileClient;
  projectDir?: string;
  stationId?: string;
  check?: boolean;
}
export async function syncSelectionProfile(profileId: string, options: SyncSelectionProfileOptions = {}) {
  const client = options.client ?? await createProfileClient();
  const profile = await client.resolveProfile(profileId);
  validateResolvedProfile(profile, client.authority);
  if (profile.profileId !== profileId) throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The API returned a different selection profile.");
  const previous = readSelectionProfile(profileId, options);
  const changed = !previous || JSON.stringify(previous.profile) !== JSON.stringify(profile);
  let downloaded = 0;
  for (const selection of profile.selections) {
    const entries = await readCachedSelection(selection, options);
    if (entries) continue;
    if (options.check) { downloaded++; continue; }
    await cacheSelectionBundle(selection, await client.getBundle(selection.slug, selection.version), options);
    downloaded++;
  }
  if (options.check) return { profile, receipt: previous, changed: changed || downloaded > 0, downloaded, stationReported: false };
  // Only activation is mutable. Every object has been verified before this pointer moves.
  const receipt = activateSelectionProfile(profile, options);
  if (options.projectDir) writeSelectionJson(projectSelectionLockPath(options.projectDir), receipt);
  let stationReported = false;
  if (options.stationId) {
    try {
      await client.recordStation(options.stationId, {
        profileId: profile.profileId, profileRevision: profile.profileRevision, selections: profile.selections,
      });
    } catch {
      throw new SkillSelectionError("PROFILE_APPLIED_REPORT_FAILED", "The verified Skills profile is active, but the station receipt could not be reported. Retry sync to confirm the station state.");
    }
    stationReported = true;
  }
  return { profile, receipt, changed, downloaded, stationReported };
}

export interface ResolvedSelectionContext {
  receipt: CachedSelectionProfile;
  session: SkillSessionReceipt | null;
  sessionSnapshot: SkillSessionParentBinding | null;
  parentSnapshot?: SkillSessionParentBinding;
  inheritedLoaded?: string[];
  client?: ProfileClient;
  /** Set when a new session's pin comes from the project lock; the session receipt records it. */
  projectLock?: SkillSessionProjectLock;
}
export async function resolveSelectionContext(profileId: string, options: SelectionResolverOptions = {}): Promise<ResolvedSelectionContext> {
  const sessionState = options.sessionId ? readSkillSessionSnapshotIfExists(options.sessionId, options) : null;
  const session = sessionState?.receipt ?? null;
  if (options.nativeParentSessionId !== undefined && session && (session.parent?.sessionId ?? null) !== options.nativeParentSessionId) throw new SkillSelectionError("SESSION_PARENT_MISMATCH", "The native session id is already bound to different parent custody.");
  const parentState = !session && options.parentSessionId ? readSkillSessionSnapshotIfExists(options.parentSessionId, options) : null;
  if (!session && options.parentSessionId && !parentState) {
    throw new SkillSelectionError("SESSION_PARENT_NOT_FOUND", "A child Skills session requires an existing parent receipt so its inherited pin can be bound exactly.");
  }
  const parentSession = parentState?.receipt ?? null;
  const sessionSnapshot = sessionState ? skillSessionSnapshotBinding(sessionState) : null;
  const parentSnapshot = parentState ? skillSessionSnapshotBinding(parentState) : undefined;
  const projectSnapshot = options.projectDir ? readProjectSelectionSnapshot(options.projectDir) : null;
  const project = projectSnapshot?.receipt ?? null;
  // Only a new root session takes its pin from the lock; a child inherits its parent's receipt, provenance included.
  const projectLock = !session && !parentSession && projectSnapshot ? { projectLock: projectSnapshot.lock } : {};
  if ((session && session.profile.profileId !== profileId) || (parentSession && parentSession.profile.profileId !== profileId) || (project && project.profile.profileId !== profileId)) {
    throw new SkillSelectionError("PROFILE_LOCK_MISMATCH", "The session or project is pinned to a different Skills profile. Select the pinned profile, or review skills sessions reconcile for an intentional session change and explicit project sync for a project change.");
  }
  if (options.cached) {
    const receipt = session ?? parentSession ?? project ?? readSelectionProfile(profileId, options);
    if (!receipt) throw new SkillSelectionError("CACHED_PROFILE_MISSING", "No verified Skills profile is cached; authenticate and sync it first.");
    assertFreshCachedProfile(receipt, options);
    assertBinding(receipt.profile, options);
    return { receipt, session, sessionSnapshot, parentSnapshot, inheritedLoaded: parentSession?.loaded, ...projectLock };
  }
  // Authentication failure never becomes a cached or local read. Cached mode is explicit.
  const client = options.client ?? await createProfileClient();
  const current = await client.resolveProfile(profileId);
  validateResolvedProfile(current, client.authority);
  if (current.profileId !== profileId) throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The API returned a different selection profile.");
  assertBinding(current, options);
  const locked = session ?? parentSession ?? project;
  if (locked && (locked.profile.authority !== current.authority || locked.profile.workspaceId !== current.workspaceId)) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The pinned selection belongs to another Skills authority or workspace.");
  }
  // The current profile authorizes the workspace; an existing session/project retains exact versions.
  // Each old version is revalidated through the exact bundle endpoint when loaded below.
  const receipt = locked ?? { schemaVersion: 1 as const, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile: current };
  return { receipt, session, sessionSnapshot, parentSnapshot, client, inheritedLoaded: parentSession?.loaded, ...projectLock };
}
function assertBinding(profile: ResolvedSkillProfile, options: SelectionResolverOptions): void {
  if ((options.authority !== undefined && profile.authority !== options.authority)
      || (options.workspaceId !== undefined && profile.workspaceId !== options.workspaceId)) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The cached selection belongs to another Skills authority or workspace.");
  }
}
export async function readSelectedEntries(selection: ResolvedSkillSelection, context: ResolvedSelectionContext, options: SelectionResolverOptions = {}): Promise<SkillBundleEntry[]> {
  if (options.cached) {
    const entries = await readCachedSelection(selection, options);
    if (!entries) throw new SkillSelectionError("CACHED_BUNDLE_MISSING", "The exact selected bundle is not cached. Cached mode cannot fetch or use an authoring draft.");
    return entries;
  }
  // An authenticated exact read also enforces version revocation; a warm cache is not an auth fallback.
  const client = context.client ?? options.client ?? await createProfileClient();
  return cacheSelectionBundle(selection, await client.getBundle(selection.slug, selection.version), options);
}
export function exactProfileSelection(spec: string, profile: ResolvedSkillProfile): ResolvedSkillSelection {
  validateResolvedProfile(profile);
  const at = spec.lastIndexOf("@");
  const slug = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : undefined;
  // Resolve the name first and the version second: a wrong version for a name
  // that resolves is a different refusal from a name that resolves to nothing,
  // and one `find` over both fields reported the first as the second.
  const named = profile.selections.filter((entry) => entry.slug === slug || entry.aliases?.includes(slug));
  if (version === "") throw new SkillSelectionError("SKILL_NOT_SELECTED", emptyVersionRefusal(spec));
  if (named.length === 0) throw new SkillSelectionError("SKILL_NOT_SELECTED", unknownNameRefusal(slug, profile));
  const selection = version === undefined ? named[0] : named.find((entry) => entry.version === version);
  if (!selection) throw new SkillSelectionError("SKILL_NOT_SELECTED", wrongVersionRefusal(slug, version!, named));
  return selection;
}

const ACCEPTED_FORM = "Accepted form: '<slug>' or '<slug>@<version>'.";

function emptyVersionRefusal(spec: string): string {
  return `The requested name '${spec}' has an empty version. ${ACCEPTED_FORM}`;
}

function wrongVersionRefusal(slug: string, version: string, named: ResolvedSkillSelection[]): string {
  const versions = [...new Set(named.map((entry) => entry.version))].sort();
  const canonical = named[0]!.slug;
  return `Skill '${slug}' is selected at version '${versions.join("', '")}', but '${version}' was requested. `
    + `Accepted form: '${canonical}@${versions[0]}'.`;
}

/**
 * The refusal names what was refused and the form that is accepted.
 *
 * One sentence covered every cause before, and it named the wrong one: a name
 * that is in no profile at all was reported as "not selected by this profile or
 * project lock", which sends the reader to the profile and project lock to look
 * for a selection that was never there. That is how a survey read an existing
 * canonical procedure as missing (Agents Audit A27). The close matches come
 * from the profile's own accepted names — canonical slugs and aliases — so a
 * suggestion cannot point outside the authority that just refused.
 */
function unknownNameRefusal(slug: string, profile: ResolvedSkillProfile): string {
  const names = profile.selections.flatMap((entry) => [entry.slug, ...(entry.aliases ?? [])]);
  const close = findCloseSkillNames(slug, names);
  const hint = close.length > 0 ? ` Did you mean: ${close.join(", ")}?` : "";
  return `Skill '${slug}' is not selected by this Skills profile or project lock.${hint} `
    + `Read the accepted names with 'skills search <term>' or 'skills list --all --json'; accept one with 'skills pin <name>'. ${ACCEPTED_FORM}`;
}
export async function loadSelectedSkill(spec: string, profileId: string, options: SelectionResolverOptions & { file?: string } = {}) {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  const entries = await readSelectedEntries(selection, context, options);
  const { file, content } = readSelectedDocument(entries, options.file);
  const receipt = { ...selection, file, source: options.cached ? "verified-cache" : "api", verifiedAt: context.receipt.verifiedAt };
  const sessionRecorded = options.sessionId ? recordSessionLoad(options.sessionId, selection, context, options) : true;
  return { content, selection, receipt, sessionRecorded };
}

/** How many times one load re-reads a receipt that other loads changed under the same pin. */
const SESSION_LOAD_RECORD_ATTEMPTS = 8;
const UNWRITABLE_CODES = new Set(["EACCES", "EPERM", "EROFS"]);
function isUnwritableStore(error: unknown): boolean {
  for (let cause = error as any, depth = 0; cause && depth < 4; cause = cause.cause, depth++) if (UNWRITABLE_CODES.has(cause.code)) return true;
  return false;
}
/**
 * Record a load on its session. The content is already read and verified for
 * this pin, so bookkeeping that can't finish doesn't discard it. Parallel loads
 * under the same pin merge, a store this process can't write (a sandbox) and a
 * lock held past its wait leave the load unrecorded, and a pin that changed
 * still refuses, because the content no longer belongs to the session's pin.
 */
function recordSessionLoad(sessionId: string, selection: ResolvedSkillSelection, context: ResolvedSelectionContext, options: SelectionResolverOptions): boolean {
  const key = selectionKey(selection);
  let snapshot = context.sessionSnapshot;
  for (let attempt = 0; attempt < SESSION_LOAD_RECORD_ATTEMPTS; attempt++) {
    try {
      const session: SkillSessionReceipt = {
        ...context.receipt, sessionId,
        loaded: [...new Set([...(context.session?.loaded ?? []), key])],
        ...(context.projectLock ? { projectLock: context.projectLock } : {}),
      };
      writeSkillSession(session, { current: snapshot, parent: context.parentSnapshot }, options);
      return true;
    } catch (error) {
      if (isUnwritableStore(error) || (error instanceof SkillSelectionError && error.code === "SESSION_WRITE_BUSY")) return false;
      if (!(error instanceof SkillSelectionError) || error.code !== "SESSION_CONTEXT_CONFLICT") throw error;
      const current = readSkillSessionSnapshotIfExists(sessionId, options);
      if (!current || !isDeepStrictEqual(current.receipt.profile, context.receipt.profile)) throw error;
      // The write merges this load with whatever the current receipt has loaded.
      snapshot = skillSessionSnapshotBinding(current);
    }
  }
  return false;
}

/** Pin the resolved profile metadata without copying a definition into the project. */
export async function pinSelectedSkillVersion(spec: string, profileId: string, options: SelectionResolverOptions & { projectDir: string }) {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  await readSelectedEntries(selection, context, options);
  const path = projectSelectionLockPath(options.projectDir);
  writeSelectionJson(path, context.receipt);
  return { selection, path };
}

export async function selectedSkillRequirements(spec: string, profileId: string, options: SelectionResolverOptions = {}) {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  const entries = await readSelectedEntries(selection, context, options);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const texts = entries.filter((entry) => ["SKILL.md", "README.md", "CLAUDE.md", ".env.example", ".env.local.example"].includes(entry.path)).map((entry) => decoder.decode(entry.bytes));
  let dependencies: Record<string, string> = {};
  const pkg = entries.find((entry) => entry.path === "package.json");
  if (pkg) {
    const parsed: unknown = JSON.parse(decoder.decode(pkg.bytes));
    if (typeof parsed === "object" && parsed !== null && "dependencies" in parsed) {
      const value = parsed.dependencies;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        dependencies = Object.fromEntries(Object.entries(value).filter(([, version]) => typeof version === "string"));
      }
    }
  }
  return { ...getSkillRequirementsFromContent(selection.slug, texts, dependencies), selection };
}
