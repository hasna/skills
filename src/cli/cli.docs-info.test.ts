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

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("CLI docs and validation", () => {
  describe("docs", () => {
    test("shows documentation for a skill with SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "logo-design"]);
      expect(stdout).toContain("Logo Design");
    });

    test("shows CLAUDE.md when no SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "apidocs"]);
      expect(stdout).toContain("service-apidocs");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["docs", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["docs", "logo-design", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.skill).toBe("logo-design");
      expect(data.hasSkillMd).toBe(true);
      expect(data.content).toBeTruthy();
    });

    test("shows specific file with --file", async () => {
      const { stdout } = await runCli(["docs", "logo-design", "--file", "skill"]);
      expect(stdout).toContain("Logo Design");
    });

    test("shows claude file with --file claude", async () => {
      const { stdout } = await runCli(["docs", "apidocs", "--file", "claude"]);
      expect(stdout).toContain("apidocs");
    });
  });

  describe("requires", () => {
    test("shows requirements for a skill", async () => {
      const { stdout } = await runCli(["requires", "audio-transcript-pack"]);
      expect(stdout).toContain("Requirements for audio-transcript-pack");
      expect(stdout).not.toContain("SKILLS_API_KEY");
    });

    test("shows CLI command", async () => {
      const { stdout } = await runCli(["requires", "audio-transcript-pack"]);
      expect(stdout).toContain("skills run audio-transcript-pack");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["requires", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["requires", "audio-transcript-pack", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.envVars).not.toContain("SKILL_API_KEY");
      // BYO-key: the user's own provider variable must be surfaced, not hidden.
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.cliCommand).toBe("skills run audio-transcript-pack");
      expect(data).toHaveProperty("systemDeps");
      expect(data).toHaveProperty("dependencies");
    });

    test("preserves provider API keys for free local skills", async () => {
      const { stdout } = await runCli(["requires", "brand-style-guide", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.cliCommand).toBe("skills run brand-style-guide");
    });

    test("shows npm dependencies", async () => {
      const { stdout } = await runCli(["requires", "read-csv"]);
      expect(stdout).toContain("npm dependencies");
      expect(stdout).toContain("csv-parse");
    });
  });

  describe("validate", () => {
    test("outputs structured validation result with --json", async () => {
      const { stdout, exitCode } = await runCli(["validate", "logo-design", "--json"]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(data).toHaveProperty("name", "logo-design");
      expect(data).toHaveProperty("valid", true);
      expect(data).toHaveProperty("issues");
      expect(data).toHaveProperty("warnings");
      expect(data).toHaveProperty("metadata");
      expect(Array.isArray(data.issues)).toBe(true);
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(data.metadata.runtime).toBe("local");
      expect(data.metadata.binCommands).toEqual(["logo-design"]);
    });

    test("outputs structured validation errors for missing skills", async () => {
      const { stdout, exitCode } = await runCli(["validate", "not-a-skill", "--json"]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(1);
      expect(data).toHaveProperty("name", "not-a-skill");
      expect(data).toHaveProperty("valid", false);
      expect(data.issues[0]).toHaveProperty("code", "skill.dir_missing");
      expect(data).toHaveProperty("metadata");
    });
  });

  describe("info (enriched)", () => {
    test("JSON includes envVars and cliCommand", async () => {
      const { stdout } = await runCli(["info", "audio-transcript-pack", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("audio-transcript-pack");
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.envVars).not.toContain("SKILL_API_KEY");
      // BYO-key: the user's own provider variable must be surfaced, not hidden.
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("GEMINI_API_KEY");
      expect(data.cliCommand).toBe("skills run audio-transcript-pack");
      expect(data).not.toHaveProperty("pricing");
    });

    test("human-readable shows env vars", async () => {
      const { stdout } = await runCli(["info", "audio-transcript-pack"]);
      expect(stdout).toContain("Env vars:");
      expect(stdout).not.toContain("SKILLS_API_KEY");
      expect(stdout).not.toContain("Pricing:");
      expect(stdout).toContain("OPENAI_API_KEY");
      expect(stdout.toLowerCase()).not.toContain("gemini");
      expect(stdout.toLowerCase()).not.toContain("minimax");
    });
  });

});
