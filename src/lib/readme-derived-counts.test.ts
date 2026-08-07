/**
 * readme-derived-counts.test.ts — keeps the counts README.md asserts honest.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM claude-md.test.ts
 *
 * README.md claimed `202+` skills twice, and `~20 tools`, against a real 85 and 37.
 * That is a 2.38x overstatement of the catalogue on the repository's front page —
 * the most-read surface this org publishes, and one linked from hasna.com. It was
 * honest when written (the published 0.1.60 tarball bundled 248) and was falsified
 * three days later by one commit that cut the catalogue, `8250b893`.
 *
 * The instructive part is not that a number rotted. It is that `claude-md.test.ts`
 * ALREADY derived the correct figure and had already corrected CLAUDE.md to 85 —
 * while README, two files away, kept asserting 202+. The guard was pointed at a
 * PATH, so it protected a file rather than a claim, and the same number rotted
 * again in the document with more readers. A guard scoped to one of the two places
 * a fact is written does not cover the fact.
 *
 * WHY README CARRIES A SUBSET, NOT ALL SEVEN ROWS
 *
 * `claude-md.test.ts` accepts a real cost on purpose: every skill PR edits one line
 * of CLAUDE.md, and two concurrent skill PRs conflict on it. Making README restate
 * all seven rows would double that tax on every PR for rows no README reader acts
 * on — `bun build invocations` is not front-page material — and a guard that taxes
 * every PR is a guard someone deletes.
 *
 * So README publishes exactly the rows it asserts to a reader, and this test pins
 * that set. The set is closed in both directions: a row added to the README table
 * without being added here fails, and a row dropped from either side fails. It
 * cannot go vacuous by quietly checking fewer things than it claims.
 *
 * WHAT THIS DOES NOT CHECK, DELIBERATELY
 *
 * Prose, headings, and the project-structure tree. Those are guarded for content by
 * `readme-remote-premium.test.ts` and would make this test fail on wording edits,
 * which is how a doc test becomes noise. The numbers that used to sit inline in the
 * structure tree were removed rather than guarded in place, because a number inside
 * an ASCII-art comment cannot be parsed reliably and a guard that parses prose
 * fails for reasons that have nothing to do with drift.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  TABLE_HEADING,
  deriveCounts,
  readDocumentedCounts,
  selectCounts,
} from "./doc-derived-counts.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const README_PATH = join(import.meta.dir, "..", "..", "README.md");

/**
 * The rows README publishes. Reader-facing only: how big the catalogue is, how it
 * is organised, and how much MCP surface an agent gets. Each one replaces a figure
 * that was previously hand-written into the README and had drifted.
 *
 * Adding a row here is cheap and safe. Adding one to the README table without
 * adding it here fails the key-set comparison below, which is the intended
 * direction — an unguarded number must not be able to appear in this document.
 */
const README_ROWS = ["Catalog skills", "Categories", "MCP tools"] as const;

describe("README.md derived counts", () => {
  test("every published count matches the tree it describes", async () => {
    const derived = selectCounts(await deriveCounts(), README_ROWS);
    const documented = readDocumentedCounts(README_PATH);

    // One comparison rather than a loop: a whole-object diff names the drifted row
    // and prints documented-vs-derived side by side, which is what makes this a
    // ten-second fix instead of a puzzle. Missing and surplus rows fail here too.
    expect(documented).toEqual(derived);
  });

  test("the parser reads one row per published count", async () => {
    // Anti-vacuity. If the parser silently stops matching rows — table reformatted,
    // stray pipe, heading renamed — the comparison above would still run, but
    // against nothing worth checking. Bound to README_ROWS rather than a magic
    // number so legitimately changing the published set cannot leave this test
    // failing on an unexplained constant.
    expect(Object.keys(readDocumentedCounts(README_PATH)).length).toBe(README_ROWS.length);
  });

  test("no count is hand-written outside the guarded table", async () => {
    // The actual failure mode this file exists for, guarded directly rather than
    // trusted: the number was correct in a guarded table and simultaneously wrong
    // in prose a few hundred lines away. Checking the table alone would have passed
    // in exactly that state, which is how `202+` survived the CLAUDE.md correction.
    //
    // Scoped to the document OUTSIDE the `### Derived counts` section, rather than
    // to the whole file. That section is the one place allowed to discuss counts —
    // it states them and explains why they are guarded — so scanning the whole file
    // would make the guard fire on its own table and on any sentence describing the
    // history. An earlier draft did exactly that and passed only because a stray
    // backtick happened to break the pattern; a guard that survives by luck of
    // punctuation is one that fails the next time someone reflows a paragraph.
    const readme = await Bun.file(README_PATH).text();
    const start = readme.indexOf(TABLE_HEADING);
    const section = readme.slice(start + TABLE_HEADING.length);
    const guarded = section.split(/\n#{1,6} /)[0];
    const outside = readme.slice(0, start) + section.slice(guarded.length);

    // Scanned LINE BY LINE, with only intra-line whitespace collapsed.
    //
    // The obvious implementation — collapse all whitespace and scan the document
    // as one string — cries wolf immediately: the CLI examples contain the line
    // `skills list --all --limit 50` followed by `skills list ...`, and flattening
    // the newline makes "50 skills" appear out of two unrelated lines. That is the
    // noise-then-deleted death the sibling guard's header warns about.
    //
    // The tempting alternative — strip fenced code blocks first — would be worse:
    // BOTH original `202+` claims lived INSIDE the project-structure fence, so a
    // fence-stripping guard is blind to the precise defect it exists for.
    //
    // Stated bound: a count split across a line break evades this. Every claim that
    // actually rotted here was on one line, and buying that case back costs the
    // false positives above, which is a bad trade for a doc guard.
    const lines = outside.split("\n").map((line) => line.replace(/[ \t]+/g, " "));

    // The shapes the real claims took. `202+ entries` and `202+ public skill
    // contracts` were the two that rotted; `~20 tools` and `20+ tools` understated
    // a real 37. Approximation markers are included deliberately: `~` and `+` read
    // as hedges that make a number feel maintenance-free, and both were wrong.
    //
    // The `(?!-)` guards are load-bearing, not defensive: without them
    // `MCP_HTTP_PORT=8836 skills-mcp` reads as a claim of "8836 skills", because
    // the package's own binaries are named `skills-mcp` and `skills-server`. A
    // count-shaped pattern in a repo whose product is literally called "skills"
    // needs the noun to end where the claim would end.
    const stalePatterns = [
      /\b\d+\+? (?:public )?skills?\b(?!-)/i,
      /\b\d+\+? entries\b/i,
      /[~>]?\s?\b\d+\+? tools\b(?!-)/i,
      /\b\d+\+? categories\b/i,
    ];

    // Assert on the offending LINES rather than the 22 KB document. A doc guard
    // whose failure prints the whole README is one a reader scrolls past; the line
    // that carries the claim is what makes the fix a ten-second edit.
    const offenders = lines.filter((line) => stalePatterns.some((p) => p.test(line)));
    expect(offenders).toEqual([]);
  });
});
