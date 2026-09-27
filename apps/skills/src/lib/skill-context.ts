/** Deterministic prompt/path matching. Context loading never runs executable code. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { exactProfileSelection, readSelectedEntries, resolveSelectionContext, type SelectionResolverOptions } from "./selection-resolver.js";
import { selectionKey, SkillSelectionError, writeSkillSession } from "./selection-cache.js";
import { readSelectedDocument } from "./selected-document.js";
import { selectionMatchesName } from "./selection-aliases.js";

export interface SkillContextInput {
  prompt?: string;
  cwd?: string;
  sessionId?: string;
  profileId?: string;
  restore?: boolean;
  agentId?: string;
  skills?: string[];
  paths?: string[];
}
export interface SkillContextOptions extends SelectionResolverOptions { maxChars?: number; maxSkills?: number }
export interface ContextSelectionReceipt extends ResolvedSkillSelection { reason: string }
export interface SkillContextResult {
  context: string;
  selections: ContextSelectionReceipt[];
  omitted: Array<{ slug: string; version: string; reason: string; loadCommand: string }>;
  receipt: { schemaVersion: 1; id: string; profileId: string; profileRevision: string; authority: string; workspaceId: string; source: "api" | "verified-cache"; sessionId?: string; restored: boolean; chars: number; selections: ContextSelectionReceipt[] };
}
function words(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []); }
function pathMatch(pattern: string, path: string): boolean {
  // A tiny predictable glob subset: ** crosses directories, * does not. No regex from a profile.
  if (!pattern || pattern.length > 512) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^(?:${escaped})$`).test(path.replace(/\\/g, "/"));
}
export async function buildSkillContext(input: SkillContextInput, options: SkillContextOptions = {}): Promise<SkillContextResult> {
  const prompt = input.prompt ?? "";
  if (prompt.length > 128 * 1024 || (input.paths?.length ?? 0) > 100 || (input.skills?.length ?? 0) > 100) {
    throw new SkillSelectionError("CONTEXT_INPUT_TOO_LARGE", "The Skills context input exceeds its size limit.");
  }
  const maxChars = options.maxChars ?? 8000;
  const maxSkills = options.maxSkills ?? 3;
  if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 64_000 || !Number.isInteger(maxSkills) || maxSkills < 1 || maxSkills > 20) {
    throw new SkillSelectionError("INVALID_CONTEXT_BUDGET", "Context limits must be 512–64000 characters and 1–20 skills.");
  }
  const profileId = input.profileId ?? "default";
  const sessionId = input.sessionId ? (input.agentId ? `${input.sessionId}:${input.agentId}` : input.sessionId) : undefined;
  const resolverOptions = { ...options, projectDir: input.cwd ?? options.projectDir, sessionId, parentSessionId: input.agentId ? input.sessionId : undefined };
  const resolved = await resolveSelectionContext(profileId, resolverOptions);
  const profile = resolved.receipt.profile;
  const explicit = new Set((input.skills ?? []).map((spec) => selectionKey(exactProfileSelection(spec, profile))));
  for (const match of prompt.matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*(?:@[a-zA-Z0-9._-]+)?)/g)) {
    const spec = match[1]!;
    const slug = spec.split("@")[0];
    if (profile.selections.some((entry) => selectionMatchesName(entry, slug!))) explicit.add(selectionKey(exactProfileSelection(spec, profile)));
  }
  const promptWords = words(prompt);
  // Keep complete kebab-case names intact: "inspect" is a broad keyword in
  // "inspect-follow", but is not an exact mention of the shorter skill.
  const promptNames = new Set(prompt.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []);
  const loaded = new Set(resolved.session?.loaded ?? []);
  const paths = [...(input.paths ?? []), ...(input.cwd ? [input.cwd, resolve(input.cwd)] : [])];
  const candidates = profile.selections.map((selection) => {
    const key = selectionKey(selection);
    if (input.restore && loaded.has(key)) return { selection, reason: "session-restore", priority: 6, score: 2000 };
    if (resolved.inheritedLoaded?.includes(key)) return { selection, reason: "subagent-inherit", priority: 6, score: 2000 };
    if (explicit.has(key)) return { selection, reason: "explicit", priority: 5, score: 1000 };
    if (selection.triggers?.always) return { selection, reason: "profile-required", priority: 4, score: 900 };
    const matchedPath = selection.triggers?.paths?.some((pattern) => paths.some((path) => pathMatch(pattern, path)));
    if (matchedPath) return { selection, reason: "path", priority: 3, score: 500 };
    const keywords = selection.triggers?.keywords ?? selection.slug.split("-").filter((word) => word.length >= 4);
    const matches = keywords.filter((keyword) => {
      const tokens = [...words(keyword)];
      return tokens.length > 0 && tokens.every((token) => promptWords.has(token));
    }).length;
    const named = promptNames.has(selection.slug) || selection.aliases?.some(alias => promptNames.has(alias));
    // Rank only existing keyword matches; an empty keyword list still disables
    // prompt matching. Keyword volume cannot overtake names or explicit rules.
    return { selection, reason: "prompt", priority: named ? 2 : 1, score: matches * 100 };
  }).filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.priority - a.priority || b.score - a.score || a.selection.slug.localeCompare(b.selection.slug));
  const sections: string[] = [];
  const selections: ContextSelectionReceipt[] = [];
  const omitted: SkillContextResult["omitted"] = [];
  let chars = 0;
  for (const candidate of candidates) {
    const { selection, reason } = candidate;
    if (!input.restore && !explicit.has(selectionKey(selection)) && loaded.has(selectionKey(selection))) continue;
    const loadCommand = `skills load ${selection.slug}@${selection.version} --selection-profile ${profile.profileId}`;
    if (selections.length >= maxSkills) { omitted.push({ slug: selection.slug, version: selection.version, reason: "skill-limit", loadCommand }); continue; }
    const entries = await readSelectedEntries(selection, resolved, resolverOptions);
    const { content } = readSelectedDocument(entries);
    const section = `Skill ${selection.slug}@${selection.version} (${selection.bundleDigest}; ${reason})\n${content}`;
    if (chars + section.length + (sections.length ? 2 : 0) > maxChars) {
      omitted.push({ slug: selection.slug, version: selection.version, reason: "context-budget", loadCommand });
      continue;
    }
    chars += section.length + (sections.length ? 2 : 0);
    sections.push(section);
    selections.push({ ...selection, reason });
    loaded.add(selectionKey(selection));
  }
  const context = sections.join("\n\n");
  const receipt = {
    schemaVersion: 1 as const,
    id: createHash("sha256").update(JSON.stringify({ profile: profile.profileRevision, sessionId, selections, omitted })).digest("hex"),
    profileId: profile.profileId, profileRevision: profile.profileRevision, authority: profile.authority,
    workspaceId: profile.workspaceId, source: options.cached ? "verified-cache" as const : "api" as const,
    ...(sessionId ? { sessionId } : {}), restored: Boolean(input.restore), chars: context.length, selections,
  };
  if (sessionId) writeSkillSession({ ...resolved.receipt, sessionId, loaded: [...loaded] }, { current: resolved.sessionSnapshot, parent: resolved.parentSnapshot }, options);
  return { context, selections, omitted, receipt };
}
