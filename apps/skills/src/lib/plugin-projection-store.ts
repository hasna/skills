/** Filesystem boundary for immutable, private plugin admission artifacts. */
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, rmdirSync, rmSync, unlinkSync, writeSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { PLUGIN_PROJECTION_LIMITS as LIMITS, pluginFileWitnesses, pluginKeys, pluginNeed, pluginRefusal, type PluginFileWitness } from "./plugin-projection.js";

type Witness = { path: string; stat: BigIntStats };
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const uid = (): bigint | undefined => typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined;
const missing = (error: unknown): boolean => Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
function stat(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); } catch (error) { if (missing(error)) return null; return pluginRefusal("Cannot inspect plugin filesystem entry"); }
}
function canonical(path: string): void {
  pluginNeed(typeof path === "string" && path.length <= 8192 && isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path), "Plugin storage paths must be canonical absolute paths");
}
function owner(stats: BigIntStats, system = false): void {
  const current = uid(); pluginNeed(current === undefined || stats.uid === current || (system && stats.uid === 0n), "Plugin filesystem entry has an unexpected owner");
}
function same(left: BigIntStats, right: BigIntStats | null, identityOnly = false): void {
  pluginNeed(right && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && (identityOnly || (left.size === right.size && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs)), "Plugin filesystem entry changed during access");
}
/** Existing ancestors must be real directories; only missing private directories are created. */
function ancestors(path: string, create = false): Witness[] {
  canonical(path);
  const result: Witness[] = [], parent = dirname(path), filesystemRoot = parse(parent).root;
  let current = filesystemRoot;
  for (const segment of ["", ...parent.slice(filesystemRoot.length).split("/").filter(Boolean)]) {
    if (segment) current = join(current, segment);
    let currentStat = stat(current);
    if (!currentStat && create) {
      try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) pluginRefusal("Cannot create private plugin storage directory"); }
      currentStat = stat(current);
    }
    if (!currentStat) break;
    pluginNeed(currentStat.isDirectory() && !currentStat.isSymbolicLink(), "Plugin storage ancestors must be real directories");
    result.push({ path: current, stat: currentStat });
  }
  return result;
}
// Shared ancestors such as /tmp can gain unrelated children during a read. Their
// identity, ownership and mode remain fixed; tree-local directories are checked in full.
function verifyAncestors(chain: Witness[], identityOnly = true): void { for (const item of chain) same(item.stat, stat(item.path), identityOnly); }
function privateParent(path: string): Witness[] {
  const chain = ancestors(path, true), parent = chain.at(-1);
  pluginNeed(parent && parent.path === dirname(path), "Plugin storage parent is unavailable"); owner(parent.stat);
  pluginNeed((parent.stat.mode & 0o7777n) === 0o700n, "Plugin storage parent must have mode 0700");
  return chain;
}
function fileShape(stats: BigIntStats, maximum: number, kind: "projection" | "receipt" | "executable" | "native-pin"): void {
  pluginNeed(stats.isFile() && !stats.isSymbolicLink() && (kind === "executable" || stats.nlink === 1n) && stats.size >= 0n && stats.size <= BigInt(maximum), "Plugin file is not a bounded regular file with an allowed link count");
  const mode = stats.mode & 0o7777n;
  if (kind === "projection") pluginNeed(mode === 0o644n || mode === 0o755n, "Plugin files require normalized regular-file modes");
  if (kind === "receipt") { owner(stats); pluginNeed(mode === 0o600n || mode === 0o400n, "Plugin receipts must be owner-only files"); }
  if (kind === "native-pin") { owner(stats); pluginNeed(mode === 0o600n || mode === 0o644n || mode === 0o664n, "Native plugin metadata has unsupported regular-file permissions"); }
  if (kind === "executable") { owner(stats, true); pluginNeed((mode & 0o022n) === 0n && (mode & 0o111n) !== 0n && (mode & 0o7000n) === 0n, "Plugin executables require safe executable permissions"); }
}
/** Read by descriptor, bound allocations before reading, and validate both identities afterwards. */
function readBytes(path: string, maximum: number, kind: "projection" | "receipt" | "native-pin"): Uint8Array<ArrayBuffer> {
  const chain = ancestors(path), before = stat(path); pluginNeed(before, "Plugin file is missing"); fileShape(before, maximum, kind);
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS); const opened = fstatSync(fd, { bigint: true }); same(before, opened); fileShape(opened, maximum, kind);
    const bytes = new Uint8Array(Number(opened.size)); let offset = 0;
    while (offset < bytes.byteLength) { const count = readSync(fd, bytes, offset, bytes.byteLength - offset, null); pluginNeed(count > 0, "Plugin file changed while being read"); offset += count; }
    pluginNeed(readSync(fd, new Uint8Array(1), 0, 1, null) === 0, "Plugin file grew while being read");
    same(opened, fstatSync(fd, { bigint: true })); same(opened, stat(path)); verifyAncestors(chain); return bytes;
  } catch (error) { if (error instanceof Error && error.name === "SkillSelectionError") throw error; return pluginRefusal("Cannot safely read plugin file"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function exactPaths(entries: SkillBundleEntry[]): void {
  pluginFileWitnesses(entries);
  const spellings = new Map<string, string>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const path = parts.slice(0, length).join("/"), key = path.normalize("NFC").toLowerCase().normalize("NFC"), prior = spellings.get(key);
      pluginNeed(prior === undefined || prior === path, "Plugin paths have ambiguous directory spelling"); spellings.set(key, path);
    }
  }
}
function directoryNames(path: string): string[] {
  const directory = opendirSync(path), names: string[] = [];
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      pluginNeed(names.length < LIMITS.files * 50, "Plugin directory membership exceeds its limit"); names.push(entry.name);
    }
    return names.sort();
  } finally { directory.closeSync(); }
}

