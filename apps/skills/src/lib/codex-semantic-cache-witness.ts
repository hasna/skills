/**
 * Versioned semantic witness for Codex's plugin cache.
 *
 * This is deliberately Codex-specific. Generic discovery-directory hashes
 * continue to bind every name and file type. This projection permits inert
 * cache assets and equivalent version materializations to change only after
 * the existing package-owned plugin-control reviewer has accepted the
 * effective plugin controls and the complete qualified skill-name set stays
 * identical.
 */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import {
  classifyCodexPluginCacheDocument,
  readCodexPluginRootControls,
  reviewedCodexPluginCapabilitiesUnchanged,
  type CodexPluginSkillControl,
} from "./codex-plugin-skill-controls.js";
import { isCodexNativeSkillDisabled, type CodexNativeSkill } from "./codex-native-skill-catalog.js";

export const CODEX_SEMANTIC_CACHE_WITNESS_SCHEMA = "hasna.codex-semantic-cache-witness.v1" as const;

export interface CodexSemanticCacheControl {
  pluginId: string;
  namespace: string;
  pluginParent: string;
  remotePluginId?: string;
  receiptSha256?: string;
  manifestSha256: string;
  appSha256?: string;
  mcpSha256?: string;
}

export interface CodexSemanticCacheSkill {
  name: string;
  pluginId: string;
  namespace: string;
  pluginParent: string;
  disabledRules: string[];
}

/** Caller explicitly classifies a remote plugin parent whose only reviewed
 * capability is its app integration and whose cache contains no Skill docs. */
export interface CodexSemanticCacheAppOnlyParent {
  role: "app-only";
  pluginId: string;
  namespace: string;
  pluginParent: string;
  remotePluginId: string;
}

export interface CodexSemanticCacheAppOnlyParentWitness extends CodexSemanticCacheAppOnlyParent {
  receiptSha256: string;
  manifestSha256: string;
  appSha256: string;
  mcpSha256?: string;
}

export interface CodexSemanticCacheWitness {
  schema: typeof CODEX_SEMANTIC_CACHE_WITNESS_SCHEMA;
  cacheRoot: string;
  controls: CodexSemanticCacheControl[];
  appOnlyParents: CodexSemanticCacheAppOnlyParentWitness[];
  skills: CodexSemanticCacheSkill[];
  sha256: string;
}

export interface CaptureCodexSemanticCacheWitnessOptions {
  cacheRoot: string;
  controls: CodexPluginSkillControl[];
  /** Explicit package-reviewed parents; absence never infers this role. */
  appOnlyParents?: CodexSemanticCacheAppOnlyParent[];
  rules: unknown;
  /** Package-owned, bounded read used by the existing semantic control review. */
  read?: (path: string) => string;
}

const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const refuse = (): never => { throw new Error("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED: review Codex plugin cache identity and controls"); };
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;

function defaultRead(path: string): string {
  const before = lstatSync(path, { throwIfNoEntry: false, bigint: true });
  if (before === undefined) return refuse();
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_DOCUMENT_BYTES)) refuse();
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { return refuse(); }
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.size > BigInt(MAX_DOCUMENT_BYTES)) refuse();
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_DOCUMENT_BYTES) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_DOCUMENT_BYTES + 1 - total));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      if (total > MAX_DOCUMENT_BYTES) refuse();
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || BigInt(total) !== after.size) refuse();
    return Buffer.concat(chunks, total).toString("utf8");
  } finally { closeSync(fd); }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value).sort();
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => required.includes(key) || optional.includes(key));
}

function validPluginParent(cacheRoot: string, pluginParent: string, namespace: string, pluginId: string): boolean {
  if (!isAbsolute(pluginParent) || resolve(pluginParent) !== pluginParent) return false;
  const parts = relative(cacheRoot, pluginParent).split(sep);
  return parts.length === 2 && parts.every(identifier) && parts[1] === namespace
    && pluginId === `${namespace}@${parts[0]}`;
}

