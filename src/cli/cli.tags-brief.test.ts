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

describe("CLI tags and brief output", () => {
  describe("mcp", () => {
    test("shows help for mcp command", async () => {
      const { stdout } = await runCli(["mcp", "--help"]);
      expect(stdout).toContain("MCP server");
      expect(stdout).toContain("--register");
    });
  });

  describe("tags", () => {
    test("lists tags with counts", async () => {
      const { stdout, exitCode } = await runCli(["tags"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Tags:");
      // "api" is a common tag in the registry
      expect(stdout).toContain("api");
    });

    test("outputs JSON with --json", async () => {
      const { stdout, exitCode } = await runCli(["tags", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Each entry has name and count
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
      expect(typeof data[0].name).toBe("string");
      expect(typeof data[0].count).toBe("number");
      // Should be sorted alphabetically
      for (let i = 1; i < data.length; i++) {
        expect(data[i].name.localeCompare(data[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    test("outputs remote tags with --remote --json", async () => {
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json([
          { name: "remote-one", category: "Remote Tools", tags: ["audio", "remote"] },
          { name: "remote-two", category: "Remote Tools", tags: ["remote"] },
        ]),
      });

      try {
        const { stdout, exitCode } = await runCli(["tags", "--remote", "--json"], {
          SKILLS_API_URL: `http://localhost:${server.port}`,
        });
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual([
          { name: "audio", count: 1 },
          { name: "remote", count: 2 },
        ]);
      } finally {
        server.stop(true);
      }
    });

    test("all tag counts are positive integers", async () => {
      const { stdout } = await runCli(["tags", "--json"]);
      const data = JSON.parse(stdout);
      for (const entry of data) {
        expect(entry.count).toBeGreaterThan(0);
        expect(Number.isInteger(entry.count)).toBe(true);
      }
    });
  });

  describe("list --tags", () => {
    test("filters skills by a single tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "api", "--all"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("api");
      // Should show the filtered header
      expect(stdout).toContain("Skills matching tags");
    });

    test("returns JSON array filtered by tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Every returned skill must have the "api" tag
      for (const s of data) {
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    });

    test("filters by multiple tags (OR logic)", async () => {
      const { stdout: singleOut } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      const { stdout: multiOut } = await runCli(["list", "--tags", "api,testing", "--all", "--json"]);
      const single = JSON.parse(singleOut);
      const multi = JSON.parse(multiOut);
      // Multi-tag OR should return >= results of single tag
      expect(multi.length).toBeGreaterThanOrEqual(single.length);
    });

    test("tag matching is case-insensitive", async () => {
      const { stdout: lower } = await runCli(["list", "--tags", "api", "--all", "--json"]);
      const { stdout: upper } = await runCli(["list", "--tags", "API", "--all", "--json"]);
      const lowerData = JSON.parse(lower);
      const upperData = JSON.parse(upper);
      expect(lowerData.length).toBe(upperData.length);
    });

    test("returns empty for non-existent tag", async () => {
      const { stdout, exitCode } = await runCli(["list", "--tags", "zzzznonexistenttag", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });

    test("works with --category and --tags together", async () => {
      const { stdout, exitCode } = await runCli(["list", "--category", "Development Tools", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const s of data) {
        expect(s.category).toBe("Development Tools");
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    }, SLOW_TEST_TIMEOUT);
  });

  describe("search --tags", () => {
    test("filters search results by tag", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--tags", "api"]);
      expect(exitCode).toBe(0);
      // Either finds matching results or says no results found
      const hasResults = stdout.includes("Found") || stdout.includes("No skills found");
      expect(hasResults).toBe(true);
    });

    test("returns JSON filtered by tag", async () => {
      const { stdout, exitCode } = await runCli(["search", "api", "--tags", "api", "--all", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const s of data) {
        expect(s.tags.map((t: string) => t.toLowerCase())).toContain("api");
      }
    });

    test("tag filter narrows search results", async () => {
      const { stdout: allOut } = await runCli(["search", "api", "--all", "--json"]);
      const { stdout: tagOut } = await runCli(["search", "api", "--tags", "api", "--all", "--json"]);
      const all = JSON.parse(allOut);
      const tagged = JSON.parse(tagOut);
      // Filtered by tag should return <= results of unfiltered
      expect(tagged.length).toBeLessThanOrEqual(all.length);
    }, SLOW_TEST_TIMEOUT);

    test("returns empty for tag with no matches in search results", async () => {
      const { stdout } = await runCli(["search", "zzzznonexistentzzzzz", "--tags", "api", "--json"]);
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    }, SLOW_TEST_TIMEOUT);
  });

  describe("--brief flag", () => {
    test("list --brief outputs one line per skill with name and description on same line", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      // Each line should contain name \u2014 description [category]
      expect(lines.length).toBe(EXPECTED_BASIC_SKILL_COUNT);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief output has fewer lines than default list output", async () => {
      const { stdout: brief } = await runCli(["list", "--brief"]);
      const { stdout: normal } = await runCli(["list"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    }, SLOW_TEST_TIMEOUT);

    test("list --brief with --category shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--category", "Health & Wellness", "--all"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toContain("[Health & Wellness]");
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief with --tags shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--tags", "api", "--all"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("list --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["list", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    }, SLOW_TEST_TIMEOUT);

    test("search image --brief shows compact results", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain(" \u2014 ");
        expect(line).toMatch(/\[.+\]$/);
      }
    }, SLOW_TEST_TIMEOUT);

    test("search --brief output has fewer lines than default search output", async () => {
      const { stdout: brief } = await runCli(["search", "image", "--brief"]);
      const { stdout: normal } = await runCli(["search", "image"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    }, SLOW_TEST_TIMEOUT);

    test("search --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["search", "image", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    });

    test("info image --brief shows single line", async () => {
      const { stdout, exitCode } = await runCli(["info", "image", "--brief"]);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("image");
      expect(lines[0]).toContain(" \u2014 ");
      expect(lines[0]).toContain("[");
      expect(lines[0]).toContain("(tags:");
    });

    test("info --brief output has fewer lines than default info output", async () => {
      const { stdout: brief } = await runCli(["info", "image", "--brief"]);
      const { stdout: normal } = await runCli(["info", "image"]);
      const briefLines = brief.trim().split("\n").filter(Boolean).length;
      const normalLines = normal.trim().split("\n").filter(Boolean).length;
      expect(briefLines).toBeLessThan(normalLines);
    });

    test("info --brief --json uses json (--json wins)", async () => {
      const { stdout, exitCode } = await runCli(["info", "image", "--brief", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.name).toBe("image");
    });
  });

});