/** Snapshot every file, rejecting empty directories and any membership or metadata change. */
export function snapshotPluginTree(root: string, options: { nativeRuntime?: "claude-2.1.274" | "claude-2.1.276" } = {}): SkillBundleEntry[] {
  const chain = ancestors(root), entries: SkillBundleEntry[] = [], files: Witness[] = [], directories: Array<Witness & { names: string[] }> = [];
  let bytes = 0, visited = 0;
  const visit = (directory: string, relative: string): void => {
    const before = stat(directory); pluginNeed(before && before.isDirectory() && !before.isSymbolicLink(), "Plugin tree must contain real directories");
    const names = directoryNames(directory);
    pluginNeed(names.length > 0 && names.length <= LIMITS.files * 50, "Plugin tree has an empty or oversized directory");
    directories.push({ path: directory, stat: before, names });
    for (const name of names) {
      pluginNeed(++visited <= LIMITS.files * 50, "Plugin tree membership exceeds its limit");
      const path = relative ? `${relative}/${name}` : name;
      pluginNeed(new TextEncoder().encode(path).byteLength <= 100 && !/[\\:\x00-\x1f\x7f]/u.test(path), "Plugin entry path exceeds its limit or is unsafe");
      const absolute = join(directory, name), entryStat = stat(absolute); pluginNeed(entryStat, "Plugin tree member disappeared");
      if (relative === "" && name === ".orphaned_at" && (options.nativeRuntime === "claude-2.1.274" || options.nativeRuntime === "claude-2.1.276")) {
        // Certified native runtimes mark retained historical versions for later pruning.
        // Its timestamp and process pins never authorize package content.
        const bytes = readBytes(absolute, 32, "native-pin");
        pluginNeed(/^[1-9][0-9]{12}$/.test(new TextDecoder().decode(bytes)), "Malformed native orphan timestamp");
        same(entryStat, stat(absolute)); files.push({ path: absolute, stat: entryStat }); continue;
      }
      if (relative === "" && name === ".in_use" && (options.nativeRuntime === "claude-2.1.274" || options.nativeRuntime === "claude-2.1.276")) {
        // Certified native runtimes pin cache versions with .in_use/<pid> JSON files. This
        // typed exception is unavailable for Skills-owned producer trees.
        pluginNeed(entryStat.isDirectory() && !entryStat.isSymbolicLink(), "Native plugin pins require a real directory"); owner(entryStat);
        const pins = directoryNames(absolute); pluginNeed(pins.length <= 1024, "Native plugin pin count exceeds its limit");
        directories.push({ path: absolute, stat: entryStat, names: pins });
        for (const pin of pins) {
          pluginNeed(/^[1-9][0-9]{0,9}$/.test(pin) && Number(pin) <= 2147483647, "Unrecognized native plugin pin name");
          const pinPath = join(absolute, pin), pinStat = stat(pinPath); pluginNeed(pinStat, "Native plugin pin disappeared");
          const bytes = readBytes(pinPath, 4096, "native-pin"); let value: unknown;
          try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { pluginRefusal("Malformed native plugin process pin"); }
          pluginKeys(value, ["pid", "procStart", "procStartFt"]); pluginNeed(value.pid === Number(pin), "Native plugin pin identity differs from its name");
          for (const key of ["procStart", "procStartFt"]) pluginNeed(value[key] === undefined || typeof value[key] === "string" && value[key].length <= 128 && !/[\x00-\x1f\x7f]/.test(value[key]), "Invalid native plugin process-start witness");
          same(pinStat, stat(pinPath)); files.push({ path: pinPath, stat: pinStat });
        }
        continue;
      }
      if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) visit(absolute, path);
      else {
        pluginNeed(entries.length < LIMITS.files, "Plugin file count exceeds its limit"); fileShape(entryStat, Math.min(LIMITS.fileBytes, LIMITS.bytes - bytes), "projection");
        const content = readBytes(absolute, Math.min(LIMITS.fileBytes, LIMITS.bytes - bytes), "projection"); same(entryStat, stat(absolute)); bytes += content.byteLength;
        files.push({ path: absolute, stat: entryStat }); entries.push({ path, mode: Number(entryStat.mode & 0o7777n), bytes: content });
      }
    }
  };
  visit(root, ""); exactPaths(entries);
  for (const file of files) same(file.stat, stat(file.path));
  for (const directory of directories) { same(directory.stat, stat(directory.path)); pluginNeed(JSON.stringify(directoryNames(directory.path)) === JSON.stringify(directory.names), "Plugin directory membership changed during access"); }
  verifyAncestors(chain); return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function verifyPluginTree(root: string, witnesses: PluginFileWitness[]): void {
  const actual = pluginFileWitnesses(snapshotPluginTree(root));
  pluginNeed(Array.isArray(witnesses) && witnesses.length === actual.length && witnesses.length <= LIMITS.files, "Plugin tree membership differs from its receipt");
  for (let index = 0; index < actual.length; index++) {
    const left = actual[index]!, right = witnesses[index];
    pluginNeed(right && Object.keys(right).length === 4 && left.path === right.path && left.mode === right.mode && left.size === right.size && left.sha256 === right.sha256, "Plugin tree differs from its immutable receipt");
  }
}
function writeExclusive(path: string, bytes: Uint8Array, mode: number): void {
  let fd: number | undefined, created: BigIntStats | undefined;
  try {
    fd = openSync(path, WRITE_FLAGS, mode); fchmodSync(fd, mode); created = fstatSync(fd, { bigint: true });
    let offset = 0; while (offset < bytes.byteLength) { const count = writeSync(fd, bytes, offset, bytes.byteLength - offset); pluginNeed(count > 0, "Plugin file write did not progress"); offset += count; }
    fsyncSync(fd);
  } catch (error) {
    if (created) { same(created, stat(path), true); unlinkSync(path); }
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}
/** Sibling staging and an exclusive, nonwaiting lock serialize cooperative publishers. */
export function materializePluginTree(root: string, entries: SkillBundleEntry[]): void {
  exactPaths(entries); const witnesses = pluginFileWitnesses(entries), chain = privateParent(root), lock = `${root}.lock`, staging = `${root}.staging-${randomUUID()}`;
  if (stat(root)) { verifyPluginTree(root, witnesses); verifyAncestors(chain, true); return; }
  let locked: BigIntStats | undefined, staged: BigIntStats | undefined;
  try {
    try { mkdirSync(lock, { mode: 0o700 }); locked = stat(lock)!; } catch { pluginRefusal("Plugin projection publication is already locked"); }
    verifyAncestors(chain, true);
    if (stat(root)) { verifyPluginTree(root, witnesses); return; }
    mkdirSync(staging, { mode: 0o700 }); staged = stat(staging)!;
    for (const entry of entries) {
      const path = join(staging, entry.path); ancestors(path, true); writeExclusive(path, entry.bytes, entry.mode);
    }
    verifyPluginTree(staging, witnesses); same(staged, stat(staging), true); same(locked, stat(lock), true); verifyAncestors(chain, true);
    pluginNeed(!stat(root), "Plugin projection destination appeared during publication"); renameSync(staging, root); staged = undefined;
    verifyPluginTree(root, witnesses); verifyAncestors(chain, true);
  } finally {
    if (staged) { same(staged, stat(staging), true); rmSync(staging, { recursive: true }); }
    if (locked) { same(locked, stat(lock), true); rmdirSync(lock); }
  }
}

export function readPluginJson(path: string): unknown | null {
  const chain = ancestors(path); if (!stat(path)) { verifyAncestors(chain); return null; }
  const bytes = readBytes(path, LIMITS.metadataBytes, "receipt");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return pluginRefusal("Plugin receipt is not valid UTF-8 JSON"); }
}
/** Atomic link publication never overwrites an existing receipt. */
export function writePluginJsonImmutable(path: string, value: unknown): void {
  const text = JSON.stringify(value); pluginNeed(typeof text === "string", "Plugin receipt must be JSON serializable");
  const bytes = new TextEncoder().encode(`${text}\n`); pluginNeed(bytes.byteLength <= LIMITS.metadataBytes, "Plugin receipt exceeds its limit");
  const chain = privateParent(path), existing = stat(path);
  if (existing) { pluginNeed(Buffer.from(readBytes(path, LIMITS.metadataBytes, "receipt")).equals(Buffer.from(bytes)), "An immutable plugin receipt already exists with different content"); return; }
  const temporary = `${path}.staging-${randomUUID()}`; let written: BigIntStats | undefined;
  try {
    writeExclusive(temporary, bytes, 0o600); written = stat(temporary)!; verifyAncestors(chain, true);
    try { linkSync(temporary, path); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      pluginNeed(Buffer.from(readBytes(path, LIMITS.metadataBytes, "receipt")).equals(Buffer.from(bytes)), "An immutable plugin receipt already exists with different content");
    }
  } finally { if (written) { same(written, stat(temporary), true); unlinkSync(temporary); } }
  verifyAncestors(chain, true); pluginNeed(Buffer.from(readBytes(path, LIMITS.metadataBytes, "receipt")).equals(Buffer.from(bytes)), "Plugin receipt changed during publication");
}

/** Hash the reviewed executable without executing it or allocating the entire binary. */
export function pluginExecutableDigest(path: string): string {
  const maximum = 256 * 1024 * 1024, chain = ancestors(path), before = stat(path); pluginNeed(before, "Plugin executable is missing"); fileShape(before, maximum, "executable");
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS); const opened = fstatSync(fd, { bigint: true }); same(before, opened); fileShape(opened, maximum, "executable");
    const hash = createHash("sha256"), buffer = new Uint8Array(64 * 1024); let remaining = Number(opened.size);
    while (remaining > 0) { const count = readSync(fd, buffer, 0, Math.min(buffer.byteLength, remaining), null); pluginNeed(count > 0, "Plugin executable changed during hashing"); hash.update(buffer.subarray(0, count)); remaining -= count; }
    pluginNeed(readSync(fd, buffer, 0, 1, null) === 0, "Plugin executable grew during hashing");
    same(opened, fstatSync(fd, { bigint: true })); same(opened, stat(path)); verifyAncestors(chain); return `sha256:${hash.digest("hex")}`;
  } catch (error) { if (error instanceof Error && error.name === "SkillSelectionError") throw error; return pluginRefusal("Cannot safely hash plugin executable"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
