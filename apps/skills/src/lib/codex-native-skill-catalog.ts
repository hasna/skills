import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { connectCodexHookRpc, type CodexHookRpc } from "./codex-hook-rpc.js";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";

export interface CodexNativeSkill {
  /** Native qualified name, not a directory name or plugin identifier. */
  name: string;
  path: string;
  enabled: boolean;
  pluginId: string | null;
}

export interface CodexNativeSkillCatalog {
  version: string;
  cwd: string;
  skills: CodexNativeSkill[];
  /** Added in 0.10.20; older reviewed skills/list receipts remain valid for listed skills. */
  plugins?: CodexInstalledPlugin[];
  /** Remote install receipts read before the capture started any Codex process. */
  remoteReceipts?: CodexRemoteReceiptSnapshot;
}

/** Schema of the remote install receipt snapshot embedded in a captured catalog. */
export const CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA = "hasna.skills-codex-remote-receipts.v1" as const;
/** One plugin cache parent's native remote install receipt as it was on disk
 * before Codex started. `remotePluginId` is null when the receipt is not a
 * strictly valid schema-1 receipt; `sha256` is null when it is not a regular,
 * unlinked file of at most 16 KiB. */
export type CodexRemoteReceiptObservation =
  | { pluginId: string; receipt: "absent" }
  | { pluginId: string; receipt: "present"; sha256: string | null; remotePluginId: string | null; mtimeMs: number };
export interface CodexRemoteReceiptSnapshot { schema: typeof CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA; cacheRoot: string; plugins: CodexRemoteReceiptObservation[] }

/** Safe installed-plugin identity needed when Codex hides a path-disabled skill. */
export interface CodexInstalledPlugin {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  localVersion: string | null;
  /** Native remote identity; never a guessed installed cache version. */
  remotePluginId?: string;
  sourceType?: "remote" | "local" | "git" | "npm";
  /** Fingerprint of the complete native nonremote source declaration. */
  sourceSha256?: string;
  /** Declared local installation input, distinct from the loaded cache root. */
  sourcePath?: string;
}

/** The one remote rule for every receipt decision (install review, reconcile
 * and the inactive rule): Codex reports a remote source, or reports any remote
 * identity. A projected row can keep its remotePluginId while a missing or
 * unrecognized source projects to no sourceType, so the id alone counts. */
export function codexPluginIsRemote(plugin: Pick<CodexInstalledPlugin,"sourceType"|"remotePluginId"> | undefined): boolean {
  return plugin !== undefined && (plugin.sourceType === "remote" || plugin.remotePluginId !== undefined);
}

/** Codex 0.160 derives remote installed keys from these native scope realms.
 * A nonremote declaration in one of them cannot prove config-owned enablement:
 * remote reconciliation may replace enabled even while config stays disabled. */
export function codexPluginSourceIsConfigControlled(plugin: Pick<CodexInstalledPlugin,"id"|"sourceType"|"sourceSha256"|"remotePluginId">): boolean {
  const remoteRealms=["openai-curated-remote","created-by-me-remote","workspace-directory","workspace-shared-with-me","workspace-shared-with-me-private","workspace-shared-with-me-unlisted"];
  return Boolean(plugin.sourceType && ["local","git","npm"].includes(plugin.sourceType)
    && plugin.sourceSha256 && /^[a-f0-9]{64}$/.test(plugin.sourceSha256) && !codexPluginIsRemote(plugin)
    && !remoteRealms.includes(plugin.id.slice(plugin.id.lastIndexOf("@")+1)));
}

const MAX_SKILLS = 4096;
const MAX_NAME_BYTES = 1024;
const MAX_PATH_BYTES = 16384;
const MAX_PLUGIN_ID_BYTES = 1024;
function refuse(): never { throw new Error("CODEX_NATIVE_SKILL_CATALOG_INVALID"); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown, max: number): value is string => typeof value === "string"
  && value.length > 0 && value.trim() === value && Buffer.byteLength(value, "utf8") <= max
  && !/[\u0000-\u001f\u007f]/u.test(value);
export const remotePluginIdentifier = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9_~-]{1,1024}$/.test(value);
const absolutePath = (value: unknown): value is string => scalar(value, MAX_PATH_BYTES) && isAbsolute(value);

