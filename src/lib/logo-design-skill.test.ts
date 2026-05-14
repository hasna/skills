import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("logo-design premium skill", () => {
  test("writes transparent and vector-style logo artifacts without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-logo-design-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/logo-design/src/index.ts",
        "--brief",
        "minimal geometric owl mark for a developer tool",
        "--brand",
        "Acme",
        "--style",
        "clean vector mark",
        "--palette",
        "navy,gold,white",
        "--variations",
        "4",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_logo_design_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated logo design package");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("gemini");

      for (const file of [
        "manifest.json",
        "concepts.json",
        "logo-brief.md",
        "usage-notes.md",
        "transparent/logo-1.png",
        "transparent/logo-4.png",
        "vector/logo-1.svg",
        "vector/logo-4.svg",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const png = readFileSync(join(output, "transparent/logo-1.png"));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

      const concepts = JSON.parse(readFileSync(join(output, "concepts.json"), "utf8"));
      expect(concepts).toHaveLength(4);
      expect(concepts[0]).toMatchObject({
        index: 1,
        name: "Signal Mark",
        files: {
          png: "transparent/logo-1.png",
          svg: "vector/logo-1.svg",
        },
      });

      const combined = [
        readFileSync(join(output, "logo-brief.md"), "utf8"),
        readFileSync(join(output, "usage-notes.md"), "utf8"),
        readFileSync(join(output, "vector/logo-1.svg"), "utf8"),
        JSON.stringify(concepts),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model", "connector"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "logo-design",
        runId: "run_logo_design_test",
        input: {
          brand: "Acme",
          style: "clean vector mark",
          palette: ["navy", "gold", "white"],
          variations: 4,
        },
        conceptCount: 4,
        files: {
          concepts: "concepts.json",
          brief: "logo-brief.md",
          usageNotes: "usage-notes.md",
        },
      });
      expect(manifest.files.logos).toHaveLength(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
