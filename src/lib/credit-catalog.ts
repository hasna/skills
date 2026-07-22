import { resolveSkillAlias } from "./skill-aliases.js";
import {
  internalCreditConfigurationToQuote,
  type InternalCreditConfiguration,
  type PublicCreditQuote,
} from "./public-credits.js";

export type BillingTier = "free" | "premium";
export type SkillCatalogBillingMode = "free" | "credits" | "subscription" | "metered";
export type MediaModality = "image" | "video" | "audio" | "music";

export interface SkillCatalogBillingFields {
  billingMode: SkillCatalogBillingMode;
  creditsPerExecution: number;
}

export const MUSIC_ALBUM_SLUG = "music-album";
export const MUSIC_ALBUM_SONG_COUNTS = [7, 14, 21] as const;
export const ARTICLE_GENERATION_SLUG = "blog-article";
export const ARTICLE_MAX_COUNT = 12;
export const ARTICLE_COUNT_ERROR = `Count must be an integer between 1 and ${ARTICLE_MAX_COUNT}.`;

const MUSIC_ALBUM_CREDITS_PER_SONG = 150;
const ARTICLE_CREDITS_PER_ARTICLE = 25;
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

/** Package-owned public credit allocations. Cloud execution still requires a live quote when marked as metered. */
const FIXED_SKILL_CREDITS: Readonly<Record<string, number>> = {
  "brand-assets": 200,
  "icon-pack": 200,
  "logo-design": 50,
  deepresearch: 20,
  "playlist-maker": 30,
  "photo-album": 300,
  "short-video-pack": 500,
  "voiceover-jingle-pack": 250,
  "brand-photo-shoot": 600,
  "product-mockup": 200,
  "brand-kit": 400,
  "generate-book-cover": 20,
  "remove-background": 10,
  transcript: 10,
  webcrawling: 5,
  browse: 5,
  "read-pdf": 5,
  "pdf-read": 5,
  "pdf-to-markdown": 5,
  "pdf-to-dataset": 15,
  "market-research-report": 150,
  "customer-feedback-report": 200,
  "proposal-pack": 200,
  "pitch-deck": 300,
  "security-audit-report": 300,
  "seo-content-pack": 400,
  "landing-page-pack": 250,
  "one-page-website": 500,
  "ad-creative-pack": 300,
  "email-sequence": 250,
  "social-content-calendar": 300,
  "test-suite-generator": 250,
  "api-docs-portal": 250,
  "sdk-generator": 600,
  "repo-onboarding-report": 200,
  "audio-transcript-pack": 150,
  "video-highlight-pack": 300,
  "slide-deck-generator": 300,
  "meeting-pack": 150,
  "invoice-reconciliation": 200,
  "contract-review-report": 300,
  "performance-audit-report": 300,
  "migration-plan-pack": 300,
};

interface MediaCreditConfiguration {
  creditUnit: "image" | "second" | "character" | "song";
  creditsPerUnit: number;
  defaultUnits: number;
}

/** Public modality credits are deliberately independent of execution vendors and models. */
const MEDIA_CREDIT_CONFIGURATION: Readonly<Record<MediaModality, MediaCreditConfiguration>> = {
  image: { creditUnit: "image", creditsPerUnit: 4, defaultUnits: 1 },
  video: { creditUnit: "second", creditsPerUnit: 10, defaultUnits: 6 },
  audio: { creditUnit: "character", creditsPerUnit: 0.002, defaultUnits: 1_000 },
  music: { creditUnit: "song", creditsPerUnit: 8, defaultUnits: 1 },
};

const mediaSlugs = new Set<MediaModality>(Object.keys(MEDIA_CREDIT_CONFIGURATION) as MediaModality[]);

