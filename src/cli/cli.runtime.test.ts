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

const AUTHORITATIVE_TEST_QUOTE = {
  estimated: false,
  quoteDependsOnInput: false,
  quoteRequired: false,
  description: "Authoritative test credit quote.",
};
import { getFirstRunOnboardingMessage, shouldShowFirstRunOnboarding } from "./onboarding";

describe("CLI runtime and misc commands", () => {
  describe("first-run onboarding guard", () => {
    test("nudges interactive normal commands until a self-hosted or local mode is configured", () => {
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["list"],
          commandName: "list",
          config: {},
          isInteractive: true,
        }),
      ).toBe(true);
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["list"],
          commandName: "list",
          config: { mode: "local" },
          isInteractive: true,
        }),
      ).toBe(false);
      expect(
        shouldShowFirstRunOnboarding({
          argv: ["run", "image"],
          commandName: "run",
          config: { mode: "self-hosted" },
          isInteractive: true,
        }),
      ).toBe(false);
    });

    test("stays quiet for JSON, help, onboarding, and automation", () => {
      for (const input of [
        { argv: ["list", "--json"], commandName: "list", isInteractive: true },
        { argv: ["list", "--help"], commandName: "list", isInteractive: true },
        { argv: ["setup"], commandName: "setup", isInteractive: true },
        { argv: ["auth", "login"], commandName: "auth", isInteractive: true },
        { argv: ["list"], commandName: "list", isInteractive: false },
        { argv: ["list"], commandName: "list", isInteractive: true, testMode: true },
      ]) {
        expect(shouldShowFirstRunOnboarding({ ...input, config: {} })).toBe(false);
      }
    });

    test("offers cloud, self-hosted, and local as explicit first-run modes", () => {
      const message = getFirstRunOnboardingMessage();
      expect(message).toContain("skills setup --mode cloud");
      expect(message).toContain("skills setup --mode self-hosted");
      expect(message).toContain("skills auth login");
      expect(message).toContain("skills setup --mode local");
      expect(message).not.toContain("--mode skills.md");
    });
  });

  describe("setup mode", () => {
    test("stores local mode in project config", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-local-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(["setup", "--mode", "local", "--json"], tmpDir, { HOME: tmpDir });
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ mode: "local", scope: "project" });
        const config = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"));
        expect(config.mode).toBe("local");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("stores canonical cloud mode and its fixed API origin", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-hosted-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--mode", "cloud", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({ mode: "cloud", scope: "project" });
        expect(data.next).toContain("skills auth login");
        const config = JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"));
        expect(config.mode).toBe("cloud");
        expect(config.apiUrl).toBe("https://skills.md");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("rejects a cloud origin override and self-hosted mode without an origin", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-origin-guard-"));
      try {
        const cloud = await runCliInCwd(
          ["setup", "--mode", "cloud", "--api-url", "https://operator.example", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(cloud.exitCode).toBe(1);
        expect(`${cloud.stdout}\n${cloud.stderr}`).toContain("fixed service origin");
        const selfHosted = await runCliInCwd(["setup", "--mode", "self-hosted", "--json"], tmpDir, { HOME: tmpDir });
        expect(selfHosted.exitCode).toBe(1);
        expect(`${selfHosted.stdout}\n${selfHosted.stderr}`).toContain("requires --api-url");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("stores canonical self-hosted mode from --mode self-hosted", async () => {
      const { mkdtempSync, rmSync, readFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-hosted-canonical-"));
      try {
        const { stdout, exitCode } = await runCliInCwd(
          ["setup", "--mode", "self-hosted", "--api-url", "https://skills.example.com", "--json"],
          tmpDir,
          { HOME: tmpDir },
        );
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ mode: "self-hosted", scope: "project" });
        expect(JSON.parse(readFileSync(join(tmpDir, "skills.config.json"), "utf8"))).toMatchObject({
          mode: "self-hosted",
          apiUrl: "https://skills.example.com",
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("accepts cloud and rejects ambiguous setup aliases", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-reject-modes-"));
      try {
        const remote = await runCliInCwd(["setup", "--mode", "remote", "--json"], tmpDir, { HOME: tmpDir });
        expect(remote.exitCode).toBe(1);
        expect(`${remote.stdout}\n${remote.stderr}`).toContain("Invalid setup mode");
        const cloud = await runCliInCwd(["setup", "--mode", "cloud", "--json"], tmpDir, { HOME: tmpDir });
        expect(cloud.exitCode).toBe(0);
        expect(JSON.parse(cloud.stdout)).toMatchObject({ mode: "cloud" });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("hosted account command namespaces", () => {
    test("exposes billing and credits commands outside auth", async () => {
      const billing = await runCli(["billing", "--help"]);
      expect(billing.exitCode).toBe(0);
      expect(billing.stdout).toContain("status");
      expect(billing.stdout).toContain("checkout");
      expect(billing.stdout).toContain("portal");
      expect(billing.stdout).toContain("buy-credits");

      const credits = await runCli(["credits", "--help"]);
      expect(credits.exitCode).toBe(0);
      expect(credits.stdout).toContain("buy");
      expect(credits.stdout).toContain("packs");
    });
  });

  describe("setup-info", () => {
    test("outputs version and working directory", async () => {
      const { stdout, exitCode } = await runCli(["setup-info"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(PACKAGE_VERSION);
      expect(stdout).toContain(process.cwd());
    });

    test("outputs agent configurations section", async () => {
      const { stdout, exitCode } = await runCli(["setup-info"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Agent configurations");
      expect(stdout).toContain("claude");
      expect(stdout).toContain("codex");
      expect(stdout).toContain("gemini");
    });

    test("--json returns valid JSON with expected fields", async () => {
      const { stdout, exitCode } = await runCli(["setup-info", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("version", PACKAGE_VERSION);
      expect(data).toHaveProperty("cwd");
      expect(data).toHaveProperty("skillsDir");
      expect(data).toHaveProperty("installedCount");
      expect(data).toHaveProperty("installed");
      expect(data).toHaveProperty("agents");
      expect(Array.isArray(data.installed)).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBe(7);
      for (const agent of data.agents) {
        expect(agent).toHaveProperty("agent");
        expect(agent).toHaveProperty("path");
        expect(agent).toHaveProperty("exists");
        expect(agent).toHaveProperty("skillCount");
      }
    });

    test("--json cwd is a non-empty string", async () => {
      const { stdout } = await runCli(["setup-info", "--json"]);
      const data = JSON.parse(stdout);
      expect(typeof data.cwd).toBe("string");
      expect(data.cwd.length).toBeGreaterThan(0);
    });

    test("shows help for whoami command", async () => {
      const { stdout } = await runCli(["setup-info", "--help"]);
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

    test("--json with no pinned skills returns empty array", async () => {
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

  describe("schedule --json", () => {
    test("validates, adds, disables, and enables schedules as JSON", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-schedule-json-"));
      try {
        const valid = await runCliInCwd(["schedule", "validate", "*/5 * * * *", "--json"], tmpDir);
        expect(valid.exitCode).toBe(0);
        const validData = JSON.parse(valid.stdout);
        expect(validData.valid).toBe(true);
        expect(validData.nextRuns).toHaveLength(5);

        const add = await runCliInCwd(["schedule", "add", "image", "*/5 * * * *", "--name", "json-test", "--json"], tmpDir);
        expect(add.exitCode).toBe(0);
        const schedule = JSON.parse(add.stdout).schedule;
        expect(schedule.name).toBe("json-test");

        const disabled = await runCliInCwd(["schedule", "disable", "json-test", "--json"], tmpDir);
        expect(JSON.parse(disabled.stdout)).toEqual({ idOrName: "json-test", enabled: false, success: true });

        const enabled = await runCliInCwd(["schedule", "enable", "json-test", "--json"], tmpDir);
        expect(JSON.parse(enabled.stdout)).toEqual({ idOrName: "json-test", enabled: true, success: true });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("due self-hosted schedules require authenticated service quotes without local fallback", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-premium-remote-"));
      const env = { HOME: tmpDir, SKILLS_API_KEY: "", SKILLS_TEST_MODE: "1" };
      try {
        writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: "self-hosted", apiUrl: "https://operator.example" }));
        const add = await runCliInCwd(["schedule", "add", "logo-design", "*/5 * * * *", "--name", "premium-logo", "--json"], tmpDir, env);
        expect(add.exitCode).toBe(0);

        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const run = await runCliInCwd(["schedule", "run", "--json"], tmpDir, env);
        expect(run.exitCode).toBe(1);
        const result = JSON.parse(run.stdout);
        expect(result.ran).toBe(0);
        expect(result.code).toBe("AUTH_REQUIRED");
        expect(result.schedules[0]).toMatchObject({ name: "premium-logo", skill: "logo-design", creditBacked: true });
        expect(result.schedules[0]).not.toHaveProperty("creditQuote");
        expect(JSON.stringify(result)).not.toContain("paid");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("due self-hosted schedules do not use bundled provider availability without auth", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-unavailable-hosted-"));
      const env = { HOME: tmpDir, SKILLS_API_KEY: "", SKILLS_TEST_MODE: "1" };
      try {
        writeFileSync(join(tmpDir, "skills.config.json"), JSON.stringify({ mode: "self-hosted", apiUrl: "https://operator.example" }));
        const add = await runCliInCwd(["schedule", "add", "image", "*/5 * * * *", "--name", "premium-image", "--json"], tmpDir, env);
        expect(add.exitCode).toBe(0);

        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const run = await runCliInCwd(["schedule", "run", "--json"], tmpDir, env);
        expect(run.exitCode).toBe(1);
        const result = JSON.parse(run.stdout);
        expect(result).toMatchObject({
          ran: 0,
          code: "AUTH_REQUIRED",
        });
        expect(result.error).toContain("Remote execution is temporarily unavailable");
        expect(result.error).toContain("No credits were charged.");
        expect(result.approvalRequired).toBeUndefined();
        expect(result.unavailable[0]).toMatchObject({
          name: "premium-image",
          skill: "image",
          availability: {
            status: "unavailable",
            code: "AUTH_REQUIRED",
          },
        });
        expect(JSON.stringify(result)).not.toContain("HOSTED_PROVIDER_UNAVAILABLE");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("paid self-hosted schedules gate unsigned Phase-A and preserve exact signed tokens", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-unsigned-phase-a-"));
      type Phase = "default" | "explicit" | "transition" | "signed";
      let phase: Phase = "default";
      let phaseQuoteCalls = 0;
      const runBodies: Array<{ phase: Phase; body: unknown }> = [];
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            phaseQuoteCalls += 1;
            const quoteToken = phase === "signed"
              ? `signed-${phaseQuoteCalls}`
              : phase === "transition" && phaseQuoteCalls === 3
                ? "quote_transition_signed"
                : undefined;
            return Response.json({
              availability: { status: "available" },
              ...(quoteToken ? { quoteToken } : {}),
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 6, formattedCredits: "6 credits/run" },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            runBodies.push({ phase, body: await req.json() });
            return Response.json({ id: `run_schedule_${phase}`, skill: "logo-design", status: "queued" }, { status: 202 });
          }
          return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const env = { HOME: tmpDir, SKILLS_API_KEY: "sk_test_schedule_unsigned_phase_a" };
        await runCliInCwd(["schedule", "add", "logo-design", "*/5 * * * *", "--name", "legacy-logo", "--json"], tmpDir, env);
        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const makeDue = () => {
          const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
          data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
          writeFileSync(schedulesPath, JSON.stringify(data, null, 2));
        };
        const approvedArgs = ["schedule", "run", "--approve-credits", "--max-credits", "10", "--json"];

        makeDue();
        const denied = await runCliInCwd(approvedArgs, tmpDir, env);
        expect(denied.exitCode).toBe(1);
        expect(JSON.parse(denied.stdout).results[0]).toMatchObject({ status: "error" });
        expect(JSON.parse(denied.stdout).results[0].error).toContain("SELF_HOSTED_QUOTE_TOKEN_REQUIRED");
        expect(phaseQuoteCalls).toBe(2);
        expect(runBodies).toEqual([]);

        phase = "explicit";
        phaseQuoteCalls = 0;
        makeDue();
        const explicit = await runCliInCwd([
          ...approvedArgs.slice(0, -1),
          "--allow-unsigned-phase-a",
          "--json",
        ], tmpDir, env);
        expect(explicit.exitCode).toBe(0);
        expect(JSON.parse(explicit.stdout).results[0]).toMatchObject({ status: "success" });
        expect(phaseQuoteCalls).toBe(3);
        expect(runBodies).toEqual([{
          phase: "explicit",
          body: { input: {}, args: [], approved: true },
        }]);

        phase = "transition";
        phaseQuoteCalls = 0;
        makeDue();
        const transition = await runCliInCwd([
          ...approvedArgs.slice(0, -1),
          "--allow-unsigned-phase-a",
          "--json",
        ], tmpDir, env);
        expect(transition.exitCode).toBe(1);
        expect(JSON.parse(transition.stdout).results[0].error).toContain("SELF_HOSTED_SIGNED_QUOTE_REQUIRES_TOKEN");
        expect(phaseQuoteCalls).toBe(3);
        expect(runBodies).toHaveLength(1);

        phase = "signed";
        phaseQuoteCalls = 0;
        makeDue();
        const signed = await runCliInCwd(approvedArgs, tmpDir, env);
        expect(signed.exitCode).toBe(0);
        expect(phaseQuoteCalls).toBe(2);
        expect(runBodies[1]).toEqual({
          phase: "signed",
          body: { input: {}, args: [], quoteToken: "signed-2", approved: true },
        });

        phaseQuoteCalls = 0;
        makeDue();
        await runCliInCwd(["setup", "--mode", "cloud", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const invalidCloud = await runCliInCwd([
          "schedule",
          "run",
          "--approve-credits",
          "--max-credits",
          "10",
          "--allow-unsigned-phase-a",
          "--json",
        ], tmpDir, { HOME: tmpDir, SKILLS_API_KEY: "sk_test_schedule_cloud_phase_a" });
        expect(invalidCloud.exitCode).toBe(1);
        expect(JSON.parse(invalidCloud.stdout)).toMatchObject({ code: "UNSIGNED_PHASE_A_SELF_HOSTED_ONLY" });
        expect(phaseQuoteCalls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("schedule run rejects unsigned Phase-A outside self-hosted mode even when nothing is due", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");

      for (const mode of ["local", "cloud"] as const) {
        const tmpDir = mkdtempSync(join(tmpdir(), `cli-schedule-noop-${mode}-`));
        try {
          const args = mode === "cloud"
            ? ["setup", "--mode", mode, "--api-url", "https://example.test", "--json"]
            : ["setup", "--mode", mode, "--json"];
          await runCliInCwd(args, tmpDir, { HOME: tmpDir });
          const run = await runCliInCwd([
            "schedule",
            "run",
            "--allow-unsigned-phase-a",
            "--json",
          ], tmpDir, { HOME: tmpDir });
          expect(run.exitCode).toBe(1);
          expect(JSON.parse(run.stdout)).toMatchObject({
            ran: 0,
            code: "UNSIGNED_PHASE_A_SELF_HOSTED_ONLY",
          });
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });

    test("unsigned Phase-A schedules reject same-credit constraint mutations", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-unsigned-constraint-mutation-"));
      let quoteCalls = 0;
      let runCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            quoteCalls += 1;
            return Response.json({
              skill: "logo-design",
              operation: "run",
              constraints: { maxOutputs: quoteCalls === 3 ? 2 : 1 },
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 6, formattedCredits: "6 credits/run" },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design") runCalls += 1;
          return Response.json({ error: "run must not be submitted" }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const env = { HOME: tmpDir, SKILLS_API_KEY: "sk_test_schedule_constraint_mutation" };
        await runCliInCwd(["schedule", "add", "logo-design", "*/5 * * * *", "--name", "mutated-logo", "--json"], tmpDir, env);
        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const run = await runCliInCwd([
          "schedule", "run",
          "--approve-credits", "--max-credits", "10",
          "--allow-unsigned-phase-a",
          "--json",
        ], tmpDir, env);
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout).results[0].error).toContain("SELF_HOSTED_UNSIGNED_QUOTE_CHANGED");
        expect(quoteCalls).toBe(3);
        expect(runCalls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("due cloud schedules enforce the max credits cap against all live quotes before submission", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-live-credit-cap-"));
      let quoteCalls = 0;
      let runCalls = 0;
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/image" && req.method === "GET") {
            return Response.json({
              slug: "image",
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "image", credits: 4, formattedCredits: "4 credits/image" },
            });
          }
          if (url.pathname === "/api/v1/skills/image/quote" && req.method === "POST") {
            quoteCalls += 1;
            return Response.json({
              availability: { status: "available" },
              quoteToken: `quote_schedule_${quoteCalls}`,
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "image", credits: 6, formattedCredits: "6 credits/image" },
            });
          }
          if (url.pathname === "/api/v1/runs/image" && req.method === "POST") {
            runCalls += 1;
            return Response.json({ id: `run_schedule_${runCalls}`, skill: "image", status: "queued" });
          }
          return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
        },
      });
      const env = { HOME: tmpDir, SKILLS_API_KEY: "sk_test_schedule_live_cap" };

      try {
        const setup = await runCliInCwd([
          "setup",
          "--mode",
          "cloud",
          "--api-url",
          `http://127.0.0.1:${server.port}`,
          "--json",
        ], tmpDir, { HOME: tmpDir });
        expect(setup.exitCode).toBe(0);

        for (const name of ["image-one", "image-two"]) {
          const add = await runCliInCwd(["schedule", "add", "image", "*/5 * * * *", "--name", name, "--json"], tmpDir, env);
          expect(add.exitCode).toBe(0);
        }
        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        for (const schedule of data.schedules) schedule.nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const run = await runCliInCwd([
          "schedule",
          "run",
          "--approve-credits",
          "--max-credits",
          "8",
          "--json",
        ], tmpDir, env);
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout)).toMatchObject({
          ran: 0,
          approvalRequired: true,
          totalCredits: 12,
          maxCredits: 8,
        });
        expect(quoteCalls).toBe(2);
        expect(runCalls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("self-hosted schedule dry-runs use the selected service quote", async () => {
      const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-schedule-selfhost-quote-"));
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          calls.push(`${req.method} ${url.pathname}`);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "free", creditUnit: "run", credits: 0, formattedCredits: "0 credits" },
            });
          }
          return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const env = { HOME: tmpDir, SKILLS_API_KEY: "sk_test_schedule_selfhost_quote" };
        await runCliInCwd(["schedule", "add", "logo-design", "*/5 * * * *", "--name", "selfhost-logo", "--json"], tmpDir, env);
        const schedulesPath = join(tmpDir, ".skills", "schedules.json");
        const data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
        data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
        writeFileSync(schedulesPath, JSON.stringify(data, null, 2));

        const dryRun = await runCliInCwd(["schedule", "run", "--dry-run", "--json"], tmpDir, env);
        expect(dryRun.exitCode).toBe(0);
        expect(JSON.parse(dryRun.stdout)).toMatchObject({
          totalCredits: 0,
          due: [{ skill: "logo-design", creditQuote: { credits: 0, formattedCredits: "0 credits" } }],
        });
        expect(calls).toEqual(["POST /api/v1/skills/logo-design/quote"]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("runtime --json", () => {
    test("mcp registration writes and merges agent configs", async () => {
      const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-mcp-register-"));
      try {
        mkdirSync(join(tmpDir, ".codex"), { recursive: true });
        writeFileSync(join(tmpDir, ".codex", "config.toml"), [
          "[model_providers.local]",
          "name = \"Local\"",
          "",
          "[mcp_servers.skills]",
          "command = \"old-skills-mcp\"",
          "args = [\"old\"]",
          "",
          "[mcp_servers.other]",
          "command = \"other-mcp\"",
          "",
        ].join("\n"));

        const codex = await runCliInCwd(["mcp", "--register", "codex", "--json"], tmpDir, { HOME: tmpDir });
        expect(codex.stderr).toBe("");
        expect(codex.exitCode).toBe(0);
        const codexData = JSON.parse(codex.stdout);
        expect(codexData.registered).toBe(1);
        expect(codexData.results[0]).toMatchObject({ agent: "codex", success: true, path: join(tmpDir, ".codex", "config.toml") });
        const codexConfig = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
        expect(codexConfig).toContain("[model_providers.local]");
        expect(codexConfig).toContain("[mcp_servers.other]");
        expect(codexConfig).toContain("[mcp_servers.skills]");
        expect(codexConfig).toContain("skills-mcp");
        expect(codexConfig).not.toContain("old-skills-mcp");
        expect(codexConfig).not.toContain("args = [\"old\"]");

        const connect = await runCliInCwd(["mcp", "connect", "codex", "--json"], tmpDir, { HOME: tmpDir });
        expect(connect.stderr).toBe("");
        expect(connect.exitCode).toBe(0);
        expect(JSON.parse(connect.stdout)).toMatchObject({ registered: 1 });

        mkdirSync(join(tmpDir, ".gemini"), { recursive: true });
        writeFileSync(join(tmpDir, ".gemini", "settings.json"), JSON.stringify({
          approvalMode: "default",
          mcpServers: { other: { command: "other-mcp" } },
        }, null, 2));
        const gemini = await runCliInCwd(["mcp", "--register", "gemini", "--json"], tmpDir, { HOME: tmpDir });
        expect(gemini.exitCode).toBe(0);
        const geminiConfig = JSON.parse(readFileSync(join(tmpDir, ".gemini", "settings.json"), "utf-8"));
        expect(geminiConfig.approvalMode).toBe("default");
        expect(geminiConfig.mcpServers.other.command).toBe("other-mcp");
        expect(geminiConfig.mcpServers.skills.command).toContain("skills-mcp");

        mkdirSync(join(tmpDir, ".config", "opencode"), { recursive: true });
        writeFileSync(join(tmpDir, ".config", "opencode", "opencode.json"), JSON.stringify({
          model: "anthropic/claude-sonnet-4-5",
          mcp: { other: { type: "local", command: ["other-mcp"] } },
        }, null, 2));
        const opencode = await runCliInCwd(["mcp", "--register", "opencode", "--json"], tmpDir, { HOME: tmpDir });
        expect(opencode.exitCode).toBe(0);
        const opencodeConfig = JSON.parse(readFileSync(join(tmpDir, ".config", "opencode", "opencode.json"), "utf-8"));
        expect(opencodeConfig.model).toBe("anthropic/claude-sonnet-4-5");
        expect(opencodeConfig.mcp.other.command).toEqual(["other-mcp"]);
        expect(opencodeConfig.mcp.skills).toMatchObject({ type: "local", enabled: true });
        expect(opencodeConfig.mcp.skills.command[0]).toContain("skills-mcp");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("self-update reports test-mode failure as JSON", async () => {
      const { stdout, stderr, exitCode } = await runCli(["self-update", "--json"]);
      const data = JSON.parse(stdout);
      expect(stderr).toBe("");
      expect(exitCode).not.toBe(0);
      expect(data.updated).toBe(false);
      expect(data.error).toContain("test mode");
    });
  });

  describe("feedback", () => {
    test("agents can save feedback locally as JSON", async () => {
      const { existsSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = require("fs").mkdtempSync(join(tmpdir(), "cli-feedback-"));
      try {
        const { stdout, stderr, exitCode } = await runCliInCwd([
          "feedback",
          "agent",
          "found",
          "an",
          "issue",
          "--agent",
          "Octavia",
          "--category",
          "bug",
          "--json",
        ], tmpDir, { HOME: tmpDir });
        const data = JSON.parse(stdout);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({ saved: true, category: "bug" });
        expect(data.path).toContain(".hasna/skills/skills.db");
        expect(existsSync(data.path)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("completion", () => {
    test("bash completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "bash"]);
      expect(stdout).toContain("interactive");
      expect(stdout).toContain("export");
      expect(stdout).toContain("import");
      expect(stdout).toContain("setup-info");
      expect(stdout).toContain("test");
      expect(stdout).toContain("config");
      expect(stdout).toContain("create");
      expect(stdout).toContain("sync");
      expect(stdout).toContain("validate");
      expect(stdout).toContain("diff");
      expect(stdout).toContain("schedule");
      expect(stdout).toContain("registry");
      expect(stdout).toContain("feedback");
    });

    test("zsh completion includes all current top-level commands", async () => {
      const { stdout } = await runCli(["completion", "zsh"]);
      expect(stdout).toContain("'interactive:interactive command'");
      expect(stdout).toContain("'export:export command'");
      expect(stdout).toContain("'import:import command'");
      expect(stdout).toContain("'auth:auth command'");
      expect(stdout).toContain("'test:test command'");
      expect(stdout).toContain("'config:config command'");
      expect(stdout).toContain("'create:create command'");
      expect(stdout).toContain("'sync:sync command'");
      expect(stdout).toContain("'validate:validate command'");
      expect(stdout).toContain("'diff:diff command'");
      expect(stdout).toContain("'schedule:schedule command'");
      expect(stdout).toContain("'registry:registry command'");
      expect(stdout).toContain("'feedback:feedback command'");
    });
  });
});
