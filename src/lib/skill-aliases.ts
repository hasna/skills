// Legacy/friendly aliases -> canonical skill name. Every target MUST be a shipped
// skill (skill-aliases.test.ts asserts this). The OSS catalog is declarative-only,
// so aliases that used to point at archived executable skills (pdf-generate,
// doc-generate, doc-read, diff-viewer, ...) were removed when those skills were.
export const SKILL_ALIASES = {
  "create-blog-article": "blog-article",
} as const;

export type SkillAlias = keyof typeof SKILL_ALIASES;

export function normalizeSkillSlug(name: string): string {
  return name.trim();
}

export function resolveSkillAlias(name: string): string {
  const slug = normalizeSkillSlug(name);
  return SKILL_ALIASES[slug as SkillAlias] ?? slug;
}
