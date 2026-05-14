import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("pitch-deck premium skill", () => {
  test("writes deck artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-pitch-deck-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/pitch-deck/src/index.ts",
        "--brief",
        "Usage-based billing platform for AI SaaS teams",
        "--company",
        "Acme",
        "--audience",
        "investors",
        "--slides",
        "12",
        "--tone",
        "bold",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_pitch_deck_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated pitch deck package");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "deck.md",
        "deck.pdf",
        "deck.pptx",
        "slides.json",
        "speaker-notes.md",
        "design-direction.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const deck = readFileSync(join(output, "deck.md"), "utf8");
      expect(deck).toContain("Acme Pitch Deck");
      expect(deck).toContain("The Pain");
      expect(deck).toContain("The Ask");

      const slides = JSON.parse(readFileSync(join(output, "slides.json"), "utf8"));
      expect(slides).toHaveLength(12);
      expect(slides[0]).toMatchObject({ number: 1, title: "Acme" });

      const pptx = readFileSync(join(output, "deck.pptx"));
      expect(pptx.subarray(0, 2).toString()).toBe("PK");
      expect(statSync(join(output, "deck.pdf")).size).toBeGreaterThan(100);

      const combined = [
        deck,
        readFileSync(join(output, "speaker-notes.md"), "utf8"),
        readFileSync(join(output, "design-direction.md"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "pitch-deck",
        runId: "run_pitch_deck_test",
        input: {
          company: "Acme",
          audience: "investors",
          slideCount: 12,
          tone: "bold",
        },
        slideCount: 12,
        files: {
          deck: "deck.md",
          pdf: "deck.pdf",
          pptx: "deck.pptx",
          slides: "slides.json",
          speakerNotes: "speaker-notes.md",
          designDirection: "design-direction.md",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
