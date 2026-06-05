import type { SkillMeta } from "./registry-types.js";
import { getPublicSkillPricing, isPremiumSkill, type PublicSkillPricing } from "./pricing.js";

const VENDOR_TERMS = [
  "Google Gemini",
  "OpenAI Sora",
  "MiniMax Hailuo",
  "Claude Code",
  "Claude Vision",
  "DALL-E 3",
  "GPT-4o Mini",
  "Cerebras",
  "Firecrawl",
  "ElevenLabs",
  "Anthropic",
  "OpenAI",
  "Minimax",
  "MiniMax",
  "Gemini",
  "Claude",
  "Whisper",
  "Seedance",
  "Lyria",
  "Sora",
  "Veo",
  "Exa.ai",
  "Exa",
  "XAI",
  "xAI",
];

const VENDOR_TAGS = new Set([
  "anthropic",
  "cerebras",
  "claude",
  "exa",
  "firecrawl",
  "gemini",
  "google",
  "minimax",
  "openai",
  "seedance",
  "whisper",
  "xai",
]);

const VENDOR_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CEREBRAS_",
  "EXA_",
  "FIRECRAWL_",
  "GEMINI_",
  "GOOGLE_",
  "MINIMAX_",
  "OPENAI_",
  "XAI_",
];

const VENDOR_PACKAGE_PATTERNS = [
  /anthropic/i,
  /cerebras/i,
  /exa/i,
  /firecrawl/i,
  /gemini/i,
  /minimax/i,
  /openai/i,
  /xai/i,
];

const vendorPattern = new RegExp(`\\b(${VENDOR_TERMS.map(escapeRegExp).join("|")})\\b`, "gi");

export interface CompactSkillDiscovery {
  name: string;
  category: string;
  pricing: PublicSkillPricing;
}

export type PublicSkillDiscovery<T extends SkillMeta = SkillMeta> = Omit<T, "description" | "tags"> & {
  description: string;
  tags: string[];
  pricing: PublicSkillPricing;
};

export function getCompactSkillDiscovery(skill: SkillMeta): CompactSkillDiscovery {
  return {
    name: skill.name,
    category: skill.category,
    pricing: resolveDiscoveryPricing(skill),
  };
}

export function getPublicSkillDiscovery<T extends SkillMeta>(skill: T): PublicSkillDiscovery<T> {
  return {
    ...skill,
    description: sanitizePublicDiscoveryText(skill.description),
    tags: publicDiscoveryTags(skill.tags),
    pricing: resolveDiscoveryPricing(skill),
  };
}

export function publicDiscoveryPriceLabel(skill: { name: string; pricing?: PublicSkillPricing }): string {
  return (skill.pricing ?? getPublicSkillPricing(skill.name)).formattedCost;
}

export function publicDiscoveryTags(tags: string[]): string[] {
  return tags.filter((tag) => !VENDOR_TAGS.has(tag.toLowerCase()));
}

export function sanitizePublicDiscoveryText(text: string): string {
  let sanitized = text
    .replace(vendorPattern, "hosted AI")
    .replace(/\bLLM\b/g, "AI")
    .replace(/\s{2,}/g, " ");

  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized
      .replace(/\bhosted AI(?: providers)?\s*,\s*hosted AI(?: providers)?\b/gi, "hosted AI providers")
      .replace(/\bhosted AI(?: providers)?\s*,?\s*and\s*hosted AI(?: providers)?\b/gi, "hosted AI providers")
      .replace(/\bhosted AI(?: providers)?\s+or\s+hosted AI(?: providers)?\b/gi, "hosted AI providers")
      .replace(/\bhosted AI providers\s+hosted AI\b/gi, "hosted AI providers")
      .replace(/\bhosted AI providers\s+providers\b/gi, "hosted AI providers");
  } while (sanitized !== previous);

  return sanitized.trim();
}

export function publicDiscoveryEnvVars(skillName: string, envVars: string[]): string[] {
  if (!isPremiumSkill(skillName)) return envVars;
  const filtered = envVars.filter((envVar) => !VENDOR_ENV_PREFIXES.some((prefix) => envVar.startsWith(prefix)));
  return filtered.includes("SKILL_API_KEY") ? filtered : ["SKILL_API_KEY", ...filtered];
}

export function publicDiscoveryDependencies(
  skillName: string,
  dependencies: Record<string, string>,
): Record<string, string> {
  if (!isPremiumSkill(skillName)) return dependencies;
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => !VENDOR_PACKAGE_PATTERNS.some((pattern) => pattern.test(name))),
  );
}

export function publicDiscoveryDocumentation(skill: SkillMeta, documentation: string | null): string | null {
  if (!documentation) return documentation;
  if (!isPremiumSkill(skill.name)) return documentation;

  return [
    `# ${skill.displayName || skill.name}`,
    sanitizePublicDiscoveryText(skill.description),
    `Pricing: ${getPublicSkillPricing(skill.name).formattedCost}.`,
    "Set `SKILL_API_KEY` for hosted runtime execution. Runtime routing and model selection are managed by the hosted Skills runtime.",
  ].join("\n\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveDiscoveryPricing(skill: SkillMeta): PublicSkillPricing {
  return skill.pricing && typeof skill.pricing.formattedCost === "string"
    ? skill.pricing as PublicSkillPricing
    : getPublicSkillPricing(skill.name);
}
