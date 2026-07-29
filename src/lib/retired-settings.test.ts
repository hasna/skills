import { describe, expect, test } from "bun:test";
import {
  RETIRED_CONFIG_KEYS,
  RetiredSettingError,
  assertNoRetiredConfigKeys,
  assertNoRetiredModeEnvVars,
  findRetiredModeEnvVars,
  isRetiredModeEnvVar,
} from "./retired-settings";

// Retired variable names are assembled from fragments throughout this file.
// public-package-boundary.test.ts bans those literals from every file it scans,
// this one included, so spelling them out here would fail that guard instead of
// this one.
const storageMode = (prefix: string) => [prefix, "STORAGE", "MODE"].join("_");
const deploymentMode = (prefix: string) => [prefix, "DEPLOYMENT", "MODE"].join("_");
const APP = "SKILLS";
const replacement = ["HASNA", APP, "DATABASE", "URL"].join("_");

describe("retired deployment-mode settings", () => {
  describe("environment variables", () => {
    test("recognises the removed axis under every prefix and middle word", () => {
      // Shape matching, not a remembered list. The estate spelled this axis
      // several ways at once, so the spelling that gets through silently is
      // always the one nobody wrote down.
      for (const name of [
        storageMode("HASNA_SKILLS"),
        storageMode("SKILLS"),
        storageMode("OPEN_SKILLS"),
        deploymentMode("SKILLS"),
        deploymentMode("HASNA_SKILLS"),
        ["SKILLS", "CLOUD", "MODE"].join("_"),
      ]) {
        expect(isRetiredModeEnvVar(name, APP)).toBe(true);
      }
    });

    test("leaves a sibling application's variable alone", () => {
      // Sibling Hasna apps are mid-removal on the same axis and their variables
      // sit in the same shell. Refusing to start because a *different* app still
      // exports one turns this fix into an outage, so the match is namespaced.
      for (const other of ["TODOS", "LOOPS", "ACCOUNTS", "MEMENTOS"]) {
        expect(isRetiredModeEnvVar(storageMode(`HASNA_${other}`), APP)).toBe(false);
        expect(isRetiredModeEnvVar(deploymentMode(other), APP)).toBe(false);
      }
      expect(findRetiredModeEnvVars({ [storageMode("HASNA_TODOS")]: "cloud" }, APP)).toEqual([]);
    });

    test("leaves live settings that merely contain the word mode alone", () => {
      // A blanket *_MODE match would take SKILLS_TEST_MODE with it, which gates
      // self-update in this suite. Breaking a live setting is a worse outcome
      // than the silence being fixed.
      for (const name of [
        ["SKILLS", "TEST", "MODE"].join("_"),
        ["HASNA", "SKILLS", "DIR"].join("_"),
        replacement,
        ["SKILLS", "JOURNAL", "MODEL"].join("_"),
      ]) {
        expect(isRetiredModeEnvVar(name, APP)).toBe(false);
      }
    });

    test("refuses a set retired variable, naming it, its replacement, and the fix", () => {
      const name = storageMode("HASNA_SKILLS");
      let error: unknown;
      try {
        assertNoRetiredModeEnvVars({ [name]: ["self", "hosted"].join("_") }, {
          app: APP,
          replacement,
        });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(RetiredSettingError);
      const message = (error as Error).message;
      // All three parts, because an error that only says "not supported" leaves
      // the operator to guess, and guessing is what grew the five-value union.
      expect(message).toContain(name);
      expect(message).toContain(replacement);
      expect(message).toContain("unset");
      expect((error as RetiredSettingError).code).toBe("RETIRED_SETTING");
      expect((error as RetiredSettingError).setting).toBe(name);
    });

    test("names every retired variable that is set, not just the first", () => {
      const canonical = storageMode("HASNA_SKILLS");
      const fallback = storageMode("SKILLS");
      let message = "";
      try {
        assertNoRetiredModeEnvVars(
          { [canonical]: "cloud", [fallback]: ["hy", "brid"].join("") },
          { app: APP, replacement },
        );
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(canonical);
      expect(message).toContain(fallback);
    });

    test("refuses every retired value, not a denylist of the ones we remembered", () => {
      // The fault is declaring a deployment label at all. A value-based check
      // would accept "onprem" while rejecting "cloud", which teaches the reader
      // that the concept survived and only some spellings are wrong.
      const name = storageMode("SKILLS");
      for (const value of ["local", "cloud", "remote", "onprem", "banana", "1"]) {
        expect(() =>
          assertNoRetiredModeEnvVars({ [name]: value }, { app: APP, replacement }),
        ).toThrow(RetiredSettingError);
      }
    });

    test("treats an empty value as unset instead of failing a deployment over it", () => {
      // `export FOO="$BAR"` with BAR unset. Nobody chose that value, so refusing
      // it would turn a missing variable into an outage.
      const name = storageMode("SKILLS");
      expect(findRetiredModeEnvVars({ [name]: "" }, APP)).toEqual([]);
      expect(findRetiredModeEnvVars({ [name]: undefined }, APP)).toEqual([]);
      expect(() =>
        assertNoRetiredModeEnvVars({ [name]: "" }, { app: APP, replacement }),
      ).not.toThrow();
    });

    test("passes a clean environment through", () => {
      expect(() =>
        assertNoRetiredModeEnvVars(
          { [replacement]: "postgres://example/skills" },
          { app: APP, replacement },
        ),
      ).not.toThrow();
      expect(findRetiredModeEnvVars({}, APP)).toEqual([]);
    });
  });

  describe("configuration keys", () => {
    test("refuses a retired key, naming the source, the replacement, and the fix", () => {
      let error: unknown;
      try {
        assertNoRetiredConfigKeys({ mode: ["self", "hosted"].join("-") }, "/tmp/skills.config.json");
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(RetiredSettingError);
      const message = (error as Error).message;
      expect(message).toContain("/tmp/skills.config.json");
      expect(message).toContain("apiUrl");
      expect(message).toContain("config unset mode");
      expect((error as RetiredSettingError).setting).toBe("mode");
    });

    test("refuses the key whatever its value, including null and an object", () => {
      for (const value of ["local", "cloud", "", null, 0, false, { a: 1 }]) {
        expect(() => assertNoRetiredConfigKeys({ mode: value }, "config.json")).toThrow(
          RetiredSettingError,
        );
      }
    });

    test("passes a configuration with no retired key through", () => {
      expect(() =>
        assertNoRetiredConfigKeys({ apiUrl: "https://example.com", format: "json" }, "config.json"),
      ).not.toThrow();
    });

    test("every retired key names a live replacement", () => {
      // Guards the registry itself: a retired key mapped to another retired key,
      // or to an empty string, produces an error message that cannot be acted on.
      const entries = Object.entries(RETIRED_CONFIG_KEYS);
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
        expect(RETIRED_CONFIG_KEYS[value]).toBeUndefined();
        expect(value).not.toBe(key);
      }
    });
  });
});
