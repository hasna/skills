import { describe, expect, test } from "bun:test";
import {
  formatCredits,
  internalPricingToCreditQuote,
  toCustomerCreditPayload,
  toAuthoritativePublicCreditQuote,
  toPublicCreditQuote,
  versionedLegacyCreditQuote,
} from "./public-credits";

describe("public credit presentation", () => {
  test("normalizes legacy internal accounting to a credit-only quote", () => {
    expect(internalPricingToCreditQuote({
      tier: "premium",
      billingUnit: "image",
      costCents: 12,
      formattedCost: "$0.12 estimated",
      estimated: true,
      quoteDependsOnInput: true,
      quoteRequired: true,
      description: "Final price depends on options.",
    })).toMatchObject({
      tier: "premium",
      creditUnit: "image",
      credits: 12,
      formattedCredits: "12 credits estimated",
      description: "Final credit amount depends on options.",
    });
  });

  test("fails closed when a canonical quote has no explicit credit amount", () => {
    expect(() => toPublicCreditQuote({ creditUnit: "run" })).toThrow("explicit credits");
    expect(() => toPublicCreditQuote({ tier: "premium", creditUnit: "run" })).toThrow("explicit credits");
    expect(() => toPublicCreditQuote({ tier: "free" })).toThrow("explicit credits");
    expect(toPublicCreditQuote({ credits: 0, creditUnit: "run" })).toMatchObject({ tier: "free", credits: 0 });
  });

  test("accepts legacy cents only through a validated versioned adapter", () => {
    const legacy = {
      tier: "premium" as const,
      billingUnit: "run",
      costCents: 8,
      estimated: false,
      quoteDependsOnInput: false,
      quoteRequired: false,
      description: "Known v1 quote",
    };
    expect(() => versionedLegacyCreditQuote(legacy, 2)).toThrow("version");
    expect(versionedLegacyCreditQuote(legacy, 1)).toMatchObject({
      tier: "premium",
      creditUnit: "run",
      credits: 8,
    });
  });

  test("requires complete authoritative remote quote metadata", () => {
    expect(() => toAuthoritativePublicCreditQuote({
      tier: "premium",
      creditUnit: "run",
      credits: 8,
      formattedCredits: "8 credits/run",
    })).toThrow("estimated");
    expect(() => toCustomerCreditPayload({
      creditQuote: { tier: "free" },
    })).toThrow("credits");
    expect(toCustomerCreditPayload({
      properties: {
        creditQuote: { type: "object", properties: { credits: { type: "number" } } },
      },
    })).toEqual({
      properties: {
        creditQuote: { type: "object", properties: { credits: { type: "number" } } },
      },
    });
  });

  test("removes customer-visible monetary labels and field names recursively", () => {
    const payload = toCustomerCreditPayload({
      pricing: { tier: "premium", costCents: 25, formattedCost: "$0.25/run" },
      balanceCents: 500,
      amountCents: 25,
      pack: "$5",
      nested: { cost: "$0.25", label: "USD price" },
    });
    const serialized = JSON.stringify(payload);
    expect(payload).toEqual({ nested: {} });
    expect(serialized).not.toContain("pricing");
    expect(serialized).not.toContain("Cents");
    expect(serialized).not.toContain("$");
    expect(serialized.toLowerCase()).not.toContain("usd");
  });

  test("does not generically reinterpret unversioned cents as credits", () => {
    const payload = toCustomerCreditPayload({
      amountCents: -12,
      recentNetAmountCents: 34,
      balanceCents: 500,
      formattedBalance: "500 credits",
      costCents: 9,
      formattedCost: "9 credits/run",
      billingUnit: "run",
      nested: {
        pricing: {
          billingUnit: "image",
          costCents: 7,
          formattedCost: "$0.07/image",
        },
      },
    });

    expect(payload).toEqual({
      formattedCreditBalance: "500 credits",
      formattedCredits: "9 credits/run",
      creditUnit: "run",
      nested: {},
    });
    expect(JSON.stringify(payload)).not.toMatch(/pricing|Cents|billingUnit|formattedCost/);
  });

  test("maps known v1 legacy response aliases at the versioned contract boundary", () => {
    expect(toCustomerCreditPayload({
      contractVersion: 1,
      costCents: 9,
      balanceCents: 500,
      amountCents: -9,
      recentNetAmountCents: -18,
      pricing: {
        tier: "premium",
        billingUnit: "run",
        costCents: 9,
        formattedCost: "$0.09/run",
        estimated: false,
        quoteDependsOnInput: false,
        quoteRequired: false,
        description: "Known v1 quote",
      },
    })).toMatchObject({
      contractVersion: 1,
      credits: 9,
      creditBalance: 500,
      amountCredits: -9,
      recentNetAmountCredits: -18,
      creditQuote: { creditUnit: "run", credits: 9 },
    });
  });

  test("preserves canonical fields when legacy aliases are also present", () => {
    expect(toCustomerCreditPayload({
      creditBalance: 20,
      balanceCents: 999,
      amountCredits: 4,
      amountCents: 888,
      recentNetAmountCredits: -2,
      recentNetAmountCents: 777,
    })).toEqual({
      creditBalance: 20,
      amountCredits: 4,
      recentNetAmountCredits: -2,
    });
  });

  test("normalizes known nested API message fields without mutating opaque values", () => {
    const payload = toCustomerCreditPayload({
      id: "run_balance_unchanged",
      artifactUrl: "https://example.test/artifacts/no-balance-was-charged.json",
      message: "No balance was charged.",
      nested: {
        error: "Insufficient account balance.",
        details: ["Your balance was not charged.", "Retry later."],
        opaque: "balance_was_charged_identifier",
      },
    });

    expect(payload).toEqual({
      id: "run_balance_unchanged",
      artifactUrl: "https://example.test/artifacts/no-balance-was-charged.json",
      message: "No credits were charged.",
      nested: {
        error: "Insufficient account credits.",
        details: ["Your credits were not charged.", "Retry later."],
        opaque: "balance_was_charged_identifier",
      },
    });
  });

  test("removes fiat and cost wording from customer messages", () => {
    const payload = toCustomerCreditPayload({
      error: "Final cost is $0.25 (25 cents).",
      details: ["This price is USD 0.25."],
      formattedCredits: "25 cents",
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/\$|usd|cents?|\bcost\b|\bprice\b/i);
    expect(payload).toEqual({
      error: "Final credit amount is credit amount (25 credits).",
      details: ["This credit amount is credit amount."],
    });
  });

  test("formats free, fixed, and estimated credits", () => {
    expect(formatCredits(0, { tier: "free" })).toBe("0 credits");
    expect(formatCredits(8, { creditUnit: "run" })).toBe("8 credits/run");
    expect(formatCredits(9, { creditUnit: "image", estimated: true })).toBe("9 credits estimated");
  });
});
