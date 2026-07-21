import type { PublicSkillPricing } from "./pricing.js";

export interface PublicCreditQuote {
  tier: "free" | "premium";
  billingUnit: PublicSkillPricing["billingUnit"];
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
  const record = isRecord(value) ? value : {};
  const credits = finiteNumber(record.credits)
    ?? finiteNumber(record.costCents)
    ?? creditsFromString(record.formattedCredits)
    ?? creditsFromString(record.formattedCost)
    ?? 0;
  const billingUnit = isBillingUnit(record.billingUnit) ? record.billingUnit : "run";
  const tier = record.tier === "free" || credits === 0 ? "free" : "premium";
  const estimated = record.estimated === true;
  const unitCount = finiteNumber(record.unitCount);
  const quoteDependsOnInput = record.quoteDependsOnInput === true;
  const quoteRequired = record.quoteRequired === true;

  return {
    tier,
    billingUnit,
    credits,
    formattedCredits: creditOnlyText(record.formattedCredits)
      ?? creditOnlyText(record.formattedCost)
      ?? formatCredits(credits, { billingUnit, estimated, tier }),
    ...(finiteNumber(record.unitCredits) !== undefined
      ? { formattedUnitCredits: formatCredits(finiteNumber(record.unitCredits)!, { billingUnit, tier }) }
      : creditOnlyText(record.formattedUnitCredits)
        ? { formattedUnitCredits: creditOnlyText(record.formattedUnitCredits)! }
        : creditOnlyText(record.formattedUnitCost)
          ? { formattedUnitCredits: creditOnlyText(record.formattedUnitCost)! }
      : typeof record.formattedUnitCost === "string"
        ? { formattedUnitCredits: formatCredits(creditsForFormattedUnit(record.formattedUnitCost, credits), { billingUnit, tier }) }
        : {}),
    ...(unitCount !== undefined ? { unitCount } : {}),
    estimated,
    quoteDependsOnInput,
    quoteRequired,
    description: creditDescription(record.description, { estimated, quoteDependsOnInput, tier }),
  };
}

export function formatCredits(
  credits: number,
  options: { billingUnit?: string; estimated?: boolean; tier?: "free" | "premium" } = {},
): string {
  if (options.tier === "free" || credits === 0) return "0 credits";
  const amount = Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(4)));
  if (options.estimated) return `${amount} credits estimated`;
  return `${amount} credits/${options.billingUnit || "run"}`;
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
    if (key === "pricing") {
      if (hasPublicCredits(nested)) output.creditQuote = toPublicCreditQuote(nested);
      continue;
    }
    if (key === "costCents") {
      output.credits = nested;
      continue;
    }
    if (key === "amountCents") {
      output.credits = nested;
      continue;
    }
    if (key === "balanceCents") {
      output.creditBalance = nested;
      continue;
    }
    if (key === "formattedCost" || key === "formattedUnitCost") continue;
    if (key === "price" || key === "cost") continue;
    if ((key === "pack" || key === "label") && typeof nested === "string" && /\$|usd|eur|gbp/i.test(nested)) continue;
    if (key === "balance" && typeof nested === "string" && !/credits?/i.test(nested)) continue;
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
    .replace(/\bno balance was charged\b/gi, "No credits were charged")
    .replace(/\b(?:your|the) balance was not charged\b/gi, (match) => `${match.split(" ")[0]} credits were not charged`)
    .replace(/\binsufficient account balance\b/gi, "Insufficient account credits")
    .replace(/\binsufficient balance\b/gi, "Insufficient credits")
    .replace(/\baccount balance\b/gi, "account credits")
    .replace(/\bfinal price\b/gi, "final credit amount")
    .replace(/\bpricing\b/gi, "credit quote")
    .replace(/\bprice\b/gi, "credit amount");
}

function creditDescription(
  value: unknown,
  options: { estimated: boolean; quoteDependsOnInput: boolean; tier: "free" | "premium" },
): string {
  if (options.tier === "free") return "No credits required.";
  if (typeof value === "string" && value.trim()) {
    return value
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

function creditsForFormattedUnit(value: string, fallback: number): number {
  if (/\$|usd|eur|gbp|cents?/i.test(value)) return fallback;
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function hasPublicCredits(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return finiteNumber(value.credits) !== undefined
    || finiteNumber(value.costCents) !== undefined
    || creditsFromString(value.formattedCredits) !== undefined
    || creditsFromString(value.formattedCost) !== undefined;
}

function creditsFromString(value: unknown): number | undefined {
  if (typeof value !== "string" || !/credits?/i.test(value) || /\$|usd|eur|gbp/i.test(value)) return undefined;
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function creditOnlyText(value: unknown): string | undefined {
  return typeof value === "string" && /credits?/i.test(value) && !/\$|usd|eur|gbp/i.test(value)
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBillingUnit(value: unknown): value is PublicSkillPricing["billingUnit"] {
  return ["run", "image", "second", "character", "song", "thousand_tokens", "article"].includes(String(value));
}
