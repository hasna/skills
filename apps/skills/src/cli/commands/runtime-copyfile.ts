import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, renameSync, symlinkSync, writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SEMVER_PATTERN } from "../../lib/skill-contract.js";
import { validateReviewedRuntimeLock } from "./reviewed-runtime-lock.js";
import {
  type LauncherShape, type LauncherState, type LauncherFormat, type LauncherProfile, inspectLauncher, launcherIs, launcherTarget,
  materializeLauncher, pinnedLauncherRuntime, pinnedLauncherState, pinnedLauncherText, launcherProfileForBin,
  PINNED_LAUNCHER_BUN_FLAGS, LAUNCH_CWD_VARIABLE,
} from "./runtime-launcher.js";

const PACKAGE_NAME = "@hasna/skills";
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const STABLE_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;
const MAX_TARBALL_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 20_000;
const CONFIG_PREIMAGE_PATHS = [
  ".claude/settings.json",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".hasna/skills/agent-policy.json",
] as const;

type JsonObject = Record<string, unknown>;
type BinMap = Record<string, string>;

/**
 * One managed launcher's recorded transition. `oldLinkTarget` is the exact
 * symlink text of a legacy launcher, or the entry path of a pinned one, so
 * `resolve(dirname(path), oldLinkTarget) === oldTarget` holds for both shapes.
 * Receipts written before pinned launchers existed carry none of the optional
 * fields and describe a symlink-to-symlink switch.
 */
interface LauncherRecord {
  path: string;
  oldTarget: string;
  oldLinkTarget: string;
  newTarget: string;
  backupPath: string;
  oldShape?: LauncherShape;
  oldRuntime?: string;
  oldCwd?: string;
  oldSha256?: string;
  oldFormat?: LauncherFormat;
  oldProfile?: LauncherProfile;
  newShape?: LauncherShape;
  newRuntime?: string;
  newCwd?: string;
  newSha256?: string;
  newFormat?: LauncherFormat;
  newProfile?: LauncherProfile;
}

interface RuntimeLayout {
  home: string;
  runtimeRoot: string;
  currentPackageRoot: string;
  currentVersion: string;
  bin: BinMap;
  launchers: LauncherRecord[];
}

function oldLauncherState(item: LauncherRecord): LauncherState {
  if (item.oldShape === "pinned") return { shape: "pinned", runtime: item.oldRuntime!, cwd: item.oldCwd!, target: item.oldTarget, sha256: item.oldSha256!, format: item.oldFormat, profile: item.oldProfile };
  return { shape: "symlink", linkTarget: item.oldLinkTarget, target: item.oldTarget };
}

function newLauncherState(item: LauncherRecord): LauncherState {
  if (item.newShape === "pinned") return { shape: "pinned", runtime: item.newRuntime!, cwd: item.newCwd!, target: item.newTarget, sha256: item.newSha256!, format: item.newFormat, profile: item.newProfile };
  return { shape: "symlink", linkTarget: item.newTarget, target: item.newTarget };
}

// Bind a record's shape fields exactly: absent fields mean a legacy symlink;
// a pinned shape needs its runtime, trusted directory and digest, and its
// digest must be the digest of the text those fields render. Absent pinned
// format/profile fields mean exact historical V1; V2 requires a bin-bound role.
function assertLauncherRecordShapes(item: LauncherRecord, expectedProfile: LauncherProfile): void {
  const hex = /^[a-f0-9]{64}$/;
  for (const side of ["old", "new"] as const) {
    const shape = item[`${side}Shape`], runtime = item[`${side}Runtime`], cwd = item[`${side}Cwd`], sha = item[`${side}Sha256`];
    const format = item[`${side}Format`], profile = item[`${side}Profile`];
    if (shape === undefined) {
      if (runtime !== undefined || cwd !== undefined || sha !== undefined || format !== undefined || profile !== undefined) throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID");
      continue;
    }
    if (shape === "symlink") {
      if (runtime !== undefined || cwd !== undefined || sha !== undefined || format !== undefined || profile !== undefined) throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID");
      continue;
    }
    if (shape !== "pinned" || typeof runtime !== "string" || !isAbsolute(runtime) || typeof cwd !== "string" || !isAbsolute(cwd) || typeof sha !== "string" || !hex.test(sha)) {
      throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID");
    }
    const target = side === "old" ? item.oldTarget : item.newTarget;
    if (side === "old" && item.oldLinkTarget !== item.oldTarget) throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID");
    if (format === "v2" && profile !== expectedProfile) throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID");
    try {
      pinnedLauncherText({ runtime, cwd, target, sha256: sha, format, profile });
    } catch { throw new Error("RECEIPT_LAUNCHER_SHAPE_INVALID"); }
  }
}

/** The pinned-launcher fields for a switch onto `target` under the given runtime version root. */
function pinnedRecordFields(runtime: string, cwd: string, target: string, profile: LauncherProfile): Pick<LauncherRecord, "newShape" | "newRuntime" | "newCwd" | "newSha256" | "newFormat" | "newProfile"> {
  const state = pinnedLauncherState(runtime, cwd, target, { format: "v2", profile });
  return { newShape: "pinned", newRuntime: state.runtime, newCwd: state.cwd, newSha256: state.sha256, newFormat: state.format, newProfile: state.profile };
}

interface ConfigPreimage {
  sourcePath: string;
  relativePath: string;
  present: boolean;
  sha256?: string;
  byteSize?: number;
}

interface NpmReleaseAgePolicy {
  minReleaseAge: number;
  minReleaseAgeExclude: string[];
}

interface CopyfileReceipt {
  schema: "skills.copyfile-runtime-receipt.v1";
  id: string;
  state: "prepared" | "switching" | "switched" | "rolled-back" | "rollback-required";
  package: string;
  currentVersion: string;
  targetVersion: string;
  registryOrigin: string;
  tarballUrl: string;
  tarballIntegrity: string;
  tarballSha256: string;
  tarballBytes: number;
  packageTreeSha256: string;
  installLockSha256: string;
  runtimeTreeSha256: string;
  runtimeRoot: string;
  currentPackageRoot: string;
  targetPackageRoot: string;
  configs: ConfigPreimage[];
  preimageSha256: string;
  launchers: RuntimeLayout["launchers"];
  dependencyPolicy?: NpmReleaseAgePolicy & { npmVersion: string };
  reviewedLockSha256?: string;
  prerequisites?: JsonObject;
  switchedLaunchers: string[];
  rollbackCompletedLaunchers: string[];
}

/** Invoke the verified TARGET's opt-in contract, never the current CLI's
 * discovery algorithm. Legacy packages have no declaration and are explicitly
 * unverified; an unknown declaration or missing declared entry fails closed. */
