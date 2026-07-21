export type CreditUnit = "run" | "image" | "second" | "character" | "song" | "thousand_tokens" | "article";

export interface InternalCreditPricing {
  tier: "free" | "premium";
  billingUnit: CreditUnit;
  costCents: number;
  formattedCost: string;
  formattedUnitCost?: string;
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

  return {
    tier,
    creditUnit,
    credits,
    formattedCredits: creditOnlyText(record.formattedCredits)
      ?? creditOnlyText(record.formattedCost)
      ?? formatCredits(credits, { creditUnit, estimated, tier }),
    ...(finiteNumber(record.unitCredits) !== undefined
      ? { formattedUnitCredits: formatCredits(finiteNumber(record.unitCredits)!, { creditUnit, tier }) }
      : creditOnlyText(record.formattedUnitCredits)
        ? { formattedUnitCredits: creditOnlyText(record.formattedUnitCredits)! }
      : {}),
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

/** Converts the package-owned pricing model. This is not a remote-input adapter. */
export function internalPricingToCreditQuote(value: InternalCreditPricing): PublicCreditQuote {
  return toPublicCreditQuote({
    tier: value.tier,
    creditUnit: value.billingUnit,
    credits: value.costCents,
    formattedCredits: creditOnlyText(value.formattedCost),
    ...(value.formattedUnitCost && creditOnlyText(value.formattedUnitCost)
      ? { formattedUnitCredits: creditOnlyText(value.formattedUnitCost) }
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
  const credits = finiteNumber(value.costCents);
  if (credits === undefined) throw new Error("Legacy credit quote requires a valid costCents amount.");
  const creditUnit = isCreditUnit(value.billingUnit) ? value.billingUnit : undefined;
  if (!creditUnit) throw new Error("Legacy credit quote requires a valid billingUnit.");
  if (value.tier !== "free" && value.tier !== "premium") throw new Error("Legacy credit quote requires tier.");
  for (const flag of ["estimated", "quoteDependsOnInput", "quoteRequired"] as const) {
    if (typeof value[flag] !== "boolean") throw new Error(`Legacy credit quote requires ${flag}.`);
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("Legacy credit quote requires description.");
  }
  return toPublicCreditQuote({
    tier: value.tier,
    creditUnit,
    credits,
    ...(creditOnlyText(value.formattedCredits) ? { formattedCredits: value.formattedCredits } : {}),
    ...(creditOnlyText(value.formattedUnitCredits) ? { formattedUnitCredits: value.formattedUnitCredits } : {}),
    ...(finiteNumber(value.unitCount) !== undefined ? { unitCount: value.unitCount } : {}),
    estimated: value.estimated === true,
    quoteDependsOnInput: value.quoteDependsOnInput === true,
    quoteRequired: value.quoteRequired === true,
    description: value.description,
  });
}

export function formatCredits(
  credits: number,
  options: { creditUnit?: string; estimated?: boolean; tier?: "free" | "premium" } = {},
): string {
  if (options.tier === "free" || credits === 0) return "0 credits";
  const amount = Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(4)));
  if (options.estimated) return `${amount} credits estimated`;
  return `${amount} credits/${options.creditUnit || "run"}`;
}

/**
 * Removes internal monetary/accounting names from data printed by the CLI or MCP.
 * The server may retain legacy fields internally; customer output is credits-only.
 */
export function toCustomerCreditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCustomerCreditPayload);
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  const legacyV1 = value.contractVersion === 1;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "creditQuote") {
      output.creditQuote = isCreditQuoteCandidate(nested)
        ? toAuthoritativePublicCreditQuote(nested)
        : toCustomerCreditPayload(nested);
      continue;
    }
    if (key === "pricing") {
      if (!hasOwn(value, "creditQuote") && legacyV1) output.creditQuote = versionedLegacyCreditQuote(nested, 1);
      continue;
    }
    if (key === "costCents") {
      if (legacyV1 && !hasOwn(value, "credits") && finiteNumber(nested) !== undefined) output.credits = nested;
      continue;
    }
    if (key === "amountCents") {
      if (legacyV1 && !hasOwn(value, "amountCredits") && typeof nested === "number" && Number.isFinite(nested)) output.amountCredits = nested;
      continue;
    }
    if (key === "recentNetAmountCents") {
      if (legacyV1 && !hasOwn(value, "recentNetAmountCredits") && typeof nested === "number" && Number.isFinite(nested)) output.recentNetAmountCredits = nested;
      continue;
    }
    if (key === "balanceCents") {
      if (legacyV1 && !hasOwn(value, "creditBalance") && finiteNumber(nested) !== undefined) output.creditBalance = nested;
      continue;
    }
    if (key === "billingUnit") {
      if (!hasOwn(value, "creditUnit")) output.creditUnit = nested;
      continue;
    }
    if (key === "formattedBalance") {
      if (!hasOwn(value, "formattedCreditBalance")) {
        const formatted = creditOnlyText(nested);
        if (formatted) output.formattedCreditBalance = formatted;
      }
      continue;
    }
    if (key === "formattedCost") {
      if (!hasOwn(value, "formattedCredits")) {
        const formatted = creditOnlyText(nested);
        if (formatted) output.formattedCredits = formatted;
      }
      continue;
    }
    if (key === "formattedUnitCost") {
      if (!hasOwn(value, "formattedUnitCredits")) {
        const formatted = creditOnlyText(nested);
        if (formatted) output.formattedUnitCredits = formatted;
      }
      continue;
    }
    if (key === "price" || key === "cost") continue;
    if ((key === "pack" || key === "label") && typeof nested === "string" && /\$|usd|eur|gbp/i.test(nested)) continue;
    if (key === "balance") {
      if (!hasOwn(value, "formattedCreditBalance")) {
        const formatted = creditOnlyText(nested);
        if (formatted) output.formattedCreditBalance = formatted;
      }
      continue;
    }
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
  if (typeof value === "string" && value.trim()) {
    return sanitizeCustomerCreditText(value)
      .replace(/\bFinal price\b/g, "Final credit amount")
      .replace(/\bfinal price\b/gi, "final credit amount")
      .replace(/\bprice\b/gi, "credit amount")
      .replace(/\bpricing\b/gi, "credit quote")
      .replace(/\bpriced\b/gi, "quoted")
      .trim();
  }
  return options.estimated || options.quoteDependsOnInput
    ? "Estimated credits. The final credit amount depends on run options."
    : "Fixed credits per run.";
}

function creditOnlyText(value: unknown): string | undefined {
  return typeof value === "string" && /credits?/i.test(value) && !/\$|usd|eur|gbp|cents?/i.test(value)
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
