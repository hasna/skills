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

describe("CLI import export and env checks", () => {
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

    test("detects project type and recommends MCP registration for claude", async () => {
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
        expect(stdout).toContain("skills mcp --register claude");
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
        expect(data).toHaveProperty("agents");
        expect(data).toHaveProperty("mcpRegister");
        expect(Array.isArray(data.detected)).toBe(true);
        expect(Array.isArray(data.recommended)).toBe(true);
        expect(data.detected).toContain("express");
        expect(data.recommended).toContain("api-test-suite");
        expect(data.recommended).toContain("implementation-plan");
        expect(data.agents).toEqual(["claude"]);
        expect(data.mcpRegister).toBe("skills mcp --register claude");
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
      // Running init without --for in a dir with no pins should show the empty pin message.
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-init-noskills-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["init"], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No pinned skills");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("sync", () => {
    test("legacy agent skill-folder sync is disabled", async () => {
      const { stdout, stderr, exitCode } = await runCli(["sync", "--from", "claude", "--register", "--json"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).toBe(1);
      expect(data.error).toContain("Agent skill-folder sync is disabled");
      expect(data.mcpRegister).toBe("skills mcp --register claude");
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

    test("skills list comes from pinned skills (array of strings)", async () => {
      const { stdout } = await runCli(["export"]);
      const data = JSON.parse(stdout);
      for (const skill of data.skills) {
        expect(typeof skill).toBe("string");
      }
    });

    test("shows help for export command", async () => {
      const { stdout } = await runCli(["export", "--help"]);
      expect(stdout).toContain("Export pinned skills");
    });
  });

  describe("exports download", () => {
    test("materializes remote run artifacts under .skills/exports without skill source", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-exports-download-"));
      const artifactId = "artifact-1";
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/runs/run_remote") {
            return Response.json({ id: "run_remote", skill: "image", status: "completed" });
          }
          if (url.pathname === "/api/v1/runs/run_remote/artifacts") {
            return Response.json([
              {
                id: artifactId,
                fileName: "report.md",
                relativePath: "nested/report.md",
                contentType: "text/markdown",
                byteSize: 15,
              },
            ]);
          }
          if (url.pathname === `/api/v1/runs/run_remote/artifacts/${artifactId}/download`) {
            return new Response("# Remote export\n", {
              headers: { "content-type": "text/markdown" },
            });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });

      try {
        const { stdout, stderr, exitCode } = await runCliInCwd(
          ["exports", "download", "run_remote", "--json"],
          tmpDir,
          {
            SKILLS_API_KEY: "sk_test_exports",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
          },
        );
        const data = JSON.parse(stdout);
        const outputPath = require("path").join(tmpDir, ".skills", "exports", "image", "run_remote", "nested", "report.md");

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({ runId: "run_remote", skill: "image" });
        expect(data.downloaded).toHaveLength(1);
        expect(existsSync(outputPath)).toBe(true);
        expect(readFileSync(outputPath, "utf8")).toBe("# Remote export\n");
        expect(existsSync(require("path").join(tmpDir, ".skills", "skills"))).toBe(false);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("uses requested slug for create-blog-article export downloads", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const path = require("path");
      const tmpDir = mkdtempSync(path.join(tmpdir(), "cli-blog-exports-download-"));
      const artifactId = "artifact-blog-manifest";
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/runs/run_blog_remote") {
            return Response.json({
              id: "run_blog_remote",
              requestedSlug: "create-blog-article",
              skill: "blog-article",
              status: "completed",
            });
          }
          if (url.pathname === "/api/v1/runs/run_blog_remote/artifacts") {
            return Response.json([
              {
                id: artifactId,
                fileName: "manifest.json",
                relativePath: "manifest.json",
                contentType: "application/json",
                byteSize: 37,
              },
            ]);
          }
          if (url.pathname === `/api/v1/runs/run_blog_remote/artifacts/${artifactId}/download`) {
            return new Response("{\"skill\":\"blog-article\"}\n", {
              headers: { "content-type": "application/json" },
            });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });

      try {
        const { stdout, stderr, exitCode } = await runCliInCwd(
          ["exports", "download", "run_blog_remote", "--json"],
          tmpDir,
          {
            SKILLS_API_KEY: "sk_test_exports",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
          },
        );
        const data = JSON.parse(stdout);
        const outputPath = path.join(tmpDir, ".skills", "exports", "create-blog-article", "run_blog_remote", "manifest.json");

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({
          runId: "run_blog_remote",
          skill: "create-blog-article",
          canonicalSkill: "blog-article",
        });
        expect(existsSync(outputPath)).toBe(true);
        expect(readFileSync(outputPath, "utf8")).toBe("{\"skill\":\"blog-article\"}\n");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("env-check", () => {
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
      const { stdout, exitCode } = await runCli(["env-check", "image"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Auth status for image");
      expect(stdout).toContain("SKILL_API_KEY");
    });

    test("shows set/missing markers for env vars", async () => {
      const { stdout } = await runCli(["env-check", "image"]);
      const hasStatus = stdout.includes("set") || stdout.includes("missing");
      expect(hasStatus).toBe(true);
    });

    test("outputs JSON with --json flag", async () => {
      const { stdout, exitCode } = await runCli(["env-check", "image", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.skill).toBe("image");
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars.length).toBeGreaterThan(0);
      expect(data.envVars[0]).toHaveProperty("name");
      expect(data.envVars[0]).toHaveProperty("set");
      expect(typeof data.envVars[0].set).toBe("boolean");
    });

    test("JSON output contains SKILL_API_KEY for image skill", async () => {
      const { stdout } = await runCli(["env-check", "image", "--json"]);
      const data = JSON.parse(stdout);
      const skillApiKey = data.envVars.find((v: { name: string }) => v.name === "SKILL_API_KEY");
      expect(skillApiKey).toBeDefined();
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["env-check", "nonexistent-xyz"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not found");
    });

    test("--set creates .env file with KEY=VALUE", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-set-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["env-check", "--set", "TEST_VAR=hello"], tmpDir);
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

        await runCliInDir(["env-check", "--set", "TEST_VAR=new"], tmpDir);

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
        const { stderr, exitCode } = await runCliInDir(["env-check", "--set", "INVALID_NO_EQUALS"], tmpDir);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Invalid format");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("no args shows all pinned skills or empty message", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-all-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["env-check"], tmpDir);
        expect(exitCode).toBe(0);
        const hasInstalled = stdout.includes("Auth status");
        const hasNone = stdout.includes("No pinned skills");
        expect(hasInstalled || hasNone).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("no args with --json returns array", async () => {
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-auth-all-json-"));
      try {
        const { stdout, exitCode } = await runCliInDir(["env-check", "--json"], tmpDir);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("env var set field reflects actual environment", async () => {
      const { stdout } = await runCli(["env-check", "image", "--json"]);
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

});
