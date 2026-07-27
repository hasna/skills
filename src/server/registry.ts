import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getSkill, loadRegistry, type SkillMeta } from "../lib/registry.js";
import { getSkillDocs } from "../lib/skillinfo.js";

/**
 * The only shape of skill slug the HTTP server will resolve or touch the filesystem
 * for: lowercase letters, digits, and hyphens. This is the validation CLAUDE.md
 * documents, and it is why a path-traversal payload such as
 * `../agent-skills/skill-project-create` (or its wire form `..%2Fagent-skills%2F...`,
 * once the router decodes it) never reaches disk — it cannot match, so it is rejected
 * before any registry lookup or file read.
 */
const SKILL_SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isValidSkillSlug(slug: string): boolean {
  return SKILL_SLUG_PATTERN.test(slug);
}

/**
 * True when `candidate` resolves to a path strictly inside `dir`. The trailing
 * separator is load-bearing: it stops a sibling such as `/app/skills-evil` from
 * satisfying a naive `/app/skills` prefix test.
 */
function isInsideDir(dir: string, candidate: string): boolean {
  const base = dir.endsWith(sep) ? dir : dir + sep;
  return candidate.startsWith(base);
}

export function listServerSkills(): SkillMeta[] {
  return loadRegistry().map((skill) => ({
    ...skill,
    availability: skill.availability ?? { status: "available" },
  }));
}

export function getServerSkill(slug: string): SkillMeta | null {
  // Layer 1 (registry-bounded) + layer 4 (slug regex). getSkill() resolves aliases but
  // only ever returns a registered entry, so a traversal slug already resolves to null;
  // the explicit slug guard is defence in depth for any caller that reaches here another
  // way, and it is the validation CLAUDE.md promises.
  if (!isValidSkillSlug(slug)) return null;
  const skill = getSkill(slug);
  return skill
    ? { ...skill, availability: skill.availability ?? { status: "available" } }
    : null;
}

export function getServerSkillMd(slug: string): string | null {
  // Layer 4 (slug shape), on the RAW input and independent of the registry lookup below.
  // getSkillDocs()/getSkillPath() resolve a filesystem path from the name, and for an
  // UNregistered name they fall through to join(SKILLS_DIR, name) — the exact branch that
  // leaked the original traversal. Rejecting non-slug input here means a future refactor
  // that drops the registry check still cannot feed `..` or a separator into that branch.
  if (!isValidSkillSlug(slug)) return null;

  // Layer 1 (registry-bounded): the slug must resolve to a registered skill, and we read
  // using its CANONICAL name, never the caller's raw slug. Together with the slug shape
  // above, the name handed to getSkillDocs() is provably a real, non-traversing skill —
  // which is what keeps the getSkillDocs() branch (portable/custom skills legitimately
  // live outside skills/, so it cannot be confined to skills/) safe.
  const skill = getServerSkill(slug);
  if (!skill) return null;
  const name = skill.name;

  const docs = getSkillDocs(name);
  if (docs?.skillMd) return docs.skillMd;

  // Layer 3 (containment) for the cwd-relative fallback below: resolve the final path and
  // refuse anything not strictly inside skills/. This branch is the only one that builds a
  // path from process.cwd(), so it is the only one a containment check can meaningfully
  // net; the getSkillDocs() branch above is guarded by shape + registry membership instead.
  const skillsDir = resolve(process.cwd(), "skills");
  const path = resolve(skillsDir, name, "SKILL.md");
  if (!isInsideDir(skillsDir, path)) return null;
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
