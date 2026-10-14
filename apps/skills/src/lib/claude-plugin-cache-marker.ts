/** Claude-owned version-root metadata, never a producer-tree exemption. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import type { DiscoveryByteBudget } from "./agent-discovery-bytes.js";

export const CLAUDE_ORPHAN_MARKER_MODE = "claude-plugin-orphaned-at-v1" as const;
const CACHE = `${sep}.claude${sep}plugins${sep}cache${sep}`;

/** True only for `<...>/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.orphaned_at`
 * with exactly one cache segment in the path. Every other path, including a
 * marker at another depth, keeps its ordinary exact witness. */
export function isClaudePluginCacheOrphanMarker(path: string): boolean {
  if (typeof path !== "string" || basename(path) !== ".orphaned_at" || !isAbsolute(path) || resolve(path) !== path || path.includes("\0")) return false;
  const at = path.indexOf(CACHE);
  if (at < 0 || path.indexOf(CACHE, at + 1) >= 0) return false;
  const parts = path.slice(at + CACHE.length).split(sep);
  return parts.length === 4 && parts.every(part => part && part !== "." && part !== "..");
}

function same(left: Stats, right: Stats | undefined): boolean {
  return Boolean(right && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.uid === right.uid && left.mode === right.mode && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs);
}

function safe(path: string): void {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Refusing symlink Claude orphan marker input");
    if (dirname(cursor) === cursor) break;
  }
}

/** Validate on every capture and check; only presence enters the digest.
 * Claude rewrites the timestamp (and may replace the inode) between checks,
 * so neither is bound, but the file may not change during one read. */
export function hashClaudePluginCacheOrphanMarker(path: string, budget?: DiscoveryByteBudget, changes?: Map<string, string>): string | null {
  if (!isClaudePluginCacheOrphanMarker(path)) throw new Error("Expected a Claude plugin-cache version-root orphan marker");
  if (changes?.has(path)) throw new Error("Claude orphan markers cannot intersect a planned write");
  safe(path);
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (!before) return null;
  const uid = process.getuid?.();
  if (!before.isFile() || uid === undefined || before.uid !== uid || before.size > 32) throw new Error("Invalid Claude orphan marker file or owner");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!same(before, opened)) throw new Error("Claude orphan marker changed during open");
    const bytes = Buffer.alloc(33); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    // latin1 maps each byte to one code point, so non-ASCII bytes, a BOM or a
    // trailing newline can never satisfy the 13-digit pattern.
    if (!/^[1-9][0-9]{12}$/.test(bytes.subarray(0, length).toString("latin1"))) throw new Error("Malformed Claude orphan marker timestamp");
    const after = fstatSync(fd), current = lstatSync(path, { throwIfNoEntry: false });
    safe(path);
    if (!same(opened, after) || !same(after, current) || length !== after.size) throw new Error("Claude orphan marker changed during read");
    if (budget) {
      if (length > budget.remaining) throw new Error("Raw discovery aggregate byte limit exceeded");
      budget.remaining -= length;
    }
    return createHash("sha256").update(`${CLAUDE_ORPHAN_MARKER_MODE}\0${path}\0file`).digest("hex");
  } finally { closeSync(fd); }
}
