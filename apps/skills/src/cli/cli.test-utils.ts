import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import pkg from "../../package.json" with { type: "json" };
import { TEST_CATALOG, writeTestCatalog } from "../lib/private-corpus-test-utils.js";
import { DEFAULT_TEST_TIMEOUT_MS, withoutDataDirOverrideEnv } from "../test-preload.js";

export const CLI_PATH = join(import.meta.dir, "index.tsx");
export const EXPECTED_ALL_SKILL_COUNT = TEST_CATALOG.length;
export const EXPECTED_BASIC_SKILL_COUNT = TEST_CATALOG.length;
// The `categories` command lists only categories that hold at least one skill.
// The synthetic owned catalog populates a subset of CATEGORIES.
export const EXPECTED_POPULATED_CATEGORY_COUNT = new Set(TEST_CATALOG.map((s) => s[1])).size;
export const PACKAGE_VERSION = pkg.version;

/**
 * Retained for the ~36 call sites that already pass it. NEW TESTS DO NOT NEED IT:
 * every test file calls useDefaultTestTimeout(), so a subprocess test written
 * with no timeout argument is already covered — which is the point, because
 * remembering to annotate the next one is exactly what did not happen.
 *
 * Aliased rather than left at its old 15000 so this constant can never sit BELOW
 * the suite default and quietly give the slowest tests in the suite the tightest
 * ceiling in it.
 */
export const SLOW_TEST_TIMEOUT = DEFAULT_TEST_TIMEOUT_MS;
export const CLEAN_CLI_HOME = mkdtempSync(join(tmpdir(), "skills-cli-home-"));
writeTestCatalog(join(CLEAN_CLI_HOME, ".hasna", "skills", "installed"));

/**
 * The one line an opted-in local install is allowed to print on stderr.
 *
 * Local mode is opt-in only and announces itself (owner ruling 2026-09-04,
 * hasna/apps#1720; class-patch order 2026-09-06): with the explicit
 * `HASNA_SKILLS_LOCAL=1` opt-in and no API credential or URL, the CLI says
 * once, per process, that it is running on this machine. The harness below
 * passes the opt-in itself, so the suite's local runs are deliberate ones —
 * and "stderr is empty" remains the wrong assertion for a local command. Use
 * {@link stderrWithoutLocalNotice}, which strips exactly this line and nothing
 * else, so an unexpected warning still fails the test it would have failed
 * before.
 */
export const LOCAL_MODE_NOTICE_MARKER = "skills: local mode";

/** `stderr` with the single local-mode notice line removed. */
export function stderrWithoutLocalNotice(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.includes(LOCAL_MODE_NOTICE_MARKER))
    .join("\n")
    .trim();
}

// The CLI under test resolves its data dir from $HOME. Drop the preload's
// $HASNA_SKILLS_DIR from the *inherited* environment, or that ambient override
// wins inside the child and CLEAN_CLI_HOME (or a test's own $HOME) is never
// consulted. Isolation is preserved by $HOME itself always being a throwaway dir.
//
// Stripped before the caller's `env` is merged, not after, so a test that wants to
// exercise the override can still pass one explicitly - same explicit-over-ambient
// rule the resolver itself follows.
function testEnv(env: Record<string, string>): Record<string, string> {
  // withoutDataDirOverrideEnv() also strips every fleet credential variable and
  // blinds the Keychain tier (see test-preload.ts): a child CLI must resolve the
  // same "runs on this machine" state on a developer's Mac as on CI. The local
  // opt-in is passed EXPLICITLY below, the same way an operator who wants the
  // on-machine run sets it — local mode is no longer the silence that follows
  // a missing credential, and a test that spawns a CLI to assert fail-closed
  // behaviour passes its own environment without it.
  return {
    ...withoutDataDirOverrideEnv({ ...process.env }),
    HOME: CLEAN_CLI_HOME,
    ...env,
    NO_COLOR: "1",
    SKILLS_TEST_MODE: "1",
    // The default before `...env`, so a test can deliberately opt OUT (or
    // blank) and exercise the fail-closed path through the harness itself —
    // same explicit-over-ambient rule every other variable in this env follows.
    HASNA_SKILLS_LOCAL: env.HASNA_SKILLS_LOCAL ?? env.SKILLS_LOCAL ?? "1",
  } as Record<string, string>;
}

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv(env),
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export async function runCliInCwd(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: testEnv(env),
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}
