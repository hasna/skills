import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import type { PortableSkillManifest } from "./portable-skills-types.js";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { SkillEntryPaths } from "./skill-entry-path.js";

/**
 * Canonical content hashing for the hasna.skill.v1 portable bundle.
 *
 * The hash covers the normalized skill bundle: skill.json (blank-canonicalized —
 * its own `content_hash` field removed, keys sorted, line endings normalized)
 * plus SKILL.md and every file under src/, scripts/, assets/, and references/,
 * plus AGENTS.md, package.json, and tsconfig.json. Entries are sorted by
 * relative path and hash-stable across platforms (posix separators, LF
 * endings, sorted keys), so two checkouts of the same skill produce the same
 * hash regardless of OS or editor.
 *
 * Excluded, mirroring the port/copy rules: node_modules, .git, dist, build,
 * .turbo, dot-entries, and symlinks (symlinks are validation errors anyway).
 */

export const CONTENT_HASH_ALGORITHM = "sha256";
export const CONTENT_HASH_HEX_LENGTH = 64;

/** Top-level and nested directories that never belong to the hashed bundle. */
const HASH_EXCLUDE_DIRS = new Set([".git", "node_modules", "dist", "build", ".turbo"]);

function excludedHashEntry(name: string, directory: boolean): boolean {
  return name.startsWith(".") || (directory && HASH_EXCLUDE_DIRS.has(name));
}

/** Relative paths (from the skill root) covered by the hash. */
const HASH_COVERAGE = [
  "SKILL.md",
  "skill.json",
  "AGENTS.md",
  "package.json",
  "tsconfig.json",
  "src",
  "scripts",
  "assets",
  "references",
] as const;

/** Normalize CRLF/CR to LF for hash stability across platforms. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Blank-canonicalize a skill.json manifest for hashing: parse it, drop the
 * self-referencing `content_hash` field, and re-serialize with sorted keys so
 * key order and the hash's own presence never change the digest.
 */
