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
    test("test-suite-generator submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-test-suite-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_suite_async");
          if (url.pathname === "/api/v1/runs/test-suite-generator" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--spec",
              "POST /api/projects, GET /api/projects/:id",
              "--include-browser",
            ]);
            return Response.json(
              {
                id: "run_test_suite_async",
                skill: "test-suite-generator",
                status: "queued",
                correlationId: "corr_test_suite_async",
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
          "--json",
          "test-suite-generator",
          "--spec",
          "POST /api/projects, GET /api/projects/:id",
          "--include-browser",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_suite_async",
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
          skill: "test-suite-generator",
          remote: true,
          remoteRun: { id: "run_test_suite_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_test_suite_async",
            download: "skills exports download run_test_suite_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

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

    test("repo-onboarding-report submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-repo-onboarding-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_repo_onboarding_async");
          if (url.pathname === "/api/v1/runs/repo-onboarding-report" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--target",
              ".",
              "--name",
              "Meterkit",
              "--stack",
              "Next.js SaaS",
            ]);
            return Response.json(
              {
                id: "run_repo_onboarding_async",
                skill: "repo-onboarding-report",
                status: "queued",
                correlationId: "corr_repo_onboarding_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$2.00/run",
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
          "--json",
          "repo-onboarding-report",
          "--target",
          ".",
          "--name",
          "Meterkit",
          "--stack",
          "Next.js SaaS",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_repo_onboarding_async",
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
          skill: "repo-onboarding-report",
          remote: true,
          remoteRun: { id: "run_repo_onboarding_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_repo_onboarding_async",
            download: "skills exports download run_repo_onboarding_async",
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

    test("performance-audit-report submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-performance-audit-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_performance_audit_async");
          if (url.pathname === "/api/v1/runs/performance-audit-report" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--target",
              "https://skills.md",
              "--app",
              "Skills.md",
              "--surface",
              "web",
            ]);
            return Response.json(
              {
                id: "run_performance_audit_async",
                skill: "performance-audit-report",
                status: "queued",
                correlationId: "corr_performance_audit_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$3.00/run",
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
          "--json",
          "performance-audit-report",
          "--target",
          "https://skills.md",
          "--app",
          "Skills.md",
          "--surface",
          "web",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_performance_audit_async",
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
          skill: "performance-audit-report",
          remote: true,
          remoteRun: { id: "run_performance_audit_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_performance_audit_async",
            download: "skills exports download run_performance_audit_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("migration-plan-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-migration-plan-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_migration_plan_async");
          if (url.pathname === "/api/v1/runs/migration-plan-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--system",
              "Skills.md",
              "--from",
              "Next.js 14",
              "--to",
              "Next.js 16",
            ]);
            return Response.json(
              {
                id: "run_migration_plan_async",
                skill: "migration-plan-pack",
                status: "queued",
                correlationId: "corr_migration_plan_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$3.00/run",
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
          "--json",
          "migration-plan-pack",
          "--system",
          "Skills.md",
          "--from",
          "Next.js 14",
          "--to",
          "Next.js 16",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_migration_plan_async",
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
          skill: "migration-plan-pack",
          remote: true,
          remoteRun: { id: "run_migration_plan_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_migration_plan_async",
            download: "skills exports download run_migration_plan_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