function verifyTargetPrerequisites(manifest: JsonObject, packageRoot: string, home: string, cwd: string, pathValue: string): JsonObject {
  const declaration = manifest.skillsRuntimePrerequisites;
  if (declaration === undefined) return { status: "not-declared" };
  const contract = object(declaration, "RUNTIME_PREREQUISITE_CONTRACT_INVALID");
  if (Object.keys(contract).length !== 2 || contract.version !== 1 || contract.entry !== "dist/runtime-prerequisites.js") {
    throw new Error("RUNTIME_PREREQUISITE_CONTRACT_INVALID");
  }
  const entry = join(packageRoot, contract.entry);
  if (!entryExists(entry) || !lstatSync(entry).isFile() || lstatSync(entry).isSymbolicLink()) throw new Error("RUNTIME_PREREQUISITE_ENTRY_MISSING");
  const entrySha256 = hash(readFileSync(entry));
  // Only path selectors reach the reader. Credentials, dotenv/preloads and
  // arbitrary Bun options never do. Unsupported config inputs need presence,
  // not their possibly sensitive contents, to reproduce the owning refusal.
  const env: Record<string, string> = { HOME: home, PATH: pathValue, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  for (const key of ["HASNA_SKILLS_DIR", "HASNA_SKILLS_HOME", "SKILLS_HOME", "HASNA_DATA_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "SUMI_HOME", "SUMI_CONFIG_DIR", "HERMES_HOME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  for (const key of ["SUMI_CONFIG", "SUMI_CONFIG_CONTENT"]) if (process.env[key] !== undefined) env[key] = "";
  const child = spawnSync(pinnedLauncherRuntime(), [...PINNED_LAUNCHER_BUN_FLAGS, entry, home, cwd], {
    cwd: dirname(packageRoot), env, encoding: "buffer", timeout: 5000, maxBuffer: 128 * 1024, shell: false,
  });
  if (child.error || child.signal || !child.stdout || child.stderr?.byteLength) throw new Error("RUNTIME_PREREQUISITE_CHECK_UNAVAILABLE");
  let result: JsonObject;
  try { result = object(JSON.parse(child.stdout.toString("utf8")), "RUNTIME_PREREQUISITE_RESPONSE_INVALID"); }
  catch { throw new Error("RUNTIME_PREREQUISITE_RESPONSE_INVALID"); }
  if (Object.keys(result).length !== 5 || result.schema !== "skills.runtime-prerequisites.v1" || result.targetVersion !== manifest.version
    || typeof result.ok !== "boolean" || !Array.isArray(result.checked) || result.checked.length > 1
    || result.checked.some(value => value !== "sumi-paths")) throw new Error("RUNTIME_PREREQUISITE_RESPONSE_INVALID");
  const codes = ["RUNTIME_CONSUMER_DISCOVERY_REFUSED", "RUNTIME_PREREQUISITE_INPUT_REFUSED", "SUMI_PATH_INPUT_REFUSED", "SUMI_PATH_CONFIG_UNSUPPORTED",
    "SUMI_PATH_RESOLVER_UNAVAILABLE", "SUMI_PATH_RESOLVER_INVALID_RESPONSE", "SUMI_PATH_DISCOVERY_REFUSED"];
  if (!result.ok) {
    if (child.status !== 2 || typeof result.code !== "string" || !codes.includes(result.code)) throw new Error("RUNTIME_PREREQUISITE_RESPONSE_INVALID");
    throw new Error(`RUNTIME_PREREQUISITE_REFUSED_${result.code}`);
  }
  if (child.status !== 0 || result.code !== null) throw new Error("RUNTIME_PREREQUISITE_RESPONSE_INVALID");
  if (hash(readFileSync(entry)) !== entrySha256) throw new Error("RUNTIME_PREREQUISITE_ENTRY_CHANGED");
  return { status: "verified", schema: result.schema, targetVersion: result.targetVersion, entry: contract.entry, entrySha256, checked: result.checked };
}

interface AliasReceipt {
  schema: "skills.copyfile-alias-adoption.v1";
  id: string;
  state: "prepared" | "switching" | "switched" | "rolled-back" | "rollback-required";
  targetVersion: string;
  targetPackageRoot: string;
  rolloutReceiptId: string;
  aliases: Array<LauncherRecord & { oldVersion: string; oldBinarySha256: string; chain?: AliasPackageChain }>;
  switchedAliases: string[];
  rollbackCompletedAliases: string[];
}

interface AliasPackageChain {
  packageLinkPath: string;
  packageLinkTarget: string;
}

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function entryExists(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

function assertNoSymlinkAncestors(path: string): void {
  const absolute = resolve(path);
  const parts = absolute.split(sep).filter(Boolean);
  let current: string = sep;
  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("PATH_ANCESTOR_SYMLINK_UNSUPPORTED");
    if (!stat.isDirectory()) throw new Error("PATH_ANCESTOR_NOT_DIRECTORY");
  }
}

function acquireRuntimeLock(runtimeRoot: string): () => void {
  const lockPath = join(runtimeRoot, ".copyfile-update-lock");
  try { mkdirSync(lockPath, { mode: 0o700 }); } catch { throw new Error("RUNTIME_UPDATE_LOCKED"); }
  try { writeJsonPrivate(join(lockPath, "lock.json"), { operationId: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() }); }
  catch {
    try { renameSync(lockPath, join(runtimeRoot, `.copyfile-update-lock-incomplete-${randomUUID()}`)); } catch { /* Keep an active lock if quarantine fails. */ }
    throw new Error("RUNTIME_LOCK_INITIALIZATION_FAILED");
  }
  return () => {
    const released = join(runtimeRoot, `.copyfile-update-lock-released-${randomUUID()}`);
    writeJsonPrivate(join(lockPath, "released.json"), { completedAt: new Date().toISOString() });
    renameSync(lockPath, released);
  };
}

function packageBins(pkg: JsonObject): BinMap {
  const raw = pkg.bin;
  const entries: Array<[string, unknown]> = typeof raw === "string"
    ? [[PACKAGE_NAME.slice(PACKAGE_NAME.lastIndexOf("/") + 1), raw]]
    : raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.entries(raw as Record<string, unknown>)
      : [];
  const output: BinMap = {};
  for (const [name, value] of entries) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || typeof value !== "string" || !value || isAbsolute(value)) {
      throw new Error("PACKAGE_BIN_INVALID");
    }
    const normalized = value.replaceAll("\\", "/");
    if (normalized.split("/").some(part => part === ".." || part === ".")) throw new Error("PACKAGE_BIN_INVALID");
    output[name] = normalized;
  }
  if (!output.skills) throw new Error("PACKAGE_BIN_INVALID");
  return output;
}

function readPackage(path: string): { data: JsonObject; version: string; bins: BinMap } {
  let data: JsonObject;
  try { data = object(JSON.parse(readFileSync(path, "utf8")), "PACKAGE_JSON_INVALID"); }
  catch { throw new Error("PACKAGE_JSON_INVALID"); }
  if (data.name !== PACKAGE_NAME || typeof data.version !== "string" || !new RegExp(SEMVER_PATTERN).test(data.version)) {
    throw new Error("PACKAGE_IDENTITY_INVALID");
  }
  return { data, version: data.version, bins: packageBins(data) };
}

function resolveRuntimeLayout(homeInput: string, pathInput: string): RuntimeLayout {
  const home = realpathSync(homeInput);
  const runtimeRoot = join(home, ".hasna", "skills", "runtime");
  assertNoSymlinkAncestors(runtimeRoot);
  const runtimeRootStat = lstatSync(runtimeRoot);
  if (!runtimeRootStat.isDirectory() || runtimeRootStat.isSymbolicLink() || (runtimeRootStat.mode & 0o077) !== 0) {
    throw new Error("RUNTIME_ROOT_NOT_PRIVATE");
  }
  const selectedLauncher = Bun.which("skills", { PATH: pathInput });
  if (!selectedLauncher) throw new Error("ACTIVE_SKILLS_LAUNCHER_NOT_FOUND");
  const launcherPath = resolve(selectedLauncher);
  assertNoSymlinkAncestors(dirname(launcherPath));
  const activeLauncher = inspectLauncher(launcherPath);
  if (activeLauncher.kind === "foreign") throw new Error("ACTIVE_SKILLS_LAUNCHER_NOT_MANAGED_LINK");
  const activeBinary = activeLauncher.target;
  let activePhysical: string;
  try { activePhysical = realpathSync(activeBinary); } catch { throw new Error("ACTIVE_RUNTIME_ENTRYPOINT_MISMATCH"); }
  if (activePhysical !== activeBinary) throw new Error("ACTIVE_RUNTIME_ENTRYPOINT_MISMATCH");
  const currentPackageRoot = dirname(dirname(activeBinary));
  assertNoSymlinkAncestors(currentPackageRoot);
  if (!isWithin(runtimeRoot, currentPackageRoot)) throw new Error("ACTIVE_RUNTIME_OUTSIDE_COPYFILE_ROOT");
  const relativePackage = relative(runtimeRoot, currentPackageRoot).split(sep);
  if (relativePackage.length !== 4 || relativePackage[1] !== "node_modules" || relativePackage[2] !== "@hasna" || relativePackage[3] !== "skills") {
    throw new Error("ACTIVE_RUNTIME_LAYOUT_UNSUPPORTED");
  }
  const current = readPackage(join(currentPackageRoot, "package.json"));
  if (!activeBinary.startsWith(`${currentPackageRoot}${sep}`) || activeBinary !== join(currentPackageRoot, current.bins.skills)) {
    throw new Error("ACTIVE_RUNTIME_ENTRYPOINT_MISMATCH");
  }
  const launchers: RuntimeLayout["launchers"] = [];
  const seenDirectories = new Set<string>();
  for (const rawDir of pathInput.split(delimiter).filter(Boolean)) {
    const dir = resolve(rawDir);
    if (seenDirectories.has(dir)) continue;
    seenDirectories.add(dir);
    for (const [name, target] of Object.entries(current.bins)) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      assertNoSymlinkAncestors(dir);
      let launcher;
      try { launcher = inspectLauncher(path); } catch (error) {
        if (error instanceof Error && error.message === "LAUNCHER_TARGET_UNREADABLE") throw error;
        continue;
      }
      if (launcher.kind === "foreign") continue;
      const actual = launcher.target;
      if (actual !== join(currentPackageRoot, target)) continue;
      const newTarget = join(runtimeRoot, "__target__", "node_modules", "@hasna", "skills", target);
      const backupPath = `${path}.skills-prev-${randomUUID()}`;
      if (launcher.kind === "symlink") {
        if (resolve(dirname(path), launcher.linkTarget) !== actual) throw new Error("LAUNCHER_SYMLINK_CHAIN_UNSUPPORTED");
        launchers.push({ path, oldTarget: actual, oldLinkTarget: launcher.linkTarget, newTarget, backupPath, oldShape: "symlink" });
      } else {
        launchers.push({ path, oldTarget: actual, oldLinkTarget: actual, newTarget, backupPath, oldShape: "pinned", oldRuntime: launcher.runtime, oldCwd: launcher.cwd, oldSha256: launcher.sha256, oldFormat: launcher.format, oldProfile: launcher.profile });
      }
    }
  }
  if (!launchers.some(item => item.path === launcherPath)) throw new Error("ACTIVE_LAUNCHER_NOT_IN_PATH_INVENTORY");
  if (new Set(launchers.map(item => item.path)).size !== launchers.length) throw new Error("LAUNCHER_PATH_DUPLICATE");
  return { home, runtimeRoot, currentPackageRoot, currentVersion: current.version, bin: current.bins, launchers };
}

function verifyIntegrity(bytes: Uint8Array, integrity: string): void {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match) throw new Error("REGISTRY_INTEGRITY_UNSUPPORTED");
  const actual = createHash("sha512").update(bytes).digest("base64");
  if (actual !== match[1]) throw new Error("TARBALL_INTEGRITY_MISMATCH");
}

function expectedTarballUrl(input: unknown, origin: string, version: string): string {
  if (typeof input !== "string") throw new Error("REGISTRY_TARBALL_URL_INVALID");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("REGISTRY_TARBALL_URL_INVALID"); }
  const base = new URL(origin);
  if (url.protocol !== "https:" && base.protocol === "https:") throw new Error("REGISTRY_TARBALL_URL_INVALID");
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) throw new Error("REGISTRY_TARBALL_URL_INVALID");
  if (!url.pathname.endsWith(`/skills-${version}.tgz`)) throw new Error("REGISTRY_TARBALL_URL_INVALID");
  return url.toString();
}

interface TarEntry { path: string; kind: "file" | "directory"; size: number }

function tarField(block: Uint8Array, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? field : field.subarray(0, end));
}

function tarOctal(block: Uint8Array, start: number, length: number): number {
  const raw = new TextDecoder().decode(block.subarray(start, start + length)).replace(/[\0 ]+$/g, "").trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error("TARBALL_TAR_NUMERIC_FIELD_INVALID");
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) throw new Error("TARBALL_TAR_NUMERIC_FIELD_INVALID");
  return value;
}

async function gunzipCapped(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("TARBALL_GZIP_REQUIRED");
  const stream = Readable.from([Buffer.from(bytes)]).pipe(createGunzip());
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const part = Buffer.from(chunk);
      size += part.byteLength;
      if (size > limit) {
        stream.destroy();
        throw new Error("TARBALL_EXPANDED_SIZE_INVALID");
      }
      chunks.push(part);
    }
  } finally { stream.destroy(); }
  return Buffer.concat(chunks, size);
}

