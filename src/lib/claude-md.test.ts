/**
 * claude-md.test.ts — keeps the load-bearing counts in CLAUDE.md honest.
 *
 * WHY THIS EXISTS
 *
 * CLAUDE.md rotted badly once already: it claimed 202 skills, 9 MCP tools, 2 MCP
 * resources, a `dashboard/` directory that does not exist, and that the HTTP
 * server "is not shipped in OSS" while `src/server/` was shipping three of the
 * five bins. Every one of those was a number or a structural fact that nobody
 * ever re-derived. A document that asserts a count and has no way to notice the
 * count changed will drift, and drifted guidance is worse than none — an agent
 * reading it confidently does the wrong thing.
 *
 * WHY IT IS SHAPED LIKE THIS, AND NOT STRICTER
 *
 * A doc test that fails on prose edits becomes noise and gets deleted, which is
 * worse than no test. So this deliberately does NOT check prose, headings, file
 * lists, or wording. It checks exactly one thing: a single fixed table under
 * `### Derived counts`, whose row labels are a closed set and whose values are
 * re-derived from the tree on every run.
 *
 * The consequences of that choice, stated rather than assumed:
 *
 *   - Rewording any sentence in CLAUDE.md cannot fail this test.
 *   - Adding a skill, an MCP tool, a bin, or a build step DOES fail it, with a
 *     diff naming the row and both numbers. That is the point: those are the
 *     changes that silently invalidated the old file.
 *   - Deleting a row fails (key-set mismatch), so the test cannot go vacuous by
 *     losing the thing it checks. Adding an undocumented row fails too, so a
 *     stale row cannot linger unchecked.
 *
 * Counts deliberately NOT guarded: the number of test files, of `src/lib`
 * modules, or of CLI subcommands. Those change often enough that guarding them
 * would tax nearly every PR with a doc edit, and none of them is a claim an
 * agent acts on. The rule of thumb is: guard a number only if it is expensive
 * to be wrong about and cheap to keep right.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import pkg from "../../package.json" with { type: "json" };
import { buildServer } from "../mcp/server.js";
import { SKILLS } from "./registry.js";
import { CATEGORIES } from "./registry-types.js";

const CLAUDE_MD_PATH = join(import.meta.dir, "..", "..", "CLAUDE.md");
const TABLE_HEADING = "### Derived counts";
const HEADER_LABEL = "Count";

/**
 * Parse the `### Derived counts` table into {label -> value}.
 *
 * Scoped to the section rather than the whole file so an unrelated markdown
 * table elsewhere in CLAUDE.md cannot inject rows. Throws rather than returning
 * empty when the section is missing: an empty map would make every assertion
 * below pass or fail for the wrong reason.
 */
function readDocumentedCounts(): Record<string, string> {
  const text = readFileSync(CLAUDE_MD_PATH, "utf8");
  const start = text.indexOf(TABLE_HEADING);
  if (start === -1) {
    throw new Error(
      `CLAUDE.md has no "${TABLE_HEADING}" section. It is the table this test re-derives; ` +
        "restore it rather than deleting the guard.",
    );
  }
  // Stop at the next heading of any level so the table cannot swallow later sections.
  const section = text.slice(start + TABLE_HEADING.length).split(/\n#{1,6} /)[0];

  const counts: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const cells = line.match(/^\|([^|]*)\|([^|]*)\|/);
    if (!cells) continue;
    const label = cells[1].trim();
    const value = cells[2].trim();
    if (!label || /^:?-{2,}/.test(label) || label === HEADER_LABEL) continue;
    counts[label] = value;
  }
  return counts;
}

/**
 * Ask the live MCP server what it registered, over the SDK's own client API.
 *
 * Deliberately not a grep for `registerTool(` and not a read of the private
 * `_registeredTools` field: the first misses the five tools registered through
 * the older positional `server.tool()` form in resource-meta-tools.ts, and the
 * second breaks silently on an SDK upgrade. `tools/list` is what an agent
 * actually sees, which is what CLAUDE.md is describing.
 */
async function liveMcpSurface(): Promise<{ tools: number; resources: number }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "claude-md-guard", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    // Static resources and resource templates are two MCP list endpoints but one
    // user-visible concept, and CLAUDE.md documents them as one number.
    return {
      tools: tools.tools.length,
      resources: resources.resources.length + templates.resourceTemplates.length,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("CLAUDE.md derived counts", () => {
  test("every guarded count matches the tree it describes", async () => {
    const mcp = await liveMcpSurface();

    const derived: Record<string, string> = {
      "Catalog skills": String(SKILLS.length),
      "Instruction-kind skills": String(SKILLS.filter((skill) => skill.kind === "instruction").length),
      Categories: String(CATEGORIES.length),
      "MCP tools": String(mcp.tools),
      "MCP resources": String(mcp.resources),
      "Published bins": String(Object.keys(pkg.bin).length),
      "bun build invocations": String((pkg.scripts.build.match(/bun build /g) ?? []).length),
    };

    const documented = readDocumentedCounts();

    // One comparison rather than a loop: a whole-object diff names the drifted
    // row and prints documented-vs-derived side by side, which is what makes
    // this a ten-second fix instead of a puzzle. Missing and surplus rows fail
    // here too, so the guard cannot quietly stop checking anything.
    expect(documented).toEqual(derived);
  });

  test("the guarded table is not empty", () => {
    // Anti-vacuity. If the parser silently stops matching rows — a table
    // reformatted, a stray pipe, a heading renamed — every value comparison
    // above would still run, but against nothing worth checking.
    expect(Object.keys(readDocumentedCounts()).length).toBeGreaterThanOrEqual(7);
  });
});
