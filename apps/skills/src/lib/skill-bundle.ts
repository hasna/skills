/**
 * Packing a portable skill directory into a single transferable, content-addressed blob.
 *
 * The format is a gzipped POSIX ustar archive, written here rather than shelled out to
 * `tar`. Shelling out would make packing depend on which tar is installed - GNU and BSD
 * disagree about extended headers, ordering, and what they put in the mtime and uid
 * fields - and the digest of the result is the skill's identity on the server, so two
 * machines packing the same source must produce the same bytes.
 *
 * Everything that could vary without the content varying is pinned:
 *   - entries sorted by path, so readdir order cannot change the archive
 *   - mtime 0, uid/gid 0, empty uname/gname
 *   - mode normalised to 0755 for anything executable by its owner, 0644 otherwise
 * so `packSkillBundle()` over unchanged sources is byte-identical, and a changed digest
 * means changed content.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createGunzip, type ZlibOptions } from "node:zlib";
import type { TransformOptions } from "node:stream";
import { SkillEntryPaths } from "./skill-entry-path.js";

/** ustar block size. Every header and every file body is padded up to a multiple of it. */
const BLOCK = 512;

/**
 * Never packed, at any depth: VCS metadata, dependency trees, editor and OS sidecars, and
 * the well-known credential directories.
 *
 * Mirrors ANY_SEGMENT_COPY_EXCLUDES in portable-skills.ts - a bundle should contain what
 * `skills port` would have copied - plus `.aws`, `.ssh`, `.gnupg`, and `.docker`, because
 * a per-file denylist cannot see `.aws/credentials`: the file is called `credentials`,
 * which is not a name anything can safely exclude on its own.
 */
// Entries are lowercase because every lookup lowercases its key; a mixed-case entry here
// is an entry that can never match, which is how `.DS_Store` briefly stopped being excluded.
const ANY_SEGMENT_EXCLUDES = new Set([
  ".git",
  ".ds_store",
  ".system",
  "node_modules",
  ".aws",
  ".ssh",
  ".gnupg",
  ".docker",
]);

/** Build output, excluded only at the skill root. A nested references/build/ is content. */
const ROOT_EXCLUDES = new Set(["dist", "build", ".turbo"]);

/**
 * Tool-owned sidecars, excluded only at the skill root. The sync provenance marker
 * (pull.ts PULL_MARKER_FILE) sits inside the corpus skill directory and must never change
 * the bundle digest or travel into a published bundle when a pulled skill is re-pushed:
 * a pulled skill's repack must equal its remote digest. The sync cursor lives at the
 * corpus root, never inside a skill directory, so it is deliberately not excluded here.
 */
// Dependency preparation state belongs to this local runtime, never the source bundle.
const TOOL_SIDECAR_FILENAMES = new Set([".hasna-skills.json", ".skills-dependency-preparation"]);

/**
 * Filenames that routinely hold live credentials. A superset of RESERVED_SKILL_ENTRIES in
 * skill-validation.ts, which is where a skill author first hears about them.
 */
const CREDENTIAL_FILENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".envrc",
  ".pgpass",
  ".git-credentials",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

/** Extensions that are almost always a private key or a keystore, never skill content. */
const CREDENTIAL_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

/** Documentation templates: names, not values. Kept. */
const ENV_TEMPLATE_NAMES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);

/**
 * Extensions that make an `env.*` name source, data, or an asset rather than a dotenv file.
 *
 * A dotenv file's suffix names an ENVIRONMENT - `env.local`, `env.production`, `env.ci` -
 * and an environment name is never a file type. So a dotless `env.<x>` is a credential file
 * unless `<x>` is one of these recognised extensions, which is what keeps `env.ts`,
 * `env.mjs`, `env.json`, and `env.config.js` (all common config-module names) in the bundle
 * while still dropping every real dotenv file, including custom-named ones like `env.qa`.
 * Erring toward exclusion for unrecognised suffixes keeps the security posture: a stray
 * `env.<unknown>` is over-excluded, never leaked.
 */
