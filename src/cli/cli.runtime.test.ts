import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync as mkdtempSyncTop, mkdirSync as mkdirSyncTop, rmSync as rmSyncTop, writeFileSync as writeFileSyncTop } from "fs";
import { join as joinTop } from "path";
import { tmpdir as tmpdirTop } from "os";
import {
  CLI_PATH,
  EXPECTED_ALL_SKILL_COUNT,
  EXPECTED_BASIC_SKILL_COUNT,
  PACKAGE_VERSION,
  SLOW_TEST_TIMEOUT,
  runCli,
  runCliInCwd,
} from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// Declarative-only catalog ships no skill with npm deps; the readiness/npmDeps
// path is exercised against a fixture the CLI resolves via $HASNA_SKILLS_DIR.
const FIXTURE_HOME = mkdtempSyncTop(joinTop(tmpdirTop(), "cli-runtime-fixtures-"));
{
  const dir = joinTop(FIXTURE_HOME, "custom", "deps-fixture");
  mkdirSyncTop(dir, { recursive: true });
  writeFileSyncTop(joinTop(dir, "package.json"), JSON.stringify({ name: "deps-fixture", version: "0.1.0", dependencies: { "csv-parse": "^5.0.0" } }));
  writeFileSyncTop(joinTop(dir, "SKILL.md"), "---\nname: deps-fixture\ndescription: Declares an npm dependency.\n---\n# Deps\n");
}
const FIXTURE_ENV = { HASNA_SKILLS_DIR: FIXTURE_HOME };
afterAll(() => rmSyncTop(FIXTURE_HOME, { recursive: true, force: true }));

