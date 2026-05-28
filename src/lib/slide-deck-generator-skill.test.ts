import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("slide-deck-generator premium skill", () => {
  test("writes editable deck artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-slide-deck-"));
    const source = join(tmp, "outline.md");
    const output = join(tmp, "exports");
    writeFileSync(source, [
      "Q2 launch review for AI billing.",
      "Checkout conversion improved after custom domain activation.",
      "Customer portal needs clearer success return states.",
      "Premium skills should show pricing before async runs.",
      "Next quarter focuses on artifact quality and production smoke coverage.",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/slide-deck-generator/src/index.ts",
        "--source",
        source,
        "--title",
        "Q2 Launch Review",
        "--audience",
        "executives",
        "--format",
        "report",
        "--slides",
        "9",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_slide_deck_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated slide deck package for Q2 Launch Review");

      for (const file of [
        "manifest.json",
        "deck.md",
        "deck.pdf",
        "deck.pptx",
        "slides.json",
        "speaker-notes.md",
        "theme-guide.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const deck = readFileSync(join(output, "deck.md"), "utf8");
      expect(deck).toContain("# Q2 Launch Review");
      expect(deck).toContain("Executive Summary");
      expect(deck).toContain("Next Steps");

      const slides = JSON.parse(readFileSync(join(output, "slides.json"), "utf8"));
      expect(slides).toHaveLength(9);
      expect(slides[0]).toMatchObject({ number: 1, title: "Q2 Launch Review" });
      expect(slides[8]).toMatchObject({ number: 9, title: "Next Steps" });

      const pptx = readFileSync(join(output, "deck.pptx"));
      expect(pptx.subarray(0, 2).toString()).toBe("PK");
      expect(statSync(join(output, "deck.pdf")).size).toBeGreaterThan(100);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "slide-deck-generator",
        runId: "run_slide_deck_test",
        input: {
          title: "Q2 Launch Review",
          audience: "executives",
          format: "report",
          slideCount: 9,
        },
        slideCount: 9,
        files: {
          deck: "deck.md",
          pdf: "deck.pdf",
          pptx: "deck.pptx",
          slides: "slides.json",
          speakerNotes: "speaker-notes.md",
          themeGuide: "theme-guide.md",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        deck,
        readFileSync(join(output, "speaker-notes.md"), "utf8"),
        readFileSync(join(output, "theme-guide.md"), "utf8"),
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
