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
            return Response.json({
              quoteToken: "quote_approval_required",
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" },
            });
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
      let submittedIdempotencyKey: string | null = null;
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_async");
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            return Response.json({
              quoteToken: "quote_async_exact",
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            expect(await req.json()).toEqual({
              input: {},
              args: ["make a mark"],
              quoteToken: "quote_async_exact",
              approved: true,
            });
            submittedIdempotencyKey = req.headers.get("idempotency-key");
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
        const attemptReceipt = JSON.parse(runStderr);
        expect(attemptReceipt).toMatchObject({
          event: "remote_mutation_attempt",
          localRunId: runData.run.id,
          idempotencyKey: runData.run.idempotencyKey,
        });
        expect(runExitCode).toBe(0);
        expect(runData.contractVersion).toBe(1);
        expect(runData.remote).toBe(true);
        expect(runData.remoteRun).toMatchObject({ contractVersion: 1, id: "run_async", status: "queued" });
        expect(runData.run.remoteRunId).toBe("run_async");
        expect(runData.run.idempotencyKey).toMatch(/^skills-run-[a-f0-9]{48}$/);
        expect(submittedIdempotencyKey).toBe(runData.run.idempotencyKey);
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

    test("response loss persists an unknown logical attempt and retry reuses its idempotency key", async () => {
      const { mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const { join } = require("path");
      const tmpDir = mkdtempSync(join(tmpdir(), "cli-response-loss-"));
      const submittedKeys: Array<string | null> = [];
      const submittedBodies: unknown[] = [];
      let quoteCalls = 0;
      let submitCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            quoteCalls += 1;
            return Response.json({ quoteToken: "quote_immutable_cli", creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" } });
          }
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            submitCalls += 1;
            submittedKeys.push(req.headers.get("idempotency-key"));
            return req.json().then((body) => {
              submittedBodies.push(body);
              if (submitCalls === 1) return Response.json({ code: "UPSTREAM_RESPONSE_LOST" }, { status: 503 });
              return Response.json({ id: "run_recovered", skill: "logo-design", status: "queued" });
            });
          }
          return Response.json({ code: "NOT_FOUND" }, { status: 404 });
        },
      });
      const env = {
        HOME: tmpDir,
        NO_COLOR: "1",
        SKILLS_TEST_MODE: "1",
        SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
        SKILLS_MODE: "self-hosted",
        SKILLS_API_KEY: "sk_test_response_loss",
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      };

      try {
        writeModeConfig(tmpDir, "self-hosted", `http://127.0.0.1:${server.port}`);
        const first = await runCliInCwd(["run", "--yes", "--json", "logo-design", "make a mark"], tmpDir, env);
        const unknown = JSON.parse(first.stdout);
        const firstReceipt = JSON.parse(first.stderr);
        expect(first.exitCode).toBe(75);
        expect(unknown).toMatchObject({
          code: "REMOTE_MUTATION_OUTCOME_UNKNOWN",
          outcome: "unknown",
          localRunId: firstReceipt.localRunId,
          idempotencyKey: firstReceipt.idempotencyKey,
          run: { status: "unknown" },
        });
        const stored = JSON.parse(readFileSync(join(tmpDir, unknown.run.paths.runDir, "run.json"), "utf8"));
        expect(stored).toMatchObject({ id: unknown.localRunId, status: "unknown", idempotencyKey: unknown.idempotencyKey });

        const retry = await runCliInCwd([
          "run", "--retry", unknown.localRunId, "--yes", "--json", "logo-design", "make a mark",
        ], tmpDir, env);
        const recovered = JSON.parse(retry.stdout);
        const retryReceipt = JSON.parse(retry.stderr);
        expect(retry.exitCode).toBe(0);
        expect(recovered).toMatchObject({ remoteRun: { id: "run_recovered" }, run: { id: unknown.localRunId } });
        expect(retryReceipt).toMatchObject({ localRunId: unknown.localRunId, idempotencyKey: unknown.idempotencyKey });
        expect(submittedKeys).toEqual([unknown.idempotencyKey, unknown.idempotencyKey]);
        expect(quoteCalls).toBe(1);
        expect(submittedBodies).toEqual([
          { input: {}, args: ["make a mark"], quoteToken: "quote_immutable_cli", approved: true },
          { input: {}, args: ["make a mark"], quoteToken: "quote_immutable_cli", approved: true },
        ]);
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
        const invalidCompatibility = await runCliInCwd([
          "run",
          "--yes",
          "--allow-unsigned-phase-a",
          "--json",
          "image",
          "a bright forest",
        ], tmpDir, {
          HOME: tmpDir,
          SKILLS_API_KEY: "sk_test_cloud_authority",
        });
        expect(invalidCompatibility.exitCode).toBe(1);
        expect(JSON.parse(invalidCompatibility.stdout)).toMatchObject({ code: "UNSIGNED_PHASE_A_SELF_HOSTED_ONLY" });
        expect(calls).toEqual([]);
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

    test("cloud quote rejects an authenticated response that carries a token without a creditQuote", async () => {
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
        expect(payload.error).toContain("quote failure must not include quoteToken or expiresAt");
        expect(payload.availability).toBeUndefined();
        expect(JSON.stringify(payload)).not.toContain("quote_without_authoritative_credits");
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

    test("paid unsigned self-hosted runs require explicit Phase-A opt-in and re-verification", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-selfhost-unsigned-phase-a-"));
      let quoteCalls = 0;
      const runBodies: unknown[] = [];
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            quoteCalls += 1;
            return Response.json({
              availability: { status: "available" },
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 7, formattedCredits: "7 credits/run" },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design" && req.method === "POST") {
            runBodies.push(await req.json());
            return Response.json({ id: "run_unsigned_phase_a", skill: "logo-design", status: "queued" }, { status: 202 });
          }
          if (url.pathname === "/api/v1/runs/run_unsigned_phase_a/logs" && req.method === "GET") {
            return Response.json([]);
          }
          return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const env = { HOME: tmpDir, SKILLS_API_KEY: "sk_test_selfhost_unsigned_phase_a" };

        const denied = await runCliInCwd(["run", "--yes", "--json", "logo-design", "legacy mark"], tmpDir, env);
        expect(denied.exitCode).toBe(1);
        expect(JSON.parse(denied.stdout)).toMatchObject({ code: "SELF_HOSTED_QUOTE_TOKEN_REQUIRED" });
        expect(quoteCalls).toBe(1);
        expect(runBodies).toEqual([]);

        const allowed = await runCliInCwd([
          "run",
          "--yes",
          "--allow-unsigned-phase-a",
          "--json",
          "logo-design",
          "legacy mark",
        ], tmpDir, env);
        expect(allowed.exitCode).toBe(0);
        expect(JSON.parse(allowed.stdout).remoteRun).toMatchObject({ id: "run_unsigned_phase_a" });
        expect(quoteCalls).toBe(3);
        expect(runBodies).toEqual([{ input: {}, args: ["legacy mark"], approved: true }]);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("unsigned Phase-A permission cannot bypass a newly signed self-hosted quote", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-selfhost-unsigned-signed-race-"));
      let quoteCalls = 0;
      let runCalls = 0;
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
            quoteCalls += 1;
            return Response.json({
              availability: { status: "available" },
              ...(quoteCalls === 2 ? { quoteToken: "quote_became_signed" } : {}),
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 7, formattedCredits: "7 credits/run" },
            });
          }
          if (url.pathname === "/api/v1/runs/logo-design") runCalls += 1;
          return Response.json({ error: "run must not be submitted" }, { status: 500 });
        },
      });

      try {
        const apiUrl = `http://127.0.0.1:${server.port}`;
        await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
        const run = await runCliInCwd([
          "run",
          "--yes",
          "--allow-unsigned-phase-a",
          "--json",
          "logo-design",
          "raced mark",
        ], tmpDir, { HOME: tmpDir, SKILLS_API_KEY: "sk_test_selfhost_signed_race" });
        expect(run.exitCode).toBe(1);
        expect(JSON.parse(run.stdout)).toMatchObject({ code: "SELF_HOSTED_SIGNED_QUOTE_REQUIRES_TOKEN" });
        expect(quoteCalls).toBe(2);
        expect(runCalls).toBe(0);
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    for (const mutation of ["creditUnit", "skill", "operation", "constraints"] as const) {
      test(`unsigned Phase-A rejects a same-credit ${mutation} quote mutation`, async () => {
        const { mkdtempSync, rmSync } = require("fs");
        const { tmpdir } = require("os");
        const tmpDir = mkdtempSync(require("path").join(tmpdir(), `cli-selfhost-unsigned-${mutation}-`));
        let quoteCalls = 0;
        let runCalls = 0;
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/api/v1/skills/logo-design/quote" && req.method === "POST") {
              quoteCalls += 1;
              const changed = quoteCalls === 2;
              return Response.json({
                skill: mutation === "skill" && changed ? "image" : "logo-design",
                operation: mutation === "operation" && changed ? "batch" : "run",
                constraints: { maxOutputs: mutation === "constraints" && changed ? 2 : 1 },
                availability: { status: "available" },
                creditQuote: {
                  ...AUTHORITATIVE_TEST_QUOTE,
                  tier: "premium",
                  creditUnit: mutation === "creditUnit" && changed ? "image" : "run",
                  credits: 7,
                  formattedCredits: mutation === "creditUnit" && changed ? "7 credits/image" : "7 credits/run",
                },
              });
            }
            if (url.pathname === "/api/v1/runs/logo-design") runCalls += 1;
            return Response.json({ error: "run must not be submitted" }, { status: 500 });
          },
        });

        try {
          const apiUrl = `http://127.0.0.1:${server.port}`;
          await runCliInCwd(["setup", "--mode", "self-hosted", "--api-url", apiUrl, "--json"], tmpDir, { HOME: tmpDir });
          const run = await runCliInCwd([
            "run",
            "--yes",
            "--allow-unsigned-phase-a",
            "--json",
            "logo-design",
            "mutated mark",
          ], tmpDir, { HOME: tmpDir, SKILLS_API_KEY: `sk_test_selfhost_${mutation}_mutation` });
          expect(run.exitCode).toBe(1);
          expect(JSON.parse(run.stdout).code).toMatch(/^SELF_HOSTED_UNSIGNED_(QUOTE_CHANGED|REQUote_FAILED)$/i);
          expect(quoteCalls).toBe(2);
          expect(runCalls).toBe(0);
        } finally {
          server.stop(true);
          rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    }

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
        expect(data.code).toBe("HOSTED_SERVICE_UNAVAILABLE");
        expect(data.availability).toMatchObject({
          status: "unavailable",
          code: "HOSTED_SERVICE_UNAVAILABLE",
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
            return Response.json({
              quoteToken: "quote_wait_exact",
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" },
            });
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

        expect(JSON.parse(stderr)).toMatchObject({
          event: "remote_mutation_attempt",
          localRunId: data.run.id,
          idempotencyKey: data.run.idempotencyKey,
        });
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
            return Response.json({
              quoteToken: "quote_failed_exact",
              creditQuote: { ...AUTHORITATIVE_TEST_QUOTE, tier: "premium", creditUnit: "run", credits: 50, formattedCredits: "50 credits/run" },
            });
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

        expect(JSON.parse(stderr)).toMatchObject({
          event: "remote_mutation_attempt",
          localRunId: data.run.id,
          idempotencyKey: data.run.idempotencyKey,
        });
        expect(exitCode).toBe(7);
        expect(data.exitCode).toBe(7);
        expect(data.error).toBe("The Skills run could not be completed.");
        expect(data.remoteRun).toMatchObject({ id: "run_failed", status: "failed" });
        expect(data.run).toMatchObject({
          status: "failed",
          remoteRunId: "run_failed",
          error: "The Skills run could not be completed.",
        });
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
