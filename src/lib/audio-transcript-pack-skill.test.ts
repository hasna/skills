import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("audio-transcript-pack premium skill", () => {
  test("writes transcript package artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-audio-transcript-"));
    const source = join(tmp, "transcript.txt");
    const output = join(tmp, "exports");
    writeFileSync(source, [
      "Welcome to the usage-based billing teardown.",
      "We explain how founders should price AI features and keep margins visible.",
      "The team should review metering, invoices, checkout, and customer portal behavior.",
      "The closing takeaway is to publish a short migration checklist for customers.",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/audio-transcript-pack/src/index.ts",
        "--source",
        source,
        "--title",
        "Usage-based billing teardown",
        "--speakers",
        "Host,Guest",
        "--format",
        "podcast",
        "--duration-minutes",
        "24",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_audio_transcript_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated audio transcript pack for Usage-based billing teardown");

      for (const file of [
        "manifest.json",
        "transcript.md",
        "captions.srt",
        "summary.md",
        "show-notes.md",
        "clips.csv",
        "content-repurpose-pack.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const transcript = readFileSync(join(output, "transcript.md"), "utf8");
      expect(transcript).toContain("# Transcript");
      expect(transcript).toContain("Usage-based billing teardown");
      expect(transcript).toContain("00:00:00 Host");
      expect(transcript).toContain("00:06:00 Guest");

      const captions = readFileSync(join(output, "captions.srt"), "utf8");
      expect(captions).toContain("00:00:00,000 --> 00:05:58,000");
      expect(captions).toContain("Host: Welcome to the usage-based billing teardown.");

      const showNotes = readFileSync(join(output, "show-notes.md"), "utf8");
      expect(showNotes).toContain("# Show Notes");
      expect(showNotes).toContain("Suggested Clips");

      const clips = readFileSync(join(output, "clips.csv"), "utf8");
      expect(clips).toContain("start,end,title,description,repurpose");
      expect(clips).toContain("Episode moment");

      const repurpose = readFileSync(join(output, "content-repurpose-pack.md"), "utf8");
      expect(repurpose).toContain("LinkedIn Post");
      expect(repurpose).toContain("Email Teaser");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "audio-transcript-pack",
        runId: "run_audio_transcript_test",
        input: {
          source,
          title: "Usage-based billing teardown",
          speakers: ["Host", "Guest"],
          format: "podcast",
          durationMinutes: 24,
        },
        segmentCount: 4,
        files: {
          transcript: "transcript.md",
          captions: "captions.srt",
          summary: "summary.md",
          showNotes: "show-notes.md",
          clips: "clips.csv",
          repurpose: "content-repurpose-pack.md",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        transcript,
        captions,
        showNotes,
        clips,
        repurpose,
        readFileSync(join(output, "summary.md"), "utf8"),
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
