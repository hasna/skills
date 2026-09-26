/**
 * Input validation for the `blog-article` skill.
 *
 * This is ordinary run-option validation — topic, tone, length, SEO flag, and
 * article count — surfaced at the CLI/MCP layer so a bad invocation fails with a
 * clear message before the skill runs. It carries no pricing or billing concern.
 */

export const ARTICLE_GENERATION_SLUG = "blog-article";
export const ARTICLE_MAX_COUNT = 12;
export const ARTICLE_COUNT_ERROR = `Count must be an integer between 1 and ${ARTICLE_MAX_COUNT}.`;

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
