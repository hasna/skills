/** Deterministic prompt/path matching. Context loading never runs executable code. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { exactProfileSelection, readSelectedEntries, resolveSelectionContext, type ResolvedSelectionContext, type SelectionResolverOptions } from "./selection-resolver.js";
import { assertSessionWriteLockReadable, readSelectionFileSnapshot, readSkillSessionSnapshotIfExists, selectionKey, sessionReceiptPath, SkillSelectionError, writeSkillSession } from "./selection-cache.js";
import { MAX_PROFILE_DOCUMENT_BYTES } from "./profile-limits.js";
import { readSelectedDocument } from "./selected-document.js";
import { selectionMatchesName } from "./selection-aliases.js";
import { rankPromptRelevance } from "./skill-relevance.js";

export interface SkillContextInput {
  prompt?: string;
  cwd?: string;
  sessionId?: string;
  profileId?: string;
  restore?: boolean;
  agentId?: string;
  /** Exact native session custody; null explicitly declares a root. */
  parentSessionId?: string | null;
  skills?: string[];
  paths?: string[];
}
export interface SkillContextOptions extends SelectionResolverOptions {
  maxChars?: number;
  maxSkills?: number;
  /** Called once with the resolved pin before any payload is read; metadata only. */
  onResolved?: (resolved: ResolvedSelectionContext) => void;
}
export interface ContextSelectionReceipt extends ResolvedSkillSelection { reason: string }
export interface SkillContextResult {
  context: string;
  selections: ContextSelectionReceipt[];
  omitted: Array<{ slug: string; version: string; reason: string; loadCommand: string }>;
  receipt: { schemaVersion: 1; id: string; profileId: string; profileRevision: string; authority: string; workspaceId: string; source: "api" | "verified-cache"; sessionId?: string; restored: boolean; chars: number; selections: ContextSelectionReceipt[] };
}
/**
 * Re-delivered history (a subagent's inheritance and a restore after
 * compaction or resume) carries no prompt, so its relevance is recency: the
 * most recently loaded skills first, a few bodies, then load commands. Older
 * history stays loadable with `skills load` and is not re-listed.
 */
