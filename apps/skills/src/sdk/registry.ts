/**
 * Registry + version service seam.
 *
 * Unscoped registry helpers are retained as empty compatibility exports. Private
 * catalogs require an authenticated RemoteSkillsClient. The version service is the seam
 * for skills_registry versioning — the `version` column a published record carries, and
 * the contract sibling work (hasna.skill.v1, skill-hash) builds on.
 */
import type { SkillMeta } from "../lib/registry-types.js";
import {
  getServerSkill,
  getServerSkillMd,
  isValidSkillSlug,
  listServerSkills,
} from "../server/registry.js";
import type { ServerSkillRecord } from "../server/types.js";

/** The registry an embedder resolves skills against. */
export interface RegistryService {
  list(): SkillMeta[];
  get(slug: string): SkillMeta | null;
  getSkillMd(slug: string): string | null;
  isValidSlug(slug: string): boolean;
}

/** @deprecated Always empty. Use RemoteSkillsClient with the account's credentials. */
export const bundledRegistry: RegistryService = {
  list: listServerSkills,
  get: getServerSkill,
  getSkillMd: getServerSkillMd,
  isValidSlug: isValidSkillSlug,
};

/** Resolves the effective version of a published skill record. */
export interface RegistryVersionService {
  resolveVersion(record: Pick<ServerSkillRecord, "version">): string | undefined;
}

/** Current implementation: the version column carried by the published record. */
export const currentVersionService: RegistryVersionService = {
  resolveVersion: (record) => record.version,
};

export { getServerSkill, getServerSkillMd, isValidSkillSlug, listServerSkills };
export type { SkillMeta };

// The safe upload seam is asynchronous. Legacy unbounded unpack is intentionally not exported here.
export { inspectSkillBundle, packSkillBundle, SKILL_BUNDLE_INSPECTION_LIMITS, SkillBundleInspectionError } from "../lib/skill-bundle.js";
export type { OwnedBytes, SkillBundleEntry, PackedSkillBundle, PackSkillBundleOptions,
  InspectedSkillBundle, InspectSkillBundleOptions, SkillBundleInspectionLimits, SkillBundleInspectionErrorCode } from "../lib/skill-bundle.js";

export { computeContentHashFromEntries, verifyContentHashFromEntries, CONTENT_HASH_LIMITS, ContentHashInputError } from "../lib/skill-hash.js";
export type { ContentHashVerification, ContentHashLimits, ContentHashOptions, ContentHashInputErrorCode } from "../lib/skill-hash.js";
export { revisionIdOf } from "../lib/revision.js";
export type { RevisionContent } from "../lib/revision.js";
