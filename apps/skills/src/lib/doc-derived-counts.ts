/**
 * doc-derived-counts.ts — the one place that re-derives the counts our docs assert.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN ONE TEST
 *
 * CLAUDE.md rotted once (it claimed 202 skills against a real 229) and grew the
 * guard in `claude-md.test.ts`. README.md then rotted the SAME number in the same
 * direction and nobody noticed for weeks, because the guard was scoped to a single
 * hard-coded path: `202+` sat in README while the guarded table two files away read
 * 85. One document was fixed and its neighbour was left asserting the old figure.
 *
 * A guard that covers one of the two places a number is written is not a guard on
 * the number; it is a guard on a file. So the derivation and the table parser live
 * here, and every document that asserts these counts is checked by the same code.
 * Adding a third document is a two-line test, which is the point — the cheap path
 * has to be the correct one or the next document will hand-copy the numbers again.
 */

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import pkg from "../../package.json" with { type: "json" };
import { buildServer } from "../mcp/server.js";
import { SKILLS } from "./registry.js";
import { CATEGORIES } from "./registry-types.js";

/**
 * The heading every guarded table sits under. Fixed rather than per-document so a
 * document cannot opt out of the guard by renaming its own section.
 */
export const TABLE_HEADING = "### Derived counts";

/**
 * Parse the `### Derived counts` table in `docPath` into {label -> value}.
 *
 * Scoped to the section rather than the whole file so an unrelated markdown table
 * elsewhere in the document cannot inject rows. Throws rather than returning empty
 * when the section is missing: an empty map would make every assertion pass or fail
 * for the wrong reason.
 *
 * The three tolerances below are not incidental — each one is a way this guard
 * could have failed for a reason that has nothing to do with doc drift, and a doc
 * test that cries wolf is a doc test that gets deleted:
 *
 *   - Up to three leading spaces before `|`. GFM permits them, so an editor that
 *     indents the table would otherwise yield zero rows and a diff that looks like
 *     catastrophic drift.
 *   - A delimiter row of ANY dash count, with or without alignment colons. `|-|-|-|`
 *     is legal GFM; an earlier `-{2,}` test let it through as a data row named "-".
 *   - The header is dropped BY POSITION (first row), not by matching the literal
 *     "Count". Renaming that cell to "Metric" must not break the guard.
 */
export function readDocumentedCounts(docPath: string): Record<string, string> {
  const text = readFileSync(docPath, "utf8");
  const start = text.indexOf(TABLE_HEADING);
  if (start === -1) {
    throw new Error(
      `${docPath} has no "${TABLE_HEADING}" section. It is the table this guard re-derives; ` +
        "restore it rather than deleting the guard.",
    );
  }
  // Stop at the next heading of any level so the table cannot swallow later sections.
  const section = text.slice(start + TABLE_HEADING.length).split(/\n#{1,6} /)[0];

  const rows: Array<[string, string]> = [];
  for (const line of section.split("\n")) {
    if (/^ {0,3}\|[\s:|-]*$/.test(line)) continue; // delimiter row, any dash count
    const cells = line.match(/^ {0,3}\|([^|]*)\|([^|]*)\|/);
    if (!cells) continue;
    const label = cells[1].trim();
    if (!label) continue;
    rows.push([label, cells[2].trim()]);
  }

  return Object.fromEntries(rows.slice(1)); // drop the header row by position
}

/**
 * Ask the live MCP server what it registered, over the SDK's own client API.
 *
 * Deliberately not a grep for `registerTool(` and not a read of the private
 * `_registeredTools` field: the first misses the five tools registered through the
 * older positional `server.tool()` form in resource-meta-tools.ts, and the second
 * breaks silently on an SDK upgrade. `tools/list` is what an agent actually sees,
 * which is what the docs are describing.
 */
async function liveMcpSurface(): Promise<{ tools: number; resources: number }> {
  // Caveat, stated so a future failure is diagnosable: this is the one assertion
  // sensitive to something outside the repo. An @modelcontextprotocol/sdk bump that
  // registers a built-in tool or resource moves these numbers with no source change
  // here, and the diff will not say so.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "doc-counts-guard", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    // Static resources and resource templates are two MCP list endpoints but one
    // user-visible concept, and the docs describe them as one number.
    return {
      tools: tools.tools.length,
      resources: resources.resources.length + templates.resourceTemplates.length,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

export async function deriveCounts(): Promise<Record<string, string>> {
  const mcp = await liveMcpSurface();
  return {
    "Catalog skills": String(SKILLS.length),
    "Instruction-kind skills": String(SKILLS.filter((skill) => skill.kind === "instruction").length),
    Categories: String(CATEGORIES.length),
    "MCP tools": String(mcp.tools),
    "MCP resources": String(mcp.resources),
    "Published bins": String(Object.keys(pkg.bin).length),
    "bun build invocations": String((pkg.scripts.build.match(/bun build /g) ?? []).length),
  };
}

/**
 * Narrow the derived set to the rows a given document actually publishes.
 *
 * README and CLAUDE.md have different audiences and deliberately carry different
 * subsets — forcing every document to restate all seven rows would mean every skill
 * PR edits every document, which is the tax that gets a guard deleted.
 *
 * Throws on a key the derivation does not produce. Without that, a typo in a
 * document's expected-key list would silently shrink the comparison to the rows that
 * happened to match, and the guard would pass while checking less than it claims.
 */
export function selectCounts(
  derived: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const unknown = keys.filter((key) => !(key in derived));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown derived-count key(s): ${unknown.join(", ")}. ` +
        `Known keys: ${Object.keys(derived).join(", ")}.`,
    );
  }
  return Object.fromEntries(keys.map((key) => [key, derived[key]]));
}
