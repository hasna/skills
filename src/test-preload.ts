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
import { beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV } from "./lib/config.js";

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
