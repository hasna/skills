import { resolveSkillAlias } from "./skill-aliases.js";

export type BillingTier = "free" | "premium";

export interface SkillPricing {
  slug: string;
  displayName: string;
  tier: BillingTier;
  costCents: number;
  providers: string[];
  description: string;
  provider?: string;
  model?: string;
  costMicros?: number;
}

export interface PublicSkillPricing {
  tier: BillingTier;
  billingUnit: "run" | "article";
  costCents: number;
  formattedCost: string;
  formattedUnitCost?: string;
  unitCount?: number;
  estimated: boolean;
  quoteDependsOnInput: boolean;
  quoteRequired: boolean;
  description: string;
}

export type SkillCatalogBillingMode = "free" | "credits" | "subscription" | "metered";

export interface SkillCatalogBillingFields {
  billingMode: SkillCatalogBillingMode;
  creditsPerExecution: number;
}

export const PREMIUM_SKILLS: SkillPricing[] = [];

export const ARTICLE_GENERATION_SLUG = "blog-article";
export const ARTICLE_MAX_COUNT = 12;
export const ARTICLE_COUNT_ERROR = `Count must be an integer between 1 and ${ARTICLE_MAX_COUNT}.`;
const ARTICLE_INTERNAL_COST_CENTS = 5;
const ARTICLE_MARKUP_MULTIPLIER = 5;
const ARTICLE_USER_COST_CENTS = ARTICLE_INTERNAL_COST_CENTS * ARTICLE_MARKUP_MULTIPLIER;
const ARTICLE_TONES = ["professional", "casual", "technical", "friendly"] as const;
const ARTICLE_LENGTHS = ["short", "medium", "long"] as const;

export type ArticleTone = typeof ARTICLE_TONES[number];
export type ArticleLength = typeof ARTICLE_LENGTHS[number];

export interface BlogArticleRunOptions {
  topic?: string;
  audience?: string;
  tone: ArticleTone;
  length: ArticleLength;
  seo: boolean;
  outline?: string;
  count: number;
}

export type BlogArticleValidationResult =
  | { ok: true; options: BlogArticleRunOptions; input: Record<string, unknown>; errors: [] }
  | { ok: false; input: Record<string, unknown>; errors: string[] };

const premiumIndex = new Map(PREMIUM_SKILLS.map((s) => [s.slug, s]));

export function getSkillPricing(slug: string): SkillPricing | null {
  const canonicalSlug = resolvePricingSlug(slug);
  return premiumIndex.get(canonicalSlug) || getSkillRunPricing(canonicalSlug);
}


export function getSkillCostCents(slug: string): number {
  return getSkillRunCostCents(slug);
}

export function getSkillRunPricing(slug: string, input?: unknown, args: string[] = []): SkillPricing | null {
  const canonicalSlug = resolvePricingSlug(slug);

  return premiumIndex.get(canonicalSlug) || null;
}

export function validateBlogArticleRunOptions(
  input?: unknown,
  args: string[] = [],
  validation: { requireTopic?: boolean } = {},
): BlogArticleValidationResult {
  const options = collectRunOptions(input, args);
  const errors: string[] = [];
  const count = parseArticleCount(options.count ?? options.articles ?? options.n);
  if (count === null) errors.push(ARTICLE_COUNT_ERROR);

  const topic = optionalString(options.topic);
  if (validation.requireTopic && !topic) {
    errors.push("Topic is required. Pass it as positional text or --topic.");
  }

  const audience = optionalString(options.audience);
  const outline = optionalString(options.outline);
  const tone = normalizeArticleChoice(options.tone, ARTICLE_TONES, "professional");
  if (!tone) {
    errors.push("Tone must be one of: professional, casual, technical, friendly.");
  }

  const length = normalizeArticleChoice(options.length, ARTICLE_LENGTHS, "medium");
  if (!length) {
    errors.push("Length must be one of: short, medium, long.");
  }

  const seo = parseOptionalBoolean(options.seo);
  if (seo === null) {
    errors.push("SEO must be a boolean option.");
  }

  if (errors.length > 0 || count === null || !tone || !length || seo === null) {
    return { ok: false, input: options, errors };
  }

  return {
    ok: true,
    input: options,
    errors: [],
    options: {
      ...(topic ? { topic } : {}),
      ...(audience ? { audience } : {}),
      tone,
      length,
      seo,
      ...(outline ? { outline } : {}),
      count,
    },
  };
}

export function getSkillRunCostCents(slug: string, input?: unknown, args: string[] = []): number {
  return getSkillRunPricing(slug, input, args)?.costCents || 0;
}

export function getPublicSkillPricing(slug: string, input?: unknown, args: string[] = []): PublicSkillPricing {
  const canonicalSlug = resolvePricingSlug(slug);


  const fixed = premiumIndex.get(canonicalSlug);
  if (fixed) {
    return {
      tier: "premium",
      billingUnit: "run",
      costCents: fixed.costCents,
      formattedCost: `${formatCost(fixed.costCents)}/run`,
      estimated: false,
      quoteDependsOnInput: false,
      quoteRequired: false,
      description: "Fixed price per run.",
    };
  }


  return {
    tier: "free",
    billingUnit: "run",
    costCents: 0,
    formattedCost: "Free",
    estimated: false,
    quoteDependsOnInput: false,
    quoteRequired: false,
    description: "Included with Skills access.",
  };
}

export function getSkillCatalogBillingFields(slug: string, input?: unknown, args: string[] = []): SkillCatalogBillingFields {
  const pricing = getPublicSkillPricing(slug, input, args);
  if (pricing.tier === "free") {
    return { billingMode: "free", creditsPerExecution: 0 };
  }

  if (pricing.quoteDependsOnInput || pricing.quoteRequired) {
    return { billingMode: "metered", creditsPerExecution: 0 };
  }

  return {
    billingMode: "credits",
    creditsPerExecution: pricing.costCents,
  };
}

export function formatPublicPricing(slug: string, input?: unknown, args: string[] = []): string {
  return getPublicSkillPricing(slug, input, args).formattedCost;
}






function collectRunOptions(input: unknown, args: string[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    Object.assign(options, input as Record<string, unknown>);
  }

  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const keyValue = token.slice(2);
    const equalIndex = keyValue.indexOf("=");
    if (equalIndex > 0) {
      options[keyValue.slice(0, equalIndex)] = keyValue.slice(equalIndex + 1);
      continue;
    }
    const key = keyValue;
    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      i++;
    } else {
      options[key] = true;
    }
  }

  if (positionals.length > 0 && typeof options.topic !== "string") {
    options.topic = positionals.join(" ");
  }

  return options;
}



function resolveArticleCount(options: Record<string, unknown>): number {
  const raw = options.count ?? options.articles ?? options.n;
  const count = parseArticleCount(raw);
  return count ?? 1;
}


function parseArticleCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > ARTICLE_MAX_COUNT) {
    return null;
  }
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeArticleChoice<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}



function resolvePricingSlug(slug: string): string {
  return resolveSkillAlias(slug);
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getAllPremiumSlugs(): string[] {
  return [
    ...new Set([
      ...PREMIUM_SKILLS.map((skill) => skill.slug),
    ]),
  ].sort();
}
