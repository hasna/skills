import { containsProhibitedPublicMetadata } from "./public-metadata.js";

export type CreditUnit = "run" | "image" | "second" | "character" | "song" | "thousand_tokens" | "article";

export interface InternalCreditConfiguration {
  tier: "free" | "premium";
  creditUnit: CreditUnit;
  credits: number;
  formattedCredits: string;
  formattedUnitCredits?: string;
  unitCount?: number;
  estimated: boolean;
  quoteDependsOnInput: boolean;
  quoteRequired: boolean;
  description: string;
}

export interface PublicCreditQuote {
  tier: "free" | "premium";
  creditUnit: CreditUnit;
  credits: number;
  formattedCredits: string;
  formattedUnitCredits?: string;
  unitCount?: number;
  estimated: boolean;
  quoteDependsOnInput: boolean;
  quoteRequired: boolean;
  description: string;
}

export function toPublicCreditQuote(value: unknown): PublicCreditQuote {
  if (!isRecord(value)) throw new Error("Credit quote must be an object with explicit credits.");
  const record = value;
  const explicitCredits = finiteNumber(record.credits);
  if (explicitCredits === undefined) {
    throw new Error("Credit quote requires explicit credits; missing or unknown amounts are not free.");
  }
  const credits = explicitCredits;
  if (record.tier === "free" && credits > 0) {
    throw new Error("A free credit quote cannot require positive credits.");
  }
  const creditUnit = isCreditUnit(record.creditUnit)
    ? record.creditUnit
    : credits === 0
      ? "run"
      : undefined;
  if (!creditUnit) throw new Error("Credit quote requires an explicit creditUnit.");
  const tier = credits === 0 ? "free" : "premium";
  const estimated = record.estimated === true;
  const unitCount = finiteNumber(record.unitCount);
  const quoteDependsOnInput = record.quoteDependsOnInput === true;
  const quoteRequired = record.quoteRequired === true;
  const formattedCredits = formatCredits(credits, { creditUnit, estimated, tier, unitCount });
  if (record.formattedCredits !== undefined && record.formattedCredits !== formattedCredits) {
    throw new Error("Credit quote formattedCredits does not match its numeric credits and unit metadata.");
  }
  const formattedUnitCredits = canonicalFormattedUnitCredits(record, { creditUnit, unitCount });

  return {
    tier,
    creditUnit,
    credits,
    formattedCredits,
    ...(formattedUnitCredits ? { formattedUnitCredits } : {}),
    ...(unitCount !== undefined ? { unitCount } : {}),
    estimated,
    quoteDependsOnInput,
    quoteRequired,
    description: creditDescription(record.description, { estimated, quoteDependsOnInput, tier }),
  };
}

export function toAuthoritativePublicCreditQuote(value: unknown): PublicCreditQuote {
  if (!isRecord(value)) throw new Error("Authoritative credit quote must be an object.");
  if (value.tier !== "free" && value.tier !== "premium") throw new Error("Authoritative credit quote requires tier.");
  if (finiteNumber(value.credits) === undefined) throw new Error("Authoritative credit quote requires credits.");
  if (!isCreditUnit(value.creditUnit)) throw new Error("Authoritative credit quote requires creditUnit.");
  if (!creditOnlyText(value.formattedCredits)) throw new Error("Authoritative credit quote requires formattedCredits in credits.");
  for (const flag of ["estimated", "quoteDependsOnInput", "quoteRequired"] as const) {
    if (typeof value[flag] !== "boolean") throw new Error(`Authoritative credit quote requires ${flag}.`);
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("Authoritative credit quote requires description.");
  }
  return toPublicCreditQuote(value);
}

/** Converts the package-owned credit configuration. This is not a remote-input adapter. */
export function internalCreditConfigurationToQuote(value: InternalCreditConfiguration): PublicCreditQuote {
  return toPublicCreditQuote({
    tier: value.tier,
    creditUnit: value.creditUnit,
    credits: value.credits,
    formattedCredits: creditOnlyText(value.formattedCredits),
    ...(value.formattedUnitCredits && creditOnlyText(value.formattedUnitCredits)
      ? { formattedUnitCredits: creditOnlyText(value.formattedUnitCredits) }
      : {}),
    ...(value.unitCount !== undefined ? { unitCount: value.unitCount } : {}),
    estimated: value.estimated,
    quoteDependsOnInput: value.quoteDependsOnInput,
    quoteRequired: value.quoteRequired,
    description: value.description,
  });
}

/** Isolated adapter for the one known legacy remote contract. */
export function versionedLegacyCreditQuote(value: unknown, contractVersion: unknown): PublicCreditQuote {
  if (contractVersion !== 1) throw new Error("Unsupported legacy credit contract version.");
  if (!isRecord(value)) throw new Error("Legacy credit quote must be an object.");
  throw new Error("Legacy credit contract v1 requires an explicit creditQuote; fiat fields cannot define credits.");
}