export async function preflightTarball(bytes: Uint8Array, limits: { maxExpandedBytes?: number; maxEntries?: number } = {}): Promise<{ entries: TarEntry[]; expandedBytes: number }> {
  const expanded = await gunzipCapped(bytes, limits.maxExpandedBytes ?? MAX_TARBALL_EXPANDED_BYTES);
  const entries: TarEntry[] = [];
  const paths = new Set<string>();
  let offset = 0, ended = false, fileBytes = 0;
  while (offset + 512 <= expanded.byteLength) {
    const block = expanded.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) { ended = true; break; }
    if (entries.length >= (limits.maxEntries ?? MAX_TARBALL_ENTRIES)) throw new Error("TARBALL_ENTRY_COUNT_INVALID");
    const expectedChecksum = tarOctal(block, 148, 8);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += (i >= 148 && i < 156) ? 32 : block[i]!;
    if (checksum !== expectedChecksum) throw new Error("TARBALL_TAR_CHECKSUM_INVALID");
    const name = tarField(block, 0, 100), prefix = tarField(block, 345, 155);
    const rawPath = `${prefix ? `${prefix}/` : ""}${name}`.replace(/\/$/, "");
    const pathParts = rawPath.split("/");
    if ((rawPath !== "package" && !rawPath.startsWith("package/")) || rawPath.startsWith("/") || rawPath.includes("\\") || pathParts.some(part => !part || part === "." || part === "..")) throw new Error("TARBALL_PATH_INVALID");
    if (pathParts[1] === "node_modules") throw new Error("TARBALL_BUNDLED_DEPENDENCIES_UNSUPPORTED");
    if (paths.has(rawPath)) throw new Error("TARBALL_DUPLICATE_PATH");
    paths.add(rawPath);
    const flag = block[156] === 0 ? "0" : String.fromCharCode(block[156]!);
    const size = tarOctal(block, 124, 12);
    const kind = flag === "0" ? "file" : flag === "5" ? "directory" : null;
    if (!kind || (kind === "directory" && size !== 0) || (rawPath === "package" && kind !== "directory")) throw new Error("TARBALL_ENTRY_TYPE_UNSUPPORTED");
    fileBytes += size;
    if (fileBytes > (limits.maxExpandedBytes ?? MAX_TARBALL_EXPANDED_BYTES)) throw new Error("TARBALL_EXPANDED_SIZE_INVALID");
    entries.push({ path: rawPath, kind, size });
    const padded = Math.ceil(size / 512) * 512;
    offset += 512 + padded;
    if (offset > expanded.byteLength) throw new Error("TARBALL_TAR_TRUNCATED");
  }
  if (!ended || !expanded.subarray(offset).every(byte => byte === 0)) throw new Error("TARBALL_TAR_TERMINATOR_INVALID");
  return { entries, expandedBytes: expanded.byteLength };
}

async function downloadPackage(version: string, stagingRoot: string, registryOrigin: string, fetcher: typeof fetch): Promise<{
  tarballPath: string; tarballUrl: string; integrity: string; sha256: string; byteSize: number; packageTreeSha256: string; packageBins: BinMap;
}> {
  const metadataUrl = `${registryOrigin}/@hasna%2fskills/${encodeURIComponent(version)}`;
  const timeout = AbortSignal.timeout(30_000);
  const metadataResponse = await fetcher(metadataUrl, { redirect: "error", signal: timeout });
  if (!metadataResponse.ok || new URL(metadataResponse.url || metadataUrl).origin !== new URL(registryOrigin).origin) throw new Error("REGISTRY_METADATA_FETCH_FAILED");
  const metadata = object(JSON.parse(new TextDecoder().decode(await readBodyCapped(metadataResponse, 5 * 1024 * 1024, "REGISTRY_METADATA_SIZE_INVALID"))), "REGISTRY_METADATA_INVALID");
  if (metadata.name !== PACKAGE_NAME || metadata.version !== version || metadata._id !== `${PACKAGE_NAME}@${version}`) throw new Error("REGISTRY_PACKAGE_IDENTITY_MISMATCH");
  const dist = object(metadata.dist, "REGISTRY_DIST_INVALID");
  const integrity = typeof dist.integrity === "string" ? dist.integrity : "";
  const tarballUrl = expectedTarballUrl(dist.tarball, registryOrigin, version);
  const response = await fetcher(tarballUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || new URL(response.url || tarballUrl).origin !== new URL(registryOrigin).origin) throw new Error("REGISTRY_TARBALL_FETCH_FAILED");
  const bytes = await readBodyCapped(response, MAX_TARBALL_BYTES, "TARBALL_SIZE_INVALID");
  if (!bytes.byteLength) throw new Error("TARBALL_SIZE_INVALID");
  verifyIntegrity(bytes, integrity);
  const preflight = await preflightTarball(bytes);
  const archive = new Bun.Archive(bytes);
  const files = await archive.files();
  const regularFiles = preflight.entries.filter(entry => entry.kind === "file");
  if (files.size !== regularFiles.length || regularFiles.some(entry => files.get(entry.path)?.size !== entry.size)) throw new Error("TARBALL_ARCHIVE_INTERPRETATION_MISMATCH");
  const packageJson = files.get("package/package.json");
  if (!packageJson) throw new Error("TARBALL_PACKAGE_JSON_MISSING");
  const unpacked = object(JSON.parse(await packageJson.text()), "TARBALL_PACKAGE_JSON_INVALID");
  if (unpacked.name !== PACKAGE_NAME || unpacked.version !== version) throw new Error("TARBALL_PACKAGE_IDENTITY_MISMATCH");
  const bins = packageBins(unpacked);
  const archiveRoot = join(stagingRoot, "verified-archive");
  mkdirSync(archiveRoot, { mode: 0o700 });
  await archive.extract(archiveRoot);
  const extractedPackage = join(archiveRoot, "package");
  const extracted = readTree(extractedPackage, false);
  const tarballPath = join(stagingRoot, "verified-package.tgz");
  writeFileSync(tarballPath, bytes, { flag: "wx", mode: 0o600 });
  if (!readFileSync(tarballPath).equals(Buffer.from(bytes))) throw new Error("TARBALL_READBACK_MISMATCH");
  return {
    tarballPath, tarballUrl, integrity, sha256: hash(bytes), byteSize: bytes.byteLength,
    packageTreeSha256: extracted.digest, packageBins: bins,
  };
}

export async function readBodyCapped(response: Response, limit: number, errorCode: string): Promise<Uint8Array> {
  if (!response.body) throw new Error("HTTP_RESPONSE_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

interface TreeRecord { digest: string; entries: Array<{ path: string; kind: string; sha256?: string; target?: string; mode?: number }> }

function readTree(root: string, includeModes: boolean, excludeNpmDependencies = false): TreeRecord {
  const base = realpathSync(root);
  const entries: TreeRecord["entries"] = [];
  const walk = (dir: string, prefix = "") => {
    for (const item of readdirSync(dir).sort()) {
      const path = join(dir, item);
      const rel = prefix ? `${prefix}/${item}` : item;
      const stat = lstatSync(path);
      // Only the installed package payload comparison excludes npm's own root
      // dependency directory. The complete runtime tree still walks and binds it.
      if (excludeNpmDependencies && !prefix && item === "node_modules") {
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("INSTALLED_DEPENDENCY_DIRECTORY_UNSAFE");
        continue;
      }
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(path);
        const resolved = resolve(dirname(path), link);
        if (!isWithin(base, resolved)) throw new Error("TREE_SYMLINK_ESCAPES_ROOT");
        let physicalTarget: string;
        try { physicalTarget = realpathSync(path); } catch { throw new Error("TREE_SYMLINK_TARGET_MISSING"); }
        if (!isWithin(base, physicalTarget)) throw new Error("TREE_SYMLINK_ESCAPES_ROOT");
        entries.push({ path: rel, kind: "symlink", target: link, ...(includeModes ? { mode: stat.mode & 0o777 } : {}) });
      } else if (stat.isDirectory()) {
        entries.push({ path: rel, kind: "directory", ...(includeModes ? { mode: stat.mode & 0o777 } : {}) });
        walk(path, rel);
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error("TREE_HARDLINK_UNSUPPORTED");
        const bytes = readFileSync(path);
        entries.push({ path: rel, kind: "file", sha256: hash(bytes), ...(includeModes ? { mode: stat.mode & 0o777 } : {}) });
      } else throw new Error("TREE_ENTRY_TYPE_UNSUPPORTED");
    }
  };
  walk(base);
  return { entries, digest: hash(new TextEncoder().encode(JSON.stringify(entries))) };
}

function normalizeModes(root: string): void {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("RUNTIME_ENTRY_TYPE_UNSUPPORTED");
  chmodSync(root, rootStat.mode & 0o755);
  const walk = (dir: string) => {
    for (const item of readdirSync(dir)) {
      const path = join(dir, item);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        chmodSync(path, stat.mode & 0o755);
        walk(path);
      } else if (stat.isFile()) {
        chmodSync(path, stat.mode & 0o755);
      } else throw new Error("RUNTIME_ENTRY_TYPE_UNSUPPORTED");
    }
  };
  walk(root);
}

function writeJsonPrivate(path: string, value: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  if (!readFileSync(path).equals(bytes)) throw new Error("PRIVATE_JSON_READBACK_MISMATCH");
}

function writePreimageManifest(stage: string, configs: ConfigPreimage[], launchers: RuntimeLayout["launchers"]): string {
  const path = join(stage, "preimage", "manifest.json");
  const value = { schema: "skills.copyfile-preimage.v1", configs, launchers };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
  chmodSync(path, 0o400);
  if (!readFileSync(path).equals(bytes)) throw new Error("PREIMAGE_MANIFEST_READBACK_MISMATCH");
  return hash(bytes);
}

