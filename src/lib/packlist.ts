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

function run(command: string[], cwd: string): RunResult {
  const result = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8" });
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

function parseNpmJson(stdout: string): string[] {
  const manifests = JSON.parse(stdout) as PackManifest[];
  return manifests[0].files.map((file) => file.path);
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
  const npmResult = run(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], cwd);
  if (!npmResult.missingExecutable) {
    if (npmResult.exitCode !== 0) {
      throw new Error(`npm pack --dry-run failed (exit ${npmResult.exitCode}): ${npmResult.stderr}`);
    }
    return parseNpmJson(npmResult.stdout).sort();
  }

  const bunResult = run(["bun", "pm", "pack", "--dry-run", "--ignore-scripts"], cwd);
  if (bunResult.missingExecutable) {
    throw new Error("Neither `npm` nor `bun` is available to compute the package file list.");
  }
  if (bunResult.exitCode !== 0) {
    throw new Error(`bun pm pack --dry-run failed (exit ${bunResult.exitCode}): ${bunResult.stderr}`);
  }
  return parseBunOutput(bunResult.stdout).sort();
}
