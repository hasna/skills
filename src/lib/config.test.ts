import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

// We test the module functions by importing them and overriding cwd/homedir behavior
// via temp directories and direct file manipulation.

import { DATA_DIR_ENV, loadConfig, saveConfig, unsetConfig, getConfigPath, getDataDir, type SkillsConfig, type ConfigScope } from "./config";
import { useDefaultTestTimeout, withHomeDataDir, withTempHome } from "../test-preload.js";
import { clearRegistryCache, loadRegistry } from "./registry.js";

useDefaultTestTimeout();

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
        extensionsDir: "/work/skills-internal",
      }));
      const config = loadConfig();
      expect(config.defaultAgent).toBe("gemini");
      expect(config.defaultScope).toBe("project");
      expect(config.format).toBe("csv");
      expect(config.apiUrl).toBe("https://skills.example.com/api/v1");
      expect(config.extensionsDir).toBe("/work/skills-internal");
      expect(Object.keys(config).sort()).toEqual(["apiUrl", "defaultAgent", "defaultScope", "extensionsDir", "format"]);
    });

    test("refuses a legacy mode key instead of dropping it in silence", () => {
      // The defect this replaces. The key was already unread, so an operator who
      // wrote it - following documentation that still said to - got a client that
      // talked to nothing and said nothing about why. Dropping a retired setting
      // silently is indistinguishable from honouring it.
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({
        mode: "self-hosted",
        format: "json",
      }));
      let error: unknown;
      try {
        loadConfig();
      } catch (err) {
        error = err;
      }
      expect((error as Error | undefined)?.name).toBe("RetiredSettingError");
      const message = (error as Error).message;
      // Actionable: which file, which key, what replaces it, and how to remove it.
      expect(message).toContain(join(tmpDir, "skills.config.json"));
      expect(message).toContain("mode");
      expect(message).toContain("apiUrl");
      expect(message).toContain("config unset mode");
    });

    test("refuses a legacy mode key in the global config too, naming that file", () => {
      // Both scopes are read by loadConfig. A guard on the project file alone
      // leaves the global one silent, which is the harder case to debug because
      // nothing in the project explains the behaviour.
      // Resolved through getConfigPath rather than composed from tmpDir: the test
      // preload relocates the data dir with $HASNA_SKILLS_DIR, so a hand-built
      // ~/.hasna/skills path would not be the file loadConfig() reads and this
      // test would pass without ever presenting the retired key.
      const globalPath = getConfigPath("global");
      expect(globalPath).not.toBe(getConfigPath("project"));
      mkdirSync(dirname(globalPath), { recursive: true });
      writeFileSync(globalPath, JSON.stringify({ mode: "cloud" }));
      try {
        let message = "";
        try {
          loadConfig();
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message).toContain(globalPath);
        expect(message).toContain("apiUrl");
      } finally {
        rmSync(globalPath, { force: true });
      }
    });

    test("refuses the retired key whatever its value", () => {
      // The fault is declaring a deployment label at all. A value denylist would
      // accept mode:"onprem" and reject mode:"cloud", teaching the reader that
      // the concept survived and only some spellings of it are wrong.
      for (const value of ["local", "self-hosted", "cloud", "remote", "hybrid", "onprem", ""]) {
        writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: value }));
        expect(() => loadConfig()).toThrow(/no longer a configuration key/);
      }
    });

    test("still ignores an unparseable config file rather than refusing", () => {
      // Positive control on the refusal's placement. readConfigFile() wraps its
      // read in a catch that returns {}; putting the retired-key check inside it
      // would have swallowed the refusal and this test would pass while the
      // feature did nothing. It has to sit outside that catch, and unparseable
      // files must keep their old lenient behaviour.
      writeFileSync(join(tmpDir, "skills.config.json"), "{not json");
      expect(loadConfig()).toEqual({});
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
      // former alias fails the same way.
      //
      // The message deliberately no longer reads "Unknown config key". That was
      // true and useless: it reads as a typo when the real answer is that the
      // concept was deleted and apiUrl carries the decision now. An operator who
      // is only told their key is unknown retypes it.
      for (const value of ["local", "self-hosted", "selfhosted", "hosted", "skills.md", "offline", "remote", "cloud"]) {
        expect(() => saveConfig("mode", value, "project")).toThrow(
          /"mode" is no longer a configuration key/,
        );
        expect(() => saveConfig("mode", value, "project")).toThrow(/apiUrl/);
      }
      // An invented key still gets the plain unknown-key error, so the retired-key
      // path is doing something specific rather than swallowing every bad key.
      expect(() => saveConfig("badKey", "value", "project")).toThrow("Unknown config key: badKey");
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

    test("does not rewrite an operator's file behind their back to remove a retired key", () => {
      // Refusing is not migrating. The value on disk stays exactly as written -
      // silently editing someone's config would be its own surprise - and the
      // refusal names the command that removes it.
      writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: "self-hosted" }));
      expect(() => saveConfig("format", "json", "project")).toThrow(
        /"mode" is no longer a configuration key/,
      );
      const raw = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(raw.mode).toBe("self-hosted");
      expect(raw.format).toBeUndefined();
    });

    test("unsetConfig removes a key and reports whether one was there", () => {
      saveConfig("apiUrl", "https://skills.example.com", "project");
      expect(loadConfig().apiUrl).toBe("https://skills.example.com");
      expect(unsetConfig("apiUrl", "project")).toBe(true);
      expect(loadConfig().apiUrl).toBeUndefined();
      expect(unsetConfig("apiUrl", "project")).toBe(false);
      expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(true);
      expect(() => unsetConfig("nonsenseKey", "project")).toThrow("Unknown config key: nonsenseKey");
    });

    test("unsetConfig repairs a file that loadConfig refuses", () => {
      // The whole reason a retired key is removable while not being settable. The
      // refusal tells the operator to run `skills config unset mode`; if that
      // command also refused, the error would name a fix that does not exist and
      // the only way out would be hand-editing JSON.
      writeFileSync(
        join(tmpDir, "skills.config.json"),
        JSON.stringify({ mode: "self-hosted", format: "json" }),
      );
      expect(() => loadConfig()).toThrow(/no longer a configuration key/);
      expect(unsetConfig("mode", "project")).toBe(true);
      // Repaired, and the keys beside it survived the repair.
      expect(loadConfig()).toEqual({ format: "json" });
      expect(unsetConfig("mode", "project")).toBe(false);
    });

    test("saves apiUrl after URL validation", () => {
      saveConfig("apiUrl", "https://skills.example.com/api/v1/", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.apiUrl).toBe("https://skills.example.com/api/v1");
    });

    test("throws on invalid apiUrl", () => {
      expect(() => saveConfig("apiUrl", "file:///tmp/skills")).toThrow("Expected an http(s) URL");
    });

    test("saves a non-empty extensions directory path", () => {
      saveConfig("extensionsDir", "/work/skills-internal", "global");
      const content = JSON.parse(readFileSync(getConfigPath("global"), "utf-8"));
      expect(content.extensionsDir).toBe("/work/skills-internal");
      expect(() => saveConfig("extensionsDir", "   ", "global")).toThrow("Expected a non-empty directory path");
    });

    test("overwrites existing malformed file", () => {
      writeFileSync(join(tmpDir, "skills.config.json"), "not json");
      saveConfig("format", "compact", "project");
      const content = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf-8"));
      expect(content.format).toBe("compact");
    });
  });
});
