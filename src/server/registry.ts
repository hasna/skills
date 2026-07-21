import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkill, loadRegistry } from "../lib/registry.js";
import { getSkillDocs } from "../lib/skillinfo.js";
import { getHostedAvailabilityMetadata } from "../lib/hosted-availability.js";
import { getPublicSkillDiscovery } from "../lib/discovery.js";
import { getSkillCreditQuote } from "../lib/pricing.js";

export function listServerSkills() {
  return loadRegistry().map((skill) => getPublicSkillDiscovery({
    ...skill,
    availability: skill.availability ?? getHostedAvailabilityMetadata(skill.name),
  }));
}

export function getServerSkill(slug: string) {
  const skill = getSkill(slug);
  return skill
    ? getPublicSkillDiscovery({ ...skill, availability: skill.availability ?? getHostedAvailabilityMetadata(skill.name) })
    : null;
}

export function getServerSkillMd(slug: string): string | null {
  const docs = getSkillDocs(slug);
  if (docs?.skillMd) return docs.skillMd;
  const path = join(process.cwd(), "skills", slug, "SKILL.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function quoteServerSkill(slug: string): Record<string, unknown> {
  const skill = getSkill(slug);
  if (!skill) return { error: "skill not found", code: "SKILL_NOT_FOUND" };
  return {
    skill: skill.name,
    creditQuote: getSkillCreditQuote(skill.name),
    availability: skill.availability ?? { status: "available" },
  };
}