function assertWitnessShape(value: unknown): asserts value is CodexSemanticCacheWitness {
  if (!plainObject(value) || !exactKeys(value, ["schema", "cacheRoot", "controls", "appOnlyParents", "skills", "sha256"])
    || value.schema !== CODEX_SEMANTIC_CACHE_WITNESS_SCHEMA || typeof value.cacheRoot !== "string"
    || !isAbsolute(value.cacheRoot) || resolve(value.cacheRoot) !== value.cacheRoot || !digest(value.sha256)
    || !Array.isArray(value.controls) || value.controls.length === 0 || value.controls.length > 4096
    || !Array.isArray(value.appOnlyParents) || value.appOnlyParents.length > 4096
    || !Array.isArray(value.skills) || value.skills.length === 0 || value.skills.length > 4096) refuse();
  const witness = value as Record<string, unknown>;
  const controlParents = new Set<string>();
  for (const candidate of witness.controls as unknown[]) {
    if (!plainObject(candidate)) refuse();
    const row = candidate as Record<string, unknown>;
    if (!exactKeys(row, ["pluginId", "namespace", "pluginParent", "manifestSha256"], ["remotePluginId", "receiptSha256", "appSha256", "mcpSha256"])
      || !identifier(row.namespace) || typeof row.pluginId !== "string"
      || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(row.pluginId)
      || typeof row.pluginParent !== "string" || !validPluginParent(String(witness.cacheRoot), row.pluginParent, row.namespace, row.pluginId)
      || !digest(row.manifestSha256)
      || (row.appSha256 !== undefined && !digest(row.appSha256))
      || (row.mcpSha256 !== undefined && !digest(row.mcpSha256))
      || (row.receiptSha256 !== undefined && !digest(row.receiptSha256))
      || (row.remotePluginId !== undefined && (typeof row.remotePluginId !== "string" || !/^[A-Za-z0-9_~-]{1,1024}$/.test(row.remotePluginId)))
      || ((row.remotePluginId === undefined) !== (row.receiptSha256 === undefined))
      || controlParents.has(row.pluginParent)) refuse();
    controlParents.add(row.pluginParent as string);
  }
  const appOnlyParentPaths = new Set<string>();
  for (const candidate of witness.appOnlyParents as unknown[]) {
    if (!plainObject(candidate)) refuse();
    const row = candidate as Record<string, unknown>;
    if (!exactKeys(row, ["role", "pluginId", "namespace", "pluginParent", "remotePluginId", "receiptSha256", "manifestSha256", "appSha256"], ["mcpSha256"])
      || row.role !== "app-only" || !identifier(row.namespace) || typeof row.pluginId !== "string"
      || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(row.pluginId)
      || typeof row.pluginParent !== "string" || !validPluginParent(String(witness.cacheRoot), row.pluginParent, row.namespace, row.pluginId)
      || typeof row.remotePluginId !== "string" || !/^[A-Za-z0-9_~-]{1,1024}$/.test(row.remotePluginId)
      || !digest(row.receiptSha256) || !digest(row.manifestSha256) || !digest(row.appSha256)
      || (row.mcpSha256 !== undefined && !digest(row.mcpSha256))
      || appOnlyParentPaths.has(row.pluginParent) || controlParents.has(row.pluginParent)) refuse();
    appOnlyParentPaths.add(row.pluginParent as string);
  }
  const skillNames = new Set<string>();
  const qualifiedNames = new Set<string>();
  for (const candidate of witness.skills as unknown[]) {
    if (!plainObject(candidate)) refuse();
    const row = candidate as Record<string, unknown>;
    if (!exactKeys(row, ["name", "pluginId", "namespace", "pluginParent", "disabledRules"])
      || typeof row.name !== "string" || !row.name.startsWith(`${String(row.namespace)}:`)
      || !identifier(row.name.slice(String(row.namespace).length + 1)) || !identifier(row.namespace)
      || typeof row.pluginId !== "string" || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(row.pluginId)
      || typeof row.pluginParent !== "string" || !validPluginParent(String(witness.cacheRoot), row.pluginParent, String(row.namespace), row.pluginId)
      || !Array.isArray(row.disabledRules) || row.disabledRules.length !== 1
      || row.disabledRules.some((rule: unknown) => rule !== `name:${String(row.name)}=disabled`)
      || !controlParents.has(row.pluginParent)) refuse();
    const qualified = `${row.pluginId}\0${row.name}`;
    if (qualifiedNames.has(qualified) || skillNames.has(row.name as string)) refuse();
    qualifiedNames.add(qualified); skillNames.add(row.name as string);
  }
  const projection = { schema: witness.schema, cacheRoot: witness.cacheRoot, controls: witness.controls,
    appOnlyParents: witness.appOnlyParents, skills: witness.skills };
  if (hash(projection) !== witness.sha256) refuse();
}