function verifyPreimageManifest(runtimePath: string, receipt: CopyfileReceipt, home: string): void {
  const path = join(runtimePath, "preimage", "manifest.json");
  const bytes = readFileSync(path);
  if (hash(bytes) !== receipt.preimageSha256) throw new Error("PREIMAGE_MANIFEST_DRIFT");
  const manifest = object(JSON.parse(bytes.toString("utf8")), "PREIMAGE_MANIFEST_INVALID");
  const expected = { schema: "skills.copyfile-preimage.v1", configs: receipt.configs, launchers: receipt.launchers };
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error("PREIMAGE_RECEIPT_MISMATCH");
  if (receipt.configs.length !== CONFIG_PREIMAGE_PATHS.length) throw new Error("PREIMAGE_CONFIG_SET_INVALID");
  for (const [index, relativePath] of CONFIG_PREIMAGE_PATHS.entries()) {
    const config = receipt.configs[index];
    if (config.relativePath !== relativePath || config.sourcePath !== join(home, relativePath)) throw new Error("PREIMAGE_CONFIG_BINDING_INVALID");
    if (config.present) {
      const backup = join(runtimePath, "preimage", "configs", relativePath);
      const stat = lstatSync(backup);
      const saved = readFileSync(backup);
      if (!stat.isFile() || stat.isSymbolicLink() || hash(saved) !== config.sha256 || saved.byteLength !== config.byteSize) throw new Error("PREIMAGE_CONFIG_DRIFT");
    }
  }
}

function captureConfigPreimages(home: string, stage: string): ConfigPreimage[] {
  const root = join(stage, "preimage", "configs");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return CONFIG_PREIMAGE_PATHS.map(relativePath => {
    const sourcePath = join(home, relativePath);
    if (!entryExists(sourcePath)) return { sourcePath, relativePath, present: false };
    const stat = lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("CONFIG_PREIMAGE_NOT_REGULAR_FILE");
    const bytes = readFileSync(sourcePath);
    const backupPath = join(root, relativePath);
    mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    writeFileSync(backupPath, bytes, { flag: "wx", mode: 0o600 });
    chmodSync(backupPath, 0o600);
    const readback = readFileSync(backupPath);
    if (!readback.equals(bytes)) throw new Error("CONFIG_PREIMAGE_READBACK_MISMATCH");
    return { sourcePath, relativePath, present: true, sha256: hash(bytes), byteSize: bytes.byteLength };
  });
}

function assertConfigUnchanged(configs: ConfigPreimage[]): void {
  for (const config of configs) {
    const present = entryExists(config.sourcePath);
    if (present !== config.present) throw new Error("CONFIG_DRIFT_DURING_UPDATE");
    if (present) {
      const stat = lstatSync(config.sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || hash(readFileSync(config.sourcePath)) !== config.sha256) {
        throw new Error("CONFIG_DRIFT_DURING_UPDATE");
      }
    }
  }
}

function releaseAgePolicy(options: { minReleaseAge?: number; minReleaseAgeExclude?: string[] }): NpmReleaseAgePolicy | undefined {
  if (options.minReleaseAgeExclude !== undefined && !Array.isArray(options.minReleaseAgeExclude)) throw new Error("MIN_RELEASE_AGE_EXCLUDE_INVALID");
  if (options.minReleaseAge === undefined) {
    if (options.minReleaseAgeExclude?.length) throw new Error("MIN_RELEASE_AGE_REQUIRED_FOR_EXCLUSIONS");
    return undefined;
  }
  if (!Number.isSafeInteger(options.minReleaseAge) || options.minReleaseAge < 1) throw new Error("MIN_RELEASE_AGE_INVALID");
  const exclusions = options.minReleaseAgeExclude ?? [];
  if (!Array.isArray(exclusions) || exclusions.some(pattern => typeof pattern !== "string" || pattern.length > 214 || !/^(?:@[a-z0-9*?][a-z0-9._*?-]*\/)?[a-z0-9*?][a-z0-9._*?-]*$/.test(pattern))) {
    throw new Error("MIN_RELEASE_AGE_EXCLUDE_INVALID");
  }
  return { minReleaseAge: options.minReleaseAge, minReleaseAgeExclude: [...new Set(exclusions)] };
}