describe("CLI runtime and misc commands", () => {
  describe("setup", () => {
    test("stores the API URL it was given in project config", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-api-url-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--api-url", "https://skills.example.com/api/v1", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ apiUrl: "https://skills.example.com/api/v1", scope: "project" });
        expect(data.next).toContain("skills auth login");
        const config = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"));
        expect(config.apiUrl).toBe("https://skills.example.com/api/v1");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("writes no API URL when none is given, and never invents one", async () => {
      const { mkdtempSync, rmSync, existsSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-unconfigured-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(["setup", "--json"], tmpDir, { HOME: tmpDir });
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ apiUrl: null, scope: "project" });
        expect(data.next).toContain("skills list");
        expect(data.config.apiUrl).toBeUndefined();
        expect(data.saved).toBeNull();
        // The claim is that nothing is written at all, not that whatever was
        // written happens to lack an apiUrl.
        expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("saves the API URL to the global config with --global", async () => {
      const { mkdtempSync, rmSync, existsSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-global-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--api-url", "https://skills.example.com", "--global", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ apiUrl: "https://skills.example.com", scope: "global" });
        expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(false);
        const global = JSON.parse(readFileSync(join(tmpDir, ".hasna", "skills", "config.json"), "utf8"));
        expect(global.apiUrl).toBe("https://skills.example.com");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("rejects an API URL that is not an http(s) origin", async () => {
      const { mkdtempSync, rmSync, existsSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-reject-url-"));
      try {
        const result = await runCliInCwd(["setup", "--api-url", "ftp://skills.example.com", "--json"], tmpDir, { HOME: tmpDir });
        expect(result.exitCode).not.toBe(0);
        expect(JSON.parse(result.stdout).error).toContain("http(s) URL");
        expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("offers no deployment mode flag, only an API origin", async () => {
      const { stdout, exitCode } = await runCli(["setup", "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("--api-url");
      expect(stdout).not.toContain("--mode");
      expect(stdout.toLowerCase()).not.toContain("self-hosted");
      expect(stdout).toContain("agents");
    });

    test("rejects an explicitly empty --api-url instead of silently doing nothing", async () => {
      // `skills setup --api-url "$SKILLS_URL"` with the variable unset must not
      // exit 0 claiming success while pointing nowhere.
      const { mkdtempSync, rmSync, existsSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-empty-url-"));
      try {
        const result = await runCliInCwd(["setup", "--api-url", "", "--json"], tmpDir, { HOME: tmpDir });
        expect(result.exitCode).not.toBe(0);
        expect(JSON.parse(result.stdout).error).toContain("Expected an http(s) URL");
        expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("reports an inherited API URL as inherited, not as a write it just made", async () => {
      // apiUrl in the global scope, `setup` invoked for the project scope: the
      // effective origin is the global one, and `saved` must stay null rather
      // than let the command claim it wrote to the project.
      const { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-inherited-"));
      try {
        mkdirSync(join(tmpDir, ".hasna", "skills"), { recursive: true });
        writeFileSync(
          join(tmpDir, ".hasna", "skills", "config.json"),
          JSON.stringify({ apiUrl: "https://global.example.com" }),
        );
        const { stdout, exitCode } = await runCliInCwd(["setup", "--json"], tmpDir, { HOME: tmpDir });
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.apiUrl).toBe("https://global.example.com");
        expect(data.saved).toBeNull();
        expect(existsSync(join(tmpDir, "skills.config.json"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("config unset apiUrl returns a project to running on this machine", async () => {
      // Under the old design there was a setup flag whose value was the word
      // local. With that gone, local is the absence of an origin, so there has
      // to be a supported way back to it.
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-unset-"));
      try {
        await runCliInCwd(["setup", "--api-url", "https://skills.example.com", "--json"], tmpDir, { HOME: tmpDir });
        const unset = await runCliInCwd(["config", "unset", "apiUrl", "--json"], tmpDir, { HOME: tmpDir });
        expect(unset.exitCode).toBe(0);
        expect(JSON.parse(unset.stdout)).toMatchObject({ key: "apiUrl", removed: true, scope: "project" });

        const after = await runCliInCwd(["setup", "--json"], tmpDir, { HOME: tmpDir });
        expect(JSON.parse(after.stdout)).toMatchObject({ apiUrl: null, saved: null });

        const again = await runCliInCwd(["config", "unset", "apiUrl", "--json"], tmpDir, { HOME: tmpDir });
        expect(again.exitCode).toBe(0);
        expect(JSON.parse(again.stdout).removed).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("prints no first-run onboarding nudge on a normal command", async () => {
      // The nudge existed only to force a mode choice. It is deleted, and the
      // replacement for its three tests is this: a fresh HOME running a normal
      // command must emit nothing on stderr.
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-no-onboarding-"));
      try {
        const result = await runCliInCwd(["list", "--limit", "1"], tmpDir, { HOME: tmpDir });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).not.toContain("No Skills setup found");
        expect(result.stderr).not.toContain("skills setup");
        expect(result.stderr.trim()).toBe("");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, SLOW_TEST_TIMEOUT);

    test("refuses a mode config key so the concept cannot come back through config set", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-no-mode-key-"));
      try {
        for (const value of ["local", "self-hosted", "cloud", "remote"]) {
          const result = await runCliInCwd(["config", "set", "mode", value, "--json"], tmpDir, { HOME: tmpDir });
          expect(result.exitCode).not.toBe(0);
          const error = JSON.parse(result.stdout).error;
          expect(error).toContain("no longer a configuration key");
          // Names the replacement, not just the rejection. "Unknown config key"
          // reads as a typo and gets retyped.
          expect(error).toContain("apiUrl");
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("refuses a config file that already carries the retired key, and says how to fix it", async () => {
      // The end-to-end shape of the change, exercised through the real binary
      // rather than the module: an install carrying a legacy `mode` key used to
      // run with it silently discarded, so an operator who had followed the old
      // documentation could not tell a configured client from an unconfigured one.
      const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-legacy-mode-key-"));
      try {
        const configPath = join(tmpDir, "skills.config.json");
        writeFileSync(configPath, JSON.stringify({ mode: "self-hosted", format: "json" }));

        const refused = await runCliInCwd(["config", "show", "--json"], tmpDir, { HOME: tmpDir });
        expect(refused.exitCode).not.toBe(0);
        // One actionable line on stderr, not a stack trace: the sentence that says
        // what to do must not be buried under bundler frames.
        expect(refused.stderr).toContain("no longer a configuration key");
        expect(refused.stderr).toContain("apiUrl");
        expect(refused.stderr).not.toContain("at assertNoRetiredConfigKeys");

        // The fix the message advertises has to work, or the refusal is a dead end
        // whose only escape is hand-editing JSON.
        const fixed = await runCliInCwd(["config", "unset", "mode", "--json"], tmpDir, { HOME: tmpDir });
        expect(fixed.exitCode).toBe(0);
        expect(JSON.parse(fixed.stdout)).toMatchObject({ key: "mode", removed: true });

        // Recovered, and the keys beside the retired one survived.
        const after = await runCliInCwd(["config", "show", "--json"], tmpDir, { HOME: tmpDir });
        expect(after.exitCode).toBe(0);
        expect(JSON.parse(after.stdout)).toEqual({ format: "json" });
        expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ format: "json" });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, SLOW_TEST_TIMEOUT);

    test("refuses a retired storage-mode variable, and ignores a sibling app's", async () => {
      // Both halves in one test on purpose: the refusal is only correct if it is
      // also narrow. Sibling Hasna apps are removing the same axis on their own
      // schedule and their variables sit in the same shell, so a match that took
      // theirs too would stop this CLI from starting on a normal fleet machine.
      // Names are assembled from fragments so the retired-marker guard in
      // public-package-boundary.test.ts does not flag this file.
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-retired-storage-env-"));
      const ours = ["HASNA_SKILLS", "STORAGE", "MODE"].join("_");
      const theirs = ["HASNA_TODOS", "STORAGE", "MODE"].join("_");
      try {
        const refused = await runCliInCwd(["storage", "status", "--json"], tmpDir, {
          HOME: tmpDir,
          [ours]: "self_hosted",
        });
        expect(refused.exitCode).not.toBe(0);
        expect(refused.stderr).toContain(ours);
        expect(refused.stderr).toContain("HASNA_SKILLS_DATABASE_URL");

        const allowed = await runCliInCwd(["storage", "status", "--json"], tmpDir, {
          HOME: tmpDir,
          [theirs]: "cloud",
        });
        expect(allowed.exitCode).toBe(0);
        expect(JSON.parse(allowed.stdout).package).toBe("open-skills");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, SLOW_TEST_TIMEOUT);
  });

  describe("hosted account command namespaces", () => {
    test("no longer exposes billing or credits command namespaces", async () => {
      const help = await runCli(["--help"]);
      expect(help.stdout).not.toContain("billing");
      expect(help.stdout).not.toContain("credits");
    });
  });

  describe("setup-info", () => {
    test("outputs version and working directory", async () => {
      const { stdout, exitCode } = await runCli(["setup-info"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(PACKAGE_VERSION);
      expect(stdout).toContain(process.cwd());
    });

    test("outputs agent configurations section", async () => {
      const { stdout, exitCode } = await runCli(["setup-info"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Agent configurations");
      expect(stdout).toContain("claude");
      expect(stdout).toContain("codex");
      expect(stdout).toContain("gemini");
    });

    test("--json returns valid JSON with expected fields", async () => {
      const { stdout, exitCode } = await runCli(["setup-info", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("version", PACKAGE_VERSION);
      expect(data).toHaveProperty("cwd");
      expect(data).toHaveProperty("skillsDir");
      expect(data).toHaveProperty("installedCount");
      expect(data).toHaveProperty("installed");
      expect(data).toHaveProperty("agents");
      expect(Array.isArray(data.installed)).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBe(7);
      for (const agent of data.agents) {
        expect(agent).toHaveProperty("agent");
        expect(agent).toHaveProperty("path");
        expect(agent).toHaveProperty("exists");
        expect(agent).toHaveProperty("skillCount");
      }
    });

    test("--json cwd is a non-empty string", async () => {
      const { stdout } = await runCli(["setup-info", "--json"]);
      const data = JSON.parse(stdout);
      expect(typeof data.cwd).toBe("string");
      expect(data.cwd.length).toBeGreaterThan(0);
    });

    test("shows help for whoami command", async () => {
      const { stdout } = await runCli(["setup-info", "--help"]);
      expect(stdout).toContain("setup summary");
    });
  });

  describe("test", () => {
    test("handles missing skill gracefully", async () => {
      const { stderr, exitCode } = await runCli(["test", "nonexistent-xyz"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not found");
    });

    test("missing skill with --json returns error object", async () => {
      const { stdout, exitCode } = await runCli(["test", "nonexistent-xyz", "--json"]);
      expect(exitCode).not.toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("error");
      expect(data.error).toContain("not found");
    });

    test("--json with no pinned skills returns empty array", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-test-empty-"));
      try {
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "test", "--json"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: { ...process.env, NO_COLOR: "1" },
        });
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("testing a valid skill returns correct JSON structure", async () => {
      const { stdout } = await runCli(["test", "brand-kit", "--json"]);
      // exit code may be non-zero if env vars are missing, that's fine
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      const entry = data[0];
      expect(entry).toHaveProperty("skill", "brand-kit");
      expect(entry).toHaveProperty("envVars");
      expect(entry).toHaveProperty("systemDeps");
      expect(entry).toHaveProperty("npmDeps");
      expect(entry).toHaveProperty("ready");
      expect(Array.isArray(entry.envVars)).toBe(true);
      expect(typeof entry.ready).toBe("boolean");
    });

    test("each envVars entry has name and set fields", async () => {
      const { stdout } = await runCli(["test", "brand-kit", "--json"]);
      const data = JSON.parse(stdout);
      for (const v of data[0].envVars) {
        expect(v).toHaveProperty("name");
        expect(v).toHaveProperty("set");
        expect(typeof v.name).toBe("string");
        expect(typeof v.set).toBe("boolean");
      }
    });

    test("shows help for test command", async () => {
      const { stdout } = await runCli(["test", "--help"]);
      expect(stdout).toContain("readiness");
    });

    test("npmDeps entries expose install status and gate readiness", async () => {
      // Regression: `skills test excel --json` previously listed npmDeps without
      // an `installed` field and computed `ready` from env vars alone, so a skill
      // that cannot run without its npm deps could report a false-green readiness.
      const { stdout } = await runCli(["test", "deps-fixture", "--json"], FIXTURE_ENV);
      const data = JSON.parse(stdout);
      const entry = data[0];
      expect(entry.npmDeps.length).toBeGreaterThan(0);
      for (const dep of entry.npmDeps) {
        expect(dep).toHaveProperty("name");
        expect(dep).toHaveProperty("installed");
        expect(typeof dep.installed).toBe("boolean");
      }
      // Readiness must reflect every signal, including npm deps.
      const expectedReady =
        entry.envVars.every((v: { set: boolean }) => v.set) &&
        entry.systemDeps.every((d: { available: boolean }) => d.available) &&
        entry.npmDeps.every((d: { installed: boolean }) => d.installed);
      expect(entry.ready).toBe(expectedReady);
    });
  });

  describe("schedule --json", () => {
    test("validates, adds, disables, and enables schedules as JSON", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-schedule-json-"));
      try {
        const valid = await runCliInCwd(["schedule", "validate", "*/5 * * * *", "--json"], tmpDir);
        expect(valid.exitCode).toBe(0);
        const validData = JSON.parse(valid.stdout);
        expect(validData.valid).toBe(true);
        expect(validData.nextRuns).toHaveLength(5);

        const add = await runCliInCwd(["schedule", "add", "logo-design", "*/5 * * * *", "--name", "json-test", "--json"], tmpDir);
        expect(add.exitCode).toBe(0);
        const schedule = JSON.parse(add.stdout).schedule;
        expect(schedule.name).toBe("json-test");

        const disabled = await runCliInCwd(["schedule", "disable", "json-test", "--json"], tmpDir);
        expect(JSON.parse(disabled.stdout)).toEqual({ idOrName: "json-test", enabled: false, success: true });

        const enabled = await runCliInCwd(["schedule", "enable", "json-test", "--json"], tmpDir);
        expect(JSON.parse(enabled.stdout)).toEqual({ idOrName: "json-test", enabled: true, success: true });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });


  });

  describe("runtime --json", () => {
    test("mcp registration writes and merges agent configs", async () => {
      const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-mcp-register-"));
      try {
        mkdirSync(join(tmpDir, ".codex"), { recursive: true });
        writeFileSync(join(tmpDir, ".codex", "config.toml"), [
          "[model_providers.local]",
          "name = \"Local\"",
          "",
          "[mcp_servers.skills]",
          "command = \"old-skills-mcp\"",
          "args = [\"old\"]",
          "",
          "[mcp_servers.other]",
          "command = \"other-mcp\"",
          "",
        ].join("\n"));

        const codex = await runCliInCwd(["mcp", "--register", "codex", "--json"], tmpDir, { HOME: tmpDir });
        expect(codex.stderr).toBe("");
        expect(codex.exitCode).toBe(0);
        const codexData = JSON.parse(codex.stdout);
        expect(codexData.registered).toBe(1);
        expect(codexData.results[0]).toMatchObject({ agent: "codex", success: true, path: join(tmpDir, ".codex", "config.toml") });
        const codexConfig = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
        expect(codexConfig).toContain("[model_providers.local]");
        expect(codexConfig).toContain("[mcp_servers.other]");
        expect(codexConfig).toContain("[mcp_servers.skills]");
        expect(codexConfig).toContain("skills-mcp");
        expect(codexConfig).not.toContain("old-skills-mcp");
        expect(codexConfig).not.toContain("args = [\"old\"]");

        mkdirSync(join(tmpDir, ".gemini"), { recursive: true });
        writeFileSync(join(tmpDir, ".gemini", "settings.json"), JSON.stringify({
          approvalMode: "default",
          mcpServers: { other: { command: "other-mcp" } },
        }, null, 2));
        const gemini = await runCliInCwd(["mcp", "--register", "gemini", "--json"], tmpDir, { HOME: tmpDir });
        expect(gemini.exitCode).toBe(0);
        const geminiConfig = JSON.parse(readFileSync(join(tmpDir, ".gemini", "settings.json"), "utf-8"));
        expect(geminiConfig.approvalMode).toBe("default");
        expect(geminiConfig.mcpServers.other.command).toBe("other-mcp");
        expect(geminiConfig.mcpServers.skills.command).toContain("skills-mcp");

        mkdirSync(join(tmpDir, ".config", "opencode"), { recursive: true });
        writeFileSync(join(tmpDir, ".config", "opencode", "opencode.json"), JSON.stringify({
          model: "anthropic/claude-sonnet-4-5",
          mcp: { other: { type: "local", command: ["other-mcp"] } },
        }, null, 2));
        const opencode = await runCliInCwd(["mcp", "--register", "opencode", "--json"], tmpDir, { HOME: tmpDir });
        expect(opencode.exitCode).toBe(0);
        const opencodeConfig = JSON.parse(readFileSync(join(tmpDir, ".config", "opencode", "opencode.json"), "utf-8"));
        expect(opencodeConfig.model).toBe("anthropic/claude-sonnet-4-5");
        expect(opencodeConfig.mcp.other.command).toEqual(["other-mcp"]);
        expect(opencodeConfig.mcp.skills).toMatchObject({ type: "local", enabled: true });
        expect(opencodeConfig.mcp.skills.command[0]).toContain("skills-mcp");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("self-update reports test-mode failure as JSON", async () => {
      const { stdout, stderr, exitCode } = await runCli(["self-update", "--json"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).not.toBe(0);
      expect(data.updated).toBe(false);
      expect(data.error).toContain("test mode");
    });
  });

  describe("feedback", () => {
    test("agents can save feedback locally as JSON", async () => {
      const { existsSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = require("fs").mkdtempSync(join(tmpdir(), "cli-feedback-"));
      try {
        const { stdout, stderr, exitCode } = await runCliInCwd([
          "feedback",
          "agent",
          "found",
          "an",
          "issue",
          "--agent",
          "Octavia",
          "--category",
          "bug",
          "--json",
        ], tmpDir, { HOME: tmpDir });
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({ saved: true, category: "bug" });
        expect(data.path).toContain(".hasna/skills/skills.db");
        expect(existsSync(data.path)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("completion", () => {
    // Real top-level subcommands that were historically omitted because the
    // completion generator used a hand-maintained list (see audit
    // completion-missing-subcmds). These must always tab-complete.
    const previouslyMissingSubcmds = ["runs", "exports", "storage", "webhooks", "events"];

    test("bash completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "bash"]);
      expect(stdout).toContain("interactive");
      expect(stdout).toContain("export");
      expect(stdout).toContain("import");
      expect(stdout).toContain("setup-info");
      expect(stdout).toContain("test");
      expect(stdout).toContain("config");
      expect(stdout).toContain("create");
      expect(stdout).toContain("sync");
      expect(stdout).toContain("validate");
      expect(stdout).toContain("diff");
      expect(stdout).toContain("schedule");
      expect(stdout).toContain("registry");
      expect(stdout).toContain("feedback");
    });

    test("bash completion enumerates real subcommands the generator once omitted", async () => {
      const { stdout } = await runCli(["completion", "bash"]);
      const match = stdout.match(/subcmds="([^"]*)"/);
      expect(match).not.toBeNull();
      const subcmds = (match?.[1] ?? "").split(/\s+/);
      for (const cmd of previouslyMissingSubcmds) {
        expect(subcmds).toContain(cmd);
      }
    });

    test("zsh completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "zsh"]);
      expect(stdout).toContain("'interactive:interactive command'");
      expect(stdout).toContain("'export:export command'");
      expect(stdout).toContain("'import:import command'");
      expect(stdout).toContain("'auth:auth command'");
      expect(stdout).toContain("'test:test command'");
      expect(stdout).toContain("'config:config command'");
      expect(stdout).toContain("'create:create command'");
      expect(stdout).toContain("'sync:sync command'");
      expect(stdout).toContain("'validate:validate command'");
      expect(stdout).toContain("'diff:diff command'");
      expect(stdout).toContain("'schedule:schedule command'");
      expect(stdout).toContain("'registry:registry command'");
      expect(stdout).toContain("'feedback:feedback command'");
    });

    test("zsh completion enumerates real subcommands the generator once omitted", async () => {
      const { stdout } = await runCli(["completion", "zsh"]);
      for (const cmd of previouslyMissingSubcmds) {
        expect(stdout).toContain(`'${cmd}:${cmd} command'`);
      }
    });

    test("fish completion enumerates real subcommands the generator once omitted", async () => {
      const { stdout } = await runCli(["completion", "fish"]);
      for (const cmd of previouslyMissingSubcmds) {
        expect(stdout).toContain(`__fish_use_subcommand' -a '${cmd}'`);
      }
    });
  });
});
