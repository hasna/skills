import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the module functions by importing them and overriding cwd/homedir behavior
// via temp directories and direct file manipulation.

import { loadConfig, saveConfig, getConfigPath, type SkillsConfig, type ConfigScope } from "./config";

describe("config", () => {
  let tmpDir: string;
  let origCwd: typeof process.cwd;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `skills-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    origCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("getConfigPath", () => {
    test("returns project path for 'project' scope", () => {
      const p = getConfigPath("project");
      expect(p).toBe(join(tmpDir, "skills.config.json"));
    });

    test("returns global path for 'global' scope", () => {
      const p = getConfigPath("global");
      expect(p).toContain(".skillsrc");
    });
  });

  describe("loadConfig", () => {
    test("returns empty object when no config files exist", () => {
      const config = loadConfig();
      expect(config).toEqual({});
    });

    test("loads project config", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ defaultAgent: "claude" }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("claude");
    });

    test("ignores invalid keys", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ unknown: "value", defaultAgent: "claude" }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("claude");
      expect((config as any).unknown).toBeUndefined();
    });

    test("ignores invalid values", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ defaultAgent: "invalid" }));
      const config = loadConfig();
      expect(config.defaultAgent).toBeUndefined();
    });

    test("ignores malformed JSON", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), "not json");
      const config = loadConfig();
      expect(config).toEqual({});
    });

    test("ignores non-object JSON (array)", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify([1, 2, 3]));
      const config = loadConfig();
      expect(config).toEqual({});
    });

    test("loads all valid keys", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({
        defaultAgent: "gemini",
        defaultScope: "project",
        format: "csv",
      }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("gemini");
      expect(config.defaultScope).toBe("project");
      expect(config.format).toBe("csv");
    });
  });

  describe("saveConfig", () => {
    test("saves to project config by default", () => {
      saveConfig("defaultAgent", "codex", "project");
      const filePath = join(tmpDir, "skills.config.json");
      expect(existsSync(filePath)).toBe(true);
      const content = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(content.defaultAgent).toBe("codex");
    });

    test("preserves existing keys when saving", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ defaultAgent: "claude" }));
      saveConfig("defaultScope", "project", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.defaultAgent).toBe("claude");
      expect(content.defaultScope).toBe("project");
    });

    test("throws on unknown key", () => {
      expect(() => saveConfig("badKey", "value")).toThrow("Unknown config key");
    });

    test("throws on invalid value", () => {
      expect(() => saveConfig("defaultAgent", "badAgent")).toThrow("Invalid value");
    });

    test("overwrites existing malformed file", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), "not json");
      saveConfig("format", "compact", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.format).toBe("compact");
    });
  });
});