/** Keep positive source provenance without retaining URLs or other opaque text.
 * Missing/unknown source metadata never implies local configuration control. */
function projectPluginSource(source: unknown): Pick<CodexInstalledPlugin,"sourceType"|"sourceSha256"|"sourcePath"> {
  if (!object(source)) return {};
  if (source.type === "remote") return { sourceType: "remote" };
  const optionalText = (value: unknown) => value === undefined || value === null || scalar(value,MAX_PATH_BYTES);
  const valid = source.type === "local" ? Object.keys(source).every(key=>["type","path"].includes(key)) && absolutePath(source.path)
    : source.type === "git" ? Object.keys(source).every(key=>["type","url","path","refName","sha"].includes(key)) && scalar(source.url,MAX_PATH_BYTES) && [source.path,source.refName,source.sha].every(optionalText)
    : source.type === "npm" ? Object.keys(source).every(key=>["type","package","version","registry"].includes(key)) && scalar(source.package,MAX_NAME_BYTES) && [source.version,source.registry].every(optionalText)
    : false;
  return valid ? { sourceType: source.type as "local"|"git"|"npm", sourceSha256: hashNativeJsonControls(JSON.stringify(source)), ...(source.type==="local" ? {sourcePath:source.path as string} : {}) } : {};
}

/** Project the measured native skills/list contract without retaining descriptions,
 * links, interfaces, errors, or any other untrusted native text. */
export function projectCodexNativeSkillCatalog(response: unknown, cwd: string): CodexNativeSkill[] {
  if (!absolutePath(cwd) || !object(response) || !Array.isArray(response.data) || response.data.length !== 1) refuse();
  const entry = response.data[0];
  if (!object(entry) || entry.cwd !== cwd || !Array.isArray(entry.errors) || entry.errors.length !== 0
    || !Array.isArray(entry.skills) || entry.skills.length > MAX_SKILLS) refuse();
  const paths = new Set<string>();
  return entry.skills.map((value: unknown) => {
    if (!object(value) || !scalar(value.name, MAX_NAME_BYTES) || !absolutePath(value.path)
      || typeof value.enabled !== "boolean"
      || (value.pluginId !== undefined && value.pluginId !== null && !scalar(value.pluginId, MAX_NAME_BYTES))) refuse();
    if (paths.has(value.path)) refuse();
    paths.add(value.path);
    return { name: value.name, path: value.path, enabled: value.enabled, pluginId: value.pluginId ?? null };
  });
}

/** Project only the installed plugin identity needed to bind cache inventory.
 * Marketplace errors fail closed because an incomplete inventory cannot prove
 * that an absent skill belongs to the one measured installed plugin. */
export function projectCodexInstalledPlugins(response: unknown): CodexInstalledPlugin[] {
  if (!object(response) || !Array.isArray(response.marketplaces) || !Array.isArray(response.marketplaceLoadErrors)
    || response.marketplaceLoadErrors.length !== 0 || response.marketplaces.length > MAX_SKILLS) refuse();
  const plugins: unknown[] = [];
  for (const marketplace of response.marketplaces) {
    if (!object(marketplace) || !scalar(marketplace.name, MAX_NAME_BYTES) || !Array.isArray(marketplace.plugins)
      || marketplace.plugins.length > MAX_SKILLS) refuse();
    for (const value of marketplace.plugins) {
      if (!object(value) || !scalar(value.id, MAX_PLUGIN_ID_BYTES) || !scalar(value.name, MAX_NAME_BYTES)
        || value.id !== `${value.name}@${marketplace.name}`) refuse();
      plugins.push({ ...value, marketplace: marketplace.name, sourceType: undefined, sourceSha256: undefined, sourcePath: undefined,
        ...projectPluginSource(value.source) });
    }
  }
  return projectCodexInstalledPluginEntries(plugins);
}

