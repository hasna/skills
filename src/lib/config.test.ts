import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the module functions by importing them and overriding cwd/homedir behavior
// via temp directories and direct file manipulation.

import { loadConfig, saveConfig, saveDeploymentConfig, getConfigPath, getDataDir } from "./config";

describe("config", () => {
  let tmpDir: string;
  let origCwd: typeof process.cwd;
  let originalHome: string | undefined;
  let originalTestMode: string | undefined;
  let originalAllowInsecureLoopback: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `skills-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    origCwd = process.cwd;
    originalHome = process.env.HOME;
    originalTestMode = process.env.SKILLS_TEST_MODE;
    originalAllowInsecureLoopback = process.env.SKILLS_ALLOW_INSECURE_LOOPBACK;
    process.cwd = () => tmpDir;
    process.env.HOME = tmpDir;
    process.env.SKILLS_TEST_MODE = "1";
    process.env.SKILLS_ALLOW_INSECURE_LOOPBACK = "1";
  });

  afterEach(() => {
    process.cwd = origCwd;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalTestMode === undefined) delete process.env.SKILLS_TEST_MODE;
    else process.env.SKILLS_TEST_MODE = originalTestMode;
    if (originalAllowInsecureLoopback === undefined) delete process.env.SKILLS_ALLOW_INSECURE_LOOPBACK;
    else process.env.SKILLS_ALLOW_INSECURE_LOOPBACK = originalAllowInsecureLoopback;
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
      expect(p).toContain(join(".hasna", "skills", "config.json"));
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
        mode: "cloud",
        apiUrl: "https://skills.example.com/api/v1/",
      }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("gemini");
      expect(config.defaultScope).toBe("project");
      expect(config.format).toBe("csv");
      expect(config.mode).toBe("cloud");
      expect(config.apiUrl).toBe("https://skills.example.com");
    });

    test("ignores invalid apiUrl values", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ apiUrl: "not a url" }));
      const config = loadConfig();
      expect(config.apiUrl).toBeUndefined();
    });
  });

  describe("getDataDir", () => {
    test("returns path inside ~/.hasna/skills/", () => {
      const dir = getDataDir();
      expect(dir).toContain(join(".hasna", "skills"));
    });

    test("directory exists after call", () => {
      const dir = getDataDir();
      expect(existsSync(dir)).toBe(true);
    });

    test("copies missing legacy ~/.skills files into an existing ~/.hasna/skills without overwriting", () => {
      const originalHome = process.env.HOME;
      const home = join(tmpdir(), `skills-home-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      try {
        mkdirSync(join(home, ".skills", "custom", "legacy-skill"), { recursive: true });
        writeFileSync(join(home, ".skills", "custom", "legacy-skill", "SKILL.md"), "legacy");
        writeFileSync(join(home, ".skills", "config.json"), JSON.stringify({ defaultAgent: "claude" }));
        writeFileSync(join(home, ".skillsrc"), JSON.stringify({ defaultAgent: "gemini" }));

        mkdirSync(join(home, ".hasna", "skills", "custom"), { recursive: true });
        writeFileSync(join(home, ".hasna", "skills", "config.json"), JSON.stringify({ defaultAgent: "codex" }));

        process.env.HOME = home;
        const dir = getDataDir();

        expect(dir).toBe(join(home, ".hasna", "skills"));
        expect(readFileSync(join(dir, "config.json"), "utf-8")).toContain("codex");
        expect(readFileSync(join(dir, "custom", "legacy-skill", "SKILL.md"), "utf-8")).toBe("legacy");
        expect(existsSync(join(home, ".skills", "custom", "legacy-skill", "SKILL.md"))).toBe(true);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        rmSync(home, { recursive: true, force: true });
      }
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

    test("saves only canonical local, self-hosted, or cloud deployment tuples", () => {
      saveDeploymentConfig("local", undefined, "project");
      expect(loadConfig().mode).toBe("local");
      saveDeploymentConfig("self-hosted", "https://operator.example/api/v1", "project");
      expect(loadConfig().mode).toBe("self-hosted");
      expect(loadConfig().apiUrl).toBe("https://operator.example");
      saveDeploymentConfig("cloud", undefined, "project");
      expect(loadConfig().mode).toBe("cloud");
      expect(loadConfig().apiUrl).toBe("https://skills.md");
      for (const alias of ["skills.md", "hosted", "remote", "offline", "selfhosted"]) {
        expect(() => saveDeploymentConfig(alias as any, undefined, "project")).toThrow();
      }
    });

    test("requires atomic deployment writes instead of separate mode/apiUrl keys", () => {
      expect(() => saveConfig("mode", "cloud", "project")).toThrow("one atomic selection");
      expect(() => saveConfig("apiUrl", "https://operator.example", "project")).toThrow("one atomic selection");
      expect(() => saveDeploymentConfig("self-hosted", undefined, "project")).toThrow("requires --api-url");
      expect(() => saveDeploymentConfig("local", "https://operator.example", "project")).toThrow("cannot be combined");
    });

    test("takes mode and origin from one config layer without cross-product merging", () => {
      mkdirSync(join(tmpDir, ".hasna", "skills"), { recursive: true });
      writeFileSync(join(tmpDir, ".hasna", "skills", "config.json"), JSON.stringify({
        mode: "self-hosted",
        apiUrl: "https://global.example",
        defaultAgent: "claude",
      }));
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({
        mode: "cloud",
        defaultAgent: "cursor",
      }));
      expect(loadConfig()).toMatchObject({
        mode: "cloud",
        defaultAgent: "cursor",
      });
      expect(loadConfig().apiUrl).toBeUndefined();
    });

    test("accepts Cursor and Windsurf as default agent choices", () => {
      saveConfig("defaultAgent", "cursor", "project");
      expect(loadConfig().defaultAgent).toBe("cursor");
      saveConfig("defaultAgent", "windsurf", "project");
      expect(loadConfig().defaultAgent).toBe("windsurf");
    });

    test("requires migration for an ambiguous persisted mode", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: "remote" }));
      expect(() => loadConfig()).toThrow("not canonical");
    });

    test("validates URL hygiene while saving the deployment tuple", () => {
      expect(() => saveDeploymentConfig("self-hosted", "file:///tmp/skills")).toThrow("HTTPS");
      expect(() => saveDeploymentConfig("self-hosted", "https://user:pass@operator.example")).toThrow("user information");
      expect(() => saveDeploymentConfig("cloud", "https://operator.example")).toThrow("fixed service origin");
    });

    test("overwrites existing malformed file", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), "not json");
      saveConfig("format", "compact", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.format).toBe("compact");
    });
  });
});
