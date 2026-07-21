import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import pkg from "../../package.json" with { type: "json" };
import { BASIC_SKILL_NAMES, SKILLS } from "../lib/registry.js";

export const CLI_PATH = join(import.meta.dir, "index.tsx");
export const BUILT_CLI_PATH = join(import.meta.dir, "..", "..", "bin", "index.js");
export const EXPECTED_ALL_SKILL_COUNT = SKILLS.length;
export const EXPECTED_BASIC_SKILL_COUNT = BASIC_SKILL_NAMES.length;
export const PACKAGE_VERSION = pkg.version;
export const SLOW_TEST_TIMEOUT = 15000;
export const CLEAN_CLI_HOME = mkdtempSync(join(tmpdir(), "skills-cli-home-"));

function testEnv(env: Record<string, string>): Record<string, string> {
  return { ...process.env, HOME: CLEAN_CLI_HOME, ...env, NO_COLOR: "1", SKILLS_TEST_MODE: "1" };
}

async function runCliAtPath(
  path: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", path, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv(env),
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCliAtPath(CLI_PATH, args, env);
}

export async function runBuiltCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCliAtPath(BUILT_CLI_PATH, args, env);
}

export async function runCliWithTtyOverride(
  args: string[],
  timeoutMs = 3_000,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const wrapper = [
    'Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });',
    'Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });',
    `process.argv = ${JSON.stringify(["bun", ...args])};`,
    `await import(${JSON.stringify(pathToFileURL(CLI_PATH).href)});`,
  ].join("\n");
  const proc = Bun.spawn(["bun", "--eval", wrapper], {
    cwd: join(import.meta.dir, "..", ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv({}),
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const exitCode = await proc.exited;
  clearTimeout(timeout);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode, timedOut };
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
