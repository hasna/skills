import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV, INSTALLED_SKILLS_DIRNAME, getDataDir } from "./config.js";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { loadRegistry } from "./registry.js";
import { withTempHome } from "../test-preload.js";

/**
 * Guards test hermeticity with respect to the user's real data directory.
 *
 * Before this guard, ten tests across registry/skillinfo/validation failed on any
 * machine that had portable skills installed under ~/.hasna/skills, because
 * loadRegistry() merges that directory and lets a same-named custom skill shadow
 * the bundled official entry. The failures were ambient - they tracked the
 * developer's home directory, not the code - which is exactly the signal you
 * cannot afford to lose while refactoring the registry.
 *
 * Every test here runs under the preload's per-test override unless it says
 * otherwise, so `process.env[DATA_DIR_ENV]` is always a throwaway directory.
 */

const created: string[] = [];

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-hermetic-"));
  created.push(dir);
  return dir;
}

function useAsDataDir(): string {
  const dir = freshRoot();
  process.env[DATA_DIR_ENV] = dir;
  return dir;
}

function cleanup(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// Captured in a describe body - i.e. at file-evaluation time, outside any test
// and outside any hook. This is the window a per-test beforeEach cannot cover,
// and the one a future beforeAll would run in.
const envAtModuleScope = process.env[DATA_DIR_ENV];

describe("data directory isolation outside test bodies", () => {
  test("the override is already set before any test body runs", () => {
    // If this regresses, every describe body, beforeAll, and afterAll in the
    // suite silently reads the developer's real ~/.hasna/skills.
    expect(envAtModuleScope).toBeDefined();
    expect(envAtModuleScope).not.toBe("");
    expect(envAtModuleScope).not.toContain(join(".hasna", "skills"));
  });

  test("teardown leaves the override pointing at a directory that exists", () => {
    // A dangling variable naming a deleted dir makes any post-teardown
    // getDataDir() silently re-create a stray temp dir nothing cleans up.
    const afterTeardown = envAtModuleScope!;
    expect(existsSync(afterTeardown)).toBe(true);
  });
});

describe("data directory isolation", () => {
  test("the preload gives each test its own data dir", () => {
    // If this fails, every other test in the suite is reading the real ~/.hasna/skills.
    const dir = process.env[DATA_DIR_ENV];
    expect(dir).toBeDefined();
    expect(getDataDir()).toBe(dir!);
    expect(dir).not.toContain(join(".hasna", "skills"));
  });

  test("an overridden data dir does not inherit the real home's portable skills", () => {
    useAsDataDir();
    try {
      const registry = loadRegistry();
      expect(registry.every((skill) => skill.source === "official")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("a portable skill shadows the official entry only within its own root", () => {
    // deepresearch is the exact skill that shadowed in the wild: a custom copy
    // categorised "Development Tools" displaced the official "Research & Writing" one.
    try {
      const root = useAsDataDir();
      const skillDir = join(root, "deepresearch");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: deepresearch\ndescription: shadowing copy\n---\n\n# Deepresearch\n",
      );

      const shadowed = loadRegistry().find((skill) => skill.name === "deepresearch");
      expect(shadowed?.source).toBe("custom");

      // Switching to a fresh root must restore the official entry immediately,
      // rather than serving the previous root's result from the 5s cache.
      useAsDataDir();
      const restored = loadRegistry().find((skill) => skill.name === "deepresearch");
      expect(restored?.source).toBe("official");
      expect(restored?.category).toBe("Research & Writing");
    } finally {
      cleanup();
    }
  });
});

describe("data directory precedence", () => {
  // Explicit arguments outrank ambient environment, most specific first. The
  // homeDir case is a regression guard: it used to sit below the environment
  // lookup, so an ambient variable made the argument unusable.
  test("options.rootDir outranks the environment", () => {
    const root = freshRoot();
    try {
      expect(getPortableSkillsRoot({ rootDir: root })).toBe(root);
    } finally {
      cleanup();
    }
  });

  test("options.homeDir outranks the environment", () => {
    const home = freshRoot();
    try {
      expect(getPortableSkillsRoot({ homeDir: home })).toBe(join(home, ".hasna", "skills", "installed"));
    } finally {
      cleanup();
    }
  });

  test("options.rootDir outranks options.homeDir", () => {
    const root = freshRoot();
    const home = freshRoot();
    try {
      expect(getPortableSkillsRoot({ rootDir: root, homeDir: home })).toBe(root);
    } finally {
      cleanup();
    }
  });

  test("the environment outranks $HOME, and $HOME applies once it is unset", () => {
    const overridden = useAsDataDir();
    try {
      // The variable names the app folder; the corpus is always <app folder>/installed.
      expect(getDataDir()).toBe(overridden);
      expect(getPortableSkillsRoot()).toBe(join(overridden, INSTALLED_SKILLS_DIRNAME));
      const fromHome = withTempHome((home) => {
        expect(getPortableSkillsRoot()).toBe(join(home, ".hasna", "skills", "installed"));
        return home;
      });
      // withTempHome must restore the override rather than leaking the temp home.
      expect(process.env[DATA_DIR_ENV]).toBe(overridden);
      expect(getPortableSkillsRoot()).not.toContain(fromHome);
    } finally {
      cleanup();
    }
  });
});
