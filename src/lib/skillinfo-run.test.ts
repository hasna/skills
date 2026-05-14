import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runSkill } from "./skillinfo";

let testDir: string;
let originalCwd: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "skillinfo-run-test-"));
  originalCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  const { rmSync } = require("fs");
  rmSync(testDir, { recursive: true, force: true });
});

describe("runSkill", () => {
  test("returns error for nonexistent skill", async () => {
    const result = await runSkill("nonexistent-xyz-123", []);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("not found");
  });

  test("runs bundled package source and ignores project .skills source folders", async () => {
    const skillDir = join(testDir, ".skills", "skills", "image");
    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: "image", bin: { image: "src/index.ts" } }));
    writeFileSync(join(skillDir, "src", "index.ts"), 'console.log("from copied project source");');

    const result = await runSkill("image", ["--help"], { stdio: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skill Image CLI");
    expect(result.stdout).not.toContain("from copied project source");
  });

  test("passes run metadata environment to bundled skills", async () => {
    const result = await runSkill("image", ["--help"], {
      stdio: "pipe",
      env: {
        SKILLS_RUN_ID: "run_test",
        SKILLS_RUN_DIR: join(testDir, ".skills", "runs", "today", "run_test"),
        SKILLS_EXPORT_DIR: join(testDir, ".skills", "exports", "image", "run_test"),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
