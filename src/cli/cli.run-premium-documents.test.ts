import { describe, expect, test } from "bun:test";
import { CLI_PATH } from "./cli.test-utils";

describe("CLI run premium documents", () => {
  describe("run", () => {
    test("slide-deck-generator submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-slide-deck-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_slide_deck_async");
          if (url.pathname === "/api/v1/runs/slide-deck-generator" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--brief",
              "Q2 launch review for AI billing",
              "--title",
              "Q2 Launch Review",
              "--audience",
              "executives",
            ]);
            return Response.json(
              {
                id: "run_slide_deck_async",
                skill: "slide-deck-generator",
                status: "queued",
                correlationId: "corr_slide_deck_async",
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
          "slide-deck-generator",
          "--brief",
          "Q2 launch review for AI billing",
          "--title",
          "Q2 Launch Review",
          "--audience",
          "executives",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_slide_deck_async",
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
          skill: "slide-deck-generator",
          remote: true,
          remoteRun: { id: "run_slide_deck_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_slide_deck_async",
            download: "skills exports download run_slide_deck_async",
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