export function isPremiumSkill(slug: string): boolean {
  const canonicalSlug = resolveCreditSlug(slug);
  return Object.hasOwn(FIXED_SKILL_CREDITS, canonicalSlug)
    || canonicalSlug === MUSIC_ALBUM_SLUG
    || canonicalSlug === ARTICLE_GENERATION_SLUG
    || isMediaGenerationSkill(canonicalSlug);
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
  if (!tone) errors.push("Tone must be one of: professional, casual, technical, friendly.");
  const length = normalizeArticleChoice(options.length, ARTICLE_LENGTHS, "medium");
  if (!length) errors.push("Length must be one of: short, medium, long.");
  const seo = parseOptionalBoolean(options.seo);
  if (seo === null) errors.push("SEO must be a boolean option.");

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

function getInternalCreditConfiguration(slug: string, input?: unknown, args: string[] = []): InternalCreditConfiguration {
  const canonicalSlug = resolveCreditSlug(slug);
  if (canonicalSlug === ARTICLE_GENERATION_SLUG) {
    const count = resolveArticleCount(collectRunOptions(input, args));
    const credits = ARTICLE_CREDITS_PER_ARTICLE * count;
    return {
      tier: "premium",
      creditUnit: "article",
      credits,
      formattedCredits: count === 1 ? `${formatCreditAmount(ARTICLE_CREDITS_PER_ARTICLE)}/article` : `${formatCreditAmount(credits)} total`,
      formattedUnitCredits: `${formatCreditAmount(ARTICLE_CREDITS_PER_ARTICLE)}/article`,
      unitCount: count,
      estimated: false,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Credits per generated article. Batch total depends on article count.",
    };
  }

  if (canonicalSlug === MUSIC_ALBUM_SLUG) {
    const songCount = resolveMusicAlbumSongCount(collectRunOptions(input, args));
    const credits = MUSIC_ALBUM_CREDITS_PER_SONG * songCount;
    return {
      tier: "premium",
      creditUnit: "song",
      credits,
      formattedCredits: `${formatCreditAmount(credits)} total`,
      formattedUnitCredits: `${formatCreditAmount(MUSIC_ALBUM_CREDITS_PER_SONG)}/song`,
      unitCount: songCount,
      estimated: true,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Estimated album credit quote. Final credits depend on song count and generated media options.",
    };
  }

  const fixedCredits = FIXED_SKILL_CREDITS[canonicalSlug];
  if (fixedCredits !== undefined) {
    return {
      tier: "premium",
      creditUnit: "run",
      credits: fixedCredits,
      formattedCredits: `${formatCreditAmount(fixedCredits)}/run`,
      estimated: false,
      quoteDependsOnInput: false,
      quoteRequired: false,
      description: "Fixed credits per run.",
    };
  }

  const media = MEDIA_CREDIT_CONFIGURATION[canonicalSlug as MediaModality];
  if (media) {
    const options = collectRunOptions(input, args);
    const unitCount = resolveMediaUnits(canonicalSlug as MediaModality, media, options);
    const credits = Math.max(1, Math.ceil(media.creditsPerUnit * unitCount));
    return {
      tier: "premium",
      creditUnit: media.creditUnit,
      credits,
      formattedCredits: `${formatCreditAmount(credits)} estimated`,
      unitCount,
      estimated: true,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Estimated credits. Final credits depend on request options.",
    };
  }

  return {
    tier: "free",
    creditUnit: "run",
    credits: 0,
    formattedCredits: "0 credits",
    estimated: false,
    quoteDependsOnInput: false,
    quoteRequired: false,
    description: "No credits required.",
  };
}

export function getSkillCreditQuote(slug: string, input?: unknown, args: string[] = []): PublicCreditQuote {
  return internalCreditConfigurationToQuote(getInternalCreditConfiguration(slug, input, args));
}

export function getSkillCatalogBillingFields(slug: string, input?: unknown, args: string[] = []): SkillCatalogBillingFields {
  const creditQuote = getSkillCreditQuote(slug, input, args);
  if (creditQuote.tier === "free") return { billingMode: "free", creditsPerExecution: 0 };
  if (creditQuote.quoteDependsOnInput || creditQuote.quoteRequired) {
    return { billingMode: "metered", creditsPerExecution: 0 };
  }
  return { billingMode: "credits", creditsPerExecution: creditQuote.credits };
}

export function isMediaGenerationSkill(slug: string): boolean {
  return mediaSlugs.has(resolveCreditSlug(slug) as MediaModality);
}

export function getAllPremiumSlugs(): string[] {
  return [
    ...new Set([
      ...Object.keys(FIXED_SKILL_CREDITS),
      ...mediaSlugs,
      MUSIC_ALBUM_SLUG,
      ARTICLE_GENERATION_SLUG,
    ]),
  ].sort();
}

function collectRunOptions(input: unknown, args: string[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    Object.assign(options, input as Record<string, unknown>);
  }
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
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
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index++;
    } else {
      options[key] = true;
    }
  }
  if (positionals.length > 0 && typeof options.topic !== "string") options.topic = positionals.join(" ");
  return options;
}

function resolveMediaUnits(
  slug: MediaModality,
  configuration: MediaCreditConfiguration,
  options: Record<string, unknown>,
): number {
  if (slug === "image") return positiveNumber(options.count ?? options.n ?? options.images, configuration.defaultUnits);
  if (slug === "video") return positiveNumber(options.duration ?? options.seconds, configuration.defaultUnits);
  if (slug === "music") return positiveNumber(options.count ?? options.songs, configuration.defaultUnits);
  const text = [options.text, options.prompt, options.lyrics].filter((value) => typeof value === "string").join("\n");
  return Math.max(1, text.length || positiveNumber(options.characters, configuration.defaultUnits));
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveArticleCount(options: Record<string, unknown>): number {
  return parseArticleCount(options.count ?? options.articles ?? options.n) ?? 1;
}

function resolveMusicAlbumSongCount(options: Record<string, unknown>): number {
  const raw = options.songs ?? options.tracks ?? options.count ?? options.n;
  const parsed = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : MUSIC_ALBUM_SONG_COUNTS[0];
  return MUSIC_ALBUM_SONG_COUNTS.includes(parsed as typeof MUSIC_ALBUM_SONG_COUNTS[number])
    ? parsed
    : MUSIC_ALBUM_SONG_COUNTS[0];
}

function parseArticleCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= ARTICLE_MAX_COUNT ? parsed : null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function normalizeArticleChoice<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] | null {
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

function resolveCreditSlug(slug: string): string {
  return resolveSkillAlias(slug);
}

function formatCreditAmount(credits: number): string {
  return `${Number.isInteger(credits) ? credits : Number(credits.toFixed(4))} credits`;
}
