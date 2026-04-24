import { describe, test, expect } from "bun:test";
import { join } from "path";
import pkg from "../../package.json" with { type: "json" };
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";

const CLI_PATH = join(import.meta.dir, "index.tsx");
const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
const SLOW_TEST_TIMEOUT = 15000;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI", () => {
  describe("help", () => {
    test("outputs compact JSON skills list in non-TTY mode (no arguments)", async () => {
      const { stdout } = await runCli([]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("category");
      // Compact mode — no description/tags to keep tokens low
      expect(data[0]).not.toHaveProperty("description");
      expect(data[0]).not.toHaveProperty("tags");
    });

    test("shows help with --help", async () => {
      const { stdout } = await runCli(["--help"]);
      expect(stdout).toContain("Install AI agent skills");
    });

    test("shows version with --version", async () => {
      const { stdout } = await runCli(["--version"]);
      expect(stdout.trim()).toBe(pkg.version);
    });
  });

  describe("categories", () => {
    test("lists categories", async () => {
      const { stdout } = await runCli(["categories"]);
      expect(stdout).toContain("Development Tools");
      expect(stdout).toContain("Business & Marketing");
      expect(stdout).toContain("Health & Wellness");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["categories", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(17);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
    });
  });

  describe("list", () => {
    test("lists default basic skills", async () => {
      const { stdout } = await runCli(["list"]);
      expect(stdout).toContain(`Available default skills (${EXPECTED_BASIC_SKILL_COUNT})`);
      expect(stdout).toContain("image");
      expect(stdout).not.toContain("workout-cycle-planner");
    });

    test("lists all skills with --all", async () => {
      const { stdout } = await runCli(["list", "--all"]);
      expect(stdout).toContain(`Available skills (${EXPECTED_ALL_SKILL_COUNT})`);
      expect(stdout).toContain("Health & Wellness");
    });

    test("lists by category", async () => {
      const { stdout } = await runCli(["list", "--category", "Data & Analysis"]);
      expect(stdout).toContain("Data & Analysis (6)");
      expect(stdout).toContain("read-pdf");
    });

    test("lists full-registry categories with --all", async () => {
      const { stdout } = await runCli(["list", "--category", "Health & Wellness", "--all"]);
      expect(stdout).toContain("Health & Wellness (8)");
      expect(stdout).toContain("workout-cycle-planner");
    });

    test("fails for invalid category", async () => {
      const { stderr, exitCode } = await runCli(["list", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["list", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
    });

    test("outputs full JSON with --all --json", async () => {
      const { stdout } = await runCli(["list", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_ALL_SKILL_COUNT);
    });

    test("lists by category with --json", async () => {
      const { stdout } = await runCli(["list", "--category", "Event Management", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(4);
      for (const skill of data) {
        expect(skill.category).toBe("Event Management");
      }
    });
  });

  describe("search", () => {
    test("finds skills", async () => {
      const { stdout } = await runCli(["search", "pdf"]);
      expect(stdout).toContain("Found");
      expect(stdout).toContain("skill(s)");
    });

    test("shows message for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz"]);
      expect(stdout).toContain("No skills found");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["search", "pdf", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("name");
    });

    test("JSON output is empty array for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--json"]);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });
  });

  describe("info", () => {
    test("shows skill info", async () => {
      const { stdout } = await runCli(["info", "deepresearch"]);
      expect(stdout).toContain("Deep Research (Agentic)");
      expect(stdout).toContain("Research & Writing");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["info", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["info", "deepresearch", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("deepresearch");
      expect(data.displayName).toBe("Deep Research (Agentic)");
      expect(data.category).toBe("Research & Writing");
      expect(Array.isArray(data.tags)).toBe(true);
    });
  });

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
      expect(stdout).toContain("OPENAI_API_KEY");
    });

    test("shows CLI command", async () => {
      const { stdout } = await runCli(["requires", "image"]);
      expect(stdout).toContain("skill-image");
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
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.cliCommand).toBe("skill-image");
      expect(data).toHaveProperty("systemDeps");
      expect(data).toHaveProperty("dependencies");
    });

    test("shows npm dependencies", async () => {
      const { stdout } = await runCli(["requires", "deepresearch"]);
      expect(stdout).toContain("npm dependencies");
      expect(stdout).toContain("commander");
    });
  });

  describe("info (enriched)", () => {
    test("JSON includes envVars and cliCommand", async () => {
      const { stdout } = await runCli(["info", "image", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("image");
      expect(data.envVars).toContain("OPENAI_API_KEY");
      expect(data.cliCommand).toBe("skill-image");
    });

    test("human-readable shows env vars", async () => {
      const { stdout } = await runCli(["info", "image"]);
      expect(stdout).toContain("Env vars:");
      expect(stdout).toContain("OPENAI_API_KEY");
    });
  });

  describe("run", () => {
    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["run", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("install", () => {
    test("requires at least one skill argument", async () => {
      const { stderr, exitCode } = await runCli(["install"]);
      expect(exitCode).not.toBe(0);
    });

    test("fails for nonexistent skill", async () => {
      const { stdout, exitCode } = await runCli(["install", "nonexistent-xyz-123"]);
      expect(stdout).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("JSON output for failed install", async () => {
      const { stdout } = await runCli(["install", "nonexistent-xyz-123", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].success).toBe(false);
      expect(data[0].error).toContain("not found");
    });
  });

  describe("remove", () => {
    test("fails for non-installed skill", async () => {
      const { stdout, exitCode } = await runCli(["remove", "nonexistent-xyz-123"]);
      expect(stdout).toContain("not installed");
      expect(exitCode).not.toBe(0);
    });

    test("JSON output for failed remove", async () => {
      const { stdout } = await runCli(["remove", "nonexistent-xyz-123", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.removed).toBe(false);
    });
  });

  describe("install --for", () => {
    test("shows help with --for flag", async () => {
      const { stdout } = await runCli(["install", "--help"]);
      expect(stdout).toContain("--for");
      expect(stdout).toContain("--scope");
    });

    test("fails for nonexistent skill with --for", async () => {
      const { stdout, exitCode } = await runCli(["install", "nonexistent-xyz-123", "--for", "claude", "--scope", "project"]);
      expect(stdout).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("JSON output for --for install", async () => {
      const { stdout, exitCode } = await runCli(["install", "nonexistent-xyz-123", "--for", "claude", "--scope", "project", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].success).toBe(false);
    });

    test("rejects invalid agent name", async () => {
      const { stderr, exitCode } = await runCli(["install", "image", "--for", "invalid-agent"]);
      expect(stderr).toContain("Unknown agent");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("remove --for", () => {
    test("shows help with --for flag", async () => {
      const { stdout } = await runCli(["remove", "--help"]);
      expect(stdout).toContain("--for");
      expect(stdout).toContain("--scope");
    });

    test("fails for non-installed skill with --for", async () => {
      const { stdout, exitCode } = await runCli(["remove", "nonexistent-xyz-123", "--for", "claude", "--scope", "project"]);
      expect(stdout).toContain("not found");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("list --installed", () => {
    test("lists installed skills or shows none message", async () => {
      const { stdout, exitCode } = await runCli(["list", "--installed"]);
      // Either shows installed skills or "No skills installed"
      const hasInstalled = stdout.includes("Installed skills");
      const hasNone = stdout.includes("No skills installed");
      expect(hasInstalled || hasNone).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("outputs JSON array for installed", async () => {
      const { stdout } = await runCli(["list", "--installed", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("install --category", () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");

    async function runCliInDir(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    }

    test("installs all skills in a category with --json", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-install-cat-"));
      try {
        const { stdout, exitCode } = await runCliInDir(
          ["install", "--category", "Event Management", "--json"],
          tmpDir
        );
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(4);
        for (const r of data) {
          expect(r).toHaveProperty("success");
          expect(r).toHaveProperty("skill");
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("category matching is case-insensitive", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-install-cat-ci-"));
      try {
        const { stdout, exitCode } = await runCliInDir(
          ["install", "--category", "event management", "--json"],
          tmpDir
        );
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(4);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("errors for unknown category", async () => {
      const { stderr, exitCode } = await runCli(["install", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("errors when no skills and no --category provided", async () => {
      const { stderr, exitCode } = await runCli(["install"]);
      expect(stderr).toContain("missing required argument");
      expect(exitCode).not.toBe(0);
    });

    test("shows category header message before installing", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-install-cat-header-"));
      try {
        const { stdout, exitCode } = await runCliInDir(
          ["install", "--category", "Event Management"],
          tmpDir
        );
        expect(exitCode).toBe(0);
        expect(stdout).toContain("4 skills");
        expect(stdout).toContain("Event Management");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("install progress", () => {
    test("shows progress for multiple skills", async () => {
      const { stdout } = await runCli(["install", "nonexistent-aaa-111", "nonexistent-bbb-222"]);
      expect(stdout).toContain("[1/2] Installing nonexistent-aaa-111...");
      expect(stdout).toContain("[2/2] Installing nonexistent-bbb-222...");
    });

    test("shows done/failed status in progress", async () => {
      const { stdout } = await runCli(["install", "nonexistent-aaa-111", "nonexistent-bbb-222"]);
      expect(stdout).toContain("failed");
    });

    test("no progress indicator for single skill", async () => {
      const { stdout } = await runCli(["install", "nonexistent-xyz-123"]);
      expect(stdout).not.toContain("[1/1]");
    });
  });

  describe("search --category", () => {
    test("filters search results by category", async () => {
      const { stdout } = await runCli(["search", "plan", "--category", "Health & Wellness", "--all"]);
      expect(stdout).toContain("Health & Wellness");
    });

    test("filters search results by category with --json", async () => {
      const { stdout } = await runCli(["search", "plan", "--category", "Health & Wellness", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const s of data) {
        expect(s.category).toBe("Health & Wellness");
      }
    });

    test("fails for invalid category in search", async () => {
      const { stderr, exitCode } = await runCli(["search", "test", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("returns empty when category has no matches", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--category", "Health & Wellness"]);
      expect(stdout).toContain("No skills found");
    });
  });

  describe("doctor", () => {
    test("runs doctor and shows output", async () => {
      const { stdout, exitCode } = await runCli(["doctor"]);
      // Either shows doctor report or "No skills installed" depending on cwd
      const hasReport = stdout.includes("Skills Doctor");
      const hasNone = stdout.includes("No skills installed");
      expect(hasReport || hasNone).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("outputs valid JSON", async () => {
      const { stdout } = await runCli(["doctor", "--json"]);
      const data = JSON.parse(stdout);
      // Either an array (skills found) or object with message (none installed)
      const isArray = Array.isArray(data);
      const isEmptyMsg = data.message === "No skills installed";
      expect(isArray || isEmptyMsg).toBe(true);
    });

    test("shows help for doctor command", async () => {
      const { stdout } = await runCli(["doctor", "--help"]);
      expect(stdout).toContain("env vars");
    });

    test("JSON report includes env var status when skills installed", async () => {
      const { stdout } = await runCli(["doctor", "--json"]);
      const data = JSON.parse(stdout);
      if (Array.isArray(data) && data.length > 0) {
        // Each entry should have skill and envVars
        expect(data[0]).toHaveProperty("skill");
        expect(data[0]).toHaveProperty("envVars");
        if (data[0].envVars.length > 0) {
          expect(data[0].envVars[0]).toHaveProperty("name");
          expect(data[0].envVars[0]).toHaveProperty("set");
        }
      }
    });
  });

  describe("mcp", () => {
    test("shows help for mcp command", async () => {
      const { stdout } = await runCli(["mcp", "--help"]);
      expect(stdout).toContain("MCP server");
      expect(stdout).toContain("--register");
    });
  });

  describe("tags", () => {
    test("lists tags with counts", async () => {
      const { stdout, exitCode } = await runCli(["tags"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Tags:");
      // "api" is a common tag in the registry
      expect(stdout).toContain("api");
    });

    test("outputs JSON with --json", async () => {
      const { stdout, exitCode } = await runCli(["tags", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Each entry has name and count
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
      expect(typeof data[0].name).toBe("string");
      expect(typeof data[0].count).toBe("number");
      // Should be sorted alphabetically
      for (let i = 1; i < data.length; i++) {
        expect(data[i].name.localeCompare(data[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    test("all tag counts are positive integers", async () => {
      const { stdout } = await runCli(["tags", "--json"]);
      const data = JSON.parse(stdout);
      for (const entry of data) {
        expect(entry.count).toBeGreaterThan(0);
        expect(Number.isInteger(entry.count)).toBe(true);
      }
    });
  });

  describe("list --tags", () => {
    test("filters skills by a single tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "api", "--all"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("api");
      // Should show the filtered header
      expect(stdout).toContain("Skills matching tags");
    });

    test("returns JSON array filtered by tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Every returned skill must have the "api" tag
      for (const s of data) {
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    });

    test("filters by multiple tags (OR logic)", async () => {
      const { stdout: singleOut } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      const { stdout: multiOut } = await runCli(["list", "--tags", "api,testing", "--all", "--json"]);
      const single = JSON.parse(singleOut);
      const multi = JSON.parse(multiOut);
      // Multi-tag OR should return >= results of single tag
      expect(multi.length).toBeGreaterThanOrEqual(single.length);
    });

    test("tag matching is case-insensitive", async () => {
      const { stdout: lower } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      const { stdout: upper } = await runCli(["list", "--tags", "API", "--all", "--json"]);
      const lowerData = JSON.parse(lower);
      const upperData = JSON.parse(upper);
      expect(lowerData.length).toBe(upperData.length);
    });

    test("returns empty for non-existent tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "zzzznonexistenttag", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });

    test("works with --category and --tags together", async () => {
      const { stdout, exitCode } = await runCli(["list", "--category", "Development Tools", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const s of data) {
        expect(s.category).toBe("Development Tools");
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    }, SLOW_TEST_TIMEOUT);
  });

  describe("search --tags", () => {
    test("filters search results by tag", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--tags", "api"]);
      expect(exitCode).toBe(0);
      // Either finds matching results or says no results found
      const hasResults = stdout.includes("Found") || stdout.includes("No skills found");
      expect(hasResults).toBe(true);
    });

    test("returns JSON filtered by tag", async () => {
      const { stdout, exitCode } = await runCli(["search", "api", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const s of data) {
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    });

    test("tag filter narrows search results", async () => {
      const { stdout: allOut } = await runCli(["search", "api", "--all", "--json"]);
      const { stdout: tagOut } = await runCli(["search", "api", "--tags", "api", "--all", "--json"]);
      const all = JSON.parse(allOut);
      const tagged = JSON.parse(tagOut);
      // Filtered by tag should return <= results of unfiltered
      expect(tagged.length).toBeLessThanOrEqual(all.length);
    }, SLOW_TEST_TIMEOUT);

    test("returns empty for tag with no matches in search results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--tags", "api", "--json"]);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    }, SLOW_TEST_TIMEOUT);
  });

  describe("--brief flag", () => {
    test("list --brief outputs one line per skill with name and description on same line", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      // Each line should contain name \u2014 description [category]
      expect(lines.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief output has fewer lines than default list output", async () => {
      const { stdout: brief } = await runCli(["list", "--brief"]);
      const { stdout: normal } = await runCli(["list"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    }, SLOW_TEST_TIMEOUT);

    test("list --brief with --category shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--category", "Health & Wellness", "--all"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toContain("[Health & Wellness]");
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief with --tags shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--tags", "api", "--all"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    }, SLOW_TEST_TIMEOUT);

    test("search image --brief shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("search --brief output has fewer lines than default search output", async () => {
      const { stdout: brief } = await runCli(["search", "image", "--brief"]);
      const { stdout: normal } = await runCli(["search", "image"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    }, SLOW_TEST_TIMEOUT);

    test("search --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    });

    test("info image --brief shows single line", async () => {
      const { stdout, exitCode } = await runCli(["info", "image", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("image");
      expect(lines[0]).toContain(" \u2014 ");
      expect(lines[0]).toContain("[");
      expect(lines[0]).toContain("(tags:");
    });

    test("info --brief output has fewer lines than default info output", async () => {
      const { stdout: brief } = await runCli(["info", "image", "--brief"]);
      const { stdout: normal } = await runCli(["info", "image"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    });

    test("info --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["info", "image", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("image");
    });
  });

  describe("init --for", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");

    async function runCliInDir(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    }

    test("shows --for and --scope flags in init help", async () => {
      const { stdout } = await runCli(["init", "--help"]);
      expect(stdout).toContain("--for");
      expect(stdout).toContain("--scope");
    });

    test("detects project type and installs for claude with --scope project", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-init-test-"));
      try {
        writeFileSync(
          require("path").join(tmpDir, "package.json"),
          JSON.stringify({ dependencies: { react: "^18.0.0", typescript: "^5.0.0" } })
        );
        const { stdout, exitCode } = await runCliInDir(["init", "--for", "claude", "--scope", "project"], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Detected project technologies");
        expect(stdout).toContain("react");
        expect(stdout).toContain("typescript");
        expect(stdout).toContain("Recommended skills");
        expect(stdout).toContain("image");
        expect(stdout).toContain("implementation-plan");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("outputs JSON with --json flag", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-init-json-test-"));
      try {
        writeFileSync(
          require("path").join(tmpDir, "package.json"),
          JSON.stringify({ dependencies: { express: "^4.0.0" } })
        );
        const { stdout, exitCode } = await runCliInDir(["init", "--for", "claude", "--scope", "project", "--json"], tmpDir);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toHaveProperty("detected");
        expect(data).toHaveProperty("recommended");
        expect(data).toHaveProperty("installed");
        expect(Array.isArray(data.detected)).toBe(true);
        expect(Array.isArray(data.recommended)).toBe(true);
        expect(data.detected).toContain("express");
        expect(data.recommended).toContain("api-test-suite");
        expect(data.recommended).toContain("implementation-plan");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("rejects invalid agent name with --for", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-init-bad-agent-"));
      try {
        writeFileSync(
          require("path").join(tmpDir, "package.json"),
          JSON.stringify({ dependencies: {} })
        );
        const { stderr, exitCode } = await runCliInDir(["init", "--for", "invalid-agent"], tmpDir);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Unknown agent");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("existing init (no --for) still works", async () => {
      // Running init without --for in a dir with no installed skills should show the no-skills message
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-init-noskills-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["init"], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No skills installed");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("export", () => {
    test("outputs valid JSON with version, skills, and timestamp", async () => {
      const { stdout, exitCode } = await runCli(["export"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("version", 1);
      expect(data).toHaveProperty("skills");
      expect(data).toHaveProperty("timestamp");
      expect(Array.isArray(data.skills)).toBe(true);
      // timestamp should be a valid ISO date string
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });

    test("skills list comes from installed skills (array of strings)", async () => {
      const { stdout } = await runCli(["export"]);
      const data = JSON.parse(stdout);
      for (const skill of data.skills) {
        expect(typeof skill).toBe("string");
      }
    });

    test("shows help for export command", async () => {
      const { stdout } = await runCli(["export", "--help"]);
      expect(stdout).toContain("Export installed skills");
    });
  });

  describe("auth", () => {
    const { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync: writeFsSync } = require("fs");
    const { tmpdir } = require("os");

    async function runCliInDir(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    }

    test("shows env var status for a skill", async () => {
      const { stdout, exitCode } = await runCli(["auth", "image"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Auth status for image");
      expect(stdout).toContain("OPENAI_API_KEY");
    });

    test("shows set/missing markers for env vars", async () => {
      const { stdout } = await runCli(["auth", "image"]);
      const hasStatus = stdout.includes("set") || stdout.includes("missing");
      expect(hasStatus).toBe(true);
    });

    test("outputs JSON with --json flag", async () => {
      const { stdout, exitCode } = await runCli(["auth", "image", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.skill).toBe("image");
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars.length).toBeGreaterThan(0);
      expect(data.envVars[0]).toHaveProperty("name");
      expect(data.envVars[0]).toHaveProperty("set");
      expect(typeof data.envVars[0].set).toBe("boolean");
    });

    test("JSON output contains OPENAI_API_KEY for image skill", async () => {
      const { stdout } = await runCli(["auth", "image", "--json"]);
      const data = JSON.parse(stdout);
      const openaiVar = data.envVars.find((v: { name: string }) => v.name === "OPENAI_API_KEY");
      expect(openaiVar).toBeDefined();
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["auth", "nonexistent-xyz"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not found");
    });

    test("--set creates .env file with KEY=VALUE", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-set-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["auth", "--set", "TEST_VAR=hello"], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("TEST_VAR");

        const envPath = require("path").join(tmpDir, ".env");
        expect(existsSync(envPath)).toBe(true);
        const content = readFileSync(envPath, "utf-8");
        expect(content).toContain("TEST_VAR=hello");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("--set updates existing key in .env", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-update-"));
      try {
        const envPath = require("path").join(tmpDir, ".env");
        writeFsSync(envPath, "TEST_VAR=old\nOTHER=keep\n");

        await runCliInDir(["auth", "--set", "TEST_VAR=new"], tmpDir);

        const content = readFileSync(envPath, "utf-8");
        expect(content).toContain("TEST_VAR=new");
        expect(content).not.toContain("TEST_VAR=old");
        expect(content).toContain("OTHER=keep");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("--set rejects invalid format (no equals sign)", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-bad-set-"));
      try {
        const { stderr, exitCode } = await runCliInDir(["auth", "--set", "INVALID_NO_EQUALS"], tmpDir);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Invalid format");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("no args shows all installed skills or empty message", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-all-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["auth"], tmpDir);
        expect(exitCode).toBe(0);
        const hasInstalled = stdout.includes("Auth status");
        const hasNone = stdout.includes("No skills installed");
        expect(hasInstalled || hasNone).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("no args with --json returns array", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-all-json-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["auth", "--json"], tmpDir);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("env var set field reflects actual environment", async () => {
      const { stdout } = await runCli(["auth", "image", "--json"]);
      const data = JSON.parse(stdout);
      for (const v of data.envVars) {
        const expectedSet = !!process.env[v.name];
        expect(v.set).toBe(expectedSet);
      }
    });
  });

  describe("import", () => {
    const { mkdtempSync, writeFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");

    test("shows help for import command", async () => {
      const { stdout } = await runCli(["import", "--help"]);
      expect(stdout).toContain("import");
      expect(stdout).toContain("--dry-run");
      expect(stdout).toContain("--for");
      expect(stdout).toContain("--scope");
    });

    test("fails when file does not exist", async () => {
      const { stderr, exitCode } = await runCli(["import", "/tmp/does-not-exist-xyz.json"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not found");
    });

    test("fails for invalid JSON", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-test-"));
      const filePath = require("path").join(tmpDir, "bad.json");
      try {
        writeFileSync(filePath, "not json at all");
        const { stderr, exitCode } = await runCli(["import", filePath]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Invalid JSON");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("fails for JSON missing skills array", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-test-"));
      const filePath = require("path").join(tmpDir, "bad.json");
      try {
        writeFileSync(filePath, JSON.stringify({ version: 1 }));
        const { stderr, exitCode } = await runCli(["import", filePath]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Invalid format");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("--dry-run shows what would be installed without installing", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-dryrun-"));
      const filePath = require("path").join(tmpDir, "skills.json");
      try {
        const payload = { version: 1, skills: ["image", "deepresearch"], timestamp: new Date().toISOString() };
        writeFileSync(filePath, JSON.stringify(payload));
        const { stdout, exitCode } = await runCli(["import", filePath, "--dry-run"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("[dry-run]");
        expect(stdout).toContain("image");
        expect(stdout).toContain("deepresearch");
        // Should show [1/2] and [2/2]
        expect(stdout).toContain("[1/2]");
        expect(stdout).toContain("[2/2]");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("--dry-run with --json outputs structured result", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-dryrun-json-"));
      const filePath = require("path").join(tmpDir, "skills.json");
      try {
        const payload = { version: 1, skills: ["image"], timestamp: new Date().toISOString() };
        writeFileSync(filePath, JSON.stringify(payload));
        const { stdout, exitCode } = await runCli(["import", filePath, "--dry-run", "--json"]);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.dryRun).toBe(true);
        expect(data.skills).toContain("image");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("import with empty skills array reports 0 imported", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-empty-"));
      const filePath = require("path").join(tmpDir, "skills.json");
      try {
        const payload = { version: 1, skills: [], timestamp: new Date().toISOString() };
        writeFileSync(filePath, JSON.stringify(payload));
        const { stdout, exitCode } = await runCli(["import", filePath]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No skills to import");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("import nonexistent skill with --json shows failure in results", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-import-fail-"));
      const filePath = require("path").join(tmpDir, "skills.json");
      try {
        const payload = { version: 1, skills: ["nonexistent-xyz-999"], timestamp: new Date().toISOString() };
        writeFileSync(filePath, JSON.stringify(payload));
        const { stdout, exitCode } = await runCli(["import", filePath, "--json"]);
        expect(exitCode).not.toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toHaveProperty("imported", 0);
        expect(data).toHaveProperty("total", 1);
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.results[0].success).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("export then import --dry-run round-trips cleanly", async () => {
      const { stdout: exportOut } = await runCli(["export"]);
      const exported = JSON.parse(exportOut);

      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-roundtrip-"));
      const filePath = require("path").join(tmpDir, "exported.json");
      try {
        writeFileSync(filePath, exportOut);
        const { stdout, exitCode } = await runCli(["import", filePath, "--dry-run", "--json"]);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.dryRun).toBe(true);
        // skills in dry-run should match exported skills
        expect(data.skills).toEqual(exported.skills);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("whoami", () => {
    test("outputs version and working directory", async () => {
      const { stdout, exitCode } = await runCli(["whoami"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(pkg.version);
      expect(stdout).toContain(process.cwd());
    });

    test("outputs agent configurations section", async () => {
      const { stdout, exitCode } = await runCli(["whoami"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Agent configurations");
      expect(stdout).toContain("claude");
      expect(stdout).toContain("codex");
      expect(stdout).toContain("gemini");
    });

    test("--json returns valid JSON with expected fields", async () => {
      const { stdout, exitCode } = await runCli(["whoami", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("version", pkg.version);
      expect(data).toHaveProperty("cwd");
      expect(data).toHaveProperty("skillsDir");
      expect(data).toHaveProperty("installedCount");
      expect(data).toHaveProperty("installed");
      expect(data).toHaveProperty("agents");
      expect(Array.isArray(data.installed)).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBe(5);
      for (const agent of data.agents) {
        expect(agent).toHaveProperty("agent");
        expect(agent).toHaveProperty("path");
        expect(agent).toHaveProperty("exists");
        expect(agent).toHaveProperty("skillCount");
      }
    });

    test("--json cwd is a non-empty string", async () => {
      const { stdout } = await runCli(["whoami", "--json"]);
      const data = JSON.parse(stdout);
      expect(typeof data.cwd).toBe("string");
      expect(data.cwd.length).toBeGreaterThan(0);
    });

    test("shows help for whoami command", async () => {
      const { stdout } = await runCli(["whoami", "--help"]);
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

    test("--json with no installed skills returns empty array", async () => {
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

  describe("completion", () => {
    test("bash completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "bash"]);
      expect(stdout).toContain("interactive");
      expect(stdout).toContain("export");
      expect(stdout).toContain("import");
      expect(stdout).toContain("whoami");
      expect(stdout).toContain("test");
      expect(stdout).toContain("config");
      expect(stdout).toContain("create");
      expect(stdout).toContain("sync");
      expect(stdout).toContain("validate");
      expect(stdout).toContain("diff");
      expect(stdout).toContain("schedule");
    });

    test("zsh completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "zsh"]);
      expect(stdout).toContain("'interactive:interactive command'");
      expect(stdout).toContain("'export:export command'");
      expect(stdout).toContain("'import:import command'");
      expect(stdout).toContain("'whoami:whoami command'");
      expect(stdout).toContain("'test:test command'");
      expect(stdout).toContain("'config:config command'");
      expect(stdout).toContain("'create:create command'");
      expect(stdout).toContain("'sync:sync command'");
      expect(stdout).toContain("'validate:validate command'");
      expect(stdout).toContain("'diff:diff command'");
      expect(stdout).toContain("'schedule:schedule command'");
    });
  });
});
