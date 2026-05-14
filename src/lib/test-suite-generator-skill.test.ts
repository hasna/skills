import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("test-suite-generator premium skill", () => {
  test("writes runnable test suite artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-test-suite-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/test-suite-generator/src/index.ts",
        "--spec",
        "POST /api/projects, GET /api/projects/:id, signup, billing success",
        "--framework",
        "Next.js",
        "--runner",
        "bun",
        "--include-browser",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_test_suite_generator_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated test suite package");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "test-plan.md",
        "coverage-notes.md",
        "tests/api.test.ts",
        "tests/unit.test.ts",
        "tests/browser.spec.ts",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const apiTest = readFileSync(join(output, "tests/api.test.ts"), "utf8");
      expect(apiTest).toContain("POST /api/projects");
      expect(apiTest).toContain("GET /api/projects/:id");
      expect(apiTest.toLowerCase()).not.toContain("cerebras");
      expect(apiTest.toLowerCase()).not.toContain("gpt-oss");

      const browserTest = readFileSync(join(output, "tests/browser.spec.ts"), "utf8");
      expect(browserTest).toContain("@playwright/test");
      expect(browserTest).toContain("billing success");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "test-suite-generator",
        runId: "run_test_suite_generator_test",
        input: {
          framework: "Next.js",
          runner: "bun",
          includeBrowser: true,
        },
        files: {
          apiTest: "tests/api.test.ts",
          unitTest: "tests/unit.test.ts",
          browserTest: "tests/browser.spec.ts",
          plan: "test-plan.md",
          coverageNotes: "coverage-notes.md",
        },
      });
      expect(manifest.endpoints).toHaveLength(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
