import { resolveSkillAlias } from "../../lib/skill-aliases.js";

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
  billingUnit: "run" | "image" | "second" | "character" | "song" | "thousand_tokens" | "article";
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

export type MediaModality = "image" | "video" | "audio" | "music";
export type MediaProvider = "openai" | "minimax" | "gemini" | "seedance";

type PriceUnit = "image" | "second" | "character" | "song" | "thousand_tokens";

interface MediaPrice {
  slug: MediaModality;
  provider: MediaProvider;
  model: string;
  unit: PriceUnit;
  costMicros: number;
  description: string;
  default?: boolean;
  resolution?: string;
  durationSeconds?: number;
}

export const MUSIC_ALBUM_SLUG = "music-album";
export const MUSIC_ALBUM_SONG_COUNTS = [7, 14, 21] as const;
const MUSIC_ALBUM_COST_CENTS_PER_SONG = 150;

export const PREMIUM_SKILLS: SkillPricing[] = [
  { slug: "logo-design", displayName: "Logo Design", tier: "premium", costCents: 50, providers: ["hosted"], description: "Hosted multi-variant logo package with transparent PNGs, vector-style SVGs, usage notes, and manifest" },
  { slug: "deepresearch", displayName: "Deep Research", tier: "premium", costCents: 20, providers: ["exa"], description: "Agentic web research with semantic search and synthesis" },
  { slug: "playlist-maker", displayName: "Playlist Maker", tier: "premium", costCents: 30, providers: ["exa", "gemini-3-pro"], description: "Curated playlist with research, track selection, and album art" },
  { slug: MUSIC_ALBUM_SLUG, displayName: "Music Album", tier: "premium", costCents: MUSIC_ALBUM_COST_CENTS_PER_SONG * 7, providers: ["hosted"], description: "Hosted music album package with configurable 7, 14, or 21 generated songs, cover art, metadata, manifest, and receipt" },
  { slug: "photo-album", displayName: "Photo Album", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted themed photo album with configurable image count, cover image, captions, gallery manifest, and downloadable assets" },
  { slug: "short-video-pack", displayName: "Short Video Pack", tier: "premium", costCents: 500, providers: ["hosted"], description: "Hosted short-form video package with scripts, shot list, generated clips or edit package, captions, thumbnails, manifest, and receipt" },
  { slug: "voiceover-jingle-pack", displayName: "Voiceover And Jingle Pack", tier: "premium", costCents: 250, providers: ["hosted"], description: "Hosted voiceover variants and short jingles with audio artifacts, usage notes, manifest, and receipt" },
  { slug: "brand-photo-shoot", displayName: "Brand Photo Shoot", tier: "premium", costCents: 600, providers: ["hosted"], description: "Hosted product or brand photo shoot set with prompt planning, multiple scenes, gallery exports, captions, and receipt" },
  { slug: "product-mockup", displayName: "Product Mockup", tier: "premium", costCents: 200, providers: ["hosted"], description: "Hosted product mockup package with SVG variants, image direction prompts, scene planning, usage notes, asset metadata, and manifest" },
  { slug: "brand-kit", displayName: "Brand Kit", tier: "premium", costCents: 400, providers: ["hosted"], description: "Hosted brand kit with logo usage, palette, typography, brand voice, sample applications, Markdown guide, PDF guide, and SVG assets" },
  { slug: "generate-book-cover", displayName: "Book Cover", tier: "premium", costCents: 20, providers: ["gpt-image-2"], description: "Professional book cover design from title and genre" },
  { slug: "remove-background", displayName: "Remove Background", tier: "premium", costCents: 10, providers: ["gemini-3-pro"], description: "AI-powered background removal from images" },
  { slug: "transcript", displayName: "Transcript", tier: "premium", costCents: 10, providers: ["whisper"], description: "Audio/video transcription with timestamps" },
  { slug: "webcrawling", displayName: "Web Crawling", tier: "premium", costCents: 5, providers: ["firecrawl"], description: "Structured web page crawling and extraction" },
  { slug: "browse", displayName: "Browse", tier: "premium", costCents: 5, providers: ["browser"], description: "Web browsing and page interaction" },
  { slug: "read-pdf", displayName: "Read PDF", tier: "premium", costCents: 5, providers: ["cerebras"], description: "Hosted PDF extraction and structured content analysis" },
  { slug: "pdf-read", displayName: "PDF Read", tier: "premium", costCents: 5, providers: ["cerebras"], description: "Hosted multi-PDF text extraction with page ranges" },
  { slug: "pdf-to-markdown", displayName: "PDF to Markdown", tier: "premium", costCents: 5, providers: ["hosted"], description: "Hosted PDF to markdown conversion and cleanup" },
  { slug: "pdf-to-dataset", displayName: "PDF to Dataset", tier: "premium", costCents: 15, providers: ["hosted"], description: "Hosted PDF table and form extraction into CSV/JSON datasets" },
  { slug: "market-research-report", displayName: "Market Research Report", tier: "premium", costCents: 150, providers: ["hosted"], description: "Hosted market research report with competitor, audience, pricing, and source artifacts" },
  { slug: "customer-feedback-report", displayName: "Customer Feedback Report", tier: "premium", costCents: 200, providers: ["hosted"], description: "Hosted customer feedback report with clusters, sentiment, root causes, roadmap suggestions, evidence, and manifest" },
  { slug: "proposal-pack", displayName: "Proposal Pack", tier: "premium", costCents: 200, providers: ["hosted"], description: "Hosted client proposal package with SOW, pricing, timeline, assumptions, and cover email artifacts" },
  { slug: "pitch-deck", displayName: "Pitch Deck", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted investor or sales deck package with markdown, speaker notes, design direction, PDF, and PPTX artifacts" },
  { slug: "security-audit-report", displayName: "Security Audit Report", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted SaaS security hardening report with findings and remediation artifacts" },
  { slug: "seo-content-pack", displayName: "SEO Content Pack", tier: "premium", costCents: 400, providers: ["hosted"], description: "Hosted SEO content package with topic cluster, article drafts, metadata, links, FAQs, and cadence artifacts" },
  { slug: "landing-page-pack", displayName: "Landing Page Pack", tier: "premium", costCents: 250, providers: ["hosted"], description: "Hosted landing page package with copy, wireframe, CTA map, experiments, preview HTML, and implementation notes" },
  { slug: "one-page-website", displayName: "One Page Website", tier: "premium", costCents: 500, providers: ["hosted"], description: "Hosted static one-page website bundle with HTML, CSS, JavaScript, copy, section map, deploy notes, and manifest" },
  { slug: "ad-creative-pack", displayName: "Ad Creative Pack", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted paid ad package with platform copy, creative concepts, image prompts, audience angles, and test matrix" },
  { slug: "email-sequence", displayName: "Email Sequence", tier: "premium", costCents: 250, providers: ["hosted"], description: "Hosted email campaign package with subject lines, previews, body copy, segmentation notes, CTA variants, HTML emails, and send plan" },
  { slug: "social-content-calendar", displayName: "Social Content Calendar", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted social campaign calendar with daily posts, channel strategy, asset briefs, hooks, publishing schedule, and repurposing map" },
  { slug: "test-suite-generator", displayName: "Test Suite Generator", tier: "premium", costCents: 250, providers: ["hosted"], description: "Hosted API, unit, and browser test suite package with coverage notes" },
  { slug: "api-docs-portal", displayName: "API Docs Portal", tier: "premium", costCents: 250, providers: ["hosted"], description: "Hosted API documentation portal with endpoint reference, auth guide, examples, and static site artifacts" },
  { slug: "sdk-generator", displayName: "SDK Generator", tier: "premium", costCents: 600, providers: ["hosted"], description: "Hosted TypeScript SDK scaffold with client code, types, package files, tests, README, examples, API summary, and manifest" },
  { slug: "repo-onboarding-report", displayName: "Repo Onboarding Report", tier: "premium", costCents: 200, providers: ["hosted"], description: "Hosted repository onboarding package with architecture map, setup guide, first-week plan, code inventory, risk register, and manifest" },
  { slug: "audio-transcript-pack", displayName: "Audio Transcript Pack", tier: "premium", costCents: 150, providers: ["hosted"], description: "Hosted transcript package with timestamps, captions, summary, show notes, clip suggestions, repurposing copy, and manifest" },
  { slug: "video-highlight-pack", displayName: "Video Highlight Pack", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted video highlight package with clip plan, captions, thumbnail briefs, chapter markers, social posts, edit decisions, and manifest" },
  { slug: "slide-deck-generator", displayName: "Slide Deck Generator", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted slide deck package with markdown, PDF, PPTX, speaker notes, theme guide, structured slide metadata, and manifest" },
  { slug: "meeting-pack", displayName: "Meeting Pack", tier: "premium", costCents: 150, providers: ["hosted"], description: "Hosted meeting package with summary, decisions, action items, follow-up email, timeline, project export, and manifest" },
  { slug: "invoice-reconciliation", displayName: "Invoice Reconciliation", tier: "premium", costCents: 200, providers: ["hosted"], description: "Hosted invoice reconciliation package with matched payments, discrepancies, anomaly notes, summaries, and manifest" },
  { slug: "contract-review-report", displayName: "Contract Review Report", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted contract review package with risk register, clause summary, redline suggestions, negotiation email, and manifest" },
  { slug: "performance-audit-report", displayName: "Performance Audit Report", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted performance audit package with metrics, findings, budgets, remediation plan, and manifest" },
  { slug: "migration-plan-pack", displayName: "Migration Plan Pack", tier: "premium", costCents: 300, providers: ["hosted"], description: "Hosted migration planning package with risk matrix, checklist, rollout plan, test strategy, dependency map, and manifest" },
];

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

export const MEDIA_GENERATION_PRICES: MediaPrice[] = [
  { slug: "image", provider: "openai", model: "gpt-image-1.5", unit: "image", costMicros: 34_000, description: "GPT Image 1.5 medium 1024x1024 image", default: true },
  { slug: "image", provider: "openai", model: "dall-e-3", unit: "image", costMicros: 40_000, description: "DALL-E 3 standard 1024x1024 image" },
  { slug: "image", provider: "minimax", model: "image-01", unit: "image", costMicros: 3_500, description: "MiniMax image-01 image", default: true },
  { slug: "image", provider: "gemini", model: "imagen-4.0-generate-001", unit: "image", costMicros: 40_000, description: "Imagen 4 standard image", default: true },
  { slug: "image", provider: "gemini", model: "imagen-4.0-fast-generate-001", unit: "image", costMicros: 20_000, description: "Imagen 4 fast image" },
  { slug: "image", provider: "gemini", model: "imagen-4.0-ultra-generate-001", unit: "image", costMicros: 60_000, description: "Imagen 4 ultra image" },
  { slug: "image", provider: "gemini", model: "gemini-2.5-flash-image", unit: "image", costMicros: 39_000, description: "Gemini 2.5 Flash Image" },

  { slug: "video", provider: "openai", model: "sora-2", unit: "second", costMicros: 100_000, description: "Sora 2 720p video", default: true },
  { slug: "video", provider: "openai", model: "sora-2-pro", unit: "second", costMicros: 300_000, description: "Sora 2 Pro 720p video" },
  { slug: "video", provider: "minimax", model: "MiniMax-Hailuo-2.3-Fast", unit: "second", costMicros: 31_667, description: "MiniMax Hailuo 2.3 Fast 768p 6s video", default: true, resolution: "768p", durationSeconds: 6 },
  { slug: "video", provider: "minimax", model: "MiniMax-Hailuo-2.3", unit: "second", costMicros: 46_667, description: "MiniMax Hailuo 2.3 768p 6s video" },
  { slug: "video", provider: "gemini", model: "veo-3.1-fast-generate-preview", unit: "second", costMicros: 100_000, description: "Veo 3.1 Fast 720p video", default: true, resolution: "720p" },
  { slug: "video", provider: "gemini", model: "veo-3.1-generate-preview", unit: "second", costMicros: 400_000, description: "Veo 3.1 standard 720p/1080p video" },
  { slug: "video", provider: "seedance", model: "dreamina-seedance-2.0", unit: "thousand_tokens", costMicros: 7_000, description: "Dreamina Seedance 2.0 text/image-to-video token price", default: true },
  { slug: "video", provider: "seedance", model: "dreamina-seedance-2.0-fast", unit: "thousand_tokens", costMicros: 5_600, description: "Dreamina Seedance 2.0 Fast text/image-to-video token price" },

  { slug: "audio", provider: "openai", model: "tts-1", unit: "character", costMicros: 15, description: "OpenAI TTS speech generation", default: true },
  { slug: "audio", provider: "openai", model: "tts-1-hd", unit: "character", costMicros: 30, description: "OpenAI TTS HD speech generation" },
  { slug: "audio", provider: "minimax", model: "speech-2.8-turbo", unit: "character", costMicros: 60, description: "MiniMax turbo text-to-audio", default: true },
  { slug: "audio", provider: "minimax", model: "speech-2.8-hd", unit: "character", costMicros: 100, description: "MiniMax HD text-to-audio" },
  { slug: "audio", provider: "gemini", model: "gemini-2.5-flash-preview-tts", unit: "character", costMicros: 10, description: "Gemini 2.5 Flash TTS output-token equivalent", default: true },
  { slug: "audio", provider: "gemini", model: "gemini-2.5-pro-preview-tts", unit: "character", costMicros: 20, description: "Gemini 2.5 Pro TTS output-token equivalent" },

  { slug: "music", provider: "minimax", model: "Music-2.6", unit: "song", costMicros: 150_000, description: "MiniMax Music 2.6 up-to-5-minute song", default: true },
  { slug: "music", provider: "minimax", model: "Music-2.0", unit: "song", costMicros: 30_000, description: "MiniMax Music 2.0 up-to-5-minute song" },
  { slug: "music", provider: "gemini", model: "lyria-3-clip-preview", unit: "song", costMicros: 40_000, description: "Lyria 3 30s clip", default: true },
  { slug: "music", provider: "gemini", model: "lyria-3-pro-preview", unit: "song", costMicros: 80_000, description: "Lyria 3 full song" },
];

const premiumIndex = new Map(PREMIUM_SKILLS.map((s) => [s.slug, s]));
const mediaSlugs = new Set<MediaModality>(["image", "video", "audio", "music"]);

export function getSkillPricing(slug: string): SkillPricing | null {
  const canonicalSlug = resolvePricingSlug(slug);
  return premiumIndex.get(canonicalSlug) || getSkillRunPricing(canonicalSlug);
}

export function isPremiumSkill(slug: string): boolean {
  const canonicalSlug = resolvePricingSlug(slug);
  return premiumIndex.has(canonicalSlug) || isMediaGenerationSkill(canonicalSlug) || canonicalSlug === ARTICLE_GENERATION_SLUG;
}

export function getSkillCostCents(slug: string): number {
  return getSkillRunCostCents(slug);
}

export function getSkillRunPricing(slug: string, input?: unknown, args: string[] = []): SkillPricing | null {
  const canonicalSlug = resolvePricingSlug(slug);
  if (canonicalSlug === ARTICLE_GENERATION_SLUG) {
    const options = collectRunOptions(input, args);
    const count = resolveArticleCount(options);
    return {
      slug: canonicalSlug,
      displayName: "Blog Article",
      tier: "premium",
      costCents: ARTICLE_USER_COST_CENTS * count,
      costMicros: ARTICLE_INTERNAL_COST_CENTS * count * 10_000,
      provider: "cerebras",
      model: "gpt-oss",
      providers: ["cerebras"],
      description: `Remote article generation; ${count} article${count === 1 ? "" : "s"}`,
    };
  }

  if (canonicalSlug === MUSIC_ALBUM_SLUG) {
    const options = collectRunOptions(input, args);
    const songCount = resolveMusicAlbumSongCount(options);
    const costCents = MUSIC_ALBUM_COST_CENTS_PER_SONG * songCount;
    return {
      slug: canonicalSlug,
      displayName: "Music Album",
      tier: "premium",
      costCents,
      costMicros: costCents * 10_000,
      provider: "hosted",
      providers: ["hosted"],
      description: `Hosted music album package; ${songCount} generated songs`,
    };
  }

  const mediaSlug = canonicalSlug as MediaModality;
  if (!mediaSlugs.has(mediaSlug)) {
    return premiumIndex.get(canonicalSlug) || null;
  }

  const options = collectRunOptions(input, args);
  const provider = normalizeProvider(options.provider) || defaultProvider(mediaSlug);
  const model = typeof options.model === "string" ? options.model : undefined;
  const price = selectMediaPrice(mediaSlug, provider, model);
  if (!price) return null;

  const units = resolveUnits(price, options);
  const costMicros = Math.ceil(price.costMicros * units);
  const costCents = microsToBillableCents(costMicros);

  return {
    slug: mediaSlug,
    displayName: `${titleCase(mediaSlug)} Generation`,
    tier: "premium",
    costCents,
    costMicros,
    provider: price.provider,
    model: price.model,
    providers: getMediaProviders(mediaSlug),
    description: `${price.description}; ${units} ${price.unit}${units === 1 ? "" : "s"}`,
  };
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
  if (canonicalSlug === ARTICLE_GENERATION_SLUG) {
    const options = collectRunOptions(input, args);
    const count = resolveArticleCount(options);
    const total = ARTICLE_USER_COST_CENTS * count;
    return {
      tier: "premium",
      billingUnit: "article",
      costCents: total,
      formattedCost: count === 1 ? `${formatCost(ARTICLE_USER_COST_CENTS)}/article` : `${formatCost(total)} total`,
      formattedUnitCost: `${formatCost(ARTICLE_USER_COST_CENTS)}/article`,
      unitCount: count,
      estimated: false,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Priced per generated article. Batch total depends on article count.",
    };
  }

  if (canonicalSlug === MUSIC_ALBUM_SLUG) {
    const options = collectRunOptions(input, args);
    const songCount = resolveMusicAlbumSongCount(options);
    const total = MUSIC_ALBUM_COST_CENTS_PER_SONG * songCount;
    return {
      tier: "premium",
      billingUnit: "song",
      costCents: total,
      formattedCost: `${formatCost(total)} total`,
      formattedUnitCost: `${formatCost(MUSIC_ALBUM_COST_CENTS_PER_SONG)}/song`,
      unitCount: songCount,
      estimated: true,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Estimated album package price. Final price depends on song count and generated media options.",
    };
  }

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

  const mediaSlug = canonicalSlug as MediaModality;
  if (mediaSlugs.has(mediaSlug)) {
    const options = collectRunOptions(input, args);
    const provider = normalizeProvider(options.provider) || defaultProvider(mediaSlug);
    const model = typeof options.model === "string" ? options.model : undefined;
    const price = selectMediaPrice(mediaSlug, provider, model);
    const internal = getSkillRunPricing(canonicalSlug, input, args);
    const unitCount = price ? resolveUnits(price, options) : undefined;
    return {
      tier: "premium",
      billingUnit: price?.unit ?? "run",
      costCents: internal?.costCents ?? 0,
      formattedCost: `${formatCost(internal?.costCents ?? 0)} estimated`,
      ...(unitCount !== undefined ? { unitCount } : {}),
      estimated: true,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Estimated price. Final price depends on request options.",
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
    description: "Included with skills.md access.",
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

export function isMediaGenerationSkill(slug: string): boolean {
  return mediaSlugs.has(resolvePricingSlug(slug) as MediaModality);
}

export function getMediaProviders(slug: MediaModality): string[] {
  return [...new Set(MEDIA_GENERATION_PRICES.filter((p) => p.slug === slug).map((p) => p.provider))];
}

function selectMediaPrice(slug: MediaModality, provider: MediaProvider, model?: string): MediaPrice | null {
  const candidates = MEDIA_GENERATION_PRICES.filter((p) => p.slug === slug && p.provider === provider);
  if (model) {
    const exact = candidates.find((p) => p.model.toLowerCase() === model.toLowerCase());
    if (exact) return exact;
  }
  return candidates.find((p) => p.default) || candidates[0] || null;
}

function defaultProvider(slug: MediaModality): MediaProvider {
  if (slug === "video") return "seedance";
  if (slug === "music") return "minimax";
  if (slug === "audio") return "openai";
  return "openai";
}

function normalizeProvider(value: unknown): MediaProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "google") return "gemini";
  if (normalized === "byteplus" || normalized === "bytedance") return "seedance";
  if (["openai", "minimax", "gemini", "seedance"].includes(normalized)) return normalized as MediaProvider;
  return null;
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

function resolveUnits(price: MediaPrice, options: Record<string, unknown>): number {
  if (price.unit === "image") return positiveNumber(options.count ?? options.n ?? options.images, 1);
  if (price.unit === "song") return positiveNumber(options.count ?? options.songs, 1);
  if (price.unit === "second") return positiveNumber(options.duration ?? options.seconds, price.durationSeconds || 6);
  if (price.unit === "thousand_tokens") {
    const tokens = positiveNumber(options.tokens ?? options.estimatedTokens, 1000);
    return Math.max(1, tokens / 1000);
  }
  const text = [options.text, options.prompt, options.lyrics].filter((v) => typeof v === "string").join("\n");
  return Math.max(1, text.length || positiveNumber(options.characters, 1000));
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveArticleCount(options: Record<string, unknown>): number {
  const raw = options.count ?? options.articles ?? options.n;
  const count = parseArticleCount(raw);
  return count ?? 1;
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

function microsToBillableCents(costMicros: number): number {
  if (costMicros <= 0) return 0;
  return Math.max(1, Math.ceil(costMicros / 10_000));
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function resolvePricingSlug(slug: string): string {
  return resolveSkillAlias(slug);
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getAllPremiumSlugs(): string[] {
  return [...PREMIUM_SKILLS.map((s) => s.slug), ARTICLE_GENERATION_SLUG];
}
