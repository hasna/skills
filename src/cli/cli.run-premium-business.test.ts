import { describe, expect, test } from "bun:test";
import { CLI_PATH } from "./cli.test-utils";

describe("CLI run premium business", () => {
  describe("run", () => {
    test("customer-feedback-report submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-customer-feedback-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_customer_feedback_async");
          if (url.pathname === "/api/v1/runs/customer-feedback-report" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--feedback",
              "Users love onboarding but billing is confusing and integrations fail",
              "--product",
              "Skills.md",
              "--channel",
              "tickets",
            ]);
            return Response.json(
              {
                id: "run_customer_feedback_async",
                skill: "customer-feedback-report",
                status: "queued",
                correlationId: "corr_customer_feedback_async",
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
          "customer-feedback-report",
          "--feedback",
          "Users love onboarding but billing is confusing and integrations fail",
          "--product",
          "Skills.md",
          "--channel",
          "tickets",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_customer_feedback_async",
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
          skill: "customer-feedback-report",
          remote: true,
          remoteRun: { id: "run_customer_feedback_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_customer_feedback_async",
            download: "skills exports download run_customer_feedback_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("meeting-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-meeting-pack-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_meeting_pack_async");
          if (url.pathname === "/api/v1/runs/meeting-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--notes",
              "Discussed billing launch, docs, support owners, and webhook smoke tests",
              "--meeting",
              "Billing Launch Sync",
              "--participants",
              "Hasna,Alex,Sam",
            ]);
            return Response.json(
              {
                id: "run_meeting_pack_async",
                skill: "meeting-pack",
                status: "queued",
                correlationId: "corr_meeting_pack_async",
                pricing: {
                  tier: "premium",
                  billingUnit: "run",
                  formattedCost: "$1.50/run",
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
          "meeting-pack",
          "--notes",
          "Discussed billing launch, docs, support owners, and webhook smoke tests",
          "--meeting",
          "Billing Launch Sync",
          "--participants",
          "Hasna,Alex,Sam",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_meeting_pack_async",
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
          skill: "meeting-pack",
          remote: true,
          remoteRun: { id: "run_meeting_pack_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_meeting_pack_async",
            download: "skills exports download run_meeting_pack_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("invoice-reconciliation submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-invoice-reconciliation-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_invoice_reconciliation_async");
          if (url.pathname === "/api/v1/runs/invoice-reconciliation" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--invoices",
              "./invoices.csv",
              "--payments",
              "./payments.csv",
              "--company",
              "Acme Finance",
            ]);
            return Response.json(
              {
                id: "run_invoice_reconciliation_async",
                skill: "invoice-reconciliation",
                status: "queued",
                correlationId: "corr_invoice_reconciliation_async",
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
          "invoice-reconciliation",
          "--invoices",
          "./invoices.csv",
          "--payments",
          "./payments.csv",
          "--company",
          "Acme Finance",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_invoice_reconciliation_async",
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
          skill: "invoice-reconciliation",
          remote: true,
          remoteRun: { id: "run_invoice_reconciliation_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_invoice_reconciliation_async",
            download: "skills exports download run_invoice_reconciliation_async",
          },
        });
        expect(JSON.stringify(data).toLowerCase()).not.toContain("cerebras");
        expect(JSON.stringify(data).toLowerCase()).not.toContain("gpt-oss");
      } finally {
        server.stop(true);
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("contract-review-report submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-contract-review-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_contract_review_async");
          if (url.pathname === "/api/v1/runs/contract-review-report" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--source",
              "./msa.txt",
              "--party",
              "Acme",
              "--counterparty",
              "VendorCo",
            ]);
            return Response.json(
              {
                id: "run_contract_review_async",
                skill: "contract-review-report",
                status: "queued",
                correlationId: "corr_contract_review_async",
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
          "contract-review-report",
          "--source",
          "./msa.txt",
          "--party",
          "Acme",
          "--counterparty",
          "VendorCo",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_contract_review_async",
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
          skill: "contract-review-report",
          remote: true,
          remoteRun: { id: "run_contract_review_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_contract_review_async",
            download: "skills exports download run_contract_review_async",
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
