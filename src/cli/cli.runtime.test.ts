import { describe, expect, test } from "bun:test";
import {
  CLI_PATH,
  EXPECTED_ALL_SKILL_COUNT,
  EXPECTED_BASIC_SKILL_COUNT,
  PACKAGE_VERSION,
  SLOW_TEST_TIMEOUT,
  runCli,
  runCliInCwd,
} from "./cli.test-utils";
import { getFirstRunOnboardingMessage, shouldShowFirstRunOnboarding } from "./onboarding";

describe("CLI runtime and misc commands", () => {
  describe("first-run onboarding guard", () => {
    test("nudges interactive normal commands until a hosted or local mode is configured", () => {
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["list"],
          commandName: "list",
          config: {},
          isInteractive: true,
        }),
      ).toBe(true);
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["list"],
          commandName: "list",
          config: { mode: "local" },
          isInteractive: true,
        }),
      ).toBe(false);
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["run", "image"],
          commandName: "run",
          config: { mode: "hosted" },
          isInteractive: true,
        }),
      ).toBe(false);
    });

    test("stays quiet for JSON, help, onboarding, and automation", () => {
      for (const input of [
        { argv: ["list", "--json"], commandName: "list", isInteractive: true },
        { argv: ["list", "--help"], commandName: "list", isInteractive: true },
        { argv: ["setup"], commandName: "setup", isInteractive: true },
        { argv: ["auth", "login"], commandName: "auth", isInteractive: true },
        { argv: ["list"], commandName: "list", isInteractive: false },
        { argv: ["list"], commandName: "list", isInteractive: true, testMode: true },
      ]) {
        expect(shouldShowFirstRunOnboarding({ ...input, config: {} })).toBe(false);
      }
    });

    test("points to hosted first and local second without naming skills.md as a mode", () => {
      const message = getFirstRunOnboardingMessage();
      expect(message).toContain("skills setup --mode hosted");
      expect(message).toContain("skills auth login");
      expect(message).toContain("skills setup --mode local");
      expect(message).not.toContain("--mode skills.md");
    });
  });

  describe("setup mode", () => {
    test("stores local mode in project config", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-local-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(["setup", "--mode", "local", "--json"], tmpDir, { HOME: tmpDir });
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ mode: "local", scope: "project" });
        const config = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"));
        expect(config.mode).toBe("local");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("stores hosted mode and API URL while accepting legacy skills.md alias", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-hosted-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--mode", "skills.md", "--api-url", "https://skills.example.com/api/v1", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ mode: "hosted", scope: "project" });
        expect(data.next).toContain("skills auth login");
        const config = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"));
        expect(config.mode).toBe("hosted");
        expect(config.apiUrl).toBe("https://skills.example.com/api/v1");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("stores canonical hosted mode from --mode hosted", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-hosted-canonical-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--mode", "hosted", "--api-url", "https://skills.example.com", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ mode: "hosted", scope: "project" });
        expect(JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"))).toMatchObject({
          mode: "hosted",
          apiUrl: "https://skills.example.com",
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("hosted account command namespaces", () => {
    test("exposes billing and credits commands outside auth", async () => {
      const billing = await runCli(["billing", "--help"]);
      expect(billing.exitCode).toBe(0);
      expect(billing.stdout).toContain("status");
      expect(billing.stdout).toContain("checkout");
      expect(billing.stdout).toContain("portal");
      expect(billing.stdout).toContain("buy-credits");

      const credits = await runCli(["credits", "--help"]);
      expect(credits.exitCode).toBe(0);
      expect(credits.stdout).toContain("buy");
      expect(credits.stdout).toContain("packs");
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
      const { stdout } = await runCli(["test", "image", "--json"]);
      // exit code may be non-zero if env vars are missing, that's fine
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      const entry = data[0];
      expect(entry).toHaveProperty("skill", "image");
      expect(entry).toHaveProperty("envVars");
      expect(entry).toHaveProperty("systemDeps");
      expect(entry).toHaveProperty("npmDeps");
      expect(entry).toHaveProperty("ready");
      expect(Array.isArray(entry.envVars)).toBe(true);
      expect(typeof entry.ready).toBe("boolean");
    });

    test("each envVars entry has name and set fields", async () => {
      const { stdout } = await runCli(["test", "image", "--json"]);
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

        const add = await runCliInCwd(["schedule", "add", "image", "*/5 * * * *", "--name", "json-test", "--json"], tmpDir);
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

    test("due premium schedules require remote auth and do not run locally in test mode", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-premium-remote-"));
      const env = { HOME: tmpDir, SKILLS_API_KEY: "", SKILLS_TEST_MODE: "1" };
      try {
        const add = await runCliInCwd(["schedule", "add", "image", "*/5 * * * *", "--name", "premium-image", "--json"], tmpDir, env);
        expect(add.exitCode).toBe(0);

        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const run = await runCliInCwd(["schedule", "run", "--json"], tmpDir, env);
        expect(run.exitCode).toBe(0);
        const result = JSON.parse(run.stdout);
        expect(result).toMatchObject({
          ran: 1,
          results: [
            {
              name: "premium-image",
              skill: "image",
              status: "error",
            },
          ],
        });
        expect(result.results[0].error).toContain("hosted skill");
        expect(result.results[0].error).toContain("skills auth login");
        expect(result.results[0].error).not.toContain("Skill Image CLI");
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
  });
});
