import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("brand-kit premium skill", () => {
  test("writes brand kit artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-brand-kit-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/brand-kit/src/index.ts",
        "--brand",
        "Acme Ledger",
        "--category",
        "developer tools",
        "--audience",
        "founders and operators",
        "--personality",
        "precise, calm, pragmatic",
        "--tone",
        "technical",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_brand_kit_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated brand kit");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "brand-guide.md",
        "brand-guide.pdf",
        "palette.json",
        "typography.md",
        "voice-guide.md",
        "logo-usage.md",
        "sample-applications.md",
        "brand-assets.svg",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      expect(statSync(join(output, "brand-guide.pdf")).size).toBeGreaterThan(100);

      const guide = readFileSync(join(output, "brand-guide.md"), "utf8");
      expect(guide).toContain("# Acme Ledger Brand Guide");
      expect(guide).toContain("Category: developer tools");
      expect(guide).toContain("Audience: founders and operators");
      expect(guide).toContain("## Palette");

      const palette = JSON.parse(readFileSync(join(output, "palette.json"), "utf8"));
      expect(palette.colors).toHaveLength(5);
      expect(palette.colors[0]).toHaveProperty("hex");

      const svg = readFileSync(join(output, "brand-assets.svg"), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("Acme Ledger");

      const combined = [
        guide,
        svg,
        readFileSync(join(output, "typography.md"), "utf8"),
        readFileSync(join(output, "voice-guide.md"), "utf8"),
        readFileSync(join(output, "logo-usage.md"), "utf8"),
        readFileSync(join(output, "sample-applications.md"), "utf8"),
        readFileSync(join(output, "palette.json"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "brand-kit",
        runId: "run_brand_kit_test",
        input: {
          brand: "Acme Ledger",
          category: "developer tools",
          audience: "founders and operators",
          personality: "precise, calm, pragmatic",
          tone: "technical",
        },
        paletteCount: 5,
        files: {
          guide: "brand-guide.md",
          pdf: "brand-guide.pdf",
          palette: "palette.json",
          typography: "typography.md",
          voiceGuide: "voice-guide.md",
          logoUsage: "logo-usage.md",
          sampleApplications: "sample-applications.md",
          assets: "brand-assets.svg",
          manifest: "manifest.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