/** Validate the bounded stored projection when it is consumed by a review. */
export function projectCodexInstalledPluginEntries(value: unknown): CodexInstalledPlugin[] {
  if (!Array.isArray(value) || value.length > MAX_SKILLS) refuse();
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!object(item) || !scalar(item.id, MAX_PLUGIN_ID_BYTES) || !scalar(item.name, MAX_NAME_BYTES)
      || typeof item.installed !== "boolean" || typeof item.enabled !== "boolean"
      || (item.localVersion !== null && !scalar(item.localVersion, MAX_NAME_BYTES))
      || (item.remotePluginId !== undefined && item.remotePluginId !== null && !remotePluginIdentifier(item.remotePluginId))
      || (item.sourceType !== undefined && !["remote","local","git","npm"].includes(item.sourceType as string))
      || (["local","git","npm"].includes(item.sourceType as string) ? typeof item.sourceSha256!=="string" || !/^[a-f0-9]{64}$/.test(item.sourceSha256) : item.sourceSha256!==undefined)
      || (item.sourceType==="local" ? !absolutePath(item.sourcePath) || normalize(item.sourcePath)!==item.sourcePath
        || item.sourceSha256!==hashNativeJsonControls(JSON.stringify({type:"local",path:item.sourcePath})) : item.sourcePath!==undefined)) refuse();
    const at = item.id.lastIndexOf("@");
    if (at < 1 || item.id.slice(0, at) !== item.name || at === item.id.length - 1 || ids.has(item.id)) refuse();
    ids.add(item.id);
    return { id: item.id, name: item.name, installed: item.installed, enabled: item.enabled, localVersion: item.localVersion ?? null,
      ...(item.sourceType === undefined ? {} : { sourceType: item.sourceType as CodexInstalledPlugin["sourceType"] }),
      ...(item.sourceSha256 === undefined ? {} : { sourceSha256: item.sourceSha256 as string }),
      ...(item.sourcePath === undefined ? {} : { sourcePath: item.sourcePath as string }),
      ...(item.remotePluginId == null ? {} : { remotePluginId: item.remotePluginId }) };
  });
}

const PLUGIN_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
/** Read every plugin cache parent's native remote install receipt. Call it
 * before any Codex process starts: starting the app-server rewrites each remote
 * plugin's receipt to its own state, so a later read observes healed bytes and
 * cannot show a receipt that was missing or stale. Never follows an alias. */
export function captureCodexRemoteReceiptSnapshot(cache: string): CodexRemoteReceiptSnapshot {
  const cacheRoot = canonicalCacheRoot(cache), plugins: CodexRemoteReceiptObservation[] = [];
  const directories = (path: string): string[] => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
    return readdirSync(path).filter(name => PLUGIN_SEGMENT.test(name) && lstatSync(join(path, name)).isDirectory()).sort();
  };
  for (const market of directories(cacheRoot)) for (const name of directories(join(cacheRoot, market))) {
    if (plugins.length >= MAX_SKILLS) refuse();
    const pluginId = `${name}@${market}`, path = join(cacheRoot, market, name, ".codex-remote-plugin-install.json");
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) { plugins.push({ pluginId, receipt: "absent" }); continue; }
    let sha256: string | null = null, remotePluginId: string | null = null;
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16384) {
      try {
        const bytes = readFileSync(path);
        sha256 = createHash("sha256").update(bytes).digest("hex");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        hashNativeJsonControls(text); // Reject duplicate decoded keys as Codex serde does.
        const value = JSON.parse(text);
        if (object(value) && Object.keys(value).length === 2 && value.schema_version === 1 && remotePluginIdentifier(value.remote_plugin_id)) remotePluginId = value.remote_plugin_id;
      } catch { /* present, unreadable or invalid: no identity */ }
    }
    plugins.push({ pluginId, receipt: "present", sha256, remotePluginId, mtimeMs: stat.mtimeMs });
  }
  return { schema: CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA, cacheRoot, plugins };
}

/** The plugin cache identity a snapshot is bound to: the real path of its
 * deepest existing ancestor plus the rest, so an absent cache still compares. */
export function canonicalCacheRoot(cache: string): string {
  const rest: string[] = [];
  for (let cursor = normalize(cache); ; cursor = dirname(cursor)) {
    try { return join(realpathSync(cursor), ...rest.reverse()); } catch { /* not present yet */ }
    if (dirname(cursor) === cursor) return normalize(cache);
    rest.push(basename(cursor));
  }
}

