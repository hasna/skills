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

describe("CLI run premium developer", () => {
  describe("run", () => {

    test("api-docs-portal submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-api-docs-portal-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_api_docs_portal_async");
          if (url.pathname === "/api/v1/runs/api-docs-portal" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--spec",
              "GET /v1/projects, POST /v1/projects",
              "--title",
              "Acme API",
            ]);
            return Response.json(
              {
                id: "run_api_docs_portal_async",
                skill: "api-docs-portal",
                status: "queued",
                correlationId: "corr_api_docs_portal_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$2.50/run",
                },
              },
              { status: 202 },
            );
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });
      try {
        const proc = Bun.spawn([
          "bun",
          "run",
          CLI_PATH,
          "--",
          "run",
          "--yes",
          "--json",
          "api-docs-portal",
          "--spec",
          "GET /v1/projects, POST /v1/projects",
          "--title",
          "Acme API",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_api_docs_portal_async",
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
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({
          skill: "api-docs-portal",
          remote: true,
          remoteRun: { id: "run_api_docs_portal_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_api_docs_portal_async",
            download: "skills exports download run_api_docs_portal_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("sdk-generator submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-sdk-generator-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_sdk_generator_async");
          if (url.pathname === "/api/v1/runs/sdk-generator" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--api",
              "Billing API for usage meters and invoices",
              "--name",
              "meterkit",
              "--resources",
              "customers,meters,invoices",
            ]);
            return Response.json(
              {
                id: "run_sdk_generator_async",
                skill: "sdk-generator",
                status: "queued",
                correlationId: "corr_sdk_generator_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$6.00/run",
                },
              },
              { status: 202 },
            );
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      });
      try {
        const proc = Bun.spawn([
          "bun",
          "run",
          CLI_PATH,
          "--",
          "run",
          "--yes",
          "--json",
          "sdk-generator",
          "--api",
          "Billing API for usage meters and invoices",
          "--name",
          "meterkit",
          "--resources",
          "customers,meters,invoices",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_sdk_generator_async",
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
        expect(exitCode).toBe(0);
        expect(data).toMatchObject({
          skill: "sdk-generator",
          remote: true,
          remoteRun: { id: "run_sdk_generator_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_sdk_generator_async",
            download: "skills exports download run_sdk_generator_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("openai");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gemini");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });



  });
});
