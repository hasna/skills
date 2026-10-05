/**
 * Codex vendor plugin cache acceptance.
 *
 * The Codex app materializes its curated remote plugins, skills included, under
 * `~/.codex/plugins/cache/openai-curated-remote/<plugin>/<version>/skills/<x>/`.
 * It refreshes that tree on its own schedule, after `skills hook install` has
 * reviewed the station, so the native skill guard kept stopping every Codex
 * session on a refreshed station (incident 806379).
 *
 * The owner-accepted exception is exactly that tree. A skill is accepted only
 * when its directory sits below the vendor root by lexical containment, by
 * real-path containment with no link anywhere between the two, and by the
 * on-disk spelling of the root. Every acceptance is written to a provenance
 * receipt in the Skills data directory. Nothing else changes: other `~/.codex`
 * trees, other plugin caches, sibling or lookalike directories, and links that
 * escape the tree still fail closed in the guard.
 */
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export const CODEX_VENDOR_CACHE_ROOT_SEGMENTS = [".codex", "plugins", "cache", "openai-curated-remote"] as const;
export const CODEX_VENDOR_CACHE_RECEIPT_SCHEMA = "skills.codex-vendor-cache-acceptance/v1";
export interface CodexVendorCacheSkill { path: string; hash: string }
export interface CodexVendorCacheAcceptance { schema: typeof CODEX_VENDOR_CACHE_RECEIPT_SCHEMA; root: string; acceptedAt: string; entries: CodexVendorCacheSkill[] }

/** The exact accepted root below a home. `canonical` applies the guard's own
 * system-alias and reviewed root-alias normalization; it never follows links. */
export function codexVendorCacheRoot(home: string, canonical: (path: string) => string = path => resolve(path)): string {
  return canonical(join(resolve(home), ...CODEX_VENDOR_CACHE_ROOT_SEGMENTS));
}

function realDirectory(path: string): boolean {
  // lstat: a link is never a directory here, whatever it points at.
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function contained(root: string, path: string): boolean {
  const inside = relative(root, path);
  return inside !== "" && !isAbsolute(inside) && inside.split(sep).every(segment => segment !== "..");
}

/** Accept one inventoried native skill only inside the exact vendor cache root. */
export function isAcceptedCodexVendorCacheSkill(entry: { agent: string; vendor: boolean; path: string }, root: string): boolean {
  try {
    if (entry.agent !== "codex" || !entry.vendor) return false;
    const expectedTail = CODEX_VENDOR_CACHE_ROOT_SEGMENTS.join(sep);
    if (!isAbsolute(root) || resolve(root) !== root || !root.endsWith(`${sep}${expectedTail}`)) return false;
    const path = entry.path;
    if (!isAbsolute(path) || resolve(path) !== path || !contained(root, path)) return false;
    // The root must exist under exactly this spelling: a case-folded or
    // normalization-folded lookup on APFS must not stand in for the real name.
    const parent = dirname(root);
    if (!realDirectory(parent) || !readdirSync(parent).includes(basename(root)) || !realDirectory(root)) return false;
    // Every directory from the skill up to the root is a real directory, and
    // the discovery document is a regular file, not a link.
    for (let cursor = path; cursor !== root; cursor = dirname(cursor)) {
      if (dirname(cursor) === cursor || !realDirectory(cursor)) return false;
    }
    if (lstatSync(join(path, "SKILL.md"), { throwIfNoEntry: false })?.isFile() !== true) return false;
    // Real-path containment: resolving every link must land on the same
    // places, so no link above or below the root can reach outside it.
    const realRoot = realpathSync.native(root), realPath = realpathSync.native(path);
    return realRoot === root && realPath === path && contained(realRoot, realPath);
  } catch { return false; }
}

export function codexVendorCacheReceiptPath(dataDir: string): string {
  return join(resolve(dataDir), "agent-hooks", "codex-vendor-cache-acceptance.json");
}

function isAcceptance(value: unknown): value is CodexVendorCacheAcceptance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === CODEX_VENDOR_CACHE_RECEIPT_SCHEMA && typeof record.root === "string" && typeof record.acceptedAt === "string"
    && Array.isArray(record.entries) && record.entries.every(entry => entry && typeof entry === "object" && typeof (entry as CodexVendorCacheSkill).path === "string" && typeof (entry as CodexVendorCacheSkill).hash === "string");
}

/** The last recorded acceptance, or null when none is readable. */
export function readCodexVendorCacheAcceptance(dataDir: string): CodexVendorCacheAcceptance | null {
  const path = codexVendorCacheReceiptPath(dataDir);
  if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) return null;
  try { const value = JSON.parse(readFileSync(path, "utf8")); return isAcceptance(value) ? value : null; } catch { return null; }
}

/** Record the accepted set. An unchanged set leaves the receipt untouched; a
 * changed set replaces it atomically. Throws when the receipt cannot be written. */
export function recordCodexVendorCacheAcceptance(dataDir: string, root: string, entries: readonly CodexVendorCacheSkill[]): string {
  const path = codexVendorCacheReceiptPath(dataDir);
  const sorted = entries.map(entry => ({ path: entry.path, hash: entry.hash })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const existing = readCodexVendorCacheAcceptance(dataDir);
  if (existing && existing.root === root && JSON.stringify(existing.entries) === JSON.stringify(sorted)) return path;
  const value: CodexVendorCacheAcceptance = { schema: CODEX_VENDOR_CACHE_RECEIPT_SCHEMA, root, acceptedAt: new Date().toISOString(), entries: sorted };
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!realDirectory(directory)) throw new Error(`Receipt directory is not a real directory: ${directory}`);
  const temporary = `${path}.skills-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
  return path;
}
