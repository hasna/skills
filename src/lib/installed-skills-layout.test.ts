import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV, INSTALLED_SKILLS_DIRNAME } from "./config.js";
import { findPortableSkill, getPortableSkillsRoot, listPortableSkills } from "./portable-skills.js";
import { clearRegistryCache, loadRegistry } from "./registry.js";

/**
 * ~/.hasna/skills is the skills *app* folder; the corpus lives in installed/.
 *
 * This matches every sibling Hasna app - mementos has agents/ beside config.json
 * and mementos.db, accounts has profiles/ beside accounts.json, knowledge has
 * artifacts/ and cache/ beside auth.json. Skills was the only one writing content
 * into its own app root, which is the only reason it ever needed a denylist of
 * "entries that look like skills but aren't". These tests pin the new layout, the
 * non-destructive migration onto it, and the bug the denylist was hiding.
 */

const created: string[] = [];

function tempAppDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-layout-app-"));
  created.push(dir);
  process.env[DATA_DIR_ENV] = dir;
  clearRegistryCache();
  return dir;
}

function writeSkill(parent: string, name: string, description = `${name} skill`): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nversion: 0.1.0\n---\n\n# ${name}\n`,
  );
  return dir;
}

afterEach(() => {
  clearRegistryCache();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("installed/ corpus layout", () => {
  test("the corpus resolves to <app folder>/installed", () => {
    const app = tempAppDir();
    expect(getPortableSkillsRoot()).toBe(join(app, INSTALLED_SKILLS_DIRNAME));
  });

  test("an explicit rootDir names the corpus directly and gets no installed/ suffix", () => {
    // Callers handing over a directory of skill folders mean that directory.
    const app = tempAppDir();
    const explicit = join(app, "somewhere-else");
    mkdirSync(explicit, { recursive: true });
    expect(getPortableSkillsRoot({ rootDir: explicit })).toBe(explicit);
  });

  test("app data beside the corpus is never read as a skill", () => {
    const app = tempAppDir();
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "real-skill");
    writeFileSync(join(app, "config.json"), JSON.stringify({ defaultAgent: "claude" }));
    writeFileSync(join(app, "skills.db"), "sqlite");
    writeFileSync(join(app, "auth.json"), JSON.stringify({ token: "x" }));

    expect(listPortableSkills().map((s) => s.name)).toEqual(["real-skill"]);
  });
});

describe("skill names the denylist used to swallow", () => {
  // The old denylist excluded these names outright, because the corpus shared the
  // app root and a folder called `config` was indistinguishable from config data.
  // Under installed/ they are ordinary skills and excluding them would be a bug.
  // This is the behaviour that proves the denylist is gone; it fails if anyone
  // reintroduces one.
  for (const name of ["config", "custom", "auth", "installed"]) {
    test(`a skill named '${name}' is listed, found, and reaches the registry`, () => {
      const app = tempAppDir();
      writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), name, `A skill legitimately named ${name}.`);

      expect(listPortableSkills().map((s) => s.name)).toContain(name);
      expect(findPortableSkill(name)?.name).toBe(name);

      clearRegistryCache();
      const entry = loadRegistry().find((s) => s.name === name);
      expect(entry).toBeDefined();
      expect(entry?.source).toBe("custom");
    });
  }
});