async function npmReleaseAgeCapability(cwd: string, env: Record<string, string>): Promise<string> {
  try {
    const versionProbe = Bun.spawn(["npm", "--version"], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [versionText, versionStatus] = await Promise.all([new Response(versionProbe.stdout).text(), versionProbe.exited]);
    const version = versionText.trim();
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (versionStatus !== 0 || !match || Number(match[1]) < 11 || (Number(match[1]) === 11 && Number(match[2]) < 19)) throw new Error("NPM_RELEASE_AGE_UNSUPPORTED");
    // Probe the isolated registry-only config BEFORE adding policy keys. Unknown
    // user settings can appear in npm config output without implementing them.
    const configProbe = Bun.spawn(["npm", "config", "list", "--json"], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [configText, configStatus] = await Promise.all([new Response(configProbe.stdout).text(), configProbe.exited]);
    const config = object(JSON.parse(configText), "NPM_RELEASE_AGE_UNSUPPORTED");
    if (configStatus !== 0 || !Object.hasOwn(config, "min-release-age") || !Object.hasOwn(config, "min-release-age-exclude") || !Array.isArray(config["min-release-age-exclude"])) throw new Error("NPM_RELEASE_AGE_UNSUPPORTED");
    return version;
  } catch { throw new Error("NPM_RELEASE_AGE_UNSUPPORTED"); }
}

async function runNpm(args: string[], cwd: string, home: string, staging: string, policy?: NpmReleaseAgePolicy): Promise<string | undefined> {
  const userNpmrc = join(staging, "npm-user.npmrc"), globalNpmrc = join(staging, "npm-global.npmrc");
  const baseConfig = `registry=${REGISTRY_ORIGIN}/\nignore-scripts=true\n`;
  if (!existsSync(globalNpmrc)) writeFileSync(globalNpmrc, baseConfig, { mode: 0o600, flag: "wx" });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: staging,
    TMP: staging,
    TEMP: staging,
    CI: "1",
    NPM_CONFIG_USERCONFIG: userNpmrc,
    NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    NPM_CONFIG_CACHE: join(staging, "npm-cache"),
    NPM_CONFIG_REGISTRY: `${REGISTRY_ORIGIN}/`,
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
  };
  const capabilityNpmrc = join(staging, "npm-capability.npmrc");
  if (policy && !existsSync(capabilityNpmrc)) writeFileSync(capabilityNpmrc, baseConfig, { mode: 0o600, flag: "wx" });
  if (policy && readFileSync(capabilityNpmrc, "utf8") !== baseConfig) throw new Error("NPM_ISOLATED_CONFIG_DRIFT");
  const npmVersion = policy ? await npmReleaseAgeCapability(cwd, { ...env, NPM_CONFIG_USERCONFIG: capabilityNpmrc }) : undefined;
  const config = baseConfig + (policy ? `min-release-age=${policy.minReleaseAge}\n${policy.minReleaseAgeExclude.map(pattern => `min-release-age-exclude[]=${pattern}\n`).join("")}` : "");
  if (!existsSync(userNpmrc)) writeFileSync(userNpmrc, config, { mode: 0o600, flag: "wx" });
  if (readFileSync(userNpmrc, "utf8") !== config || readFileSync(globalNpmrc, "utf8") !== baseConfig) throw new Error("NPM_ISOLATED_CONFIG_DRIFT");
  const proc = Bun.spawn(["npm", ...args, "--registry", `${REGISTRY_ORIGIN}/`, "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd, env, stdin: "ignore", stdout: "ignore", stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error("DEPENDENCY_GRAPH_INSTALL_FAILED");
  return npmVersion;
}

function comparePackageTrees(expectedRoot: string, installedRoot: string): string {
  if (entryExists(join(expectedRoot, "node_modules"))) throw new Error("TARBALL_BUNDLED_DEPENDENCIES_UNSUPPORTED");
  const expected = readTree(expectedRoot, false);
  const installed = readTree(installedRoot, false, true);
  if (JSON.stringify(expected.entries) !== JSON.stringify(installed.entries)) throw new Error("INSTALLED_PACKAGE_BYTES_MISMATCH");
  return expected.digest;
}

// Switch one launcher: the exact old state is first preserved at its backup
// path and read back, then the new (pinned) launcher is created beside it and
// renamed over the old one atomically.
function replaceLauncher(item: LauncherRecord): void {
  const oldState = oldLauncherState(item), newState = newLauncherState(item);
  if (!launcherIs(item.path, oldState) || entryExists(item.backupPath)) throw new Error("LAUNCHER_PREIMAGE_DRIFT");
  const temp = `${item.path}.skills-next-${randomUUID()}`;
  try { materializeLauncher(item.backupPath, oldState); } catch { throw new Error("LAUNCHER_BACKUP_READBACK_MISMATCH"); }
  if (!launcherIs(item.backupPath, oldState)) throw new Error("LAUNCHER_BACKUP_READBACK_MISMATCH");
  try { materializeLauncher(temp, newState); } catch { throw new Error("LAUNCHER_NEW_LINK_READBACK_MISMATCH"); }
  if (!launcherIs(temp, newState)) throw new Error("LAUNCHER_NEW_LINK_READBACK_MISMATCH");
  renameSync(temp, item.path);
}

function atomicJson(path: string, value: unknown): void {
  const temp = `${path}.next-${randomUUID()}`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  if (!readFileSync(path).equals(bytes)) throw new Error("RECEIPT_READBACK_MISMATCH");
}

function persistReceipt(path: string, value: CopyfileReceipt): void {
  if (entryExists(path)) {
    const priorBytes = readFileSync(path);
    const prior = object(JSON.parse(priorBytes.toString("utf8")), "RECEIPT_INVALID");
    if (prior.id !== value.id || prior.schema !== "skills.copyfile-runtime-receipt.v1" || typeof prior.state !== "string" || !/^[a-z-]{1,32}$/.test(prior.state)) throw new Error("RECEIPT_ID_DRIFT");
    const nextBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (priorBytes.equals(nextBytes)) return;
    const historyRoot = join(dirname(path), "receipt-history");
    if (!entryExists(historyRoot)) mkdirSync(historyRoot, { mode: 0o700 });
    const historyStat = lstatSync(historyRoot);
    if (!historyStat.isDirectory() || historyStat.isSymbolicLink() || (historyStat.mode & 0o077) !== 0) throw new Error("RECEIPT_HISTORY_NOT_PRIVATE");
    const historyPath = join(historyRoot, `${value.id}-${String(prior.state)}-${randomUUID()}.json`);
    writeFileSync(historyPath, priorBytes, { flag: "wx", mode: 0o400 });
    chmodSync(historyPath, 0o400);
    if (!readFileSync(historyPath).equals(priorBytes)) throw new Error("RECEIPT_HISTORY_READBACK_MISMATCH");
  }
  atomicJson(path, value);
}

function persistAliasReceipt(path: string, value: AliasReceipt): void {
  if (entryExists(path)) {
    const priorBytes = readFileSync(path);
    const prior = object(JSON.parse(priorBytes.toString("utf8")), "ALIAS_RECEIPT_INVALID");
    if (prior.schema !== value.schema || prior.id !== value.id || typeof prior.state !== "string") throw new Error("ALIAS_RECEIPT_DRIFT");
    const nextBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (priorBytes.equals(nextBytes)) return;
    const history = join(dirname(path), "history");
    if (!entryExists(history)) mkdirSync(history, { mode: 0o700 });
    const historyStat = lstatSync(history);
    if (!historyStat.isDirectory() || historyStat.isSymbolicLink() || (historyStat.mode & 0o077) !== 0) throw new Error("ALIAS_RECEIPT_HISTORY_UNSAFE");
    const saved = join(history, `${value.id}-${String(prior.state)}-${randomUUID()}.json`);
    writeFileSync(saved, priorBytes, { flag: "wx", mode: 0o400 });
    chmodSync(saved, 0o400);
    if (!readFileSync(saved).equals(priorBytes)) throw new Error("ALIAS_RECEIPT_HISTORY_READBACK_MISMATCH");
  }
  atomicJson(path, value);
}

function assertOwnedSafePath(path: string, home: string, requireWritable = false): void {
  assertNoSymlinkAncestors(path);
  for (let current = path;; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || ![0, process.getuid?.() ?? -1].includes(stat.uid) || (stat.mode & 0o022)) throw new Error("ALIAS_PATH_UNSAFE");
    if (current === path && requireWritable && (stat.uid !== (process.getuid?.() ?? -1) || (stat.mode & 0o200) === 0)) throw new Error("ALIAS_DIRECTORY_NOT_OWNED");
    if (current === dirname(current) || current === home) break;
  }
}

function activeAliasRuntime(home: string, pathValue: string): { layout: RuntimeLayout; rollout: CopyfileReceipt } {
  const layout = resolveRuntimeLayout(home, pathValue);
  const runtimePath = dirname(dirname(dirname(layout.currentPackageRoot)));
  const receiptPath = join(runtimePath, "rollout-receipt.json");
  const rollout = object(JSON.parse(readFileSync(receiptPath, "utf8")), "ROLLOUT_RECEIPT_INVALID") as unknown as CopyfileReceipt;
  if (rollout.schema !== "skills.copyfile-runtime-receipt.v1" || rollout.state !== "switched"
      || rollout.targetPackageRoot !== layout.currentPackageRoot || rollout.targetVersion !== layout.currentVersion
      || rollout.runtimeRoot !== layout.runtimeRoot || rollout.package !== PACKAGE_NAME
      || hash(readFileSync(join(runtimePath, "verified-package.tgz"))) !== rollout.tarballSha256
      || readTree(join(runtimePath, "node_modules"), true).digest !== rollout.runtimeTreeSha256) {
    throw new Error("ACTIVE_RUNTIME_RECEIPT_DRIFT");
  }
  verifyPreimageManifest(runtimePath, rollout, home);
  return { layout, rollout };
}

function aliasDirs(home: string): string[] {
  return [join(home, ".local", "bin"), join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

function aliasPackageLink(home: string, aliasPath: string): string | null {
  const dir = dirname(aliasPath);
  if (dir === join(home, ".local", "bin")) return join(home, ".local", "lib", "node_modules", "@hasna", "skills");
  if (dir === "/opt/homebrew/bin") return "/opt/homebrew/lib/node_modules/@hasna/skills";
  if (dir === "/usr/local/bin") return "/usr/local/lib/node_modules/@hasna/skills";
  return null;
}

// npm/Homebrew may leave a public bin link pointing through exactly one
// package-root link. Admit only the fixed public package location and an
// owned, non-writable one-hop link to an old verified copyfile runtime.
function inspectAliasPackageChain(
  home: string, aliasPath: string, oldLinkTarget: string, oldTarget: string, bin: string,
  expected?: AliasPackageChain, verify = false,
): AliasPackageChain | undefined {
  const immediate = resolve(dirname(aliasPath), oldLinkTarget);
  if (immediate === oldTarget) {
    if (expected !== undefined) throw new Error("ALIAS_LINK_CHAIN_DRIFT");
    return undefined;
  }
  const packageLinkPath = aliasPackageLink(home, aliasPath);
  const physicalPackage = dirname(dirname(oldTarget));
  if (!packageLinkPath || immediate !== join(packageLinkPath, bin)
      || !isWithin(join(home, ".hasna", "skills", "runtime"), physicalPackage)) {
    throw new Error("ALIAS_LINK_CHAIN_UNSUPPORTED");
  }
  assertOwnedSafePath(dirname(packageLinkPath), home);
  let stat: ReturnType<typeof lstatSync>, packageLinkTarget: string, resolved: string;
  try {
    stat = lstatSync(packageLinkPath);
    packageLinkTarget = readlinkSync(packageLinkPath);
    resolved = realpathSync(packageLinkPath);
  } catch { throw new Error("ALIAS_LINK_CHAIN_UNSUPPORTED"); }
  if (expected !== undefined && (expected.packageLinkPath !== packageLinkPath
      || expected.packageLinkTarget !== packageLinkTarget)) throw new Error("ALIAS_LINK_CHAIN_DRIFT");
  if (!stat.isSymbolicLink() || stat.uid !== (process.getuid?.() ?? -1)
      || resolve(dirname(packageLinkPath), packageLinkTarget) !== physicalPackage
      || resolved !== physicalPackage) throw new Error("ALIAS_LINK_CHAIN_UNSUPPORTED");
  const chain = { packageLinkPath, packageLinkTarget };
  if (verify && expected === undefined) throw new Error("ALIAS_LINK_CHAIN_DRIFT");
  return chain;
}

function validateAliasSource(home: string, name: string, actual: string): { version: string; packageRoot: string; binarySha256: string } {
  const packageRoot = dirname(dirname(actual));
  const roots = [join(home, ".hasna", "skills", "runtime"), join(home, ".bun", "install"), join(home, ".local", "lib", "node_modules")];
  if (basename(packageRoot) !== "skills" || basename(dirname(packageRoot)) !== "@hasna" || !roots.some(root => isWithin(root, packageRoot))) {
    throw new Error("ALIAS_SOURCE_ROOT_UNSUPPORTED");
  }
  assertOwnedSafePath(packageRoot, home);
  const manifestPath = join(packageRoot, "package.json");
  const manifestStat = lstatSync(manifestPath), binaryStat = lstatSync(actual);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || !binaryStat.isFile() || binaryStat.isSymbolicLink()
      || ![0, process.getuid?.() ?? -1].includes(manifestStat.uid) || ![0, process.getuid?.() ?? -1].includes(binaryStat.uid)
      || (manifestStat.mode & 0o022)) throw new Error("ALIAS_SOURCE_UNSAFE");
  const pkg = readPackage(manifestPath);
  if (!pkg.bins[name] || actual !== join(packageRoot, pkg.bins[name])) throw new Error("ALIAS_SOURCE_BIN_MISMATCH");
  return { version: pkg.version, packageRoot, binarySha256: hash(readFileSync(actual)) };
}

export function adoptCopyfileAliases(options: { homeDir?: string; pathValue?: string; onAliasSwitched?: (path: string) => void } = {}): JsonObject {
  const home = realpathSync(resolve(options.homeDir ?? process.env.HOME ?? ""));
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const { layout, rollout } = activeAliasRuntime(home, pathValue);
  const currentRuntime = dirname(dirname(dirname(layout.currentPackageRoot)));
  // Adopted aliases are written in the pinned shape, trusted to the active runtime
  // version root. Resolve and check that shape before taking the runtime lock: a
  // refusal here must not leave the lock held (it also guards both rollbacks).
  const launcherRuntime = pinnedLauncherRuntime();
  pinnedLauncherState(launcherRuntime, currentRuntime, join(layout.currentPackageRoot, layout.bin.skills ?? "bin/index.js"));
  const releaseLock = acquireRuntimeLock(layout.runtimeRoot);
  const id = randomUUID();
  const aliases: AliasReceipt["aliases"] = [];
  const receiptDir = join(currentRuntime, "alias-adoptions");
  const receiptPath = join(receiptDir, `${id}.json`);
  let receipt: AliasReceipt | undefined;
  try {
    const locked = activeAliasRuntime(home, pathValue);
    if (locked.layout.currentPackageRoot !== layout.currentPackageRoot || locked.rollout.id !== rollout.id) throw new Error("ACTIVE_RUNTIME_CHANGED_BEFORE_ALIAS_ADOPTION");
    for (const dir of aliasDirs(home)) {
      if (!entryExists(dir)) continue;
      for (const [name, target] of Object.entries(layout.bin)) {
        const path = join(dir, name);
        if (!entryExists(path)) continue;
        assertOwnedSafePath(dir, home, true);
        const stat = lstatSync(path);
        if (stat.uid !== (process.getuid?.() ?? -1)) throw new Error("ALIAS_LINK_NOT_OWNED");
        let launcher;
        try { launcher = inspectLauncher(path); } catch { throw new Error("ALIAS_LINK_CHAIN_UNSUPPORTED"); }
        if (launcher.kind === "foreign") throw new Error("ALIAS_LINK_NOT_OWNED");
        const actual = launcher.target;
        const oldLinkTarget = launcher.kind === "symlink" ? launcher.linkTarget : actual;
        const newTarget = join(layout.currentPackageRoot, target);
        // A launcher already pinned to the current entry is left as it is. A bare
        // symlink that already reaches the current entry (the shape an updater
        // before pinned launchers wrote, including for this very runtime) is
        // adopted like any other alias: same checks, backup, receipt and rollback.
        if (actual === newTarget && launcher.kind === "pinned" && launcher.format === "v2"
          && launcher.profile === launcherProfileForBin(name, target)) continue;
        const chain = inspectAliasPackageChain(home, path, oldLinkTarget, actual, target);
        const source = validateAliasSource(home, name, actual);
        const backupPath = `${path}.skills-alias-prev-${id}`;
        if (entryExists(backupPath)) throw new Error("ALIAS_BACKUP_COLLISION");
        const oldFields = launcher.kind === "symlink"
          ? { oldShape: "symlink" as const }
          : { oldShape: "pinned" as const, oldRuntime: launcher.runtime, oldCwd: launcher.cwd, oldSha256: launcher.sha256, oldFormat: launcher.format, oldProfile: launcher.profile };
        aliases.push({
          path, oldTarget: actual, oldLinkTarget, oldVersion: source.version, oldBinarySha256: source.binarySha256, newTarget, backupPath,
          ...oldFields, ...pinnedRecordFields(launcherRuntime, currentRuntime, newTarget, launcherProfileForBin(name, target)), ...(chain ? { chain } : {}),
        });
      }
    }
    if (!aliases.length) return { adopted: true, version: layout.currentVersion, aliasCount: 0 };
    mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
    const receiptDirStat = lstatSync(receiptDir);
    if (!receiptDirStat.isDirectory() || receiptDirStat.isSymbolicLink() || (receiptDirStat.mode & 0o077)) throw new Error("ALIAS_RECEIPT_DIRECTORY_UNSAFE");
    receipt = {
      schema: "skills.copyfile-alias-adoption.v1", id, state: "prepared",
      targetVersion: layout.currentVersion, targetPackageRoot: layout.currentPackageRoot, rolloutReceiptId: rollout.id,
      aliases, switchedAliases: [], rollbackCompletedAliases: [],
    };
    writeJsonPrivate(receiptPath, receipt);
    for (const item of aliases) {
      if (!launcherIs(item.path, oldLauncherState(item))) throw new Error("ALIAS_CHANGED_BEFORE_SWITCH");
      inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
      const source = validateAliasSource(home, basename(item.path), item.oldTarget);
      if (source.version !== item.oldVersion || source.binarySha256 !== item.oldBinarySha256) throw new Error("ALIAS_SOURCE_DRIFT");
      receipt.state = "switching";
      receipt.switchedAliases = [...receipt.switchedAliases, item.path];
      persistAliasReceipt(receiptPath, receipt);
      replaceLauncher(item);
      if (!launcherIs(item.path, newLauncherState(item)) || !launcherIs(item.backupPath, oldLauncherState(item))) throw new Error("ALIAS_SWITCH_READBACK_MISMATCH");
      inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
      options.onAliasSwitched?.(item.path);
    }
    for (const item of aliases) {
      inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
      if (!launcherIs(item.backupPath, oldLauncherState(item))) throw new Error("ALIAS_BACKUP_DRIFT");
    }
    receipt.state = "switched";
    persistAliasReceipt(receiptPath, receipt);
    return { adopted: true, version: layout.currentVersion, receiptId: id, aliasCount: aliases.length };
  } catch (error) {
    if (receipt) {
      let failed = false;
      for (const item of [...aliases].reverse()) {
        try {
          if (!entryExists(item.backupPath)) {
            inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
            const source = validateAliasSource(home, basename(item.path), item.oldTarget);
            if (!entryExists(item.path) || !launcherIs(item.path, oldLauncherState(item))
                || source.version !== item.oldVersion || source.binarySha256 !== item.oldBinarySha256) failed = true;
            continue;
          }
          if (!launcherIs(item.backupPath, oldLauncherState(item))) throw new Error("ALIAS_BACKUP_DRIFT");
          inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
          const source = validateAliasSource(home, basename(item.path), item.oldTarget);
          if (source.version !== item.oldVersion || source.binarySha256 !== item.oldBinarySha256) throw new Error("ALIAS_SOURCE_DRIFT");
          if (launcherIs(item.path, oldLauncherState(item))) continue;
          if (launcherTarget(item.path) !== item.newTarget) throw new Error("ALIAS_CHANGED_DURING_ROLLBACK");
          const after = `${item.path}.skills-alias-after-${id}`;
          if (entryExists(after)) throw new Error("ALIAS_AFTER_COLLISION");
          materializeLauncher(after, newLauncherState(item));
          const temp = `${item.path}.skills-alias-rollback-${randomUUID()}`;
          materializeLauncher(temp, oldLauncherState(item));
          renameSync(temp, item.path);
          if (!launcherIs(item.path, oldLauncherState(item))) throw new Error("ALIAS_ROLLBACK_READBACK_MISMATCH");
          receipt.rollbackCompletedAliases = [...receipt.rollbackCompletedAliases, item.path];
          persistAliasReceipt(receiptPath, receipt);
        } catch { failed = true; }
      }
      receipt.state = failed ? "rollback-required" : "rolled-back";
      try { persistAliasReceipt(receiptPath, receipt); } catch { failed = true; }
      throw new Error(failed ? "ALIAS_ADOPTION_ROLLBACK_REQUIRED" : "ALIAS_ADOPTION_ROLLED_BACK");
    }
    throw error instanceof Error ? error : new Error("ALIAS_ADOPTION_FAILED");
  } finally {
    releaseLock();
  }
}

export function rollbackCopyfileAliases(receiptId: string, options: { homeDir?: string; pathValue?: string } = {}): JsonObject {
  if (!/^[0-9a-f-]{36}$/.test(receiptId)) throw new Error("ALIAS_RECEIPT_ID_INVALID");
  const home = realpathSync(resolve(options.homeDir ?? process.env.HOME ?? ""));
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const { layout, rollout } = activeAliasRuntime(home, pathValue);
  const runtimePath = dirname(dirname(dirname(layout.currentPackageRoot)));
  const receiptPath = join(runtimePath, "alias-adoptions", `${receiptId}.json`);
  const releaseLock = acquireRuntimeLock(layout.runtimeRoot);
  try {
    const locked = activeAliasRuntime(home, pathValue);
    if (locked.layout.currentPackageRoot !== layout.currentPackageRoot || locked.rollout.id !== rollout.id) throw new Error("ACTIVE_RUNTIME_CHANGED_BEFORE_ALIAS_ROLLBACK");
    const receipt = object(JSON.parse(readFileSync(receiptPath, "utf8")), "ALIAS_RECEIPT_INVALID") as unknown as AliasReceipt;
    if (receipt.schema !== "skills.copyfile-alias-adoption.v1" || receipt.id !== receiptId
        || !["switched", "switching", "rollback-required"].includes(receipt.state)
        || receipt.targetPackageRoot !== layout.currentPackageRoot || receipt.targetVersion !== layout.currentVersion
        || receipt.rolloutReceiptId !== rollout.id || !Array.isArray(receipt.aliases)) throw new Error("ALIAS_RECEIPT_BINDING_INVALID");
    const seen = new Set<string>();
    for (const item of receipt.aliases) {
      const name = basename(item.path), target = layout.bin[name];
      if (!target || seen.has(item.path) || !aliasDirs(home).includes(dirname(item.path))
          || item.newTarget !== join(layout.currentPackageRoot, target)
          || item.backupPath !== `${item.path}.skills-alias-prev-${receiptId}`
          || (item.chain !== undefined && (!item.chain || typeof item.chain !== "object"
              || typeof item.chain.packageLinkPath !== "string" || typeof item.chain.packageLinkTarget !== "string"))) {
        throw new Error("ALIAS_RECEIPT_LAUNCHER_INVALID");
      }
      inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, target, item.chain, true);
      assertLauncherRecordShapes(item, launcherProfileForBin(name, target));
      seen.add(item.path);
      assertOwnedSafePath(dirname(item.path), home, true);
      const source = validateAliasSource(home, name, item.oldTarget);
      if (source.version !== item.oldVersion || source.binarySha256 !== item.oldBinarySha256) throw new Error("ALIAS_PREIMAGE_DRIFT");
      const stat = lstatSync(item.path);
      if (stat.uid !== (process.getuid?.() ?? -1)) throw new Error("ALIAS_LINK_DRIFT");
      let current: string;
      try { current = launcherTarget(item.path); } catch { throw new Error("ALIAS_LINK_DRIFT"); }
      if (!launcherIs(item.path, newLauncherState(item)) && !launcherIs(item.path, oldLauncherState(item))) throw new Error("ALIAS_TARGET_DRIFT");
      if (entryExists(item.backupPath)) {
        if (!launcherIs(item.backupPath, oldLauncherState(item))) throw new Error("ALIAS_PREIMAGE_DRIFT");
      } else if (current !== item.oldTarget || !launcherIs(item.path, oldLauncherState(item))) {
        // Without its backup a launcher must still be in its old state. The target
        // alone cannot tell when the old and new targets are the same entry (a bare
        // symlink pinned in place), so the exact old shape is required as well.
        throw new Error("ALIAS_BACKUP_MISSING_FOR_SWITCH");
      }
    }
    let restored = 0;
    for (const item of [...receipt.aliases].reverse()) {
      if (launcherIs(item.path, oldLauncherState(item))) continue;
      receipt.state = "rollback-required";
      persistAliasReceipt(receiptPath, receipt);
      const after = `${item.path}.skills-alias-after-${receiptId}`;
      if (!entryExists(after)) {
        try { materializeLauncher(after, newLauncherState(item)); } catch { throw new Error("ALIAS_AFTER_READBACK_MISMATCH"); }
      } else if (!launcherIs(after, newLauncherState(item))) throw new Error("ALIAS_AFTER_DRIFT");
      if (launcherTarget(item.path) !== item.newTarget) throw new Error("ALIAS_TARGET_DRIFT");
      const temp = `${item.path}.skills-alias-rollback-${randomUUID()}`;
      materializeLauncher(temp, oldLauncherState(item));
      renameSync(temp, item.path);
      if (!launcherIs(item.path, oldLauncherState(item))) throw new Error("ALIAS_ROLLBACK_READBACK_MISMATCH");
      receipt.rollbackCompletedAliases = [...new Set([...receipt.rollbackCompletedAliases, item.path])];
      persistAliasReceipt(receiptPath, receipt);
      restored++;
    }
    for (const item of receipt.aliases) {
      inspectAliasPackageChain(home, item.path, item.oldLinkTarget, item.oldTarget, layout.bin[basename(item.path)]!, item.chain, true);
    }
    receipt.state = "rolled-back";
    persistAliasReceipt(receiptPath, receipt);
    return { rolledBack: true, receiptId, restoredAliasCount: restored };
  } finally {
    releaseLock();
  }
}

export async function updateCopyfileRuntime(version: string, options: { homeDir?: string; pathValue?: string; cwd?: string; registryOrigin?: string; fetcher?: typeof fetch; minReleaseAge?: number; minReleaseAgeExclude?: string[]; reviewedLock?: string; reviewedLockSha256?: string; onLauncherSwitched?: (path: string) => void } = {}): Promise<JsonObject> {
  if (!new RegExp(SEMVER_PATTERN).test(version)) throw new Error("EXACT_VERSION_REQUIRED");
  if (!STABLE_SEMVER_PATTERN.test(version)) throw new Error("EXACT_STABLE_VERSION_REQUIRED");
  const policy = releaseAgePolicy(options);
  let reviewedLockBytes: Buffer | undefined;
  if (options.reviewedLock !== undefined || options.reviewedLockSha256 !== undefined) {
    if (!options.reviewedLock || !options.reviewedLockSha256) throw new Error("REVIEWED_LOCK_INPUT_PAIR_REQUIRED");
    if (!policy) throw new Error("REVIEWED_LOCK_RELEASE_AGE_REQUIRED");
    if (!isAbsolute(options.reviewedLock)) throw new Error("REVIEWED_LOCK_ABSOLUTE_PATH_REQUIRED");
    assertNoSymlinkAncestors(dirname(options.reviewedLock));
    const stat = lstatSync(options.reviewedLock);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 8 * 1024 * 1024) throw new Error("REVIEWED_LOCK_FILE_UNSAFE");
    reviewedLockBytes = readFileSync(options.reviewedLock);
    if (!/^[a-f0-9]{64}$/.test(options.reviewedLockSha256)) throw new Error("REVIEWED_LOCK_SHA256_INVALID");
    if (hash(reviewedLockBytes) !== options.reviewedLockSha256) throw new Error("REVIEWED_LOCK_HASH_MISMATCH");
  }
  const home = resolve(options.homeDir ?? process.env.HOME ?? "");
  if (!home || !existsSync(home)) throw new Error("HOME_NOT_FOUND");
  const layout = resolveRuntimeLayout(home, options.pathValue ?? process.env.PATH ?? "");
  if (process.platform === "win32") throw new Error("COPYFILE_RUNTIME_PLATFORM_UNSUPPORTED");
  const registryOrigin = options.registryOrigin ?? REGISTRY_ORIGIN;
  const origin = new URL(registryOrigin);
  if (origin.protocol !== "https:" && options.registryOrigin === undefined) throw new Error("REGISTRY_ORIGIN_INVALID");
  if (origin.username || origin.password || origin.search || origin.hash) throw new Error("REGISTRY_ORIGIN_INVALID");
  const runtimeRootStat = lstatSync(layout.runtimeRoot);
  if ((runtimeRootStat.mode & 0o077) !== 0) throw new Error("RUNTIME_ROOT_NOT_PRIVATE");
  const id = randomUUID();
  const stagePath = join(layout.runtimeRoot, `.stage-${version}-${id}`);
  const finalPath = join(layout.runtimeRoot, `${version}-copyfile`);
  // Every switched launcher is written in the pinned shape: the exact Bun
  // running this updater, the new runtime version root as the trusted cwd.
  // Both are resolved and rendered before the runtime lock is taken, so a
  // refusal (LAUNCHER_RUNTIME_UNSAFE, LAUNCHER_*_PATH_INVALID) leaves no lock.
  const launcherRuntime = pinnedLauncherRuntime();
  const launchers = layout.launchers.map(item => {
    const newTarget = join(finalPath, "node_modules", "@hasna", "skills", layout.bin[basename(item.path)]);
    return { ...item, newTarget, ...pinnedRecordFields(launcherRuntime, finalPath, newTarget, launcherProfileForBin(basename(item.path), layout.bin[basename(item.path)]!)) };
  });
  const releaseLock = acquireRuntimeLock(layout.runtimeRoot);
  let switched: string[] = [];
  let moved = false;
  try {
    if (entryExists(finalPath)) throw new Error("TARGET_RUNTIME_ALREADY_EXISTS");
    mkdirSync(stagePath, { mode: 0o700 });
    chmodSync(stagePath, 0o700);
    const configPreimages = captureConfigPreimages(home, stagePath);
    const fetcher = options.fetcher ?? fetch;
    const artifact = await downloadPackage(version, stagePath, origin.origin, fetcher);
    if (artifact.packageBins && JSON.stringify(Object.entries(artifact.packageBins).sort()) !== JSON.stringify(Object.entries(layout.bin).sort())) {
      throw new Error("PACKAGE_BIN_SET_CHANGED");
    }
    const stagePackage = join(stagePath, "install");
    mkdirSync(stagePackage, { mode: 0o700 });
    copyFileSync(artifact.tarballPath, join(stagePackage, "verified.tgz"));
    writeFileSync(join(stagePackage, "package.json"), JSON.stringify({ name: "skills-runtime-install", version: "0.0.0", private: true, dependencies: { [PACKAGE_NAME]: "file:./verified.tgz" } }, null, 2), { mode: 0o600, flag: "wx" });
    let npmVersion: string | undefined;
    if (reviewedLockBytes) {
      await validateReviewedRuntimeLock(reviewedLockBytes, options.reviewedLockSha256!, {
        version, archiveIntegrity: artifact.integrity,
        packageManifest: object(JSON.parse(readFileSync(join(stagePath, "verified-archive", "package", "package.json"), "utf8")), "PACKAGE_MANIFEST_INVALID"),
        registryOrigin: REGISTRY_ORIGIN, ...policy!, fetcher,
      });
      writeFileSync(join(stagePackage, "package-lock.json"), reviewedLockBytes, { mode: 0o600, flag: "wx" });
      if (!readFileSync(join(stagePackage, "package-lock.json")).equals(reviewedLockBytes)) throw new Error("REVIEWED_LOCK_COPY_MISMATCH");
    } else {
      npmVersion = await runNpm(["install", "--package-lock-only", "--prefix", stagePackage], stagePackage, home, stagePath, policy);
    }
    const ciNpmVersion = await runNpm(["ci", "--prefix", stagePackage], stagePackage, home, stagePath, policy);
    if (!reviewedLockBytes && npmVersion !== ciNpmVersion) throw new Error("NPM_VERSION_DRIFT_DURING_UPDATE");
    npmVersion = ciNpmVersion;
    const lockBytes = readFileSync(join(stagePackage, "package-lock.json"));
    if (reviewedLockBytes) {
      if (!lockBytes.equals(reviewedLockBytes)) throw new Error("REVIEWED_LOCK_DRIFT_DURING_INSTALL");
      // npm ls may accept the hidden node_modules lock instead of reading
      // installed manifests. SBOM forceActual checks actual required edges,
      // including missing/invalid dependencies, while honoring optional peers.
      const treeNpmVersion = await runNpm(["sbom", "--sbom-format=cyclonedx", "--package-lock-only=false", "--omit=dev", "--prefix", stagePackage], stagePackage, home, stagePath, policy);
      if (treeNpmVersion !== npmVersion) throw new Error("NPM_VERSION_DRIFT_DURING_UPDATE");
      if (!readFileSync(join(stagePackage, "package-lock.json")).equals(reviewedLockBytes)) throw new Error("REVIEWED_LOCK_DRIFT_DURING_INSTALL");
    }
    const installedPackage = join(stagePackage, "node_modules", "@hasna", "skills");
    const installed = readPackage(join(installedPackage, "package.json"));
    if (installed.version !== version || JSON.stringify(Object.entries(installed.bins).sort()) !== JSON.stringify(Object.entries(layout.bin).sort())) {
      throw new Error("INSTALLED_PACKAGE_IDENTITY_MISMATCH");
    }
    const unpackedPackage = join(stagePath, "verified-archive", "package");
    const packageTreeSha256 = comparePackageTrees(unpackedPackage, installedPackage);
    if (packageTreeSha256 !== artifact.packageTreeSha256) throw new Error("PACKAGE_TREE_HASH_MISMATCH");
    const nodeModules = join(stagePackage, "node_modules");
    normalizeModes(nodeModules);
    chmodSync(stagePath, 0o700);
    const runtimeTree = readTree(nodeModules, true);
    if (runtimeTree.entries.some(entry => entry.kind === "file" && ((entry.mode ?? 0) & 0o022) !== 0)) {
      throw new Error("RUNTIME_FILE_MODE_UNSAFE");
    }
    assertConfigUnchanged(configPreimages);
    const targetPackageRoot = join(finalPath, "node_modules", "@hasna", "skills");
    const preimageSha256 = writePreimageManifest(stagePath, configPreimages, launchers);
    const receipt: CopyfileReceipt = {
      schema: "skills.copyfile-runtime-receipt.v1", id, state: "prepared", package: PACKAGE_NAME,
      currentVersion: layout.currentVersion, targetVersion: version, registryOrigin: origin.origin,
      tarballUrl: artifact.tarballUrl, tarballIntegrity: artifact.integrity, tarballSha256: artifact.sha256,
      tarballBytes: artifact.byteSize, packageTreeSha256, installLockSha256: hash(lockBytes),
      runtimeTreeSha256: runtimeTree.digest, runtimeRoot: layout.runtimeRoot,
      currentPackageRoot: layout.currentPackageRoot, targetPackageRoot, configs: configPreimages, preimageSha256,
      ...(policy ? { dependencyPolicy: { ...policy, npmVersion: npmVersion! } } : {}),
      ...(reviewedLockBytes ? { reviewedLockSha256: options.reviewedLockSha256 } : {}),
      launchers, switchedLaunchers: [], rollbackCompletedLaunchers: [],
    };
    writeJsonPrivate(join(stagePath, "rollout-receipt.json"), receipt);
    try {
      receipt.prerequisites = verifyTargetPrerequisites(installed.data, installedPackage, home, resolve(options.cwd ?? process.env[LAUNCH_CWD_VARIABLE] ?? process.cwd()), options.pathValue ?? process.env.PATH ?? "");
    } catch (error) {
      // Keep the real prepared receipt and exact artifact/preimage bindings.
      // No launcher has switched; all child diagnostics remain unrendered.
      const code = error instanceof Error && /^RUNTIME_PREREQUISITE_[A-Z_]+$/.test(error.message) ? error.message : "RUNTIME_PREREQUISITE_CHECK_UNAVAILABLE";
      receipt.prerequisites = { status: "refused", code };
      persistReceipt(join(stagePath, "rollout-receipt.json"), receipt);
      throw new Error(code);
    }
    persistReceipt(join(stagePath, "rollout-receipt.json"), receipt);
    const finalNodeModules = join(stagePackage, "node_modules");
    const stagedNodeModules = join(stagePath, "node_modules");
    renameSync(finalNodeModules, stagedNodeModules);
    copyFileSync(join(stagePackage, "package-lock.json"), join(stagePath, "install-lock.json"));
    chmodSync(join(stagePath, "install-lock.json"), 0o600);
    const stagedTree = readTree(stagedNodeModules, true);
    if (stagedTree.digest !== runtimeTree.digest) throw new Error("STAGED_RUNTIME_READBACK_MISMATCH");
    receipt.targetPackageRoot = join(finalPath, "node_modules", "@hasna", "skills");
    receipt.runtimeTreeSha256 = stagedTree.digest;
    persistReceipt(join(stagePath, "rollout-receipt.json"), receipt);
    // The complete staged graph is moved physically into a versioned runtime directory on the same filesystem.
    renameSync(stagePath, finalPath);
    moved = true;
    const finalReceiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!readFileSync(join(finalPath, "rollout-receipt.json")).equals(finalReceiptBytes)) throw new Error("RECEIPT_MOVE_READBACK_MISMATCH");
    assertConfigUnchanged(configPreimages);
    for (const item of launchers) {
      if (launcherTarget(item.path) !== item.oldTarget) throw new Error("LAUNCHER_DRIFT_BEFORE_SWITCH");
      receipt.state = "switching";
      receipt.switchedLaunchers = [...receipt.switchedLaunchers, item.path];
      persistReceipt(join(finalPath, "rollout-receipt.json"), receipt);
      replaceLauncher(item);
      if (!launcherIs(item.path, newLauncherState(item)) || !launcherIs(item.backupPath, oldLauncherState(item))) {
        throw new Error("LAUNCHER_SWITCH_READBACK_MISMATCH");
      }
      switched.push(item.path);
      options.onLauncherSwitched?.(item.path);
    }
    receipt.state = "switched";
    persistReceipt(join(finalPath, "rollout-receipt.json"), receipt);
    return { updated: true, version, currentVersion: layout.currentVersion, receiptId: id, runtimeRoot: finalPath, tarballSha256: artifact.sha256, tarballIntegrity: artifact.integrity, runtimeTreeSha256: stagedTree.digest, launcherCount: launchers.length, configCount: configPreimages.length, prerequisites: receipt.prerequisites, ...(policy ? { dependencyPolicy: { ...policy, npmVersion: npmVersion! } } : {}), ...(reviewedLockBytes ? { reviewedLockSha256: options.reviewedLockSha256 } : {}) };
  } catch (error) {
    if (switched.length > 0 || moved) {
      let rollbackFailed = false;
      for (const item of [...launchers].reverse()) {
        try {
          if (launcherIs(item.path, oldLauncherState(item))) continue;
          if (launcherTarget(item.path) !== item.newTarget) throw new Error("LAUNCHER_CHANGED_DURING_ROLLBACK");
          const temp = `${item.path}.skills-rollback-${id}`;
          const afterPath = `${item.path}.skills-after-${id}`;
          if (entryExists(afterPath)) throw new Error("ROLLBACK_PRESERVATION_PATH_EXISTS");
          materializeLauncher(afterPath, newLauncherState(item));
          materializeLauncher(temp, oldLauncherState(item));
          renameSync(temp, item.path);
        } catch { rollbackFailed = true; }
      }
      try {
        const receiptPath = join(finalPath, "rollout-receipt.json");
        const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as CopyfileReceipt;
        receipt.state = rollbackFailed ? "rollback-required" : "rolled-back";
        persistReceipt(receiptPath, receipt);
      } catch { rollbackFailed = true; }
      throw new Error(rollbackFailed ? "UPDATE_FAILED_ROLLBACK_REQUIRED" : "UPDATE_FAILED_ROLLED_BACK");
    }
    throw error instanceof Error ? error : new Error("COPYFILE_UPDATE_FAILED");
  } finally {
    releaseLock();
  }
}

