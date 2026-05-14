import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("performance-audit-report premium skill", () => {
  test("writes performance audit artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-performance-audit-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/performance-audit-report/src/index.ts",
        "--target",
        "https://skills.md/dashboard",
        "--app",
        "Skills.md",
        "--surface",
        "web",
        "--budget",
        "balanced",
        "--notes",
        "Dashboard JS bundle is 1.2mb, API p95 is 900ms, LCP is 4200ms, CLS is 0.22, cold start is 1100ms.",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_performance_audit_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated performance audit report");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "performance-audit-report.md",
        "findings.csv",
        "performance-budget.json",
        "remediation-plan.md",
        "metrics.json",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "performance-audit-report.md"), "utf8");
      expect(report).toContain("# Performance Audit Report: Skills.md");
      expect(report).toContain("Client Bundle");
      expect(report).toContain("Backend Latency");
      expect(report.toLowerCase()).not.toContain("cerebras");
      expect(report.toLowerCase()).not.toContain("gpt-oss");

      const findings = readFileSync(join(output, "findings.csv"), "utf8");
      expect(findings).toContain("id,severity,area,metric,observed,budget,recommendation");
      expect(findings).toContain("\"Client Bundle\"");

      const metrics = JSON.parse(readFileSync(join(output, "metrics.json"), "utf8"));
      expect(metrics).toMatchObject({
        skill: "performance-audit-report",
        runId: "run_performance_audit_test",
      });
      expect(metrics.metrics.bundleKb).toBeGreaterThan(1000);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "performance-audit-report",
        runId: "run_performance_audit_test",
        input: {
          target: "https://skills.md/dashboard",
          app: "Skills.md",
          surface: "web",
          budget: "balanced",
        },
        files: {
          report: "performance-audit-report.md",
          findings: "findings.csv",
          performanceBudget: "performance-budget.json",
          remediationPlan: "remediation-plan.md",
          metrics: "metrics.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
