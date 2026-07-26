/**
 * packlist.ts — derive the REAL set of files that would be published to npm.
 *
 * Always resolve the package-visible file set from the packager itself
 * (`npm pack --dry-run` / `bun pm pack --dry-run`), never from a hand-maintained
 * copy of the `files` array. This guarantees the safety guards scan exactly what
 * ships, including the effect of the `files` allow/deny globs.
 */

import { spawnSync } from "node:child_process";

interface PackedFileEntry {
  path: string;
}

interface PackManifest {
  files: PackedFileEntry[];
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  missingExecutable: boolean;
}

/**
 * The packed file list for this package is hundreds of KB of JSON. spawnSync's
 * default 1MB buffer is close enough to that to be worth removing as a variable.
 */
const PACK_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;

function run(command: string[], cwd: string): RunResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: PACK_OUTPUT_MAX_BUFFER,
  });
  if (result.error) {
    const message = result.error.message;
    const missingExecutable =
      (result.error as NodeJS.ErrnoException).code === "ENOENT" || message.includes("ENOENT");
    return { exitCode: 127, stdout: "", stderr: message, missingExecutable };
  }
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    missingExecutable: false,
  };
}

/**
 * Parse `npm pack --json`, returning null rather than throwing when the output is
 * not a usable manifest.
 *
 * npm does not always produce the JSON it promises. Observed in CI: a first,
 * cold `npm pack` invocation took 5s, exited 0, and wrote nothing to stdout,
 * which surfaced as a bare `SyntaxError: JSON Parse error: Unexpected EOF` from
 * inside a boundary test - an unactionable failure that says nothing about
 * packaging. Later calls in the same run, with the same package.json, succeeded
 * in ~1.2s. Returning null lets the caller fall back to `bun pm pack` instead of
 * failing the build on npm's flakiness.
 */
export function parseNpmPackJson(stdout: string): string[] | null {
  if (!stdout.trim()) return null;
  let manifests: unknown;
  try {
    manifests = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(manifests) || manifests.length === 0) return null;
  const files = (manifests[0] as PackManifest | undefined)?.files;
  if (!Array.isArray(files)) return null;
  const paths = files
    .map((file) => (file as PackedFileEntry | undefined)?.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  // An empty file list is never legitimate for this package and would silently
  // pass every "nothing leaked" assertion.
  return paths.length > 0 ? paths : null;
}

function parseBunOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => /^packed\s+\S+\s+(.+)$/.exec(line)?.[1])
    .filter((path): path is string => Boolean(path));
}

/**
 * Return the sorted list of package-relative file paths that would be published.
 * Prefers `npm pack` (authoritative for npm) and falls back to `bun pm pack`.
 */
export function getPackedFiles(cwd: string = process.cwd()): string[] {
  // npm is authoritative for npm, but it is not reliable enough to be the only
  // source: fall back to bun whenever npm cannot produce a usable answer, for any
  // reason, rather than failing the build. Both failing is a real error and says so.
  const npmResult = run(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], cwd);
  let npmProblem: string | null = null;
  if (npmResult.missingExecutable) {
    npmProblem = "npm is not available";
  } else if (npmResult.exitCode !== 0) {
    npmProblem = `npm pack --dry-run failed (exit ${npmResult.exitCode}): ${npmResult.stderr.trim()}`;
  } else {
    const parsed = parseNpmPackJson(npmResult.stdout);
    if (parsed) return parsed.sort();
    npmProblem = `npm pack --dry-run produced no usable JSON (${npmResult.stdout.length} bytes of stdout): ${npmResult.stderr.trim()}`;
  }

  const bunResult = run(["bun", "pm", "pack", "--dry-run", "--ignore-scripts"], cwd);
  if (bunResult.missingExecutable) {
    throw new Error(`Cannot compute the package file list. ${npmProblem}; and bun is not available.`);
  }
  if (bunResult.exitCode !== 0) {
    throw new Error(
      `Cannot compute the package file list. ${npmProblem}; bun pm pack --dry-run failed (exit ${bunResult.exitCode}): ${bunResult.stderr.trim()}`,
    );
  }
  const packed = parseBunOutput(bunResult.stdout);
  if (packed.length === 0) {
    throw new Error(`Cannot compute the package file list. ${npmProblem}; bun pm pack --dry-run listed no files.`);
  }
  return packed.sort();
}