const NON_DOTENV_EXTENSIONS = new Set([
  // code
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "json5",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp",
  "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "lua", "pl", "pm",
  "r", "jl", "dart", "ex", "exs", "scala", "clj", "cljs", "groovy", "gradle", "vb", "fs",
  // data / config / markup
  "yaml", "yml", "toml", "ini", "xml", "csv", "tsv", "html", "htm", "css", "scss", "sass",
  "less", "md", "mdx", "txt", "rst", "adoc", "sql", "graphql", "gql", "proto", "d",
  // assets
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "pdf", "woff", "woff2",
  "ttf", "otf", "eot", "mp3", "mp4", "wav", "webm", "zip", "gz", "tar", "wasm",
]);

/**
 * True for a dotenv file - one that holds live environment values - by either spelling:
 *   - dotted:  `.env`, `.env.local`, `.env.production` (the standard; matched broadly,
 *     because nobody writes source as a leading-dot `.env.ts`)
 *   - dotless: `env`, `env.local`, `env.production` (a rarer variant some tools emit)
 *
 * The trap the dotless arm has to avoid is source that merely shares the `env.` prefix:
 * `env.ts`, `env.mjs`, `env.json`, `env.config.js` are config modules, not secrets. They
 * are separated by their extension - a real dotenv suffix is an environment name, never a
 * code/data extension - so a dotless `env.<x>` is a dotenv file only when `<x>` is not a
 * recognised file type. A directory named `env/` is not a file at all and is never passed
 * here; the caller filters credentials on regular files only.
 */
function isDotenvFile(lower: string): boolean {
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (lower === "env") return true;
  if (lower.startsWith("env.")) {
    const extension = lower.slice(lower.lastIndexOf(".") + 1);
    return !NON_DOTENV_EXTENSIONS.has(extension);
  }
  return false;
}

/**
 * Credential-bearing files, excluded at ANY depth.
 *
 * Not a tidiness rule, and not redundant with validation. `skills push` uploads to a
 * server other people can read, and validateSkillDirectory()'s reserved-file check looks
 * only at the skill's TOP LEVEL and only at the exact name `.env` - so `.env.local`,
 * `.env.production`, `references/.env`, and `.envrc` all pass validation and would have
 * been packed and published. This is the layer that catches them.
 *
 * Matched case-insensitively. macOS and Windows filesystems are case-insensitive, so a
 * file created as `.env` is reachable and committable as `.ENV`; an exact-case denylist
 * is one `shift` key away from being no denylist at all.
 *
 * Meant for regular files only. `walk()` calls it after the directory branch, so a
 * directory named `env/` or `credentials/` is treated as content and recursed into rather
 * than pruned whole - the collateral damage a name-only check would otherwise do to a
 * whole subtree.
 */
function isCredentialFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (ENV_TEMPLATE_NAMES.has(lower)) return false;
  if (isDotenvFile(lower)) return true;
  if (CREDENTIAL_FILENAMES.has(lower)) return true;
  return CREDENTIAL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Bytes backed by an ArrayBuffer this process owns.
 *
 * Spelled out rather than left as a bare `Uint8Array` because Node's readFileSync and
 * Bun's gzipSync return views over pooled or shared buffers, and passing one of those to
 * `new Response(...)` or letting it outlive the call is how a view ends up describing
 * bytes that belong to something else.
 */
export type OwnedBytes = Uint8Array<ArrayBuffer>;

/** Copy any byte view into a buffer of its own. */
export function ownBytes(view: Uint8Array | ArrayBuffer): OwnedBytes {
  const source = view instanceof ArrayBuffer ? new Uint8Array(view) : view;
  const out = new Uint8Array(new ArrayBuffer(source.byteLength));
  out.set(source);
  return out;
}

export interface SkillBundleEntry {
  path: string;
  bytes: OwnedBytes;
  mode: number;
}

export interface PackedSkillBundle {
  /** The gzipped tar. This is what is uploaded and what the digest is taken over. */
  bytes: OwnedBytes;
  /** Lowercase hex sha-256 of `bytes`. The skill's content address. */
  sha256: string;
  fileCount: number;
  /** Total uncompressed size of the packed files, for a size limit that means something. */
  unpackedByteSize: number;
  /** Relative paths included, sorted. Surfaced so `push --dry-run` can show them. */
  paths: string[];
}

