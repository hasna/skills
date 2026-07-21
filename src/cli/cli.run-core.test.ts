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

function writeModeConfig(cwd: string, mode: "local" | "self-hosted" | "cloud", apiUrl?: string): void {
  require("fs").writeFileSync(require("path").join(cwd, "skills.config.json"), JSON.stringify({ mode, ...(apiUrl ? { apiUrl } : {}) }));
}

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
        writeModeConfig(tmpDir, "local");
        const { stdout, stderr, exitCode } = await runCliInCwd(["run", "--json", "lorem-generator", "--help"], tmpDir, {
          HOME: tmpDir,
          NO_COLOR: "1",
          SKILLS_API_KEY: "sk_test_local_stays_local",
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

    test("premium skills never use test mode as a local execution bypass", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-no-test-bypass-"));
      try {
        writeModeConfig(tmpDir, "self-hosted", "https://operator.example");
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "logo-design", "--help"], {
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
        expect(data.error).toContain("remote skill");
        expect(data.error).toContain("skills setup --mode self-hosted --api-url https://operator.example");
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
        writeModeConfig(tmpDir, "self-hosted", "https://operator.example");
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "logo-design", "prompt"], {
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
        expect(data.error).toContain("remote skill");
        expect(data.error).toContain("skills setup --mode self-hosted --api-url https://operator.example");
        expect(data.error).toContain("skills auth login");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills require explicit paid approval before remote submission", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-approval-required-"));
      let remoteCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          remoteCalls += 1;
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote") {
            return Response.json({ creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" } });
          }
          return Response.json({ error: "run should be blocked before remote submission" }, { status: 500 });
        },
      });
      try {
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "logo-design", "make a mark"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
            SKILLS_MODE: "self-hosted",
            SKILLS_TEST_API_KEY: "sk_test_approval_required",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
            SKILLS_TEST_API_URL: `http://127.0.0.1:${server.port}`,
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
        expect(data.approvalRequired).toBe(true);
        expect(data.error).toContain("requires 50 credits/run");
        expect(data.error).toContain("--yes");
        expect(data.run.remote).toBe(true);
        expect(data.run.status).toBe("failed");
        expect(remoteCalls).toBe(1);
      } finally {
        server.stop(true);
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
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({ creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" } });
          }
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
        SKILLS_TEST_MODE: "1",
        SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
        SKILLS_MODE: "self-hosted",
        SKILLS_TEST_API_KEY: "sk_test_async",
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_TEST_API_URL: `http://127.0.0.1:${server.port}`,
      };
      try {
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const runProc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--yes", "--json", "logo-design", "make a mark"], {
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

    test("cloud mode uses live capability and credit quotes before submitting", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-cloud-authority-"));
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          calls.push(`${req.method} ${url.pathname}`);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_cloud_authority");
          if (url.pathname === "/api/v1/skills/image" && req.method === "GET") {
            return Response.json({
              slug: "image",
              displayName: "Image",
              description: "Cloud image generation",
              category: "Media Processing",
              tags: ["image"],
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE,
                tier: "premium",
                creditUnit: "image",
                credits: 9,
                formattedCredits: "9 credits/image",
                estimated: false,
                quoteDependsOnInput: false,
                quoteRequired: true,
              },
            });
          }
          if (url.pathname === "/api/v1/skills/image/quote" && req.method === "POST") {
            return Response.json({
              availability: { status: "available" },
              quoteToken: "quote_cloud_image_11",
              expiresAt: "2026-07-21T16:00:00.000Z",
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE,
                tier: "premium",
                creditUnit: "image",
                credits: 11,
                formattedCredits: "11 credits/image",
                estimated: false,
                quoteDependsOnInput: false,
                quoteRequired: true,
              },
            });
          }
          if (url.pathname === "/api/v1/runs/image" && req.method === "POST") {
            expect(await req.json()).toEqual({
              input: {},
              args: ["a bright forest"],
              quoteToken: "quote_cloud_image_11",
              approved: true,
            });
            return Response.json({ id: "run_cloud_image", skill: "image", status: "queued" }, { status: 202 });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        const setup = await runCliInCwd(["setup", "--mode", "cloud", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        expect(setup.exitCode).toBe(0);
        const run = await runCliInCwd(["run", "--yes", "--json", "image", "a bright forest"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_cloud_authority",
        });
        expect(run.exitCode).toBe(0);
        const payload = JSON.parse(run.stdout);
        expect(payload.creditQuote).toMatchObject({ credits: 11, formattedCredits: "11 credits/image" });
        expect(payload.remoteRun).toMatchObject({ id: "run_cloud_image", status: "queued" });
        expect(JSON.stringify(payload)).not.toContain("pricing");
        expect(JSON.stringify(payload)).not.toContain("costCents");
        expect(JSON.stringify(payload)).not.toContain("$");
        expect(calls).toEqual([
          "GET /api/v1/skills/image",
          "POST /api/v1/skills/image/quote",
          "POST /api/v1/runs/image",
          "GET /api/v1/runs/run_cloud_image/logs",
        ]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("cloud quote fails closed when the authenticated response omits creditQuote despite registry metadata and a token", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-cloud-missing-live-quote-"));
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/image" && req.method === "GET") {
            return Response.json({
              slug: "image",
              availability: { status: "available" },
              creditQuote: {
                ...AUTHORITATIVE_TEST_QUOTE,
                tier: "premium",
                creditUnit: "image",
                credits: 9,
                formattedCredits: "9 credits/image",
              },
            });
          }
          if (url.pathname === "/api/v1/skills/image/quote" && req.method === "POST") {
            return Response.json({
              availability: { status: "available" },
              quoteToken: "quote_without_authoritative_credits",
              expiresAt: "2026-07-21T16:00:00.000Z",
            });
          }
          return Response.json({ error: "unexpected request" }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "cloud", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const quoted = await runCliInCwd(["quote", "image", "--json"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_cloud_missing_live_quote",
        });
        expect(quoted.exitCode).toBe(1);
        const payload = JSON.parse(quoted.stdout);
        expect(payload).toMatchObject({ code: "CLOUD_CAPABILITY_CHECK_FAILED" });
        expect(payload.error).toContain("did not return a creditQuote");
        expect(payload.availability).toBeUndefined();
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("self-hosted quote and run use the selected service zero-credit authority without paid approval", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-selfhost-quote-authority-"));
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          calls.push(`${req.method} ${url.pathname}`);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE,
                tier: "free",
                creditUnit: "run",
                credits: 0,
                formattedCredits: "0 credits",
              },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            expect(await req.json()).toEqual({ input: {}, args: ["minimal mark"] });
            return Response.json({ id: "run_selfhost_logo", skill: "logo-design", status: "queued", credits: 0 });
          }
          if (url.pathname === "/api/v1/runs/run_selfhost_logo/logs" && req.method === "GET") {
            return Response.json([]);
          }
          return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        const setup = await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        expect(setup.exitCode).toBe(0);
        const quote = await runCliInCwd(["quote", "logo-design", "minimal mark", "--json"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_selfhost_quote_authority",
        });
        expect(quote.exitCode).toBe(0);
        expect(JSON.parse(quote.stdout).creditQuote).toMatchObject({ tier: "free", creditUnit: "run", credits: 0 });
        const run = await runCliInCwd(["run", "--json", "logo-design", "minimal mark"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_selfhost_quote_authority",
        });
        expect(run.exitCode).toBe(0);
        const payload = JSON.parse(run.stdout);
        expect(payload.creditQuote).toMatchObject({ tier: "free", creditUnit: "run", credits: 0, formattedCredits: "0 credits" });
        expect(payload.approvalRequired).toBeUndefined();
        expect(calls).toEqual([
          "POST /api/v1/skills/logo-design/quote",
          "POST /api/v1/skills/logo-design/quote",
          "POST /api/v1/runs/logo-design",
          "GET /api/v1/runs/run_selfhost_logo/logs",
        ]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("cloud mode rejects unavailable skills before quote or charge", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-cloud-unavailable-"));
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          calls.push(`${req.method} ${url.pathname}`);
          return Response.json({
            slug: "image",
            displayName: "Image",
            description: "Cloud image generation",
            category: "Media Processing",
            tags: ["image"],
            availability: {
              status: "unavailable",
              code: "CAPACITY_UNAVAILABLE",
              message: "Image generation is temporarily unavailable.",
              details: ["No balance was charged."],
            },
            creditQuote: {
              ...AUTHORITATIVE_TEST_QUOTE,
              tier: "premium",
              creditUnit: "image",
              credits: 9,
              formattedCredits: "9 credits/image",
            },
          });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "cloud", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const run = await runCliInCwd(["run", "--yes", "--json", "image", "a bright forest"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_cloud_unavailable",
        });
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout)).toMatchObject({ code: "CAPACITY_UNAVAILABLE" });
        expect(JSON.parse(run.stdout).details).toContain("No credits were charged.");
        expect(JSON.stringify(JSON.parse(run.stdout))).not.toContain("balance was charged");
        expect(calls).toEqual(["GET /api/v1/skills/image"]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("cloud mode rejects a paid quote without a signed quote token before submission", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-cloud-missing-token-"));
      const calls: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          calls.push(`${req.method} ${url.pathname}`);
          if (url.pathname === "/api/v1/skills/image") {
            return Response.json({
              slug: "image",
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "image", credits: 9, formattedCredits: "9 credits/image" },
            });
          }
          if (url.pathname === "/api/v1/skills/image/quote") {
            return Response.json({
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "image", credits: 11, formattedCredits: "11 credits/image" },
            });
          }
          return Response.json({ error: "run must not be submitted" }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "cloud", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const run = await runCliInCwd(["run", "--yes", "--json", "image", "a bright forest"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_cloud_missing_token",
        });
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout).error).toContain("required quote token");
        expect(JSON.parse(run.stdout).error).toContain("No credits were charged");
        expect(calls).toEqual([
          "GET /api/v1/skills/image",
          "POST /api/v1/skills/image/quote",
        ]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("local mode rejects premium remote execution without network calls", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-local-premium-"));
      let calls = 0;
      const server = Bun.serve({ port: 0, fetch() { calls += 1; return Response.json({ error: "unexpected" }); } });
      try {
        await runCliInCwd(["setup", "--mode", "local", "--json"], tmpDir, { HOME: tmpDir });
        const run = await runCliInCwd(["run", "--yes", "--json", "image", "a bright forest"], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_local_premium",
        });
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout)).toMatchObject({ code: "REMOTE_MODE_REQUIRED", remote: false });
        expect(calls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("premium skills fail closed when the hosted API is unavailable", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-skillsmd-down-"));
      try {
        writeModeConfig(tmpDir, "self-hosted", "http://127.0.0.1:1");
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--yes", "--json", "logo-design", "--help"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
            SKILLS_MODE: "self-hosted",
            SKILLS_TEST_API_KEY: "sk_test_skillsmd_down",
            SKILLS_API_URL: "http://127.0.0.1:1",
            SKILLS_TEST_API_URL: "http://127.0.0.1:1",
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
        expect(data.error).toContain("requires access to the selected self-hosted service");
        expect(data.stdout).toBeUndefined();
        expect(data.run.remote).toBe(true);
        expect(data.run.status).toBe("failed");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("unavailable hosted provider skills fail before auth, approval, or remote calls", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-premium-unavailable-provider-"));
      let remoteCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          remoteCalls += 1;
          return Response.json({ error: "unavailable skills should not call hosted API" }, { status: 500 });
        },
      });
      try {
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--json", "image", "a mountain at sunrise"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
            SKILLS_MODE: "self-hosted",
            SKILLS_API_KEY: "",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
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
        expect(data.code).toBe("HOSTED_PROVIDER_UNAVAILABLE");
        expect(data.availability).toMatchObject({
          status: "unavailable",
          code: "HOSTED_PROVIDER_UNAVAILABLE",
        });
        expect(data.details).toContain("No credits were charged.");
        expect(data.error).not.toContain("skills auth login");
        expect(data.approvalRequired).toBeUndefined();
        expect(data.run.remote).toBe(true);
        expect(data.run.status).toBe("failed");
        expect(remoteCalls).toBe(0);
      } finally {
        server.stop(true);
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
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({ creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" } });
          }
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
        SKILLS_TEST_MODE: "1",
        SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
        SKILLS_MODE: "self-hosted",
        SKILLS_TEST_API_KEY: "sk_test_wait",
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_TEST_API_URL: `http://127.0.0.1:${server.port}`,
      };
      try {
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const proc = Bun.spawn([
          "bun",
          "run",
          CLI_PATH,
          "--",
          "run",
          "--yes",
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
        expect(readFileSync(stdoutLogPath, "utf-8")).toContain("[redacted]");
        expect(readFileSync(stdoutLogPath, "utf-8")).not.toContain("logo package ready");
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
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({ creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" } });
          }
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
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "run", "--yes", "--json", "logo-design", "bad prompt"], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "1",
            SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
            SKILLS_MODE: "self-hosted",
            SKILLS_TEST_API_KEY: "sk_test_failed",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
            SKILLS_TEST_API_URL: `http://127.0.0.1:${server.port}`,
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
        expect(readFileSync(stderrLogPath, "utf-8")).toContain("[redacted]");
        expect(readFileSync(stderrLogPath, "utf-8")).not.toContain("remote renderer failed");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  });
});
