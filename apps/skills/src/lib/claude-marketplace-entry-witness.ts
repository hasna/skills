/** Explicit reviewed witness for ONE plugin entry of a Claude marketplace.json.
 *
 * A whole-file byte witness of a vendor marketplace drifts on every refresh that
 * Claude performs by itself, even when the reviewed plugin is unchanged. This
 * mode binds only what decides how Claude resolves and loads the selected entry:
 * the marketplace fields that affect resolution and the entry's identity and
 * injection fields. Non-injecting entry metadata is validated and omitted.
 * Every unknown entry, top-level or `metadata` key refuses: a new field may be a
 * new injection or resolution input, so it is never ignored. The refusal names
 * this mode, the bound marketplace and the exact key path, never a value, and
 * the only way forward is a fresh human review and an exact re-pin through
 * `skills hook install --discovery-inputs`; there is no ignore list. A missing or
 * duplicate entry, a redirected plugin id, a parse failure or a binding mismatch
 * refuses. Version and install-path changes stay covered by the separate
 * installed_plugins.json witness; this mode never replaces that witness.
 *
 * Schema source: https://code.claude.com/docs/en/plugins/marketplace-reference
 * (top-level fields, plugin entries, strict mode, plugin sources) and
 * https://code.claude.com/docs/en/plugins/manifest-reference (every plugin.json
 * field an entry accepts), both read on 2026-10-07.
 */
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parseNativeJsonObject, readNativeSettingsWitnessFile, type ClaudeSettingsWitnessBudget, type NativeJsonObject, type NativeJsonValue } from "./claude-settings-witness.js";

export const CLAUDE_MARKETPLACE_ENTRY_HASH_MODE = "claude-marketplace-entry-v1" as const;
const DOMAIN = "hasna.skills.claude-marketplace-entry.v1\0";
const PATH_CHARACTERS = 4096;
// Plugin ids are `<entry-name>@<marketplace-name>`: letters, digits, ".", "_"
// and "-", starting with a letter or digit (marketplace reference, top-level
// `name` and entry `name`). 128 characters is Claude Desktop's documented bound.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ClaudeMarketplaceEntrySelector { marketplace: string; plugin: string }
export interface ClaudeMarketplaceEntryWitness { path: string; hashMode: typeof CLAUDE_MARKETPLACE_ENTRY_HASH_MODE; marketplace: string; plugin: string; sha256: string }

