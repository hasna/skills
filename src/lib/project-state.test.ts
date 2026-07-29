import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_EXPORT_DIR,
  PROJECT_CONFIG_FILE,
  SKILLS_PROJECT_DIR,
  ensureProjectConfig,
  getDisabledProjectSkills,
  getProjectConfigPath,
  getProjectStateDir,
  listPinnedSkills,
  loadProjectConfig,
  pinProjectSkill,
  saveProjectConfig,
  setSkillDisabled,
  unpinProjectSkill,
  type SkillsProjectConfig,
} from "./project-state.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const tempProjects: string[] = [];

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "skills-project-state-"));
  tempProjects.push(project);
  return project;
}

afterEach(() => {
  for (const project of tempProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("project state", () => {
  test("resolves paths and returns empty state when no config exists", () => {
    const project = makeProject();

    expect(getProjectStateDir(project)).toBe(join(project, SKILLS_PROJECT_DIR));
    expect(getProjectConfigPath(project)).toBe(join(project, SKILLS_PROJECT_DIR, PROJECT_CONFIG_FILE));
    expect(loadProjectConfig(project)).toBeNull();
    expect(listPinnedSkills(project)).toEqual([]);
    expect(getDisabledProjectSkills(project)).toEqual([]);

    const config = ensureProjectConfig(project);
    expect(config).toMatchObject({
      version: 1,
      defaultExportDir: DEFAULT_EXPORT_DIR,
      pinnedSkills: [],
      pins: {},
    });
    expect(config.createdAt).toBe(config.updatedAt);
    expect(existsSync(getProjectConfigPath(project))).toBe(false);
  });

  test("loads normalized persisted state and rejects malformed JSON", () => {
    const project = makeProject();
    const configPath = getProjectConfigPath(project);
    mkdirSync(getProjectStateDir(project), { recursive: true });
    writeFileSync(configPath, "{not json\n");
    expect(loadProjectConfig(project)).toBeNull();

    const config: SkillsProjectConfig = {
      version: 1,
      defaultExportDir: "output",
      pinnedSkills: ["demo-skill", "demo-skill"],
      pins: {
        "demo-skill": {
          name: "demo-skill",
          pinnedAt: "2020-01-01T00:00:00.000Z",
          version: "1.2.3",
          source: "local",
        },
      },
      disabledSkills: ["demo-skill", "demo-skill"],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };

    saveProjectConfig(config, project);
    const loaded = loadProjectConfig(project);
    expect(loaded).not.toBeNull();
    expect(loaded?.pinnedSkills).toEqual(["demo-skill"]);
    expect(loaded?.disabledSkills).toEqual(["demo-skill"]);
    expect(loaded?.pins["demo-skill"]).toEqual({
      name: "demo-skill",
      pinnedAt: "2020-01-01T00:00:00.000Z",
      version: "1.2.3",
      source: "local",
    });
    expect(loaded?.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(readFileSync(configPath, "utf8").endsWith("\n")).toBe(true);

    writeFileSync(configPath, JSON.stringify({
      pinnedSkills: ["unsafe-source"],
      pins: { "unsafe-source": { source: "unknown-origin" } },
    }));
    expect(loadProjectConfig(project)?.pins["unsafe-source"]?.source).toBe("official");
  });

  test("pins idempotently, updates metadata, disables, and unpins a skill", () => {
    const project = makeProject();

    expect(setSkillDisabled("not-pinned", true, project)).toBe(false);
    expect(unpinProjectSkill("not-pinned", project)).toEqual({ unpinned: false, config: null });

    const first = pinProjectSkill("demo-skill", { version: "1.0.0", source: "local" }, project);
    expect(first.pinned).toBe(true);
    expect(first.config.pinnedSkills).toEqual(["demo-skill"]);
    expect(first.config.pins["demo-skill"]).toMatchObject({
      name: "demo-skill",
      version: "1.0.0",
      source: "local",
    });
    const pinnedAt = first.config.pins["demo-skill"]?.pinnedAt;

    const second = pinProjectSkill("demo-skill", { version: "2.0.0", source: "custom" }, project);
    expect(second.pinned).toBe(false);
    expect(second.config.pinnedSkills).toEqual(["demo-skill"]);
    expect(second.config.pins["demo-skill"]).toMatchObject({
      pinnedAt,
      version: "2.0.0",
      source: "custom",
    });
    expect(listPinnedSkills(project)).toEqual(["demo-skill"]);

    expect(setSkillDisabled("demo-skill", true, project)).toBe(true);
    expect(setSkillDisabled("demo-skill", true, project)).toBe(false);
    expect(getDisabledProjectSkills(project)).toEqual(["demo-skill"]);
    expect(setSkillDisabled("demo-skill", false, project)).toBe(true);
    expect(setSkillDisabled("demo-skill", false, project)).toBe(false);

    expect(setSkillDisabled("demo-skill", true, project)).toBe(true);
    const removed = unpinProjectSkill("demo-skill", project);
    expect(removed.unpinned).toBe(true);
    expect(removed.config?.pinnedSkills).toEqual([]);
    expect(removed.config?.pins).toEqual({});
    expect(removed.config?.disabledSkills).toEqual([]);
    expect(unpinProjectSkill("demo-skill", project).unpinned).toBe(false);
  });
});