function assertCanonicalDirectory(path: string): void {
  if (resolve(path) !== path || realpathSync(path) !== path) refuse();
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) refuse();
    if (dirname(cursor) === cursor) break;
  }
}

/** Recursively rejects aliases and special files, while intentionally ignoring
 * ordinary inert-file content. File names are bounded by the traversal count. */
interface TreeSnapshot {
  entries: number;
  members: string[];
  signature: string[];
  timestamps: Map<string, string>;
}

function walkSafeTree(path: string, state: TreeSnapshot, depth = 0, root = path): string[] {
  if (depth > 64 || ++state.entries > 16384) refuse();
  const names = readdirSync(path).sort();
  const files: string[] = [];
  for (const name of names) {
    if (!name || name === "." || name === ".." || name.includes(sep) || ++state.entries > 16384) refuse();
    const child = join(path, name), stat = lstatSync(child, { bigint: true });
    state.members.push(child);
    state.signature.push(`${relative(root, child)}\0${stat.mode}\0${stat.dev}\0${stat.ino}\0${stat.isDirectory() ? 0 : stat.size}`);
    state.timestamps.set(child, `${stat.mtimeNs}\0${stat.ctimeNs}`);
    if (stat.isSymbolicLink()) refuse();
    if (stat.isDirectory()) files.push(...walkSafeTree(child, state, depth + 1, root));
    else if (stat.isFile()) files.push(child);
    else refuse();
  }
  return files;
}

function treeSnapshot(cacheRoot: string): { files: string[]; state: TreeSnapshot } {
  const state: TreeSnapshot = { entries: 0, members: [], signature: [], timestamps: new Map() };
  const rootStat = lstatSync(cacheRoot, { throwIfNoEntry: false, bigint: true });
  if (rootStat === undefined) return refuse();
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(cacheRoot) !== cacheRoot) refuse();
  state.signature.push(`.\0${rootStat.mode}\0${rootStat.dev}\0${rootStat.ino}`);
  state.timestamps.set(cacheRoot, `${rootStat.mtimeNs}\0${rootStat.ctimeNs}`);
  const files = walkSafeTree(cacheRoot, state);
  return { files, state };
}

function assertSameTree(before: TreeSnapshot, after: TreeSnapshot, semanticPaths: string[]): void {
  if (canonical([...before.members].sort()) !== canonical([...after.members].sort())
    || canonical([...before.signature].sort()) !== canonical([...after.signature].sort())) refuse();
  for (const path of semanticPaths) if (before.timestamps.get(path) !== after.timestamps.get(path)) refuse();
}

