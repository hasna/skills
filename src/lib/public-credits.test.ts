import { describe, expect, test } from "bun:test";
import { formatCredits, toCustomerCreditPayload, toPublicCreditQuote } from "./public-credits";

describe("public credit presentation", () => {
  test("normalizes legacy internal accounting to a credit-only quote", () => {
    expect(toPublicCreditQuote({
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
      billingUnit: "image",
      credits: 12,
      formattedCredits: "12 credits estimated",
      description: "Final credit amount depends on options.",
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
    expect(payload).toMatchObject({
      creditQuote: { credits: 25, formattedCredits: "25 credits/run" },
      creditBalance: 500,
      credits: 25,
      nested: {},
    });
    expect(serialized).not.toContain("pricing");
    expect(serialized).not.toContain("Cents");
    expect(serialized).not.toContain("$");
    expect(serialized.toLowerCase()).not.toContain("usd");
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

  test("formats free, fixed, and estimated credits", () => {
    expect(formatCredits(0, { tier: "free" })).toBe("0 credits");
    expect(formatCredits(8, { billingUnit: "run" })).toBe("8 credits/run");
    expect(formatCredits(9, { billingUnit: "image", estimated: true })).toBe("9 credits estimated");
  });
});
