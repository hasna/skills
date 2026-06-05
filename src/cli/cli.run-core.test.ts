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

describe("CLI run core", () => {
  describe("run", () => {
    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["run", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("returns JSON error for nonexistent skill with --json", async () => {
      const { stdout, stderr, exitCode } = await runCli(["run", "--json", "nonexistent-xyz"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).not.toBe(0);
      expect(data.exitCode).toBe(1);
      expect(data.error).toContain("not found");
    });

    test("captures bundled free skill output and writes run metadata with run --json", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-run-json-"));
      try {
        const { stdout, stderr, exitCode } = await runCliInCwd(["run", "--json", "lorem-generator", "--help"], tmpDir);
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data.exitCode).toBe(0);
        expect(data.stdout).toContain("lorem-generator");
        expect(data.remote).not.toBe(true);
        expect(data.run).toHaveProperty("id");
        expect(data.run.paths.runDir).toContain(".skills/runs/");
        expect(data.run.paths.exportDir).toContain(".skills/exports/lorem-generator/");

        const runJson = require("path").join(tmpDir, data.run.paths.runDir, "run.json");
        expect(existsSync(runJson)).toBe(true);
        const storedRun = JSON.parse(readFileSync(runJson, "utf-8"));
        expect(storedRun.id).toBe(data.run.id);
        expect(storedRun.status).toBe("completed");
        expect(storedRun.remote).toBe(false);
        expect(existsSync(require("path").join(tmpDir, ".skills", "skills"))).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills never use test mode as a local execution bypass", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-no-test-bypass-"));
      try {
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "image", "--help"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_API_KEY: "",
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).not.toBe(0);
        expect(data.error).toContain("hosted skill");
        expect(data.error).toContain("skills auth login");
        expect(data.stdout).toBeUndefined();
        expect(data.run.remote).toBe(true);
        expect(data.run.status).toBe("failed");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills require remote auth outside test mode", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-auth-"));
      try {
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "image", "prompt"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "",
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).not.toBe(0);
        expect(data.error).toContain("hosted skill");
        expect(data.error).toContain("skills auth login");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills submit async remote runs and expose status next actions", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-async-"));
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_async");
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            return Response.json(
              {
                id: "run_async",
                skill: "logo-design",
                status: "queued",
                correlationId: "corr_async",
              },
              { status: 202 },
            );
          }
          if (url.pathname === "/api/v1/runs/run_async" && req.method === "GET") {
            return Response.json({
              id: "run_async",
              skill: "logo-design",
              status: "completed",
              createdAt: "2026-05-10T00:00:00.000Z",
              completedAt: "2026-05-10T00:00:05.000Z",
            });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });
      const env = {
        ...process.env,
        HOME: tmpDir,
        NO_COLOR: "1",
        SKILLS_TEST_MODE: "",
        SKILLS_API_KEY: "sk_test_async",
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      };
      try {
        const runProc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "logo-design", "make a mark"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env,
        });
        const [runStdout, runStderr, runExitCode] = await Promise.all([
          new Response(runProc.stdout).text(),
          new Response(runProc.stderr).text(),
          runProc.exited,
        ]);
        const runData = JSON.parse(runStdout);
        expect(runStderr).toBe("");
        expect(runExitCode).toBe(0);
        expect(runData.contractVersion).toBe(1);
        expect(runData.remote).toBe(true);
        expect(runData.remoteRun).toMatchObject({ contractVersion: 1, id: "run_async", status: "queued" });
        expect(runData.run.remoteRunId).toBe("run_async");
        expect(runData.nextActions).toEqual({
          poll: "skills runs status run_async",
          download: "skills exports download run_async",
        });

        const statusProc = Bun.spawn(["bun", "run", CLI_PATH, "--", "runs", "status", runData.run.id, "--json"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env,
        });
        const [statusStdout, statusStderr, statusExitCode] = await Promise.all([
          new Response(statusProc.stdout).text(),
          new Response(statusProc.stderr).text(),
          statusProc.exited,
        ]);
        const statusData = JSON.parse(statusStdout);
        expect(statusStderr).toBe("");
        expect(statusExitCode).toBe(0);
        expect(statusData).toMatchObject({
          contractVersion: 1,
          runId: "run_async",
          localRunId: runData.run.id,
          run: { contractVersion: 1, id: "run_async", skill: "logo-design", status: "completed" },
          nextActions: {
            poll: "skills runs status run_async",
            download: "skills exports download run_async",
          },
        });
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills fail closed when the skills.md API is unavailable", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-skillsmd-down-"));
      try {
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "image", "--help"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_API_KEY: "sk_test_skillsmd_down",
            SKILLS_API_URL: "http://127.0.0.1:1",
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).not.toBe(0);
        expect(data.error).toContain("requires skills.md access");
        expect(data.stdout).toBeUndefined();
        expect(data.run.remote).toBe(true);
        expect(data.run.status).toBe("failed");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("run --wait polls remote runs to terminal status and writes remote logs locally", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const path = require("path");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(path.join(tmpdir(), "cli-premium-wait-"));
      let statusCalls = 0;
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_wait");
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            return Response.json(
              {
                id: "run_wait",
                skill: "logo-design",
                status: "queued",
                correlationId: "corr_wait",
              },
              { status: 202 },
            );
          }
          if (url.pathname === "/api/v1/runs/run_wait" && req.method === "GET") {
            statusCalls += 1;
            return Response.json(statusCalls < 2
              ? { id: "run_wait", skill: "logo-design", status: "running" }
              : {
                  id: "run_wait",
                  skill: "logo-design",
                  status: "completed",
                  exitCode: 0,
                  outputPreview: "logo package ready",
                  completedAt: "2026-05-10T00:00:05.000Z",
                });
          }
          if (url.pathname === "/api/v1/runs/run_wait/logs" && req.method === "GET") {
            return Response.json([
              { sequence: 1, level: "info", message: "queued render" },
              { sequence: 2, level: "info", message: "logo package ready" },
            ]);
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });
      const env = {
        ...process.env,
        HOME: tmpDir,
        NO_COLOR: "1",
        SKILLS_TEST_MODE: "",
        SKILLS_API_KEY: "sk_test_wait",
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      };
      try {
        const proc = Bun.spawn([
          "bun",
          "run",
          CLI_PATH,
          "--",
          "run",
          "--json",
          "--wait",
          "--poll-interval-ms",
          "1",
          "logo-design",
          "make a mark",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env,
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const data = JSON.parse(stdout);
        const runJsonPath = path.join(tmpDir, data.run.paths.runDir, "run.json");
        const stdoutLogPath = path.join(tmpDir, data.run.paths.logsDir, "stdout.log");

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(statusCalls).toBe(2);
        expect(data.exitCode).toBe(0);
        expect(data.remoteRun).toMatchObject({ id: "run_wait", status: "completed" });
        expect(data.run).toMatchObject({ status: "completed", remoteRunId: "run_wait" });
        expect(data.polling).toMatchObject({ waited: true, attempts: 2 });
        expect(existsSync(runJsonPath)).toBe(true);
        expect(JSON.parse(readFileSync(runJsonPath, "utf-8")).status).toBe("completed");
        expect(readFileSync(stdoutLogPath, "utf-8")).toContain("logo package ready");
        expect(existsSync(path.join(tmpDir, ".skills", "skills"))).toBe(false);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("terminal remote failures preserve remote exit code and complete local metadata", async () => {
      const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
      const path = require("path");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(path.join(tmpdir(), "cli-premium-terminal-failed-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_failed");
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            return Response.json(
              {
                id: "run_failed",
                skill: "logo-design",
                status: "failed",
                exitCode: 7,
                errorMessage: "remote renderer failed",
              },
              { status: 200 },
            );
          }
          if (url.pathname === "/api/v1/runs/run_failed/logs" && req.method === "GET") {
            return Response.json([
              { sequence: 1, level: "error", message: "remote renderer failed" },
            ]);
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });
      try {
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "logo-design", "bad prompt"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_failed",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const data = JSON.parse(stdout);
        const runJsonPath = path.join(tmpDir, data.run.paths.runDir, "run.json");
        const stderrLogPath = path.join(tmpDir, data.run.paths.logsDir, "stderr.log");

        expect(stderr).toBe("");
        expect(exitCode).toBe(7);
        expect(data.exitCode).toBe(7);
        expect(data.error).toBe("remote renderer failed");
        expect(data.remoteRun).toMatchObject({ id: "run_failed", status: "failed" });
        expect(data.run).toMatchObject({ status: "failed", remoteRunId: "run_failed", error: "remote renderer failed" });
        expect(existsSync(runJsonPath)).toBe(true);
        expect(JSON.parse(readFileSync(runJsonPath, "utf-8")).status).toBe("failed");
        expect(readFileSync(stderrLogPath, "utf-8")).toContain("remote renderer failed");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  });
});
