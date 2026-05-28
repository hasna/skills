import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("meeting-pack premium skill", () => {
  test("writes meeting artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-meeting-pack-"));
    const output = join(tmp, "exports");
    const source = join(tmp, "meeting.txt");
    writeFileSync(source, [
      "Decided to launch the billing success dialog after Stripe custom domain validation.",
      "Hasna will review checkout and customer portal smoke tests this week.",
      "Alex needs to update docs and prepare support macros for billing questions.",
      "Sam will confirm webhook logs and project export details tomorrow.",
      "The team flagged risk around slow production deploy feedback loops.",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/meeting-pack/src/index.ts",
        "--source",
        source,
        "--meeting",
        "Billing Launch Sync",
        "--participants",
        "Hasna,Alex,Sam",
        "--format",
        "project",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_meeting_pack_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated meeting pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "meeting-summary.md",
        "decisions.md",
        "action-items.csv",
        "follow-up-email.md",
        "project-export.json",
        "timeline.md",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const summary = readFileSync(join(output, "meeting-summary.md"), "utf8");
      expect(summary).toContain("# Meeting Summary: Billing Launch Sync");
      expect(summary).toContain("Billing and Revenue");
      expect(summary).toContain("Action Summary");
      expect(summary.toLowerCase()).not.toContain("cerebras");
      expect(summary.toLowerCase()).not.toContain("gpt-oss");

      const actionItems = readFileSync(join(output, "action-items.csv"), "utf8");
      expect(actionItems).toContain("id,owner,task,deadline,priority,status,source");
      expect(actionItems).toContain("\"Hasna\"");

      const projectExport = JSON.parse(readFileSync(join(output, "project-export.json"), "utf8"));
      expect(projectExport).toMatchObject({
        skill: "meeting-pack",
        runId: "run_meeting_pack_test",
        meeting: "Billing Launch Sync",
        format: "project",
        participants: ["Hasna", "Alex", "Sam"],
      });
      expect(projectExport.tasks.length).toBeGreaterThan(0);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "meeting-pack",
        runId: "run_meeting_pack_test",
        input: {
          meeting: "Billing Launch Sync",
          participants: ["Hasna", "Alex", "Sam"],
          format: "project",
        },
        files: {
          summary: "meeting-summary.md",
          decisions: "decisions.md",
          actionItems: "action-items.csv",
          followUpEmail: "follow-up-email.md",
          projectExport: "project-export.json",
          timeline: "timeline.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
