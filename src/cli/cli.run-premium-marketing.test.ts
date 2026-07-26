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
          "--yes",
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




  });
});
