import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("video-highlight-pack premium skill", () => {
  test("writes highlight package artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-video-highlight-"));
    const source = join(tmp, "transcript.txt");
    const output = join(tmp, "exports");
    writeFileSync(source, [
      "Welcome to the launch webinar for AI billing.",
      "We show how teams can meter expensive features without surprising customers.",
      "The demo explains checkout, customer portal, and spend controls.",
      "Founders should publish pricing examples before turning on usage billing.",
      "The closing clip asks viewers to audit their margins before launch.",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/video-highlight-pack/src/index.ts",
        "--source",
        source,
        "--title",
        "AI billing launch webinar",
        "--platforms",
        "youtube-shorts,linkedin",
        "--duration-minutes",
        "30",
        "--aspect-ratio",
        "9:16",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_video_highlight_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated video highlight pack for AI billing launch webinar");

      for (const file of [
        "manifest.json",
        "highlight-plan.md",
        "clips.csv",
        "chapters.json",
        "captions.srt",
        "thumbnail-briefs.md",
        "social-posts.md",
        "edit-decision-list.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const plan = readFileSync(join(output, "highlight-plan.md"), "utf8");
      expect(plan).toContain("# Highlight Plan");
      expect(plan).toContain("AI billing launch webinar");
      expect(plan).toContain("youtube-shorts, linkedin");

      const clips = readFileSync(join(output, "clips.csv"), "utf8");
      expect(clips).toContain("clip,start,end,title,hook,aspect_ratio,platforms");
      expect(clips).toContain("9:16");

      const captions = readFileSync(join(output, "captions.srt"), "utf8");
      expect(captions).toContain("00:00:12,000 --> 00:00:46,000");
      expect(captions).toContain("Start here:");

      const chapters = JSON.parse(readFileSync(join(output, "chapters.json"), "utf8"));
      expect(chapters.title).toBe("AI billing launch webinar");
      expect(chapters.chapters.length).toBeGreaterThanOrEqual(3);

      const editDecisionList = JSON.parse(readFileSync(join(output, "edit-decision-list.json"), "utf8"));
      expect(editDecisionList).toMatchObject({
        title: "AI billing launch webinar",
        aspectRatio: "9:16",
        platforms: ["youtube-shorts", "linkedin"],
      });

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "video-highlight-pack",
        runId: "run_video_highlight_test",
        input: {
          source,
          title: "AI billing launch webinar",
          platforms: ["youtube-shorts", "linkedin"],
          durationMinutes: 30,
          aspectRatio: "9:16",
        },
        files: {
          plan: "highlight-plan.md",
          clips: "clips.csv",
          chapters: "chapters.json",
          captions: "captions.srt",
          thumbnails: "thumbnail-briefs.md",
          socialPosts: "social-posts.md",
          editDecisionList: "edit-decision-list.json",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        plan,
        clips,
        captions,
        readFileSync(join(output, "thumbnail-briefs.md"), "utf8"),
        readFileSync(join(output, "social-posts.md"), "utf8"),
        readFileSync(join(output, "manifest.json"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
