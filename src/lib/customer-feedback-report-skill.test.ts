import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("customer-feedback-report premium skill", () => {
  test("writes feedback report artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-customer-feedback-"));
    const output = join(tmp, "exports");
    const source = join(tmp, "feedback.txt");
    writeFileSync(source, [
      "Users love the onboarding checklist because setup feels fast and clear.",
      "Several teams say billing is confusing and invoices are hard to understand.",
      "Support tickets mention Stripe integration errors and webhook failures.",
      "Power users want better exports, API integrations, and roadmap visibility.",
      "A few users report slow loading when they open large feedback reports.",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/customer-feedback-report/src/index.ts",
        "--source",
        source,
        "--product",
        "Skills.md",
        "--segment",
        "SaaS founders",
        "--channel",
        "tickets",
        "--format",
        "product",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_customer_feedback_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated customer feedback report");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "customer-feedback-report.md",
        "customer-feedback-report.pdf",
        "feedback-clusters.csv",
        "roadmap-suggestions.md",
        "sentiment-summary.json",
        "evidence.json",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "customer-feedback-report.md"), "utf8");
      expect(report).toContain("# Customer Feedback Report: Skills.md");
      expect(report).toContain("| Theme | Count | Share | Sentiment | Impact | Root Cause |");
      expect(report).toContain("Pricing and Billing");
      expect(report).toContain("Integrations");
      expect(report.toLowerCase()).not.toContain("cerebras");
      expect(report.toLowerCase()).not.toContain("gpt-oss");

      const pdf = readFileSync(join(output, "customer-feedback-report.pdf"), "utf8");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("trailer");

      const clustersCsv = readFileSync(join(output, "feedback-clusters.csv"), "utf8");
      expect(clustersCsv).toContain("theme,count,share,sentiment,impact,rootCause,recommendation");
      expect(clustersCsv).toContain("\"Pricing and Billing\"");

      const sentiment = JSON.parse(readFileSync(join(output, "sentiment-summary.json"), "utf8"));
      expect(sentiment).toMatchObject({
        skill: "customer-feedback-report",
        runId: "run_customer_feedback_test",
        totalFeedbackItems: 5,
      });

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "customer-feedback-report",
        runId: "run_customer_feedback_test",
        input: {
          product: "Skills.md",
          segment: "SaaS founders",
          channel: "tickets",
          format: "product",
          feedbackItemCount: 5,
        },
        files: {
          report: "customer-feedback-report.md",
          pdf: "customer-feedback-report.pdf",
          clustersCsv: "feedback-clusters.csv",
          roadmap: "roadmap-suggestions.md",
          sentimentSummary: "sentiment-summary.json",
          evidence: "evidence.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
