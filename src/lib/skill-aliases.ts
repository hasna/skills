export const SKILL_ALIASES = {
  "generate-pdf": "pdf-generate",
  "create-pdf": "pdf-generate",
  "generate-doc": "doc-generate",
  "generate-document": "doc-generate",
  "read-document": "doc-read",
  "document-read": "doc-read",
  "create-blog-article": "blog-article",
  "skill-diff": "diff-viewer",
} as const;

export type SkillAlias = keyof typeof SKILL_ALIASES;

export function normalizeSkillSlug(name: string): string {
  return name.trim();
}

export function resolveSkillAlias(name: string): string {
  const slug = normalizeSkillSlug(name);
  return SKILL_ALIASES[slug as SkillAlias] ?? slug;
}
