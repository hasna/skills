import { describe, expect, test } from "bun:test";
import { CLI_PATH } from "./cli.test-utils";

describe("CLI run premium media", () => {
  describe("run", () => {
    test("audio-transcript-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-audio-transcript-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_audio_transcript_async");
          if (url.pathname === "/api/v1/runs/audio-transcript-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--source",
              "./episode.mp3",
              "--title",
              "Usage-based billing teardown",
              "--speakers",
              "Host,Guest",
            ]);
            return Response.json(
              {
                id: "run_audio_transcript_async",
                skill: "audio-transcript-pack",
                status: "queued",
                correlationId: "corr_audio_transcript_async",
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
          "audio-transcript-pack",
          "--source",
          "./episode.mp3",
          "--title",
          "Usage-based billing teardown",
          "--speakers",
          "Host,Guest",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_audio_transcript_async",
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
          skill: "audio-transcript-pack",
          remote: true,
          remoteRun: { id: "run_audio_transcript_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_audio_transcript_async",
            download: "skills exports download run_audio_transcript_async",
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

    test("video-highlight-pack submits a premium async remote run", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-video-highlight-async-"));
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          expect(req.headers.get("authorization")).toBe("Bearer sk_video_highlight_async");
          if (url.pathname === "/api/v1/runs/video-highlight-pack" && req.method === "POST") {
            const body = await req.json() as { args?: string[] };
            expect(body.args).toEqual([
              "--source",
              "./webinar.mp4",
              "--title",
              "AI billing launch webinar",
              "--platforms",
              "youtube-shorts,linkedin",
            ]);
            return Response.json(
              {
                id: "run_video_highlight_async",
                skill: "video-highlight-pack",
                status: "queued",
                correlationId: "corr_video_highlight_async",
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
          "video-highlight-pack",
          "--source",
          "./webinar.mp4",
          "--title",
          "AI billing launch webinar",
          "--platforms",
          "youtube-shorts,linkedin",
        ], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: tmpDir,
          env: {
            ...process.env,
            HOME: tmpDir,
            NO_COLOR: "1",
            SKILLS_TEST_MODE: "",
            SKILLS_API_KEY: "sk_video_highlight_async",
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
          skill: "video-highlight-pack",
          remote: true,
          remoteRun: { id: "run_video_highlight_async", status: "queued" },
          nextActions: {
            poll: "skills runs status run_video_highlight_async",
            download: "skills exports download run_video_highlight_async",
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
