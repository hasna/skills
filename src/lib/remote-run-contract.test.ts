import { describe, expect, test } from "bun:test";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
} from "./remote-run-contract";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("remote skill run contract", () => {
  test("normalizes submitted run payloads for CLI, MCP, and web clients", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_123",
      skill: "image",
      status: "queued",
      exitCode: 0,
      correlationId: "corr_123",
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(run).toMatchObject({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      id: "run_123",
      skill: "image",
      status: "queued",
      exitCode: 0,
      correlationId: "corr_123",
      createdAt: "2026-05-12T00:00:00.000Z",
    });
  });

  test("drops billing fields even when a server sends them", () => {
    const run = normalizeRemoteSkillRunContract({
      id: "run_456",
      skill: "image",
      status: "completed",
      costCents: 4,
      pricing: { tier: "premium", formattedCost: "$0.04" },
      creditsUsed: 1,
      balance: "$1.00",
      balanceCents: 100,
    });

    expect(run).toEqual({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      id: "run_456",
      skill: "image",
      status: "completed",
    });
  });

  test("normalizes error payloads without exposing provider internals", () => {
    const run = normalizeRemoteSkillRunContract({
      error: "run failed",
      code: "RUN_FAILED",
      skill: "music",
      details: ["retry later"],
    });

    expect(run).toEqual({
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      skill: "music",
      error: "run failed",
      code: "RUN_FAILED",
      details: ["retry later"],
    });
    expect(JSON.stringify(run).toLowerCase()).not.toContain("openai");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("minimax");
    expect(JSON.stringify(run).toLowerCase()).not.toContain("gemini");
  });
});
