import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeSkillRun, createSkillRun } from "./run-state";

describe("public run metadata", () => {
  test("persists credits without fiat-shaped accounting aliases", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-credit-run-"));
    try {
      const context = createSkillRun({ skill: "demo", remote: true, credits: 7 }, target);
      expect(context.record.idempotencyKey).toMatch(/^skills-run-[a-f0-9]{48}$/);
      const run = completeSkillRun(context, { status: "completed", credits: 6 });
      const stored = JSON.parse(readFileSync(join(target, run.paths.runDir, "run.json"), "utf8"));
      expect(stored.credits).toBe(6);
      expect(stored.idempotencyKey).toBe(context.record.idempotencyKey);
      expect(JSON.stringify(stored)).not.toMatch(/costCents|amountCents|formattedCost/);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