describe("migration onto the installed/ layout", () => {
  test("folds both old layouts into installed/ without deleting the originals", () => {
    const app = tempAppDir();
    // Layout 1: skills written straight into the app root.
    const oldRootSkill = writeSkill(app, "root-layout-skill");
    // Layout 2: the older custom/ subfolder.
    const oldCustomSkill = writeSkill(join(app, "custom"), "custom-layout-skill");
    // App data and an unrecognised folder that must be left alone.
    writeFileSync(join(app, "config.json"), JSON.stringify({ defaultAgent: "codex" }));
    writeFileSync(join(app, "skills.db"), "sqlite");
    mkdirSync(join(app, "notes"), { recursive: true });
    writeFileSync(join(app, "notes", "todo.txt"), "not a skill");

    const installed = getPortableSkillsRoot();

    // Both skills arrived.
    expect(existsSync(join(installed, "root-layout-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(installed, "custom-layout-skill", "SKILL.md"))).toBe(true);

    // Copy, never delete: the originals are still exactly where they were.
    expect(existsSync(join(oldRootSkill, "SKILL.md"))).toBe(true);
    expect(existsSync(join(oldCustomSkill, "SKILL.md"))).toBe(true);

    // Non-skills stayed put and were not swept into the corpus.
    expect(existsSync(join(app, "config.json"))).toBe(true);
    expect(existsSync(join(app, "skills.db"))).toBe(true);
    expect(existsSync(join(app, "notes", "todo.txt"))).toBe(true);
    expect(existsSync(join(installed, "config.json"))).toBe(false);
    expect(existsSync(join(installed, "skills.db"))).toBe(false);
    expect(existsSync(join(installed, "notes"))).toBe(false);
    expect(existsSync(join(installed, "custom"))).toBe(false);

    // And both are discoverable through the normal read paths.
    expect(listPortableSkills().map((s) => s.name).sort())
      .toEqual(["custom-layout-skill", "root-layout-skill"]);
    clearRegistryCache();
    const names = loadRegistry().map((s) => s.name);
    expect(names).toContain("root-layout-skill");
    expect(names).toContain("custom-layout-skill");
  });

  test("never overwrites a skill already present under installed/", () => {
    const app = tempAppDir();
    writeSkill(app, "clash", "old copy at the app root");
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "clash", "the copy already installed");

    const installed = getPortableSkillsRoot();
    expect(readFileSync(join(installed, "clash", "SKILL.md"), "utf-8"))
      .toContain("the copy already installed");
  });

  test("is idempotent and does not resurrect a skill deleted from installed/", () => {
    const app = tempAppDir();
    writeSkill(app, "root-layout-skill");

    const installed = getPortableSkillsRoot();
    expect(existsSync(join(installed, "root-layout-skill"))).toBe(true);

    // Repeated resolution must not duplicate or re-copy anything.
    expect(getPortableSkillsRoot()).toBe(installed);
    expect(listPortableSkills().map((s) => s.name)).toEqual(["root-layout-skill"]);
  });

  test("a leftover staging directory is not served as a skill", () => {
    // Migration stages into a dot-prefixed folder and renames into place, so an
    // interrupted copy leaves debris rather than a half-populated skill. The
    // debris must never be listed, and must not block a later retry.
    const app = tempAppDir();
    const installed = join(app, INSTALLED_SKILLS_DIRNAME);
    mkdirSync(join(installed, ".migrating-half-copied-123"), { recursive: true });
    writeFileSync(join(installed, ".migrating-half-copied-123", "SKILL.md"), "---\nname: half\n---\n");
    writeSkill(app, "half-copied");

    expect(getPortableSkillsRoot()).toBe(installed);
    // The real skill migrated, and the debris is invisible to the corpus.
    const names = listPortableSkills().map((s) => s.name);
    expect(names).toEqual(["half-copied"]);
    expect(existsSync(join(installed, "half-copied", "SKILL.md"))).toBe(true);
  });

  test("survives an app folder that cannot be migrated", () => {
    // The override naming a file is already covered for reads; migration must be
    // just as tolerant rather than throwing out of a resolver.
    const holder = mkdtempSync(join(tmpdir(), "skills-layout-file-"));
    created.push(holder);
    const file = join(holder, "not-a-directory.txt");
    writeFileSync(file, "definitely not an app folder");
    process.env[DATA_DIR_ENV] = file;

    expect(() => getPortableSkillsRoot()).not.toThrow();
    expect(listPortableSkills()).toEqual([]);
  });
});
