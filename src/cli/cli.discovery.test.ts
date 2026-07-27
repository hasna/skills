import { describe, expect, test } from "bun:test";
import {
  CLI_PATH,
  CLEAN_CLI_HOME,
  EXPECTED_ALL_SKILL_COUNT,
  EXPECTED_BASIC_SKILL_COUNT,
  PACKAGE_VERSION,
  SLOW_TEST_TIMEOUT,
  runCli,
  runCliInCwd,
} from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

describe("CLI discovery", () => {
  describe("help", () => {
    test("outputs compact JSON skills list in non-TTY mode (no arguments)", async () => {
      const { stdout } = await runCli([]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("category");
      expect(data[0]).not.toHaveProperty("pricing");
      // Compact mode carries a short description so agents can discover without
      // a per-skill lookup, but still omits tags to keep tokens low.
      expect(data[0]).toHaveProperty("description");
      expect(typeof data[0].description).toBe("string");
      expect(data[0].description.length).toBeGreaterThan(0);
      expect(data[0]).not.toHaveProperty("tags");
    });

    test("shows help with --help", async () => {
      const { stdout } = await runCli(["--help"]);
      expect(stdout).toContain("Discover and run AI agent skills");
      expect(stdout).toContain("events");
      expect(stdout).toContain("webhooks");
    });

    test("shows version with --version", async () => {
      const { stdout } = await runCli(["--version"]);
      expect(stdout.trim()).toBe(PACKAGE_VERSION);
    });
  });

  describe("config --json", () => {
    test("shows, sets, gets, and reports paths as JSON", async () => {
      const { mkdtempSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-config-json-"));
      try {
        const empty = await runCliInCwd(["config", "show", "--json"], tmpDir, { HOME: tmpDir });
        expect(empty.exitCode).toBe(0);
        expect(JSON.parse(empty.stdout)).toEqual({});

        const set = await runCliInCwd(["config", "set", "apiUrl", "https://example.com/api/v1/", "--json"], tmpDir, { HOME: tmpDir });
        expect(set.exitCode).toBe(0);
        const setData = JSON.parse(set.stdout);
        expect(setData).toMatchObject({ key: "apiUrl", value: "https://example.com/api/v1", scope: "project" });

        const get = await runCliInCwd(["config", "get", "apiUrl", "--json"], tmpDir, { HOME: tmpDir });
        expect(JSON.parse(get.stdout)).toMatchObject({ key: "apiUrl", value: "https://example.com/api/v1", set: true });

        const paths = await runCliInCwd(["config", "path", "--json"], tmpDir, { HOME: tmpDir });
        const pathData = JSON.parse(paths.stdout);
        expect(pathData.project.exists).toBe(true);
        expect(pathData.global.exists).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("registry sync", () => {
    test("outputs a registry sync artifact as JSON", async () => {
      const { stdout, exitCode } = await runCli([
        "registry",
        "sync",
        "--profile",
        "basic",
        "--no-docs",
        "--no-requirements",
        "--no-validation",
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(data.schemaVersion).toBe(1);
      expect(data.source).toMatchObject({ packageName: "@hasna/skills", profile: "basic" });
      expect(data.summary.skillCount).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(data.skills).toHaveLength(EXPECTED_BASIC_SKILL_COUNT);
      expect(data.skills[0]).not.toHaveProperty("docs");
      expect(data.skills[0]).not.toHaveProperty("requirements");
      expect(data.skills[0]).not.toHaveProperty("validation");
    });

    test("writes a registry sync artifact to --output", async () => {
      const { mkdtempSync, readFileSync, rmSync } = require("fs");
      const { tmpdir } = require("os");
      const tmpDir = mkdtempSync(require("path").join(tmpdir(), "cli-registry-sync-"));
      const output = require("path").join(tmpDir, "registry", "skills.json");
      try {
        const { stdout, exitCode } = await runCliInCwd([
          "registry",
          "sync",
          "--profile",
          "basic",
          "--no-docs",
          "--no-requirements",
          "--no-validation",
          "--output",
          output,
        ], tmpDir);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Registry sync artifact written");
        const data = JSON.parse(readFileSync(output, "utf8"));
        expect(data.summary.skillCount).toBe(EXPECTED_BASIC_SKILL_COUNT);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("flushes complete registry sync JSON through a shell pipe", async () => {
      const parser = [
        'let s="";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data",(chunk)=>s+=chunk);',
        'process.stdin.on("end",()=>{const data=JSON.parse(s);console.log(JSON.stringify({length:s.length,count:data.skills.length}));});',
      ].join("");
      const command = `bun run ${shellQuote(CLI_PATH)} -- registry sync --profile all --json | node -e ${shellQuote(parser)}`;
      // `-c`, not `-lc`. The property under test is "a pipe does not truncate the
      // CLI's stdout", which no login shell is needed to express, and `-l` sources
      // /etc/profile — measured at ~220ms per spawn on the reference machine, and,
      // worse, anything that profile writes to stderr lands inside the
      // `expect(stderr).toBe("")` below. That makes the assertion a property of
      // whichever machine runs it. PATH is inherited from the parent either way.
      const proc = Bun.spawn(["bash", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: CLEAN_CLI_HOME, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(65_536);
      expect(data.count).toBe(EXPECTED_ALL_SKILL_COUNT);
    }, SLOW_TEST_TIMEOUT);

    test("rejects unknown registry profiles", async () => {
      const { stdout, exitCode } = await runCli([
        "registry",
        "sync",
        "--profile",
        "unknown",
        "--json",
      ]);
      expect(exitCode).not.toBe(0);
      expect(JSON.parse(stdout).error).toContain("Unknown registry profile");
    });
  });

  describe("categories", () => {
    test("lists categories", async () => {
      const { stdout } = await runCli(["categories"]);
      expect(stdout).toContain("Development Tools");
      expect(stdout).toContain("Business & Marketing");
      expect(stdout).toContain("Health & Wellness");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["categories", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(17);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
    });

    test("outputs remote categories with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json([
          { name: "remote-one", category: "Remote Tools", tags: ["remote"] },
          { name: "remote-two", category: "Remote Tools", tags: ["remote"] },
        ]),
      });

      try {
        const { stdout, exitCode } = await runCli(["categories", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        expect(exitCode).toBe(0);
        // Merged: the instance's categories appear ALONGSIDE the bundled ones rather than
        // replacing them. Asserting the exact list would just re-encode the whole bundled
        // taxonomy into this test, so it asserts the property that changed.
        const data = JSON.parse(stdout);
        expect(data).toContainEqual({ name: "Remote Tools", count: 2 });
        expect(data.map((entry: any) => entry.name)).toContain("Development Tools");
        expect(data.length).toBeGreaterThan(1);
      } finally {
        server.stop(true);
      }
    });
  });

  describe("list", () => {
    test("lists default basic skills", async () => {
      const { stdout } = await runCli(["list"]);
      expect(stdout).toContain(`Available default skills (${EXPECTED_BASIC_SKILL_COUNT})`);
      expect(stdout).toContain("pdf-to-markdown");
      expect(stdout).toContain("Free");
      expect(stdout).not.toContain("workout-cycle-planner");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("gemini");
      expect(stdout.toLowerCase()).not.toContain("minimax");
    });

    test("lists all skills with --all", async () => {
      const { stdout } = await runCli(["list", "--all"]);
      expect(stdout).toContain(`Available skills (showing 30 of ${EXPECTED_ALL_SKILL_COUNT}, cursor 0)`);
      expect(stdout).toContain("Next: skills list --all --cursor 30 --limit 30");
      expect(stdout).toContain("Details: skills show <name>");
      expect(stdout).not.toContain("workout-cycle-planner");
    });

    test("lists all human rows when explicitly requested", async () => {
      const { stdout } = await runCli(["list", "--all", "--limit", "all"]);
      expect(stdout).toContain(`Available skills (${EXPECTED_ALL_SKILL_COUNT})`);
      expect(stdout).toContain("Health & Wellness");
      expect(stdout).toContain("workout-cycle-planner");
    }, SLOW_TEST_TIMEOUT);

    test("verbose human list discloses extra fields without removing pagination", async () => {
      const { stdout } = await runCli(["list", "--all", "--limit", "1", "--verbose"]);
      expect(stdout).toContain("Available skills (showing 1 of");
      expect(stdout).toContain("tags:");
      expect(stdout).toContain("Next: skills list --all --cursor 1 --limit 1");
    });

    test("lists by category", async () => {
      const { stdout } = await runCli(["list", "--category", "Data & Analysis"]);
      expect(stdout).toContain("Data & Analysis (5)");
      expect(stdout).toContain("read-csv");
    });

    test("lists full-registry categories with --all", async () => {
      const { stdout } = await runCli(["list", "--category", "Health & Wellness", "--all"]);
      expect(stdout).toContain("Health & Wellness (8)");
      expect(stdout).toContain("workout-cycle-planner");
    });

    test("fails for invalid category", async () => {
      const { stderr, exitCode } = await runCli(["list", "--category", "Fake Category"]);
      expect(stderr).toContain("Unknown category");
      expect(exitCode).not.toBe(0);
    });

    test("outputs one name per line with --format compact", async () => {
      const { stdout, exitCode } = await runCli(["list", "--format", "compact"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      expect(lines).toContain("pdf-to-markdown");
    });

    test("rejects an unknown --format value instead of silently falling back", async () => {
      const { stdout, stderr, exitCode } = await runCli(["list", "--format", "bogusfmt"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Unknown --format value: bogusfmt");
      expect(stderr).toContain("compact, csv");
      expect(stdout).not.toContain("Available default skills");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["list", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      const image = data.find((skill: any) => skill.name === "pdf-to-markdown");
      expect(image).not.toHaveProperty("pricing");
    });

    test("lists remote registry with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          expect(new URL(req.url).pathname).toBe("/api/v1/skills");
          return Response.json({
            skills: [
              {
                name: "market-research-report",
                displayName: "Market Research Report",
                description: "Hosted market research",
                category: "Research & Writing",
                tags: ["research"],
                availability: {
                  status: "unavailable",
                  code: "HOSTED_PROVIDER_UNAVAILABLE",
                  details: ["Hosted provider is temporarily unavailable."],
                },
              },
              {
                name: "logo-design",
                displayName: "Logo Design",
                description: "Hosted logo design",
                category: "Design & Branding",
                tags: ["logo"],
                availability: { status: "available" },
              },
            ],
          });
        },
      });

      try {
        const { stdout, exitCode } = await runCli(["list", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        // MERGED, not replaced. `--remote` used to return exactly what the instance
        // served, so pointing the CLI at your own server made the bundled corpus and
        // every locally written skill vanish from the listing. Both halves are present
        // now, resolved by the precedence rule in src/lib/registry-merge.ts.
        const names = data.map((skill: any) => skill.name);
        expect(names).toContain("market-research-report");
        expect(names).toContain("logo-design");
        expect(names).toContain("pdf-to-markdown");
        expect(data.length).toBeGreaterThan(2);
        const image = data.find((skill: any) => skill.name === "market-research-report");
        const logo = data.find((skill: any) => skill.name === "logo-design");
        expect(image).toMatchObject({
          source: "remote",
          availability: {
            status: "unavailable",
            code: "HOSTED_PROVIDER_UNAVAILABLE",
          },
        });
        expect(image.availability.details).toContain("Hosted provider is temporarily unavailable.");
        expect(logo).toMatchObject({
          source: "remote",
          availability: { status: "available" },
        });
      } finally {
        server.stop(true);
      }
    });

    test("outputs full JSON with --all --json", async () => {
      const { stdout } = await runCli(["list", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(EXPECTED_ALL_SKILL_COUNT);
    });

    test("outputs complete full JSON when stdout is piped repeatedly", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { stdout, exitCode } = await runCli(["list", "--all", "--json"]);
        expect(exitCode).toBe(0);
        expect(stdout.length).toBeGreaterThan(65_536);
        const data = JSON.parse(stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(EXPECTED_ALL_SKILL_COUNT);
      }
    });

    test("flushes complete full JSON through a shell pipe", async () => {
      const parser = [
        'let s="";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data",(chunk)=>s+=chunk);',
        'process.stdin.on("end",()=>{const data=JSON.parse(s);console.log(JSON.stringify({length:s.length,count:data.length}));});',
      ].join("");
      const command = `bun run ${shellQuote(CLI_PATH)} -- list --all --json | node -e ${shellQuote(parser)}`;
      // `-c` rather than `-lc`, for the reason given on the registry-sync pipe above.
      const proc = Bun.spawn(["bash", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: CLEAN_CLI_HOME, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(65_536);
      expect(data.count).toBe(EXPECTED_ALL_SKILL_COUNT);
    }, SLOW_TEST_TIMEOUT);

    test("lists by category with --json", async () => {
      const { stdout } = await runCli(["list", "--category", "Event Management", "--all", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(4);
      for (const skill of data) {
        expect(skill.category).toBe("Event Management");
      }
    });
  });

  describe("search", () => {
    test("finds skills", async () => {
      const { stdout } = await runCli(["search", "pdf"]);
      expect(stdout).toContain("Found");
      expect(stdout).toContain("skill(s)");
      expect(stdout).toContain("(Free)");
      expect(stdout).toContain("Details: skills show <name>");
      expect(stdout).toContain("Free");
    });

    test("shows message for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz"]);
      expect(stdout).toContain("No skills found");
    });

    test("rejects an unknown --format value instead of silently falling back", async () => {
      const { stdout, stderr, exitCode } = await runCli(["search", "pdf", "--format", "bogusfmt"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Unknown --format value: bogusfmt");
      expect(stdout).not.toContain("Found");
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["search", "pdf", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).not.toHaveProperty("pricing");
    });

    test("searches remote registry with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json([
          {
            name: "remote-transcribe",
            displayName: "Remote Transcribe",
            description: "Transcribe audio on the hosted platform",
            category: "Remote Tools",
            tags: ["audio", "remote"],
          },
        ]),
      });

      try {
        const { stdout, exitCode } = await runCli(["search", "transcribe", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        const data = JSON.parse(stdout);
        expect(exitCode).toBe(0);
        expect(data).toHaveLength(1);
        expect(data[0].name).toBe("remote-transcribe");
      } finally {
        server.stop(true);
      }
    });

    test("JSON output is empty array for no results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--json"]);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });
  });

  describe("info", () => {
    test("shows skill info", async () => {
      const { stdout } = await runCli(["info", "pdf-to-markdown"]);
      expect(stdout).toContain("PDF to Markdown");
      expect(stdout).toContain("Data & Analysis");
      expect(stdout).not.toContain("Pricing:");
      expect(stdout.toLowerCase()).not.toContain("exa");
      expect(stdout.toLowerCase()).not.toContain("openai");
      expect(stdout.toLowerCase()).not.toContain("claude");
    });

    test("fails for nonexistent skill", async () => {
      const { stderr, exitCode } = await runCli(["info", "nonexistent-xyz"]);
      expect(stderr).toContain("not found");
      expect(exitCode).not.toBe(0);
    });

    test("outputs JSON with --json", async () => {
      const { stdout } = await runCli(["info", "pdf-to-markdown", "--json"]);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("pdf-to-markdown");
      expect(data.displayName).toBe("PDF to Markdown");
      expect(data.category).toBe("Data & Analysis");
      expect(Array.isArray(data.tags)).toBe(true);
      expect(data).not.toHaveProperty("pricing");
      expect(JSON.stringify(data).toLowerCase()).not.toContain("exa");
      expect(JSON.stringify(data).toLowerCase()).not.toContain("openai");
      expect(JSON.stringify(data).toLowerCase()).not.toContain("claude");
    });

    test("shows remote skill info with auth and drops server pricing", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          const url = new URL(req.url);
          expect(url.pathname).toBe("/api/v1/skills/remote-demo");
          expect(req.headers.get("authorization")).toBe("Bearer fixture-info");
          return Response.json({
            slug: "remote-demo",
            displayName: "Remote Demo",
            description: "Demo from remote registry",
            category: "Remote Tools",
            tags: ["remote", "demo"],
            version: "0.2.0",
            pricing: {
              tier: "free",
              formattedCost: "$0.75/run",
            },
          });
        },
      });

      try {
        const { stdout, exitCode } = await runCli(["info", "remote-demo", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}/api/v1`,
          SKILLS_API_KEY: "fixture-info",
        });
        expect(exitCode).toBe(0);
        expect(stdout.trim().length).toBeGreaterThan(0);
        const data = JSON.parse(stdout);
        expect(data).toMatchObject({
          name: "remote-demo",
          displayName: "Remote Demo",
          category: "Remote Tools",
          source: "remote",
          version: "0.2.0",
        });
        expect(data).not.toHaveProperty("pricing");
      } finally {
        server.stop(true);
      }
    });
  });

});
