#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { scanInputExposures, stagedScanExitCode } from "@hasna/secrets/scanner";

// Scan committed blobs rather than working files or textual patches: this also
// covers binary additions and never follows a changed symlink outside the repo.
const maxBytes = 20 * 1024 * 1024;
function git(...args: string[]): Buffer {
  const result = spawnSync("git", args, { maxBuffer: maxBytes, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error("Git could not read the complete candidate");
  return result.stdout;
}
function revision(ref: string): string {
  const value = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error("Invalid candidate revision");
  return value;
}

try {
  if (process.argv.length > 3) throw new Error("Expected at most one base ref");
  const head = revision("HEAD");
  const target = revision(process.argv[2] ?? "refs/remotes/origin/main");
  let base = git("merge-base", head, target).toString().trim();
  // A tag/main validation still scans its commit; source branches scan their
  // complete delta against current main, including changes outside the package.
  if (base === head) base = revision(`${head}^`);
  const names = new TextDecoder("utf-8", { fatal: true }).decode(
    git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "--diff-filter=ACMRT", "-z", base, head, "--"),
  );
  if (names && !names.endsWith("\0")) throw new Error("Incomplete changed path list");
  const paths = names ? names.slice(0, -1).split("\0") : [];
  if (paths.length > 10_000 || new Set(paths).size !== paths.length) throw new Error("Invalid changed path population");
  let status = 0;
  let bytesScanned = 0;
  for (const path of paths) {
    const bytes = git("cat-file", "blob", `${head}:${path}`);
    const result = scanInputExposures({ buffer: bytes, maxBytes });
    const code = stagedScanExitCode(result);
    const complete = result.stats.filesScanned === 1 && result.stats.filesSkipped === 0
      && result.stats.errors.length === 0 && !result.truncated && result.stats.bytesScanned === bytes.length;
    status = Math.max(status, code, complete ? 0 : 2);
    bytesScanned += result.stats.bytesScanned;
    // The owning scanner emits constant-redacted previews, never source text.
    console.log(JSON.stringify({ path, ...result, exitCode: code, complete }));
  }
  console.log(JSON.stringify({ schema: "skills.changed-credential-scan.v1", head, base, filesScanned: paths.length, bytesScanned, exitCode: status }));
  process.exitCode = status;
} catch {
  console.error("Changed credential scan could not inspect the complete candidate.");
  process.exitCode = 2;
}
