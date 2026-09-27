import type { RemoteInputFileDescriptor } from "./remote-files.js";
/** Optional account APIs supplied by a configured Skills server. No local prices or provider policy. */
export interface RemoteRunQuote {
  skill: string;
  /** Opaque server binding for this exact quote; retain verbatim for approval. */
  quoteReceipt?: string;
  pricing: { costCents: number; formattedCost: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface RemoteRunApproval {
  /** A previously quoted server binding. Never refresh it after user approval. */
  quoteReceipt?: string;
  /** Preferred public spelling: maximum integer credits approved by the caller. */
  maxCredits?: number;
  /** Maximum integer credits approved by the caller (legacy wire spelling). */
  maxCostCents?: number;
  idempotencyKey?: string;
  inputFiles?: RemoteInputFileDescriptor[];
}

export interface RemoteCreditPack {
  id: string;
  credits: number;
  expiresInDays?: number;
}

export class RemoteCreditApprovalError extends Error {
  readonly code = "CREDIT_APPROVAL_REQUIRED";
  constructor(readonly requiredCredits: number, readonly maximumCredits: number) {
    super(`This run requires ${requiredCredits} credits; the approved maximum is ${maximumCredits}. Quote the run and explicitly approve its cost.`);
    this.name = "RemoteCreditApprovalError";
  }
}

export function creditCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error("The Skills server returned an invalid credit count");
  }
  return value;
}

export function runQuoteReceipt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > 4096) {
    throw new Error("Invalid quote receipt");
  }
  return value;
}

export function parseRemoteRunQuote(value: unknown): RemoteRunQuote {
  const quote = object(value);
  runQuoteReceipt(quote.quoteReceipt);
  const pricing = object(quote.pricing);
  if (typeof quote.skill !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(quote.skill)) throw new Error("Invalid quoted skill");
  const costCents = creditCount(pricing.costCredits ?? pricing.costCents);
  if (pricing.costCredits !== undefined && pricing.costCents !== undefined && pricing.costCents !== costCents) throw new Error("Inconsistent quoted credit count");
  if (quote.availability && object(quote.availability).status !== "available") throw new Error("This skill is unavailable for remote execution");
  // The count is authoritative; never render a server's money-formatted legacy label as credits.
  return { ...quote, skill: quote.skill, pricing: { ...pricing, costCredits: costCents, costCents, formattedCost: `${costCents} credits` } };
}

export function parseRemoteCreditPacks(value: unknown): RemoteCreditPack[] {
  if (!Array.isArray(value)) throw new Error("Invalid credit pack response");
  const ids = new Set<string>();
  return value.map(value => {
    const row = object(value);
    const counts = [row.credits, row.creditsCents, row.amountCents].filter(value => value !== undefined).map(creditCount);
    if (!counts.length || counts[0] === 0 || counts.some(count => count !== counts[0])) throw new Error("Inconsistent credit pack counts");
    const credits = counts[0]!;
    const id = row.id ?? `credits_${credits}`;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id) || ids.has(id)) throw new Error("Invalid credit pack ID");
    if (id.startsWith("credits_") && id !== `credits_${credits}`) throw new Error("Inconsistent credit pack ID");
    ids.add(id);
    return { id, credits, ...(row.expiresInDays === undefined ? {} : { expiresInDays: creditCount(row.expiresInDays) }) };
  });
}

export function parseRemoteBillingStatus(value: unknown) {
  const row = object(value);
  const counts = [row.creditBalance, row.balanceCents].filter(value => value !== undefined).map(creditCount);
  if (!counts.length || counts.some(count => count !== counts[0])) throw new Error("Inconsistent credit balance");
  return { creditBalance: counts[0]!, formattedCreditBalance: `${counts[0]} credits`,
    ...(typeof row.plan === "string" ? { plan: row.plan } : {}),
    ...(typeof row.hasPaymentMethod === "boolean" ? { hasPaymentMethod: row.hasPaymentMethod } : {}) };
}

export function parseRemoteCheckout(value: unknown): { url: string } {
  const row = object(value);
  if (typeof row.url !== "string") throw new Error("Invalid checkout URL");
  const url = new URL(row.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid checkout URL");
  return { url: row.url };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Skills server response");
  return value as Record<string, unknown>;
}