export interface PackSkillBundleOptions {
  /** Reject before compressing when the sources exceed this. 0 disables the check. */
  maxUnpackedBytes?: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Collect the files a bundle would contain, in archive order. */
export function collectSkillBundleEntries(dir: string): SkillBundleEntry[] {
  const entries: SkillBundleEntry[] = [];
  walk(dir, dir, entries);
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function walk(root: string, current: string, out: SkillBundleEntry[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).split("\\").join("/");
    const isRootLevel = !rel.includes("/");
    if (ANY_SEGMENT_EXCLUDES.has(entry.name.toLowerCase())) continue;
    if (isRootLevel && ROOT_EXCLUDES.has(entry.name.toLowerCase())) continue;
    if (isRootLevel && TOOL_SIDECAR_FILENAMES.has(entry.name.toLowerCase())) continue;
    if (entry.name.startsWith("._")) continue;
    // Symlinks are skipped rather than followed or recorded. A recorded link can point
    // outside the extraction root, and following one can pull in an entire home
    // directory through a stray link in a skill folder.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(root, absolute, out);
      continue;
    }
    if (!entry.isFile()) continue;
    // Credential exclusion runs on regular files only. Evaluating it before the directory
    // branch above would prune a whole subtree named `env/` (or `credentials/`) before it
    // could be recursed, dropping legitimate source with no warning; a credential is a
    // file, so this is where the check belongs.
    if (isCredentialFile(entry.name)) continue;
    const stats = statSync(absolute);
    out.push({
      path: rel,
      bytes: ownBytes(readFileSync(absolute)),
      mode: stats.mode & 0o100 ? 0o755 : 0o644,
    });
  }
}

export function packSkillBundle(dir: string, options: PackSkillBundleOptions = {}): PackedSkillBundle {
  const entries = collectSkillBundleEntries(dir);
  if (entries.length === 0) {
    throw new Error(`Nothing to pack: ${dir} contains no files after exclusions (.git, node_modules, dist, .env)`);
  }
  const unpackedByteSize = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  const max = options.maxUnpackedBytes ?? 0;
  if (max > 0 && unpackedByteSize > max) {
    throw new Error(`Skill sources are ${unpackedByteSize} bytes, over the ${max} byte limit. Remove build output or large fixtures.`);
  }

  const tar = writeTar(entries);
  const bytes = canonicalGzip(tar);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    fileCount: entries.length,
    unpackedByteSize,
    paths: entries.map((entry) => entry.path),
  };
}

/**
 * gzip whose bytes depend only on the input.
 *
 * `Bun.gzipSync(tar)` alone is not content-addressable across machines: the compression
 * level is a default that a runtime upgrade may change, and zlib stamps the member header
 * with an MTIME (bytes 4-7) and the *build platform's* OS byte (byte 9, 0x03 on Linux).
 * Two machines packing identical sources would then publish the same skill under two
 * digests. Pinning the level and blanking both fields - 0 for MTIME, 0xFF for "unknown
 * OS", both of which every decompressor accepts - makes the output a function of the tar.
 *
 * The deflate stream itself is still zlib's, so this is determinism for a given zlib
 * implementation rather than a format guarantee for all time.
 */
function canonicalGzip(tar: OwnedBytes): OwnedBytes {
  const bytes = ownBytes(Bun.gzipSync(tar, { level: 6 }));
  if (bytes.byteLength >= 10) {
    bytes[4] = 0; bytes[5] = 0; bytes[6] = 0; bytes[7] = 0;
    bytes[9] = 0xff;
  }
  return bytes;
}

/** Legacy synchronous reader for trusted inputs. Unbounded; use inspectSkillBundle for uploads. */
export function unpackSkillBundle(bundle: Uint8Array): SkillBundleEntry[] {
  return readTar(ownBytes(Bun.gunzipSync(ownBytes(bundle))));
}