function need(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Claude marketplace entry witness ${reason}`);
}
// Key names come from the catalog: refusal text bounds each one to 64
// characters, JSON-quotes it and escapes everything outside printable ASCII, so
// a hostile key cannot carry control or bidirectional characters into a
// terminal or log. Values are never echoed.
const bounded = (key: string) => key.length > 64 ? `${key.slice(0, 64)}...` : key;
const quote = (text: string) => JSON.stringify(text).replace(/[^\x20-\x7e]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
// A plain key extends the path with ".key"; any other key becomes ["key"], so
// a dot or bracket inside a key name cannot read as a deeper path.
const child = (path: string, key: string) => path + (/^[A-Za-z0-9_$-]{1,64}$/.test(key) ? `.${key}` : `[${JSON.stringify(bounded(key))}]`);
function unknownKey(selector: ClaudeMarketplaceEntrySelector, path: string | null, key: string): never {
  // `selector.marketplace` and `selector.plugin` already match NAME.
  throw new Error(path === null
    ? `${CLAUDE_MARKETPLACE_ENTRY_HASH_MODE}: unknown top-level key ${quote(bounded(key))} in ${selector.marketplace}`
    : `${CLAUDE_MARKETPLACE_ENTRY_HASH_MODE}: unknown key ${quote(child(path, key))} in ${selector.marketplace}`);
}
function knownKeys(object: NativeJsonObject, allowed: { has(key: string): boolean }, selector: ClaudeMarketplaceEntrySelector, path: string | null): void {
  for (const [key] of object.entries) if (!allowed.has(key)) unknownKey(selector, path, key);
}
// The shared reader and parser name the settings witness; keep only the reason.
const reason = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Claude settings witness /, "");

// Top-level marketplace.json keys documented on 2026-10-07. Only `name`,
// `metadata.pluginRoot`, `renames` (for the selected name) and
// `allowCrossMarketplaceDependenciesOn` affect how the selected entry resolves;
// the rest are validated and omitted.
const MARKETPLACE_KEYS = new Set(["$schema", "name", "owner", "plugins", "description", "version", "metadata", "forceRemoveDeletedPlugins", "allowCrossMarketplaceDependenciesOn", "renames"]);
const MARKETPLACE_METADATA_KEYS = new Set(["description", "version", "pluginRoot"]);
// Entry keys bound in the digest: identity and source, load controls, every
// component field a plugin.json can declare (an entry is the manifest when the
// fetched plugin has none, which is the strict:false swift-lsp case), and the
// fields that run commands or select other plugins. `themes` and `monitors` are
// the legacy top-level spellings that still load.
const ENTRY_BOUND_KEYS = new Set([
  "name", "source", "strict", "defaultEnabled", "dependencies", "relevance", "headers", "headersHelper",
  "settings", "userConfig", "types", "channels",
  "skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "experimental", "themes", "monitors",
]);
// Display and catalog metadata that loads nothing. Mirrors the omissions of
// claude-plugin-manifest-v1 plus the entry-only catalog fields.
const ENTRY_OMITTED_KEYS = new Set(["$schema", "description", "version", "author", "homepage", "repository", "license", "keywords", "category", "tags", "displayName", "metadata"]);
const EXPERIMENTAL_KEYS = new Set(["themes", "monitors", "evals"]);
// Plugin source objects by type. `url` sources with `path` appear in the
// official marketplace although the reference lists only url/ref/sha; the value
// stays fully bound either way.
const SOURCE_KEYS: Record<string, readonly string[]> = Object.freeze({
  github: ["source", "repo", "ref", "sha"],
  url: ["source", "url", "ref", "sha", "path"],
  "git-subdir": ["source", "url", "path", "ref", "sha"],
  npm: ["source", "package", "version", "registry"],
  archive: ["source", "url", "sha256"],
  command: ["source", "command", "timeout", "mode"],
});

const field = (object: NativeJsonObject, key: string): NativeJsonValue | undefined => object.entries.find(([name]) => name === key)?.[1];
const isString = (value: NativeJsonValue | undefined): value is Extract<NativeJsonValue, { kind: "string" }> => value?.kind === "string";
const isBoolean = (value: NativeJsonValue | undefined) => value?.kind === "literal" && (value.value === "true" || value.value === "false");
const stringArray = (value: NativeJsonValue | undefined) => value?.kind === "array" && value.items.every(isString);
const stringObject = (value: NativeJsonValue | undefined) => value?.kind === "object" && value.entries.every(([, item]) => isString(item));

/** Selector and path checks shared by capture, discovery binding and the stored policy bounds. */
export function claudeMarketplaceEntrySourceValid(source: { path?: unknown; marketplace?: unknown; plugin?: unknown }): boolean {
  const path = source?.path;
  return typeof path === "string" && path.length > 0 && path.length <= PATH_CHARACTERS && !/[\x00-\x1f\x7f]/.test(path)
    && isAbsolute(path) && resolve(path) === path && basename(path) === "marketplace.json" && basename(dirname(path)) === ".claude-plugin"
    && typeof source.marketplace === "string" && NAME.test(source.marketplace) && !source.marketplace.includes("..")
    && typeof source.plugin === "string" && NAME.test(source.plugin);
}

function canonical(value: NativeJsonValue): string {
  if (value.kind === "string") return JSON.stringify(value.value);
  if (value.kind === "number" || value.kind === "literal") return value.value;
  if (value.kind === "array") return "[" + value.items.map(canonical).join(",") + "]";
  // Sorted keys: no Claude consumer gives JSON object key order a meaning here
  // (duplicate keys already refuse). Array order and number spelling stay bound.
  // This deliberately differs from claude-plugin-manifest-v1, which keeps key
  // order; the domain prefix keeps the two digests apart.
  return "{" + [...value.entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
}

function validateMarketplace(root: NativeJsonObject, selector: ClaudeMarketplaceEntrySelector): void {
  knownKeys(root, MARKETPLACE_KEYS, selector, null);
  const name = field(root, "name");
  need(isString(name) && name.value === selector.marketplace, "marketplace name does not match the reviewed binding");
  for (const key of ["$schema", "description", "version"]) { const value = field(root, key); need(value === undefined || isString(value), `has an invalid marketplace ${key}`); }
  const owner = field(root, "owner");
  need(owner === undefined || owner.kind === "object", "has an invalid marketplace owner");
  const metadata = field(root, "metadata");
  if (metadata !== undefined) {
    need(metadata.kind === "object", "has an invalid marketplace metadata object");
    knownKeys(metadata, MARKETPLACE_METADATA_KEYS, selector, "metadata");
    for (const [key, value] of metadata.entries) need(isString(value), `has an invalid marketplace metadata.${key}`);
  }
  const remove = field(root, "forceRemoveDeletedPlugins");
  need(remove === undefined || isBoolean(remove), "has an invalid forceRemoveDeletedPlugins value");
  const cross = field(root, "allowCrossMarketplaceDependenciesOn");
  need(cross === undefined || stringArray(cross), "has an invalid allowCrossMarketplaceDependenciesOn value");
  const renames = field(root, "renames");
  if (renames !== undefined) {
    need(renames.kind === "object" && renames.entries.every(([, target]) => isString(target) || target.kind === "literal" && target.value === "null"), "has an invalid renames map");
    // Claude follows a rename chain from an old name to the current entry. When
    // the selected id is itself renamed, Claude loads another entry (or none),
    // so this witness would describe an entry that is not the one that loads.
    need(!renames.entries.some(([from]) => from.toLowerCase() === selector.plugin.toLowerCase()), "plugin id is redirected by the marketplace renames map");
  }
}

function validateSource(source: NativeJsonValue | undefined, selector: ClaudeMarketplaceEntrySelector, path: string): void {
  if (isString(source)) { need(source.value.length > 0, "has an empty plugin source"); return; }
  need(source?.kind === "object", "has an invalid plugin source");
  const type = field(source, "source");
  need(isString(type) && Object.hasOwn(SOURCE_KEYS, type.value), "has an unreviewed plugin source type");
  knownKeys(source, new Set(SOURCE_KEYS[type.value]), selector, path);
}

function projectEntry(entry: NativeJsonObject, selector: ClaudeMarketplaceEntrySelector): NativeJsonObject {
  const path = `plugins[${selector.plugin}]`;
  knownKeys(entry, { has: key => ENTRY_BOUND_KEYS.has(key) || ENTRY_OMITTED_KEYS.has(key) }, selector, path);
  const name = field(entry, "name");
  need(isString(name) && name.value === selector.plugin, "selected entry name does not match");
  validateSource(field(entry, "source"), selector, `${path}.source`);
  for (const key of ["strict", "defaultEnabled"]) { const value = field(entry, key); need(value === undefined || isBoolean(value), `has an invalid entry ${key}`); }
  const headersHelper = field(entry, "headersHelper");
  need(headersHelper === undefined || isString(headersHelper), "has an invalid entry headersHelper");
  const experimental = field(entry, "experimental");
  if (experimental !== undefined) {
    need(experimental.kind === "object", "has an invalid entry experimental object");
    knownKeys(experimental, EXPERIMENTAL_KEYS, selector, `${path}.experimental`);
  }
  // Omitted metadata keeps documented types, so a malformed entry cannot hide
  // in a field this witness does not hash.
  for (const key of ["$schema", "description", "version", "homepage", "license", "category", "displayName"]) {
    const value = field(entry, key);
    need(value === undefined || isString(value), `has an invalid entry ${key}`);
  }
  for (const [key, keys] of [["author", new Set(["name", "email", "url"])], ["repository", new Set(["type", "url", "directory"])]] as const) {
    const value = field(entry, key);
    if (value?.kind === "object") knownKeys(value, keys, selector, `${path}.${key}`);
    need(value === undefined || isString(value) || stringObject(value), `has an invalid entry ${key}`);
  }
  for (const key of ["keywords", "tags"]) { const value = field(entry, key); need(value === undefined || stringArray(value), `has an invalid entry ${key}`); }
  const metadata = field(entry, "metadata");
  need(metadata === undefined || metadata.kind === "object", "has an invalid entry metadata object");
  return { kind: "object", entries: entry.entries.filter(([key]) => ENTRY_BOUND_KEYS.has(key)) };
}

/** Digest the reviewed entry from marketplace.json text. Refuses rather than
 * guessing whenever the selected entry or its resolution context is ambiguous. */
export function hashClaudeMarketplaceEntry(text: string, selector: ClaudeMarketplaceEntrySelector): string {
  need(selector && typeof selector.marketplace === "string" && NAME.test(selector.marketplace) && !selector.marketplace.includes("..")
    && typeof selector.plugin === "string" && NAME.test(selector.plugin), "requires an exact marketplace and plugin name");
  let root: NativeJsonObject;
  try { root = parseNativeJsonObject(text); }
  catch (error) { throw new Error(`Claude marketplace entry witness cannot parse marketplace.json: ${reason(error)}`); }
  validateMarketplace(root, selector);
  const plugins = field(root, "plugins");
  need(plugins?.kind === "array", "requires a plugins array");
  // Claude validates entries one by one; an unrelated malformed entry cannot be
  // selected by this name and is not part of this witness. A case-only variant
  // of the selected name is ambiguous on case-insensitive plugin caches.
  const entryName = (item: NativeJsonValue): string | undefined => { if (item.kind !== "object") return undefined; const name = field(item, "name"); return isString(name) ? name.value : undefined; };
  const exact = plugins.items.filter(item => entryName(item) === selector.plugin) as NativeJsonObject[];
  const folded = plugins.items.filter(item => entryName(item)?.toLowerCase() === selector.plugin.toLowerCase());
  need(exact.length > 0, "selected plugin entry is missing");
  need(exact.length === 1 && folded.length === 1, "selected plugin entry is duplicated or ambiguous");
  const entry = projectEntry(exact[0]!, selector);
  const metadata = field(root, "metadata"), pluginRoot = metadata?.kind === "object" ? field(metadata, "pluginRoot") : undefined;
  const nullValue: NativeJsonValue = { kind: "literal", value: "null" };
  const marketplace: NativeJsonObject = { kind: "object", entries: [
    ["name", field(root, "name")!],
    ["pluginRoot", pluginRoot ?? nullValue],
    // The root allowlist also governs dependencies declared in the plugin's own
    // plugin.json, which Claude's auto-update and /reload-plugins act on, so it
    // is bound for every entry: its value when present, `null` when absent (a
    // present value must be a string array, so `null` only means absent).
    ["allowCrossMarketplaceDependenciesOn", field(root, "allowCrossMarketplaceDependenciesOn") ?? nullValue],
  ] };
  const projection: NativeJsonObject = { kind: "object", entries: [["marketplace", marketplace], ["plugin", entry]] };
  return createHash("sha256").update(DOMAIN).update(canonical(projection)).digest("hex");
}

/** Capture an explicit review witness from a stable regular marketplace.json.
 * Symlinked ancestors, special files, oversized files and concurrent
 * replacement refuse; capture writes nothing. */
export function captureClaudeMarketplaceEntry(path: string, marketplace: string, plugin: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): ClaudeMarketplaceEntryWitness {
  need(claudeMarketplaceEntrySourceValid({ path, marketplace, plugin }), "requires a normalized absolute .claude-plugin/marketplace.json path and exact names");
  let text: string;
  try { text = readNativeSettingsWitnessFile(path, budget, "marketplace.json"); }
  catch (error) { throw new Error(`Claude marketplace entry witness cannot read marketplace.json: ${reason(error)}`); }
  return { path, hashMode: CLAUDE_MARKETPLACE_ENTRY_HASH_MODE, marketplace, plugin, sha256: hashClaudeMarketplaceEntry(text, { marketplace, plugin }) };
}
