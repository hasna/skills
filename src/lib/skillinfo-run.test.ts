import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { INSTALLED_SKILLS_DIRNAME } from "./config";
import { runSkill } from "./skillinfo";
import { completeSkillRun, createSkillRun, skillRunEnv } from "./run-state";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

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

  // The declarative-only catalog ships no bundled executable skill to run, so
  // runSkill's execution path is exercised against an executable skill placed in
  // the resolved corpus. The decoy under the project .skills tree must never run.
  function writeCorpusExecutable(): string {
    const corpusRoot = mkdtempSync(join(tmpdir(), "runskill-corpus-"));
    const skillDir = join(corpusRoot, "custom", "lorem-generator");
    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({ name: "lorem-generator", bin: { "lorem-generator": "src/index.ts" } }),
    );
    writeFileSync(
      join(skillDir, "src", "index.ts"),
      'console.log("lorem-generator " + process.argv.slice(2).join(" "));',
    );
    return corpusRoot;
  }

  test("runs the resolved skill source and ignores project .skills source folders", async () => {
    const corpusRoot = writeCorpusExecutable();

    // A decoy copy under the project .skills tree, which must NEVER be executed.
    const decoy = join(testDir, ".skills", "skills", "lorem-generator");
    mkdirSync(join(decoy, "src"), { recursive: true });
    writeFileSync(join(decoy, "package.json"), JSON.stringify({ name: "lorem-generator", bin: { "lorem-generator": "src/index.ts" } }));
    writeFileSync(join(decoy, "src", "index.ts"), 'console.log("from copied project source");');

    const previous = process.env["HASNA_SKILLS_DIR"];
    process.env["HASNA_SKILLS_DIR"] = corpusRoot;
    try {
      const result = await runSkill("lorem-generator", ["--help"], { stdio: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("lorem-generator");
      expect(result.stdout).not.toContain("from copied project source");
    } finally {
      if (previous === undefined) delete process.env["HASNA_SKILLS_DIR"];
      else process.env["HASNA_SKILLS_DIR"] = previous;
      const { rmSync } = require("fs");
      rmSync(corpusRoot, { recursive: true, force: true });
    }
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

  test("passes run metadata environment to the resolved skill", async () => {
    const corpusRoot = writeCorpusExecutable();
    const previous = process.env["HASNA_SKILLS_DIR"];
    process.env["HASNA_SKILLS_DIR"] = corpusRoot;
    try {
      const result = await runSkill("lorem-generator", ["--help"], {
        stdio: "pipe",
        env: skillRunEnv(
          createSkillRun({ skill: "lorem-generator", args: ["--help"] }, testDir),
        ),
      });
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env["HASNA_SKILLS_DIR"];
      else process.env["HASNA_SKILLS_DIR"] = previous;
      const { rmSync } = require("fs");
      rmSync(corpusRoot, { recursive: true, force: true });
    }
  });

  // A skill that writes through the catalog's own env-var conventions. The
  // fallbacks are copied verbatim from the shipped skills: the plural variant
  // falls back to "." (cwd, i.e. the installed skill directory) and the root
  // variant falls back to join(process.cwd(), ".skills"). Both must be
  // overridden by the CLI-supplied environment.
  function writeCorpusWriter(): string {
    const corpusRoot = mkdtempSync(join(tmpdir(), "runskill-writer-"));
    const skillDir = join(corpusRoot, "custom", "lorem-writer");
    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({ name: "lorem-writer", bin: { "lorem-writer": "src/index.ts" } }),
    );
    writeFileSync(
      join(skillDir, "src", "index.ts"),
      [
        'import { mkdirSync, writeFileSync } from "fs";',
        'import { join } from "path";',
        'const exportsDir = process.env.SKILLS_EXPORTS_DIR || ".";',
        'mkdirSync(exportsDir, { recursive: true });',
        'writeFileSync(join(exportsDir, "artifact.txt"), "exported");',
        'const root = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");',
        'const derived = join(root, "exports", "lorem-writer");',
        'mkdirSync(derived, { recursive: true });',
        'writeFileSync(join(derived, "derived.txt"), "derived");',
        'const logsDir = process.env.SKILLS_LOGS_DIR || join(process.cwd(), ".skills", "logs");',
        'mkdirSync(logsDir, { recursive: true });',
        'writeFileSync(join(logsDir, "skill.log"), "logged");',
      ].join("\n"),
    );
    return corpusRoot;
  }

  test("run environment makes the skill write into the project, never into its own directory", async () => {
    const corpusRoot = writeCorpusWriter();
    const skillDir = join(corpusRoot, "custom", "lorem-writer");
    const previous = process.env["HASNA_SKILLS_DIR"];
    process.env["HASNA_SKILLS_DIR"] = corpusRoot;
    try {
      const context = createSkillRun({ skill: "lorem-writer", args: [] }, testDir);
      const result = await runSkill("lorem-writer", [], { stdio: "pipe", env: skillRunEnv(context) });
      expect(result.exitCode).toBe(0);

      // The child wrote where it was told, under the temp project dir.
      expect(existsSync(join(context.exportDir, "artifact.txt"))).toBe(true);
      expect(existsSync(join(context.logsDir, "skill.log"))).toBe(true);
      expect(existsSync(join(testDir, ".skills", "exports", "lorem-writer", "derived.txt"))).toBe(true);

      // Nothing was created under the resolved skill directory.
      expect(readdirSync(skillDir).sort()).toEqual(["package.json", "src"]);
      expect(existsSync(join(skillDir, ".skills"))).toBe(false);
      expect(existsSync(join(skillDir, "artifact.txt"))).toBe(false);
      expect(existsSync(join(skillDir, "src", "artifact.txt"))).toBe(false);

      const artifacts = completeSkillRun(context, { status: "completed" }).artifacts;
      expect(artifacts.map((a) => a.path)).toContain(
        join(".skills", "exports", "lorem-writer", context.record.id, "artifact.txt"),
      );
    } finally {
      if (previous === undefined) delete process.env["HASNA_SKILLS_DIR"];
      else process.env["HASNA_SKILLS_DIR"] = previous;
      const { rmSync } = require("fs");
      rmSync(corpusRoot, { recursive: true, force: true });
    }
  });
});
