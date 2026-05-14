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

describe("CLI run premium marketing", () => {
  describe("run", () => {
    test("security-audit-report submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-security-report-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_security_report_async");
          if (url.pathname === "/api/v1/runs/security-audit-report" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--target",
              "./app",
              "--scope",
              "auth,secrets,headers,webhooks,rls",
            ]);
            return Response.json(
              {
                id: "run_security_report_async",
                skill: "security-audit-report",
                status: "queued",
                correlationId: "corr_security_report_async",
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
          "security-audit-report",
          "--target",
          "./app",
          "--scope",
          "auth,secrets,headers,webhooks,rls",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_security_report_async",
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
          skill: "security-audit-report",
          remote: true,
          remoteRun: { id: "run_security_report_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_security_report_async",
            download: "skills exports download run_security_report_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("seo-content-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-seo-content-pack-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_seo_content_pack_async");
          if (url.pathname === "/api/v1/runs/seo-content-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--topic",
              "usage-based billing for AI SaaS",
              "--brand",
              "Acme",
              "--articles",
              "5",
            ]);
            return Response.json(
              {
                id: "run_seo_content_pack_async",
                skill: "seo-content-pack",
                status: "queued",
                correlationId: "corr_seo_content_pack_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$4.00/run",
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
          "seo-content-pack",
          "--topic",
          "usage-based billing for AI SaaS",
          "--brand",
          "Acme",
          "--articles",
          "5",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_seo_content_pack_async",
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
          skill: "seo-content-pack",
          remote: true,
          remoteRun: { id: "run_seo_content_pack_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_seo_content_pack_async",
            download: "skills exports download run_seo_content_pack_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("landing-page-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-landing-page-pack-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_landing_page_pack_async");
          if (url.pathname === "/api/v1/runs/landing-page-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--product",
              "Usage-based billing for AI SaaS",
              "--audience",
              "founders",
              "--goal",
              "book demos",
            ]);
            return Response.json(
              {
                id: "run_landing_page_pack_async",
                skill: "landing-page-pack",
                status: "queued",
                correlationId: "corr_landing_page_pack_async",
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
          "landing-page-pack",
          "--product",
          "Usage-based billing for AI SaaS",
          "--audience",
          "founders",
          "--goal",
          "book demos",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_landing_page_pack_async",
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
          skill: "landing-page-pack",
          remote: true,
          remoteRun: { id: "run_landing_page_pack_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_landing_page_pack_async",
            download: "skills exports download run_landing_page_pack_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("one-page-website submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-one-page-website-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_one_page_website_async");
          if (url.pathname === "/api/v1/runs/one-page-website" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--brief",
              "Usage-based billing for AI SaaS",
              "--name",
              "MeterKit",
              "--audience",
              "founders",
            ]);
            return Response.json(
              {
                id: "run_one_page_website_async",
                skill: "one-page-website",
                status: "queued",
                correlationId: "corr_one_page_website_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$5.00/run",
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
          "one-page-website",
          "--brief",
          "Usage-based billing for AI SaaS",
          "--name",
          "MeterKit",
          "--audience",
          "founders",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_one_page_website_async",
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
          skill: "one-page-website",
          remote: true,
          remoteRun: { id: "run_one_page_website_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_one_page_website_async",
            download: "skills exports download run_one_page_website_async",
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

    test("ad-creative-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-ad-creative-pack-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_ad_creative_pack_async");
          if (url.pathname === "/api/v1/runs/ad-creative-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--product",
              "Usage-based billing for AI SaaS",
              "--audience",
              "founders",
              "--goal",
              "book demos",
            ]);
            return Response.json(
              {
                id: "run_ad_creative_pack_async",
                skill: "ad-creative-pack",
                status: "queued",
                correlationId: "corr_ad_creative_pack_async",
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
          "ad-creative-pack",
          "--product",
          "Usage-based billing for AI SaaS",
          "--audience",
          "founders",
          "--goal",
          "book demos",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_ad_creative_pack_async",
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
          skill: "ad-creative-pack",
          remote: true,
          remoteRun: { id: "run_ad_creative_pack_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_ad_creative_pack_async",
            download: "skills exports download run_ad_creative_pack_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("email-sequence submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-email-sequence-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_email_sequence_async");
          if (url.pathname === "/api/v1/runs/email-sequence" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--campaign",
              "Usage-based billing for AI SaaS",
              "--audience",
              "founders",
              "--emails",
              "7",
            ]);
            return Response.json(
              {
                id: "run_email_sequence_async",
                skill: "email-sequence",
                status: "queued",
                correlationId: "corr_email_sequence_async",
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
          "email-sequence",
          "--campaign",
          "Usage-based billing for AI SaaS",
          "--audience",
          "founders",
          "--emails",
          "7",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_email_sequence_async",
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
          skill: "email-sequence",
          remote: true,
          remoteRun: { id: "run_email_sequence_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_email_sequence_async",
            download: "skills exports download run_email_sequence_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("social-content-calendar submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-social-content-calendar-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_social_content_calendar_async");
          if (url.pathname === "/api/v1/runs/social-content-calendar" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--campaign",
              "Usage-based billing for AI SaaS",
              "--audience",
              "founders",
              "--days",
              "21",
            ]);
            return Response.json(
              {
                id: "run_social_content_calendar_async",
                skill: "social-content-calendar",
                status: "queued",
                correlationId: "corr_social_content_calendar_async",
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
          "social-content-calendar",
          "--campaign",
          "Usage-based billing for AI SaaS",
          "--audience",
          "founders",
          "--days",
          "21",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_social_content_calendar_async",
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
          skill: "social-content-calendar",
          remote: true,
          remoteRun: { id: "run_social_content_calendar_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_social_content_calendar_async",
            download: "skills exports download run_social_content_calendar_async",
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
