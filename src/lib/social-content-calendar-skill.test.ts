import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("social-content-calendar premium skill", () => {
  test("writes social calendar artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-social-content-calendar-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/social-content-calendar/src/index.ts",
        "--campaign",
        "Usage-based billing for AI SaaS",
        "--audience",
        "founders and operators",
        "--goal",
        "book demos",
        "--days",
        "21",
        "--channels",
        "LinkedIn,X,Newsletter",
        "--tone",
        "technical",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_social_content_calendar_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated social content calendar");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "calendar.md",
        "posts.csv",
        "channel-plan.json",
        "asset-briefs.md",
        "hooks.md",
        "publishing-schedule.csv",
        "repurposing-map.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const calendar = readFileSync(join(output, "calendar.md"), "utf8");
      expect(calendar).toContain("# Social Content Calendar: Usage Based Billing For AI SaaS");
      expect(calendar).toContain("Audience: founders and operators");
      expect(calendar).toContain("LinkedIn");
      expect(calendar).toContain("Newsletter");

      const posts = readFileSync(join(output, "posts.csv"), "utf8");
      expect(posts).toContain("day,channel,theme,format,hook,body,cta,asset");
      expect(posts).toContain("Book a demo");
      expect(posts.split("\n").filter(Boolean)).toHaveLength(22);

      const schedule = readFileSync(join(output, "publishing-schedule.csv"), "utf8");
      expect(schedule).toContain("publish_slot,channel,local_time,owner,theme,asset_brief");
      expect(schedule).toContain("day-21");

      const combined = [
        calendar,
        posts,
        schedule,
        readFileSync(join(output, "channel-plan.json"), "utf8"),
        readFileSync(join(output, "asset-briefs.md"), "utf8"),
        readFileSync(join(output, "hooks.md"), "utf8"),
        readFileSync(join(output, "repurposing-map.md"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "social-content-calendar",
        runId: "run_social_content_calendar_test",
        input: {
          campaign: "Usage-based billing for AI SaaS",
          audience: "founders and operators",
          goal: "book demos",
          days: 21,
          channels: ["LinkedIn", "X", "Newsletter"],
          tone: "technical",
        },
        postCount: 21,
        channelCount: 3,
        files: {
          calendar: "calendar.md",
          posts: "posts.csv",
          channelPlan: "channel-plan.json",
          assetBriefs: "asset-briefs.md",
          hooks: "hooks.md",
          publishingSchedule: "publishing-schedule.csv",
          repurposingMap: "repurposing-map.md",
          manifest: "manifest.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
