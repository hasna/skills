import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("migration-plan-pack premium skill", () => {
  test("writes migration planning artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-migration-plan-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/migration-plan-pack/src/index.ts",
        "--system",
        "Skills.md",
        "--from",
        "Next.js 14, Drizzle v0.30, single-region worker",
        "--to",
        "Next.js 16, Drizzle v0.38, multi-region worker",
        "--scope",
        "web app, API, database migrations, deployment",
        "--constraints",
        "No downtime, preserve RLS, keep Stripe billing live",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_migration_plan_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated migration plan pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "migration-plan.md",
        "risk-matrix.csv",
        "ordered-checklist.md",
        "test-strategy.md",
        "dependency-map.json",
        "rollout-plan.md",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const plan = readFileSync(join(output, "migration-plan.md"), "utf8");
      expect(plan).toContain("# Migration Plan: Skills.md");
      expect(plan).toContain("Next.js 14");
      expect(plan).toContain("Next.js 16");
      expect(plan.toLowerCase()).not.toContain("cerebras");
      expect(plan.toLowerCase()).not.toContain("gpt-oss");

      const risks = readFileSync(join(output, "risk-matrix.csv"), "utf8");
      expect(risks).toContain("id,severity,area,risk,mitigation,owner");
      expect(risks).toContain("\"Data Integrity\"");

      const dependencyMap = JSON.parse(readFileSync(join(output, "dependency-map.json"), "utf8"));
      expect(dependencyMap).toMatchObject({
        skill: "migration-plan-pack",
        runId: "run_migration_plan_test",
      });
      expect(dependencyMap.items.length).toBeGreaterThan(2);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "migration-plan-pack",
        runId: "run_migration_plan_test",
        input: {
          system: "Skills.md",
          from: "Next.js 14, Drizzle v0.30, single-region worker",
          to: "Next.js 16, Drizzle v0.38, multi-region worker",
        },
        files: {
          plan: "migration-plan.md",
          riskMatrix: "risk-matrix.csv",
          checklist: "ordered-checklist.md",
          testStrategy: "test-strategy.md",
          dependencyMap: "dependency-map.json",
          rolloutPlan: "rollout-plan.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
