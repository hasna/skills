import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkill, loadRegistry } from "../lib/registry.js";
import type { SkillMeta } from "../lib/registry-types.js";
import { getSkillDocs } from "../lib/skillinfo.js";
import { getPublicSkillDiscovery } from "../lib/discovery.js";
import { getProviderFreeSelfHostedCreditQuote, getSelfHostedAvailability, getSelfHostedExecutionCapability } from "../lib/self-hosted-capabilities.js";

export function listServerSkills() {
  return loadRegistry().map(selfHostedDiscovery);
}

export function getServerSkill(slug: string) {
  const skill = getSkill(slug);
  return skill ? selfHostedDiscovery(skill) : null;
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
  const availability = getSelfHostedAvailability(skill.name);
  if (!getSelfHostedExecutionCapability(skill.name)) {
    return {
      skill: skill.name,
      availability: {
        status: "unavailable",
        code: availability.code,
        message: "This skill is temporarily unavailable.",
        details: ["No credits were charged."],
      },
      error: "This skill is temporarily unavailable.",
      detail: "No credits were charged.",
      code: availability.code,
    };
  }
  return {
    skill: skill.name,
    creditQuote: getProviderFreeSelfHostedCreditQuote(),
    availability,
  };
}

function selfHostedDiscovery(skill: SkillMeta): Record<string, unknown> {
  const publicSkill = getPublicSkillDiscovery(skill);
  const { creditQuote: _packageCreditQuote, ...discovery } = publicSkill;
  const availability = getSelfHostedAvailability(skill.name);
  if (!getSelfHostedExecutionCapability(skill.name)) return { ...discovery, availability };
  return {
    ...discovery,
    availability,
    creditQuote: getProviderFreeSelfHostedCreditQuote(),
  };
}
