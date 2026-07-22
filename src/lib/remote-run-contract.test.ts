import { describe, expect, test } from "bun:test";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
  normalizeRemoteSkillRunMutationContract,
} from "./remote-run-contract";

describe("remote skill run contract", () => {
  test("requires successful mutation responses to identify the run and status", () => {
    expect(() => normalizeRemoteSkillRunMutationContract({})).toThrow("valid id and status");
    expect(() => normalizeRemoteSkillRunMutationContract({ id: "run_123" })).toThrow("valid id and status");
    expect(() => normalizeRemoteSkillRunMutationContract({ status: "queued" })).toThrow("valid id and status");
    expect(normalizeRemoteSkillRunMutationContract({ id: "run_123", status: "queued" })).toMatchObject({
      id: "run_123",
      status: "queued",
    });
  });

  test("does not derive submitted-run credits from legacy fiat fields", () => {
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
      error: "Insufficient credits.",
      code: "INSUFFICIENT_BALANCE",
      details: ["No credits were charged."],
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
    expect(() => normalizeRemoteSkillRunContract({
      creditQuote: {
        tier: "premium",
        creditUnit: "image",
        credits: 4,
        unitCount: 2,
        unitCredits: 1,
        formattedCredits: "4 credits total",
        formattedUnitCredits: "1 credits/image",
        estimated: false,
        quoteDependsOnInput: true,
        quoteRequired: true,
        description: "Fixed credits per run.",
      },
    })).toThrow("formattedUnitCredits does not match");
  });

  test("drops invalid run statuses and hostile identifier values", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "provider-route",
      skill: "image",
      requestedSlug: "Provider Model",
      status: "provider_running",
      correlationId: "model:private",
      createdAt: "not-a-date",
    });

    expect(run).toEqual({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: "image" });
    expect(JSON.stringify(run)).not.toMatch(/provider|model|routing|route/i);
  });

  test("drops separator-obfuscated internal error codes", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_123",
      skill: "image",
      status: "failed",
      errorCode: "PROVIDER_DOWN",
      code: "OPENAI_FAILURE",
      error: "The run could not be completed.",
    });

    expect(run).toMatchObject({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      id: "run_123",
      skill: "image",
      status: "failed",
      error: "The Skills run could not be completed.",
    });
    expect(run).not.toHaveProperty("errorCode");
    expect(run).not.toHaveProperty("code");
    expect(JSON.stringify(run)).not.toMatch(/openai|provider/i);
  });

  test("synthesizes run errors from public status and code instead of trusting remote prose", () => {
    const normalized = normalizeRemoteSkillRunContract({
      contractVersion: 1,
      id: "run_123",
      status: "failed",
      errorCode: "CAPACITY_UNAVAILABLE",
      errorMessage: "GPT4o route failed in providerName",
      details: ["Claude3Opus retry target"],
    });

    expect(normalized).toEqual({
      contractVersion: 1,
      id: "run_123",
      status: "failed",
      errorCode: "CAPACITY_UNAVAILABLE",
      errorMessage: "The Skills service is temporarily busy.",
    });
    expect(JSON.stringify(normalized)).not.toMatch(/GPT4o|Claude3Opus|providerName/);
  });

  test("drops vendor and routing terms encoded in otherwise valid run slugs", () => {
    const normalized = normalizeRemoteSkillRunContract({
      contractVersion: 1,
      skill: "openai-renderer",
      requestedSlug: "provider-route",
      status: "queued",
    });

    expect(normalized.skill).toBeUndefined();
    expect(normalized.requestedSlug).toBeUndefined();
    expect(normalized.status).toBe("queued");
  });

  test("uses the strict artifact contract instead of copying remote descriptors", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_123",
      artifacts: [
        {
          id: "art_0123456789abcdefabcd",
          type: "generated_output",
          fileName: "result.png",
          contentType: "image/png",
          provider: "openai",
          routingId: "private-route",
        },
        {
          id: "provider-route-artifact",
          type: "private_model_trace",
          relativePath: "../provider-route.json",
          contentType: "application/json",
        },
      ],
    });

    expect(run.artifacts).toEqual([{
      id: "art_0123456789abcdefabcd",
      type: "generated_output",
      fileName: "generated-output-art_0123456789abcdefabcd.png",
      relativePath: "generated-output-art_0123456789abcdefabcd.png",
      name: "generated-output-art_0123456789abcdefabcd.png",
      contentType: "image/png",
    }]);
    expect(JSON.stringify(run)).not.toMatch(/openai|provider|routing|route|model/i);
  });

  test("synthesizes public artifact names instead of trusting obfuscated service metadata", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_123",
      artifacts: [{
        id: "art_0123456789abcdefabcd",
        type: "generated_output",
        fileName: "open_ai-providerName-routeId.png",
        contentType: "image/png",
      }],
    });

    expect(run.artifacts).toEqual([{
      id: "art_0123456789abcdefabcd",
      type: "generated_output",
      fileName: "generated-output-art_0123456789abcdefabcd.png",
      relativePath: "generated-output-art_0123456789abcdefabcd.png",
      name: "generated-output-art_0123456789abcdefabcd.png",
      contentType: "image/png",
    }]);
    expect(JSON.stringify(run)).not.toMatch(/open.ai|providerName|routeId/i);
  });
});
