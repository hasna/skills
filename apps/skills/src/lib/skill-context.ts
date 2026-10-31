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
import { rankPromptOffers, rankPromptRelevance, triggerWordFrequency } from "./skill-relevance.js";

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
  /**
   * An unnamed prompt match whose longest matched phrase has fewer words than
   * this is offered as a load command instead of being injected, however many
   * such words matched. Named, explicit, path and required selections are not
   * affected. Unset, every counted match may be injected.
   */
  minPromptPhraseWords?: number;
  /** Bodies a child session receives from its parent's loaded skills; the rest are offered. Unset, HISTORY_BODY_LIMITS applies. */
  inheritedBodies?: number;
  /** Called with the resolved pin before any payload is read (again if a new child is resolved again); metadata only. */
  onResolved?: (resolved: ResolvedSelectionContext) => void;
  /**
   * performance.now() time after which a new child whose parent receipt
   * changed while it resolved is not resolved again (the managed hook passes
   * its renewal deadline). Without it the single retry is unconditional.
   */
  resolveAgainBefore?: number;
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
/**
 * The one fixed line that says a context was limited because this session's
 * record could not be updated: newly read skills are offered as load commands
 * instead of being delivered unrecorded.
 */
export const SESSION_WRITE_BUSY_NOTICE = "Skills context was limited [SESSION_WRITE_BUSY]: another Skills process was updating this session's record, so newly selected skills are listed as load commands instead of being delivered. Load them with those commands when the task needs them.";
function pathMatch(pattern: string, path: string): boolean {
  // A tiny predictable glob subset: ** crosses directories, * does not. No regex from a profile.
  if (!pattern || pattern.length > 512) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^(?:${escaped})$`).test(path.replace(/\\/g, "/"));
}
interface Candidate { selection: ResolvedSkillSelection; reason: string; priority: number; score: number; recency?: number; weak?: boolean }
/**
 * Select and read context for one prompt, recording newly delivered skills in
 * the session receipt.
 *
 * A new child's first receipt write fences its parent's exact receipt. When
 * the parent recorded a load or committed a renewal while the child resolved
 * (its pin itself unchanged), that write refuses with SESSION_PARENT_CHANGED;
 * as the refusal prescribes, the child is resolved once more from the current
 * parent pin. A parent whose pin changed (a migration or reconciliation), a
 * second change, or no time left before options.resolveAgainBefore keeps the
 * refusal.
 *
 * Receipt writes run synchronously and, under contention, block the calling
 * thread for at most SESSION_WRITE_LOCK_WAIT_MS while they wait for another
 * live writer's lock.
 */
export async function buildSkillContext(input: SkillContextInput, options: SkillContextOptions = {}): Promise<SkillContextResult> {
  const first = await buildSkillContextOnce(input, options, true);
  if (first !== RESOLVE_AGAIN) return first;
  const again = await buildSkillContextOnce(input, options, false);
  if (again === RESOLVE_AGAIN) throw new SkillSelectionError("SESSION_PARENT_CHANGED", "The parent Skills session changed while the child was resolving; resolve the child again from the current parent pin.");
  return again;
}
const RESOLVE_AGAIN = Symbol("resolve-again");
async function buildSkillContextOnce(input: SkillContextInput, options: SkillContextOptions, mayResolveAgain: boolean): Promise<SkillContextResult | typeof RESOLVE_AGAIN> {
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
  const minPromptPhraseWords = options.minPromptPhraseWords ?? 0;
  const inheritedBodies = options.inheritedBodies ?? HISTORY_BODY_LIMITS["subagent-inherit"];
  if (!Number.isInteger(minPromptPhraseWords) || minPromptPhraseWords < 0 || !Number.isInteger(inheritedBodies) || inheritedBodies < 0) {
    throw new SkillSelectionError("INVALID_CONTEXT_BUDGET", "The prompt phrase and inherited body limits must be whole numbers of 0 or more.");
  }
  const historyBodyLimits: Readonly<Record<string, number>> = { ...HISTORY_BODY_LIMITS, "subagent-inherit": inheritedBodies };
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
  const frequency = triggerWordFrequency(profile.selections);
  const relevance = new Map(rankPromptRelevance(prompt, profile.selections, frequency).map(entry => [selectionKey(entry.selection), entry]));
  const paths = [...(input.paths ?? []), ...(input.cwd ? [input.cwd, resolve(input.cwd)] : [])];
  const ranked: Candidate[] = profile.selections.flatMap((selection): Candidate[] => {
    const key = selectionKey(selection);
    if (restoredOrder.has(key)) return [{ selection, reason: "session-restore", priority: 6, score: 2000, recency: restoredOrder.get(key)! }];
    const inherited: Candidate | undefined = inheritedOrder.has(key) ? { selection, reason: "subagent-inherit", priority: 6, score: 2000, recency: inheritedOrder.get(key)! } : undefined;
    // With no inherited bodies, a child's own request for this skill still counts; only otherwise is it offered.
    if (inherited && inheritedBodies > 0) return [inherited];
    if (explicit.has(key)) return [{ selection, reason: "explicit", priority: 5, score: 1000 }];
    if (selection.triggers?.always) return [{ selection, reason: "profile-required", priority: 4, score: 900 }];
    const matchedPath = selection.triggers?.paths?.some((pattern) => paths.some((path) => pathMatch(pattern, path)));
    if (matchedPath) return [{ selection, reason: "path", priority: 3, score: 500 }];
    // Keyword strength cannot overtake names or explicit rules.
    const match = relevance.get(key);
    const weak = match !== undefined && (match.weak || (match.priority === 1 && !match.phrases.some(phrase => phrase.split(" ").length >= minPromptPhraseWords)));
    if (match && !(inherited && weak)) return [{ selection, reason: "prompt", priority: match.priority, score: match.score, weak }];
    return inherited ? [inherited] : [];
  }).sort((a, b) => b.priority - a.priority || (b.recency ?? -1) - (a.recency ?? -1) || b.score - a.score || a.selection.slug.localeCompare(b.selection.slug));
  // Only the most recent history is offered again.
  const historyOffered = new Map<string, number>();
  const candidates = ranked.filter(candidate => {
    if (candidate.recency === undefined) return true;
    const count = historyOffered.get(candidate.reason) ?? 0;
    historyOffered.set(candidate.reason, count + 1);
    return count < HISTORY_CANDIDATE_LIMIT;
  });
  // A pointer loads what this session is pinned to, from the same place this
  // context came from. Without the session, a profile that moved on refuses the
  // pinned version. Without --cached, a sandbox with no network can't run it,
  // though the hook that printed it read the same bytes from the verified cache.
  const pointerSession = sessionId && /^[A-Za-z0-9._:@][A-Za-z0-9._:@-]{0,255}$/.test(sessionId) ? ` --session ${sessionId}` : "";
  const pointerCache = options.cached ? " --cached" : "";
  const loadCommandFor = (selection: ResolvedSkillSelection) => `skills load ${selection.slug}@${selection.version} --selection-profile ${profile.profileId}${pointerCache}${pointerSession}`;
  const delivered: Array<{ key: string; section: string }> = [];
  let selections: ContextSelectionReceipt[] = [];
  const omitted: SkillContextResult["omitted"] = [];
  const historyBodies = new Map<string, number>();
  let chars = 0, ambiguous = false;
  for (let index = 0; index < candidates.length; index++) {
    const { selection, reason } = candidates[index]!;
    if (!input.restore && !explicit.has(selectionKey(selection)) && loaded.has(selectionKey(selection))) continue;
    const loadCommand = loadCommandFor(selection);
    // Weaker prompt matches never fill slots a dropped, stronger tie left free.
    if (selections.length >= maxSkills || (ambiguous && reason === "prompt")) { omitted.push({ slug: selection.slug, version: selection.version, reason: "skill-limit", loadCommand }); continue; }
    // A much weaker match than the prompt's best is offered, not injected.
    if (candidates[index]!.weak) { omitted.push({ slug: selection.slug, version: selection.version, reason: "weak-match", loadCommand }); continue; }
    const historyLimit = historyBodyLimits[reason];
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
      while (end + 1 < candidates.length && candidates[end + 1]!.reason === "prompt" && candidates[end + 1]!.priority === candidate.priority && candidates[end + 1]!.score === candidate.score) end++;
      // A held-back entry at the same score doesn't end the tie: an alphabetical
      // slug is no more of a reason to prefer one body when it sits between them.
      const block = candidates.slice(index, end + 1).filter(entry => explicit.has(selectionKey(entry.selection)) || !loaded.has(selectionKey(entry.selection)));
      const tied = block.filter(entry => !entry.weak);
      if (tied.length > maxSkills - selections.length) {
        for (const entry of block) omitted.push({ slug: entry.selection.slug, version: entry.selection.version, reason: entry.weak ? "weak-match" : "ambiguous-match", loadCommand: loadCommandFor(entry.selection) });
        ambiguous = true;
        index = end;
        continue;
      }
    }
    const entries = await readSelectedEntries(selection, resolved, resolverOptions);
    const { content } = readSelectedDocument(entries);
    const section = `Skill ${selection.slug}@${selection.version} (${selection.bundleDigest}; ${reason})\n${content}`;
    if (maxChars !== undefined && chars + section.length + (delivered.length ? 2 : 0) > maxChars) {
      omitted.push({ slug: selection.slug, version: selection.version, reason: "context-budget", loadCommand });
      continue;
    }
    chars += section.length + (delivered.length ? 2 : 0);
    delivered.push({ key: selectionKey(selection), section });
    selections.push({ ...selection, reason });
    loaded.add(selectionKey(selection));
    if (historyLimit !== undefined) historyBodies.set(reason, (historyBodies.get(reason) ?? 0) + 1);
  }
  // Prompt evidence too weak to select anything is offered, never injected:
  // a few load commands after every other omission.
  const considered = new Set(ranked.map(candidate => selectionKey(candidate.selection)));
  const offers = rankPromptOffers(prompt, profile.selections, frequency, selection => {
    const key = selectionKey(selection);
    return considered.has(key) || (!explicit.has(key) && loaded.has(key));
  });
  for (const offer of offers) omitted.push({ slug: offer.selection.slug, version: offer.selection.version, reason: offer.reason, loadCommand: loadCommandFor(offer.selection) });
  let notice: string | undefined;
  if (sessionId) {
    // A new session (root or child) records its pin. An existing session's
    // receipt changes only when this context loaded something new: a
    // read-only prompt leaves its bytes and generation alone, so it cannot
    // invalidate a concurrent child's parent fence or contend for its lock.
    if (!resolved.session || [...loaded].some(key => !previouslyLoaded.has(key))) {
      try {
        writeSkillSession({ ...resolved.receipt, sessionId, loaded: [...loaded], ...(resolved.projectLock ? { projectLock: resolved.projectLock } : {}) }, { current: resolved.sessionSnapshot, parent: resolved.parentSnapshot }, options);
      } catch (error) {
        if (mayResolveAgain && error instanceof SkillSelectionError && error.code === "SESSION_PARENT_CHANGED" && !resolved.session
            && (options.resolveAgainBefore === undefined || performance.now() < options.resolveAgainBefore) && parentPinUnchanged(resolved, options)) return RESOLVE_AGAIN;
        // Only the bookkeeping write lost its lock race (another Skills
        // process held the lock past the bounded wait), and this session's pin
        // is unchanged. Every delivered body must be recorded in the receipt,
        // which later reconciliation and migration notices rely on, so only
        // bodies the receipt already records are delivered (an explicit or
        // restored re-delivery). Each newly read skill is offered as a load
        // command instead, under one fixed notice. A new session, a changed
        // pin or any other failure keeps the refusal.
        if (!(error instanceof SkillSelectionError && error.code === "SESSION_WRITE_BUSY" && resolved.session && pinUnchanged(sessionId, resolved, options))) throw error;
        const unrecorded = new Set(delivered.filter(entry => !previouslyLoaded.has(entry.key)).map(entry => entry.key));
        omitted.unshift(...selections.filter(selection => unrecorded.has(selectionKey(selection))).map(selection => ({ slug: selection.slug, version: selection.version, reason: "write-busy",
          loadCommand: loadCommandFor(selection) })));
        selections = selections.filter(selection => !unrecorded.has(selectionKey(selection)));
        delivered.splice(0, delivered.length, ...delivered.filter(entry => !unrecorded.has(entry.key)));
        notice = SESSION_WRITE_BUSY_NOTICE;
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
  const context = [notice, ...delivered.map(entry => entry.section)].filter(Boolean).join("\n\n");
  const receipt = {
    schemaVersion: 1 as const,
    id: createHash("sha256").update(JSON.stringify({ profile: profile.profileRevision, sessionId, selections, omitted })).digest("hex"),
    profileId: profile.profileId, profileRevision: profile.profileRevision, authority: profile.authority,
    workspaceId: profile.workspaceId, source: options.cached ? "verified-cache" as const : "api" as const,
    ...(sessionId ? { sessionId } : {}), restored: Boolean(input.restore), chars: context.length, selections,
  };
  return { context, selections, omitted, receipt };
}

/**
 * Whether a new child's parent still holds the pin the child resolved from:
 * only its loaded set, verification time or generation moved (a parent prompt
 * recorded a load, or a renewal committed). A migrated or reconciled parent
 * pin is not resolved again here.
 */
function parentPinUnchanged(resolved: ResolvedSelectionContext, options: SkillContextOptions): boolean {
  if (!resolved.parentSnapshot) return false;
  try {
    const current = readSkillSessionSnapshotIfExists(resolved.parentSnapshot.sessionId, options);
    return current !== null && isDeepStrictEqual(current.receipt.profile, resolved.receipt.profile);
  } catch { return false; }
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
