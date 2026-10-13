/** File-only dependency closure for an explicitly reviewed Codex witness.
 * Enumerate native cache membership with the existing bounded/no-follow reader;
 * an operator cannot omit a live hook by supplying a shorter provider list.
 */
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { readNativeSettingsWitnessFile, hashNativeJsonControls } from "./claude-settings-witness.js";
import { captureDiscoveryDirectoryProjection } from "./agent-discovery-directories.js";
import { discoveryByteBudget, hashRawDiscoveryFile } from "./agent-discovery-bytes.js";

export interface CodexReviewedHookSource { path: string; sha256: string | null }
export interface CodexHookMcpDependencies { sources: CodexReviewedHookSource[]; servers: string[] }
const need: (value: unknown) => asserts value = (value: unknown): asserts value => { if (!value) throw new Error("Incomplete or unsupported reviewed Codex hook dependency"); };
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const events = new Set(["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "Interrupt"]);

function collect(table: unknown, servers: Set<string>): void {
  need(record(table) && Object.keys(table).length <= 32);
  for (const [event, groups] of Object.entries(table as Record<string, unknown>)) {
    need(events.has(event));
    need(Array.isArray(groups) && groups.length <= 32);
    for (const group of groups as any[]) {
      need(record(group) && Object.keys(group).every(key => ["hooks", "matcher"].includes(key)) && (group.matcher === undefined || typeof group.matcher === "string") && (group.hooks === undefined || Array.isArray(group.hooks) && group.hooks.length <= 32));
      for (const handler of group.hooks ?? []) {
        need(record(handler));
        if (handler.type === "command") {
          need(typeof handler.command === "string" && handler.command.length > 0 && Object.keys(handler).every(key => ["type", "command", "commandWindows", "command_windows", "timeout", "async", "statusMessage", "additionalContextLimit"].includes(key))
            && (handler.async === undefined || typeof handler.async === "boolean") && (handler.statusMessage === undefined || typeof handler.statusMessage === "string")
            && ["commandWindows", "command_windows"].every(field => handler[field] === undefined || typeof handler[field] === "string")
            && !(handler.commandWindows !== undefined && handler.command_windows !== undefined)
            && (handler.additionalContextLimit === undefined || Number.isSafeInteger(handler.additionalContextLimit) && handler.additionalContextLimit >= 0));
        } else {
          need(handler.type === "mcp_tool" && identifier(handler.server) && identifier(handler.tool)
            && (handler.input === undefined || record(handler.input)) && Object.keys(handler).every(key => ["type", "server", "tool", "input", "timeout", "statusMessage"].includes(key))
            && (handler.statusMessage === undefined || typeof handler.statusMessage === "string"));
          servers.add(handler.server);
        }
        need(handler.timeout === undefined || Number.isSafeInteger(handler.timeout) && handler.timeout >= 0);
        continue;
      }
    }
  }
}

export function captureCodexHookMcpDependencies(configPath: string, reviewed: readonly CodexReviewedHookSource[], configText?: string, changes?: Map<string, string>, budget = discoveryByteBudget()): CodexHookMcpDependencies {
  need(basename(configPath) === "config.toml" && resolve(configPath) === configPath && Array.isArray(reviewed) && reviewed.length <= 2048);
  const rows = new Map<string, CodexReviewedHookSource>();
  for (const source of reviewed) {
    need(record(source) && Object.keys(source).every(key => ["path", "sha256"].includes(key)) && typeof source.path === "string" && isAbsolute(source.path) && resolve(source.path) === source.path && !/[\x00-\x1f\x7f]/.test(source.path) && (source.sha256 === null || typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256)) && !rows.has(source.path));
    rows.set(source.path, { path: source.path, sha256: source.sha256 });
  }
  const sources = new Map<string, CodexReviewedHookSource>(), servers = new Set<string>();
  function read(path: string): string | null {
    const source = rows.get(path); need(source);
    const sha256 = hashRawDiscoveryFile(path, budget); need(source!.sha256 === sha256);
    if (changes?.has(path)) {
      const text = changes.get(path)!; need(Buffer.byteLength(text) <= 1024 * 1024); hashNativeJsonControls(text);
      sources.set(path, { path, sha256: createHash("sha256").update(text).digest("hex") }); return text;
    }
    sources.set(path, { path, sha256 });
    if (sha256 === null) return null;
    // Use the existing bounded no-follow reader with this exact reviewed basename.
    const text = readNativeSettingsWitnessFile(path, budget, basename(path) as "config.toml");
    need(Buffer.byteLength(text) <= 1024 * 1024 && createHash("sha256").update(text).digest("hex") === sha256);
    hashNativeJsonControls(text); return text;
  }
  function hooks(path: string, required = false): void {
    const text = read(path); if (text === null) { need(!required); return; }
    const value = JSON.parse(text); need(record(value) && record(value.hooks)); collect(value.hooks, servers);
  }
  const config: Record<string, any> = Bun.TOML.parse(configText ?? readNativeSettingsWitnessFile(configPath, { remaining: 1024 * 1024 }, "config.toml"));
  if (config.hooks !== undefined) {
    need(record(config.hooks));
    const { state: _state, ...declarations } = config.hooks;
    if (Object.keys(declarations).length) collect(declarations, servers);
  }
  const nativeRoot = dirname(configPath), cacheRoot = join(nativeRoot, "plugins/cache");
  hooks(join(nativeRoot, "hooks.json"));
  const inventory = captureDiscoveryDirectoryProjection([cacheRoot], [])[0]!;
  const candidates = new Map<string, string[]>();
  for (const row of inventory.entries) {
    const [relative, type] = JSON.parse(row) as [string, string], parts = relative.split("/");
    if (type !== "directory" || parts.length !== 3 || !/^[A-Za-z0-9._+-]+$/.test(parts[2]!)) continue;
    const identity = parts.slice(0, 2).join("/");
    candidates.set(identity, [...(candidates.get(identity) ?? []), parts[2]!]);
  }
  for (const [identity, versions] of candidates) {
    // Native selection prefers literal `local`. A sole version is also
    // unambiguous; multiple nonlocal versions require the native selector's
    // complete semver/lexical ordering, outside this bounded file-only scope.
    need(versions.includes("local") || versions.length === 1);
    const root = join(cacheRoot, identity, versions.includes("local") ? "local" : versions[0]!);
    // Native AgentPlugin root format precedes both legacy manifest locations.
    // Its extension/executor contract is outside this stdio-only witness.
    const agent = read(join(root, "plugin.json"));
    if (agent !== null) {
      const schema = JSON.parse(agent).$schema;
      need(typeof schema !== "string" || !schema.startsWith("https://agent-plugins.org/schemas/"));
    }
    const codex = read(join(root, ".codex-plugin/plugin.json"));
    const claude = read(join(root, ".claude-plugin/plugin.json"));
    const cursor = read(join(root, ".cursor-plugin/plugin.json"));
    const text = codex ?? claude ?? cursor;
    if (text === null) continue; // All native legacy manifest locations absent.
    const manifest = JSON.parse(text!); need(record(manifest));
    function declaration(value: unknown): void {
      if (typeof value === "string") {
        need(value.startsWith("./") && value.length > 2 && !value.slice(2).startsWith("/") && !value.split("/").includes(".."));
        const target = resolve(root, value); need(target.startsWith(root + sep));
        hooks(target, true);
      } else if (Array.isArray(value)) {
        // Native empty/mixed/invalid arrays fall back to default hooks. Refuse
        // unsupported shapes rather than accidentally certifying no hooks.
        need(value.length > 0 && value.length <= 32 && (value.every(item => typeof item === "string") || value.every(item => record(item))));
        value.forEach(declaration);
      }
      else {
        need(record(value) && Object.keys(value).every(key => ["hooks", "description"].includes(key))
          && (value.description === undefined || value.description === null || typeof value.description === "string")
          && (value.hooks === undefined || record(value.hooks)));
        collect(value.hooks ?? {}, servers);
      }
    }
    if (manifest.hooks !== undefined) declaration(manifest.hooks);
    else hooks(join(root, "hooks/hooks.json"));
  }
  const after = captureDiscoveryDirectoryProjection([cacheRoot], [])[0]!;
  need(inventory.sha256 === after.sha256 && JSON.stringify(inventory.entries) === JSON.stringify(after.entries));
  return { sources: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)), servers: [...servers].sort() };
}
