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

describe("CLI pin and search controls", () => {
  describe("pin", () => {
    test("pins a legacy alias to the canonical skill name", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-alias-install-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(["pin", "transcribe", "--json"], tmpDir, { HOME: tmpDir });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data[0].skill).toBe("transcript");
        const projectConfig = JSON.parse(readFileSync(require("path").join(tmpDir, ".skills", "project.json"), "utf-8"));
        expect(projectConfig.pinnedSkills).toContain("transcript");
        expect(projectConfig.pinnedSkills).not.toContain("transcribe");
        expect(existsSync(require("path").join(tmpDir, ".skills", "skills"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("requires at least one skill argument", async () => {
      const { stderr, exitCode } = await runCli(["pin"]);
      expect(exitCode).not.toBe(0);
    });

    test("fails for nonexistent skill", async () => {
      const { stdout, exitCode } = await runCli(["pin", "nonexistent-xyz-123"]);
      expect(stdout).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("JSON output for failed install", async () => {
      const { stdout } = await runCli(["pin", "nonexistent-xyz-123", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].success).toBe(false);
      expect(data[0].error).toContain("not found");
    });

    test("dry-run install emits JSON actions", async () => {
      const { stdout, stderr, exitCode } = await runCli(["pin", "image", "--dry-run", "--json"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(data.dryRun).toBe(true);
      expect(data.actions).toEqual([{ skill: "image", target: ".skills/project.json", action: "pin" }]);
    });

    test("pins remote registry skills without copying source", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-remote-pin-"));
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          expect(new URL(req.url).pathname).toBe("/api/v1/skills");
          expect(req.headers.get("authorization")).toBe("Bearer fixture-pin");
          return Response.json({
            skills: [
              {
                name: "remote-demo",
                displayName: "Remote Demo",
                description: "Demo from remote registry",
                category: "Remote Tools",
                tags: ["remote"],
                version: "0.2.0",
              },
            ],
          });
        },
      });

      try {
        const { stdout, exitCode } = await runCliInCwd(["pin", "remote-demo", "--remote", "--json"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_URL: `http://localhost:${server.port}/api/v1`,
          SKILLS_API_KEY: "fixture-pin",
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data[0]).toMatchObject({
          skill: "remote-demo",
          success: true,
          mode: "pin",
          source: "remote",
        });

        const projectConfig = JSON.parse(readFileSync(join(tmpDir, ".skills", "project.json"), "utf-8"));
        expect(projectConfig.pinnedSkills).toEqual(["remote-demo"]);
        expect(projectConfig.pins["remote-demo"]).toMatchObject({
          version: "0.2.0",
          source: "remote",
        });
        expect(existsSync(join(tmpDir, ".skills", "skills"))).toBe(false);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("unpin", () => {
    test("fails for non-pinned skill", async () => {
      const { stdout, exitCode } = await runCli(["unpin", "nonexistent-xyz-123"]);
      expect(stdout).toContain("not pinned");
      expect(exitCode).not.toBe(0);
    });

    test("JSON output for failed remove", async () => {
      const { stdout } = await runCli(["unpin", "nonexistent-xyz-123", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.removed).toBe(false);
    });

    test("dry-run remove emits JSON actions", async () => {
      const { stdout, stderr, exitCode } = await runCli(["unpin", "image", "--dry-run", "--json"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(data.dryRun).toBe(true);
      expect(data.actions).toEqual([{ skill: "image", target: ".skills/project.json", action: "unpin" }]);
    });
  });

  describe("deprecated install/remove", () => {
    test("install points skill pinning to the pin command", async () => {
      const { stderr, exitCode } = await runCli(["install", "image"]);
      expect(stderr).toContain("skills pin <name>");
      expect(exitCode).not.toBe(0);
    });

    test("install without args points to MCP setup", async () => {
      const { stderr, exitCode } = await runCli(["install"]);
      expect(stderr).toContain("skills setup agents");
      expect(exitCode).not.toBe(0);
    });

    test("remove points to the unpin command", async () => {
      const { stderr, exitCode } = await runCli(["remove", "image"]);
      expect(stderr).toContain("skills unpin <name>");
      expect(exitCode).not.toBe(0);
    });

    test("shows install integration help", async () => {
      const { stdout } = await runCli(["install", "--help"]);
      expect(stdout).toContain("skills setup agents");
    });
  });

  describe("list --pinned", () => {
    test("lists pinned skills or shows none message", async () => {
      const { stdout, exitCode } = await runCli(["list", "--pinned"]);
      // Either shows pinned skills or the empty pin message.
      const hasInstalled = stdout.includes("Pinned skills");
      const hasNone = stdout.includes("No pinned skills");
      expect(hasInstalled || hasNone).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("outputs JSON array for pinned", async () => {
      const { stdout } = await runCli(["list", "--pinned", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("pin --category", () => {
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
          ["pin", "--category", "Event Management", "--json"],
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
          ["pin", "--category", "event management", "--json"],
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
      const { stderr, exitCode } = await runCli(["pin", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("errors when no skills and no --category provided", async () => {
      const { stderr, exitCode } = await runCli(["pin"]);
      expect(stderr).toContain("missing required argument");
      expect(exitCode).not.toBe(0);
    });

    test("shows category header message before installing", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-install-cat-header-"));
      try {
        const { stdout, exitCode } = await runCliInDir(
          ["pin", "--category", "Event Management"],
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

  describe("pin progress", () => {
    test("shows progress for multiple skills", async () => {
      const { stdout } = await runCli(["pin", "nonexistent-aaa-111", "nonexistent-bbb-222"]);
      expect(stdout).toContain("[1/2] Pinning nonexistent-aaa-111...");
      expect(stdout).toContain("[2/2] Pinning nonexistent-bbb-222...");
    });

    test("shows done/failed status in progress", async () => {
      const { stdout } = await runCli(["pin", "nonexistent-aaa-111", "nonexistent-bbb-222"]);
      expect(stdout).toContain("failed");
    });

    test("no progress indicator for single skill", async () => {
      const { stdout } = await runCli(["pin", "nonexistent-xyz-123"]);
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
      // Either shows doctor report or the empty pin message depending on cwd.
      const hasReport = stdout.includes("Skills Doctor");
      const hasNone = stdout.includes("No pinned skills");
      expect(hasReport || hasNone).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("outputs valid JSON", async () => {
      const { stdout } = await runCli(["doctor", "--json"]);
      const data = JSON.parse(stdout);
      // Either an array (skills found) or object with message (none pinned).
      const isArray = Array.isArray(data);
      const isEmptyMsg = data.message === "No pinned skills";
      expect(isArray || isEmptyMsg).toBe(true);
    });

    test("shows help for doctor command", async () => {
      const { stdout } = await runCli(["doctor", "--help"]);
      expect(stdout).toContain("env vars");
    });

    test("JSON report includes env var status when skills are pinned", async () => {
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

});
