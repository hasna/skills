/**
 * Guard for the suite-wide per-test timeout.
 *
 * The failure this exists to stop: bun's default per-test timeout is 5000ms, and
 * this suite spawns a real `bun run src/cli/index.tsx` inside a test. On a loaded
 * machine fourteen of its 896 tests take longer than that, so tests went red at
 * 5000.00-5003.90ms with nothing wrong in the diff — reproduced by two agents
 * independently, on a pristine `origin/main` checkout. A suite that fails at
 * random stops being read, and "CI is red" stops meaning anything.
 *
 * Raising the ceiling is one line. Keeping it raised is the hard part, and that
 * is what is asserted here: bun offers no working global setting (see
 * `useDefaultTestTimeout` in src/test-preload.ts for what was measured and
 * rejected), so the ceiling has to be re-applied per test file. Anything
 * re-applied by hand is eventually forgotten — unless a test says so.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DEFAULT_TEST_TIMEOUT_MS, useDefaultTestTimeout } from "./test-preload.js";

useDefaultTestTimeout();

const SRC = join(process.cwd(), "src");

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(path));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe("per-test timeout policy", () => {
  test("every test file applies the suite default timeout", () => {
    const files = testFiles(SRC);
    // Anti-vacuity: an empty or tiny scan would satisfy the assertion below
    // without checking anything. The suite had 69 test files when this was written.
    expect(files.length, "test file scan must not be empty").toBeGreaterThan(50);

    const missing = files
      .filter((file) => !/^\s*useDefaultTestTimeout\(\);\s*$/m.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));

    expect(
      missing.length === 0
        ? ""
        : "\n  test files that never call useDefaultTestTimeout() and so run at bun's 5000ms default:\n" +
          missing.map((file) => `    ${file}`).join("\n") +
          '\n  Add: import { useDefaultTestTimeout } from "<path>/test-preload.js";' +
          "\n       useDefaultTestTimeout();\n",
    ).toBe("");
  });

  // Belt and braces for `bun run test`, which is what CI runs: `--timeout` is the
  // one mechanism bun applies to every file, so the script carries it too. Keeping
  // the two numbers equal by assertion rather than by hope — a script that says
  // 30000 while the code says something else is a lie a reader would believe.
  test("the test script passes the same timeout the code sets", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const script: string = manifest.scripts?.test ?? "";
    const declared = /--timeout[= ](\d+)/.exec(script)?.[1];
    expect(declared, `package.json test script must pass --timeout: ${JSON.stringify(script)}`).toBeDefined();
    expect(Number(declared)).toBe(DEFAULT_TEST_TIMEOUT_MS);
  });

  // The ceiling is only useful if it is above the work and below a hang. 30s is
  // ~2.7x the slowest test measured on a machine at load average 82-88 (11.06s)
  // and 6x the 5s cluster that was failing; 60s+ would start letting a hung test
  // pass for a slow one.
  test("the default is high enough to clear the measured distribution and low enough to catch a hang", () => {
    expect(DEFAULT_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
    expect(DEFAULT_TEST_TIMEOUT_MS).toBeLessThanOrEqual(45_000);
  });

  test("the default actually reaches a test in this file", async () => {
    // Proves the mechanism, not just its declaration: bun's default would fail
    // this at 5000ms. Cheap enough to keep (5.2s) and the only assertion here
    // that would notice `useDefaultTestTimeout` becoming a no-op.
    const start = Date.now();
    await Bun.sleep(5_200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5_000);
  });
});
