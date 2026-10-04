import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseHermesConfig, assertHermesEnvironment } from "./agent-hermes.js";
import type { IntegrationAgent } from "./agent-adapters.js";
import { captureDiscoveryDirectories, verifyDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";
import { discoveryByteBudget, hashRawDiscoveryFile } from "./agent-discovery-bytes.js";
import { hashDiscoveryPathFile } from "./agent-discovery-path-bytes.js";
import { hashManagedPluginRegistry, type ManagedPluginRegistrationWitness } from "./plugin-discovery.js";
import { readPluginBinding } from "./plugin-admission.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "./claude-marketplace-registry.js";
import { captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3 } from "./claude-settings-witness.js";
import { assertCodexHookDiscoveryRecovery, verifiesCodexHookDiscoverySource, type CodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";
import { reviewedCodexPluginSourceRoots, type CodexPluginSourceInput } from "./codex-plugin-skill-controls.js";
import { sumiConfigDirectory, sumiConfigPath } from "./agent-sumi.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
export { captureDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";

export interface DiscoverySource { path: string; sha256: string | null; hashMode?: "bytes" | "path-bytes" | "claude-plugin-registry" | "claude-marketplace-registry" | "claude-settings-v1" | "claude-settings-v2" | "claude-settings-v3" | "claude-marketplace-registry-v2" | "codex-settings-v1" | "codex-settings-v2" | "codex-settings-v3"; managedPlugins?: ManagedPluginRegistrationWitness[]; format?: "json" | "toml" | "yaml"; fields?: string[] }
export interface AgentDiscoveryBinding { agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; method: "automatic" | "reviewed"; builtinNames?: string[]; codexInstallationInputs?: { version:"codex-cli 0.160.0"; catalogSha256:string; plugins:CodexPluginSourceInput[]; directories?:DiscoveryDirectory[] } }
export interface ReviewedDiscoveryInputs { version: 1; agents: Array<{ agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; pluginHooks: "reviewed-no-skill-injection" }> }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function parseConfig(text: string, path: string, toml = false): any {
  try {
    const value = toml ? Bun.TOML.parse(text) : JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error(`Invalid native discovery configuration: ${path}`); }
}

function safe(path: string): void {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Expected an absolute native discovery path");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing symlink native discovery input: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
}
function read(path: string, changes?: Map<string, string>): string | null {
  safe(path);
  if (changes?.has(path)) return changes.get(path)!;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error(`Unsupported or oversized native discovery input: ${path}`);
  return readFileSync(path, "utf8");
}
/** Project one native configuration's witnessed fields, exactly as discovery
 * binds them. Used for both the current file and a preserved reviewed preimage. */
export function projectNativeDiscoveryFields(text: string, format: "json" | "toml" | "yaml", fields: readonly string[], path: string): string {
  const object = format === "yaml" ? parseHermesConfig(text) : parseConfig(text, path, format === "toml");
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Expected native discovery configuration object");
  return digest(JSON.stringify(Object.fromEntries(fields.map(field => [field, (object as Record<string, unknown>)[field] ?? null]))));
}
/** A typed Codex settings witness binds the whole configuration file apart from
 * the documented native-owned classes, so it replaces the narrower automatic
 * TOML field projection of the same path. The narrower projection is
 * order-sensitive and therefore not a durable witness for a file Codex itself
 * re-serializes. `resolveAgentDiscovery` must not require it alongside one. */
function isSupersededCodexProjection(agent: IntegrationAgent, configPath: string, source: DiscoverySource): boolean {
  return agent === "codex" && source.path === configPath && source.format === "toml" && isDeepStrictEqual(source.fields, [...CODEX_DISCOVERY_PROJECTION_FIELDS]);
}
function supersedesCodexProjection(sources: DiscoverySource[], configPath: string): boolean {
  return sources.some(source => source.path === configPath && (source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3"));
}
function projected(source: DiscoverySource, changes?: Map<string, string>, budget = discoveryByteBudget()): string | null {
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3")) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Codex settings witnesses require exact typed metadata");
    const current = (source.hashMode === "codex-settings-v3" ? captureCodexSettingsV3 : source.hashMode === "codex-settings-v2" ? captureCodexSettingsV2 : captureCodexSettings)(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (source.hashMode === "codex-settings-v3" ? hashCodexSettingsReplacementV3 : source.hashMode === "codex-settings-v2" ? hashCodexSettingsReplacementV2 : hashCodexSettingsReplacement)(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || source.hashMode === "claude-settings-v3")) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Claude settings witnesses require exact typed metadata");
    const current = (source.hashMode === "claude-settings-v3" ? captureClaudeSettingsV3 : source.hashMode === "claude-settings-v2" ? captureClaudeSettingsV2 : captureClaudeSettings)(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (source.hashMode === "claude-settings-v3" ? hashClaudeSettingsReplacementV3 : source.hashMode === "claude-settings-v2" ? hashClaudeSettingsReplacementV2 : hashClaudeSettingsReplacement)(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2")) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || changes?.has(source.path)) throw new Error("Claude marketplace witnesses require an exact reviewed registry without synthetic changes");
    const sha256 = (source.hashMode === "claude-marketplace-registry-v2" ? captureClaudeMarketplaceRegistryV2 : captureClaudeMarketplaceRegistry)(source.path, budget).sha256;
    // Hook rendering never writes this registry, so rebinding may not adopt a
    // registration change that appeared after the explicit review was checked.
    if (sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return sha256;
  }
  if (source.hashMode === "claude-plugin-registry") {
    if (source.format !== undefined || source.fields !== undefined || !source.managedPlugins || changes?.has(source.path)) throw new Error("Managed plugin registry witnesses require verified native registrations");
    return hashManagedPluginRegistry(source.path, source.managedPlugins);
  }
  if (source.managedPlugins !== undefined) throw new Error("Managed plugin rules require a typed registry witness");
  if (source.hashMode !== undefined) {
    if (source.hashMode !== "bytes" && source.hashMode !== "path-bytes") throw new Error("Invalid native discovery hash mode");
    if (source.format !== undefined || source.fields !== undefined) throw new Error("Raw discovery witnesses cannot project configuration fields");
    if (source.hashMode === "path-bytes") return hashDiscoveryPathFile(source.path, budget, changes);
    return hashRawDiscoveryFile(source.path, budget, changes);
  }
  const text = read(source.path, changes);
  if (text === null) return null;
  if (!source.format) return digest(text);
  return projectNativeDiscoveryFields(text, source.format, source.fields ?? [], source.path);
}
export function verifyAgentDiscovery(binding: AgentDiscoveryBinding, codexRecovery?: CodexHookDiscoveryRecovery): void {
  if (codexRecovery) assertCodexHookDiscoveryRecovery(binding, codexRecovery);
  if (!binding || !Array.isArray(binding.sources) || !Array.isArray(binding.roots) || binding.sources.length > AGENT_POLICY_LIMITS.discoverySources || binding.roots.length > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Invalid native discovery binding");
  if (binding.agent === "hermes" && !binding.directories?.length) throw new Error("Hermes discovery requires directory membership coverage; run skills hook install with a fresh discovery review");
  const installationRoots=codexInstallationRoots(binding);
  const installationInput=(path:string)=>installationRoots.some(root=>path===root || path.startsWith(root+sep));
  if (binding.directories !== undefined) {
    const projected=binding.codexInstallationInputs?.directories ?? [];
    const ancestors=binding.directories.filter(directory=>installationRoots.some(root=>root.startsWith(directory.path+sep)));
    if (projected.length!==ancestors.length || projected.some(directory=>!ancestors.some(original=>original.path===directory.path))) throw new Error("Missing installation input directory projection");
    verifyDiscoveryDirectories(binding.directories.filter(directory=>!installationInput(directory.path) && !ancestors.includes(directory)));
    verifyDiscoveryDirectories(projected,installationRoots);
  }
  const budget = discoveryByteBudget();
  for (const source of binding.sources) {
    assertMarketplaceBinding(binding, source);
    if (source.hashMode === "claude-plugin-registry" && binding.agent !== "claude") throw new Error("Managed Claude registry witnesses cannot apply to another agent");
    if (source.format !== undefined && (!["json", "toml", "yaml"].includes(source.format) || !Array.isArray(source.fields) || !source.fields.length || source.fields.length > 64 || source.fields.some(field => typeof field !== "string" || !field))) throw new Error("Invalid native discovery projection");
    if (source.sha256 !== null && !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid native discovery digest");
    // Preserve the original full inventory witness as evidence, while the
    // positively attested installation role binds current source identity.
    // These bodies/directories are not native loading inputs.
    if (installationInput(source.path)) { safe(source.path); continue; }
    const current = projected(source, undefined, budget);
    if (current !== source.sha256 && !verifiesCodexHookDiscoverySource(binding, source, current, codexRecovery)) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
  }
  for (const root of binding.roots) safe(root);
}
function codexInstallationRoots(binding:AgentDiscoveryBinding):string[] {
  const proof=binding.codexInstallationInputs;
  if (proof===undefined) return [];
  if (binding.agent!=="codex" || binding.method!=="reviewed" || proof.version!=="codex-cli 0.160.0" || !/^[a-f0-9]{64}$/.test(proof.catalogSha256) || !Array.isArray(proof.plugins) || !proof.plugins.length) throw new Error("Invalid native installation input proof");
  const cache=dirname(dirname(proof.plugins[0]!.pluginParent));
  const config=join(dirname(dirname(cache)),"config.toml"), home=dirname(dirname(dirname(cache)));
  const configSource=binding.sources.find(source=>source.path===config && source.sha256!==null && (!source.format || source.format==="toml" && source.fields?.includes("plugins")));
  const nativeRoots=NATIVE_SKILL_ROOTS.filter(([agent])=>agent==="codex").map(([,path])=>join(home,path));
  if (!configSource || proof.plugins.some(input=>nativeRoots.some(root=>root===input.sourceRoot || root.startsWith(input.sourceRoot+sep) || input.sourceRoot.startsWith(root+sep))
    || binding.sources.some(source=>basename(source.path)==="config.toml" && (source.path===input.sourceRoot || source.path.startsWith(input.sourceRoot+sep))))) throw new Error("Native installation input overlaps configuration or loading roots");
  if (proof.plugins.some(input=>dirname(dirname(input.pluginParent))!==cache || !binding.sources.some(source=>source.path===join(input.sourceRoot,".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined))) throw new Error("Missing native installation input source witness");
  return reviewedCodexPluginSourceRoots(cache,proof.plugins,path=>{const text=read(path);if(text===null) throw new Error("Missing native installation input");return text;});
}
function assertMarketplaceBinding(binding: AgentDiscoveryBinding, source: DiscoverySource): void {
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3") && (binding.agent !== "codex" || binding.method !== "reviewed" || basename(source.path) !== "config.toml")) throw new Error("Codex settings witnesses require explicit reviewed Codex configuration");
  if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || source.hashMode === "claude-settings-v3") && (binding.agent !== "claude" || binding.method !== "reviewed" || basename(source.path) !== "settings.json")) throw new Error("Claude settings witnesses require explicit reviewed Claude configuration");
  if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2") && (binding.agent !== "claude" || binding.method !== "reviewed")) throw new Error("Claude marketplace witnesses require explicit reviewed Claude discovery");
}
export function rebindAgentDiscovery(binding: AgentDiscoveryBinding, changes: Map<string, string>): AgentDiscoveryBinding {
  const budget = discoveryByteBudget();
  const installationRoots=codexInstallationRoots(binding);
  return { ...binding, sources: binding.sources.map(source => {
    assertMarketplaceBinding(binding, source);
    if (!changes.has(source.path) && installationRoots.some(root=>source.path.startsWith(root+sep))) return source;
    const sha256 = projected(source, changes, budget);
    // Only a planned write may change its witness. Do not adopt source drift
    // between initial validation and hook rendering, including raw witnesses.
    if (!changes.has(source.path) && sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return { ...source, sha256 };
  }) };
}

/** Capture full byte witnesses for reviewed source or executable files; never import or execute them. */
export function captureDiscoveryByteSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid raw discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => ({ path, hashMode: "bytes", sha256: hashRawDiscoveryFile(path, budget) }));
}

/** Capture executable/source path identity, including links and absent targets. */
export function captureDiscoveryPathSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid path discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => ({ path, hashMode: "path-bytes", sha256: hashDiscoveryPathFile(path, budget) }));
}

/** Project settings can introduce a higher-precedence discovery source. Until
 * its native merge format is supported, refuse that layer rather than certify
 * the home-only inventory. Ordinary unrelated project settings remain usable. */
export function assertProjectDiscovery(agent: IntegrationAgent, directories: string[], home: string, canonical: (path: string) => string = resolve, reviewed?: AgentDiscoveryBinding): void {
  const homeConfigPath = canonical(agentDiscoveryConfigPath(home, agent));
  for (const directory of directories) {
    const isHome = resolve(directory) === resolve(home);
    if (agent === "hermes") { assertHermesEnvironment(home); continue; }
    if (isHome && agent !== "claude" && agent !== "sumi") continue;
    const paths = agent === "claude" ? [...(isHome ? [] : [".claude/settings.json"]), ".claude/settings.local.json"]
      : agent === "codex" ? [".codex/config.toml"]
      : agent === "gemini" ? [".gemini/settings.json"]
      : agent === "opencode" ? ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"]
      : agent === "sumi" ? ["sumi.json", "sumi.jsonc", ".sumi/sumi.json", ".sumi/sumi.jsonc"]
      : [".cursor/hooks.json"];
    for (const suffix of paths) {
      const path = canonical(join(directory, suffix)), raw = read(path); if (raw === null) continue;
      // A revalidated user-root alias may live inside this project. When its
      // project-relative config resolves to the exact user config already
      // covered by discovery binding, do not treat the same file as a second,
      // higher-precedence project source. A distinct project config remains
      // subject to the normal fail-closed checks below.
      const isRootAliasedHomeConfig = (agent === "claude" && suffix === ".claude/settings.json")
        || (agent === "codex" && suffix === ".codex/config.toml");
      if (isRootAliasedHomeConfig && path === homeConfigPath) continue;
      if (suffix.endsWith(".jsonc")) throw new Error(`NATIVE_SKILL_DRIFT: project JSONC discovery configuration requires review: ${path}`);
      const config: any = parseConfig(raw, path, suffix.endsWith(".toml"));
      const keys = agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces", "skillOverrides"]
        : agent === "codex" ? ["plugins", "marketplaces", "skills"]
        : agent === "gemini" ? ["skills", "extensions"]
        : agent === "opencode" ? ["plugin", "skills"] : agent === "sumi" ? ["plugins", "skills", "permissions"] : ["hooks"];
      let admittedPlugins = false;
      if (agent === "claude" && reviewed?.agent === agent && reviewed.method === "reviewed" && config.enabledPlugins && typeof config.enabledPlugins === "object" && !Array.isArray(config.enabledPlugins)) {
        const exact = reviewed.sources.find(source => source.path === path && source.format === undefined && source.fields === undefined && (source.hashMode === undefined || source.hashMode === "bytes"));
        const managed = reviewed.sources.flatMap(source => source.hashMode === "claude-plugin-registry" ? source.managedPlugins ?? [] : []);
        if (exact && projected(exact) === exact.sha256 && managed.length) {
          const bindings = managed.map(item => readPluginBinding(item.storeRoot, item.bindingId));
          admittedPlugins = Object.entries(config.enabledPlugins).every(([id, enabled]) => typeof enabled === "boolean" && bindings.some(binding => binding.target.pluginId === id && binding.target.registrations.some(scope => scope.scope === "project" && scope.projectPath === canonical(directory))));
        }
      }
      if (keys.some(key => config[key] !== undefined && !(key === "enabledPlugins" && admittedPlugins)) || config.disableAllHooks === true || config.disableBundledSkills === false || config.hooksConfig?.enabled === false || config.permission?.skill !== undefined || config.permissions?.deny?.some((rule: unknown) => typeof rule === "string" && /^Skill(?:\(|$)/.test(rule))) throw new Error(`NATIVE_SKILL_DRIFT: higher-precedence project skill or hook configuration requires review: ${path}`);
    }
    if (agent === "sumi") for (const name of ["plugin", "plugins"]) {
      const path = canonical(join(directory, ".sumi", name)); safe(path);
      if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && readdirSync(path).length) throw new Error(`NATIVE_SKILL_DRIFT: project Sumi plugins require a dedicated discovery review: ${path}`);
    }
    if (agent === "claude") {
      const commands = canonical(join(directory, ".claude/commands")); safe(commands);
      if (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length) throw new Error("NATIVE_SKILL_DRIFT: legacy project command discovery requires a dedicated format adapter");
    }
  }
}

/** Resolve configured plugin discovery without starting an agent or loading a plugin.
 * Unknown runtime registrations require explicit reviewed inputs, never a cache guess. */
export function agentDiscoveryConfigPath(home: string, agent: IntegrationAgent): string {
  if (agent === "sumi") return sumiConfigPath(home);
  return join(home, agent === "hermes" ? ".hermes/config.yaml" : agent === "opencode" ? ".config/opencode/opencode.json" : `.${agent}/${agent === "codex" ? "config.toml" : agent === "cursor" ? "hooks.json" : "settings.json"}`);
}

export function resolveAgentDiscovery(options: { home: string; agent: IntegrationAgent; reviewed?: ReviewedDiscoveryInputs; retainedReview?: AgentDiscoveryBinding; canonical?: (path: string) => string }): AgentDiscoveryBinding {
  const canonical = options.canonical ?? resolve, home = resolve(options.home), agent = options.agent;
  const sources: DiscoverySource[] = [], roots = new Set<string>(), builtinNames: string[] = [];
  const witness = (path: string, format?: "json" | "toml" | "yaml", fields?: string[]) => {
    const source: DiscoverySource = { path: canonical(path), sha256: null, ...(format ? { format, fields } : {}) };
    source.sha256 = projected(source); sources.push(source); return read(source.path);
  };
  if (agent === "hermes") assertHermesEnvironment(home);
  const configPath = agentDiscoveryConfigPath(home, agent);
  const configText = witness(configPath, agent === "hermes" ? "yaml" : agent === "codex" ? "toml" : "json", agent === "hermes" ? ["skills", "plugins", "hooks"] : agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces"] : agent === "codex" ? [...CODEX_DISCOVERY_PROJECTION_FIELDS] : agent === "gemini" ? ["skills", "extensions", "security"] : agent === "opencode" ? ["plugin", "skills"] : agent === "sumi" ? ["skills", "plugins", "permissions"] : ["version"]);
  const config: any = configText === null ? {} : agent === "hermes" ? parseHermesConfig(configText) : parseConfig(configText, configPath, agent === "codex");
  const unresolved = (detail: string): never => { throw new Error(`Native discovery is unresolved (${agent}: ${detail}); provide a reviewed --discovery-inputs file`); };
  if (agent === "sumi") {
    const directory = sumiConfigDirectory(home);
    if (witness(join(directory, "sumi.jsonc")) !== null) unresolved("JSONC configuration requires a supported format adapter");
    for (const root of [directory, join(home, ".claude"), join(home, ".agents")]) for (const name of ["skill", "skills"]) roots.add(join(root, name));
    if (config.skills !== undefined && (!Array.isArray(config.skills) || config.skills.some((path: unknown) => typeof path !== "string"))) unresolved("skills must be a string array");
    for (const value of config.skills ?? []) {
      if (typeof value !== "string" || /[\0$]/.test(value) || !value || !(isAbsolute(value) || value.startsWith("~/"))) unresolved("remote or relative skill sources need a dedicated discovery adapter");
      roots.add(value.startsWith("~/") ? join(home, value.slice(2)) : value);
    }
    if (config.plugins !== undefined && !Array.isArray(config.plugins)) unresolved("plugins must be an array");
    const plugins = [join(directory, "plugin"), join(directory, "plugins")];
    for (const path of plugins) { safe(path); if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) for (const name of readdirSync(path).sort()) {
      if (name === "skills-cli.js" && path === plugins[1]) continue;
      const target = join(path, name);
      if (!lstatSync(target).isFile()) unresolved("local plugin packages need a dedicated discovery adapter");
      witness(target);
    } }
    for (const root of roots) {
      safe(root);
      if (lstatSync(root, { throwIfNoEntry: false })?.isDirectory() && readdirSync(root).some(name => name.endsWith(".md"))) unresolved("flat markdown skills require a dedicated native migration adapter");
    }
  }
  if (agent === "hermes") {
    const profile = witness(join(home, ".hermes/active_profile"));
    if (profile?.trim() && profile.trim() !== "default") unresolved("a non-default profile is active");
    const declared = config.skills?.external_dirs ?? [], paths = typeof declared === "string" ? [declared] : declared;
    if (!Array.isArray(paths) || paths.length > 128) unresolved("malformed external skill directories");
    for (const value of paths) {
      if (typeof value !== "string" || !value || /[\0$]/.test(value)) unresolved("environment-expanded or malformed external skill root");
      const normalized = value.trim();
      if (!normalized) continue;
      if (normalized.startsWith("~") && normalized !== "~" && !normalized.startsWith("~/")) unresolved("user-specific tilde expansion requires a separate discovery adapter");
      const path = normalized === "~" ? home : normalized.startsWith("~/") ? join(home, normalized.slice(2)) : resolve(home, ".hermes", normalized);
      safe(path); roots.add(path);
    }
  }
  if (agent === "gemini") {
    const executable = Bun.which("gemini");
    if (executable) {
      // Inspect the installed package, never run a client just to discover its
      // bundled skills. A client update changes this source binding.
      let packageRoot: string | undefined;
      for (let directory = dirname(realpathSync(executable)), depth = 0; depth < 8; directory = dirname(directory), depth++) {
        const path = join(directory, "package.json"), raw = read(path);
        if (raw !== null && parseConfig(raw, path).name === "@google/gemini-cli") { packageRoot = directory; witness(path); break; }
        if (dirname(directory) === directory) break;
      }
      if (!packageRoot) unresolved("installed Gemini package layout is not recognized");
      const builtinRoot = join(packageRoot!, "bundle/builtin"); safe(builtinRoot);
      if (!lstatSync(builtinRoot, { throwIfNoEntry: false })?.isDirectory()) unresolved("installed Gemini builtin root is missing");
      for (const name of readdirSync(builtinRoot).sort()) {
        const text = witness(join(builtinRoot, name, "SKILL.md"));
        const match = text?.match(/^---\r?\n[\s\S]*?^name:\s*([a-z0-9][a-z0-9-]*)\s*$/m);
        if (!match?.[1] || builtinNames.includes(match[1])) unresolved("installed Gemini builtin name is missing or ambiguous");
        builtinNames.push(match![1]!);
      }
    }
  }
  // Reuse only an existing review, never manufacture a new review attestation
  // or refresh its witnesses. Current runtime/configuration coverage must also
  // remain present; checking only the surviving saved hashes is insufficient.
  if (options.reviewed === undefined && options.retainedReview !== undefined) {
    const retained = options.retainedReview;
    if (retained.agent !== agent || retained.method !== "reviewed") unresolved("invalid retained review");
    verifyAgentDiscovery(retained);
    if (!retained.sources.some(source => source.path === canonical(configPath) && source.format === undefined && source.fields === undefined)) unresolved("retained review is missing the full agent configuration source");
    if (retained.sources.some(source => (source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3"))) && source.path !== canonical(configPath))) unresolved("retained settings witness names another configuration source");
    // A retained typed Codex witness already binds this file more strongly than
    // the order-sensitive TOML projection, so it replaces that projection
    // instead of requiring it again.
    const covered = supersedesCodexProjection(retained.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededCodexProjection(agent, canonical(configPath), source))
      : sources;
    if (covered.some(source => !retained.sources.some(saved => isDeepStrictEqual(saved, source)))
      || [...roots].some(root => !retained.roots.includes(root))
      || (agent === "gemini" && JSON.stringify(retained.builtinNames) !== JSON.stringify(builtinNames))) unresolved("retained review is missing current runtime discovery coverage");
    return retained;
  }
  if (options.reviewed && (options.reviewed.version !== 1 || !Array.isArray(options.reviewed.agents) || options.reviewed.agents.some(item => !item || typeof item !== "object") || new Set(options.reviewed.agents.map(item => item.agent)).size !== options.reviewed.agents.length)) throw new Error("Invalid --discovery-inputs version or agents");
  const review = options.reviewed?.agents.find(item => item.agent === agent);
  if (review) {
    if (review.pluginHooks !== "reviewed-no-skill-injection" || !Array.isArray(review.sources) || !review.sources.length || !Array.isArray(review.roots)) throw new Error("Discovery review must bind sources and confirm plugin hooks do not inject retired skills");
    const supplied = { agent, roots: review.roots, sources: review.sources, ...(review.directories !== undefined ? { directories: review.directories } : {}), method: "reviewed" as const };
    if (review.sources.some(source => source.format !== undefined || source.fields !== undefined)) throw new Error("Explicit discovery reviews require full source-file hashes");
    verifyAgentDiscovery(supplied);
    if (review.sources.some(source => (source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3"))) && source.path !== canonical(configPath))) throw new Error("Semantic settings witnesses must name the configured Claude configuration source");
    if (!review.sources.some(source => source.path === canonical(configPath))) throw new Error("Discovery review must include the agent configuration source");
    // One witness per file: a reviewed typed Codex witness replaces the
    // automatic projection of the same path rather than being shadowed by it.
    const reviewedSources = supersedesCodexProjection(review.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededCodexProjection(agent, canonical(configPath), source))
      : sources;
    return { ...supplied, roots: [...new Set([...roots, ...supplied.roots])].sort(), sources: [...reviewedSources, ...review.sources], ...(agent === "gemini" ? { builtinNames } : {}) };
  }

  function plugin(root: string): void {
    root = canonical(root); safe(root);
    const manifestPath = join(root, agent === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json");
    const raw = witness(manifestPath); if (raw === null) unresolved("plugin manifest missing");
    const manifest = parseConfig(raw!, manifestPath);
    const hooks = witness(join(root, "hooks/hooks.json"));
    if (manifest.hooks !== undefined || hooks !== null) unresolved("plugin hooks require a separate no-skill-injection review");
    const commands = join(root, "commands"); safe(commands);
    if (agent === "claude" && (manifest.commands !== undefined || (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length))) unresolved("legacy command discovery requires retirement or a dedicated format adapter");
    const rootSkill = witness(join(root, "SKILL.md"));
    if (rootSkill !== null) roots.add(root);
    const declared = manifest.skills === undefined ? ["./skills"] : typeof manifest.skills === "string" ? [manifest.skills] : manifest.skills;
    if (!Array.isArray(declared) || declared.some(path => typeof path !== "string")) unresolved("unsupported plugin skill paths");
    if (agent === "claude") roots.add(join(root, "skills"));
    for (const value of declared) {
      const path = resolve(root, value);
      if (path !== root && !path.startsWith(root + sep)) unresolved("plugin skill path escapes its root");
      roots.add(path.endsWith(`${sep}SKILL.md`) ? dirname(path) : path);
    }
  }
  if (agent === "claude") {
    const registrations = witness(join(home, ".claude/plugins/installed_plugins.json"));
    const installed = registrations === null ? {} : parseConfig(registrations, join(home, ".claude/plugins/installed_plugins.json")).plugins;
    const commands = canonical(join(home, ".claude/commands")); safe(commands);
    if (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && readdirSync(commands).length) unresolved("legacy home command discovery requires a dedicated format adapter");
    for (const [id, enabled] of Object.entries(config.enabledPlugins ?? {})) {
      if (enabled === false) continue;
      if (enabled !== true) unresolved("unsupported plugin enablement");
      const matches = installed?.[id];
      if (!Array.isArray(matches) || matches.length !== 1 || typeof matches[0]?.installPath !== "string" || matches[0]?.scope !== "user") unresolved("enabled plugin registration is missing or ambiguous");
      plugin(matches[0].installPath);
    }
  } else if (agent === "codex") {
    for (const [id, value] of Object.entries(config.plugins ?? {}) as Array<[string, any]>) {
      if (value?.enabled === false) continue;
      if (value?.enabled !== true) unresolved("unsupported plugin enablement");
      const split = id.lastIndexOf("@"), name = id.slice(0, split), marketplace = id.slice(split + 1);
      const market = config.marketplaces?.[marketplace] ?? (marketplace === "personal" ? { source_type: "local", source: home } : undefined);
      if (split < 1 || market?.source_type !== "local" || typeof market.source !== "string" || !isAbsolute(market.source)) unresolved("enabled plugin marketplace is not an explicit local source");
      const catalogText = witness(join(market.source, ".agents/plugins/marketplace.json"));
      if (catalogText === null) unresolved("marketplace catalog missing");
      const catalog = parseConfig(catalogText!, join(market.source, ".agents/plugins/marketplace.json")), matches = Array.isArray(catalog.plugins) ? catalog.plugins.filter((item: any) => item.name === name) : [];
      if (matches.length !== 1 || matches[0]?.source?.source !== "local" || typeof matches[0]?.source?.path !== "string") unresolved("plugin catalog source is missing or ambiguous");
      plugin(resolve(market.source, matches[0].source.path));
    }
  } else if (agent === "opencode") {
    if (witness(join(home, ".config/opencode/opencode.jsonc")) !== null || witness(join(home, ".config/opencode/config.json")) !== null) unresolved("additional config layers require review");
    if ((config.plugin?.length ?? 0) > 0 || config.skills?.urls?.length) unresolved("external plugin or remote skill source");
    for (const path of config.skills?.paths ?? []) { if (typeof path !== "string" || !isAbsolute(path)) unresolved("relative or malformed added skill root"); roots.add(path); }
    const localPlugins = join(home, ".config/opencode/plugins"); safe(localPlugins);
    if (lstatSync(localPlugins, { throwIfNoEntry: false }) && readdirSync(localPlugins).some(name => name !== "skills-cli.js")) unresolved("additional local plugin hooks require review");
  } else if (agent === "sumi") {
    if ((config.plugins?.length ?? 0) > 0 || sources.some(source => source.path !== canonical(configPath) && source.path !== canonical(join(sumiConfigDirectory(home), "sumi.jsonc")) && source.sha256 !== null)) unresolved("external or foreign local plugins require review");
  } else if (agent === "hermes") {
    // Python entry points and bundled plugins may register prompt sections or
    // namespaced skills. Do not import them to guess their effective behavior.
    for (const directory of [join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent")]) {
      safe(directory); if (lstatSync(directory, { throwIfNoEntry: false })) unresolved("installed runtime/plugin discovery requires reviewed source bindings");
    }
    if (Bun.which("hermes") || Object.keys(config.plugins ?? {}).length) unresolved("installed runtime/plugin discovery requires reviewed source bindings");
  } else if (agent === "gemini") {
    if (Object.keys(config.extensions ?? {}).length || config.skills?.paths?.length) unresolved("custom extension or skill paths");
    // Extension files under the normal directory are also inventoried. A linked
    // development extension must be reviewed instead of following its symlink.
    const directory = join(home, ".gemini/extensions"); safe(directory);
    if (lstatSync(directory, { throwIfNoEntry: false })) for (const name of readdirSync(directory)) {
      const root = join(directory, name); safe(root);
      if (!lstatSync(root)?.isDirectory()) continue;
      const raw = witness(join(root, "gemini-extension.json"));
      if (raw === null) unresolved("extension registration missing");
      const manifest = parseConfig(raw!, join(root, "gemini-extension.json"));
      if (manifest.hooks !== undefined || witness(join(root, "hooks/hooks.json")) !== null || witness(join(root, ".gemini-extension-install.json")) !== null) unresolved("extension hooks or linked registration require review");
      roots.add(join(root, "skills"));
    }
  }
  return { agent, roots: [...roots].sort(), sources, method: "automatic", ...(agent === "gemini" ? { builtinNames } : {}), ...(agent === "hermes" ? { directories: captureDiscoveryDirectories([join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent")].map(path => canonical(path))) } : {}) };
}
