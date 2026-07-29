import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
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

useDefaultTestTimeout();

function withTempProject(run: (projectDir: string) => void): void {
  const projectDir = mkdtempSync(join(tmpdir(), "skills-project-state-"));
  try {
    run(projectDir);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe("project state", () => {
  test("resolves paths and supplies defaults without creating a config file", () => {
    withTempProject((projectDir) => {
      expect(SKILLS_PROJECT_DIR).toBe(".skills");
      expect(PROJECT_CONFIG_FILE).toBe("project.json");
      expect(DEFAULT_EXPORT_DIR).toBe(".skills/exports");
      expect(getProjectStateDir(projectDir)).toBe(join(projectDir, ".skills"));
      expect(getProjectConfigPath(projectDir)).toBe(join(projectDir, ".skills", "project.json"));
      expect(loadProjectConfig(projectDir)).toBeNull();
      expect(listPinnedSkills(projectDir)).toEqual([]);
      expect(getDisabledProjectSkills(projectDir)).toEqual([]);

      const config = ensureProjectConfig(projectDir);
      expect(config).toMatchObject({
        version: 1,
        defaultExportDir: DEFAULT_EXPORT_DIR,
        pinnedSkills: [],
        pins: {},
      });
      expect(loadProjectConfig(projectDir)).toBeNull();
    });
  });

  test("normalizes persisted config and rejects malformed config as absent", () => {
    withTempProject((projectDir) => {
      const now = "2026-07-29T00:00:00.000Z";
      const config = {
        version: 1,
        defaultExportDir: "custom-exports",
        pinnedSkills: ["zeta", "alpha", "zeta"],
        pins: {
          alpha: { name: "wrong", pinnedAt: now, version: "1.2.3", source: "local" },
          zeta: { name: "zeta", pinnedAt: 12, version: null, source: "invalid" },
        },
        disabledSkills: ["zeta", "alpha", "zeta"],
        createdAt: now,
        updatedAt: now,
      } as unknown as SkillsProjectConfig;

      saveProjectConfig(config, projectDir);
      const loaded = loadProjectConfig(projectDir)!;
      expect(loaded.pinnedSkills).toEqual(["alpha", "zeta"]);
      expect(loaded.disabledSkills).toEqual(["alpha", "zeta"]);
      expect(loaded.pins.alpha).toEqual({
        name: "alpha",
        pinnedAt: now,
        version: "1.2.3",
        source: "local",
      });
      expect(loaded.pins.zeta).toMatchObject({
        name: "zeta",
        version: "unknown",
        source: "official",
      });
      expect(loaded.defaultExportDir).toBe("custom-exports");
      expect(loaded.updatedAt).not.toBe(now);

      writeFileSync(getProjectConfigPath(projectDir), "{broken-json");
      expect(loadProjectConfig(projectDir)).toBeNull();
      expect(ensureProjectConfig(projectDir).pinnedSkills).toEqual([]);
    });
  });

  test("pins, updates, disables, and unpins skills idempotently", () => {
    withTempProject((projectDir) => {
      expect(setSkillDisabled("missing", true, projectDir)).toBe(false);
      expect(unpinProjectSkill("missing", projectDir)).toEqual({ unpinned: false, config: null });

      const first = pinProjectSkill("demo", { version: "1.0.0", source: "remote" }, projectDir);
      expect(first.pinned).toBe(true);
      expect(first.config.pinnedSkills).toEqual(["demo"]);
      expect(first.config.pins.demo).toMatchObject({
        name: "demo",
        version: "1.0.0",
        source: "remote",
      });
      const pinnedAt = first.config.pins.demo.pinnedAt;

      const again = pinProjectSkill("demo", { version: "2.0.0", source: "custom" }, projectDir);
      expect(again.pinned).toBe(false);
      expect(again.config.pins.demo).toMatchObject({
        pinnedAt,
        version: "2.0.0",
        source: "custom",
      });
      pinProjectSkill("alpha", {}, projectDir);
      expect(listPinnedSkills(projectDir)).toEqual(["alpha", "demo"]);

      expect(setSkillDisabled("demo", true, projectDir)).toBe(true);
      expect(setSkillDisabled("demo", true, projectDir)).toBe(false);
      expect(getDisabledProjectSkills(projectDir)).toEqual(["demo"]);
      expect(setSkillDisabled("demo", false, projectDir)).toBe(true);
      expect(setSkillDisabled("demo", false, projectDir)).toBe(false);

      setSkillDisabled("demo", true, projectDir);
      const removed = unpinProjectSkill("demo", projectDir);
      expect(removed.unpinned).toBe(true);
      expect(removed.config?.pinnedSkills).toEqual(["alpha"]);
      expect(removed.config?.pins.demo).toBeUndefined();
      expect(removed.config?.disabledSkills).toEqual([]);
      expect(unpinProjectSkill("demo", projectDir).unpinned).toBe(false);

      const persisted = JSON.parse(readFileSync(getProjectConfigPath(projectDir), "utf8"));
      expect(persisted.pinnedSkills).toEqual(["alpha"]);
    });
  });
});
