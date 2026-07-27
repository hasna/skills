import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import pkg from "../../package.json" with { type: "json" };
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";
import { DEFAULT_TEST_TIMEOUT_MS, withoutDataDirOverrideEnv } from "../test-preload.js";

export const CLI_PATH = join(import.meta.dir, "index.tsx");
export const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
export const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
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

// The CLI under test resolves its data dir from $HOME. Drop the preload's
// $HASNA_SKILLS_DIR from the *inherited* environment, or that ambient override
// wins inside the child and CLEAN_CLI_HOME (or a test's own $HOME) is never
// consulted. Isolation is preserved by $HOME itself always being a throwaway dir.
//
// Stripped before the caller's `env` is merged, not after, so a test that wants to
// exercise the override can still pass one explicitly - same explicit-over-ambient
// rule the resolver itself follows.
function testEnv(env: Record<string, string>): Record<string, string> {
  return {
    ...withoutDataDirOverrideEnv({ ...process.env }),
    HOME: CLEAN_CLI_HOME,
    ...env,
    NO_COLOR: "1",
    SKILLS_TEST_MODE: "1",
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