function trackedBoundedRead(read: (path: string) => string): { read: (path: string) => string; verify: () => void; paths: () => string[] } {
  const observed = new Map<string, string>();
  const stableStat = (path: string, max: number) => {
    const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true });
    if (stat === undefined) return refuse();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(max) || realpathSync(path) !== path) refuse();
    return stat;
  };
  const guarded = (path: string): string => {
    const max = path.endsWith(".codex-remote-plugin-install.json") ? MAX_RECEIPT_BYTES : MAX_DOCUMENT_BYTES;
    const before = stableStat(path, max);
    const text = read(path);
    if (Buffer.byteLength(text, "utf8") > max) refuse();
    const after = stableStat(path, max);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) refuse();
    const sha = createHash("sha256").update(text).digest("hex");
    const prior = observed.get(path);
    if (prior !== undefined && prior !== sha) refuse();
    observed.set(path, sha);
    return text;
  };
  return {
    read: guarded,
    verify: () => {
      for (const [path, expected] of observed) {
        const max = path.endsWith(".codex-remote-plugin-install.json") ? MAX_RECEIPT_BYTES : MAX_DOCUMENT_BYTES;
        const before = stableStat(path, max);
        const text = read(path);
        const after = stableStat(path, max);
        if (Buffer.byteLength(text, "utf8") > max || createHash("sha256").update(text).digest("hex") !== expected
          || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
          || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) refuse();
      }
    },
    paths: () => [...observed.keys()],
  };
}

function controlProjection(controls: CodexPluginSkillControl[], read: (path: string) => string): CodexSemanticCacheControl[] {
  const byPlugin = new Map<string, CodexSemanticCacheControl>();
  for (const control of controls) {
    if (!control || !identifier(control.namespace) || typeof control.pluginId !== "string"
      || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(control.pluginId)
      || typeof control.pluginParent !== "string" || !control.name.startsWith(`${control.namespace}:`)
      || !identifier(control.name.slice(control.namespace.length + 1))) refuse();
    if (!digest(control.manifestSha256) || (control.appSha256 !== undefined && !digest(control.appSha256))
      || (control.mcpSha256 !== undefined && !digest(control.mcpSha256))
      || (control.remotePluginId !== undefined && (typeof control.remotePluginId !== "string" || !/^[A-Za-z0-9_~-]{1,1024}$/.test(control.remotePluginId)))) refuse();
    const key = `${control.pluginId}\0${control.pluginParent}`;
    const row: CodexSemanticCacheControl = {
      pluginId: control.pluginId,
      namespace: control.namespace,
      pluginParent: control.pluginParent,
      ...(control.remotePluginId === undefined ? {} : { remotePluginId: control.remotePluginId }),
      manifestSha256: control.manifestSha256,
      ...(control.appSha256 === undefined ? {} : { appSha256: control.appSha256 }),
      ...(control.mcpSha256 === undefined ? {} : { mcpSha256: control.mcpSha256 }),
    };
    if (row.remotePluginId !== undefined) {
      const receipt = join(row.pluginParent, ".codex-remote-plugin-install.json"), stat = lstatSync(receipt, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 16384) refuse();
      // The package-owned control reviewer validates the exact receipt schema
      // and identity. The witness additionally binds its bytes for readback.
      try {
        const receiptText = read(receipt), value = JSON.parse(receiptText);
        if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length !== 2
          || value.schema_version !== 1 || value.remote_plugin_id !== row.remotePluginId) refuse();
        row.receiptSha256 = createHash("sha256").update(receiptText).digest("hex");
      } catch { refuse(); }
    }
    const previous = byPlugin.get(key);
    if (previous && canonical(previous) !== canonical(row)) refuse();
    byPlugin.set(key, row);
  }
  if (!byPlugin.size || byPlugin.size > 4096) refuse();
  return [...byPlugin.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.pluginParent.localeCompare(b.pluginParent));
}

