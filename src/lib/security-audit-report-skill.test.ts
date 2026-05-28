import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("security-audit-report premium skill", () => {
  test("writes hardening report artifacts into SKILLS_EXPORT_DIR with redacted evidence", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-security-report-"));
    const target = join(tmp, "app");
    const output = join(tmp, "exports");
    mkdirSync(target, { recursive: true });
    const secretLine = "const api_" + "key = '" + "abcdefghijklmnop" + "1234567890';";
    const dynamicEval = "ev" + "al('console.log(1)');";
    writeFileSync(join(target, "route.ts"), [
      "export const headers = { 'Access-Control-Allow-Origin': '*' };",
      secretLine,
      "// TODO bypass jwt during preview",
      dynamicEval,
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/security-audit-report/src/index.ts",
        "--target",
        target,
        "--framework",
        "Next.js",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_security_report_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated security audit report");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "security-audit-report.md",
        "security-audit-report.pdf",
        "findings.json",
        "findings.csv",
        "remediation-plan.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "security-audit-report.md"), "utf8");
      expect(report).toContain("# Security Audit Report");
      expect(report).toContain("Wildcard CORS header");
      expect(report).toContain("Secret-like value in source");
      expect(report.toLowerCase()).not.toContain("cerebras");
      expect(report.toLowerCase()).not.toContain("gpt-oss");

      const findings = JSON.parse(readFileSync(join(output, "findings.json"), "utf8"));
      expect(findings.skill).toBe("security-audit-report");
      expect(findings.findings.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(findings)).toContain("[redacted]");
      expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnop1234567890");

      const pdf = readFileSync(join(output, "security-audit-report.pdf"), "utf8");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("trailer");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "security-audit-report",
        runId: "run_security_report_test",
        input: {
          target,
          framework: "Next.js",
        },
        files: {
          report: "security-audit-report.md",
          pdf: "security-audit-report.pdf",
          findingsJson: "findings.json",
          findingsCsv: "findings.csv",
          remediation: "remediation-plan.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
