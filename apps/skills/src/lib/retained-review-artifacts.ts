/** Exact, immutable review evidence; never a snapshot exemption for live inputs. */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import type { AgentDiscoveryBinding, DiscoverySource } from "./agent-discovery.js";
import { projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";

export interface ReviewedArtifact { kind: "codex-native-catalog"; path: string; sha256: string }
export interface RetainedReviewArtifact { version: 1; kind: "codex-native-catalog"; storeRoot: string; originalPath: string; sha256: string; catalogSha256: string }
export interface ReviewArtifactChange { path: string; before: null; after: string; artifact: RetainedReviewArtifact }
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const refuse = (): never => { throw new Error("REVIEW_ARTIFACT_INVALID"); };
const need = (condition: unknown): void => { if (!condition) refuse(); };
function keys(value: unknown, names: string[]): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}
function safe(path: string): void {
  need(typeof path === "string" && path.length <= AGENT_POLICY_LIMITS.pathCharacters && isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path));
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    need(!stat?.isSymbolicLink());
    if (cursor !== path && stat) need(stat.isDirectory());
    if (dirname(cursor) === cursor) break;
  }
}
function readExact(path: string): string {
  safe(path);
  const before = lstatSync(path, { throwIfNoEntry: false });
  need(before?.isFile() && before.nlink === 1 && before.size <= AGENT_POLICY_LIMITS.discoveryRawSourceBytes
    && (before.mode & 0o077) === 0 && (process.getuid === undefined || before.uid === process.getuid()));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    need(opened.dev === before!.dev && opened.ino === before!.ino && opened.size === before!.size
      && opened.mode === before!.mode && opened.uid === before!.uid && opened.nlink === 1);
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); need(count > 0); offset += count; }
    need(readSync(fd, Buffer.alloc(1), 0, 1, null) === 0);
    const after = fstatSync(fd), current = lstatSync(path, { throwIfNoEntry: false }); safe(path);
    need(current && opened.dev === current.dev && opened.ino === current.ino && opened.mode === current.mode
      && opened.uid === current.uid && opened.size === current.size && opened.mtimeMs === current.mtimeMs
      && opened.ctimeMs === current.ctimeMs && current.nlink === 1 && opened.mode === after.mode && opened.uid === after.uid
      && after.nlink === 1 && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    need(Buffer.from(text).equals(bytes)); return text;
  } finally { closeSync(fd); }
}
function catalogDigest(text: string): string {
  let catalog: any; try { catalog = JSON.parse(text); } catch { return refuse(); }
  need(catalog && typeof catalog === "object" && !Array.isArray(catalog)
    && Object.keys(catalog).every(key => ["version", "cwd", "skills", "plugins"].includes(key))
    && typeof catalog.version === "string" && supportsCodexNativeCapability(catalog.version, "installed-plugin-review"));
  const skills = projectCodexNativeSkillCatalog({ data: [{ cwd: catalog.cwd, errors: [], skills: catalog.skills }] }, catalog.cwd);
  const plugins = catalog.plugins === undefined ? undefined : projectCodexInstalledPluginEntries(catalog.plugins);
  return sha(JSON.stringify({ version: catalog.version, cwd: catalog.cwd, skills, ...(plugins === undefined ? {} : { plugins }) }));
}
export function verifyReviewArtifactOriginal(path: string, expectedSha256: string): void {
  need(hex(expectedSha256) && sha(readExact(path)) === expectedSha256);
}
export function retainedArtifactPath(metadata: RetainedReviewArtifact): string {
  return join(metadata.storeRoot, "agent-discovery", "artifacts", metadata.sha256, "catalog.json");
}
export function validRetainedArtifact(value: unknown): value is RetainedReviewArtifact {
  return keys(value, ["version", "kind", "storeRoot", "originalPath", "sha256", "catalogSha256"])
    && value.version === 1 && value.kind === "codex-native-catalog" && hex(value.sha256) && hex(value.catalogSha256)
    && [value.storeRoot, value.originalPath].every(path => typeof path === "string" && isAbsolute(path) && resolve(path) === path && path.length <= AGENT_POLICY_LIMITS.pathCharacters && !/[\x00-\x1f\x7f]/.test(path));
}
function privateStore(storeRoot: string): void {
  safe(storeRoot);
  const stat = lstatSync(storeRoot, { throwIfNoEntry: false });
  need(!stat || stat.isDirectory() && (stat.mode & 0o022) === 0 && (process.getuid === undefined || stat.uid === process.getuid()));
}
export function verifyRetainedReviewArtifact(source: DiscoverySource, storeRoot?: string): void {
  const artifact = source.reviewArtifact;
  need(validRetainedArtifact(artifact) && source.hashMode === "bytes" && source.sha256 === artifact!.sha256
    && source.format === undefined && source.fields === undefined && source.managedPlugins === undefined
    && source.path === retainedArtifactPath(artifact!) && (storeRoot === undefined || artifact!.storeRoot === resolve(storeRoot)));
  privateStore(artifact!.storeRoot);
  const text = readExact(source.path); need(sha(text) === artifact!.sha256 && catalogDigest(text) === artifact!.catalogSha256);
  for (let parent = dirname(source.path); parent !== artifact!.storeRoot; parent = dirname(parent)) {
    const stat = lstatSync(parent); need(stat.isDirectory() && (stat.mode & 0o077) === 0 && (process.getuid === undefined || stat.uid === process.getuid()));
  }
}
/** Planning only: preserve source bytes and lineage, but create no storage. */
export function planReviewArtifactRetention(binding: AgentDiscoveryBinding, artifacts: ReviewedArtifact[] | undefined, dataDir: string, home: string) {
  if (artifacts === undefined) return { binding, changes: [] as ReviewArtifactChange[], observed: [] as Array<{ path: string; sha256: string }> };
  need(binding.agent === "codex" && binding.method === "reviewed" && Array.isArray(artifacts) && artifacts.length > 0 && artifacts.length <= 32);
  privateStore(resolve(dataDir)); const paths = new Set<string>(); const changes: ReviewArtifactChange[] = [], observed: Array<{ path: string; sha256: string }> = [];
  let totalBytes = 0;
  const sources = binding.sources.slice();
  for (const declaration of artifacts) {
    need(keys(declaration, ["kind", "path", "sha256"]) && declaration.kind === "codex-native-catalog" && hex(declaration.sha256) && !paths.has(declaration.path));
    paths.add(declaration.path); safe(declaration.path);
    const liveRoots = [join(home, ".codex"), ...binding.roots, ...(binding.directories ?? []).map(item => item.path)];
    need(!liveRoots.some(root => declaration.path === root || declaration.path.startsWith(root + sep)));
    const matches = sources.filter(source => source.path === declaration.path);
    need(matches.length === 1 && matches[0]!.sha256 === declaration.sha256 && matches[0]!.reviewArtifact === undefined
      && [undefined, "bytes"].includes(matches[0]!.hashMode) && matches[0]!.format === undefined && matches[0]!.fields === undefined && matches[0]!.managedPlugins === undefined);
    const text = readExact(declaration.path); need(sha(text) === declaration.sha256);
    totalBytes += Buffer.byteLength(text); need(totalBytes <= AGENT_POLICY_LIMITS.discoveryRawTotalBytes);
    const metadata: RetainedReviewArtifact = { version: 1, kind: declaration.kind, storeRoot: resolve(dataDir), originalPath: declaration.path, sha256: declaration.sha256, catalogSha256: catalogDigest(text) };
    const path = retainedArtifactPath(metadata); safe(path);
    const source: DiscoverySource = { path, sha256: metadata.sha256, hashMode: "bytes", reviewArtifact: metadata };
    if (lstatSync(path, { throwIfNoEntry: false })) verifyRetainedReviewArtifact(source, dataDir);
    else if (!changes.some(change => change.path === path)) changes.push({ path, before: null, after: text, artifact: metadata });
    sources[sources.indexOf(matches[0]!)] = source; observed.push({ path: declaration.path, sha256: declaration.sha256 });
  }
  return { binding: { ...binding, sources }, changes, observed };
}
/** Publish only an absent exact-byte artifact; existing immutable bytes are never replaced. */
export function writeReviewArtifactExclusive(change: ReviewArtifactChange): void {
  safe(change.path); need(change.before === null && validRetainedArtifact(change.artifact)
    && change.path === retainedArtifactPath(change.artifact) && sha(change.after) === change.artifact.sha256
    && catalogDigest(change.after) === change.artifact.catalogSha256); privateStore(change.artifact.storeRoot); const missing: string[] = [];
  for (let parent = dirname(change.path); !lstatSync(parent, { throwIfNoEntry: false }); parent = dirname(parent)) missing.push(parent);
  for (const parent of missing.reverse()) mkdirSync(parent, { mode: 0o700 });
  safe(change.path); privateStore(change.artifact.storeRoot);
  for (let parent = dirname(change.path); parent !== change.artifact.storeRoot; parent = dirname(parent)) {
    const stat = lstatSync(parent); need(stat.isDirectory() && (stat.mode & 0o077) === 0 && (process.getuid === undefined || stat.uid === process.getuid()));
  }
  const fd = openSync(change.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { const bytes = Buffer.from(change.after); let offset = 0; while (offset < bytes.length) { const count = writeSync(fd, bytes, offset, bytes.length - offset); need(count > 0); offset += count; } fsyncSync(fd); }
  finally { closeSync(fd); }
  need(readExact(change.path) === change.after);
  const directory = openSync(dirname(change.path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