export function formatCredits(
  credits: number,
  options: {
    creditUnit?: string;
    estimated?: boolean;
    tier?: "free" | "premium";
    unitCount?: number;
  } = {},
): string {
  if (options.tier === "free" || credits === 0) return "0 credits";
  const amount = Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(4)));
  if (options.estimated) return `${amount} credits estimated`;
  if (options.unitCount !== undefined && options.unitCount > 1) return `${amount} credits total`;
  return `${amount} credits/${options.creditUnit || "run"}`;
}

function canonicalFormattedUnitCredits(
  record: Record<string, unknown>,
  options: { creditUnit: CreditUnit; unitCount: number | undefined },
): string | undefined {
  const derivedUnitCredits = options.unitCount !== undefined && options.unitCount > 0
    ? finiteNumber(finiteNumber(record.credits)! / options.unitCount)
    : undefined;
  if (record.formattedUnitCredits === undefined) return undefined;
  if (derivedUnitCredits === undefined) {
    throw new Error("Credit quote formattedUnitCredits requires numeric unit credit metadata.");
  }
  const formattedUnitCredits = formatCredits(derivedUnitCredits, { creditUnit: options.creditUnit });
  if (record.formattedUnitCredits !== undefined && record.formattedUnitCredits !== formattedUnitCredits) {
    throw new Error("Credit quote formattedUnitCredits does not match its numeric credits and unit metadata.");
  }
  return formattedUnitCredits;
}

/**
 * Removes internal monetary/accounting names from data printed by the CLI or MCP.
 * The server may retain legacy fields internally; customer output is credits-only.
 */
export function toCustomerCreditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCustomerCreditPayload);
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "creditQuote") {
      output.creditQuote = isCreditQuoteCandidate(nested)
        ? toAuthoritativePublicCreditQuote(nested)
        : toCustomerCreditPayload(nested);
      continue;
    }
    if (key === "pricing") {
      continue;
    }
    if ([
      ["cost", "Cents"].join(""),
      "amountCents",
      "recentNetAmountCents",
      "balanceCents",
      "billingUnit",
      "formattedBalance",
      "formattedCost",
      "formattedUnitCost",
    ].includes(key)) continue;
    if (key === "price" || key === "cost") continue;
    if ((key === "pack" || key === "label") && typeof nested === "string" && /\$|usd|eur|gbp/i.test(nested)) continue;
    if (key === "balance") continue;
    if (key === "formattedCredits" || key === "formattedUnitCredits" || key === "formattedCreditBalance") {
      const formatted = creditOnlyText(nested);
      if (formatted) output[key] = formatted;
      continue;
    }
    output[key] = isCustomerMessageField(key)
      ? sanitizeCustomerMessageValue(nested)
      : toCustomerCreditPayload(nested);
  }
  return output;
}

const CUSTOMER_MESSAGE_FIELDS = new Set(["message", "error", "detail", "details", "reason"]);

function isCustomerMessageField(key: string): boolean {
  return CUSTOMER_MESSAGE_FIELDS.has(key);
}

function sanitizeCustomerMessageValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeCustomerCreditText(value);
  if (Array.isArray(value)) return value.map(sanitizeCustomerMessageValue);
  if (isRecord(value)) return toCustomerCreditPayload(value);
  return value;
}

export function sanitizeCustomerCreditText(value: string): string {
  return value
    .replace(/(?:\$|\b(?:usd|eur|gbp)\b)\s*\d+(?:\.\d+)?/gi, "credit amount")
    .replace(/\b(\d+(?:\.\d+)?)\s+cents?\b/gi, "$1 credits")
    .replace(/\bno balance was charged\b/gi, "No credits were charged")
    .replace(/\b(?:your|the) balance was not charged\b/gi, (match) => `${match.split(" ")[0]} credits were not charged`)
    .replace(/\binsufficient account balance\b/gi, "Insufficient account credits")
    .replace(/\binsufficient balance\b/gi, "Insufficient credits")
    .replace(/\baccount balance\b/gi, "account credits")
    .replace(/\bfinal price\b/gi, (match) => match[0] === "F" ? "Final credit amount" : "final credit amount")
    .replace(/\bpricing\b/gi, "credit quote")
    .replace(/\bprice\b/gi, "credit amount")
    .replace(/\bcosts?\b/gi, "credit amount");
}

function creditDescription(
  value: unknown,
  options: { estimated: boolean; quoteDependsOnInput: boolean; tier: "free" | "premium" },
): string {
  if (options.tier === "free") return "No credits required.";
  void value;
  return options.estimated || options.quoteDependsOnInput
    ? "Estimated credits. The final credit amount depends on run options."
    : "Fixed credits per run.";
}

function creditOnlyText(value: unknown): string | undefined {
  return typeof value === "string"
    && /credits?/i.test(value)
    && !containsProhibitedPublicMetadata(value)
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isCreditUnit(value: unknown): value is CreditUnit {
  return ["run", "image", "second", "character", "song", "thousand_tokens", "article"].includes(String(value));
}

function isCreditQuoteCandidate(value: unknown): boolean {
  return isRecord(value) && (
    hasOwn(value, "tier")
    || hasOwn(value, "credits")
    || hasOwn(value, "creditUnit")
    || hasOwn(value, "formattedCredits")
  );
}
