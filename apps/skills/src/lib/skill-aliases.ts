/** @deprecated Aliases belong to an account's selected profile, never the package. */
export const SKILL_ALIASES: Readonly<Record<string, string>> = {};

export type SkillAlias = keyof typeof SKILL_ALIASES;

export function normalizeSkillSlug(name: string): string {
  return name.trim();
}

export function resolveSkillAlias(name: string): string {
  const slug = normalizeSkillSlug(name);
  return SKILL_ALIASES[slug as SkillAlias] ?? slug;
}
