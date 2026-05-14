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

describe("CLI docs and validation", () => {
  describe("docs", () => {
    test("shows documentation for a skill with SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "image"]);
      expect(stdout).toContain("Image Generation");
    });

    test("shows CLAUDE.md when no SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "deepresearch"]);
      expect(stdout).toContain("deepresearch");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["docs", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["docs", "image", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.skill).toBe("image");
      expect(data.hasSkillMd).toBe(true);
      expect(data.content).toBeTruthy();
    });

    test("shows specific file with --file", async () => {
      const { stdout } = await runCli(["docs", "image", "--file", "skill"]);
      expect(stdout).toContain("Image Generation");
    });

    test("shows claude file with --file claude", async () => {
      const { stdout } = await runCli(["docs", "deepresearch", "--file", "claude"]);
      expect(stdout).toContain("deepresearch");
    });
  });

  describe("requires", () => {
    test("shows requirements for a skill", async () => {
      const { stdout } = await runCli(["requires", "image"]);
      expect(stdout).toContain("Requirements for image");
      expect(stdout).toContain("SKILL_API_KEY");
    });

    test("shows CLI command", async () => {
      const { stdout } = await runCli(["requires", "image"]);
      expect(stdout).toContain("image");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["requires", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["requires", "image", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars).toContain("SKILL_API_KEY");
      expect(data.envVars).not.toContain("OPENAI_API_KEY");
      expect(data.cliCommand).toBe("skills run image");
      expect(data).toHaveProperty("systemDeps");
      expect(data).toHaveProperty("dependencies");
    });

    test("preserves provider API keys for free local skills", async () => {
      const { stdout } = await runCli(["requires", "brand-style-guide", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("SKILL_API_KEY");
      expect(data.cliCommand).toBe("skills run brand-style-guide");
    });

    test("shows npm dependencies", async () => {
      const { stdout } = await runCli(["requires", "deepresearch"]);
      expect(stdout).toContain("npm dependencies");
      expect(stdout).toContain("commander");
    });
  });

  describe("validate", () => {
    test("outputs structured validation result with --json", async () => {
      const { stdout, exitCode } = await runCli(["validate", "image", "--json"]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(data).toHaveProperty("name", "image");
      expect(data).toHaveProperty("valid", true);
      expect(data).toHaveProperty("issues");
      expect(data).toHaveProperty("warnings");
      expect(data).toHaveProperty("metadata");
      expect(Array.isArray(data.issues)).toBe(true);
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(data.metadata.binCommands).toContain("image");
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
      const { stdout } = await runCli(["info", "image", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("image");
      expect(data.envVars).toContain("SKILL_API_KEY");
      expect(data.envVars).not.toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("GEMINI_API_KEY");
      expect(data.cliCommand).toBe("skills run image");
      expect(data.pricing.formattedCost).toBe("$0.04 estimated");
    });

    test("human-readable shows env vars", async () => {
      const { stdout } = await runCli(["info", "image"]);
      expect(stdout).toContain("Env vars:");
      expect(stdout).toContain("SKILL_API_KEY");
      expect(stdout).toContain("Pricing: $0.04 estimated");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("gemini");
      expect(stdout.toLowerCase()).not.toContain("minimax");
    });
  });

});
