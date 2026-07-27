import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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

// The declarative-only catalog ships no executable/BYO-key/CLAUDE-only skill, so
// the docs/requires/info paths that need those shapes are exercised against
// fixtures in a throwaway corpus the CLI resolves via $HASNA_SKILLS_DIR.
const FIXTURE_HOME = mkdtempSync(join(tmpdir(), "cli-docs-fixtures-"));
function writeFixture(name: string, files: { pkg?: unknown; skillMd?: string; claudeMd?: string }): void {
  const dir = join(FIXTURE_HOME, "custom", name);
  mkdirSync(dir, { recursive: true });
  if (files.pkg !== undefined) writeFileSync(join(dir, "package.json"), JSON.stringify(files.pkg, null, 2));
  if (files.skillMd !== undefined) writeFileSync(join(dir, "SKILL.md"), files.skillMd);
  if (files.claudeMd !== undefined) writeFileSync(join(dir, "CLAUDE.md"), files.claudeMd);
}
writeFixture("byo-fixture", {
  pkg: { name: "byo-fixture", version: "0.1.0" },
  skillMd: "---\nname: byo-fixture\ndescription: BYO-key fixture.\n---\n# BYO\n\nSet `OPENAI_API_KEY`.\n",
});
writeFixture("deps-fixture", {
  pkg: { name: "deps-fixture", version: "0.1.0", dependencies: { "csv-parse": "^5.0.0" } },
  skillMd: "---\nname: deps-fixture\ndescription: Declares a dependency.\n---\n# Deps\n",
});
writeFixture("claude-only-fixture", {
  pkg: { name: "claude-only-fixture", version: "0.1.0" },
  claudeMd: "# claude-only-fixture\n\nGuidance body with no SKILL.md.\n",
});
const FIXTURE_ENV = { HASNA_SKILLS_DIR: FIXTURE_HOME };

afterAll(() => {
  rmSync(FIXTURE_HOME, { recursive: true, force: true });
});

describe("CLI docs and validation", () => {
  describe("docs", () => {
    test("shows documentation for a skill with SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "brand-kit"]);
      expect(stdout).toContain("Brand Kit");
    });

    test("shows CLAUDE.md when no SKILL.md", async () => {
      const { stdout } = await runCli(["docs", "claude-only-fixture"], FIXTURE_ENV);
      expect(stdout).toContain("claude-only-fixture");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["docs", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["docs", "brand-kit", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.skill).toBe("brand-kit");
      expect(data.hasSkillMd).toBe(true);
      expect(data.content).toBeTruthy();
    });

    test("shows specific file with --file", async () => {
      const { stdout } = await runCli(["docs", "brand-kit", "--file", "skill"]);
      expect(stdout).toContain("Brand Kit");
    });

    test("shows claude file with --file claude", async () => {
      const { stdout } = await runCli(["docs", "blog-article", "--file", "claude"]);
      expect(stdout).toContain("blog-article");
    });
  });

  describe("requires", () => {
    test("shows requirements for a skill", async () => {
      const { stdout } = await runCli(["requires", "brand-kit"]);
      expect(stdout).toContain("Requirements for brand-kit");
      expect(stdout).not.toContain("SKILLS_API_KEY");
    });

    test("shows CLI command", async () => {
      const { stdout } = await runCli(["requires", "brand-kit"]);
      expect(stdout).toContain("skills run brand-kit");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["requires", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["requires", "byo-fixture", "--json"], FIXTURE_ENV);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.envVars).not.toContain("SKILL_API_KEY");
      // BYO-key: the user's own provider variable must be surfaced, not hidden.
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.cliCommand).toBe("skills run byo-fixture");
      expect(data).toHaveProperty("systemDeps");
      expect(data).toHaveProperty("dependencies");
    });

    test("preserves provider API keys for free local skills", async () => {
      const { stdout } = await runCli(["requires", "byo-fixture", "--json"], FIXTURE_ENV);
      const data = JSON.parse(stdout);
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.cliCommand).toBe("skills run byo-fixture");
    });

    test("shows npm dependencies", async () => {
      const { stdout } = await runCli(["requires", "deps-fixture"], FIXTURE_ENV);
      expect(stdout).toContain("npm dependencies");
      expect(stdout).toContain("csv-parse");
    });
  });

  describe("validate", () => {
    test("outputs structured validation result with --json", async () => {
      const { stdout, exitCode } = await runCli(["validate", "brand-kit", "--json"]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(data).toHaveProperty("name", "brand-kit");
      expect(data).toHaveProperty("valid", true);
      expect(data).toHaveProperty("issues");
      expect(data).toHaveProperty("warnings");
      expect(data).toHaveProperty("metadata");
      expect(Array.isArray(data.issues)).toBe(true);
      expect(Array.isArray(data.warnings)).toBe(true);
      // Instruction skills carry no runnable implementation.
      expect(data.metadata.runtime).toBe("none");
      expect(data.metadata.binCommands).toEqual([]);
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
      const { stdout } = await runCli(["info", "byo-fixture", "--json"], FIXTURE_ENV);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("byo-fixture");
      expect(data.envVars).not.toContain("SKILLS_API_KEY");
      expect(data.envVars).not.toContain("SKILL_API_KEY");
      // BYO-key: the user's own provider variable must be surfaced, not hidden.
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.envVars).not.toContain("GEMINI_API_KEY");
      expect(data.cliCommand).toBe("skills run byo-fixture");
      expect(data).not.toHaveProperty("pricing");
    });

    test("human-readable shows env vars", async () => {
      const { stdout } = await runCli(["info", "byo-fixture"], FIXTURE_ENV);
      expect(stdout).toContain("Env vars:");
      expect(stdout).not.toContain("SKILLS_API_KEY");
      expect(stdout).not.toContain("Pricing:");
      expect(stdout).toContain("OPENAI_API_KEY");
      expect(stdout.toLowerCase()).not.toContain("gemini");
      expect(stdout.toLowerCase()).not.toContain("minimax");
    });
  });

});
