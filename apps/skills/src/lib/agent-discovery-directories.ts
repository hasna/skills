import { createHash } from "node:crypto";
import { lstatSync, opendirSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";

/** Recursive path/type membership only; source-file hashes bind reviewed bytes. */
export interface DiscoveryDirectory { path: string; sha256: string | null }
interface Budget { entries: number; bytes: number }
function need(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function safe(path: string): void {
  need(typeof path === "string" && path.length <= AGENT_POLICY_LIMITS.pathCharacters && isAbsolute(path) && resolve(path) === path && !path.includes("\0"), "Expected a canonical absolute discovery directory path");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    need(!lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink(), "Refusing symlink native discovery directory");
    if (dirname(cursor) === cursor) break;
  }
}
function same(before: Stats, after: Stats | undefined): boolean {
  return Boolean(after && after.isDirectory() && before.dev === after.dev && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs);
}
function capture(path: string, budget: Budget): DiscoveryDirectory {
  safe(path);
  const root = lstatSync(path, { throwIfNoEntry: false });
  if (!root) return { path, sha256: null };
  need(root.isDirectory(), "Unsupported native discovery directory input");
  const hash = createHash("sha256");
  function walk(current: string, relative: string, before: Stats, depth: number): void {
    need(depth <= 64, "Native discovery directory depth limit exceeded");
    const names: string[] = [], directory = opendirSync(current);
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        need(++budget.entries <= AGENT_POLICY_LIMITS.discoveryDirectoryEntries, "Native discovery directory entry limit exceeded");
        names.push(entry.name);
      }
    } finally { directory.closeSync(); }
    need(new Set(names).size === names.length, "Ambiguous native discovery directory names");
    for (const name of names.sort()) {
      const child = join(current, name), childRelative = relative ? `${relative}/${name}` : name;
      need(child.length <= AGENT_POLICY_LIMITS.pathCharacters, "Native discovery directory path limit exceeded");
      const stat = lstatSync(child);
      need(stat.isFile() || stat.isDirectory(), "Refusing symlink or special native discovery directory member");
      const row = JSON.stringify([childRelative, stat.isDirectory() ? "directory" : "file"]) + "\n";
      budget.bytes += Buffer.byteLength(row);
      need(budget.bytes <= AGENT_POLICY_LIMITS.discoveryDirectoryBytes, "Native discovery directory metadata limit exceeded");
      hash.update(row);
      if (stat.isDirectory()) walk(child, childRelative, stat, depth + 1);
    }
    need(same(before, lstatSync(current, { throwIfNoEntry: false })), "Native discovery directory changed while reading");
  }
  walk(path, "", root, 0);
  safe(path);
  return { path, sha256: hash.digest("hex") };
}
/** Read-only capture; callers must review both membership and source bytes. */
export function captureDiscoveryDirectories(paths: string[]): DiscoveryDirectory[] {
  need(Array.isArray(paths) && paths.length <= AGENT_POLICY_LIMITS.discoveryDirectories && new Set(paths).size === paths.length, "Invalid native discovery directory collection");
  const budget: Budget = { entries: 0, bytes: 0 };
  return paths.map(path => capture(path, budget));
}
export function verifyDiscoveryDirectories(directories: DiscoveryDirectory[]): void {
  need(Array.isArray(directories) && directories.length <= AGENT_POLICY_LIMITS.discoveryDirectories, "Invalid native discovery directory collection");
  for (const directory of directories) need(directory && typeof directory === "object" && (directory.sha256 === null || typeof directory.sha256 === "string" && /^[a-f0-9]{64}$/.test(directory.sha256)), "Invalid native discovery directory digest");
  const current = captureDiscoveryDirectories(directories.map(directory => directory.path));
  for (let i = 0; i < directories.length; i++) need(current[i]!.sha256 === directories[i]!.sha256, `Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${directories[i]!.path}`);
}
