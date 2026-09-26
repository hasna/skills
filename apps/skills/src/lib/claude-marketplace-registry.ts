/** Opt-in witness for Claude's known_marketplaces.json; no registration or payload exemptions. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const CLAUDE_MARKETPLACE_REGISTRY_LIMITS = Object.freeze({ bytes: 1024 * 1024, rows: 1024, depth: 32, nodes: 65536, stringCharacters: 16384, pathCharacters: 4096 });
export interface ClaudeMarketplaceRegistryBudget { remaining: number }
function need(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Claude marketplace registry ${reason}`);
}
function absolutePath(value: unknown): asserts value is string {
  need(typeof value === "string" && value.length > 0 && value.length <= CLAUDE_MARKETPLACE_REGISTRY_LIMITS.pathCharacters && !/[\x00-\x1f\x7f]/.test(value) && isAbsolute(value) && resolve(value) === value, "requires a normalized absolute path");
}
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function parents(path: string): Array<[string, BigIntStats]> {
  const result: Array<[string, BigIntStats]> = [];
  for (let at = dirname(path); ; at = dirname(at)) {
    const stat = lstatSync(at, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink(), "path traverses a symlink or non-directory");
    result.push([at, stat]);
    if (at === dirname(at)) return result;
  }
}
function readRegistry(path: string, budget: ClaudeMarketplaceRegistryBudget): string {
  absolutePath(path); need(basename(path) === "known_marketplaces.json", "requires known_marketplaces.json");
  need(Number.isSafeInteger(budget.remaining) && budget.remaining >= 0, "has an invalid byte budget");
  const ancestors = parents(path), initial = lstatSync(path, { bigint: true });
  need(initial.isFile() && !initial.isSymbolicLink() && initial.size <= BigInt(CLAUDE_MARKETPLACE_REGISTRY_LIMITS.bytes), "is not a bounded regular file");
  need(initial.size <= BigInt(budget.remaining), "exceeds its aggregate byte limit");
  // Nonblocking open also refuses a FIFO substituted after lstat without hanging.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    need(opened.isFile() && sameFile(initial, opened), "changed during open");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    need(current.isFile() && sameFile(opened, after) && sameFile(after, current) && BigInt(length) === opened.size, "changed during read");
    for (const [ancestor, before] of ancestors) {
      const now = lstatSync(ancestor, { bigint: true });
      need(now.isDirectory() && before.dev === now.dev && before.ino === now.ino && before.mode === now.mode, "parent changed during read");
    }
    budget.remaining -= length;
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error("Claude marketplace registry is not strict UTF-8"); }
  } finally { closeSync(fd); }
}

// A small tagged syntax tree rejects duplicate decoded keys and retains unknown
// numbers without rounding (including large integers and negative zero). Object
// order and number spelling remain conservatively bound; JSON whitespace does not.
type ObjectValue = { kind: "object"; entries: Array<[string, Value]> };
type Value = ObjectValue | { kind: "array"; items: Value[] } | { kind: "string"; value: string } | { kind: "number"; value: string } | { kind: "literal"; value: "true" | "false" | "null" } | { kind: "validated-update-time" };
function parse(text: string): ObjectValue {
  let at = 0, nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  function string(): string {
    need(text[at] === '"', "contains invalid JSON");
    const start = at++;
    while (at < text.length) {
      const character = text[at++]!;
      if (character === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, at)); } catch { throw new Error("Claude marketplace registry contains invalid JSON string"); }
        need(value.length <= CLAUDE_MARKETPLACE_REGISTRY_LIMITS.stringCharacters, "exceeds its string limit");
        return value;
      }
      if (character === "\\") at++;
    }
    throw new Error("Claude marketplace registry contains an unterminated JSON string");
  }
  function value(depth: number): Value {
    need(depth <= CLAUDE_MARKETPLACE_REGISTRY_LIMITS.depth && ++nodes <= CLAUDE_MARKETPLACE_REGISTRY_LIMITS.nodes, "exceeds its nesting or node limit");
    space();
    const character = text[at];
    if (character === '"') return { kind: "string", value: string() };
    if (character === "{" || character === "[") {
      at++; space();
      const object = character === "{", end = object ? "}" : "]", entries: ObjectValue["entries"] = [], items: Value[] = [], keys = new Set<string>();
      if (text[at] !== end) while (true) {
        if (object) {
          space(); const key = string();
          need(!keys.has(key), "contains a duplicate JSON key"); keys.add(key);
          space(); need(text[at++] === ":", "contains invalid JSON");
          entries.push([key, value(depth + 1)]);
        } else items.push(value(depth + 1));
        space(); if (text[at] === end) break;
        need(text[at++] === ",", "contains invalid JSON");
      }
      at++;
      return object ? { kind: "object", entries } : { kind: "array", items };
    }
    for (const literal of ["true", "false", "null"] as const) if (text.startsWith(literal, at)) { at += literal.length; return { kind: "literal", value: literal }; }
    numberPattern.lastIndex = at;
    const number = numberPattern.exec(text);
    need(number, "contains invalid JSON"); at += number[0].length;
    return { kind: "number", value: number[0] };
  }
  const root = value(0); space();
  need(at === text.length && root.kind === "object", "requires a JSON object without trailing content");
  need(root.entries.length <= CLAUDE_MARKETPLACE_REGISTRY_LIMITS.rows, "exceeds its marketplace row limit");
  return root;
}
function exactKeys(value: Value | undefined, keys: string[]): value is ObjectValue {
  return value?.kind === "object" && value.entries.length === keys.length && value.entries.every(([key]) => keys.includes(key));
}
const field = (object: ObjectValue, key: string): Value | undefined => object.entries.find(([name]) => name === key)?.[1];
function textField(value: Value | undefined): string {
  need(value?.kind === "string" && value.value.length > 0 && !/[\x00-\x1f\x7f]/.test(value.value), "contains an invalid recognized field");
  return value.value;
}
function normalizeRow(row: Value, version: 1 | 2 = 1): void {
  if (!exactKeys(row, ["source", "installLocation", "lastUpdated"])) {
    if (version !== 2 || !exactKeys(row, ["source", "installLocation", "lastUpdated", "autoUpdate"])) return;
    const autoUpdate = field(row, "autoUpdate");
    need(autoUpdate?.kind === "literal" && (autoUpdate.value === "true" || autoUpdate.value === "false"), "contains an invalid automatic-update preference");
    // Its value remains in the digest. Only lastUpdated is normalized.
  }
  const source = field(row, "source");
  if (source?.kind !== "object") return;
  const type = field(source, "source");
  if (type?.kind !== "string" || !["github", "directory"].includes(type.value)) return;
  const location = type.value === "github" ? "repo" : "path";
  if (!exactKeys(source, ["source", location])) return;
  const sourceLocation = textField(field(source, location));
  if (type.value === "directory") absolutePath(sourceLocation);
  absolutePath(textField(field(row, "installLocation")));
  const updated = textField(field(row, "lastUpdated"));
  // Exact canonical UTC milliseconds excludes ambiguous zones, rollover dates,
  // leap-second coercion, missing precision, and Date.parse's permissive inputs.
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updated), "contains an invalid recognized update timestamp");
  const millis = Date.parse(updated);
  need(Number.isFinite(millis) && new Date(millis).toISOString() === updated, "contains an invalid recognized update timestamp");
  row.entries = row.entries.map(([key, value]) => [key, key === "lastUpdated" ? { kind: "validated-update-time" } : value]);
}

/** Capture explicitly reviewed registry structure; never infer this mode from a raw-byte witness. */
export function captureClaudeMarketplaceRegistry(path: string, budget: ClaudeMarketplaceRegistryBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-marketplace-registry"; sha256: string } {
  const value = parse(readRegistry(path, budget));
  for (const [, row] of value.entries) normalizeRow(row);
  const sha256 = createHash("sha256").update("hasna.skills.claude-marketplace-registry.v1\0").update(JSON.stringify(value)).digest("hex");
  return { path, hashMode: "claude-marketplace-registry", sha256 };
}

/** Explicit v2 review also recognizes rows with a bound boolean autoUpdate. */
export function captureClaudeMarketplaceRegistryV2(path: string, budget: ClaudeMarketplaceRegistryBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-marketplace-registry-v2"; sha256: string } {
  const value = parse(readRegistry(path, budget));
  for (const [, row] of value.entries) normalizeRow(row, 2);
  const sha256 = createHash("sha256").update("hasna.skills.claude-marketplace-registry.v2\0").update(JSON.stringify(value)).digest("hex");
  return { path, hashMode: "claude-marketplace-registry-v2", sha256 };
}
