import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("market-research-report premium skill", () => {
  test("writes report artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-market-report-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/market-research-report/src/index.ts",
        "--topic",
        "AI developer tools",
        "--audience",
        "SaaS founders",
        "--competitors",
        "Cursor,Copilot,Replit",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_market_report_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated market research report");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "market-research-report.md",
        "market-research-report.pdf",
        "competitors.csv",
        "sources.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const markdown = readFileSync(join(output, "market-research-report.md"), "utf8");
      expect(markdown).toContain("# Market Research Report: AI Developer Tools");
      expect(markdown).toContain("| Competitor | Positioning | Segment | Pricing Signal | Strengths | Risks |");
      expect(markdown).toContain("Cursor");
      expect(markdown).toContain("Copilot");
      expect(markdown.toLowerCase()).not.toContain("cerebras");
      expect(markdown.toLowerCase()).not.toContain("gpt-oss");

      const pdf = readFileSync(join(output, "market-research-report.pdf"), "utf8");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("trailer");

      const competitorsCsv = readFileSync(join(output, "competitors.csv"), "utf8");
      expect(competitorsCsv).toContain("name,positioning,targetSegment,pricingSignal,strengths,risks");
      expect(competitorsCsv).toContain("\"Cursor\"");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "market-research-report",
        runId: "run_market_report_test",
        input: {
          topic: "AI developer tools",
          audience: "SaaS founders",
          competitors: ["Cursor", "Copilot", "Replit"],
        },
        files: {
          markdown: "market-research-report.md",
          pdf: "market-research-report.pdf",
          competitorsCsv: "competitors.csv",
          sources: "sources.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
