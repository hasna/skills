/** Narrow Claude registry transition witness. Unknown rows and unknown row fields remain exact. */
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readPluginAdmissionReceipt, readPluginBinding, pluginResolverCommand } from "./plugin-admission.js";
import { pluginFileWitnesses, pluginHash, pluginKeys, pluginNeed, pluginObject, pluginText, PLUGIN_PROJECTION_LIMITS } from "./plugin-projection.js";
import { snapshotPluginTree, verifyPluginTree } from "./plugin-projection-store.js";
import type { PluginAdmissionReceipt } from "./plugin-admission.js";

export interface ManagedPluginRegistrationWitness { bindingId: string; storeRoot: string }
export function validateManagedPluginWitnesses(value: unknown): asserts value is ManagedPluginRegistrationWitness[] {
  pluginNeed(Array.isArray(value) && value.length > 0 && value.length <= PLUGIN_PROJECTION_LIMITS.registrations, "Invalid managed plugin witness collection");
  const seen = new Set<string>();
  for (const item of value) {
    pluginKeys(item, ["bindingId", "storeRoot"]);
    pluginNeed(typeof item.bindingId === "string" && /^[a-f0-9]{64}$/.test(item.bindingId) && !seen.has(item.bindingId), "Invalid or duplicate managed plugin witness"); seen.add(item.bindingId);
    pluginText(item.storeRoot); pluginNeed(isAbsolute(item.storeRoot) && resolve(item.storeRoot) === item.storeRoot, "Invalid plugin receipt store path");
  }
}
function safe(path: string): void {
  pluginText(path); pluginNeed(isAbsolute(path) && resolve(path) === path, "Invalid plugin registry path");
  for (let at = path; ; at = dirname(at)) { pluginNeed(!lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink(), "Plugin registry path traverses a symlink"); if (at === dirname(at)) break; }
}
function readRegistry(path: string): { value: Record<string, unknown>; rawDigest: string } {
  safe(path); const initial = lstatSync(path); pluginNeed(initial.isFile() && initial.size <= 1024 * 1024, "Plugin registry is not a bounded regular file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd); pluginNeed(opened.isFile() && opened.ino === initial.ino && opened.dev === initial.dev, "Plugin registry changed during open");
    const bytes = Buffer.alloc(1024 * 1024 + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(fd), current = lstatSync(path); safe(path);
    pluginNeed(length <= 1024 * 1024 && length === opened.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs && current.dev === opened.dev && current.ino === opened.ino && current.mtimeMs === opened.mtimeMs && current.ctimeMs === opened.ctimeMs, "Plugin registry changed during read");
    let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); } catch { pluginNeed(false, "Invalid plugin registry JSON"); }
    pluginNeed(pluginObject(value) && value.version === 2 && pluginObject(value.plugins), "Unsupported native plugin registry schema");
    return { value, rawDigest: pluginHash(bytes.subarray(0, length)) };
  } finally { closeSync(fd); }
}
function nativeVersionMatches(version: string, receipt: PluginAdmissionReceipt): boolean {
  const upstream = receipt.plan.manifest.upstream.version;
  return upstream === null ? /^[a-f0-9]{12}$/.test(version) : version.startsWith(`${upstream}-`);
}
/** This is a structured witness, not an exemption for a plugin ID or its cache directory. */
export function hashManagedPluginRegistry(path: string, managed: ManagedPluginRegistrationWitness[]): string {
  validateManagedPluginWitnesses(managed);
  const snapshot = readRegistry(path), plugins = snapshot.value.plugins as Record<string, unknown>;
  const seen = new Set<string>(), verified = new Set<string>(); let verifiedBytes = 0;
  for (const witness of managed) {
    const binding = readPluginBinding(witness.storeRoot, witness.bindingId), target = binding.target;
    pluginNeed(!seen.has(target.pluginId), "A plugin ID has multiple managed bindings"); seen.add(target.pluginId);
    const rows = plugins[target.pluginId]; pluginNeed(Array.isArray(rows) && rows.length === target.registrations.length, "Managed plugin registration membership changed");
    const [name, market] = target.pluginId.split("@"), cacheRoot = join(dirname(path), "cache", market!, name!);
    const scopes = new Set<string>(), approvals = new Map<string, PluginAdmissionReceipt>(), currentFiles = new Map<string, string>();
    plugins[target.pluginId] = rows.map(row => {
      pluginNeed(pluginObject(row), "Invalid managed plugin registration");
      const scope = JSON.stringify([row.scope, row.projectPath ?? null]);
      pluginNeed(!scopes.has(scope) && target.registrations.some(item => JSON.stringify([item.scope, item.projectPath]) === scope), "Managed plugin registration scope changed"); scopes.add(scope);
      pluginNeed(row.sourceCommand === pluginResolverCommand(binding), "Managed plugin command source changed");
      pluginText(row.version, 256); pluginText(row.installPath); pluginText(row.sourceProducerPath); pluginText(row.lastUpdated, 64);
      pluginNeed(Number.isFinite(Date.parse(row.lastUpdated)), "Invalid managed plugin update timestamp");
      pluginNeed(/^(?:[A-Za-z0-9][A-Za-z0-9._+-]*-)?[a-f0-9]{12}$/.test(row.version) && row.installPath === join(cacheRoot, row.version), "Managed plugin cache path or version is outside its registration");
      const approval = (producer: string) => {
        pluginText(producer); const digest = `sha256:${basename(producer)}`;
        const receipt = readPluginAdmissionReceipt(witness.storeRoot, witness.bindingId, digest);
        pluginNeed(receipt.materializedPath === producer, "Managed producer path is not an approved immutable projection");
        if (!verified.has(producer)) {
          verifiedBytes += receipt.plan.files.reduce((total, file) => total + file.size, 0);
          pluginNeed(verifiedBytes <= 256 * 1024 * 1024, "Managed plugin verification exceeds its aggregate byte budget");
          verifyPluginTree(producer, receipt.plan.files); verified.add(producer);
        }
        approvals.set(producer, receipt);
        return receipt;
      };
      const receipt = approval(row.sourceProducerPath);
      pluginNeed(nativeVersionMatches(row.version, receipt), "Native plugin version differs from its admitted original version");
      const expected = JSON.stringify(receipt.plan.files), previousExpected = currentFiles.get(row.installPath);
      pluginNeed(previousExpected === undefined || previousExpected === expected, "Native scopes disagree about their shared installed package"); currentFiles.set(row.installPath, expected);
      if (row.previousProducerPaths !== undefined) {
        pluginNeed(Array.isArray(row.previousProducerPaths) && row.previousProducerPaths.length <= PLUGIN_PROJECTION_LIMITS.history && new Set(row.previousProducerPaths).size === row.previousProducerPaths.length, "Invalid managed producer history");
        for (const producer of row.previousProducerPaths) { pluginText(producer); approval(producer); }
      }
      // No other fields, even fields added by a future Claude release, are normalized.
      return Object.fromEntries(Object.entries(row).filter(([key]) => !["version", "installPath", "sourceProducerPath", "previousProducerPaths", "lastUpdated"].includes(key)));
    });
    // Running sessions can retain an older native installation. Cover the entire
    // plugin's version directory, including command files and ordinary components.
    safe(cacheRoot); const before = lstatSync(cacheRoot); pluginNeed(before.isDirectory(), "Invalid managed plugin cache root");
    const directory = opendirSync(cacheRoot), names: string[] = [];
    try { for (let item = directory.readSync(); item; item = directory.readSync()) { pluginNeed(names.length < PLUGIN_PROJECTION_LIMITS.history, "Managed native cache history exceeds its limit"); pluginNeed(item.isDirectory(), "Unexpected native cache member"); names.push(item.name); } } finally { directory.closeSync(); }
    for (const version of names.sort()) {
      const files = pluginFileWitnesses(snapshotPluginTree(join(cacheRoot, version), { nativeRuntime: `claude-${target.native.version}` }));
      verifiedBytes += files.reduce((total, file) => total + file.size, 0);
      pluginNeed(verifiedBytes <= 256 * 1024 * 1024, "Managed plugin verification exceeds its aggregate byte budget");
      const serialized = JSON.stringify(files);
      const expected = currentFiles.get(join(cacheRoot, version));
      pluginNeed(expected === undefined || serialized === expected, "Current native cache differs from its exact registered producer receipt");
      pluginNeed([...approvals.values()].some(receipt => nativeVersionMatches(version, receipt) && JSON.stringify(receipt.plan.files) === serialized), "A retained native plugin cache version differs from every approved projection");
    }
    for (const row of rows) pluginNeed(names.includes((row as Record<string, unknown>).version as string), "Managed native plugin installation is missing");
    const after = lstatSync(cacheRoot); safe(cacheRoot);
    pluginNeed(before.dev === after.dev && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "Managed cache version membership changed during verification");
  }
  pluginNeed(readRegistry(path).rawDigest === snapshot.rawDigest, "Native plugin registry changed during content verification");
  return pluginHash(JSON.stringify(snapshot.value));
}
export function captureManagedPluginRegistry(path: string, managedPlugins: ManagedPluginRegistrationWitness[]) {
  return { path, hashMode: "claude-plugin-registry" as const, managedPlugins, sha256: hashManagedPluginRegistry(path, managedPlugins) };
}
