import { createHash } from "node:crypto";
import { lstatSync, readlinkSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { AGENT_POLICY_LIMITS as limits } from "./agent-policy-limits.js";
import { hashRawDiscoveryFile, type DiscoveryByteBudget } from "./agent-discovery-bytes.js";

interface PathTrace { rows: Record<string, unknown>[]; paths: string[]; file: string | null; missing: string | null; metadataBytes: number }
function identity(stat: BigIntStats, mutable = false): Record<string, string> {
  return {
    dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), uid: String(stat.uid), gid: String(stat.gid),
    ...(mutable ? { size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) } : {}),
  };
}
function canonical(path: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path !== resolve(path) || path.length > limits.pathCharacters || path.includes("\0") || Buffer.from(path).toString("utf8") !== path) throw new Error("Expected a canonical absolute discovery path");
}

/** Resolve components in kernel order: a/../b must expand a's symlink first.
 * Directory identity excludes timestamps so unrelated sibling writes do not
 * invalidate a launcher. Link and file metadata include timestamps as well. */
function trace(path: string): PathTrace {
  canonical(path);
  const rows: Record<string, unknown>[] = [], paths: string[] = [];
  let metadataBytes = 0, steps = 0, links = 0, cursor = parse(path).root, pending = path.slice(cursor.length).split(sep);
  function record(path: string, row: Record<string, unknown>): void {
    const value = { path, ...row };
    metadataBytes += Buffer.byteLength(JSON.stringify(value));
    if (metadataBytes > limits.discoveryPathSourceMetadataBytes) throw new Error("Discovery path metadata limit exceeded");
    rows.push(value); paths.push(path);
  }
  function root(): void {
    const stat = lstatSync(cursor, { bigint: true });
    if (!stat.isDirectory()) throw new Error("Unsupported discovery path root");
    record(cursor, { type: "directory", ...identity(stat) });
  }
  root();
  while (pending.length) {
    if (++steps > limits.discoveryPathSteps) throw new Error("Discovery path step limit exceeded");
    const component = pending.shift()!;
    if (!component || component === ".") continue;
    if (component === "..") { cursor = dirname(cursor); continue; }
    const candidate = join(cursor, component);
    if (candidate.length > limits.pathCharacters) throw new Error("Discovery resolved path length limit exceeded");
    const stat = lstatSync(candidate, { bigint: true, throwIfNoEntry: false });
    if (!stat) {
      record(candidate, { type: "missing", remaining: pending });
      return { rows, paths, file: null, missing: candidate, metadataBytes };
    }
    if (stat.isSymbolicLink()) {
      if (++links > limits.discoveryPathLinks || stat.size > BigInt(limits.pathCharacters)) throw new Error("Discovery path link limit exceeded");
      const rawTarget = readlinkSync(candidate, { encoding: "buffer" }), target = rawTarget.toString("utf8"), after = lstatSync(candidate, { bigint: true });
      if (!rawTarget.equals(Buffer.from(target, "utf8"))) throw new Error("Unsupported non-UTF8 discovery link target");
      if (!target || target.includes("\0") || Buffer.byteLength(target) > limits.pathCharacters || !after.isSymbolicLink() || JSON.stringify(identity(stat, true)) !== JSON.stringify(identity(after, true))) throw new Error("Discovery link changed during read");
      record(candidate, { type: "link", target, ...identity(stat, true) });
      if (isAbsolute(target)) { cursor = parse(target).root; root(); }
      const remainder = isAbsolute(target) ? target.slice(parse(target).root.length) : target;
      pending = [...remainder.split(sep), ...pending];
      if (pending.length + steps > limits.discoveryPathSteps) throw new Error("Discovery path step limit exceeded");
      continue;
    }
    if (stat.isDirectory()) {
      record(candidate, { type: "directory", ...identity(stat) }); cursor = candidate; continue;
    }
    if (!stat.isFile() || pending.length) throw new Error("Unsupported discovery path input");
    if (stat.size > BigInt(limits.discoveryRawSourceBytes)) throw new Error("Unsupported or oversized raw discovery input");
    record(candidate, { type: "file", ...identity(stat, true) });
    return { rows, paths, file: candidate, missing: null, metadataBytes };
  }
  throw new Error("Unsupported directory discovery path input");
}

/** Bind path identity and exact bytes without importing or executing the file.
 * Absence also has a digest: null cannot attest the path leading to an absence.
 * Planned replacement is refused because its future inode is not knowable. */
export function hashDiscoveryPathFile(path: string, budget: DiscoveryByteBudget, changes?: Map<string, string>): string {
  const before = trace(path);
  let createsMissingPath = false;
  if (before.missing !== null && changes) {
    for (const target of changes.keys()) {
      if (target === before.missing || target.startsWith(before.missing + sep)) { createsMissingPath = true; break; }
    }
  }
  if (createsMissingPath || changes?.has(path) || before.paths.some(path => changes?.has(path))) throw new Error("Discovery path witness intersects a planned write; use bytes mode for owned configuration");
  const remaining = budget.pathMetadataRemaining ?? limits.discoveryPathTotalMetadataBytes;
  if (before.metadataBytes > remaining) throw new Error("Discovery path aggregate metadata limit exceeded");
  budget.pathMetadataRemaining = remaining - before.metadataBytes;
  const content = before.file === null ? null : hashRawDiscoveryFile(before.file, budget);
  if (before.file !== null && content === null) throw new Error("Discovery path input changed during read");
  const after = trace(path);
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows) || before.file !== after.file) throw new Error("Discovery path input changed during read");
  return createHash("sha256").update(JSON.stringify({ version: 1, path, rows: before.rows, content })).digest("hex");
}
