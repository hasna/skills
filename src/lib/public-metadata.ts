const RUNTIME_IDENTITIES = new Set([
  "anthropic",
  "cerebras",
  "claude",
  "dalle",
  "elevenlabs",
  "exa",
  "firecrawl",
  "gemini",
  "googleai",
  "gpt",
  "minimax",
  "lyria",
  "openai",
  "openrouter",
  "seedance",
  "sora",
  "veo",
  "whisper",
  "xai",
]);

const INTERNAL_COMPOSITE_KEYS = /(?:provider(?:name|id|key|code|status|error|type|mode|route|routing|cost)|vendor(?:name|id|key|code|status|error|type)|model(?:name|id|key|type|route|routing)|routing(?:id|key|type|strategy)|route(?:id|key|type|name)|settlement(?:id|key|ref|route|routingid)|margin(?:amount|value)|cost(?:cents?|amount|value)|price(?:cents?|amount|value)|currencycode)/i;
const FIAT_MARKERS = /\$|\b(?:fiat|pricing|prices?|cents?|usd|eur|gbp|jpy)\b/i;
const PRIVATE_ASSIGNMENT = /\b(?:provider|vendor|model|routing|route|settlement)\s*(?:=|:)\s*(?:private|internal|secret|[a-z0-9._-]*(?:provider|model|route|secret))/i;

/**
 * Detect execution-runtime identities and internal accounting or routing
 * metadata in customer-visible values. Generic domain language such as
 * "financial model", "route lists", and "action-item-router" is not an
 * execution identity and remains valid.
 */
export function containsProhibitedPublicMetadata(value: string): boolean {
  const canonical = canonicalMetadataText(value);
  const compact = compactMetadataText(value);
  return containsRuntimeIdentity(value)
    || INTERNAL_COMPOSITE_KEYS.test(compact)
    || FIAT_MARKERS.test(canonical)
    || PRIVATE_ASSIGNMENT.test(canonical);
}

/** Opaque IDs may contain business words but never a runtime identity/key. */
export function containsProhibitedPublicIdentity(value: string): boolean {
  const compact = compactMetadataText(value);
  return containsRuntimeIdentity(value)
    || INTERNAL_COMPOSITE_KEYS.test(compact)
    || PRIVATE_ASSIGNMENT.test(canonicalMetadataText(value));
}

/** Strict key-context check for endpoint schema validation. */
export function isProhibitedPublicKey(value: string): boolean {
  const compact = compactMetadataText(value);
  return containsRuntimeIdentity(value)
    || INTERNAL_COMPOSITE_KEYS.test(compact)
    || /^(?:provider|vendor|model|routing|route|settlement|margin|fiat|pricing|price|cost|cents?|currency)$/i.test(compact);
}

export function containsRuntimeIdentity(value: string): boolean {
  const tokens = metadataTokens(value);
  if (tokens.some((token) => RUNTIME_IDENTITIES.has(token))) return true;
  const pairs = tokens.slice(0, -1).map((token, index) => `${token}${tokens[index + 1]}`);
  if (pairs.some((pair) => RUNTIME_IDENTITIES.has(pair) || pair === "claudecode" || pair === "dalle")) return true;

  // Versioned runtime names may be fused into otherwise lowercase text. Match
  // the identity only when it is immediately followed by a version number;
  // this catches evasions without turning ordinary words into substring hits.
  const compact = compactMetadataText(value);
  return /(?:anthropic|cerebras|claude(?:code)?|dalle|elevenlabs|exa|firecrawl|gemini|gpt|googleai|lyria|minimax|openai|openrouter|seedance|sora|veo|whisper|xai)\d/i.test(compact)
    || /^(?:anthropic|cerebras|claude(?:code)?|dalle|elevenlabs|exa|firecrawl|gemini|gpt|googleai|lyria|minimax|openai|openrouter|seedance|sora|veo|whisper|xai)$/i.test(compact);
}

function metadataTokens(value: string): string[] {
  return canonicalMetadataText(value)
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function compactMetadataText(value: string): string {
  return value.normalize("NFKC").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function canonicalMetadataText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}
