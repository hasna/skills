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

describe("CLI run premium branding", () => {
  describe("run", () => {
    test("create-blog-article submits batch generation as a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-blog-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_blog_async");
          if (url.pathname === "/api/v1/runs/blog-article" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--count",
              "8",
              "--topic",
              "SaaS onboarding",
              "--audience",
              "founders",
              "--tone",
              "technical",
              "--length",
              "long",
              "--seo",
              "--outline",
              "Problem, workflow, rollout",
            ]);
            return Response.json(
              {
                id: "run_blog_async",
                skill: "blog-article",
                status: "queued",
                correlationId: "corr_blog_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "article",
                  formattedCost: "$2.00 total",
                  formattedUnitCost: "$0.25/article",
                  unitCount: 8,
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
          "create-blog-article",
          "--count",
          "8",
          "--topic",
          "SaaS onboarding",
          "--audience",
          "founders",
          "--tone",
          "technical",
          "--length",
          "long",
          "--seo",
          "--outline",
          "Problem, workflow, rollout",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_blog_async",
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
          skill: "blog-article",
          pricing: {
            billingUnit: "article",
            costCents: 200,
            formattedCost: "$2.00 total",
            unitCount: 8,
          },
          remote: true,
          remoteRun: { id: "run_blog_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_blog_async",
            download: "skills exports download run_blog_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("create-blog-article human output shows the total price before remote run details", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-blog-price-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_blog_price");
          if (url.pathname === "/api/v1/runs/blog-article" && req.method === "POST") {
            return Response.json(
              {
                id: "run_blog_price",
                skill: "blog-article",
                status: "queued",
                correlationId: "corr_blog_price",
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
          "create-blog-article",
          "--count",
          "8",
          "--topic",
          "SaaS onboarding",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_blog_price",
            SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Price: $2.00 total");
        expect(stdout.indexOf("Price: $2.00 total")).toBeLessThan(stdout.indexOf("Submitted remote run for blog-article"));
        expect(stdout).toContain("skills exports download run_blog_price");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("brand-kit submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-brand-kit-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_brand_kit_async");
          if (url.pathname === "/api/v1/runs/brand-kit" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--brand",
              "Acme Ledger",
              "--category",
              "developer tools",
              "--audience",
              "founders",
            ]);
            return Response.json(
              {
                id: "run_brand_kit_async",
                skill: "brand-kit",
                status: "queued",
                correlationId: "corr_brand_kit_async",
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
          "brand-kit",
          "--brand",
          "Acme Ledger",
          "--category",
          "developer tools",
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
            SKILLS_API_KEY: "sk_brand_kit_async",
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
          skill: "brand-kit",
          remote: true,
          remoteRun: { id: "run_brand_kit_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_brand_kit_async",
            download: "skills exports download run_brand_kit_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("product-mockup submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-product-mockup-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_product_mockup_async");
          if (url.pathname === "/api/v1/runs/product-mockup" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--product",
              "Usage-based billing dashboard",
              "--audience",
              "founders",
              "--variants",
              "3",
            ]);
            return Response.json(
              {
                id: "run_product_mockup_async",
                skill: "product-mockup",
                status: "queued",
                correlationId: "corr_product_mockup_async",
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
          "product-mockup",
          "--product",
          "Usage-based billing dashboard",
          "--audience",
          "founders",
          "--variants",
          "3",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_product_mockup_async",
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
          skill: "product-mockup",
          remote: true,
          remoteRun: { id: "run_product_mockup_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_product_mockup_async",
            download: "skills exports download run_product_mockup_async",
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

    test("proposal-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-proposal-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_test_proposal_async");
          if (url.pathname === "/api/v1/runs/proposal-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--client",
              "Acme",
              "--project",
              "AI onboarding workflow",
              "--timeline",
              "6 weeks",
            ]);
            return Response.json(
              {
                id: "run_proposal_async",
                skill: "proposal-pack",
                status: "queued",
                correlationId: "corr_proposal_async",
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
          "proposal-pack",
          "--client",
          "Acme",
          "--project",
          "AI onboarding workflow",
          "--timeline",
          "6 weeks",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_test_proposal_async",
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
          skill: "proposal-pack",
          remote: true,
          remoteRun: { id: "run_proposal_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_proposal_async",
            download: "skills exports download run_proposal_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("pitch-deck submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-pitch-deck-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_pitch_deck_async");
          if (url.pathname === "/api/v1/runs/pitch-deck" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--brief",
              "Usage-based billing platform for AI SaaS",
              "--company",
              "Acme",
              "--slides",
              "12",
            ]);
            return Response.json(
              {
                id: "run_pitch_deck_async",
                skill: "pitch-deck",
                status: "queued",
                correlationId: "corr_pitch_deck_async",
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
          "pitch-deck",
          "--brief",
          "Usage-based billing platform for AI SaaS",
          "--company",
          "Acme",
          "--slides",
          "12",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_pitch_deck_async",
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
          skill: "pitch-deck",
          remote: true,
          remoteRun: { id: "run_pitch_deck_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_pitch_deck_async",
            download: "skills exports download run_pitch_deck_async",
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
