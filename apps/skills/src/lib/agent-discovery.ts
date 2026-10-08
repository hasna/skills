import { captureSumiSettings, hashSumiSettingsReplacement, SUMI_DISCOVERY_PROJECTION_FIELDS } from "./sumi-settings-witness.js";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseHermesConfig, assertHermesEnvironment } from "./agent-hermes.js";
import type { IntegrationAgent } from "./agent-adapters.js";
import { captureDiscoveryDirectories, captureDiscoveryDirectoryProjection, verifyDiscoveryDirectoryProjection, verifyDiscoveryDirectories, type DiscoveryDirectory, type DiscoveryDirectoryProjection } from "./agent-discovery-directories.js";
import { discoveryByteBudget, hashRawDiscoveryFile } from "./agent-discovery-bytes.js";
import { hashDiscoveryPathFile } from "./agent-discovery-path-bytes.js";
import { hashClaudePluginManifest, projectReviewedClaudePluginManifest } from "./claude-plugin-manifest-witness.js";
import { hashManagedPluginRegistry, type ManagedPluginRegistrationWitness } from "./plugin-discovery.js";
import { readPluginBinding } from "./plugin-admission.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "./claude-marketplace-registry.js";
import { captureClaudeMarketplaceEntry, claudeMarketplaceEntrySourceValid } from "./claude-marketplace-entry-witness.js";
import { hashNativeJsonControls, captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, captureClaudeSettingsV4, hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3, hashClaudeSettingsReplacementV4 } from "./claude-settings-witness.js";
import { assertCodexHookDiscoveryRecovery, verifiesCodexHookDiscoverySource, type CodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4, hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4, CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";
import { absentDisabledCodexPluginParent, reviewedDisabledCodexPluginParent, reviewedRetiredCodexRoot, reviewedCodexPluginCapabilitiesUnchanged, reviewedCodexPluginSourceRoots, type CodexPluginSkillControl, type CodexPluginSourceInput } from "./codex-plugin-skill-controls.js";
import { sumiConfigDirectory, sumiConfigPath } from "./agent-sumi.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
export { captureDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";

export interface DiscoverySource { path: string; sha256: string | null; hashMode?: "bytes" | "path-bytes" | "claude-plugin-manifest-v1" | "claude-plugin-registry" | "claude-marketplace-registry" | "claude-settings-v1" | "claude-settings-v2" | "claude-settings-v3" | "claude-settings-v4" | "claude-marketplace-registry-v2" | "codex-settings-v1" | "codex-settings-v2" | "codex-settings-v3" | "codex-settings-v4" | "sumi-settings-v1" | "claude-marketplace-entry-v1"; managedPlugins?: ManagedPluginRegistrationWitness[]; format?: "json" | "toml" | "yaml"; fields?: string[]; marketplace?: string; plugin?: string }
export interface AgentDiscoveryBinding { agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; method: "automatic" | "reviewed"; builtinNames?: string[]; codexDisabledPluginSkills?: CodexPluginSkillControl[]; codexRetiredMaterializations?: { roots:string[]; parents?:string[]; directories:Array<DiscoveryDirectory & {entries?:string[]}> }; codexInstallationInputs?: { version:string; catalogSha256:string; plugins:CodexPluginSourceInput[]; directories?:DiscoveryDirectory[] } }
/** Discovery that depends on an installed runtime found by command name. */
const DISCOVERY_RUNTIME_COMMANDS: Partial<Record<IntegrationAgent, string>> = Object.freeze({ gemini: "gemini" });
/** An environment gap, not drift: the runtime a review saw cannot be resolved
 * from this process, so its discovery cannot be re-derived. Callers keep it
 * blocking and must not report it as NATIVE_SKILL_DRIFT. */
export const DISCOVERY_ROOT_UNRESOLVED = "DISCOVERY_ROOT_UNRESOLVED";
export function discoveryRootUnresolved(agent: IntegrationAgent, command: string, detail: string): Error {
  return new Error(`${DISCOVERY_ROOT_UNRESOLVED}: ${agent} discovery cannot resolve its "${command}" executable: ${detail}. The reviewed discovery is unchanged; this is an environment gap, not drift.`);
}
export function isDiscoveryRootUnresolved(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith(`${DISCOVERY_ROOT_UNRESOLVED}: `);
}
/** The runtime executable a discovery review resolved through PATH, with the
 * realpath its launcher led to. The policy stores it beside the binding
 * (bridge.discoveryExecutables), not inside it, so a consumer that compares
 * stored bindings keeps the shape it already knows. */
export interface DiscoveryExecutable { command: string; path: string; target: string }
// Paths in refusal text come from the filesystem: JSON-quote them and escape
// everything outside printable ASCII so no control or bidi character is echoed.
const quotedPath = (path: string) => JSON.stringify(path).replace(/[^\x20-\x7e]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
const realpathOrNull = (path: string): string | null => { try { return realpathSync(path); } catch { return null; } };
/** Resolve the agent's runtime command through this process's PATH: the
 * executable this process would actually run. */
export function discoveryExecutable(agent: IntegrationAgent): DiscoveryExecutable | null {
  const command = DISCOVERY_RUNTIME_COMMANDS[agent];
  const found = command ? Bun.which(command) : null;
  if (!command || !found) return null;
  const path = resolve(found), target = realpathOrNull(path);
  return target === null ? null : { command, path, target };
}
/** Check a recorded executable by its exact path, ignoring PATH. Null when the
 * path no longer resolves (missing, dangling, ENOTDIR, EACCES). */
export function recordedDiscoveryExecutable(agent: IntegrationAgent, recorded: DiscoveryExecutable): DiscoveryExecutable | null {
  const command = DISCOVERY_RUNTIME_COMMANDS[agent];
  if (!command || recorded.command !== command) throw new Error(`Recorded ${agent} discovery executable names another command`);
  const target = realpathOrNull(recorded.path);
  return target === null ? null : { command, path: recorded.path, target };
}
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
/** Require the currently registered cache's discovery inputs in an explicit
 * review, so retiring an old cache cannot reveal a missing active binding.
 * Hook behavior remains the reviewer's no-skill-injection assessment; this
 * check does not attempt to infer executable behavior from plugin source. */
function assertReviewedClaudeCacheClosures(home: string, config: Record<string, any>, review: ReviewedDiscoveryInputs["agents"][number]): void {
  const enabledIds = Object.entries(config.enabledPlugins ?? {}).filter(([, enabled]) => enabled === true).map(([id]) => id);
  if (enabledIds.length === 0) return;
  const registryPath = join(home, ".claude/plugins/installed_plugins.json");
  const cacheRoot = join(home, ".claude/plugins/cache");
  const registryText = read(registryPath);
  // The registry is needed only to resolve enabled cache-backed registrations.
  // If it is absent there cannot be a cache root to protect in this check;
  // existing reviewed inputs for ordinary/custom discovery remain valid.
  if (registryText === null) return;
  const registry = parseConfig(registryText, registryPath);
  if (registry.version !== 2 || !registry.plugins || typeof registry.plugins !== "object" || Array.isArray(registry.plugins)) throw new Error("Reviewed Claude installed plugin registrations are invalid");
  const cachePath = (path: unknown): path is string => typeof path === "string" && isAbsolute(path)
    && resolve(path) === path && (path === cacheRoot || path.startsWith(cacheRoot + sep));
  const activeRoots = new Set<string>();
  for (const id of enabledIds) {
    const rows = registry.plugins[id];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      if (typeof row.installPath === "string" && (row.installPath === cacheRoot || row.installPath.startsWith(cacheRoot + sep))) {
        if (!cachePath(row.installPath) || row.installPath.length > AGENT_POLICY_LIMITS.pathCharacters
          || row.version !== undefined && (typeof row.version !== "string" || basename(row.installPath) !== row.version)) {
          throw new Error("Reviewed Claude discovery has a malformed active cache registration");
        }
        if (row.scope === "user" && (row.projectPath === undefined || row.projectPath === null)) {
          // valid user installation
        } else if (row.scope === "project" && typeof row.projectPath === "string" && isAbsolute(row.projectPath)
          && resolve(row.projectPath) === row.projectPath && row.projectPath.length <= AGENT_POLICY_LIMITS.pathCharacters) {
          // Each canonical project registration is independently relevant;
          // it may legitimately point at a different cached version.
        } else throw new Error("Reviewed Claude discovery has an unsupported active cache registration scope");
        activeRoots.add(row.installPath);
      }
    }
  }
  if (activeRoots.size === 0) return;
  const registrySource = review.sources.find(source => source.path === registryPath && source.sha256 !== null
    && source.format === undefined && source.fields === undefined && source.managedPlugins === undefined
    && (source.hashMode === undefined || source.hashMode === "bytes"));
  if (!registrySource) throw new Error("Reviewed Claude discovery must bind installed registrations for active cache plugins");
  const reviewedFile = (path: string, manifest = false) => review.sources.some(source => source.path === path && source.sha256 !== null
    && source.format === undefined && source.fields === undefined && source.managedPlugins === undefined
    && (source.hashMode === undefined || source.hashMode === "bytes" || manifest && source.hashMode === "claude-plugin-manifest-v1"));
  const requireSource = (path: string, description: string, manifest = false): void => {
    if (!reviewedFile(path, manifest)) throw new Error(`Reviewed active Claude cache plugin ${description} is not bound`);
  };
  for (const root of activeRoots) {
    safe(root);
    const rootStat = lstatSync(root, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || realpathSync(root) !== root) throw new Error("Reviewed Claude active cache plugin root is missing or unsafe");
    const manifestPath = join(root, ".claude-plugin/plugin.json");
    const manifestStat = lstatSync(manifestPath, { throwIfNoEntry: false });
    let manifest: Record<string, unknown> | undefined;
    if (manifestStat) {
      if (!manifestStat.isFile()) throw new Error("Reviewed active Claude cache plugin manifest is unsupported");
      requireSource(manifestPath, "manifest", true);
      const raw = read(manifestPath);
      if (raw === null) throw new Error("Reviewed Claude active cache plugin manifest is missing");
      manifest = JSON.parse(raw) as Record<string, unknown>;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Reviewed Claude active cache plugin manifest is invalid");
    } else if (!review.sources.some(source => source.path === manifestPath && source.hashMode === "path-bytes" && source.sha256 !== null
      && source.format === undefined && source.fields === undefined && source.managedPlugins === undefined)) {
      throw new Error("Reviewed Claude active cache plugin manifest absence requires a path-bytes witness");
    }
    const roots = new Set([join(root, "skills")]);
    if (lstatSync(join(root, "SKILL.md"), { throwIfNoEntry: false })?.isFile()) roots.add(root);
    const declared = manifest?.skills === undefined ? ["./skills"] : typeof manifest.skills === "string" ? [manifest.skills] : manifest.skills;
    if (!Array.isArray(declared) || declared.some(path => typeof path !== "string")) throw new Error("Reviewed Claude active cache plugin has unsupported skill paths");
    for (const value of declared) {
      const path = resolve(root, value);
      if (path !== root && !path.startsWith(root + sep)) throw new Error("Reviewed Claude active cache plugin skill path escapes its root");
      roots.add(path.endsWith(`${sep}SKILL.md`) ? dirname(path) : path);
    }
    for (const skillRoot of roots) if (!review.roots.includes(skillRoot)) throw new Error("Reviewed Claude active cache plugin skill root is not covered");
    const hooksPath = join(root, "hooks/hooks.json");
    const hooksStat = lstatSync(hooksPath, { throwIfNoEntry: false });
    if (hooksStat) {
      if (!hooksStat.isFile()) throw new Error("Reviewed Claude plugin hook manifest is unsupported");
      requireSource(hooksPath, "hook manifest");
    }
    if (typeof manifest?.hooks === "string") requireSource(resolve(root, manifest.hooks), "manifest-declared hook source");
  }
}
/** Project one native configuration's witnessed fields, exactly as discovery
 * binds them. Used for both the current file and a preserved reviewed preimage. */
export function projectNativeDiscoveryFields(text: string, format: "json" | "toml" | "yaml", fields: readonly string[], path: string): string {
  const object = format === "yaml" ? parseHermesConfig(text) : parseConfig(text, path, format === "toml");
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Expected native discovery configuration object");
  return digest(JSON.stringify(Object.fromEntries(fields.map(field => [field, (object as Record<string, unknown>)[field] ?? null]))));
}
/** A typed settings witness binds the whole configuration file apart from
 * the documented native-owned classes, so it replaces the narrower automatic
 * TOML field projection of the same path. The narrower projection is
 * order-sensitive and therefore not a durable witness for a file Codex itself
 * re-serializes. `resolveAgentDiscovery` must not require it alongside one. */
function isSupersededSettingsProjection(agent: IntegrationAgent, configPath: string, source: DiscoverySource): boolean {
  if (agent === "sumi") return source.path === configPath && source.format === "json" && isDeepStrictEqual(source.fields, [...SUMI_DISCOVERY_PROJECTION_FIELDS]);
  return agent === "codex" && source.path === configPath && source.format === "toml" && isDeepStrictEqual(source.fields, [...CODEX_DISCOVERY_PROJECTION_FIELDS]);
}
function supersedesSettingsProjection(agent: IntegrationAgent, sources: DiscoverySource[], configPath: string): boolean {
  if (agent === "sumi") return sources.some(source => source.path === configPath && source.hashMode === "sumi-settings-v1");
  return agent === "codex" && sources.some(source => source.path === configPath && (source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4")));
}
function projected(source: DiscoverySource, changes?: Map<string, string>, budget = discoveryByteBudget()): string | null {
  if (source.hashMode === "sumi-settings-v1") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Sumi settings witnesses require exact typed metadata");
    const current = captureSumiSettings(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? hashSumiSettingsReplacement(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4"))) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Codex settings witnesses require exact typed metadata");
    const current = (source.hashMode === "codex-settings-v4" ? captureCodexSettingsV4 : source.hashMode === "codex-settings-v3" ? captureCodexSettingsV3 : source.hashMode === "codex-settings-v2" ? captureCodexSettingsV2 : captureCodexSettings)(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (source.hashMode === "codex-settings-v4" ? hashCodexSettingsReplacementV4 : source.hashMode === "codex-settings-v3" ? hashCodexSettingsReplacementV3 : source.hashMode === "codex-settings-v2" ? hashCodexSettingsReplacementV2 : hashCodexSettingsReplacement)(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4"))) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Claude settings witnesses require exact typed metadata");
    const current = (source.hashMode === "claude-settings-v4" ? captureClaudeSettingsV4 : source.hashMode === "claude-settings-v3" ? captureClaudeSettingsV3 : source.hashMode === "claude-settings-v2" ? captureClaudeSettingsV2 : captureClaudeSettings)(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (source.hashMode === "claude-settings-v4" ? hashClaudeSettingsReplacementV4 : source.hashMode === "claude-settings-v3" ? hashClaudeSettingsReplacementV3 : source.hashMode === "claude-settings-v2" ? hashClaudeSettingsReplacementV2 : hashClaudeSettingsReplacement)(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2")) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || changes?.has(source.path)) throw new Error("Claude marketplace witnesses require an exact reviewed registry without synthetic changes");
    const sha256 = (source.hashMode === "claude-marketplace-registry-v2" ? captureClaudeMarketplaceRegistryV2 : captureClaudeMarketplaceRegistry)(source.path, budget).sha256;
    // Hook rendering never writes this registry, so rebinding may not adopt a
    // registration change that appeared after the explicit review was checked.
    if (sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return sha256;
  }
  if (source.hashMode === "claude-marketplace-entry-v1") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || changes?.has(source.path) || !claudeMarketplaceEntrySourceValid(source)) throw new Error("Claude marketplace entry witnesses require an exact reviewed entry without synthetic changes");
    const sha256 = captureClaudeMarketplaceEntry(source.path, source.marketplace!, source.plugin!, budget).sha256;
    // Hook rendering never writes a marketplace catalog, so rebinding may not
    // adopt an entry change that appeared after the explicit review was checked.
    if (sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return sha256;
  }
  if (source.hashMode === "claude-plugin-registry") {
    if (source.format !== undefined || source.fields !== undefined || !source.managedPlugins || changes?.has(source.path)) throw new Error("Managed plugin registry witnesses require verified native registrations");
    return hashManagedPluginRegistry(source.path, source.managedPlugins);
  }
  if (source.hashMode === "claude-plugin-manifest-v1") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || changes?.has(source.path)) throw new Error("Claude plugin manifest witnesses require a native discovery source without synthetic changes");
    const text = read(source.path);
    return text === null ? null : hashClaudePluginManifest(text);
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
function absentCodexSkillRoots(binding:AgentDiscoveryBinding):string[] {
  const controls=binding.codexDisabledPluginSkills;
  if (controls===undefined || Array.isArray(controls) && !controls.length) return [];
  if (binding.agent!=="codex" || !Array.isArray(controls) || controls.length>4096) throw new Error("Invalid disabled Codex discovery proof");
  if (binding.method!=="reviewed" || controls.every(control=>lstatSync(control.pluginParent,{throwIfNoEntry:false}))) return [];
  const cache=dirname(dirname(controls[0]!.pluginParent)), config=join(dirname(dirname(cache)),"config.toml");
  const source=binding.sources.find(source=>source.path===config && source.sha256!==null && source.format===undefined && source.fields===undefined);
  if (!source || projected(source)!==source.sha256) throw new Error("Missing current disabled Codex configuration witness");
  const rules=(Bun.TOML.parse(read(config)!) as any).skills?.config ?? [];
  return [...new Set(controls.map(control=>control.pluginParent))].filter(parent=>!codexDirectHookSelects(cache,parent) && absentDisabledCodexPluginParent(cache,parent,controls,rules));
}
function codexDirectHookSelects(cache:string,root:string):boolean {
  const codex=dirname(dirname(cache)),config=Bun.TOML.parse(read(join(codex,"config.toml")) ?? "") as any;
  const hooks=read(join(codex,"hooks.json"));
  if(hooks!==null) hashNativeJsonControls(hooks);
  return JSON.stringify(config.hooks ?? {}).includes(root) || hooks!==null && JSON.stringify(JSON.parse(hooks)).includes(root);
}
function retiredCodexRoots(binding:AgentDiscoveryBinding):string[] {
  const proof=binding.codexRetiredMaterializations;
  if(proof===undefined) return [];
  const controls=binding.codexDisabledPluginSkills;
  if(binding.agent!=="codex" || binding.method!=="reviewed" || !Array.isArray(controls) || !controls.length
    || !Array.isArray(proof.roots) || proof.roots.length>AGENT_POLICY_LIMITS.discoveryRoots || new Set(proof.roots).size!==proof.roots.length || !Array.isArray(proof.directories)
    || proof.parents!==undefined && (!Array.isArray(proof.parents) || proof.parents.length>AGENT_POLICY_LIMITS.discoveryRoots || new Set(proof.parents).size!==proof.parents.length)
    || !proof.roots.length && !proof.parents?.length) throw new Error("Invalid retired Codex materialization proof");
  const cache=dirname(dirname(controls[0]!.pluginParent)),config=join(dirname(dirname(cache)),"config.toml");
  const source=binding.sources.find(source=>source.path===config && source.sha256!==null && source.format===undefined && source.fields===undefined);
  if(!source || projected(source)!==source.sha256) throw new Error("Missing current retired Codex configuration witness");
  const rules=(Bun.TOML.parse(read(config)!) as any).skills?.config ?? [];
  if((proof.parents ?? []).some(parent=>codexDirectHookSelects(cache,parent) || !reviewedDisabledCodexPluginParent(cache,parent,controls,rules))
    || !reviewedCodexPluginCapabilitiesUnchanged(cache,controls,path=>read(path)!,rules)) throw new Error("Retired Codex parent capabilities changed");
  for(const root of proof.roots) {
    const manifest=binding.sources.find(source=>source.path===join(root,".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined && [undefined,"bytes"].includes(source.hashMode));
    if(!manifest || codexDirectHookSelects(cache,root) || !reviewedRetiredCodexRoot(cache,root,controls,rules,path=>read(path)!,true)) throw new Error("Retired Codex materialization changed");
  }
  return proof.roots;
}
/** Called only after the owning planner validated discovery and capabilities.
 * New roots must already be body-free; absent roots need the prior typed proof. */
export function captureRetiredCodexDiscovery(binding:AgentDiscoveryBinding, controls:CodexPluginSkillControl[], rules:unknown):AgentDiscoveryBinding {
  if(binding.agent!=="codex" || binding.method!=="reviewed" || !controls.length) return binding;
  const cache=dirname(dirname(controls[0]!.pluginParent));
  const candidates=binding.sources.filter(source=>source.path.endsWith(sep+".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined && [undefined,"bytes"].includes(source.hashMode)).map(source=>dirname(dirname(source.path)));
  const roots=[...new Set(candidates)].filter(root=>!codexDirectHookSelects(cache,root) && reviewedRetiredCodexRoot(cache,root,controls,rules,path=>read(path)!,binding.codexRetiredMaterializations?.roots.includes(root) ?? false)).sort();
  const parents=reviewedCodexPluginCapabilitiesUnchanged(cache,controls,path=>read(path)!,rules)
    ? [...new Set(controls.map(control=>control.pluginParent))].filter(parent=>!codexDirectHookSelects(cache,parent) && reviewedDisabledCodexPluginParent(cache,parent,controls,rules)).sort() : [];
  const {codexRetiredMaterializations:previous,...current}=binding;
  if(!roots.length && !parents.length) return current;
  const installation=codexInstallationRoots(binding);
  const directories=(binding.directories ?? []).filter(directory=>!installation.some(root=>directory.path===root || directory.path.startsWith(root+sep) || root.startsWith(directory.path+sep)));
  // A retained review keeps the original membership inventory across cleanup.
  // Recapturing after absence would discard the evidence needed to validate
  // an exact returning graph and would silently adopt a different inventory.
  if(previous && isDeepStrictEqual(previous.roots,roots) && isDeepStrictEqual(previous.parents,parents)
    && isDeepStrictEqual(previous.directories.map(item=>item.path),directories.map(item=>item.path))) return {...current,codexRetiredMaterializations:previous};
  return {...current,codexRetiredMaterializations:{roots,parents,directories:captureDiscoveryDirectoryProjection(directories.map(item=>item.path),roots)}};
}
/** Only full byte witnesses and the installer's full manifest projection may
 * retain their reviewed digest beneath a positively verified absent root. */
function retainableAbsentSource(source: DiscoverySource): boolean {
  if (source.format!==undefined || source.fields!==undefined || source.managedPlugins!==undefined) return false;
  return [undefined,"bytes"].includes(source.hashMode)
    || source.hashMode==="claude-plugin-manifest-v1" && source.sha256!==null
      && source.path.endsWith(join(sep,".claude-plugin","plugin.json"));
}
/** Retain historical witnesses only when the entire old Claude version is absent
 * and unchanged native settings/registry select a different extant user root.
 * No individual missing hook or currently registered root is exempt. */
function absentRetiredClaudeRoots(binding:AgentDiscoveryBinding):string[] {
  if (binding.agent!=="claude" || binding.method!=="reviewed") return [];
  const result=new Set<string>();
  for (const source of binding.sources) {
    if (!retainableAbsentSource(source) || source.sha256===null) continue;
    const marker=sep+".claude"+sep+"plugins"+sep+"cache"+sep, at=source.path.indexOf(marker);
    if (at<0 || source.path.indexOf(marker,at+1)>=0) continue;
    const cache=source.path.slice(0,at+marker.length-1), parts=source.path.slice(at+marker.length).split(sep);
    if (parts.length<4 || parts.slice(0,3).some(part=>!part || part==="." || part==="..")) continue;
    const root=join(cache,...parts.slice(0,3)); safe(root);
    if (lstatSync(root,{throwIfNoEntry:false})) continue;
    const claude=dirname(dirname(cache)), settings=join(claude,"settings.json"), registry=join(claude,"plugins/installed_plugins.json");
    const full=(path:string)=>binding.sources.find(item=>item.path===path && item.sha256!==null && item.format===undefined && item.fields===undefined);
    const configSource=full(settings), registrySource=full(registry);
    if (!configSource || !registrySource || projected(configSource)!==configSource.sha256 || projected(registrySource)!==registrySource.sha256) continue;
    const settingsText=read(settings)!, registryText=read(registry)!;
    hashNativeJsonControls(settingsText);hashNativeJsonControls(registryText);
    const config=JSON.parse(settingsText), installed=JSON.parse(registryText), id=`${parts[1]}@${parts[0]}`;
    if (installed.version!==2 || !installed.plugins || typeof installed.plugins!=="object" || Array.isArray(installed.plugins) || config.enabledPlugins?.[id]!==true) continue;
    // A direct user hook can still select a retired version independently of
    // plugin registration. Keep that active path under the ordinary guard.
    if (JSON.stringify(config.hooks ?? {}).includes(root)) continue;
    const registrationScope=(row:unknown):string|null=>{
      if (!row || typeof row!=="object" || Array.isArray(row)) return null;
      const value=row as Record<string,unknown>;
      if (typeof value.installPath!=="string" || /[\x00-\x1f\x7f]/.test(value.installPath) || !isAbsolute(value.installPath) || resolve(value.installPath)!==value.installPath || value.installPath.length>AGENT_POLICY_LIMITS.pathCharacters) return null;
      if (value.scope==="user") return value.projectPath===undefined || value.projectPath===null ? "user\0" : null;
      if (value.scope==="project") return typeof value.projectPath==="string" && !/[\x00-\x1f\x7f]/.test(value.projectPath) && value.projectPath.length<=AGENT_POLICY_LIMITS.pathCharacters && isAbsolute(value.projectPath) && resolve(value.projectPath)===value.projectPath ? `project\0${value.projectPath}` : null;
      return null;
    };
    // Every registration must still be structurally safe with respect to the
    // retired path, but unrelated plugin scopes are outside this exception.
    if (Object.values(installed.plugins).some(value=>!Array.isArray(value) || value.some(row=>!row || typeof row.installPath!=="string" || row.installPath===root || row.installPath.startsWith(root+sep) || root.startsWith(row.installPath+sep)))) continue;
    const rows=installed.plugins[id];
    if (!Array.isArray(rows) || rows.length<1) continue;
    const targetScopes=new Set<string>(); let targetValid=true;
    for (const row of rows) {
      const scope=registrationScope(row), value=row as Record<string,unknown>|null;
      if (scope===null || targetScopes.has(scope) || value?.installPath!==rows[0]?.installPath || value?.version!==rows[0]?.version) { targetValid=false; break; }
      targetScopes.add(scope);
    }
    if (!targetValid || !targetScopes.has("user\0")) continue;
    const active=rows[0]?.installPath;
    if (typeof active!=="string" || rows[0]?.version!==basename(active) || dirname(active)!==dirname(root) || active===root || !lstatSync(active,{throwIfNoEntry:false})?.isDirectory() || realpathSync(active)!==active) continue;
    const activeManifest=full(join(active,".claude-plugin/plugin.json"));
    if (!activeManifest || projected(activeManifest)!==activeManifest.sha256) continue;
    // Only the target plugin's supported user/project registrations qualify
    // this exception; unrelated native registration scopes remain untouched.
    result.add(root);
  }
  return [...result];
}
export function verifyAgentDiscovery(binding: AgentDiscoveryBinding, codexRecovery?: CodexHookDiscoveryRecovery): void {
  if (codexRecovery) assertCodexHookDiscoveryRecovery(binding, codexRecovery);
  if (!binding || !Array.isArray(binding.sources) || !Array.isArray(binding.roots) || binding.sources.length > AGENT_POLICY_LIMITS.discoverySources || binding.roots.length > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Invalid native discovery binding");
  if (binding.agent === "hermes" && !binding.directories?.length) throw new Error("Hermes discovery requires directory membership coverage; run skills hook install with a fresh discovery review");
  const installationRoots=codexInstallationRoots(binding);
  const retiredRoots=retiredCodexRoots(binding);
  const installationInput=(path:string)=>installationRoots.some(root=>path===root || path.startsWith(root+sep));
  if (binding.directories !== undefined) {
    const projected=binding.codexInstallationInputs?.directories ?? [];
    const ancestors=binding.directories.filter(directory=>installationRoots.some(root=>root.startsWith(directory.path+sep)));
    if (projected.length!==ancestors.length || projected.some(directory=>!ancestors.some(original=>original.path===directory.path))) throw new Error("Missing installation input directory projection");
    const ordinary=binding.directories.filter(directory=>!installationInput(directory.path) && !ancestors.includes(directory));
    if(binding.codexRetiredMaterializations) {
      const projection=binding.codexRetiredMaterializations!.directories;
      if(projection.length!==ordinary.length || projection.some((item,index)=>item.path!==ordinary[index]?.path)) throw new Error("Missing retired Codex directory projection");
      const omitted=[...retiredRoots,...(binding.codexRetiredMaterializations.parents ?? []).filter(parent=>!lstatSync(parent,{throwIfNoEntry:false}))];
      if(projection.every(item=>Array.isArray(item.entries))) verifyDiscoveryDirectoryProjection(projection as DiscoveryDirectoryProjection[],omitted);
      else {
        if(omitted.some(root=>!retiredRoots.includes(root))) throw new Error("Missing reviewed directory membership inventory; provide a fresh discovery review");
        const current=captureDiscoveryDirectoryProjection(ordinary.map(item=>item.path),retiredRoots).map(({entries,...item})=>item);
        if(!isDeepStrictEqual(current,projection)) throw new Error("Native discovery directory membership changed outside retired Codex roots");
      }
    } else verifyDiscoveryDirectories(ordinary);
    verifyDiscoveryDirectories(projected,installationRoots);
  }
  const absentRoots=[...absentCodexSkillRoots(binding),...absentRetiredClaudeRoots(binding),...retiredRoots.filter(root=>!lstatSync(root,{throwIfNoEntry:false}))];
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
    if (absentRoots.some(root=>source.path.startsWith(root+sep)) && retainableAbsentSource(source)) { safe(source.path); continue; }
    const current = projected(source, undefined, budget);
    if (current !== source.sha256 && !verifiesCodexHookDiscoverySource(binding, source, current, codexRecovery)) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
  }
  for (const root of binding.roots) safe(root);
  for (const root of absentRoots) { safe(root); if (lstatSync(root,{throwIfNoEntry:false})) throw new Error("Retired native materialization changed during discovery verification"); }
}
function codexInstallationRoots(binding:AgentDiscoveryBinding):string[] {
  const proof=binding.codexInstallationInputs;
  if (proof===undefined) return [];
  if (binding.agent!=="codex" || binding.method!=="reviewed" || !supportsCodexNativeCapability(proof.version,"installed-plugin-review") || !/^[a-f0-9]{64}$/.test(proof.catalogSha256) || !Array.isArray(proof.plugins) || !proof.plugins.length) throw new Error("Invalid native installation input proof");
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
  if (source.hashMode === "claude-plugin-manifest-v1" && (binding.agent !== "claude" || basename(source.path) !== "plugin.json" || !source.path.endsWith(join(sep, ".claude-plugin", "plugin.json")))) throw new Error("Claude plugin manifest witnesses require Claude plugin discovery");
  if (source.hashMode === "sumi-settings-v1" && (binding.agent !== "sumi" || binding.method !== "reviewed" || basename(source.path) !== "sumi.json")) throw new Error("Sumi settings witnesses require explicit reviewed Sumi configuration");
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4")) && (binding.agent !== "codex" || binding.method !== "reviewed" || basename(source.path) !== "config.toml")) throw new Error("Codex settings witnesses require explicit reviewed Codex configuration");
  if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4")) && (binding.agent !== "claude" || binding.method !== "reviewed" || basename(source.path) !== "settings.json")) throw new Error("Claude settings witnesses require explicit reviewed Claude configuration");
  if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2") && (binding.agent !== "claude" || binding.method !== "reviewed")) throw new Error("Claude marketplace witnesses require explicit reviewed Claude discovery");
  if (source.hashMode === "claude-marketplace-entry-v1" && (binding.agent !== "claude" || binding.method !== "reviewed" || !claudeMarketplaceEntrySourceValid(source))) throw new Error("Claude marketplace entry witnesses require explicit reviewed Claude discovery of one named entry");
}
export function rebindAgentDiscovery(binding: AgentDiscoveryBinding, changes: Map<string, string>): AgentDiscoveryBinding {
  const budget = discoveryByteBudget();
  const installationRoots=codexInstallationRoots(binding), absentRoots=[...absentCodexSkillRoots(binding),...absentRetiredClaudeRoots(binding),...retiredCodexRoots(binding).filter(root=>!lstatSync(root,{throwIfNoEntry:false}))];
  const rebound={ ...binding, sources: binding.sources.map(source => {
    assertMarketplaceBinding(binding, source);
    if (!changes.has(source.path) && (installationRoots.some(root=>source.path.startsWith(root+sep)) || absentRoots.some(root=>source.path.startsWith(root+sep)) && retainableAbsentSource(source))) return source;
    const sha256 = projected(source, changes, budget);
    // Only a planned write may change its witness. Do not adopt source drift
    // between initial validation and hook rendering, including raw witnesses.
    if (!changes.has(source.path) && sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return { ...source, sha256 };
  }) };
  for (const root of absentRoots) { safe(root); if (lstatSync(root,{throwIfNoEntry:false})) throw new Error("Retired native materialization changed during discovery rebinding"); }
  return rebound;
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
        : agent === "opencode" ? ["plugin", "skills"] : agent === "sumi" ? ["plugin", "plugins", "skills", "permissions"] : ["hooks"];
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

/** Re-derive an automatic binding and compare it with the stored one. A
 * mismatch is drift, except when the only difference is a runtime this process
 * cannot resolve: then it is DISCOVERY_ROOT_UNRESOLVED, which stays blocking. */
export function verifyAutomaticDiscoveryClosure(binding: AgentDiscoveryBinding, options: { home: string; canonical: (path: string) => string; change: string; executable?: DiscoveryExecutable }): void {
  const command = DISCOVERY_RUNTIME_COMMANDS[binding.agent], recorded = options.executable;
  // What this process's PATH resolves is what the agent actually runs here.
  const onPath = discoveryExecutable(binding.agent);
  let runtime: DiscoveryExecutable | null, gap: string | undefined;
  if (recorded) {
    // The recorded path is always verified. A PATH that resolves a different
    // runtime shadows the reviewed one: drift. A PATH that resolves none
    // (a narrower PATH) leaves the recorded path as the only witness.
    runtime = recordedDiscoveryExecutable(binding.agent, recorded);
    if (runtime && runtime.target !== recorded.target) throw new Error(`${options.change}: the recorded ${binding.agent} executable now resolves to ${quotedPath(runtime.target)}, not the reviewed ${quotedPath(recorded.target)}`);
    if (onPath && onPath.target !== recorded.target) throw new Error(`${options.change}: the "${command}" on this process's PATH resolves to ${quotedPath(onPath.target)}, not the reviewed ${quotedPath(recorded.target)}`);
    if (!runtime) gap = `the recorded executable ${quotedPath(recorded.path)} no longer resolves. Restore it, or review the change with skills hook install`;
  } else {
    runtime = onPath;
    if (!runtime) gap = "it is not on this process's PATH, and the reviewed policy has no recorded executable path. Run with the PATH used for the review, or run skills hook install there to record it";
  }
  const current = resolveAgentDiscovery({ home: options.home, agent: binding.agent, canonical: options.canonical, executable: runtime });
  if (JSON.stringify(current) === JSON.stringify(binding)) return;
  // The runtime contributed the package and builtin witnesses and names. Only
  // when everything else still matches is the difference the missing runtime.
  const reviewedWithRuntime = (binding.builtinNames?.length ?? 0) > 0 || binding.sources.some(source => basename(source.path) === "package.json");
  const otherwiseCurrent = current.method === binding.method && JSON.stringify(current.roots) === JSON.stringify(binding.roots)
    && JSON.stringify(current.directories) === JSON.stringify(binding.directories)
    && current.sources.every(source => binding.sources.some(saved => isDeepStrictEqual(saved, source)));
  // An unresolvable runtime is an environment gap only when nothing else changed.
  if (command && gap && runtime === null && reviewedWithRuntime && otherwiseCurrent) throw discoveryRootUnresolved(binding.agent, command, gap);
  throw new Error(options.change);
}

/** `executable` is the agent's runtime: omitted, it is resolved through PATH;
 * a value (or null for none) is used as given, so verification never depends
 * on the caller's PATH. */
export function resolveAgentDiscovery(options: { home: string; agent: IntegrationAgent; reviewed?: ReviewedDiscoveryInputs; retainedReview?: AgentDiscoveryBinding; canonical?: (path: string) => string; executable?: DiscoveryExecutable | null }): AgentDiscoveryBinding {
  const canonical = options.canonical ?? resolve, home = resolve(options.home), agent = options.agent;
  const sources: DiscoverySource[] = [], roots = new Set<string>(), builtinNames: string[] = [];
  const witness = (path: string, format?: "json" | "toml" | "yaml", fields?: string[], hashMode?: DiscoverySource["hashMode"]) => {
    const source: DiscoverySource = { path: canonical(path), sha256: null, ...(format ? { format, fields } : {}), ...(hashMode ? { hashMode } : {}) };
    source.sha256 = projected(source); sources.push(source); return read(source.path);
  };
  if (agent === "hermes") assertHermesEnvironment(home);
  const configPath = agentDiscoveryConfigPath(home, agent);
  const configText = witness(configPath, agent === "hermes" ? "yaml" : agent === "codex" ? "toml" : "json", agent === "hermes" ? ["skills", "plugins", "hooks"] : agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces"] : agent === "codex" ? [...CODEX_DISCOVERY_PROJECTION_FIELDS] : agent === "gemini" ? ["skills", "extensions", "security"] : agent === "opencode" ? ["plugin", "skills"] : agent === "sumi" ? [...SUMI_DISCOVERY_PROJECTION_FIELDS] : ["version"]);
  const config: any = configText === null ? {} : agent === "hermes" ? parseHermesConfig(configText) : parseConfig(configText, configPath, agent === "codex");
  const unresolved = (detail: string): never => { throw new Error(`Native discovery is unresolved (${agent}: ${detail}); provide a reviewed --discovery-inputs file`); };
  if (options.reviewed && (options.reviewed.version !== 1 || !Array.isArray(options.reviewed.agents) || options.reviewed.agents.some(item => !item || typeof item !== "object") || new Set(options.reviewed.agents.map(item => item.agent)).size !== options.reviewed.agents.length)) throw new Error("Invalid --discovery-inputs version or agents");
  const review = options.reviewed?.agents.find(item => item.agent === agent);
  if (agent === "sumi") {
    const directory = sumiConfigDirectory(home);
    if (witness(join(directory, "sumi.jsonc")) !== null) unresolved("JSONC configuration requires a supported format adapter");
    for (const root of [directory, join(home, ".claude"), join(home, ".agents")]) for (const name of ["skill", "skills"]) roots.add(canonical(join(root, name)));
    if (config.skills !== undefined && (!Array.isArray(config.skills) || config.skills.some((path: unknown) => typeof path !== "string"))) unresolved("skills must be a string array");
    for (const value of config.skills ?? []) {
      if (typeof value !== "string" || /[\0$]/.test(value) || !value || !(isAbsolute(value) || value.startsWith("~/"))) unresolved("remote or relative skill sources need a dedicated discovery adapter");
      roots.add(canonical(value.startsWith("~/") ? join(home, value.slice(2)) : value));
    }
    for (const key of ["plugin", "plugins"]) if (config[key] !== undefined && !Array.isArray(config[key])) unresolved(`${key} must be an array`);
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
    const executable = options.executable === undefined ? discoveryExecutable(agent) : options.executable;
    if (executable) {
      // Inspect the installed package, never run a client just to discover its
      // bundled skills. A client update changes this source binding.
      let packageRoot: string | undefined;
      for (let directory = dirname(executable.target), depth = 0; depth < 8; directory = dirname(directory), depth++) {
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
    if (retained.sources.some(source => (source.hashMode === "sumi-settings-v1" || source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4")))) && source.path !== canonical(configPath))) unresolved("retained settings witness names another configuration source");
    // A retained typed witness already binds this file more strongly than
    // the order-sensitive TOML projection, so it replaces that projection
    // instead of requiring it again.
    const covered = supersedesSettingsProjection(agent, retained.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededSettingsProjection(agent, canonical(configPath), source))
      : sources;
    if (covered.some(source => !retained.sources.some(saved => isDeepStrictEqual(saved, source)))
      || [...roots].some(root => !retained.roots.includes(root))
      || (agent === "gemini" && JSON.stringify(retained.builtinNames) !== JSON.stringify(builtinNames))) unresolved("retained review is missing current runtime discovery coverage");
    return retained;
  }
  if (review) {
    if (review.pluginHooks !== "reviewed-no-skill-injection" || !Array.isArray(review.sources) || !review.sources.length || !Array.isArray(review.roots)) throw new Error("Discovery review must bind sources and confirm plugin hooks do not inject retired skills");
    const supplied = { agent, roots: review.roots, sources: review.sources, ...(review.directories !== undefined ? { directories: review.directories } : {}), method: "reviewed" as const };
    if (review.sources.some(source => source.format !== undefined || source.fields !== undefined)) throw new Error("Explicit discovery reviews require full source-file hashes");
    verifyAgentDiscovery(supplied);
    if (review.sources.some(source => (source.hashMode === "sumi-settings-v1" || source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4")))) && source.path !== canonical(configPath))) throw new Error("Semantic settings witnesses must name the configured agent configuration source");
    if (!review.sources.some(source => source.path === canonical(configPath))) throw new Error("Discovery review must include the agent configuration source");
    // One witness per file: a reviewed typed witness replaces the
    // automatic projection of the same path rather than being shadowed by it.
    const reviewedSources = supersedesSettingsProjection(agent, review.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededSettingsProjection(agent, canonical(configPath), source))
      : sources;
    const reviewedSourcesWithManifestProjection = review.sources.map(source => {
      // A verified null hash pins absence; retain it so reappearance still fails.
      if (agent !== "claude" || source.sha256 === null || source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined
        || source.hashMode !== undefined && source.hashMode !== "bytes"
        || basename(source.path) !== "plugin.json" || !source.path.endsWith(join(sep, ".claude-plugin", "plugin.json"))) return source;
      const pluginRoot = dirname(dirname(source.path)), hooksPath = join(pluginRoot, "hooks/hooks.json");
      const hookStat = lstatSync(hooksPath, { throwIfNoEntry: false });
      const text = read(source.path);
      if (text === null) throw new Error("Reviewed Claude plugin manifest is missing");
      const manifestSha256 = projectReviewedClaudePluginManifest(text, source.sha256 ?? "");
      const manifest = JSON.parse(text) as Record<string, unknown>;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Reviewed Claude plugin manifest must be an object");
      const reviewedHookPaths = new Set<string>();
      if (hookStat) reviewedHookPaths.add(hooksPath);
      if (manifest.hooks !== undefined) {
        if (typeof manifest.hooks !== "string") throw new Error("Reviewed Claude plugin manifest has an unsupported hooks target");
        const declaredHookPath = resolve(pluginRoot, manifest.hooks);
        if (!declaredHookPath.startsWith(pluginRoot + sep)) throw new Error("Reviewed Claude plugin hooks target escapes its root");
        reviewedHookPaths.add(declaredHookPath);
      }
      for (const hooksFile of reviewedHookPaths) if (!review.sources.some(hook => hook.path === canonical(hooksFile) && hook.sha256 !== null && hook.format === undefined && hook.fields === undefined && hook.managedPlugins === undefined && (hook.hashMode === undefined || hook.hashMode === "bytes"))) throw new Error("Reviewed Claude plugin manifest requires separately reviewed exact hook file sources");
      return { path: source.path, sha256: manifestSha256, hashMode: "claude-plugin-manifest-v1" as const };
    });
    if (agent === "claude") assertReviewedClaudeCacheClosures(home, config, review);
    const combined = [...reviewedSources, ...reviewedSourcesWithManifestProjection];
    const unique = combined.filter((source, index) => combined.findIndex(candidate => isDeepStrictEqual(candidate, source)) === index);
    return { ...supplied, roots: [...new Set([...roots, ...supplied.roots])].sort(), sources: unique, ...(agent === "gemini" ? { builtinNames } : {}) };
  }

  function plugin(root: string): void {
    root = canonical(root); safe(root);
    const manifestPath = join(root, agent === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json");
    const raw = witness(manifestPath, undefined, undefined, agent === "claude" ? "claude-plugin-manifest-v1" : undefined); if (raw === null) unresolved("plugin manifest missing");
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
    if ((config.plugin?.length ?? 0) > 0 || (config.plugins?.length ?? 0) > 0 || sources.some(source => source.path !== canonical(configPath) && source.path !== canonical(join(sumiConfigDirectory(home), "sumi.jsonc")) && source.sha256 !== null)) unresolved("external or foreign local plugins require review");
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