export const HISTORY_BODY_LIMITS: Readonly<Record<"subagent-inherit" | "session-restore", number>> = Object.freeze({ "subagent-inherit": 1, "session-restore": 2 });
export const HISTORY_CANDIDATE_LIMIT = 10;
function pathMatch(pattern: string, path: string): boolean {
  // A tiny predictable glob subset: ** crosses directories, * does not. No regex from a profile.
  if (!pattern || pattern.length > 512) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^(?:${escaped})$`).test(path.replace(/\\/g, "/"));
}
interface Candidate { selection: ResolvedSkillSelection; reason: string; priority: number; score: number; recency?: number; weak?: boolean }
export async function buildSkillContext(input: SkillContextInput, options: SkillContextOptions = {}): Promise<SkillContextResult> {
  const prompt = input.prompt ?? "";
  if (prompt.length > 128 * 1024 || (input.paths?.length ?? 0) > 100 || (input.skills?.length ?? 0) > 100) {
    throw new SkillSelectionError("CONTEXT_INPUT_TOO_LARGE", "The Skills context input exceeds its size limit.");
  }
  // Native model capacity belongs to the provider. Only an explicit caller
  // budget may omit an otherwise selected instruction body.
  const maxChars = options.maxChars;
  const maxSkills = options.maxSkills ?? 3;
  if ((maxChars !== undefined && (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 64_000)) || !Number.isInteger(maxSkills) || maxSkills < 1 || maxSkills > 20) {
    throw new SkillSelectionError("INVALID_CONTEXT_BUDGET", "Context limits must be 512–64000 characters and 1–20 skills.");
  }
  const profileId = input.profileId ?? "default";
  const sessionId = input.sessionId ? (input.agentId ? `${input.sessionId}:${input.agentId}` : input.sessionId) : undefined;
  if (input.parentSessionId !== undefined) {
    if (input.agentId !== undefined || !sessionId || input.parentSessionId === sessionId || (input.parentSessionId !== null && (typeof input.parentSessionId !== "string" || !input.parentSessionId.trim()))) throw new SkillSelectionError("INVALID_SESSION", "Native session custody requires its own session id and a distinct parent, without a legacy agent id.");
  }
  const resolverOptions = { ...options, projectDir: input.cwd ?? options.projectDir, sessionId, nativeParentSessionId: input.parentSessionId, parentSessionId: input.parentSessionId ?? (input.agentId ? input.sessionId : undefined) };
  const resolved = await resolveSelectionContext(profileId, resolverOptions);
  options.onResolved?.(resolved);
  const profile = resolved.receipt.profile;
  const explicit = new Set((input.skills ?? []).map((spec) => selectionKey(exactProfileSelection(spec, profile))));
  for (const match of prompt.matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*(?:@[a-zA-Z0-9._-]+)?)/g)) {
    const spec = match[1]!;
    const slug = spec.split("@")[0];
    if (profile.selections.some((entry) => selectionMatchesName(entry, slug!))) explicit.add(selectionKey(exactProfileSelection(spec, profile)));
  }
  const previouslyLoaded = new Set(resolved.session?.loaded ?? []);
  const loaded = new Set(previouslyLoaded);
  // Insertion order of a loaded list is load order: the last entry is the most recent.
  const recency = (keys: readonly string[] | undefined) => new Map((keys ?? []).map((key, index) => [key, index]));
  const restoredOrder = input.restore ? recency(resolved.session?.loaded) : new Map<string, number>();
  const inheritedOrder = recency(resolved.inheritedLoaded);
  const relevance = new Map(rankPromptRelevance(prompt, profile.selections).map(entry => [selectionKey(entry.selection), entry]));
  const paths = [...(input.paths ?? []), ...(input.cwd ? [input.cwd, resolve(input.cwd)] : [])];
  const ranked: Candidate[] = profile.selections.flatMap((selection): Candidate[] => {
    const key = selectionKey(selection);
    if (restoredOrder.has(key)) return [{ selection, reason: "session-restore", priority: 6, score: 2000, recency: restoredOrder.get(key)! }];
    if (inheritedOrder.has(key)) return [{ selection, reason: "subagent-inherit", priority: 6, score: 2000, recency: inheritedOrder.get(key)! }];
    if (explicit.has(key)) return [{ selection, reason: "explicit", priority: 5, score: 1000 }];
    if (selection.triggers?.always) return [{ selection, reason: "profile-required", priority: 4, score: 900 }];
    const matchedPath = selection.triggers?.paths?.some((pattern) => paths.some((path) => pathMatch(pattern, path)));
    if (matchedPath) return [{ selection, reason: "path", priority: 3, score: 500 }];
    // Keyword strength cannot overtake names or explicit rules.
    const match = relevance.get(key);
    return match ? [{ selection, reason: "prompt", priority: match.priority, score: match.score, weak: match.weak }] : [];
  }).sort((a, b) => b.priority - a.priority || (b.recency ?? -1) - (a.recency ?? -1) || b.score - a.score || a.selection.slug.localeCompare(b.selection.slug));
  // Only the most recent history is offered again.
  const historyOffered = new Map<string, number>();
  const candidates = ranked.filter(candidate => {
    if (candidate.recency === undefined) return true;
    const count = historyOffered.get(candidate.reason) ?? 0;
    historyOffered.set(candidate.reason, count + 1);
    return count < HISTORY_CANDIDATE_LIMIT;
  });
  const sections: string[] = [];
  const selections: ContextSelectionReceipt[] = [];
  const omitted: SkillContextResult["omitted"] = [];
  const historyBodies = new Map<string, number>();
  let chars = 0, ambiguous = false;
  for (let index = 0; index < candidates.length; index++) {
    const { selection, reason } = candidates[index]!;
    if (!input.restore && !explicit.has(selectionKey(selection)) && loaded.has(selectionKey(selection))) continue;
    const loadCommand = `skills load ${selection.slug}@${selection.version} --selection-profile ${profile.profileId}`;
    // Weaker prompt matches never fill slots a dropped, stronger tie left free.
    if (selections.length >= maxSkills || (ambiguous && reason === "prompt")) { omitted.push({ slug: selection.slug, version: selection.version, reason: "skill-limit", loadCommand }); continue; }
    // A much weaker match than the prompt's best is offered, not injected.
    if (candidates[index]!.weak) { omitted.push({ slug: selection.slug, version: selection.version, reason: "weak-match", loadCommand }); continue; }
    const historyLimit = HISTORY_BODY_LIMITS[reason as keyof typeof HISTORY_BODY_LIMITS];
    if (historyLimit !== undefined) {
      const delivered = historyBodies.get(reason) ?? 0;
      if (delivered >= historyLimit) { omitted.push({ slug: selection.slug, version: selection.version, reason: "skill-limit", loadCommand }); continue; }
    }
    if (reason === "prompt") {
      // Prompt matches that tie at the last free slot are equally weak
      // evidence; an alphabetical slug is no reason to prefer one. When a tie
      // does not fit in the remaining slots, none of it is injected, and each
      // is offered as a load command instead.
      const candidate = candidates[index]!;
      let end = index;
      while (end + 1 < candidates.length && candidates[end + 1]!.reason === "prompt" && candidates[end + 1]!.priority === candidate.priority && candidates[end + 1]!.score === candidate.score && !candidates[end + 1]!.weak) end++;
      const tied = candidates.slice(index, end + 1).filter(entry => explicit.has(selectionKey(entry.selection)) || !loaded.has(selectionKey(entry.selection)));
      if (tied.length > maxSkills - selections.length) {
        for (const entry of tied) omitted.push({ slug: entry.selection.slug, version: entry.selection.version, reason: "ambiguous-match", loadCommand: `skills load ${entry.selection.slug}@${entry.selection.version} --selection-profile ${profile.profileId}` });
        ambiguous = true;
        index = end;
        continue;
      }
    }
    const entries = await readSelectedEntries(selection, resolved, resolverOptions);
    const { content } = readSelectedDocument(entries);
    const section = `Skill ${selection.slug}@${selection.version} (${selection.bundleDigest}; ${reason})\n${content}`;
    if (maxChars !== undefined && chars + section.length + (sections.length ? 2 : 0) > maxChars) {
      omitted.push({ slug: selection.slug, version: selection.version, reason: "context-budget", loadCommand });
      continue;
    }
    chars += section.length + (sections.length ? 2 : 0);
    sections.push(section);
    selections.push({ ...selection, reason });
    loaded.add(selectionKey(selection));
    if (historyLimit !== undefined) historyBodies.set(reason, (historyBodies.get(reason) ?? 0) + 1);
  }
  const context = sections.join("\n\n");
  const receipt = {
    schemaVersion: 1 as const,
    id: createHash("sha256").update(JSON.stringify({ profile: profile.profileRevision, sessionId, selections, omitted })).digest("hex"),
    profileId: profile.profileId, profileRevision: profile.profileRevision, authority: profile.authority,
    workspaceId: profile.workspaceId, source: options.cached ? "verified-cache" as const : "api" as const,
    ...(sessionId ? { sessionId } : {}), restored: Boolean(input.restore), chars: context.length, selections,
  };
  if (sessionId) {
    // A new session (root or child) records its pin. An existing session's
    // receipt changes only when this context loaded something new: a
    // read-only prompt leaves its bytes and generation alone, so it cannot
    // invalidate a concurrent child's parent fence or contend for its lock.
    if (!resolved.session || [...loaded].some(key => !previouslyLoaded.has(key))) {
      try {
        writeSkillSession({ ...resolved.receipt, sessionId, loaded: [...loaded], ...(resolved.projectLock ? { projectLock: resolved.projectLock } : {}) }, { current: resolved.sessionSnapshot, parent: resolved.parentSnapshot }, options);
      } catch (error) {
        // Only the bookkeeping write lost its lock race (another Skills
        // process held the lock past the bounded wait). The context was read
        // from this session's verified pin; while that pin is unchanged it is
        // delivered, and the loaded-set update is left for a later prompt. A
        // new session, a changed pin or any other failure keeps the refusal.
        if (!(error instanceof SkillSelectionError && error.code === "SESSION_WRITE_BUSY" && resolved.session && pinUnchanged(sessionId, resolved, options))) throw error;
      }
    } else {
      // Without a write, keep the checks the write would have made: damaged
      // lock state still refuses, and context read from a pin that changed
      // meanwhile is not delivered. A valid lock held by a live writer does
      // not block this read.
      assertSessionWriteLockReadable(sessionId, options);
      if (!pinUnchanged(sessionId, resolved, options)) throw new SkillSelectionError("SESSION_CONTEXT_CONFLICT", "The Skills session receipt changed while context was loading; resolve context again without replacing the current pin.");
    }
  }
  return { context, selections, omitted, receipt };
}

/**
 * Whether the session still holds the exact pin this context was read from.
 * Unchanged receipt bytes answer at once; otherwise (another prompt recorded
 * a load, or a renewal moved verifiedAt) the pinned profile must be identical.
 */
function pinUnchanged(sessionId: string, resolved: ResolvedSelectionContext, options: SkillContextOptions): boolean {
  if (!resolved.session || !resolved.sessionSnapshot) return false;
  try {
    if (readSelectionFileSnapshot(sessionReceiptPath(sessionId, options), MAX_PROFILE_DOCUMENT_BYTES)?.sha256 === resolved.sessionSnapshot.receiptSha256) return true;
    const current = readSkillSessionSnapshotIfExists(sessionId, options);
    return current !== null && isDeepStrictEqual(current.receipt.profile, resolved.session.profile);
  } catch { return false; }
}
