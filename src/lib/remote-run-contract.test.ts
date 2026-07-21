import { describe, expect, test } from "bun:test";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
} from "./remote-run-contract";

describe("remote skill run contract", () => {
  test("normalizes submitted run payloads for CLI, MCP, and web clients", () => {
    const run = normalizeRemoteSkillRunContract({
      contractVersion: 1,
      id: "run_123",
      skill: "image",
      status: "queued",
      exitCode: 0,
      correlationId: "corr_123",
      costCents: 4,
      pricing: {
        tier: "premium",
        billingUnit: "image",
        costCents: 4,
        formattedCost: "$0.04 estimated",
        estimated: true,
        quoteDependsOnInput: true,
        quoteRequired: true,
        description: "Hosted image generation",
      },
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(run).toMatchObject({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      id: "run_123",
      skill: "image",
      status: "queued",
      exitCode: 0,
      correlationId: "corr_123",
      credits: 4,
      creditQuote: {
        tier: "premium",
        creditUnit: "image",
        quoteDependsOnInput: true,
      },
    });
    expect(JSON.stringify(run)).not.toMatch(/pricing|Cents|billingUnit|formattedCost/);
  });

  test("normalizes error payloads without exposing provider internals", () => {
    const run = normalizeRemoteSkillRunContract({
      contractVersion: 1,
      error: "insufficient balance",
      code: "INSUFFICIENT_BALANCE",
      skill: "music",
      costCents: 150,
      balanceCents: 0,
      details: ["buy credits"],
    });

    expect(run).toEqual({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      skill: "music",
      credits: 150,
      error: "Insufficient credits",
      code: "INSUFFICIENT_BALANCE",
      details: ["buy credits"],
      creditBalance: 0,
    });
    expect(JSON.stringify(run).toLowerCase()).not.toContain("openai");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("minimax");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("gemini");
    expect(JSON.stringify(run)).not.toMatch(/pricing|Cents|billingUnit|formattedCost/);
  });

  test("preserves canonical run accounting fields and contextual ledger names", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_credit_native",
      credits: 12,
      formattedCredits: "12 credits/run",
      creditsReserved: 12,
      creditsUsed: 10,
      creditBalance: 490,
      formattedCreditBalance: "490 credits",
      amountCredits: -10,
      recentNetAmountCredits: -30,
      creditQuote: {
        tier: "premium",
        creditUnit: "run",
        credits: 12,
        formattedCredits: "12 credits/run",
        estimated: false,
        quoteDependsOnInput: false,
        quoteRequired: false,
        description: "Fixed credits per run.",
      },
    });

    expect(run).toMatchObject({
      credits: 12,
      formattedCredits: "12 credits/run",
      creditsReserved: 12,
      creditsUsed: 10,
      creditBalance: 490,
      formattedCreditBalance: "490 credits",
      amountCredits: -10,
      recentNetAmountCredits: -30,
      creditQuote: { creditUnit: "run", credits: 12 },
    });
  });

  test("rejects unsupported versions and incomplete canonical credit quotes", () => {
    expect(() => normalizeRemoteSkillRunContract({
      contractVersion: 2,
      pricing: { tier: "free", costCents: 0 },
    })).toThrow("Unsupported remote skill run contract version");
    expect(() => normalizeRemoteSkillRunContract({
      creditQuote: { tier: "free" },
    })).toThrow("credits");
  });
});