function appOnlyParentProjection(cacheRoot: string, parents: CodexSemanticCacheAppOnlyParent[], read: (path: string) => string): CodexSemanticCacheAppOnlyParentWitness[] {
  if (!Array.isArray(parents) || parents.length > 4096) refuse();
  const seen = new Set<string>(), rows: CodexSemanticCacheAppOnlyParentWitness[] = [];
  for (const parent of parents) {
    if (!parent || Object.keys(parent).sort().join(",") !== "namespace,pluginId,pluginParent,remotePluginId,role"
      || parent.role !== "app-only" || !identifier(parent.namespace)
      || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(parent.pluginId)
      || typeof parent.pluginParent !== "string" || typeof parent.remotePluginId !== "string"
      || !/^[A-Za-z0-9_~-]{1,1024}$/.test(parent.remotePluginId)) refuse();
    const parts = relative(cacheRoot, parent.pluginParent).split(sep);
    if (resolve(parent.pluginParent) !== parent.pluginParent || parts.length !== 2 || parts.some(part => !identifier(part))
      || parent.pluginId !== `${parent.namespace}@${parts[0]}` || parts[1] !== parent.namespace || seen.has(parent.pluginParent)) refuse();
    seen.add(parent.pluginParent);
    const parentStat = lstatSync(parent.pluginParent, { throwIfNoEntry: false });
    if (!parentStat?.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent.pluginParent) !== parent.pluginParent) refuse();
    const receipt = join(parent.pluginParent, ".codex-remote-plugin-install.json"), receiptStat = lstatSync(receipt, { throwIfNoEntry: false });
    if (!receiptStat?.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 16384) refuse();
    let receiptText = "";
    try {
      receiptText = read(receipt);
      hashNativeJsonControls(receiptText);
      const value = JSON.parse(receiptText);
      if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length !== 2
        || value.schema_version !== 1 || value.remote_plugin_id !== parent.remotePluginId) refuse();
    } catch { refuse(); }
    const versions = readdirSync(parent.pluginParent).filter(name => name !== ".codex-remote-plugin-install.json");
    if (!versions.length || versions.length > 4096) refuse();
    const materializations = versions.map(version => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version)) refuse();
      const root = join(parent.pluginParent, version), stat = lstatSync(root, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) refuse();
      const rootControls = readCodexPluginRootControls(root, read);
      if (rootControls.namespace !== parent.namespace || !digest(rootControls.manifestSha256) || !digest(rootControls.appSha256)
        || (rootControls.mcpSha256 !== undefined && !digest(rootControls.mcpSha256))) refuse();
      return { manifestSha256: rootControls.manifestSha256, appSha256: rootControls.appSha256!,
        ...(rootControls.mcpSha256 === undefined ? {} : { mcpSha256: rootControls.mcpSha256 }) };
    });
    const first = materializations[0]!;
    if (materializations.some(item => canonical(item) !== canonical(first))) refuse();
    rows.push({ ...parent, receiptSha256: createHash("sha256").update(receiptText).digest("hex"), ...first });
  }
  return rows.sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.pluginParent.localeCompare(b.pluginParent));
}

