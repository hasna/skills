import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("proposal-pack premium skill", () => {
  test("writes proposal artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-proposal-pack-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/proposal-pack/src/index.ts",
        "--client",
        "Acme",
        "--project",
        "AI onboarding workflow",
        "--budget",
        "25k USD",
        "--timeline",
        "6 weeks",
        "--services",
        "Discovery,Design,Build,Training",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_proposal_pack_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated proposal pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "proposal.md",
        "proposal.pdf",
        "statement-of-work.md",
        "pricing.csv",
        "timeline.csv",
        "assumptions.md",
        "cover-email.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const proposal = readFileSync(join(output, "proposal.md"), "utf8");
      expect(proposal).toContain("# Proposal for Acme");
      expect(proposal).toContain("| Item | Description | Price |");
      expect(proposal).toContain("AI onboarding workflow");
      expect(proposal.toLowerCase()).not.toContain("cerebras");
      expect(proposal.toLowerCase()).not.toContain("gpt-oss");

      const pdf = readFileSync(join(output, "proposal.pdf"), "utf8");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("trailer");

      const pricingCsv = readFileSync(join(output, "pricing.csv"), "utf8");
      expect(pricingCsv).toContain("item,description,price");
      expect(pricingCsv).toContain("\"Discovery\"");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "proposal-pack",
        runId: "run_proposal_pack_test",
        input: {
          project: "AI onboarding workflow",
          client: "Acme",
          budget: "25k USD",
          timeline: "6 weeks",
          services: ["Discovery", "Design", "Build", "Training"],
        },
        files: {
          proposal: "proposal.md",
          pdf: "proposal.pdf",
          statementOfWork: "statement-of-work.md",
          pricingCsv: "pricing.csv",
          timelineCsv: "timeline.csv",
          assumptions: "assumptions.md",
          coverEmail: "cover-email.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
