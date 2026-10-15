import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { codexAppDeclarationValid } from "./codex-plugin-skill-controls.js";

/** OpenAI's own Codex plugin marketplaces, by their exact native names in Codex
 * 0.162.1. Only these hold vendor plugin copies; every other marketplace,
 * including Hasna's and look-alike names, is never treated as vendor content. */
export const CODEX_VENDOR_MARKETPLACES: readonly string[] = Object.freeze(["openai-bundled", "openai-curated", "openai-curated-remote"]);
/** Vendor marketplaces whose plugins Codex installs remotely and records with a
 * `.codex-remote-plugin-install.json` receipt beside their versions. */
export const CODEX_REMOTE_VENDOR_MARKETPLACES: readonly string[] = Object.freeze(["openai-curated-remote"]);

const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const directory = (path: string): boolean => { const stat = lstatSync(path, { throwIfNoEntry: false }); return Boolean(stat?.isDirectory() && !stat.isSymbolicLink()); };

/** The allowlisted vendor marketplace a canonical path lies in, at or below
 * `<cache>/<marketplace>`, or null for the cache itself, other marketplaces and
 * any non-canonical path. */
export function codexVendorMarketplace(cache: string, path: string): string | null {
  if (!isAbsolute(path) || resolve(path) !== path) return null;
  const inside = relative(cache, path);
  if (!inside || isAbsolute(inside)) return null;
  const parts = inside.split(sep);
  if (parts.some(part => !part || part === "." || part === "..")) return null;
  return CODEX_VENDOR_MARKETPLACES.includes(parts[0]!) ? parts[0]! : null;
}

/** Root entries a vendor refresh never needs: every other manifest location
 * Codex 0.162.1 reads besides `.codex-plugin/plugin.json` (see
 * codex-hook-mcp-dependencies.ts), the default hooks location and a root hooks
 * file, and the MCP, command and agent locations. Matched without regard to
 * case, so a case-insensitive file system cannot alias one. */
const OTHER_PLUGIN_CONTROLS: readonly string[] = Object.freeze(["plugin.json", ".claude-plugin", ".cursor-plugin", "hooks", "hooks.json", ".mcp.json", "commands", "agents"]);
/** The only manifest keys a vendor refresh may carry: identity and display
 * metadata, the default skills root and the reviewed `.app.json` connector
 * declaration that every current vendor plugin has. Any other key (hooks,
 * commands, extensions, MCP servers, agents and unknown keys) refuses. */
