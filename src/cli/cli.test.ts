import { describe, test, expect } from "bun:test";
import { join } from "path";

const CLI_PATH = join(import.meta.dir, "index.tsx");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI", () => {
  describe("help", () => {
    test("shows help with no arguments", async () => {
      const { stdout } = await runCli([]);
      expect(stdout).toContain("Install AI agent skills");
      expect(stdout).toContain("install|add");
      expect(stdout).toContain("list|ls");
      expect(stdout).toContain("search");
      expect(stdout).toContain("info");
      expect(stdout).toContain("remove|rm");
      expect(stdout).toContain("categories");
    });

    test("shows help with --help", async () => {
      const { stdout } = await runCli(["--help"]);
      expect(stdout).toContain("Install AI agent skills");
    });

    test("shows version with --version", async () => {
      const { stdout } = await runCli(["--version"]);
      expect(stdout.trim()).toBe("0.0.3");
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
    test("lists all skills", async () => {
      const { stdout } = await runCli(["list"]);
      expect(stdout).toContain("Available skills (200)");
      expect(stdout).toContain("Development Tools");
    });

    test("lists by category", async () => {
      const { stdout } = await runCli(["list", "--category", "Health & Wellness"]);
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
      expect(data.length).toBe(200);
    });

    test("lists by category with --json", async () => {
      const { stdout } = await runCli(["list", "--category", "Event Management", "--json"]);
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
      const { stdout } = await runCli(["search", "email"]);
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

  describe("mcp", () => {
    test("shows help for mcp command", async () => {
      const { stdout } = await runCli(["mcp", "--help"]);
      expect(stdout).toContain("MCP server");
      expect(stdout).toContain("--register");
    });
  });
});
