import type { SkillMeta } from "../lib/registry-types.js";

export function isValidSkillSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

/** @deprecated No shared catalog exists. Use the authenticated RemoteSkillsClient. */
export function listServerSkills(): SkillMeta[] {
  return [];
}

/** @deprecated Unscoped lookup cannot select an organization's private skill. */
export function getServerSkill(_slug: string): SkillMeta | null {
  return null;
}

/** @deprecated Unscoped lookup never reads the server's filesystem. */
export function getServerSkillMd(_slug: string): string | null {
  return null;
}