function assertParents(cacheRoot: string, controls: CodexSemanticCacheControl[], appOnlyParents: CodexSemanticCacheAppOnlyParentWitness[], files: string[], members: string[]): void {
  const expected = new Set<string>();
  const expectedMarkets = new Set<string>();
  for (const control of [...controls, ...appOnlyParents]) {
    const rel = relative(cacheRoot, control.pluginParent), parts = rel.split(sep);
    if (resolve(control.pluginParent) !== control.pluginParent || parts.length !== 2 || parts.some(part => !identifier(part))
      || control.pluginId !== `${control.namespace}@${parts[0]}` || parts[1] !== control.namespace) refuse();
    expected.add(control.pluginParent);
    expectedMarkets.add(parts[0]!);
  }

  const actual = new Set<string>();
  for (const file of files) {
    const rel = relative(cacheRoot, file), parts = rel.split(sep);
    if (parts.length < 3 || !identifier(parts[0]) || !identifier(parts[1])) refuse();
    actual.add(join(cacheRoot, parts[0]!, parts[1]!));
  }
  // Include empty parents and reject non-directory entries at both recognized
  // namespace levels; a file or new parent cannot disappear from this census.
  const actualMarkets = readdirSync(cacheRoot);
  if (actualMarkets.length !== expectedMarkets.size || actualMarkets.some(market => !expectedMarkets.has(market))) refuse();
  for (const market of actualMarkets) {
    const marketPath = join(cacheRoot, market), marketStat = lstatSync(marketPath);
    if (!identifier(market) || !marketStat.isDirectory() || marketStat.isSymbolicLink()) refuse();
    for (const plugin of readdirSync(marketPath)) {
      const parent = join(marketPath, plugin), stat = lstatSync(parent);
      if (!identifier(plugin) || !stat.isDirectory() || stat.isSymbolicLink()) refuse();
      actual.add(parent);
    }
  }
  if (actual.size !== expected.size || [...actual].some(parent => !expected.has(parent))) refuse();

  // Only the package's recognized direct plugin-root locations may carry
  // native capability files. A nested or orphaned control-looking file is not
  // silently reclassified as an inert asset.
  for (const member of members) {
    const parts = relative(cacheRoot, member).split(sep);
    if (parts.length < 3) continue;
    const parent = join(cacheRoot, parts[0]!, parts[1]!);
    const root = join(parent, parts[2]!);
    const base = parts[parts.length - 1]!;
    if (parts.includes(".codex-plugin") && (parts.length < 4 || parts[3] !== ".codex-plugin"
      || (parts.length === 4 ? base !== ".codex-plugin" : parts.length !== 5 || base !== "plugin.json"))) refuse();
    if ([".app.json", ".mcp.json"].includes(base) && (parts.length !== 4 || dirname(member) !== root)) refuse();
    if (parts.includes("hooks")) refuse();
  }
}

function assertSkillMaterializations(
  cacheRoot: string,
  controls: CodexPluginSkillControl[],
  files: string[],
  read: (path: string) => string,
): Map<string, Set<string>> {
  const expectedByRoot = new Map<string, Set<string>>();
  const byParent = new Map<string, CodexPluginSkillControl[]>();
  for (const control of controls) {
    const group = byParent.get(control.pluginParent) ?? [];
    group.push(control);
    byParent.set(control.pluginParent, group);
  }
  for (const [parent, rows] of byParent) {
    const first = rows[0]!;
    const expectedControls = {
      namespace: first.namespace,
      manifestSha256: first.manifestSha256,
      ...(first.appSha256 === undefined ? {} : { appSha256: first.appSha256 }),
      ...(first.mcpSha256 === undefined ? {} : { mcpSha256: first.mcpSha256 }),
    };
    if (rows.some(row => canonical({ namespace: row.namespace, manifestSha256: row.manifestSha256,
      ...(row.appSha256 === undefined ? {} : { appSha256: row.appSha256 }),
      ...(row.mcpSha256 === undefined ? {} : { mcpSha256: row.mcpSha256 }) }) !== canonical(expectedControls))) refuse();
    const expectedNames = new Set(rows.map(row => row.name));
    if (expectedNames.size !== rows.length) refuse();
    const entries = readdirSync(parent);
    let roots = 0;
    for (const entry of entries) {
      if (entry === ".codex-remote-plugin-install.json") continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(entry)) refuse();
      const root = join(parent, entry), stat = lstatSync(root, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) refuse();
      const actualControls = readCodexPluginRootControls(root, read);
      const actualProjection = {
        namespace: actualControls.namespace,
        manifestSha256: actualControls.manifestSha256,
        ...(actualControls.appSha256 === undefined ? {} : { appSha256: actualControls.appSha256 }),
        ...(actualControls.mcpSha256 === undefined ? {} : { mcpSha256: actualControls.mcpSha256 }),
      };
      if (canonical(actualProjection) !== canonical(expectedControls)) refuse();
      const key = `${first.pluginId}\0${root}`;
      expectedByRoot.set(key, expectedNames);
      roots++;
    }
    if (!roots) refuse();
  }
  // A document outside a direct materialization root is never admitted.
  for (const file of files) {
    if (!file.endsWith(`${sep}SKILL.md`)) continue;
    const rel = relative(cacheRoot, file).split(sep);
    if (rel.length < 4) refuse();
    const parent = join(cacheRoot, rel[0]!, rel[1]!);
    if (!byParent.has(parent) || !expectedByRoot.has(`${byParent.get(parent)![0]!.pluginId}\0${join(parent, rel[2]!)}`)) refuse();
  }
  return expectedByRoot;
}

