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
 *
 * ON `Catalog skills`, WHICH IS THE CONTENTIOUS ROW. It is the highest-churn
 * number in the table — recent history is -19, then 19 kind flips, then 11
 * conversions — so every skill PR must now edit one line of CLAUDE.md, and two
 * concurrent skill PRs conflict on that line. That cost is accepted on purpose:
 * this is the exact number that rotted (the file claimed 202 against a real 229)
 * and the one an agent is most likely to act on. A one-line conflict is a
 * trivial resolution; a doc that lies about the size of the catalog is not.
 *
 * If that cost ever does become intolerable, DELETE THE ROW from both the table
 * and this file. Do not weaken it to a range or a `toBeGreaterThan` — a loosened
 * assertion still looks green while it has stopped checking the thing it exists
 * for, which is strictly worse than an honest absence.
 *
 * WHERE THE MACHINERY WENT, AND WHY
 *
 * The parser and the derivation now live in `doc-derived-counts.ts`, because this
 * guard being scoped to one hard-coded path was itself a defect: README.md carried
 * `202+` — the very number named above as the thing that rotted — for weeks after
 * this table was corrected to 85. The number was guarded in one file and hand-copied
 * into another. `readme-derived-counts.test.ts` is the sibling that closes it, and
 * it shares this file's code so a third document costs two lines rather than a
 * duplicated parser that can drift on its own.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { deriveCounts, readDocumentedCounts } from "./doc-derived-counts.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const CLAUDE_MD_PATH = join(import.meta.dir, "..", "..", "CLAUDE.md");

describe("CLAUDE.md derived counts", () => {
  test("every guarded count matches the tree it describes", async () => {
    const derived = await deriveCounts();
    const documented = readDocumentedCounts(CLAUDE_MD_PATH);

    // One comparison rather than a loop: a whole-object diff names the drifted
    // row and prints documented-vs-derived side by side, which is what makes
    // this a ten-second fix instead of a puzzle. Missing and surplus rows fail
    // here too, so the guard cannot quietly stop checking anything.
    expect(documented).toEqual(derived);
  });

  test("the parser reads one row per guarded count", async () => {
    // Anti-vacuity, bound to the derived set rather than a magic number: if the
    // parser silently stops matching rows — table reformatted, stray pipe,
    // heading renamed — the comparison above would still run, but against
    // nothing worth checking. Deriving the expected size here means legitimately
    // removing a row cannot leave this test failing on an unexplained constant.
    const expected = Object.keys(await deriveCounts()).length;
    expect(Object.keys(readDocumentedCounts(CLAUDE_MD_PATH)).length).toBe(expected);
  });
});