/** Validate an embedded snapshot when a review consumes it; null when invalid. */
export function projectCodexRemoteReceiptSnapshot(value: unknown): CodexRemoteReceiptSnapshot | null {
  const keys = (item: Record<string, unknown>, names: string[]) => Object.keys(item).length === names.length && names.every(name => Object.hasOwn(item, name));
  if (!object(value) || !keys(value, ["schema", "cacheRoot", "plugins"]) || value.schema !== CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA
    || !absolutePath(value.cacheRoot) || !Array.isArray(value.plugins) || value.plugins.length > MAX_SKILLS) return null;
  const ids = new Set<string>();
  for (const item of value.plugins as unknown[]) {
    if (!object(item) || typeof item.pluginId !== "string" || !/^[A-Za-z0-9_-]{1,64}@[A-Za-z0-9_-]{1,64}$/.test(item.pluginId) || ids.has(item.pluginId)) return null;
    ids.add(item.pluginId);
    if (item.receipt === "absent" ? !keys(item, ["pluginId", "receipt"])
      : item.receipt !== "present" || !keys(item, ["pluginId", "receipt", "sha256", "remotePluginId", "mtimeMs"])
        || (item.sha256 !== null && (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)))
        || (item.remotePluginId !== null && !remotePluginIdentifier(item.remotePluginId))
        || typeof item.mtimeMs !== "number" || !Number.isFinite(item.mtimeMs)) return null;
  }
  return value as unknown as CodexRemoteReceiptSnapshot;
}

/** Read one consumer's catalog through an owned, bounded native client. The RPC
 * transport owns request deadlines and child shutdown. Native discovery can
 * maintain its own caches; callers must constrain writes when requiring isolation. */
export async function captureCodexNativeSkillCatalog(
  options: { command: string; home: string; codexHome?: string; cwd: string; timeoutMs?: number },
  connect: (options: { command: string; home: string; codexHome?: string; timeoutMs?: number }) => Promise<CodexHookRpc> = connectCodexHookRpc,
): Promise<CodexNativeSkillCatalog> {
  if (!absolutePath(options.cwd) || !absolutePath(options.home)) refuse();
  // Before the native client starts: its app-server heals remote receipts.
  const remoteReceipts = captureCodexRemoteReceiptSnapshot(join(options.codexHome ?? join(options.home, ".codex"), "plugins", "cache"));
  const rpc = await connect({ command: options.command, home: options.home,
    ...(options.codexHome === undefined ? {} : { codexHome: options.codexHome }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  try {
    if (!supportsCodexNativeCapability(rpc.version, "qualified-skill-catalog")) throw new Error("CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION");
    const response: unknown = await rpc.request("skills/list", { cwds: [options.cwd], forceReload: true });
    const installed: unknown = await rpc.request("plugin/installed", { cwds: [options.cwd] });
    return { version: rpc.version, cwd: options.cwd, skills: projectCodexNativeSkillCatalog(response, options.cwd),
      plugins: projectCodexInstalledPlugins(installed), remoteReceipts };
  } finally {
    await rpc.close();
  }
}

function canonicalPath(path: string): string {
  try { return realpathSync(path); } catch { return normalize(path); }
}

/** Evaluate already-selected user/session rules in native order. This is a rule
 * projection, not proof that an existing live consumer adopted the rules. Names
 * use exact equality; paths use native canonicalization with lexical fallback.
 * Unknown fields remain the caller's property and are not rewritten here. */
export function isCodexNativeSkillDisabled(skill: CodexNativeSkill, rules: unknown): boolean {
  if (!scalar(skill.name, MAX_NAME_BYTES) || !absolutePath(skill.path)) refuse();
  if (rules === undefined) return false;
  if (!Array.isArray(rules) || rules.length > MAX_SKILLS) refuse();
  let disabled = false;
  for (const rule of rules) {
    if (!object(rule) || typeof rule.enabled !== "boolean") refuse();
    const hasName = rule.name !== undefined && rule.name !== null;
    const hasPath = rule.path !== undefined && rule.path !== null;
    if (hasName === hasPath) refuse();
    let matches: boolean;
    if (hasName) {
      if (typeof rule.name !== "string" || !scalar(rule.name.trim(), MAX_NAME_BYTES)) refuse();
      matches = rule.name.trim() === skill.name;
    } else {
      if (!absolutePath(rule.path)) refuse();
      matches = canonicalPath(rule.path) === canonicalPath(skill.path);
    }
    if (matches) disabled = !rule.enabled;
  }
  return disabled;
}