function effectiveDisabledRules(skill: CodexNativeSkill, rules: unknown): string[] {
  if (!Array.isArray(rules)) refuse();
  const matching: string[] = [];
  for (const candidate of rules as unknown[]) {
    if (!plainObject(candidate) || typeof candidate.enabled !== "boolean") refuse();
    const rule = candidate as { name?: unknown; path?: unknown; enabled: boolean };
    const byName = typeof rule.name === "string" && rule.name.trim() === skill.name;
    let byPath = false;
    if (typeof rule.path === "string") {
      if (resolve(rule.path) !== rule.path) refuse();
      let canonicalPath: string;
      try { canonicalPath = realpathSync(rule.path); }
      catch { canonicalPath = resolve(rule.path); }
      if (canonicalPath === skill.path && rule.path !== canonicalPath) refuse();
      byPath = canonicalPath === skill.path;
    }
    if ((byName || byPath) && rule.enabled !== false) refuse();
    // Concrete cache-version path denies are checked for conflicts and native
    // effectiveness above, but not fingerprinted here. Stable qualified-name
    // denies are the semantic rule; the full TOML/config witness binds every
    // path row and its source ordering separately.
    if (byName) matching.push(`name:${skill.name}=disabled`);
  }
  if (!isCodexNativeSkillDisabled(skill, rules)) refuse();
  if (!matching.length) refuse();
  return [...new Set(matching)].sort();
}

/** Capture the current semantic identity without changing the stored baseline.
 * Existing package-owned parsers validate documents and capability controls. */
