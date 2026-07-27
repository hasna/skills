/**
 * Test hermeticity preload.
 *
 * Gives every test its own throwaway skills data directory, so the suite never
 * reads or writes the developer's real ~/.hasna/skills.
 *
 * The leak this closes: reading and writing the real home. Any machine with
 * portable skills installed saw ten failures across registry, skillinfo, and
 * validation, because loadRegistry() merges the data dir and lets a same-named
 * custom skill shadow the bundled official entry. Those failures track the
 * developer's home directory rather than the code - indistinguishable from a
 * real regression, and guaranteed to get worse as we dogfood this tool and every
 * machine accumulates custom skills. The suite also created ~/.hasna/skills on
 * machines that had none, because getDataDir() mkdirs what it returns.
 *
 * Why per-test rather than one directory for the whole run: measured, both work
 * today. With the override retained for inspection, a full run creates 758
 * per-test directories and writes to none of them - every test that creates a
 * portable skill passes an explicit rootDir/homeDir or its own $HOME - and a
 * single shared directory is equally green with zero residue. Per-test is kept
 * because it costs nothing measurable and makes order-independence structural
 * rather than incidental: the registry refactor this unblocks will add tests,
 * and a future test that writes to the ambient dir without cleaning up cannot
 * reach the tests that follow it.
 *
 * A file-level hook still wins: this beforeEach is registered first, so a test
 * that sets $HASNA_SKILLS_DIR for itself overwrites this default afterwards. The
 * suite has no beforeAll hooks, which would otherwise be clobbered.
 *
 * Tests that exist to prove the $HOME-resolution branch cannot run under the
 * override; they opt out with withHomeDataDir()/withTempHome() below.
 */
import { beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV } from "./lib/config.js";

/**
 * Per-test timeout for the whole suite. THIS IS THE ONE PLACE THE NUMBER LIVES —
 * a new test that spawns a subprocess needs no timeout argument of its own.
 *
 * Why it exists: bun's default is 5000ms, and the CLI tests spawn a real `bun
 * run src/cli/index.tsx` per assertion. Two agents independently watched the
 * same subprocess tests come in at 5000.00-5003.90ms against that 5000ms limit
 * and go red, and both reproduced it on a pristine `origin/main` checkout, so it
 * was never anyone's diff — it was the ceiling.
 *
 * Measured rather than guessed. One full run (896 tests, 347s wall, this repo at
 * commit 53bc5f2, machine at load average 82-88 with other agents' `bun test`
 * runs in flight), per-test times from `--reporter=junit`:
 *
 *   11.06s  cli.discovery      flushes complete registry sync JSON through a shell pipe
 *    9.50s  unconfigured-...   no packed code file names a host outside APPROVED_CODE_HOSTS
 *    9.01s  cli.portable-...   new, list, show, validate, and run work against ~/.hasna/skills
 *    8.83s  cli.runtime        config unset apiUrl returns a project to running on this machine
 *    7.53s  agent-workflow     merge-pr guard passes its raw-fixture behavior suite
 *
 *   over 1s: 56 · over 2s: 37 · over 3s: 30 · over 5s: 14 · over 10s: 1 · over 15s: 0
 *
 * FOURTEEN of 896 tests exceed 5000ms on a loaded machine. That is not marginal
 * flakiness at the tail, it is a ceiling set below the working set, and a CI
 * runner having a bad minute reproduces the same shape.
 *
 * Why 30s rather than tighter or looser: it is ~2.7x the slowest test ever
 * observed here and ~6x the 5s cluster that was failing, with nothing measured
 * between 11.1s and the limit — so a test that hits 30s is not slow, it is
 * stuck. It also keeps a hang cheap to find: 30s against a 347s suite. Going
 * higher starts converting hangs into "slow tests"; going much lower puts the
 * ceiling back inside the observed distribution, which is the bug being fixed.
 *
 * Override for one run with HASNA_SKILLS_TEST_TIMEOUT_MS — including to LOWER it,
 * which is how you tell a hang from a slow test without waiting 30s a time.
 *
 * A per-test timeout argument still wins over this, as it always did.
 */
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;

const timeoutOverride = Number(process.env["HASNA_SKILLS_TEST_TIMEOUT_MS"]);
const effectiveTimeout =
  Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : DEFAULT_TEST_TIMEOUT_MS;

