import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("contract-review-report premium skill", () => {
  test("writes contract review artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-contract-review-"));
    const output = join(tmp, "exports");
    const source = join(tmp, "contract.txt");
    writeFileSync(source, [
      "VendorCo may terminate this Agreement without notice and all fees are non-refundable.",
      "Customer will indemnify VendorCo for all claims and damages with unlimited liability.",
      "VendorCo may process personal data using subprocessors and will notify Customer of a breach within a commercially reasonable time.",
      "All work product and feedback is assigned to VendorCo as perpetual and irrevocable intellectual property.",
      "Invoices are due within 30 days and late payments may suspend service.",
    ].join("\n\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/contract-review-report/src/index.ts",
        "--source",
        source,
        "--party",
        "Acme",
        "--counterparty",
        "VendorCo",
        "--jurisdiction",
        "US",
        "--focus",
        "liability,payment,termination,privacy,ip",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_contract_review_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated contract review report");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "contract-review-report.md",
        "risk-register.csv",
        "clause-summary.json",
        "redline-suggestions.md",
        "negotiation-email.md",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "contract-review-report.md"), "utf8");
      expect(report).toContain("# Contract Review Report: Acme <> VendorCo");
      expect(report).toContain("Liability or indemnity");
      expect(report).toContain("qualified counsel");
      expect(report.toLowerCase()).not.toContain("cerebras");
      expect(report.toLowerCase()).not.toContain("gpt-oss");

      const riskRegister = readFileSync(join(output, "risk-register.csv"), "utf8");
      expect(riskRegister).toContain("id,area,risk,issue,recommendation,evidence");
      expect(riskRegister).toContain("\"liability\"");
      expect(riskRegister).toContain("\"privacy\"");

      const clauseSummary = JSON.parse(readFileSync(join(output, "clause-summary.json"), "utf8"));
      expect(clauseSummary).toMatchObject({
        skill: "contract-review-report",
        runId: "run_contract_review_test",
        party: "Acme",
        counterparty: "VendorCo",
        jurisdiction: "US",
      });
      expect(clauseSummary.findings.length).toBeGreaterThan(0);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "contract-review-report",
        runId: "run_contract_review_test",
        input: {
          party: "Acme",
          counterparty: "VendorCo",
          jurisdiction: "US",
        },
        files: {
          report: "contract-review-report.md",
          riskRegister: "risk-register.csv",
          clauseSummary: "clause-summary.json",
          redlines: "redline-suggestions.md",
          negotiationEmail: "negotiation-email.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