const VENDOR_MANIFEST_KEYS: readonly string[] = Object.freeze(["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "interface", "skills", "apps"]);
/** The default skills root, which vendor manifests spell out. */
const DEFAULT_SKILLS_PATHS: readonly string[] = Object.freeze(["./skills", "./skills/"]);
const VENDOR_APP_DECLARATION = "./.app.json";
const MAX_SUBTREE_ENTRIES = 20000;
const MAX_SUBTREE_DEPTH = 32;
/** Directory names the native inventory skips, so a SKILL.md below one is never inventoried. */
const hiddenName = (name: string): boolean => name.startsWith(".") || name === "node_modules";
const isSkillDocument = (name: string): boolean => name.toLowerCase() === "skill.md";
const present = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const holdsOtherControl = (path: string): boolean => readdirSync(path).some(name => OTHER_PLUGIN_CONTROLS.includes(name.toLowerCase()));

/** Below a plugin root: real directories and regular files only, and every
 * SKILL.md is its own visible inventory entry (no hidden or `node_modules`
 * ancestor, no SKILL.md nested below another skill). Links refuse. */
function pluginTreeVisible(path: string, hidden: boolean, insideSkill: boolean, depth: number, budget: { remaining: number }): boolean {
  if (depth > MAX_SUBTREE_DEPTH) return false;
  const names = readdirSync(path);
  const skill = names.some(isSkillDocument);
  if (skill && (hidden || insideSkill)) return false;
  for (const name of names) {
    if (--budget.remaining < 0) return false;
    const child = join(path, name), stat = lstatSync(child);
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) { if (!pluginTreeVisible(child, hidden || hiddenName(name), insideSkill || skill, depth + 1, budget)) return false; }
    else if (!stat.isFile()) return false;
  }
  return true;
}

/** A plugin version root a vendor refresh can add without review: its only
 * manifest is a regular `.codex-plugin/plugin.json` (alone in its directory,
 * no duplicate keys) whose keys are all in VENDOR_MANIFEST_KEYS, with the
 * default skills root and, when present, exactly the `./.app.json` connector
 * declaration backed by an `.app.json` that passes the strict connector
 * validation rootControls applies (codexAppDeclarationValid); there is no hooks, MCP, command
 * or agent location and no root, Claude or Cursor manifest; every skill in it
 * is visible to the native inventory. Errors and bounds refuse. */
export function codexVendorPluginRootRefreshSafe(root: string, budget: { remaining: number } = { remaining: MAX_SUBTREE_ENTRIES }): boolean {
  try {
    if (!directory(root) || holdsOtherControl(root)) return false;
    if (!directory(join(root, ".codex-plugin"))) return false;
    const controls = readdirSync(join(root, ".codex-plugin"));
    if (controls.length !== 1 || controls[0] !== "plugin.json") return false;
    const manifest = join(root, ".codex-plugin", "plugin.json"), stat = lstatSync(manifest, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
    const text = readFileSync(manifest, "utf8");
    // Codex refuses duplicate decoded keys; so does this check, before reading any key.
    hashNativeJsonControls(text);
    const value: unknown = JSON.parse(text);
    if (!record(value) || Object.keys(value).some(key => !VENDOR_MANIFEST_KEYS.includes(key))) return false;
    if (Object.hasOwn(value, "skills") && !(typeof value.skills === "string" && DEFAULT_SKILLS_PATHS.includes(value.skills))) return false;
    const app = join(root, ".app.json");
    if (Object.hasOwn(value, "apps") ? value.apps !== VENDOR_APP_DECLARATION || !codexAppDeclarationValid(app) : present(app)) return false;
    return pluginTreeVisible(root, false, false, 0, budget);
  } catch { return false; }
}

/** The real directories directly below a vendor marketplace or plugin directory,
 * or null when any entry is a link, a special file, a SKILL.md file or a hidden
 * (or `node_modules`) directory. Regular files are allowed: the native remote
 * install receipt sits beside a plugin's versions. */
function vendorMembers(path: string, budget: { remaining: number }): string[] | null {
  const directories: string[] = [];
  for (const name of readdirSync(path)) {
    if (--budget.remaining < 0) return null;
    const stat = lstatSync(join(path, name));
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return null;
    if (stat.isFile()) { if (isSkillDocument(name)) return null; continue; }
    if (hiddenName(name)) return null;
    directories.push(join(path, name));
  }
  return directories;
}

/** True only when every cached version of one vendor plugin
 * (`<cache>/<marketplace>/<plugin>`) passes codexVendorPluginRootRefreshSafe,
 * the plugin directory carries no manifest, hooks, MCP, command or agent
 * location of its own, and no version is a link. Errors and bounds refuse. */
export function codexVendorPluginRefreshSafe(parent: string, budget: { remaining: number } = { remaining: MAX_SUBTREE_ENTRIES }): boolean {
  try {
    if (!directory(parent) || holdsOtherControl(parent) || present(join(parent, ".codex-plugin"))) return false;
    const versions = vendorMembers(parent, budget);
    return versions !== null && versions.every(version => codexVendorPluginRootRefreshSafe(version, budget));
  } catch { return false; }
}

/** True only when every plugin in a vendor marketplace subtree could have been
 * added by a routine vendor refresh: each plugin passes
 * codexVendorPluginRefreshSafe and the marketplace holds no link, special file
 * or hidden directory. Plugin hooks and other skill roots need their own
 * review, so a membership change that adds them is never a routine vendor
 * refresh. The whole marketplace is checked, not only new versions, so anything
 * unexpected anywhere refuses. Bounded; links are never followed; errors refuse. */
export function codexVendorSubtreeHookFree(cache: string, path: string): boolean {
  const marketplace = codexVendorMarketplace(cache, path);
  if (!marketplace) return false;
  const root = join(cache, marketplace), budget = { remaining: MAX_SUBTREE_ENTRIES };
  try {
    if (!directory(root)) return false;
    // <marketplace>/<plugin>/<version> are the only plugin root depths Codex uses.
    const plugins = vendorMembers(root, budget);
    return plugins !== null && plugins.every(parent => codexVendorPluginRefreshSafe(parent, budget));
  } catch { return false; }
}

/** A `[[skills.config]]` row that can only disable one allowlisted vendor plugin
 * skill: exactly one selector plus `enabled = false`, where a qualified name's
 * namespace is a plugin present in a vendor marketplace, or a path lies in one. */
function vendorDisableRow(row: unknown, cache: string): boolean {
  if (!record(row) || row.enabled !== false) return false;
  const keys = Object.keys(row).sort().join(",");
  if (keys === "enabled,name") {
    const match = typeof row.name === "string" ? /^([A-Za-z0-9_-]{1,64}):[A-Za-z0-9_.-]{1,128}$/.exec(row.name.trim()) : null;
    return Boolean(match && CODEX_VENDOR_MARKETPLACES.some(marketplace => directory(join(cache, marketplace, match[1]!))));
  }
  if (keys === "enabled,path") return typeof row.path === "string" && row.path.endsWith(`${sep}SKILL.md`) && codexVendorMarketplace(cache, row.path) !== null;
  return false;
}
/** A `[plugins."<name>@<vendor marketplace>"]` table that only disables a plugin.
 * Enabling one can activate previously unreviewed hooks without any membership
 * change, so it always requires a fresh discovery review. */
function vendorPluginEntry(key: string, value: unknown): boolean {
  const at = key.lastIndexOf("@");
  return at > 0 && identifier(key.slice(0, at)) && CODEX_VENDOR_MARKETPLACES.includes(key.slice(at + 1))
    && record(value) && Object.keys(value).length === 1 && value.enabled === false;
}
function normalized(value: Record<string, any>): Record<string, any> {
  const copy = structuredClone(value);
  if (record(copy.plugins) && !Object.keys(copy.plugins).length) delete copy.plugins;
  if (record(copy.skills) && Array.isArray(copy.skills.config) && !copy.skills.config.length) delete copy.skills.config;
  if (record(copy.skills) && !Object.keys(copy.skills).length) delete copy.skills;
  return copy;
}

const MAX_TRAILING_VENDOR_ROWS = 16;
const MAX_VENDOR_TABLES = 8;
const MAX_CONFIG_CANDIDATES = 128;
const HEADER = /^[ \t]*(\[\[|\[)[ \t]*([^[\]\r\n]+?)[ \t]*(\]\]|\])[ \t]*(?:#[^\r\n]*)?\r?\n?$/;

/** Candidate earlier versions of a Codex config.toml that differ from `text`
 * only by appended vendor disable rows and/or vendor plugin disables,
 * the entries an operator or Codex adds when a vendor plugin refreshes. Each
 * candidate is checked to parse to exactly `text` without those entries, so a
 * candidate whose digest equals the reviewed witness proves the change is
 * vendor-only. Anything the text model cannot remove exactly yields no
 * candidate, which keeps the witness strict.
 *
 * Bounds: at most 8 vendor plugin tables, 16 trailing rows and 128 candidates,
 * tried smallest edit first (fewest changed tables, then fewest removed rows).
 * `rowsAffectDigest: false` (a typed V2-V5 witness, which ignores disable-only
 * rows) skips row removal; with it, every change to at most two of eight
 * tables fits the 128 candidates. Otherwise appended rows alone always fit.
 * A bound only ever omits candidates, so it can only cause a refusal. */
export function codexVendorConfigCandidates(text: string, cache: string, options: { rowsAffectDigest?: boolean } = {}): string[] {
  if (Buffer.byteLength(text) > 1024 * 1024) return [];
  let parsed: Record<string, any>;
  try { parsed = Bun.TOML.parse(text) as Record<string, any>; } catch { return []; }
  const rows: unknown[] = record(parsed.skills) && Array.isArray(parsed.skills.config) ? parsed.skills.config : [];
  let trailing = 0;
  while (trailing < rows.length && trailing < MAX_TRAILING_VENDOR_ROWS && vendorDisableRow(rows[rows.length - 1 - trailing], cache)) trailing++;
  const pluginKeys = record(parsed.plugins) ? Object.keys(parsed.plugins).filter(key => vendorPluginEntry(key, parsed.plugins[key])) : [];
  if (pluginKeys.length > MAX_VENDOR_TABLES) return [];
  if (!trailing && !pluginKeys.length) return [];
  const lines = text.split(/(?<=\n)/);
  const headers: Array<{ index: number; array: boolean; key: string }> = [];
  lines.forEach((line, index) => {
    const match = HEADER.exec(line);
    if (match && (match[1] === "[[") === (match[3] === "]]")) headers.push({ index, array: match[1] === "[[", key: match[2]!.replace(/[ \t]*\.[ \t]*/g, ".") });
  });
  const extent = (header: { index: number }) => {
    const next = headers.find(other => other.index > header.index);
    return { start: header.index, end: next ? next.index : lines.length };
  };
  const skillBlocks = headers.filter(header => header.array && header.key === "skills.config").map(extent);
  const pluginBlocks = pluginKeys.map(key => {
    const matches = headers.filter(header => !header.array && header.key === `plugins.${JSON.stringify(key)}`);
    if (matches.length !== 1) return null;
    const range = extent(matches[0]!);
    const enabledLines = lines.flatMap((line, index) => index >= range.start && index < range.end
      && /^[ \t]*enabled[ \t]*=[ \t]*false[ \t]*(?:#[^\r\n]*)?\r?\n?$/.test(line) ? [index] : []);
    return { key, ...range, enabledLine: enabledLines.length === 1 ? enabledLines[0]! : null };
  });
  const tableCount = pluginBlocks.every(block => block !== null) ? pluginBlocks.length : 0;
  const candidates: string[] = [];
  // Keep reviewed tables, remove newly added disables, or restore a formerly
  // enabled flag. Reproducing the reviewed digest proves a disable-only change.
  // Bound both enumeration and parsed text; unsupported shapes stay strict.
  let examined = 0;
  const action = (mask: number, index: number) => Math.floor(mask / 3 ** index) % 3;
  // Smallest edit first: fewest changed tables, then fewest removed rows, so the
  // candidate bound is spent on the common single-table and rows-only refreshes.
  const masks = Array.from({ length: 3 ** tableCount }, (_, mask) => ({ mask, changed: pluginBlocks.filter((_, index) => action(mask, index) !== 0).length }))
    .sort((a, b) => a.changed - b.changed || a.mask - b.mask);
  const maxRemoved = options.rowsAffectDigest === false ? 0 : Math.min(trailing, skillBlocks.length);
  for (const { mask } of masks) {
    for (let removed = 0; removed <= maxRemoved; removed++) {
      if (!mask && !removed) continue;
      const selected = pluginBlocks.flatMap((block, index) => block === null ? [] : [{ ...block, action: action(mask, index) }]);
      const tables = selected.filter(block => block.action === 1), restored = selected.filter(block => block.action === 2);
      if (restored.some(block => block.enabledLine === null)) continue;
      if (++examined > MAX_CONFIG_CANDIDATES) return candidates;
      const ranges = [...(removed ? skillBlocks.slice(skillBlocks.length - removed) : []), ...tables];
      const candidate = lines.map((line, index) => restored.some(block => block.enabledLine === index)
        ? line.replace(/^(\s*enabled\s*=\s*)false/, "$1true") : line)
        .filter((_, index) => !ranges.some(range => index >= range.start && index < range.end)).join("");
      const expected = structuredClone(parsed);
      if (removed) expected.skills.config = rows.slice(0, rows.length - removed);
      for (const table of tables) delete expected.plugins[table.key];
      for (const table of restored) expected.plugins[table.key].enabled = true;
      let actual: Record<string, any>;
      try { actual = Bun.TOML.parse(candidate) as Record<string, any>; } catch { continue; }
      if (isDeepStrictEqual(normalized(actual), normalized(expected))) candidates.push(candidate);
    }
  }
  return candidates;
}
