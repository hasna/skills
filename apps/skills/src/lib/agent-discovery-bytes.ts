import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";

export interface DiscoveryByteBudget { remaining: number; pathMetadataRemaining?: number }
export function discoveryByteBudget(): DiscoveryByteBudget { return { remaining: AGENT_POLICY_LIMITS.discoveryRawTotalBytes }; }
function safe(path: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path !== resolve(path) || path.length > AGENT_POLICY_LIMITS.pathCharacters || path.includes("\0")) throw new Error("Expected a canonical absolute raw discovery path");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Refusing symlink raw discovery input");
    if (dirname(cursor) === cursor) break;
  }
}
function same(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function consume(budget: DiscoveryByteBudget, bytes: number): void {
  if (bytes > budget.remaining) throw new Error("Raw discovery aggregate byte limit exceeded");
  budget.remaining -= bytes;
}
/** Hash exact bytes without decoding them or following links. The budget spans one capture/verification. */
export function hashRawDiscoveryFile(path: string, budget: DiscoveryByteBudget, changes?: Map<string, string>): string | null {
  safe(path);
  if (changes?.has(path)) {
    const text = changes.get(path)!, bytes = Buffer.byteLength(text);
    if (bytes > AGENT_POLICY_LIMITS.discoveryRawSourceBytes) throw new Error("Raw discovery file byte limit exceeded");
    consume(budget, bytes); return createHash("sha256").update(text).digest("hex");
  }
  const initial = lstatSync(path, { throwIfNoEntry: false });
  if (!initial) return null;
  if (!initial.isFile() || initial.size > AGENT_POLICY_LIMITS.discoveryRawSourceBytes) throw new Error("Unsupported or oversized raw discovery input");
  if (initial.size > budget.remaining) throw new Error("Raw discovery aggregate byte limit exceeded");
  // O_NONBLOCK also refuses a FIFO installed between lstat and open without hanging.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || !same(initial, opened)) throw new Error("Raw discovery input changed during open");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let bytes = 0;
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, AGENT_POLICY_LIMITS.discoveryRawSourceBytes - bytes + 1), null);
      if (!count) break;
      bytes += count;
      if (bytes > AGENT_POLICY_LIMITS.discoveryRawSourceBytes) throw new Error("Raw discovery file byte limit exceeded");
      consume(budget, count); hash.update(buffer.subarray(0, count));
    }
    const final = fstatSync(fd), current = lstatSync(path, { throwIfNoEntry: false });
    safe(path);
    if (!current?.isFile() || !same(opened, final) || !same(final, current) || bytes !== final.size) throw new Error("Raw discovery input changed during read");
    return hash.digest("hex");
  } finally { closeSync(fd); }
}
