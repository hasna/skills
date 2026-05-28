import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("email-sequence premium skill", () => {
  test("writes email campaign artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-email-sequence-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/email-sequence/src/index.ts",
        "--campaign",
        "Usage-based billing for AI SaaS",
        "--audience",
        "founders and operators",
        "--goal",
        "book demos",
        "--emails",
        "7",
        "--tone",
        "technical",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_email_sequence_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated 7 email sequence");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "sequence.md",
        "subject-lines.csv",
        "segmentation-notes.md",
        "cta-variants.csv",
        "send-plan.csv",
        "emails/email-01.md",
        "emails/email-01.html",
        "emails/email-07.md",
        "emails/email-07.html",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const sequence = readFileSync(join(output, "sequence.md"), "utf8");
      expect(sequence).toContain("# Email Sequence: Usage Based Billing For AI SaaS");
      expect(sequence).toContain("Email count: 7");
      expect(sequence).toContain("CTA: Book a demo");

      const subjectLines = readFileSync(join(output, "subject-lines.csv"), "utf8");
      expect(subjectLines).toContain("email,purpose,subject,preview");
      expect(subjectLines).toContain("Usage Based Billing For AI SaaS");

      const emailHtml = readFileSync(join(output, "emails/email-01.html"), "utf8");
      expect(emailHtml).toContain("<!doctype html>");
      expect(emailHtml).toContain("Book a demo");

      const combined = [
        sequence,
        subjectLines,
        emailHtml,
        readFileSync(join(output, "segmentation-notes.md"), "utf8"),
        readFileSync(join(output, "cta-variants.csv"), "utf8"),
        readFileSync(join(output, "send-plan.csv"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "email-sequence",
        runId: "run_email_sequence_test",
        input: {
          campaign: "Usage-based billing for AI SaaS",
          audience: "founders and operators",
          goal: "book demos",
          emails: 7,
          tone: "technical",
        },
        emailCount: 7,
      });
      expect(manifest.files.emailMarkdown).toHaveLength(7);
      expect(manifest.files.emailHtml).toHaveLength(7);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
