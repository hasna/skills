import { describe, test, expect } from "bun:test";
import { join } from "path";
import pkg from "../../package.json" with { type: "json" };

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
    test("shows non-interactive fallback with no arguments (non-TTY)", async () => {
      const { stdout } = await runCli([]);
      expect(stdout).toContain("Non-interactive environment detected");
      expect(stdout).toContain("skills list");
      expect(stdout).toContain("skills search");
      expect(stdout).toContain("skills install");
      expect(stdout).toContain("skills serve");
      expect(stdout).toContain("skills --help");
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
    test("lists all skills", async () => {
      const { stdout } = await runCli(["list"]);
      expect(stdout).toContain("Available skills (202)");
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
      expect(data.length).toBe(202);
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
      const { stdout } = await runCli(["search", "plan", "--category", "Health & Wellness"]);
      expect(stdout).toContain("Health & Wellness");
    });

    test("filters search results by category with --json", async () => {
      const { stdout } = await runCli(["search", "plan", "--category", "Health & Wellness", "--json"]);
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
      expect(stdout).toContain("Check environment variables");
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
});