/**
 * Applies DEFAULT_TEST_TIMEOUT_MS to the calling file. CALL IT ONCE AT THE TOP OF
 * EVERY TEST FILE — `src/test-timeout.test.ts` fails the build if a file forgets,
 * so this is checked rather than remembered.
 *
 * Why a function every file calls, and not one call right here: measured on bun
 * 1.3.14, none of the tidier spellings work.
 *
 *   - `[test] timeout` in bunfig.toml — accepted and SILENTLY IGNORED. A 400ms
 *     test passed under a declared 100ms ceiling.
 *   - `setDefaultTimeout()` at preload module scope — applies to exactly ONE
 *     test file. Three files, one call, 150ms ceiling: one file timed out and
 *     two ran to 400ms unbothered. The preload is evaluated once, so the setting
 *     lands on whichever file happens to be loading at the time. This is the
 *     shape that would have shipped as a no-op: `bun test` on the full suite
 *     still failed a CLI test "after 5000ms" with the call sitting right here.
 *   - `setDefaultTimeout()` from a beforeEach, and a BUN_TEST_TIMEOUT env var —
 *     no effect at all.
 *
 * What does work is a call made while each file is being evaluated, which is why
 * this is a function rather than a statement. It does not matter that the call
 * lives in this module; it matters when it runs. `--timeout` on the command line
 * also works globally, and `package.json`'s `test` script passes it — but only
 * that one invocation gets it, and `bun test` without `run` is what people and
 * agents actually type.
 */
export function useDefaultTestTimeout(): void {
  setDefaultTimeout(effectiveTimeout);
}

/**
 * Set at module scope, before any test file is imported, so there is never a
 * window in which the variable is unset. beforeEach only ever *narrows* the
 * isolation; it does not establish it.
 *
 * Without this, every describe body, beforeAll, and afterAll in the suite would
 * run against the developer's real ~/.hasna/skills - the hooks that run outside
 * a test body are exactly the ones a per-test beforeEach cannot reach. The suite
 * has no beforeAll today, so nothing would have failed; the invariant would have
 * been enforced by a comment until the first one was added.
 */
// A fixed path rather than mkdtemp, and deliberately never torn down. It has to
// outlive every afterEach, so no hook can remove it, and Bun runs the suite across
// several processes whose exit handlers do not reliably fire - a per-process temp
// dir accumulated seven empty directories in /tmp per run. One stable, reused
// directory cannot accumulate. It stays empty in practice (nothing writes outside
// a test body); if anything ever did, it is still not the developer's real home,
// which is the invariant that matters here.
const baseline = join(tmpdir(), "hasna-skills-test-baseline");
mkdirSync(baseline, { recursive: true });
process.env[DATA_DIR_ENV] = baseline;

let current: string | null = null;

beforeEach(() => {
  current = mkdtempSync(join(tmpdir(), "skills-test-home-"));
  process.env[DATA_DIR_ENV] = current;
});

afterEach(() => {
  if (!current) return;
  rmSync(current, { recursive: true, force: true });
  current = null;
  // Point back at the baseline rather than unsetting: a dangling variable naming
  // a deleted directory would make any post-teardown getDataDir() silently
  // re-create a stray temp dir that nothing ever removes.
  process.env[DATA_DIR_ENV] = baseline;
});

/**
 * Runs `fn` with the data-directory override lifted, so $HOME resolution is the
 * thing under test. Restores whatever was set before, including "not set".
 *
 * Only for tests asserting how the data dir is derived from $HOME. Everything
 * else should stay under the override.
 */
export function withHomeDataDir<T>(fn: () => T): T {
  const previous = process.env[DATA_DIR_ENV];
  delete process.env[DATA_DIR_ENV];
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[DATA_DIR_ENV];
    else process.env[DATA_DIR_ENV] = previous;
  }
}

/**
 * withHomeDataDir() plus a throwaway $HOME, for tests that exercise the $HOME
 * branch but must not create ~/.hasna/skills on the developer's machine while
 * doing it - getDataDir() mkdirs the directory it returns.
 */
export function withTempHome<T>(fn: (home: string) => T): T {
  return withHomeDataDir(() => {
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "skills-real-home-"));
    process.env["HOME"] = home;
    try {
      return fn(home);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
}

/**
 * Environment for a child process that must resolve its data dir from the $HOME
 * the test gave it. The preload's override is inherited through Bun.spawn's
 * `...process.env` and would otherwise outrank that $HOME inside the child -
 * the same explicit-vs-ambient collision as getPortableSkillsRoot(), across a
 * process boundary. Stripping it is safe because callers always supply a
 * throwaway $HOME.
 */
export function withoutDataDirOverrideEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const { [DATA_DIR_ENV]: _dropped, ...rest } = env;
  return rest;
}