export function canonicalizeManifest(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return normalizeLineEndings(raw);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return normalizeLineEndings(raw);
  }
  const record = parsed as Record<string, unknown>;
  delete record.content_hash;
  if (record.provenance && typeof record.provenance === "object" && !Array.isArray(record.provenance)) {
    delete (record.provenance as Record<string, unknown>).content_hash;
  }
  return `${JSON.stringify(sortObjectKeys(record), null, 2)}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeys(item));
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    // JSON keys are data, including __proto__; never invoke an inherited setter.
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record).sort()) sorted[key] = sortObjectKeys(record[key]);
    return sorted;
  }
  return value;
}

export interface BundleFile {
  /** Posix relative path from the skill root, e.g. `scripts/setup.sh`. */
  rel: string;
  /** Normalized text content for text files; raw buffer for binary files. */
  content: Uint8Array;
}

/** Whether a path looks like text (no NUL byte) so line-ending normalization is safe. */
function looksLikeText(buffer: Uint8Array): boolean {
  return !buffer.includes(0);
}

/**
 * Collect the normalized bundle files for a skill folder, sorted by relative
 * path. Only the documented coverage set is included.
 */
export function collectBundleFiles(skillPath: string): BundleFile[] {
  const files: BundleFile[] = [];
  const seen = new Set<string>();
  for (const entry of HASH_COVERAGE) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const absolute = join(skillPath, entry);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) collectDirectory(files, absolute, entry);
    else collectFile(files, absolute, entry);
  }
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function collectDirectory(files: BundleFile[], dir: string, rel: string): void {
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".")) continue;
    const absolute = join(dir, entry);
    const childRel = `${rel}/${entry}`;
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      if (excludedHashEntry(entry, true)) continue;
      collectDirectory(files, absolute, childRel);
    } else if (stats.isFile()) {
      collectFile(files, absolute, childRel);
    }
  }
}

function collectFile(files: BundleFile[], absolute: string, rel: string): void {
  const buffer = readFileSync(absolute);
  files.push(normalizeBundleFile(rel.split(sep).join("/"), buffer));
}

function normalizeBundleFile(rel: string, buffer: Uint8Array): BundleFile {
  if (rel === "skill.json") {
    return { rel, content: new TextEncoder().encode(canonicalizeManifest(new TextDecoder().decode(buffer))) };
  }
  if (looksLikeText(buffer)) {
    const normalized = normalizeLineEndings(new TextDecoder().decode(buffer));
    return { rel, content: new TextEncoder().encode(normalized) };
  }
  return { rel, content: buffer };
}

/**
 * Compute the canonical content hash of a skill folder. Stable across
 * platforms: sorted posix paths, LF line endings, canonicalized manifest.
 */
export function computeContentHash(skillPath: string): string {
  return hashBundleFiles(collectBundleFiles(skillPath));
}

function* bundleHashParts(files: readonly BundleFile[]): Generator<Uint8Array> {
  for (const file of files) {
    yield new TextEncoder().encode(file.rel);
    yield new TextEncoder().encode(`\0${file.content.length}\0`);
    yield file.content;
    yield new TextEncoder().encode("\0");
  }
  yield new TextEncoder().encode("\0");
}

function hashBundleFiles(files: readonly BundleFile[]): string {
  const hash = createHash(CONTENT_HASH_ALGORITHM);
  for (const part of bundleHashParts(files)) hash.update(part);
  return hash.digest("hex");
}

async function hashBundleFilesCooperatively(files: readonly BundleFile[], check: () => void): Promise<string> {
  const hash = createHash(CONTENT_HASH_ALGORITHM);
  let bytesSinceYield = 0;
  for (const part of bundleHashParts(files)) {
    for (let offset = 0; offset < part.byteLength; offset += 64 * 1024) {
      check();
      const chunk = part.subarray(offset, offset + 64 * 1024);
      hash.update(chunk);
      bytesSinceYield += chunk.byteLength;
      if (bytesSinceYield >= 256 * 1024) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        bytesSinceYield = 0;
      }
    }
  }
  check();
  return hash.digest("hex");
}

export interface ContentHashVerification {
  /** Whether the skill declares a content_hash at all. */
  declared: boolean;
  /** Whether the declared hash is present, well-formed, and matches the bundle. */
  valid: boolean;
  /** The declared value, if any. */
  declaredHash?: string;
  /** The recomputed hash over the current bundle. */
  computedHash?: string;
}

export interface ContentHashLimits {
  entries: number;
  rawBytes: number;
  normalizedBytes: number;
  fileBytes: number;
  normalizedFileBytes: number;
  pathBytes: number;
  manifestBytes: number;
  manifestDepth: number;
  timeoutMs: number;
}

/** Hard ceilings for the entry API. Callers may tighten these, never disable them. */
export const CONTENT_HASH_LIMITS: Readonly<ContentHashLimits> = Object.freeze({
  entries: 1024,
  rawBytes: 64 * 1024 * 1024,
  normalizedBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  normalizedFileBytes: 16 * 1024 * 1024,
  pathBytes: 100,
  manifestBytes: 16 * 1024,
  manifestDepth: 64,
  timeoutMs: 5000,
});

export interface ContentHashOptions {
  limits?: Partial<ContentHashLimits>;
  signal?: AbortSignal;
}

export type ContentHashInputErrorCode = "CONTENT_HASH_INVALID" | "CONTENT_HASH_LIMIT" | "CONTENT_HASH_ABORTED" | "CONTENT_HASH_TIMEOUT";
export class ContentHashInputError extends Error {
  constructor(readonly code: ContentHashInputErrorCode, message: string) {
    super(message);
    this.name = "ContentHashInputError";
  }
}

function invalidContent(message = "Invalid content hash input"): never {
  throw new ContentHashInputError("CONTENT_HASH_INVALID", message);
}
function contentLimit(message: string): never {
  throw new ContentHashInputError("CONTENT_HASH_LIMIT", message);
}

/** Ordinary data records only; accessor properties are refused without invoking them. */
function contentRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidContent();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) invalidContent();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalidContent("Accessor content hash input is unsupported");
    result[key] = descriptor.value;
  }
  return result;
}

function contentOptions(options: ContentHashOptions): { limits: ContentHashLimits; signal?: AbortSignal } {
  const record = contentRecord(options, ["limits", "signal"]);
  const limits = { ...CONTENT_HASH_LIMITS };
  if (record.limits !== undefined) {
    const supplied = contentRecord(record.limits, Object.keys(limits));
    for (const key of Object.keys(supplied) as (keyof ContentHashLimits)[]) {
      const value = supplied[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > limits[key]) contentLimit("Invalid content hash limit");
      limits[key] = value;
    }
  }
  if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) invalidContent("Invalid content hash signal");
  return { limits, signal: record.signal as AbortSignal | undefined };
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;

function snapshotContentEntries(entries: readonly SkillBundleEntry[], limits: ContentHashLimits, check: () => void): SkillBundleEntry[] {
  if (!Array.isArray(entries)) invalidContent("Content hash entries must be an array");
  if (entries.length > limits.entries) contentLimit("Content hash entry limit exceeded");
  if (Reflect.ownKeys(entries).length !== entries.length + 1) invalidContent("Invalid content hash entry array");
  const snapshot: SkillBundleEntry[] = [];
  const paths = new SkillEntryPaths();
  let rawBytes = 0;
  for (let index = 0; index < entries.length; index++) {
    check();
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor || !("value" in descriptor)) invalidContent("Invalid content hash entry array");
    const entry = contentRecord(descriptor.value, ["path", "bytes", "mode"]);
    if (typeof entry.path !== "string" || typeof entry.mode !== "number" || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) invalidContent("Invalid regular-file content hash entry");
    paths.add(entry.path, limits.pathBytes, invalidContent, () => contentLimit("Content hash path limit exceeded"));
    if (!(entry.bytes instanceof Uint8Array) || !ArrayBuffer.isView(entry.bytes)) invalidContent("Content hash entry requires bytes");
    const size: number = byteLengthOf.call(entry.bytes);
    if (!(bufferOf.call(entry.bytes) instanceof ArrayBuffer)) invalidContent("Shared content hash bytes are unsupported");
    if (size > limits.fileBytes || rawBytes + size > limits.rawBytes) contentLimit("Content hash raw byte limit exceeded");
    if (entry.path === "skill.json" && size > limits.manifestBytes) contentLimit("Content hash manifest byte limit exceeded");
    rawBytes += size;
    const bytes = new Uint8Array(new ArrayBuffer(size));
    bytes.set(entry.bytes);
    snapshot.push({ path: entry.path, bytes, mode: entry.mode });
  }
  check();
  return snapshot;
}

/** Match the directory collector, not the archive packer's different exclusions. */
function coveredContentPath(path: string): boolean {
  const segments = path.split("/");
  if (!(HASH_COVERAGE as readonly string[]).includes(segments[0]!)) return false;
  return !segments.slice(1).some((segment, index) => excludedHashEntry(segment, index < segments.length - 2));
}

function boundedManifest(raw: string, maxDepth: number): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return undefined; }
  const pending = [{ value: parsed, depth: 1 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    if (depth > maxDepth) contentLimit("Content hash manifest depth limit exceeded");
    for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  return parsed;
}

async function hashContentEntries(entries: readonly SkillBundleEntry[], options: ContentHashOptions): Promise<{ hash: string; manifest: unknown }> {
  const { limits, signal } = contentOptions(options);
  const deadline = performance.now() + limits.timeoutMs;
  let terminal: ContentHashInputError | undefined;
  const abort = () => { terminal ??= new ContentHashInputError("CONTENT_HASH_ABORTED", "Content hashing aborted"); };
  const timer = setTimeout(() => { terminal ??= new ContentHashInputError("CONTENT_HASH_TIMEOUT", "Content hashing deadline exceeded"); }, limits.timeoutMs);
  const check = () => {
    if (signal?.aborted) abort();
    if (terminal) throw terminal;
    if (performance.now() >= deadline) throw new ContentHashInputError("CONTENT_HASH_TIMEOUT", "Content hashing deadline exceeded");
  };
  try {
    signal?.addEventListener("abort", abort, { once: true });
    check();
    // All caller bytes are captured before the first yield. Shared buffers are refused.
    const snapshot = snapshotContentEntries(entries, limits, check);
    const normalized: BundleFile[] = [];
    let normalizedBytes = 0;
    let manifest: unknown;
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const entry of snapshot) {
      check();
      if (!coveredContentPath(entry.path)) continue;
      if (entry.path === "skill.json") manifest = boundedManifest(new TextDecoder().decode(entry.bytes), limits.manifestDepth);
      const file = normalizeBundleFile(entry.path, entry.bytes);
      check();
      if (file.content.byteLength > limits.normalizedFileBytes || normalizedBytes + file.content.byteLength > limits.normalizedBytes) contentLimit("Content hash normalized byte limit exceeded");
      normalizedBytes += file.content.byteLength;
      normalized.push(file);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    normalized.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
    check();
    return { hash: await hashBundleFilesCooperatively(normalized, check), manifest };
  } catch (error) {
    if (error instanceof ContentHashInputError) throw error;
    throw new ContentHashInputError("CONTENT_HASH_INVALID", "Invalid content hash input");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Hash bounded ordinary regular-file entries without filesystem access or extraction.
 * Entries are revalidated and copied, even if supplied by inspectSkillBundle. This is
 * content identity, not manifest validity, permission to execute, or a JS sandbox.
 * Text uses the directory oracle's nonfatal UTF-8/LF normalization. Excluded paths
 * still count toward input limits and collision checks. Inputs are never mutated.
 */
export async function computeContentHashFromEntries(entries: readonly SkillBundleEntry[], options: ContentHashOptions = {}): Promise<string> {
  return (await hashContentEntries(entries, options)).hash;
}

/** Verify only the declaration in the same owned skill.json, never a second manifest. */
export async function verifyContentHashFromEntries(entries: readonly SkillBundleEntry[], options: ContentHashOptions = {}): Promise<ContentHashVerification> {
  const { hash, manifest } = await hashContentEntries(entries, options);
  const provenance = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? (manifest as Record<string, unknown>).provenance : undefined;
  const value = provenance && typeof provenance === "object" && !Array.isArray(provenance) ? (provenance as Record<string, unknown>).content_hash : undefined;
  if (value !== undefined && typeof value !== "string") invalidContent("Invalid content hash declaration");
  const declaredHash = (value as string | undefined)?.trim() || undefined;
  if (!declaredHash) return { declared: false, valid: false };
  if (!/^[a-f0-9]{64}$/.test(declaredHash)) return { declared: true, valid: false, declaredHash };
  return { declared: true, valid: hash === declaredHash, declaredHash, computedHash: hash };
}

/**
 * Verify a skill folder's declared content_hash against the recomputed
 * canonical hash of the current bundle. A missing declaration or a mismatch
 * fails; a malformed declaration fails.
 */
export function verifyContentHash(skillPath: string, manifest?: PortableSkillManifest): ContentHashVerification {
  const declaredHash = manifest?.provenance?.content_hash?.trim() || undefined;
  if (!declaredHash) return { declared: false, valid: false };
  if (!/^[a-f0-9]{64}$/.test(declaredHash)) {
    return { declared: true, valid: false, declaredHash };
  }
  const computedHash = computeContentHash(skillPath);
  return {
    declared: true,
    valid: computedHash === declaredHash,
    declaredHash,
    computedHash,
  };
}

/** Path sanity helper used by the contract validator: the skill folder exists. */
export function skillFolderExists(skillPath: string): boolean {
  try {
    return existsSync(skillPath) && statSync(skillPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Canonical SKILL.md document hash for home-vs-corpus comparison.
 *
 * The bundle-wide hash above covers a whole skill folder; agent home
 * directories carry only a SKILL.md, so the home comparison hashes exactly
 * that one document. The normalization is the canonical one: LF line endings
 * (LF-invariant, so the same document hashes identically across platforms),
 * with the single agent-adaptation delta removed — `user_invocable` frontmatter
 * lines, which `sync` injects for Claude and strips for every other agent.
 * Two copies that differ only in those two ways hash identically, so an
 * unmarked home copy that matches the canonical SKILL.md modulo adaptation is
 * recognised as an exact match.
 */
export function canonicalAgentSkillMarkdown(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return normalizeLineEndings(content);
  const lines = match[1].split(/\r?\n/).filter((line) => !/^\s*user_invocable\s*:/i.test(line));
  return `---\n${lines.join("\n")}\n---\n${normalizeLineEndings(content.slice(match[0].length))}`;
}

/** Canonical hash of a SKILL.md document (modulo LF endings and user_invocable). */
export function hashSkillMarkdown(content: string): string {
  const hash = createHash(CONTENT_HASH_ALGORITHM);
  hash.update(canonicalAgentSkillMarkdown(content));
  return hash.digest("hex");
}

/** Canonical hash of the SKILL.md at `path`. */
export function hashSkillMarkdownFile(path: string): string {
  return hashSkillMarkdown(readFileSync(path, "utf-8"));
}