export function captureCodexSemanticCacheWitness(options: CaptureCodexSemanticCacheWitnessOptions): CodexSemanticCacheWitness {
  const tracked = trackedBoundedRead(options.read ?? defaultRead);
  const read = tracked.read;
  try {
    assertCanonicalDirectory(options.cacheRoot);
    const initialTree = treeSnapshot(options.cacheRoot);
    const controls = controlProjection(options.controls, read);
    const appOnlyParents = appOnlyParentProjection(options.cacheRoot, options.appOnlyParents ?? [], read);
    const skillParents = new Set(controls.map(control => control.pluginParent));
    if (appOnlyParents.some(parent => skillParents.has(parent.pluginParent))) refuse();
    if (!reviewedCodexPluginCapabilitiesUnchanged(options.cacheRoot, options.controls, read, options.rules)) refuse();
    const files = initialTree.files;
    assertParents(options.cacheRoot, controls, appOnlyParents, files, initialTree.state.members);
    const expectedNamesByRoot = assertSkillMaterializations(options.cacheRoot, options.controls, files, read);

    const docs = files.filter(path => path.endsWith(`${sep}SKILL.md`));
    const skillRows: CodexSemanticCacheSkill[] = [];
    const rootNames = new Map<string, Set<string>>();
    for (const document of docs) {
      const rel = relative(options.cacheRoot, document).split(sep);
      if (appOnlyParents.some(parent => parent.pluginParent === join(options.cacheRoot, rel[0]!, rel[1]!))) refuse();
      const documentStat = lstatSync(document, { throwIfNoEntry: false });
      if (!documentStat?.isFile() || documentStat.isSymbolicLink() || documentStat.size > MAX_DOCUMENT_BYTES) refuse();
      const identity = classifyCodexPluginCacheDocument(document, options.cacheRoot, read);
      if (identity === null) return refuse();
      const row: CodexSemanticCacheSkill = { name: identity.name, pluginId: identity.pluginId, namespace: identity.namespace,
        pluginParent: identity.pluginParent, disabledRules: effectiveDisabledRules({ name: identity.name, path: document, enabled: true, pluginId: identity.pluginId }, options.rules) };
      const root = identity.root;
      const rootKey = `${row.pluginId}\0${root}`;
      const names = rootNames.get(rootKey) ?? new Set<string>();
      if (names.has(row.name)) refuse();
      names.add(row.name); rootNames.set(rootKey, names);
      skillRows.push(row);
    }
    if (!skillRows.length || skillRows.length > 4096) refuse();
    const uniqueNames = new Set(skillRows.map(row => `${row.pluginId}\0${row.name}`));
    const reviewedNames = new Set(options.controls.map(control => `${control.pluginId}\0${control.name}`));
    if (reviewedNames.size !== options.controls.length || new Set(options.controls.map(control => control.name)).size !== options.controls.length) refuse();
    if (uniqueNames.size !== reviewedNames.size || [...uniqueNames].some(name => !reviewedNames.has(name))) refuse();
    if (new Set(skillRows.map(row => row.name)).size !== reviewedNames.size) refuse();
    // Every equivalent materialization of one plugin must expose the same
    // qualified names. Version directories and inert asset bytes are ignored.
    const byPlugin = new Map<string, Set<string>>();
    for (const row of skillRows) {
      const names = byPlugin.get(row.pluginId) ?? new Set<string>(); names.add(row.name); byPlugin.set(row.pluginId, names);
    }
    for (const [key, expected] of expectedNamesByRoot) {
      const names = rootNames.get(key);
      if (!names || names.size !== expected.size || [...expected].some(name => !names.has(name))) refuse();
    }
    if (rootNames.size !== expectedNamesByRoot.size) refuse();
    for (const [key, names] of rootNames) {
      const pluginId = key.slice(0, key.indexOf("\0")), expected = byPlugin.get(pluginId);
      if (!expected || names.size !== expected.size || [...expected].some(name => !names.has(name))) refuse();
    }
    const skillsByName = new Map<string, CodexSemanticCacheSkill>();
    for (const row of skillRows) {
      const key = `${row.pluginId}\0${row.name}`, prior = skillsByName.get(key);
      if (prior && canonical(prior.disabledRules) !== canonical(row.disabledRules)) refuse();
      if (!prior) skillsByName.set(key, row);
    }
    const uniqueSkills = [...skillsByName.values()];
    uniqueSkills.sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.name.localeCompare(b.name));
    tracked.verify();
    const finalTree = treeSnapshot(options.cacheRoot);
    assertSameTree(initialTree.state, finalTree.state, tracked.paths());
    const completeProjection = { schema: CODEX_SEMANTIC_CACHE_WITNESS_SCHEMA, cacheRoot: options.cacheRoot, controls, appOnlyParents, skills: uniqueSkills } as const;
    return { ...completeProjection, sha256: hash(completeProjection) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED")) throw error;
    return refuse();
  }
}

/** Verify without mutating or replacing the saved witness. Version refreshes
 * pass only when their complete semantic projection and qualified names match. */
export function assertCodexSemanticCacheWitnessUnchanged(
  previous: CodexSemanticCacheWitness,
  current: CodexSemanticCacheWitness,
): void {
  assertWitnessShape(previous);
  assertWitnessShape(current);
  const priorProjection = { schema: previous.schema, cacheRoot: previous.cacheRoot, controls: previous.controls,
    appOnlyParents: previous.appOnlyParents, skills: previous.skills };
  const currentProjection = { schema: current.schema, cacheRoot: current.cacheRoot, controls: current.controls,
    appOnlyParents: current.appOnlyParents, skills: current.skills };
  if (hash(priorProjection) !== previous.sha256 || hash(currentProjection) !== current.sha256
    || canonical(priorProjection) !== canonical(currentProjection)) refuse();
}
