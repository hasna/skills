import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  portPortableSkill,
  portPortableSkillDirectory,
  readPortableSkillManifest,
  scaffoldPortableSkill,
} from "./portable-skills.js";
import { clearRegistryCache, loadBasicRegistry, loadRegistryProfile } from "./registry.js";
import { withHomeDataDir } from "../test-preload.js";

function makeExecutableSkill(root: string, name: string, description = `${name} skill`): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nversion: 0.1.0\n---\n\n# ${name}\n`,
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.0" }, null, 2));
  writeFileSync(join(dir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('hi');\n");
  return dir;
}

describe("A2: scaffold --kind instruction", () => {
  test("instruction scaffold writes SKILL.md + skill.json only, no executable stubs", () => {
    const root = mkdtempSync(join(tmpdir(), "bulk-scaffold-"));
    try {
      const result = scaffoldPortableSkill("my-notes", {
        kind: "instruction",
        description: "Prose instruction skill for agents.",
        rootDir: root,
      });

      expect(existsSync(join(result.path, "SKILL.md"))).toBe(true);
      expect(existsSync(join(result.path, "skill.json"))).toBe(true);
      // No executable stubs.
      expect(existsSync(join(result.path, "package.json"))).toBe(false);
      expect(existsSync(join(result.path, "src"))).toBe(false);
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(false);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(false);
      expect(existsSync(join(result.path, "tsconfig.json"))).toBe(false);

      expect(result.manifest.kind).toBe("instruction");
      expect(result.manifest.commands).toEqual([]);

      const skillMd = readFileSync(join(result.path, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("kind: instruction");
      expect(skillMd).not.toContain("skills run");

      const skillJson = JSON.parse(readFileSync(join(result.path, "skill.json"), "utf-8"));
      expect(skillJson.kind).toBe("instruction");
      expect(skillJson.commands).toEqual([]);

      // Manifest round-trips the instruction kind.
      const reread = readPortableSkillManifest(result.path);
      expect(reread.kind).toBe("instruction");
      expect(reread.commands).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("default scaffold stays executable and unaffected", () => {
    const root = mkdtempSync(join(tmpdir(), "bulk-scaffold-exec-"));
    try {
      const result = scaffoldPortableSkill("my-exec", { rootDir: root });
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(result.path, "package.json"))).toBe(true);
      expect(result.manifest.kind ?? "executable").toBe("executable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("I4: bulk directory import", () => {
  test("imports every subfolder with a summary report", () => {
    const source = mkdtempSync(join(tmpdir(), "bulk-src-"));
    const dest = mkdtempSync(join(tmpdir(), "bulk-dest-"));
    try {
      makeExecutableSkill(source, "alpha");
      makeExecutableSkill(source, "beta");
      // A non-skill folder should be skipped, not crash the run.
      mkdirSync(join(source, "not-a-skill"), { recursive: true });
      writeFileSync(join(source, "not-a-skill", "notes.txt"), "nope");
      // AppleDouble/dotfiles must be ignored silently.
      writeFileSync(join(source, "._alpha"), "junk");
      mkdirSync(join(source, ".hidden"), { recursive: true });

      const result = portPortableSkillDirectory(source, { rootDir: dest });

      expect(result.succeeded).toBe(2);
      expect(result.imported.map((entry) => entry.name).sort()).toEqual(["alpha", "beta"]);
      expect(existsSync(join(dest, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(dest, "beta", "SKILL.md"))).toBe(true);

      // The non-skill folder is reported as skipped with a reason.
      const skippedNonSkill = result.skipped.find((entry) => entry.sourcePath.endsWith("not-a-skill"));
      expect(skippedNonSkill).toBeDefined();
      expect(skippedNonSkill?.reason).toBeTruthy();

      // Dotfiles/AppleDouble are not reported as skills at all.
      expect(result.skipped.some((entry) => entry.sourcePath.endsWith("._alpha"))).toBe(false);
      expect(result.skipped.some((entry) => entry.sourcePath.endsWith(".hidden"))).toBe(false);

      expect(result.total).toBe(result.succeeded + result.failed);
      expect(result.failed).toBe(result.skipped.length);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test("skip-on-error: name collisions are skipped, not thrown", () => {
    const source = mkdtempSync(join(tmpdir(), "bulk-src-collide-"));
    const dest = mkdtempSync(join(tmpdir(), "bulk-dest-collide-"));
    try {
      makeExecutableSkill(source, "gamma");
      // Pre-populate the destination so the second import collides.
      portPortableSkill(join(source, "gamma"), { rootDir: dest });

      const result = portPortableSkillDirectory(source, { rootDir: dest });
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.skipped[0]?.reason).toMatch(/already exists/i);

      // Overwrite mode re-imports without error.
      const overwritten = portPortableSkillDirectory(source, { rootDir: dest, overwrite: true });
      expect(overwritten.succeeded).toBe(1);
      expect(overwritten.failed).toBe(0);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test("continueOnError:false rethrows the first failure", () => {
    const source = mkdtempSync(join(tmpdir(), "bulk-src-strict-"));
    const dest = mkdtempSync(join(tmpdir(), "bulk-dest-strict-"));
    try {
      makeExecutableSkill(source, "delta");
      portPortableSkill(join(source, "delta"), { rootDir: dest });
      expect(() => portPortableSkillDirectory(source, { rootDir: dest, continueOnError: false })).toThrow();
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test("throws a clear error for a missing directory", () => {
    expect(() => portPortableSkillDirectory(join(tmpdir(), "does-not-exist-xyz-123"))).toThrow(/not found/i);
  });
});

describe("I5: custom skills gated out of the basic profile", () => {
  test("loadBasicRegistry excludes non-basic custom skills; 'all' profile includes them", () => {
    const home = mkdtempSync(join(tmpdir(), "bulk-home-"));
    const prevHome = process.env["HOME"];
    try {
      process.env["HOME"] = home;
      const customDir = join(home, ".hasna", "skills", "my-custom-skill");
      mkdirSync(customDir, { recursive: true });
      writeFileSync(
        join(customDir, "SKILL.md"),
        `---\nname: my-custom-skill\ndescription: A custom imported skill.\nversion: 0.1.0\n---\n\n# My Custom Skill\n`,
      );

      // The skill is planted under a $HOME-derived path, so the data-dir override
      // is lifted for the registry reads that are supposed to find it.
      withHomeDataDir(() => {
        clearRegistryCache();
        const basicNames = loadBasicRegistry().map((skill) => skill.name);
        expect(basicNames).not.toContain("my-custom-skill");
        // Basic profile must not carry arbitrary custom entries.
        expect(basicNames.every((name) => name !== "my-custom-skill")).toBe(true);

        clearRegistryCache();
        const allNames = loadRegistryProfile("all").map((skill) => skill.name);
        expect(allNames).toContain("my-custom-skill");
      });
    } finally {
      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
      clearRegistryCache();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
