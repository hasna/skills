import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
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

  test("skill with valid package.json and bin entry resolves correctly", async () => {
    // Create a fake installed skill with bin entry
    const skillDir = join(testDir, ".skills", "skill-test-bin");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "skill-test-bin",
        bin: { "skill-test-bin": "src/index.ts" },
      })
    );

    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(
      join(skillDir, "src", "index.ts"),
      'console.log("hello from bin");'
    );

    const result = await runSkill("test-bin", [], { installed: true });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test("skill with scripts.dev parses the entry point", async () => {
    // Create a fake installed skill with scripts.dev but no bin
    const skillDir = join(testDir, ".skills", "skill-test-dev");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "skill-test-dev",
        scripts: { dev: "bun run bin/cli.ts" },
      })
    );

    mkdirSync(join(skillDir, "bin"), { recursive: true });
    writeFileSync(
      join(skillDir, "bin", "cli.ts"),
      'console.log("hello from scripts.dev");'
    );

    const result = await runSkill("test-dev", [], { installed: true });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test("fallback to bin/cli.ts when no bin and no scripts.dev", async () => {
    // Create a fake installed skill with neither bin nor scripts.dev
    const skillDir = join(testDir, ".skills", "skill-test-fallback");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "skill-test-fallback",
      })
    );

    mkdirSync(join(skillDir, "bin"), { recursive: true });
    writeFileSync(
      join(skillDir, "bin", "cli.ts"),
      'console.log("hello from fallback");'
    );

    const result = await runSkill("test-fallback", [], { installed: true });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test("installed .skills/ path is preferred over package skills/ path", async () => {
    // Install a fake skill in .skills/ that shadows a real package skill
    // We use "image" since it exists in the package
    const skillDir = join(testDir, ".skills", "skill-image");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "skill-image",
        bin: { "skill-image": "src/index.ts" },
      })
    );

    mkdirSync(join(skillDir, "src"), { recursive: true });
    writeFileSync(
      join(skillDir, "src", "index.ts"),
      'console.log("from installed");'
    );

    // runSkill without `installed: true` should prefer the .skills/ dir
    const result = await runSkill("image", []);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test("returns error when package.json is missing", async () => {
    // Create a skill directory without package.json
    const skillDir = join(testDir, ".skills", "skill-no-pkg");
    mkdirSync(skillDir, { recursive: true });

    const result = await runSkill("no-pkg", [], { installed: true });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("No package.json");
  });

  test("returns error when entry point file does not exist", async () => {
    // Create a skill with bin pointing to non-existent file
    const skillDir = join(testDir, ".skills", "skill-bad-entry");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "skill-bad-entry",
        bin: { "skill-bad-entry": "src/missing.ts" },
      })
    );

    const result = await runSkill("bad-entry", [], { installed: true });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Entry point");
    expect(result.error).toContain("not found");
  });
});