function writeTar(entries: SkillBundleEntry[]): OwnedBytes {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    blocks.push(ustarHeader(entry));
    blocks.push(entry.bytes);
    const remainder = entry.bytes.byteLength % BLOCK;
    if (remainder !== 0) blocks.push(new Uint8Array(new ArrayBuffer(BLOCK - remainder)));
  }
  // Two zero blocks terminate a tar archive.
  blocks.push(new Uint8Array(new ArrayBuffer(BLOCK * 2)));
  return concat(blocks);
}

function ustarHeader(entry: SkillBundleEntry): OwnedBytes {
  const header = new Uint8Array(new ArrayBuffer(BLOCK));
  const encoder = new TextEncoder();
  const put = (offset: number, length: number, value: string) => {
    const encoded = encoder.encode(value);
    if (encoded.byteLength > length) {
      throw new Error(`Cannot pack '${entry.path}': field does not fit in a ustar header (${encoded.byteLength} > ${length})`);
    }
    header.set(encoded, offset);
  };
  // ustar splits a long path across prefix(155) + name(100). Supporting the split adds a
  // second way to spell the same path and therefore a second possible digest for the same
  // content, so long paths are refused instead.
  if (encoder.encode(entry.path).byteLength > 100) {
    throw new Error(`Cannot pack '${entry.path}': path is longer than the 100 bytes a ustar header holds`);
  }

  put(0, 100, entry.path);
  put(100, 8, `${entry.mode.toString(8).padStart(7, "0")}\0`);
  put(108, 8, "0000000\0"); // uid
  put(116, 8, "0000000\0"); // gid
  put(124, 12, `${entry.bytes.byteLength.toString(8).padStart(11, "0")}\0`);
  put(136, 12, `${(0).toString(8).padStart(11, "0")}\0`); // mtime, pinned to the epoch
  put(148, 8, "        "); // checksum placeholder: spaces, per the format
  put(156, 1, "0"); // typeflag: regular file
  put(257, 6, "ustar\0");
  put(263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  put(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function readTar(tar: OwnedBytes): SkillBundleEntry[] {
  const decoder = new TextDecoder();
  const entries: SkillBundleEntry[] = [];
  let offset = 0;
  let terminated = false;
  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      terminated = true;
      break;
    }
    const path = trimNul(decoder.decode(header.subarray(0, 100)));
    assertSafeEntryPath(path);
    // Regular files only. Byte 156 is the ustar typeflag, and every other value is a
    // thing this format can carry that a skill bundle has no business containing: a
    // symlink ('2') or hardlink ('1') pointing wherever the archive's author chose, or a
    // GNU '././@LongLink' ('L') header whose *body* is the real path - which would walk
    // straight past assertSafeEntryPath, since the header path it checks is the
    // harmless-looking placeholder.
    const typeflag = String.fromCharCode(header[156]!);
    if (typeflag !== "0" && typeflag !== "\0") {
      throw new Error(`unsafe bundle entry '${path}': only regular files are allowed, found tar type '${typeflag}'`);
    }
    const mode = Number.parseInt(trimNul(decoder.decode(header.subarray(100, 108))).trim() || "0", 8);
    const size = Number.parseInt(trimNul(decoder.decode(header.subarray(124, 136))).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`corrupt bundle: unreadable size for '${path}'`);
    offset += BLOCK;
    if (offset + size > tar.byteLength) throw new Error(`corrupt bundle: '${path}' claims ${size} bytes past the end of the archive`);
    entries.push({ path, mode, bytes: ownBytes(tar.subarray(offset, offset + size)) });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  // An archive that simply runs out is NOT an archive that ended.
  //
  // Without this the loop's own exit condition doubled as a success condition, so a
  // bundle truncated in transit or in storage unpacked to however many whole entries
  // survived and reported no error at all - a skill silently missing its last files,
  // which is worse than a skill that failed to arrive.
  if (!terminated) {
    throw new Error("corrupt bundle: the archive ends without its terminating blocks, so it is truncated");
  }
  return entries;
}

/**
 * Refuse an entry path that could escape an extraction root.
 *
 * Enforced on READ, not only on write, because the writer is ours and the reader's input
 * is a file downloaded from a server. `skills pull` does not exist yet, and this is the
 * point of the check: the traversal hole is closed before there is an extractor to
 * exploit, rather than left for whoever writes it to remember.
 */
function assertSafeEntryPath(path: string): void {
  if (!path) throw new Error("corrupt bundle: an entry has an empty path");
  const normalized = path.split("\\").join("/");
  if (normalized.startsWith("/")) throw new Error(`unsafe bundle entry '${path}': absolute paths are not allowed`);
  if (/^[A-Za-z]:/.test(normalized)) throw new Error(`unsafe bundle entry '${path}': drive-qualified paths are not allowed`);
  const segments = normalized.split("/");
  if (segments.includes("..")) throw new Error(`unsafe bundle entry '${path}': '..' is not allowed`);
}

function trimNul(value: string): string {
  const end = value.indexOf("\0");
  return end === -1 ? value : value.slice(0, end);
}

function concat(chunks: Uint8Array[]): OwnedBytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}


/** Hard ceilings. Callers may tighten these limits, never disable or raise them. */
export interface SkillBundleInspectionLimits {
  compressedBytes: number;
  decompressedBytes: number;
  entries: number;
  fileBytes: number;
  pathBytes: number;
  timeoutMs: number;
}
export const SKILL_BUNDLE_INSPECTION_LIMITS: Readonly<SkillBundleInspectionLimits> = Object.freeze({
  compressedBytes: 16 * 1024 * 1024,
  decompressedBytes: 64 * 1024 * 1024,
  entries: 1024,
  fileBytes: 16 * 1024 * 1024,
  pathBytes: 100,
  timeoutMs: 5000,
});

export interface InspectSkillBundleOptions {
  limits?: Partial<SkillBundleInspectionLimits>;
  signal?: AbortSignal;
}
export interface InspectedSkillBundle {
  /** Each body has its own buffer. No path has been written or executed. */
  entries: SkillBundleEntry[];
  /** Hash of the complete owned compressed snapshot, not of extracted files. */
  sha256: string;
  compressedByteSize: number;
  /** Includes headers, body padding, terminators and trailing zero padding. */
  decompressedByteSize: number;
  unpackedByteSize: number;
  fileCount: number;
}
export type SkillBundleInspectionErrorCode = "BUNDLE_INVALID" | "BUNDLE_LIMIT" | "BUNDLE_ABORTED" | "BUNDLE_TIMEOUT";
export class SkillBundleInspectionError extends Error {
  constructor(readonly code: SkillBundleInspectionErrorCode, message: string) {
    super(message);
    this.name = "SkillBundleInspectionError";
  }
}
function invalidBundle(message: string): never {
  throw new SkillBundleInspectionError("BUNDLE_INVALID", message);
}
function inspectionLimits(options: InspectSkillBundleOptions): SkillBundleInspectionLimits {
  const limits = { ...SKILL_BUNDLE_INSPECTION_LIMITS };
  for (const key of Object.keys(options.limits ?? {})) {
    if (!Object.hasOwn(limits, key)) throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Unknown bundle limit");
    const field = key as keyof SkillBundleInspectionLimits;
    const value = options.limits![field];
    if (!Number.isSafeInteger(value) || value! <= 0 || value! > limits[field]) {
      throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Bundle limits must be positive integers within the hard ceilings");
    }
    limits[field] = value!;
  }
  return limits;
}

/**
 * Inspect a bounded gzipped ustar bundle without filesystem writes or execution.
 * Resolves only after the entire gzip stream and tar structure validate. Returned
 * entries are NOT permission to execute code or safely extract through existing
 * filesystem symlinks; consumers still own storage, authorization and isolation.
 *
 * Only regular files, canonical relative slash paths (100 UTF-8 bytes maximum),
 * no prefix/extension/link records, and modes without special bits are supported.
 * Paths are unique under NFC + lowercase and cannot collide with a file ancestor.
 * Noncanonical dot/empty/backslash segments are refused, not silently rewritten.
 * Two zero tar blocks are required, followed only by complete zero padding blocks.
 * Gzip members are decoded as one stream: an empty extra member is harmless, but
 * a second nonempty archive after the tar terminator is rejected.
 *
 * The decoder has bounded stream buffers; decompressed bytes are counted before
 * parsing or retaining each chunk, so expansion is stopped during decompression.
 * Memory is bounded by the compressed snapshot, accepted file bodies, and stream
 * buffers. The deadline covers copying, hashing, decoding and parsing, with both
 * a timer and monotonic checks. Decoding yields to timers every 256 KiB so Bun's
 * stream microtasks cannot starve a caller's scheduled abort. No partial entries
 * escape on any failure.
 */
export async function inspectSkillBundle(bundle: Uint8Array, options: InspectSkillBundleOptions = {}): Promise<InspectedSkillBundle> {
  const signal = options.signal;
  const limits = inspectionLimits(options);
  const deadline = performance.now() + limits.timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new SkillBundleInspectionError("BUNDLE_ABORTED", "Bundle inspection aborted");
    if (performance.now() >= deadline) throw new SkillBundleInspectionError("BUNDLE_TIMEOUT", "Bundle inspection deadline exceeded");
  };
  check();
  if (bundle.byteLength > limits.compressedBytes) throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Compressed bundle exceeds byte limit");
  const snapshot = ownBytes(bundle);
  check();
  const sha256 = sha256Hex(snapshot);
  check();
  const parser = new BoundedTarReader(limits, check);
  // Zlib forwards stream options; the node declaration omits the inherited fields.
  const streamOptions: ZlibOptions & TransformOptions = { chunkSize: 16 * 1024, highWaterMark: 16 * 1024 };
  const decoder = createGunzip(streamOptions);
  let terminalError: SkillBundleInspectionError | undefined;
  const stop = (code: "BUNDLE_ABORTED" | "BUNDLE_TIMEOUT") => {
    terminalError ??= new SkillBundleInspectionError(code, code === "BUNDLE_ABORTED" ? "Bundle inspection aborted" : "Bundle inspection deadline exceeded");
    decoder.destroy(terminalError);
  };
  const onAbort = () => stop("BUNDLE_ABORTED");
  const timer = setTimeout(() => stop("BUNDLE_TIMEOUT"), Math.max(1, deadline - performance.now()));
  signal?.addEventListener("abort", onAbort, { once: true });
  let decompressedByteSize = 0;
  let bytesSinceYield = 0;
  try {
    check();
    decoder.end(snapshot);
    for await (const chunk of decoder) {
      check();
      decompressedByteSize += chunk.byteLength;
      if (decompressedByteSize > limits.decompressedBytes) throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Decompressed bundle exceeds byte limit");
      parser.push(chunk);
      bytesSinceYield += chunk.byteLength;
      if (bytesSinceYield >= 256 * 1024) {
        // An already-resolved promise or queueMicrotask does not give caller
        // abort timers a turn. The iterator retains bounded stream backpressure
        // while this timer is pending. It resolves before we leave this scope.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        bytesSinceYield = 0;
        check();
      }
    }
    check();
    const entries = parser.finish();
    return { entries, sha256, compressedByteSize: snapshot.byteLength, decompressedByteSize,
      unpackedByteSize: parser.fileBytes, fileCount: entries.length };
  } catch (error) {
    if (terminalError) throw terminalError;
    if (error instanceof SkillBundleInspectionError) throw error;
    throw new SkillBundleInspectionError("BUNDLE_INVALID", "Invalid or truncated gzip bundle");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    decoder.destroy();
  }
}

