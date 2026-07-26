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

    test("keeps free local skills local even when hosted auth is configured", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-local-with-hosted-auth-"));
      let remoteCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          remoteCalls += 1;
          return Response.json({ error: "local skills should not call hosted API" }, { status: 500 });
        },
      });
      try {
        const { stdout, stderr, exitCode } = await runCliInCwd(["run", "--json", "lorem-generator", "--help"], tmpDir, {
          HOME: tmpDir,
          NO_COLOR: "1",
          SKILLS_API_KEY: "sk_test_local_stays_local",
          SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        });
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data.exitCode).toBe(0);
        expect(data.stdout).toContain("lorem-generator");
        expect(data.remote).not.toBe(true);
        expect(data.run.remote).toBe(false);
        expect(remoteCalls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });









  });
});
