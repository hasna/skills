import { describe, expect, test } from "bun:test";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
} from "./run-contract";

describe("remote skill run contract", () => {
  test("normalizes submitted run payloads for CLI, MCP, and web clients", () => {
    const run = normalizeRemoteSkillRunContract({
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
      costCents: 4,
      pricing: {
        tier: "premium",
        quoteDependsOnInput: true,
      },
    });
  });

  test("normalizes error payloads without exposing provider internals", () => {
    const run = normalizeRemoteSkillRunContract({
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
      costCents: 150,
      error: "insufficient balance",
      code: "INSUFFICIENT_BALANCE",
      details: ["buy credits"],
      balanceCents: 0,
    });
    expect(JSON.stringify(run).toLowerCase()).not.toContain("openai");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("minimax");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("gemini");
  });
});
