import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync as mkdtempSyncTop, mkdirSync as mkdirSyncTop, rmSync as rmSyncTop, writeFileSync as writeFileSyncTop } from "fs";
import { join as joinTop } from "path";
import { tmpdir as tmpdirTop } from "os";
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

// The declarative-only catalog ships no bundled executable to run; the run path
// is exercised against an executable skill in a corpus resolved via
// $HASNA_SKILLS_DIR. (Run/export metadata still lands under the project cwd.)
const FIXTURE_HOME = mkdtempSyncTop(joinTop(tmpdirTop(), "cli-run-fixtures-"));
{
  const dir = joinTop(FIXTURE_HOME, "custom", "lorem-generator");
  mkdirSyncTop(joinTop(dir, "src"), { recursive: true });
  writeFileSyncTop(joinTop(dir, "package.json"), JSON.stringify({ name: "lorem-generator", version: "0.1.0", bin: { "lorem-generator": "src/index.ts" } }));
  writeFileSyncTop(joinTop(dir, "src", "index.ts"), 'console.log("lorem-generator " + process.argv.slice(2).join(" "));');
}
const FIXTURE_ENV = { HASNA_SKILLS_DIR: FIXTURE_HOME };
afterAll(() => rmSyncTop(FIXTURE_HOME, { recursive: true, force: true }));

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
        const { stdout, stderr, exitCode } = await runCliInCwd(["run", "--json", "lorem-generator", "--help"], tmpDir, FIXTURE_ENV);
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
          HASNA_SKILLS_DIR: FIXTURE_HOME,
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
