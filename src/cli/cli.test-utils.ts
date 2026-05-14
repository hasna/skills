import { join } from "path";
import pkg from "../../package.json" with { type: "json" };
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";

export const CLI_PATH = join(import.meta.dir, "index.tsx");
export const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
export const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
export const PACKAGE_VERSION = pkg.version;
export const SLOW_TEST_TIMEOUT = 15000;

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
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
    env: { ...process.env, ...env, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}
