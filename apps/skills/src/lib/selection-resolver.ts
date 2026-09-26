/** One resolution path for API-selected content. Local drafts cannot shadow a published selection. */
import { createProfileClient, type ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { getSkillRequirementsFromContent } from "./skillinfo.js";
import { readSelectedDocument } from "./selected-document.js";
import {
  activateSelectionProfile, assertFreshCachedProfile, cacheSelectionBundle, projectSelectionLockPath,
  readCachedSelection, readProjectSelection, readSelectionProfile, readSkillSessionSnapshotIfExists, selectionKey,
  skillSessionSnapshotBinding, SkillSelectionError, validateResolvedProfile, writeSelectionJson, writeSkillSession,
  type CachedSelectionProfile, type SelectionCacheOptions, type SkillSessionParentBinding, type SkillSessionReceipt,
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
}
export async function resolveSelectionContext(profileId: string, options: SelectionResolverOptions = {}): Promise<ResolvedSelectionContext> {
  const sessionState = options.sessionId ? readSkillSessionSnapshotIfExists(options.sessionId, options) : null;
  const session = sessionState?.receipt ?? null;
  const parentState = !session && options.parentSessionId ? readSkillSessionSnapshotIfExists(options.parentSessionId, options) : null;
  if (!session && options.parentSessionId && !parentState) {
    throw new SkillSelectionError("SESSION_PARENT_NOT_FOUND", "A child Skills session requires an existing parent receipt so its inherited pin can be bound exactly.");
  }
  const parentSession = parentState?.receipt ?? null;
  const sessionSnapshot = sessionState ? skillSessionSnapshotBinding(sessionState) : null;
  const parentSnapshot = parentState ? skillSessionSnapshotBinding(parentState) : undefined;
  const project = options.projectDir ? readProjectSelection(options.projectDir) : null;
  if ((session && session.profile.profileId !== profileId) || (parentSession && parentSession.profile.profileId !== profileId) || (project && project.profile.profileId !== profileId)) {
    throw new SkillSelectionError("PROFILE_LOCK_MISMATCH", "The session or project is pinned to a different Skills profile. Select the pinned profile, or review skills sessions reconcile for an intentional session change and explicit project sync for a project change.");
  }
  if (options.cached) {
    const receipt = session ?? parentSession ?? project ?? readSelectionProfile(profileId, options);
    if (!receipt) throw new SkillSelectionError("CACHED_PROFILE_MISSING", "No verified Skills profile is cached; authenticate and sync it first.");
    assertFreshCachedProfile(receipt, options);
    assertBinding(receipt.profile, options);
    return { receipt, session, sessionSnapshot, parentSnapshot, inheritedLoaded: parentSession?.loaded };
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
  return { receipt, session, sessionSnapshot, parentSnapshot, client, inheritedLoaded: parentSession?.loaded };
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
  const selection = profile.selections.find((entry) => (entry.slug === slug || entry.aliases?.includes(slug)) && (version === undefined || version === entry.version));
  if (!selection || version === "") throw new SkillSelectionError("SKILL_NOT_SELECTED", "The requested exact skill version is not selected by this profile or project lock.");
  return selection;
}
export async function loadSelectedSkill(spec: string, profileId: string, options: SelectionResolverOptions & { file?: string } = {}) {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  const entries = await readSelectedEntries(selection, context, options);
  const { file, content } = readSelectedDocument(entries, options.file);
  const receipt = { ...selection, file, source: options.cached ? "verified-cache" : "api", verifiedAt: context.receipt.verifiedAt };
  if (options.sessionId) {
    const session: SkillSessionReceipt = {
      ...context.receipt, sessionId: options.sessionId,
      loaded: [...new Set([...(context.session?.loaded ?? []), selectionKey(selection)])],
    };
    writeSkillSession(session, { current: context.sessionSnapshot, parent: context.parentSnapshot }, options);
  }
  return { content, selection, receipt };
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