/** Incremental parser: one header block plus bounded owned file bodies. */
class BoundedTarReader {
  private readonly header = new Uint8Array(BLOCK);
  private headerOffset = 0;
  private pending: SkillBundleEntry | undefined;
  private bodyOffset = 0;
  private padding = 0;
  private zeroBlocks = 0;
  private readonly entries: SkillBundleEntry[] = [];
  private readonly paths = new SkillEntryPaths();
  fileBytes = 0;
  constructor(private readonly limits: SkillBundleInspectionLimits, private readonly check: () => void) {}
  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.byteLength) {
      this.check();
      if (this.pending) {
        const count = Math.min(this.pending.bytes.byteLength - this.bodyOffset, chunk.byteLength - offset);
        this.pending.bytes.set(chunk.subarray(offset, offset + count), this.bodyOffset);
        offset += count;
        this.bodyOffset += count;
        if (this.bodyOffset === this.pending.bytes.byteLength) {
          this.entries.push(this.pending);
          this.pending = undefined;
        }
      } else if (this.padding) {
        const count = Math.min(this.padding, chunk.byteLength - offset);
        if (chunk.subarray(offset, offset + count).some((byte) => byte !== 0)) invalidBundle("Nonzero tar body padding");
        offset += count;
        this.padding -= count;
      } else {
        const count = Math.min(BLOCK - this.headerOffset, chunk.byteLength - offset);
        this.header.set(chunk.subarray(offset, offset + count), this.headerOffset);
        offset += count;
        this.headerOffset += count;
        if (this.headerOffset === BLOCK) {
          this.readHeader();
          this.headerOffset = 0;
        }
      }
    }
  }
  finish(): SkillBundleEntry[] {
    this.check();
    if (this.pending || this.padding || this.headerOffset || this.zeroBlocks < 2) invalidBundle("Truncated tar bundle");
    return this.entries;
  }
  private readHeader(): void {
    this.check();
    const h = this.header;
    if (h.every((byte) => byte === 0)) { this.zeroBlocks++; return; }
    if (this.zeroBlocks) invalidBundle("Nonzero tar data after terminator");
    if (this.entries.length >= this.limits.entries) throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Bundle entry limit exceeded");
    let checksum = 0;
    for (let i = 0; i < BLOCK; i++) checksum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (tarOctal(h.subarray(148, 156)) !== checksum) invalidBundle("Invalid tar header checksum");
    if (new TextDecoder().decode(h.subarray(257, 265)) !== "ustar\0" + "00") invalidBundle("Unsupported tar format");
    if ((h[156] !== 48 && h[156] !== 0) || h.subarray(157, 257).some((b) => b !== 0)
      || h.subarray(345).some((b) => b !== 0)) invalidBundle("Unsupported tar entry or path prefix");
    const mode = tarOctal(h.subarray(100, 108));
    if (mode > 0o777) invalidBundle("Unsupported tar permission bits");
    tarOctal(h.subarray(108, 116)); tarOctal(h.subarray(116, 124)); tarOctal(h.subarray(136, 148));
    const size = tarOctal(h.subarray(124, 136));
    if (size > this.limits.fileBytes || this.fileBytes + size > this.limits.decompressedBytes) {
      throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Bundle file byte limit exceeded");
    }
    const name = h.subarray(0, 100);
    const end = name.indexOf(0);
    if (end !== -1 && name.subarray(end).some((b) => b !== 0)) invalidBundle("Invalid tar path padding");
    const raw = end === -1 ? name : name.subarray(0, end);
    if (raw.byteLength > this.limits.pathBytes) throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Bundle path byte limit exceeded");
    let path: string;
    try { path = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
    catch { return invalidBundle("Invalid UTF-8 bundle path"); }
    this.paths.add(path, this.limits.pathBytes, invalidBundle, () => {
      throw new SkillBundleInspectionError("BUNDLE_LIMIT", "Bundle path byte limit exceeded");
    });
    this.fileBytes += size;
    this.pending = { path, mode, bytes: new Uint8Array(new ArrayBuffer(size)) };
    this.bodyOffset = 0;
    this.padding = (BLOCK - size % BLOCK) % BLOCK;
    if (!size) { this.entries.push(this.pending); this.pending = undefined; }
  }
}
function tarOctal(field: Uint8Array): number {
  const text = new TextDecoder().decode(field);
  // Require digits plus trailing NUL/spaces; parseInt alone accepts junk and signs.
  if (!/^[0-7]+[\0 ]*$/.test(text)) invalidBundle("Invalid tar octal field");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) invalidBundle("Tar integer is out of range");
  return value;
}
