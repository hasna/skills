import { describe, expect, test } from "bun:test";
import { getPackedFiles, parseNpmPackJson } from "./packlist.js";

/**
 * The packed-file list is what every "nothing leaked into the tarball" guard is
 * asserted against, so the two failure modes that matter are: crashing on output
 * npm did not produce, and silently reporting an empty list (which would make
 * every one of those guards pass vacuously).
 *
 * Observed in CI on this branch: a first, cold `npm pack --json` took 5s, exited
 * 0, and wrote nothing to stdout. That surfaced as a bare
 * `SyntaxError: JSON Parse error: Unexpected EOF` thrown from inside a boundary
 * test - a failure that says nothing about packaging and blocks the build on
 * npm's flakiness rather than on a real leak.
 */

describe("parseNpmPackJson", () => {
  test("parses a normal npm pack manifest", () => {
    const stdout = JSON.stringify([{ files: [{ path: "dist/index.js" }, { path: "README.md" }] }]);
    expect(parseNpmPackJson(stdout)).toEqual(["dist/index.js", "README.md"]);
  });

  test("returns null instead of throwing on output npm did not produce", () => {
    // Each of these threw a raw SyntaxError before.
    for (const stdout of ["", "   \n", "not json at all", "{", "npm warn config\n"]) {
      expect(parseNpmPackJson(stdout)).toBeNull();
    }
  });

  test("returns null for well-formed JSON that is not a pack manifest", () => {
    for (const stdout of ["[]", "{}", '"a string"', "[{}]", '[{"files":"nope"}]']) {
      expect(parseNpmPackJson(stdout)).toBeNull();
    }
  });

  test("returns null for a manifest listing no files", () => {
    // Reporting zero packed files would make every leak assertion pass vacuously,
    // so it must be treated as "no usable answer", not as a valid empty result.
    expect(parseNpmPackJson(JSON.stringify([{ files: [] }]))).toBeNull();
  });

  test("drops malformed entries rather than emitting undefined paths", () => {
    const stdout = JSON.stringify([{ files: [{ path: "keep.js" }, {}, { path: "" }, { path: 7 }] }]);
    expect(parseNpmPackJson(stdout)).toEqual(["keep.js"]);
  });
});

describe("getPackedFiles", () => {
  test("returns a non-empty, sorted file list for this package", () => {
    const files = getPackedFiles(process.cwd());
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual([...files].sort());
    expect(files).toContain("package.json");
  });
});
