import type { ResolvedSkillProfile, SkillProfile, SkillSelection } from "../types/skill-selection.js";

/** Shared transport and local-document limits. Operator request limits may be lower. */
export const MAX_PROFILE_SELECTIONS = 4096;
export const MAX_PROFILE_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_SKILL_SESSION_ID_CHARS = 256;
// Every selected bundle may be loaded once: a quoted 64-character key plus its
// separator. Reserve escaped child + parent session IDs, hash/generation binding,
// and the remaining fixed receipt fields too.
export const PROFILE_SESSION_ENVELOPE_BYTES = MAX_PROFILE_SELECTIONS * 67 + MAX_SKILL_SESSION_ID_CHARS * 12 + 512;
export const MAX_RESOLVED_PROFILE_BYTES = MAX_PROFILE_DOCUMENT_BYTES - PROFILE_SESSION_ENVELOPE_BYTES;
export const LEGACY_PROFILE_SELECTIONS = 256;
export const LEGACY_PROFILE_DOCUMENT_BYTES = 1_000_000;

export function profileDocumentBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export function requiresProfileCapacity(selections: SkillSelection[], bodyBytes: number): boolean {
  return selections.length > LEGACY_PROFILE_SELECTIONS || bodyBytes > LEGACY_PROFILE_DOCUMENT_BYTES;
}
export function assertAdvertisedProfileCapacity(value: unknown, count: number, bodyBytes: number): void {
  const limits = (value as { profileLimits?: Record<string, unknown> } | null)?.profileLimits;
  if (!limits || !Number.isSafeInteger(limits.maxSelections) || Number(limits.maxSelections) < count
      || !Number.isSafeInteger(limits.maxDocumentBytes) || Number(limits.maxDocumentBytes) < bodyBytes
      || !Number.isSafeInteger(limits.requestBodyLimitBytes) || Number(limits.requestBodyLimitBytes) < bodyBytes
      || !Number.isSafeInteger(limits.maxResolvedProfileBytes) || Number(limits.maxResolvedProfileBytes) <= 0) {
    throw new Error("The Skills API does not advertise enough profile capacity. Review the API version and its configured request-body limit before saving this profile.");
  }
}
export function resolvedProfileSnapshot(profile: Pick<SkillProfile, "id" | "workspaceId" | "revision" | "selections">, authority: string): ResolvedSkillProfile {
  return { profileId: profile.id, workspaceId: profile.workspaceId, profileRevision: profile.revision, authority,
    selections: profile.selections.map(selection => ({ ...selection, authority, workspaceId: profile.workspaceId, profileRevision: profile.revision })) };
}
/** Station submissions carry canonical selections, not repeated resolution metadata. */
export function profileSelectionSnapshot(selections: SkillSelection[]): SkillSelection[] {
  return selections.map(({ slug, version, bundleDigest, aliases, triggers }) => ({ slug, version, bundleDigest,
    ...(aliases !== undefined ? { aliases } : {}), ...(triggers !== undefined ? { triggers } : {}) }));
}
