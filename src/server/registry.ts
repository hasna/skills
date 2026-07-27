import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkill, loadRegistry, type SkillMeta } from "../lib/registry.js";
import { getSkillDocs } from "../lib/skillinfo.js";
import { getPublicSkillPricing } from "../lib/pricing.js";

export function listServerSkills(): SkillMeta[] {
  return loadRegistry().map((skill) => ({
    ...skill,
    availability: skill.availability ?? { status: "available" },
  }));
}

export function getServerSkill(slug: string): SkillMeta | null {
  const skill = getSkill(slug);
  return skill
    ? { ...skill, availability: skill.availability ?? { status: "available" } }
    : null;
}

export function getServerSkillMd(slug: string): string | null {
  const docs = getSkillDocs(slug);
  if (docs?.skillMd) return docs.skillMd;
  const path = join(process.cwd(), "skills", slug, "SKILL.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function quoteServerSkill(slug: string): Record<string, unknown> {
  const skill = getServerSkill(slug);
  if (!skill) return { error: "skill not found", code: "SKILL_NOT_FOUND" };
  return {
    skill: skill.name,
    // The pricing table is the source of truth for what a run costs. The
    // hand-written fallback this replaced reported a `tier` that was not a
    // BillingTier at all, and named the deployment variant while doing it.
    pricing: skill.pricing ?? getPublicSkillPricing(skill.name),
    availability: skill.availability ?? { status: "available" },
  };
}
