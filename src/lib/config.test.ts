import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the module functions by importing them and overriding cwd/homedir behavior
// via temp directories and direct file manipulation.

import { DATA_DIR_ENV, loadConfig, saveConfig, unsetConfig, getConfigPath, getDataDir, type SkillsConfig, type ConfigScope } from "./config";
import { withHomeDataDir, withTempHome } from "../test-preload.js";
import { clearRegistryCache, loadRegistry } from "./registry.js";

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

    // Asserts the $HOME-derived layout, so it must run with the data-dir override
    // lifted; the throwaway $HOME keeps getDataDir()'s mkdir off the real home.
    test("returns global path for 'global' scope", () => {
      const p = withTempHome(() => getConfigPath("global"));
      expect(p).toContain(join(".hasna", "skills", "config.json"));
    });

    test("returns the overridden data dir for 'global' scope when HASNA_SKILLS_DIR is set", () => {
      // The override has to reach the config file too, not just the skills tree.
      const p = getConfigPath("global");
      expect(p).toBe(join(process.env["HASNA_SKILLS_DIR"]!, "config.json"));
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
        apiUrl: "https://skills.example.com/api/v1/",
      }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("gemini");
      expect(config.defaultScope).toBe("project");
      expect(config.format).toBe("csv");
      expect(config.apiUrl).toBe("https://skills.example.com/api/v1");
      expect(Object.keys(config).sort()).toEqual(["apiUrl", "defaultAgent", "defaultScope", "format"]);
    });

    test("drops a legacy mode key left behind by an older version", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({
        mode: "self-hosted",
        format: "json",
      }));
      const config = loadConfig();
      expect(config).toEqual({ format: "json" });
      expect("mode" in config).toBe(false);
    });

    test("ignores invalid apiUrl values", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ apiUrl: "not a url" }));
      const config = loadConfig();
      expect(config.apiUrl).toBeUndefined();
    });
  });

  describe("getDataDir", () => {
    test("returns path inside ~/.hasna/skills/", () => {
      const dir = withTempHome(() => getDataDir());
      expect(dir).toContain(join(".hasna", "skills"));
    });

    // Both halves must start from a path that does NOT exist, or they assert
    // nothing: under the preload $HASNA_SKILLS_DIR already names a directory that
    // mkdtemp created, so a bare existsSync(getDataDir()) passes even if
    // getDataDir() creates nothing at all.
    test("directory exists after call", () => {
      withTempHome((home) => {
        const target = join(home, ".hasna", "skills");
        expect(existsSync(target)).toBe(false);
        expect(existsSync(getDataDir())).toBe(true);
      });
    });

    test("creates the overridden data dir when it does not exist yet", () => {
      const root = join(tmpdir(), `skills-override-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const previous = process.env[DATA_DIR_ENV];
      process.env[DATA_DIR_ENV] = root;
      try {
        expect(existsSync(root)).toBe(false);
        expect(getDataDir()).toBe(root);
        expect(existsSync(root)).toBe(true);
      } finally {
        if (previous === undefined) delete process.env[DATA_DIR_ENV];
        else process.env[DATA_DIR_ENV] = previous;
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("read paths still work when the overridden data dir names a file", () => {
      // Asserted at the level the user experiences: mkdirSync failing is not the
      // symptom, `skills list` exiting 1 is. getDataDir() swallowing EEXIST was not
      // enough on its own - it still returned the file path, and listPortableSkills
      // then threw ENOTDIR out of readdirSync.
      const file = join(tmpdir(), `skills-override-file-${Date.now()}.txt`);
      writeFileSync(file, "not a directory");
      const previous = process.env[DATA_DIR_ENV];
      process.env[DATA_DIR_ENV] = file;
      try {
        expect(() => getDataDir()).not.toThrow();
        expect(getDataDir()).toBe(file);
        clearRegistryCache();
        expect(() => loadRegistry()).not.toThrow();
        expect(loadRegistry().length).toBeGreaterThan(0);
      } finally {
        if (previous === undefined) delete process.env[DATA_DIR_ENV];
        else process.env[DATA_DIR_ENV] = previous;
        clearRegistryCache();
        rmSync(file, { force: true });
      }
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
        // Legacy migration is a $HOME-only concern, so the override is lifted for
        // the call under test.
        const dir = withHomeDataDir(() => getDataDir());

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

    test("rejects mode as a config key, under every spelling it ever had", () => {
      // Not "invalid value for mode" — there is no mode key at all, so every
      // former alias fails the same way an invented key does.
      for (const value of ["local", "self-hosted", "selfhosted", "hosted", "skills.md", "offline", "remote", "cloud"]) {
        expect(() => saveConfig("mode", value, "project")).toThrow("Unknown config key: mode");
      }
    });

    test("does not advertise mode among the valid keys", () => {
      let message = "";
      try {
        saveConfig("badKey", "value");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("Valid keys:");
      // Parsed, not substring-matched: `not.toContain("mode")` would also trip
      // on an unrelated future key such as modelDefault.
      const keys = message.split("Valid keys: ")[1].split(", ");
      expect(keys).not.toContain("mode");
      expect(keys).toContain("apiUrl");
    });

    test("leaves an existing legacy mode key on disk alone instead of rewriting it", () => {
      // Inert, not migrated: nothing reads it, so nothing needs to rewrite the
      // operator's file to remove it.
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: "self-hosted" }));
      saveConfig("format", "json", "project");
      const raw = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(raw.mode).toBe("self-hosted");
      expect(raw.format).toBe("json");
      expect(loadConfig()).toEqual({ format: "json" });
    });

    test("unsetConfig removes a key and reports whether one was there", () => {
      saveConfig("apiUrl", "https://skills.example.com", "project");
      expect(loadConfig().apiUrl).toBe("https://skills.example.com");
      expect(unsetConfig("apiUrl", "project")).toBe(true);
      expect(loadConfig().apiUrl).toBeUndefined();
      expect(unsetConfig("apiUrl", "project")).toBe(false);
      expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(true);
      expect(() => unsetConfig("mode", "project")).toThrow("Unknown config key: mode");
    });

    test("saves apiUrl after URL validation", () => {
      saveConfig("apiUrl", "https://skills.example.com/api/v1/", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.apiUrl).toBe("https://skills.example.com/api/v1");
    });

    test("throws on invalid apiUrl", () => {
      expect(() => saveConfig("apiUrl", "file:///tmp/skills")).toThrow("Expected an http(s) URL");
    });

    test("overwrites existing malformed file", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), "not json");
      saveConfig("format", "compact", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.format).toBe("compact");
    });
  });
});
