import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { INSTALLED_SKILLS_DIRNAME } from "./config";
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
    const skillDir = join(testDir, ".skills", "skills", "lorem-generator");
    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: "lorem-generator", bin: { "lorem-generator": "src/index.ts" } }));
    writeFileSync(join(skillDir, "src", "index.ts"), 'console.log("from copied project source");');

    const result = await runSkill("lorem-generator", ["--help"], { stdio: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lorem-generator");
    expect(result.stdout).not.toContain("from copied project source");
  });

  test("returns a not-runnable error for instruction skills", async () => {
    const skillsRoot = join(testDir, "instruction-skills");
    // Written into the corpus, not the app root, so this exercises skill running
    // rather than the layout migration.
    const skillDir = join(skillsRoot, INSTALLED_SKILLS_DIRNAME, "skill-project");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---
name: skill-project
description: Prose-only instruction skill.
kind: instruction
source: private
---

# Skill Project
`);
    const previous = process.env["HASNA_SKILLS_DIR"];
    process.env["HASNA_SKILLS_DIR"] = skillsRoot;
    try {
      const result = await runSkill("skill-project", [], { stdio: "pipe" });
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("instruction skill");
    } finally {
      if (previous === undefined) delete process.env["HASNA_SKILLS_DIR"];
      else process.env["HASNA_SKILLS_DIR"] = previous;
    }
  });

  test("passes run metadata environment to bundled skills", async () => {
    const result = await runSkill("lorem-generator", ["--help"], {
      stdio: "pipe",
      env: {
        SKILLS_RUN_ID: "run_test",
        SKILLS_RUN_DIR: join(testDir, ".skills", "runs", "today", "run_test"),
        SKILLS_EXPORT_DIR: join(testDir, ".skills", "exports", "lorem-generator", "run_test"),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