export function rollbackCopyfileRuntime(receiptId: string, options: { homeDir?: string } = {}): JsonObject {
  if (!/^[0-9a-f-]{36}$/.test(receiptId)) throw new Error("RECEIPT_ID_INVALID");
  const home = resolve(options.homeDir ?? process.env.HOME ?? "");
  if (!home || !existsSync(home)) throw new Error("HOME_NOT_FOUND");
  const runtimeRoot = join(realpathSync(home), ".hasna", "skills", "runtime");
  assertNoSymlinkAncestors(runtimeRoot);
  const rootStat = lstatSync(runtimeRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0) throw new Error("RUNTIME_ROOT_NOT_PRIVATE");
  const releaseLock = acquireRuntimeLock(runtimeRoot);
  try {
  const matches = readdirSync(runtimeRoot).filter(name => {
    if (!/^\d+\.\d+\.\d+-copyfile$/.test(name)) return false;
    const receipt = join(runtimeRoot, name, "rollout-receipt.json");
    if (!existsSync(receipt)) return false;
    try { return JSON.parse(readFileSync(receipt, "utf8")).id === receiptId; } catch { return false; }
  });
  if (matches.length !== 1) throw new Error("RECEIPT_NOT_FOUND_OR_AMBIGUOUS");
  const receiptPath = join(runtimeRoot, matches[0], "rollout-receipt.json");
  const receipt = object(JSON.parse(readFileSync(receiptPath, "utf8")), "RECEIPT_INVALID") as unknown as CopyfileReceipt;
  if (receipt.schema !== "skills.copyfile-runtime-receipt.v1" || !["switched", "switching", "rollback-required"].includes(receipt.state) || receipt.runtimeRoot !== runtimeRoot) {
    throw new Error("RECEIPT_STATE_INVALID");
  }
  if (receipt.package !== PACKAGE_NAME || matches[0] !== `${receipt.targetVersion}-copyfile` || !new RegExp(SEMVER_PATTERN).test(receipt.currentVersion) || !new RegExp(SEMVER_PATTERN).test(receipt.targetVersion)) throw new Error("RECEIPT_BINDING_INVALID");
  const runtimePath = join(runtimeRoot, matches[0]);
  if (receipt.targetPackageRoot !== join(runtimePath, "node_modules", "@hasna", "skills") || receipt.currentPackageRoot !== join(runtimeRoot, `${receipt.currentVersion}-copyfile`, "node_modules", "@hasna", "skills")) throw new Error("RECEIPT_RUNTIME_BINDING_INVALID");
  if (readTree(join(runtimePath, "node_modules"), true).digest !== receipt.runtimeTreeSha256) {
    throw new Error("ACTIVE_RUNTIME_TREE_DRIFT");
  }
  verifyPreimageManifest(runtimePath, receipt, home);
  const oldBins = readPackage(join(receipt.currentPackageRoot, "package.json")).bins;
  const newPackage = readPackage(join(receipt.targetPackageRoot, "package.json"));
  if (newPackage.version !== receipt.targetVersion || JSON.stringify(Object.entries(oldBins).sort()) !== JSON.stringify(Object.entries(newPackage.bins).sort())) throw new Error("RECEIPT_BIN_BINDING_INVALID");
  const switched: typeof receipt.launchers = [];
  const seen = new Set<string>();
  for (const item of receipt.launchers) {
    const bin = oldBins[basename(item.path)];
    if (!bin || !isAbsolute(item.path) || seen.has(item.path) || item.oldTarget !== join(receipt.currentPackageRoot, bin) || item.newTarget !== join(receipt.targetPackageRoot, bin) || !/^.+\.skills-prev-[0-9a-f-]{36}$/.test(item.backupPath) || !item.backupPath.startsWith(`${item.path}.skills-prev-`) || typeof item.oldLinkTarget !== "string" || resolve(dirname(item.path), item.oldLinkTarget) !== item.oldTarget) throw new Error("RECEIPT_LAUNCHER_BINDING_INVALID");
    assertNoSymlinkAncestors(dirname(item.path));
    assertLauncherRecordShapes(item, launcherProfileForBin(basename(item.path), bin));
    seen.add(item.path);
    const oldState = oldLauncherState(item), newState = newLauncherState(item);
    let activeTarget: string;
    try { activeTarget = launcherTarget(item.path); } catch { throw new Error("LAUNCHER_DRIFT_ROLLBACK_REFUSED"); }
    if (!launcherIs(item.path, newState) && !launcherIs(item.path, oldState)) throw new Error("LAUNCHER_DRIFT_ROLLBACK_REFUSED");
    const hasBackup = entryExists(item.backupPath);
    if (activeTarget === item.newTarget && !hasBackup) throw new Error("LAUNCHER_PREIMAGE_DRIFT_ROLLBACK_REFUSED");
    if (hasBackup && !launcherIs(item.backupPath, oldState)) throw new Error("LAUNCHER_PREIMAGE_DRIFT_ROLLBACK_REFUSED");
    const afterPath = `${item.path}.skills-after-${receiptId}`;
    if (entryExists(afterPath) && !launcherIs(afterPath, newState)) throw new Error("ROLLBACK_PRESERVATION_DRIFT");
    switched.push(item);
  }
  for (const item of switched.reverse()) {
    if (launcherIs(item.path, oldLauncherState(item))) continue;
    receipt.state = "rollback-required";
    persistReceipt(receiptPath, receipt);
    const afterPath = `${item.path}.skills-after-${receiptId}`;
    if (!entryExists(afterPath)) materializeLauncher(afterPath, newLauncherState(item));
    const temp = `${item.path}.skills-rollback-${receiptId}-${randomUUID()}`;
    materializeLauncher(temp, oldLauncherState(item));
    renameSync(temp, item.path);
    receipt.rollbackCompletedLaunchers = [...new Set([...receipt.rollbackCompletedLaunchers, item.path])];
    persistReceipt(receiptPath, receipt);
  }
  receipt.state = "rolled-back";
  persistReceipt(receiptPath, receipt);
  return { rolledBack: true, receiptId, restoredVersion: receipt.currentVersion, launcherCount: switched.length };
  } finally {
    releaseLock();
  }
}
