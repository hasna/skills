import { captureSumiSettings, hashSumiSettingsReplacement, SUMI_DISCOVERY_PROJECTION_FIELDS } from "./sumi-settings-witness.js";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import { createHash } from "node:crypto";
import { lstatSync, opendirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseHermesConfig, assertHermesEnvironment } from "./agent-hermes.js";
import type { IntegrationAgent } from "./agent-adapters.js";
import { captureDiscoveryDirectories, captureDiscoveryDirectoryProjection, verifyDiscoveryDirectoryProjection, verifyDiscoveryDirectories, type DiscoveryDirectory, type DiscoveryDirectoryProjection } from "./agent-discovery-directories.js";
import { discoveryByteBudget, hashRawDiscoveryFile } from "./agent-discovery-bytes.js";
import { pluginExecutableDigest } from "./plugin-projection-store.js";
import { captureCodexSettingsV6, codexSettingsToleratesScreenReaderReceipt, codexSettingsWitnessMatch, type CodexSettingsWitnessMatch } from "./codex-settings-witness.js";
import { captureCodexHookMcpDependencies, type CodexReviewedHookSource } from "./codex-hook-mcp-dependencies.js";
import { hashDiscoveryPathFile } from "./agent-discovery-path-bytes.js";
import { CLAUDE_ORPHAN_MARKER_MODE, hashClaudePluginCacheOrphanMarker, isClaudePluginCacheOrphanMarker } from "./claude-plugin-cache-marker.js";
import { NativeDiscoveryWitnessChange, witnessChanged, type NativeDiscoveryWitnessTolerance } from "./native-discovery-witness-change.js";
import { codexVendorConfigCandidates } from "./codex-vendor-refresh.js";
import { hashClaudePluginManifest, projectReviewedClaudePluginManifest } from "./claude-plugin-manifest-witness.js";
import { hashManagedPluginRegistry, type ManagedPluginRegistrationWitness } from "./plugin-discovery.js";
import { readPluginBinding } from "./plugin-admission.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "./claude-marketplace-registry.js";
import { captureClaudeMarketplaceEntry, claudeMarketplaceEntrySourceValid } from "./claude-marketplace-entry-witness.js";
import { claudeDiscoveryControlKeys, claudeDiscoveryEnvironmentKeys, readNativeDiscoveryWitnessFile, parseNativeJsonObject, hashNativeJsonControls, captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, captureClaudeSettingsV4, captureClaudeSettingsV5, hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3, hashClaudeSettingsReplacementV4, hashClaudeSettingsReplacementV5 } from "./claude-settings-witness.js";
import { assertCodexHookDiscoveryRecovery, verifiesCodexHookDiscoverySource, type CodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4, hashCodexSettingsReplacementV5, captureCodexSettingsV7, hashCodexSettingsReplacementV7, codexDiscoveryControlKeys, CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";
import { narrowedLegacyWitnessMode, type NarrowedWitnessLedger } from "./narrowed-witness-ledger.js";
import { absentDisabledCodexPluginParent, reviewedDisabledCodexPluginParent, reviewedRetiredCodexRoot, reviewedCodexPluginCapabilitiesUnchanged, reviewedCodexPluginSourceRoots, type CodexPluginSkillControl, type CodexPluginSourceInput } from "./codex-plugin-skill-controls.js";
import { sumiConfigDirectory, sumiConfigPath } from "./agent-sumi.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { verifyRetainedReviewArtifact, type RetainedReviewArtifact, type ReviewedArtifact } from "./retained-review-artifacts.js";
import { captureCodexSemanticCacheWitness, assertCodexSemanticCacheWitnessUnchanged, type CodexSemanticCacheWitness, type CodexSemanticCacheAppOnlyParent, type CodexSemanticCacheReviewedHookParent } from "./codex-semantic-cache-witness.js";
export { captureDiscoveryDirectories, type DiscoveryDirectory } from "./agent-discovery-directories.js";

export interface DiscoverySource { reviewArtifact?: RetainedReviewArtifact; path: string; sha256: string | null; hashMode?: "bytes" | "path-bytes" | "claude-plugin-orphaned-at-v1" | "claude-plugin-manifest-v1" | "claude-plugin-registry" | "claude-marketplace-registry" | "claude-settings-v1" | "claude-settings-v2" | "claude-settings-v3" | "claude-settings-v4" | "claude-settings-v5" | "claude-marketplace-registry-v2" | "codex-settings-v1" | "codex-settings-v2" | "codex-settings-v3" | "codex-settings-v4" | "codex-settings-v5" | "codex-settings-v6" | "codex-settings-v7" | "executable-v1" | "sumi-settings-v1" | "claude-marketplace-entry-v1"; hookSources?: CodexReviewedHookSource[]; managedPlugins?: ManagedPluginRegistrationWitness[]; format?: "json" | "toml" | "yaml"; fields?: string[]; marketplace?: string; plugin?: string }
export interface CodexSemanticCacheDiscovery {
  schema: "hasna.codex-semantic-cache-discovery.v1";
  configPath: string;
  hookRootAlias: { alias: string; target: string } | null;
  witness: CodexSemanticCacheWitness;
  appOnlyParents: CodexSemanticCacheAppOnlyParent[];
  reviewedHookParents?: CodexSemanticCacheReviewedHookParent[];
  previousPolicySha256: string;
  supersededSources: DiscoverySource[];
  supersededDirectories: DiscoveryDirectory[];
}
export interface AgentDiscoveryBinding { codexSemanticCache?: CodexSemanticCacheDiscovery; agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; directories?: DiscoveryDirectory[]; method: "automatic" | "reviewed"; builtinNames?: string[]; codexDisabledPluginSkills?: CodexPluginSkillControl[]; codexRetiredMaterializations?: { roots:string[]; parents?:string[]; directories:Array<DiscoveryDirectory & {entries?:string[]}> }; codexInstallationInputs?: { version:string; catalogSha256:string; plugins:CodexPluginSourceInput[]; directories?:DiscoveryDirectory[] } }
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
export interface ReviewedDiscoveryInputs { version: 1; agents: Array<{ agent: IntegrationAgent; roots: string[]; sources: DiscoverySource[]; reviewArtifacts?: ReviewedArtifact[]; directories?: DiscoveryDirectory[]; pluginHooks: "reviewed-no-skill-injection" }> }
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
function assertReviewedClaudeCacheClosures(home: string, config: Record<string, any>, review: ReviewedDiscoveryInputs["agents"][number], canonical: (path: string) => string): void {
  const enabledIds = Object.entries(config.enabledPlugins ?? {}).filter(([, enabled]) => enabled === true).map(([id]) => id);
  if (enabledIds.length === 0) return;
  const registryPath = canonical(join(home, ".claude/plugins/installed_plugins.json"));
  const cacheAliasRoot = join(home, ".claude/plugins/cache");
  const cacheRoot = canonical(cacheAliasRoot);
  const registryText = read(registryPath);
  // The registry is needed only to resolve enabled cache-backed registrations.
  // If it is absent there cannot be a cache root to protect in this check;
  // existing reviewed inputs for ordinary/custom discovery remain valid.
  if (registryText === null) return;
  const registry = parseConfig(registryText, registryPath);
  if (registry.version !== 2 || !registry.plugins || typeof registry.plugins !== "object" || Array.isArray(registry.plugins)) throw new Error("Reviewed Claude installed plugin registrations are invalid");
  const cachePath = (path: unknown): path is string => typeof path === "string" && isAbsolute(path)
    && resolve(path) === path
    && [cacheAliasRoot, cacheRoot].some(root => path === root || path.startsWith(root + sep));
  const activeRoots = new Set<string>();
  for (const id of enabledIds) {
    const rows = registry.plugins[id];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error("Reviewed Claude enabled plugin registrations must be an array");
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.installPath !== "string") {
        throw new Error("Reviewed Claude enabled plugin registration requires an object with an installPath string");
      }
      if ([cacheAliasRoot, cacheRoot].some(root => row.installPath === root || row.installPath.startsWith(root + sep))) {
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
        activeRoots.add(canonical(row.installPath));
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
  return agent === "codex" && sources.some(source => source.path === configPath && (source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" || source.hashMode === "codex-settings-v6" || source.hashMode === "codex-settings-v7")));
}
function projected(source: DiscoverySource, changes?: Map<string, string>, budget = discoveryByteBudget()): string | null {
  if (source.reviewArtifact !== undefined) verifyRetainedReviewArtifact(source);
  if (source.hookSources !== undefined && source.hashMode !== "codex-settings-v6") throw new Error("Hook dependency metadata requires Codex V6");
  if (source.hashMode === CLAUDE_ORPHAN_MARKER_MODE) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || source.reviewArtifact !== undefined) throw new Error("Claude orphan markers require a typed native witness");
    return hashClaudePluginCacheOrphanMarker(source.path, budget, changes);
  }
  if (source.hashMode === "codex-settings-v6") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || !Array.isArray(source.hookSources)) throw new Error("Codex V6 requires exact reviewed hook sources");
    const current = captureCodexSettingsV6(source.path, source.hookSources, budget);
    if (current.sha256 !== source.sha256 || !isDeepStrictEqual(current.hookSources, source.hookSources)) throw new Error("Codex hook provider or dependency changed; explicit discovery review required");
    return changes ? captureCodexSettingsV6(source.path, source.hookSources, budget, changes).sha256 : current.sha256;
  }
  if (source.hashMode === "executable-v1") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || changes?.has(source.path)) throw new Error("Executable discovery witnesses cannot be projected or rewritten");
    return hashReviewedExecutable(source.path, budget);
  }
  if (source.hashMode === "sumi-settings-v1") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Sumi settings witnesses require exact typed metadata");
    const current = captureSumiSettings(source.path, budget).sha256;
    if (current !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? hashSumiSettingsReplacement(changes.get(source.path)!, budget) : current;
  }
  // The narrowed V7 / v5 reviews: an exact digest of the discovery projection,
  // with the same typed-metadata rules and the same verify-before-rebind order.
  if (source.hashMode === "codex-settings-v7" || source.hashMode === "claude-settings-v5") {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Narrowed settings witnesses require exact typed metadata");
    const codex = source.hashMode === "codex-settings-v7";
    const current = (codex ? captureCodexSettingsV7 : captureClaudeSettingsV5)(source.path, budget).sha256;
    if (current !== source.sha256) throw new NativeDiscoveryWitnessChange("input", source.path, `Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (codex ? hashCodexSettingsReplacementV7 : hashClaudeSettingsReplacementV5)(changes.get(source.path)!, budget) : current;
  }
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5"))) {
    if (source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Codex settings witnesses require exact typed metadata");
    // The exact digest, or a document that differs from the reviewed one only by
    // the boolean screen-reader receipt Codex writes on launch. The stored digest
    // keeps its meaning.
    if (codexSettingsWitnessMatch(source.path, source.hashMode, source.sha256, budget) === null) throw new NativeDiscoveryWitnessChange("input", source.path, `Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return changes?.has(source.path) ? (source.hashMode === "codex-settings-v5" ? hashCodexSettingsReplacementV5 : source.hashMode === "codex-settings-v4" ? hashCodexSettingsReplacementV4 : source.hashMode === "codex-settings-v3" ? hashCodexSettingsReplacementV3 : source.hashMode === "codex-settings-v2" ? hashCodexSettingsReplacementV2 : hashCodexSettingsReplacement)(changes.get(source.path)!, budget) : source.sha256;
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
/** Whether the reviewed Codex configuration witness still holds, before its
 * current rules are trusted for a disabled or retired materialization proof. A
 * strict caller sees the same result or error as a direct projection; the live
 * Codex prompt hook's tolerance may accept a provable vendor-refresh change,
 * which only appends disable rules or disables vendor plugins and cannot weaken
 * those proofs. */
/** Whether a full-file settings witness still verifies the current file, or,
 * on a live hook only, the narrowed digest recorded for that exact review is
 * unchanged (narrowed-witness-ledger.ts). Strict callers pass no ledger and see
 * exactly the projection's own result or error. */
function settingsWitnessCurrent(source:DiscoverySource, narrowed?:NarrowedWitnessLedger):boolean {
  try { if (projected(source)===source.sha256) return true; }
  catch (error) { if (narrowed?.accepts(source)) return true; throw error; }
  return narrowed?.accepts(source)===true;
}
function codexConfigWitnessCurrent(source:DiscoverySource, tolerance?:NativeDiscoveryWitnessTolerance, narrowed?:NarrowedWitnessLedger):boolean {
  try { if (projected(source)===source.sha256) return true; }
  catch (error) {
    if (narrowed?.accepts(source)) return true;
    if (!(error instanceof NativeDiscoveryWitnessChange) || error.kind!=="input" || tolerance?.acceptsInput(source)!==true) throw error;
    tolerance.changes.push(error); return true;
  }
  if (narrowed?.accepts(source)) return true;
  if (tolerance?.acceptsInput(source)!==true) return false;
  tolerance.changes.push(new NativeDiscoveryWitnessChange("input",source.path,`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`));
  return true;
}
function absentCodexSkillRoots(binding:AgentDiscoveryBinding, tolerance?:NativeDiscoveryWitnessTolerance, narrowed?:NarrowedWitnessLedger):string[] {
  const controls=binding.codexDisabledPluginSkills;
  if (controls===undefined || Array.isArray(controls) && !controls.length) return [];
  if (binding.agent!=="codex" || !Array.isArray(controls) || controls.length>4096) throw new Error("Invalid disabled Codex discovery proof");
  if (binding.method!=="reviewed" || controls.every(control=>lstatSync(control.pluginParent,{throwIfNoEntry:false}))) return [];
  const cache=dirname(dirname(controls[0]!.pluginParent)), config=join(dirname(dirname(cache)),"config.toml");
  const source=binding.sources.find(source=>source.path===config && source.sha256!==null && source.format===undefined && source.fields===undefined);
  if (!source || !codexConfigWitnessCurrent(source,tolerance,narrowed)) throw new Error("Missing current disabled Codex configuration witness");
  const rules=(Bun.TOML.parse(read(config)!) as any).skills?.config ?? [];
  return [...new Set(controls.map(control=>control.pluginParent))].filter(parent=>!codexDirectHookSelects(cache,parent) && absentDisabledCodexPluginParent(cache,parent,controls,rules));
}
function codexDirectHookSelects(cache:string,root:string,configPath = join(dirname(dirname(cache)), "config.toml")):boolean {
  const codex=dirname(configPath),config=Bun.TOML.parse(read(configPath) ?? "") as any;
  const hooks=read(join(codex,"hooks.json"));
  if(hooks!==null) hashNativeJsonControls(hooks);
  return JSON.stringify(config.hooks ?? {}).includes(root) || hooks!==null && JSON.stringify(JSON.parse(hooks)).includes(root);
}
function retiredCodexRoots(binding:AgentDiscoveryBinding, tolerance?:NativeDiscoveryWitnessTolerance, narrowed?:NarrowedWitnessLedger):string[] {
  const proof=binding.codexRetiredMaterializations;
  if(proof===undefined) return [];
  const controls=binding.codexDisabledPluginSkills;
  if(binding.agent!=="codex" || binding.method!=="reviewed" || !Array.isArray(controls) || !controls.length
    || !Array.isArray(proof.roots) || proof.roots.length>AGENT_POLICY_LIMITS.discoveryRoots || new Set(proof.roots).size!==proof.roots.length || !Array.isArray(proof.directories)
    || proof.parents!==undefined && (!Array.isArray(proof.parents) || proof.parents.length>AGENT_POLICY_LIMITS.discoveryRoots || new Set(proof.parents).size!==proof.parents.length)
    || !proof.roots.length && !proof.parents?.length) throw new Error("Invalid retired Codex materialization proof");
  const cache=dirname(dirname(controls[0]!.pluginParent)),config=join(dirname(dirname(cache)),"config.toml");
  const source=binding.sources.find(source=>source.path===config && source.sha256!==null && source.format===undefined && source.fields===undefined);
  if(!source || !codexConfigWitnessCurrent(source,tolerance,narrowed)) throw new Error("Missing current retired Codex configuration witness");
  const rules=(Bun.TOML.parse(read(config)!) as any).skills?.config ?? [];
  if((proof.parents ?? []).some(parent=>codexDirectHookSelects(cache,parent) || !reviewedDisabledCodexPluginParent(cache,parent,controls,rules))
    || !reviewedCodexPluginCapabilitiesUnchanged(cache,controls,path=>read(path)!,rules)) throw new Error("Retired Codex parent capabilities changed");
  for(const root of proof.roots) {
    const manifest=binding.sources.find(source=>source.path===join(root,".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined && [undefined,"bytes"].includes(source.hashMode));
    if(!manifest || codexDirectHookSelects(cache,root) || !reviewedRetiredCodexRoot(cache,root,controls,rules,path=>read(path)!,true)) throw new Error("Retired Codex materialization changed");
  }
  return proof.roots;
}
/** Codex name reconcile only, after the caller verified that every enrolled
 * plugin parent in `parents` kept its reviewed capability tuple (manifest apart
 * from its version, app, MCP and remote receipt). A stale full-byte witness of a
 * manifest, app or MCP declaration or skill document under one of those parents'
 * version roots is replaced, in its own digest mode, by the same role's file in
 * every current version root. Every other witness is kept unchanged, so any
 * other change still refuses when the rebased binding is verified. */
export function rebaseCodexEnrolledCacheWitnesses(binding: AgentDiscoveryBinding, cache: string, parents: readonly string[], strictlySkillsOnly: (parent: string) => boolean): { binding: AgentDiscoveryBinding; rebased: string[] } {
  if (binding.agent !== "codex" || binding.method !== "reviewed" || binding.codexSemanticCache || !parents.length) return { binding, rebased: [] };
  // Gate: a parent's witnesses move only when the caller's strict capability scan
  // finds nothing beyond its reviewed tuple in every current version root.
  const eligible = parents.filter(parent => strictlySkillsOnly(parent));
  const budget = discoveryByteBudget(), replaced = new Set<string>(), additions = new Map<string, DiscoverySource>();
  const role = (relativeParts: string[]) => [".codex-plugin/plugin.json", ".app.json", ".mcp.json"].includes(relativeParts.join("/"))
    || (relativeParts.length >= 3 && relativeParts[0] === "skills" && relativeParts.at(-1) === "SKILL.md");
  for (const source of binding.sources) {
    if (source.sha256 === null || source.format !== undefined || source.fields !== undefined || source.reviewArtifact !== undefined
      || source.managedPlugins !== undefined || source.hookSources !== undefined || (source.hashMode !== undefined && source.hashMode !== "bytes")) continue;
    const parts = relative(cache, source.path).split(sep);
    if (parts.length < 4 || parts.some(part => !part || part === "." || part === "..")) continue;
    const parent = join(cache, parts[0]!, parts[1]!), relativeParts = parts.slice(3);
    if (!eligible.includes(parent) || !role(relativeParts) || projected(source, undefined, budget) === source.sha256) continue;
    replaced.add(source.path);
    for (const version of readdirSync(parent).sort()) {
      if (version === ".codex-remote-plugin-install.json") continue;
      const root = join(parent, version), path = join(root, ...relativeParts);
      if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || !lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue;
      const fresh: DiscoverySource = { path, sha256: null, ...(source.hashMode ? { hashMode: source.hashMode } : {}) };
      fresh.sha256 = projected(fresh, undefined, budget);
      additions.set(path, fresh);
    }
  }
  if (!replaced.size) return { binding, rebased: [] };
  const sources = binding.sources.filter(source => !replaced.has(source.path));
  const fresh = [...additions.values()].filter(addition => !sources.some(source => source.path === addition.path));
  return { binding: { ...binding, sources: [...sources, ...fresh] }, rebased: [...replaced].sort() };
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
/** The witness class that may keep its reviewed digest beneath a positively
 * verified absent root: a full byte witness, the installer's full manifest
 * projection or a present version-root orphan marker. Null for every other
 * source, which must stay current. */
export type RetainedAbsentWitness = "bytes" | "claude-plugin-manifest-v1" | typeof CLAUDE_ORPHAN_MARKER_MODE;
function retainableAbsentWitness(source: DiscoverySource): RetainedAbsentWitness | null {
  if (source.format!==undefined || source.fields!==undefined || source.managedPlugins!==undefined) return null;
  if ([undefined,"bytes"].includes(source.hashMode)) return "bytes";
  if (source.hashMode==="claude-plugin-manifest-v1" && source.sha256!==null
    && source.path.endsWith(join(sep,".claude-plugin","plugin.json"))) return "claude-plugin-manifest-v1";
  if (source.hashMode===CLAUDE_ORPHAN_MARKER_MODE && source.sha256!==null && isClaudePluginCacheOrphanMarker(source.path)) return CLAUDE_ORPHAN_MARKER_MODE;
  return null;
}
function retainableAbsentSource(source: DiscoverySource): boolean {
  return retainableAbsentWitness(source)!==null;
}
/** The one retention predicate: the absent root that exempts `source`, or
 * undefined. Verification, rebinding and the installer report all use it. */
function retainedAbsentRoot(absentRoots: readonly string[], source: DiscoverySource): string | undefined {
  return retainableAbsentSource(source) ? absentRoots.find(root=>source.path.startsWith(root+sep)) : undefined;
}
/** Retain historical witnesses only when the entire old Claude version is absent
 * and unchanged native settings/registry select a different extant user root.
 * No individual missing hook or currently registered root is exempt. */
function absentRetiredClaudeRoots(binding:AgentDiscoveryBinding, narrowed?:NarrowedWitnessLedger):string[] {
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
    if (!configSource || !registrySource || !settingsWitnessCurrent(configSource,narrowed) || projected(registrySource)!==registrySource.sha256) continue;
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
/** Only native capability locations covered by the complete typed cache census
 * qualify. Historical sources remain stored; arbitrary missing files do not. */
export function codexSemanticCacheSourceRole(source: DiscoverySource, cacheRoot: string, parents: readonly string[], hookParents: readonly string[] = []): boolean {
  if (!isAbsolute(source.path) || resolve(source.path) !== source.path || /[\x00-\x1f\x7f]/.test(source.path)
    || source.format !== undefined || source.fields !== undefined || source.managedPlugins !== undefined || source.reviewArtifact !== undefined
    || source.hashMode !== undefined && source.hashMode !== "bytes") return false;
  const parts = relative(cacheRoot, source.path).split(sep);
  if (parts.length < 3 || !parents.includes(join(cacheRoot, parts[0]!, parts[1]!))) return false;
  const tail = parts.slice(3).join("/");
  const parent = join(cacheRoot, parts[0]!, parts[1]!);
  return parts.length === 5 && tail === ".codex-plugin/plugin.json" && source.sha256 !== null
    || parts.length === 4 && [".app.json", ".mcp.json"].includes(tail) && source.sha256 !== null
    || parts.length === 5 && tail === "hooks/hooks.json" && hookParents.includes(parent) && source.sha256 !== null
    || source.sha256 === null && (parts.length === 4 && tail === "SKILL.md" || parts.length === 5 && tail === "hooks/hooks.json");
}
export function codexSemanticCacheDirectoryRole(path: string, cacheRoot: string): boolean {
  return isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path)
    && (path === cacheRoot || path.startsWith(cacheRoot + sep));
}
export function assertCodexSemanticCacheHookSafety(cacheRoot: string, parents: readonly string[], configPath: string, hookRootAlias: CodexSemanticCacheDiscovery["hookRootAlias"] = null): void {
  const selectionRoots = [cacheRoot, ...parents];
  if (hookRootAlias !== null) {
    if (!hookRootAlias || Object.keys(hookRootAlias).length !== 2
      || [hookRootAlias.alias, hookRootAlias.target].some(path => typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path))
      || hookRootAlias.target !== dirname(configPath) || cacheRoot !== join(hookRootAlias.target, "plugins/cache")
      || !lstatSync(hookRootAlias.alias, { throwIfNoEntry: false })?.isSymbolicLink()
      || realpathSync(hookRootAlias.alias) !== hookRootAlias.target || realpathSync(hookRootAlias.target) !== hookRootAlias.target) throw new Error("Reviewed semantic cache hook alias changed");
    // This mapping only adds forbidden hook-selection spellings. It never
    // authorizes a root, source, alias, or cache projection.
    selectionRoots.push(...selectionRoots.map(root => join(hookRootAlias.alias, relative(hookRootAlias.target, root))));
  }
  // The native hook runner uses a shell. Refuse this direct cache selector
  // conservatively, covering HOME/${HOME}, tilde and relative spellings
  // without evaluating shell code or granting any new projection scope.
  selectionRoots.push("plugins/cache");
  if (selectionRoots.some(parent => codexDirectHookSelects(cacheRoot, parent, configPath))) throw new Error("Direct native hooks select a projected Codex cache input");
}
function verifyCodexSemanticCacheDiscovery(binding: AgentDiscoveryBinding, reviewedRootAliases?: readonly { agent: IntegrationAgent; alias: string; target: string }[], narrowed?: NarrowedWitnessLedger): CodexSemanticCacheDiscovery | undefined {
  const proof = binding.codexSemanticCache;
  if (!proof) return undefined;
  if (reviewedRootAliases !== undefined) {
    const alias = reviewedRootAliases.find(alias => alias.agent === "codex");
    const expected = alias ? { alias: alias.alias, target: alias.target } : null;
    if (!isDeepStrictEqual(proof.hookRootAlias, expected)) throw new Error("Semantic cache hook alias differs from reviewed root binding");
  }
  const controls = binding.codexDisabledPluginSkills;
  if (binding.agent !== "codex" || binding.method !== "reviewed" || !controls?.length
    || proof.schema !== "hasna.codex-semantic-cache-discovery.v1" || !/^[a-f0-9]{64}$/.test(proof.previousPolicySha256)
    || !Array.isArray(proof.appOnlyParents) || !Array.isArray(proof.supersededSources) || !Array.isArray(proof.supersededDirectories)) throw new Error("Invalid Codex semantic cache discovery proof");
  const cacheRoot = proof.witness.cacheRoot;
  if (controls.some(control => dirname(dirname(control.pluginParent)) !== cacheRoot)) throw new Error("Codex semantic cache names another enrolled cache");
  const reviewedHookParents = proof.reviewedHookParents ?? [];
  if (!Array.isArray(reviewedHookParents) || reviewedHookParents.length > 4096
    || reviewedHookParents.some(parent => !parent || !((parent.installation === "remote-receipt"
      && Object.keys(parent).sort().join(",") === "installation,namespace,pluginId,pluginParent,remotePluginId,role"
      && typeof parent.remotePluginId === "string") || (parent.installation === "local-marketplace"
      && Object.keys(parent).sort().join(",") === "installation,marketplaceSha256,marketplaceSourcePath,namespace,pluginId,pluginParent,role"
      && typeof parent.marketplaceSourcePath === "string" && /^[a-f0-9]{64}$/.test(parent.marketplaceSha256 ?? "")))
      || parent.role !== "reviewed-hook" || typeof parent.pluginId !== "string" || typeof parent.namespace !== "string"
      || typeof parent.pluginParent !== "string")
    || new Set(reviewedHookParents.map(parent => parent.pluginParent)).size !== reviewedHookParents.length
    || !isDeepStrictEqual((proof.witness.hookParents ?? []).map(({ manifestSha256: _manifest, hooksSha256: _hooks, receiptSha256: _receipt, ...parent }) => parent), reviewedHookParents)) {
    throw new Error("Invalid reviewed native-hook cache role");
  }
  for (const parent of reviewedHookParents) if (parent.installation === "local-marketplace"
    && !binding.sources.some(source => source.path === parent.marketplaceSourcePath && source.sha256 === parent.marketplaceSha256
      && source.sha256 !== null && source.format === undefined && source.fields === undefined && source.reviewArtifact === undefined
      && (source.hashMode === undefined || source.hashMode === "bytes"))) throw new Error("Local marketplace hook parent lost its enrolled source witness");
  const parents = [...new Set([...controls.map(control => control.pluginParent), ...proof.appOnlyParents.map(parent => parent.pluginParent), ...reviewedHookParents.map(parent => parent.pluginParent)])];
  const hookParentPaths = reviewedHookParents.map(parent => parent.pluginParent);
  const sources = binding.sources.filter(source => codexSemanticCacheSourceRole(source, cacheRoot, parents, hookParentPaths));
  const directories = (binding.directories ?? []).filter(directory => codexSemanticCacheDirectoryRole(directory.path, cacheRoot));
  if (!directories.length || !isDeepStrictEqual(sources, proof.supersededSources) || !isDeepStrictEqual(directories, proof.supersededDirectories)) throw new Error("Codex semantic cache provenance changed");
  const configPath = proof.configPath;
  if (!isAbsolute(configPath) || resolve(configPath) !== configPath || basename(configPath) !== "config.toml" || /[\x00-\x1f\x7f]/.test(configPath)) throw new Error("Invalid semantic cache configuration source");
  const configSource = binding.sources.find(source => source.path === configPath && source.sha256 !== null && source.format === undefined && source.fields === undefined);
  // A live hook accepts a legacy configuration witness whose narrowed review
  // projection is unchanged; the current disable rules and direct hooks are
  // still checked against the cache witness below.
  if (!configSource || !settingsWitnessCurrent(configSource, narrowed)) throw new Error("Codex semantic cache requires unchanged reviewed configuration");
  assertCodexSemanticCacheHookSafety(cacheRoot, parents, configPath, proof.hookRootAlias);
  const rules = parseConfig(read(configPath)!, configPath, true).skills?.config ?? [];
  const current = captureCodexSemanticCacheWitness({ cacheRoot, controls, appOnlyParents: proof.appOnlyParents, reviewedHookParents, rules });
  assertCodexSemanticCacheWitnessUnchanged(proof.witness, current);
  return proof;
}
/** Source-byte and directory-membership drift are NativeDiscoveryWitnessChange
 * errors. Only the live Codex prompt hook passes `witnessTolerance`; a change it
 * accepts as a vendor refresh is collected and the remaining checks still run.
 * Only the live hooks pass `narrowed`: a legacy full-file settings witness that
 * no longer matches is still current when the narrowed digest recorded for it
 * matches (see narrowed-witness-ledger.ts), and a matching one is observed.
 * Every other change and every other failure throws as before. */
export function verifyAgentDiscovery(binding: AgentDiscoveryBinding, codexRecovery?: CodexHookDiscoveryRecovery, reviewedRootAliases?: readonly { agent: IntegrationAgent; alias: string; target: string }[], witnessTolerance?: NativeDiscoveryWitnessTolerance, narrowed?: NarrowedWitnessLedger): void {
  verifyDiscovery(binding, codexRecovery, reviewedRootAliases, witnessTolerance, narrowed);
}

/** Shared verifier. Only root exclusion can omit the already-derived primary
 * configuration; every other source, directory, retirement and semantic proof
 * keeps the native verifier's existing meaning. Native admission never passes
 * this exemption and no binding or witness is rewritten. */
function verifyDiscovery(binding: AgentDiscoveryBinding, codexRecovery?: CodexHookDiscoveryRecovery, reviewedRootAliases?: readonly { agent: IntegrationAgent; alias: string; target: string }[], witnessTolerance?: NativeDiscoveryWitnessTolerance, narrowed?: NarrowedWitnessLedger, rootExclusionConfig?: string): void {
  if (codexRecovery) assertCodexHookDiscoveryRecovery(binding, codexRecovery);
  if (!binding || !Array.isArray(binding.sources) || !Array.isArray(binding.roots) || binding.sources.length > AGENT_POLICY_LIMITS.discoverySources || binding.roots.length > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Invalid native discovery binding");
  if (binding.agent === "hermes" && !binding.directories?.length) throw new Error("Hermes discovery requires directory membership coverage; run skills hook install with a fresh discovery review");
  const semanticCache = verifyCodexSemanticCacheDiscovery(binding, reviewedRootAliases, narrowed);
  const semanticDirectory = (path: string) => Boolean(semanticCache && codexSemanticCacheDirectoryRole(path, semanticCache.witness.cacheRoot));
  const installationRoots=codexInstallationRoots(binding);
  const retiredRoots=retiredCodexRoots(binding,witnessTolerance,narrowed);
  const installationInput=(path:string)=>installationRoots.some(root=>path===root || path.startsWith(root+sep));
  if (binding.directories !== undefined) {
    const projected=binding.codexInstallationInputs?.directories ?? [];
    const ancestors=binding.directories.filter(directory=>installationRoots.some(root=>root.startsWith(directory.path+sep)));
    if (projected.length!==ancestors.length || projected.some(directory=>!ancestors.some(original=>original.path===directory.path))) throw new Error("Missing installation input directory projection");
    const ordinary=binding.directories.filter(directory=>!installationInput(directory.path) && !ancestors.includes(directory) && !semanticDirectory(directory.path));
    if(binding.codexRetiredMaterializations) {
      const projection=binding.codexRetiredMaterializations!.directories.filter(directory => !semanticDirectory(directory.path));
      if(projection.length!==ordinary.length || projection.some((item,index)=>item.path!==ordinary[index]?.path)) throw new Error("Missing retired Codex directory projection");
      const omitted=[...retiredRoots,...(binding.codexRetiredMaterializations.parents ?? []).filter(parent=>!lstatSync(parent,{throwIfNoEntry:false}))];
      if(projection.every(item=>Array.isArray(item.entries))) verifyDiscoveryDirectoryProjection(projection as DiscoveryDirectoryProjection[],omitted,witnessTolerance);
      else {
        if(omitted.some(root=>!retiredRoots.includes(root))) throw new Error("Missing reviewed directory membership inventory; provide a fresh discovery review");
        const current=captureDiscoveryDirectoryProjection(ordinary.map(item=>item.path),retiredRoots).map(({entries,...item})=>item);
        if(!isDeepStrictEqual(current,projection)) {
          const changed=projection.filter((item,index)=>!isDeepStrictEqual(current[index],item));
          for (const item of changed.length && current.length===projection.length ? changed : [null]) witnessChanged(new NativeDiscoveryWitnessChange("membership",item?.path ?? null,"Native discovery directory membership changed outside retired Codex roots"),witnessTolerance,item!==null && witnessTolerance?.acceptsMembership(item.path)===true);
        }
      }
    } else verifyDiscoveryDirectories(ordinary,[],witnessTolerance);
    verifyDiscoveryDirectories(projected,installationRoots,witnessTolerance);
  }
  const absentRoots=[...absentCodexSkillRoots(binding,witnessTolerance,narrowed),...absentRetiredClaudeRoots(binding,narrowed),...retiredRoots.filter(root=>!lstatSync(root,{throwIfNoEntry:false}))];
  const budget = discoveryByteBudget();
  for (const source of binding.sources) {
    assertMarketplaceBinding(binding, source);
    if (source.hashMode === "claude-plugin-registry" && binding.agent !== "claude") throw new Error("Managed Claude registry witnesses cannot apply to another agent");
    if (source.format !== undefined && (!["json", "toml", "yaml"].includes(source.format) || !Array.isArray(source.fields) || !source.fields.length || source.fields.length > 64 || source.fields.some(field => typeof field !== "string" || !field))) throw new Error("Invalid native discovery projection");
    if (source.sha256 !== null && !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid native discovery digest");
    if (rootExclusionConfig !== undefined && source.path === rootExclusionConfig) { safe(source.path); continue; }
    if (semanticCache?.supersededSources.some(previous => isDeepStrictEqual(previous, source))) { safe(source.path); continue; }
    // Preserve the original full inventory witness as evidence, while the
    // positively attested installation role binds current source identity.
    // These bodies/directories are not native loading inputs.
    if (installationInput(source.path)) { safe(source.path); continue; }
    if (retainedAbsentRoot(absentRoots, source)!==undefined) { safe(source.path); continue; }
    let current: string | null;
    try { current = projected(source, undefined, budget); }
    catch (error) {
      // A legacy settings witness whose narrowed review projection is unchanged.
      if (narrowed?.accepts(source)) continue;
      // A typed settings witness reports its own input change from projected().
      if (!(error instanceof NativeDiscoveryWitnessChange) || error.kind !== "input") throw error;
      witnessChanged(error, witnessTolerance, witnessTolerance?.acceptsInput(source) === true);
      continue;
    }
    if (current === source.sha256) { narrowed?.observe(source); continue; }
    if (!verifiesCodexHookDiscoverySource(binding, source, current, codexRecovery) && !narrowed?.accepts(source)) witnessChanged(new NativeDiscoveryWitnessChange("input", source.path, `Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`), witnessTolerance, witnessTolerance?.acceptsInput(source) === true);
  }
  for (const root of binding.roots) safe(root);
  for (const root of absentRoots) { safe(root); if (lstatSync(root,{throwIfNoEntry:false})) throw new Error("Retired native materialization changed during discovery verification"); }
}
/** Witness modes and native files the retained-root rule itself reads. They
 * are never retained, whatever the rule says, so they are always checked. */
const CLAUDE_CONTROL_WITNESS_MODES: ReadonlySet<string> = new Set(["claude-settings-v1", "claude-settings-v2", "claude-settings-v3", "claude-settings-v4", "claude-settings-v5", "claude-marketplace-registry", "claude-marketplace-registry-v2", "claude-marketplace-entry-v1", "claude-plugin-registry"]);
const CLAUDE_CONTROL_FILES: ReadonlySet<string> = new Set(["settings.json", "settings.local.json", "installed_plugins.json", "known_marketplaces.json"]);
function claudeControlSource(source: DiscoverySource): boolean {
  return CLAUDE_CONTROL_WITNESS_MODES.has(source.hashMode ?? "")
    || CLAUDE_CONTROL_FILES.has(basename(source.path)) && !source.path.includes(`${sep}.claude${sep}plugins${sep}cache${sep}`);
}
/** The absent retired Claude version root that retains `source`, or undefined:
 * the retention predicate verification applies, never for a control source.
 * The installer report and an explicit review both use it, so a source one of
 * them retains is retained by the other. */
function retainedAbsentClaudeRoot(absentRoots: readonly string[], source: DiscoverySource): string | undefined {
  return claudeControlSource(source) ? undefined : retainedAbsentRoot(absentRoots, source);
}
/** One stored Claude discovery source as an installer sees it. */
export type ClaudeDiscoverySourceVerdict =
  | { status: "current" }
  | { status: "retained-absent"; root: string; witness: RetainedAbsentWitness }
  | { status: "drift"; reason: "MISSING" | "APPEARED" | "CHANGED" | "MARKER_INVALID" | "REFUSED" };
/** Read-only, per-source report on a stored Claude discovery binding, in
 * stored order. A source is retained only through the same absent retired
 * version rule and predicate verifyAgentDiscovery applies; a refused rule
 * retains nothing. Every other source is checked by its own witness, exactly
 * as verification checks it (a typed orphan marker by the marker predicate).
 * This report never accepts a binding by itself: a caller must also require
 * verifyAgentDiscovery to accept the same binding. */
export function classifyClaudeDiscoverySources(binding: AgentDiscoveryBinding): ClaudeDiscoverySourceVerdict[] {
  if (!binding || binding.agent !== "claude" || !Array.isArray(binding.sources)) throw new Error("Invalid Claude discovery binding");
  let absentRoots: string[];
  try { absentRoots = absentRetiredClaudeRoots(binding); } catch { absentRoots = []; }
  // A present file the witness refuses is CHANGED: typed settings refuse any
  // change. A typed orphan marker accepts every valid timestamp, so its refusal
  // is MARKER_INVALID (not a regular, user-owned 13-digit timestamp file).
  const drift = (source: DiscoverySource, refused: boolean): ClaudeDiscoverySourceVerdict => {
    try {
      if (!lstatSync(source.path, { throwIfNoEntry: false })) return { status: "drift", reason: "MISSING" };
      return { status: "drift", reason: refused && source.hashMode === CLAUDE_ORPHAN_MARKER_MODE ? "MARKER_INVALID" : "CHANGED" };
    } catch { return { status: "drift", reason: "REFUSED" }; }
  };
  const budget = discoveryByteBudget();
  return binding.sources.map((source): ClaudeDiscoverySourceVerdict => {
    const root = retainedAbsentClaudeRoot(absentRoots, source);
    if (root !== undefined) return { status: "retained-absent", root, witness: retainableAbsentWitness(source)! };
    let current: string | null;
    try { current = projected(source, undefined, budget); }
    catch { return drift(source, true); }
    if (current === source.sha256) return { status: "current" };
    return source.sha256 === null ? { status: "drift", reason: "APPEARED" } : drift(source, false);
  });
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
  if (source.hashMode === CLAUDE_ORPHAN_MARKER_MODE && (binding.agent !== "claude" || binding.method !== "reviewed" || !isClaudePluginCacheOrphanMarker(source.path))) throw new Error("Claude orphan markers require reviewed Claude plugin-cache discovery");
  if (source.hashMode === "executable-v1" && (binding.agent !== "codex" || binding.method !== "reviewed" || !binding.sources.some(row => row.hashMode === "codex-settings-v6"))) throw new Error("Provider executable witnesses require explicit reviewed Codex V6");
  if (source.hashMode === "codex-settings-v6" && (new Set(binding.sources.map(row => row.path)).size !== binding.sources.length || !Array.isArray(source.hookSources) || source.hookSources.some(hook => !binding.sources.some(row => row.path === hook.path && row.sha256 === hook.sha256 && [undefined, "bytes"].includes(row.hashMode) && row.format === undefined && row.fields === undefined)))) throw new Error("Missing independently reviewed Codex hook source population");

  if (source.hashMode === "claude-plugin-manifest-v1" && (binding.agent !== "claude" || basename(source.path) !== "plugin.json" || !source.path.endsWith(join(sep, ".claude-plugin", "plugin.json")))) throw new Error("Claude plugin manifest witnesses require Claude plugin discovery");
  if (source.hashMode === "sumi-settings-v1" && (binding.agent !== "sumi" || binding.method !== "reviewed" || basename(source.path) !== "sumi.json")) throw new Error("Sumi settings witnesses require explicit reviewed Sumi configuration");
  if ((source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" || source.hashMode === "codex-settings-v6" || source.hashMode === "codex-settings-v7")) && (binding.agent !== "codex" || binding.method !== "reviewed" || basename(source.path) !== "config.toml")) throw new Error("Codex settings witnesses require explicit reviewed Codex configuration");
  if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4" || source.hashMode === "claude-settings-v5")) && (binding.agent !== "claude" || binding.method !== "reviewed" || basename(source.path) !== "settings.json")) throw new Error("Claude settings witnesses require explicit reviewed Claude configuration");
  if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2") && (binding.agent !== "claude" || binding.method !== "reviewed")) throw new Error("Claude marketplace witnesses require explicit reviewed Claude discovery");
  if (source.hashMode === "claude-marketplace-entry-v1" && (binding.agent !== "claude" || binding.method !== "reviewed" || !claudeMarketplaceEntrySourceValid(source))) throw new Error("Claude marketplace entry witnesses require explicit reviewed Claude discovery of one named entry");
}
/** Typed settings classifications a planned write may adopt into the reviewed baseline. */
const ADOPTABLE_SETTINGS_MATCHES: readonly CodexSettingsWitnessMatch[] = Object.freeze(["exact", "screen-reader-receipt"]);
export function rebindAgentDiscovery(binding: AgentDiscoveryBinding, changes: Map<string, string>): AgentDiscoveryBinding {
  const semanticCache = verifyCodexSemanticCacheDiscovery(binding);
  const budget = discoveryByteBudget();
  const installationRoots=codexInstallationRoots(binding), absentRoots=[...absentCodexSkillRoots(binding),...absentRetiredClaudeRoots(binding),...retiredCodexRoots(binding).filter(root=>!lstatSync(root,{throwIfNoEntry:false}))];
  const rebound={ ...binding, sources: binding.sources.map(source => {
    assertMarketplaceBinding(binding, source);
    if (semanticCache?.supersededSources.some(previous => isDeepStrictEqual(previous, source))) {
      if (changes.has(source.path)) throw new Error("Codex semantic cache sources cannot be written by hook rendering");
      return source;
    }
    if (!changes.has(source.path) && (installationRoots.some(root=>source.path.startsWith(root+sep)) || retainedAbsentRoot(absentRoots, source)!==undefined)) return source;
    const sha256 = projected(source, changes, budget);
    // Only a planned write may change its witness. Do not adopt source drift
    // between initial validation and hook rendering, including raw witnesses.
    if (!changes.has(source.path) && !(source.hashMode === "codex-settings-v6" && source.hookSources!.some(hook => changes.has(hook.path))) && sha256 !== source.sha256) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    // A planned write rebinds a typed V1-V5 witness to the written document,
    // so a difference the witness only tolerated is adopted with it. Allow only
    // the boolean screen-reader receipt; any future tolerance needs a fresh
    // review before adoption. Application re-checks the exact preimage, so the
    // adopted base is the document classified here.
    if (changes.has(source.path) && (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5")
      && !ADOPTABLE_SETTINGS_MATCHES.includes(codexSettingsWitnessMatch(source.path, source.hashMode, source.sha256!, budget) as CodexSettingsWitnessMatch)) throw new Error(`Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`);
    return source.hashMode === "codex-settings-v6"
      ? { ...source, ...captureCodexSettingsV6(source.path, source.hookSources!, budget, changes) } : { ...source, sha256 };
  }) };
  for (const root of absentRoots) { safe(root); if (lstatSync(root,{throwIfNoEntry:false})) throw new Error("Retired native materialization changed during discovery rebinding"); }
  return rebound;
}

function hashReviewedExecutable(path: string, budget: { remaining: number }): string {
  const before = lstatSync(path, { bigint: true });
  if (before.size < 0n || before.size > BigInt(budget.remaining)) throw new Error("Discovery aggregate executable byte limit exceeded");
  const digest = pluginExecutableDigest(path).slice(7);
  const after = lstatSync(path, { bigint: true });
  for (const key of ["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"] as const) {
    if (before[key] !== after[key]) throw new Error("Discovery executable changed during budgeted capture");
  }
  budget.remaining -= Number(before.size);
  return digest;
}
/** Explicit streaming integrity witness. Never read an executable as text or execute it. */
export function captureDiscoveryExecutableSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid executable discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => ({ path, hashMode: "executable-v1", sha256: hashReviewedExecutable(path, budget) }));
}

/** Capture exact source bytes, or typed Claude cache marker presence; never execute them. */
export function captureDiscoveryByteSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid raw discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => isClaudePluginCacheOrphanMarker(path)
    ? { path, hashMode: CLAUDE_ORPHAN_MARKER_MODE, sha256: hashClaudePluginCacheOrphanMarker(path, budget) }
    : { path, hashMode: "bytes", sha256: hashRawDiscoveryFile(path, budget) });
}

/** Capture executable/source path identity, including links and absent targets. */
export function captureDiscoveryPathSources(paths: string[]): DiscoverySource[] {
  if (!Array.isArray(paths) || paths.length > AGENT_POLICY_LIMITS.discoverySources || new Set(paths).size !== paths.length) throw new Error("Invalid path discovery source collection");
  const budget = discoveryByteBudget();
  return paths.map(path => isClaudePluginCacheOrphanMarker(path)
    ? { path, hashMode: CLAUDE_ORPHAN_MARKER_MODE, sha256: hashClaudePluginCacheOrphanMarker(path, budget) }
    : { path, hashMode: "path-bytes", sha256: hashDiscoveryPathFile(path, budget) });
}

/** Top-level keys whose presence, at any value, makes a project Claude settings
 * file a higher-precedence discovery source that needs review. Claude 2.1.300
 * rewrites `additionalMarketplaces` into `extraKnownMarketplaces` on every
 * settings read, including local settings, so the alias counts as well. */
export const CLAUDE_PROJECT_DISCOVERY_KEYS = Object.freeze(["enabledPlugins", "extraKnownMarketplaces", "additionalMarketplaces", "skillOverrides"] as const);

/** Project settings can introduce a higher-precedence discovery source. Until
 * its native merge format is supported, refuse that layer rather than certify
 * the home-only inventory. Ordinary unrelated project settings remain usable. */
export function assertProjectDiscovery(agent: IntegrationAgent, directories: string[], home: string, canonical: (path: string) => string = resolve, reviewed?: AgentDiscoveryBinding): void {
  const homeConfigPath = canonical(agentDiscoveryConfigPath(home, agent));
  const v6 = agent === "codex" && reviewed?.agent === "codex" && reviewed.method === "reviewed"
    ? reviewed.sources.find(source => source.hashMode === "codex-settings-v6" && source.path === homeConfigPath) : undefined;
  // Derive the union from the exact enrolled hook population, never a caller's
  // shorter server allowlist. Higher precedence project overrides are outside
  // this home witness; unrelated ordinary MCP configuration remains usable.
  const referenced = v6 ? new Set(captureCodexHookMcpDependencies(v6.path, v6.hookSources!).servers) : undefined;
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
      if (referenced) {
        const declaredHooks = config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks) || Object.keys(config.hooks).some(key => key !== "state"));
        const providerOverride = config.mcp_servers !== undefined && (!config.mcp_servers || typeof config.mcp_servers !== "object" || Array.isArray(config.mcp_servers) || Object.keys(config.mcp_servers).some(name => referenced.has(name)));
        if (declaredHooks || providerOverride) throw new Error(`NATIVE_SKILL_DRIFT: higher-precedence project hook dependency requires review: ${path}`);
      }
      const keys: readonly string[] = agent === "claude" ? CLAUDE_PROJECT_DISCOVERY_KEYS
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
    if (referenced) {
      const path = canonical(join(directory, ".codex/hooks.json"));
      if (path !== canonical(join(dirname(homeConfigPath), "hooks.json"))) {
        const raw = read(path);
        if (raw !== null) {
          const hooks: any = parseConfig(raw, path, false);
          const empty = hooks && typeof hooks === "object" && !Array.isArray(hooks)
            && Object.keys(hooks).every(key => ["description", "hooks"].includes(key))
            && (hooks.description === undefined || hooks.description === null || typeof hooks.description === "string")
            && (hooks.hooks === undefined || hooks.hooks && typeof hooks.hooks === "object" && !Array.isArray(hooks.hooks) && Object.keys(hooks.hooks).length === 0);
          if (!empty) throw new Error(`NATIVE_SKILL_DRIFT: higher-precedence project hook dependency requires review: ${path}`);
        }
      }
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
 * cannot resolve: then it is DISCOVERY_ROOT_UNRESOLVED, which stays blocking.
 * Only the live Codex prompt hook passes `witnessTolerance`: when roots, method
 * and every source and directory path are unchanged, only witness digests differ
 * and the tolerance accepts every one of them, they are collected instead of
 * refusing. */
export function verifyAutomaticDiscoveryClosure(binding: AgentDiscoveryBinding, options: { home: string; canonical: (path: string) => string; change: string; executable?: DiscoveryExecutable; witnessTolerance?: NativeDiscoveryWitnessTolerance }): void {
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
  if (options.witnessTolerance && collectAutomaticWitnessChanges(binding, current, options.witnessTolerance)) return;
  throw new Error(options.change);
}
/** True, with the changed witnesses collected, only when the re-derived binding
 * has the stored shape exactly (method, roots, builtin names and every source
 * and directory path, format and mode), differs only in witness digests and the
 * tolerance accepts every changed witness. Nothing is collected otherwise. */
function collectAutomaticWitnessChanges(binding: AgentDiscoveryBinding, current: AgentDiscoveryBinding, tolerance: NativeDiscoveryWitnessTolerance): boolean {
  const shape = (value: AgentDiscoveryBinding) => JSON.stringify({ ...value, sources: value.sources.map(source => ({ ...source, sha256: null })), ...(value.directories ? { directories: value.directories.map(directory => ({ ...directory, sha256: null })) } : {}) });
  if (shape(current) !== shape(binding)) return false;
  const changes: NativeDiscoveryWitnessChange[] = [];
  for (const [index, source] of binding.sources.entries()) {
    if (current.sources[index]!.sha256 === source.sha256) continue;
    if (!tolerance.acceptsInput(source)) return false;
    changes.push(new NativeDiscoveryWitnessChange("input", source.path, `Native discovery input changed; run skills hook install with a fresh discovery review: ${source.path}`));
  }
  for (const [index, directory] of (binding.directories ?? []).entries()) {
    if (current.directories![index]!.sha256 === directory.sha256) continue;
    if (!tolerance.acceptsMembership(directory.path)) return false;
    changes.push(new NativeDiscoveryWitnessChange("membership", directory.path, `Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${directory.path}`));
  }
  tolerance.changes.push(...changes);
  return true;
}

/** True only when the changed Codex config.toml differs from its reviewed
 * witness by appended vendor disable rows and/or vendor plugin disables:
 * removing those entries or restoring a formerly enabled vendor flag reproduces
 * the stored digest. Witness modes
 * without a replacement digest (V6, artifacts, managed registries) stay strict. */
export function codexVendorConfigChangeOnly(source: DiscoverySource, cache: string): boolean {
  try {
    if (basename(source.path) !== "config.toml" || typeof source.sha256 !== "string" || source.reviewArtifact !== undefined || source.managedPlugins !== undefined || source.hookSources !== undefined) return false;
    const text = read(source.path);
    if (text === null) return false;
    // Typed V2-V5 settings digests already exclude disable-only rows, so row
    // removal cannot change them; skipping it only narrows the search.
    const rowsAffectDigest = !["codex-settings-v2", "codex-settings-v3", "codex-settings-v4", "codex-settings-v5", "codex-settings-v7"].includes(source.hashMode ?? "");
    // A vendor refresh can coincide with the screen-reader receipt a typed
    // witness tolerates everywhere; prove the remainder under that same tolerance.
    const typed = source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" ? source.hashMode : undefined;
    return codexVendorConfigCandidates(text, cache, { rowsAffectDigest }).some(candidate => replacementDigest(source, candidate) === source.sha256
      || typed !== undefined && codexSettingsToleratesScreenReaderReceipt(candidate, typed, source.sha256!));
  } catch { return false; }
}
/** The digest a source's own mode would record for `text`, without consulting the file. */
function replacementDigest(source: DiscoverySource, text: string): string | null {
  const budget = discoveryByteBudget();
  if (source.hashMode === undefined) return source.format ? projectNativeDiscoveryFields(text, source.format, source.fields ?? [], source.path) : digest(text);
  if (source.format !== undefined || source.fields !== undefined) return null;
  if (source.hashMode === "bytes") return hashRawDiscoveryFile(source.path, budget, new Map([[source.path, text]]));
  if (source.hashMode === "codex-settings-v1") return hashCodexSettingsReplacement(text, budget);
  if (source.hashMode === "codex-settings-v2") return hashCodexSettingsReplacementV2(text, budget);
  if (source.hashMode === "codex-settings-v3") return hashCodexSettingsReplacementV3(text, budget);
  if (source.hashMode === "codex-settings-v4") return hashCodexSettingsReplacementV4(text, budget);
  if (source.hashMode === "codex-settings-v5") return hashCodexSettingsReplacementV5(text, budget);
  if (source.hashMode === "codex-settings-v7") return hashCodexSettingsReplacementV7(text, budget);
  return null;
}
/** Whether replacing `path` with `text` leaves every recorded witness of it
 * satisfied, judged by each source's own digest mode without touching the file,
 * with the same screen-reader receipt tolerance typed V1-V5 verification applies.
 * Fails closed: a review artifact, managed-plugin or hook-source witness, a
 * semantic cache binding of the file, or an unsupported mode counts as changed. */
export function discoveryTextKeepsWitness(binding: Pick<AgentDiscoveryBinding, "sources" | "codexSemanticCache">, path: string, text: string): boolean {
  if (binding.codexSemanticCache?.configPath === path) return false;
  return binding.sources.filter(source => source.path === path).every(source => {
    if (source.reviewArtifact !== undefined || source.managedPlugins !== undefined || source.hookSources !== undefined || typeof source.sha256 !== "string") return false;
    const typed = source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" ? source.hashMode : undefined;
    try { return replacementDigest(source, text) === source.sha256 || typed !== undefined && codexSettingsToleratesScreenReaderReceipt(text, typed, source.sha256); } catch { return false; }
  });
}

/** `executable` is the agent's runtime: omitted, it is resolved through PATH;
 * a value (or null for none) is used as given, so verification never depends
 * on the caller's PATH. */
type DiscoveryOptions = { home: string; agent: IntegrationAgent; reviewed?: ReviewedDiscoveryInputs; retainedReview?: AgentDiscoveryBinding; canonical?: (path: string) => string; executable?: DiscoveryExecutable | null };
export function resolveAgentDiscovery(options: DiscoveryOptions): AgentDiscoveryBinding {
  return resolveDiscovery(options);
}

/** Read-only exclusion, not native admission. Retained roots remain excluded,
 * while current supported controls are re-derived even when old settings or
 * directory witnesses are stale. Non-enumerable executable inputs still need
 * their existing review. No witness, policy or enrollment is written. */
export function resolveAgentDiscoveryExclusionRoots(options: Omit<DiscoveryOptions, "reviewed" | "retainedReview"> & { retained?: AgentDiscoveryBinding; narrowed?: NarrowedWitnessLedger; nativeHome?: string }): readonly string[] {
  if (options.nativeHome !== undefined && (!["claude", "codex"].includes(options.agent) || !isAbsolute(options.nativeHome))) throw new Error("Unsupported native discovery exclusion home");
  const current = resolveDiscovery(options, options);
  const roots = [...new Set([...(options.retained?.roots ?? []), ...current.roots])];
  if (roots.length > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Native discovery exclusion roots exceed their bound");
  return roots;
}

/** Metadata-only closure of aliases inside the selected native discovery
 * trees. Never search the account generally or load a payload/plugin. Each
 * resolved alias remains excluded while unrelated portable paths stay usable. */
export function nativeDiscoveryAliasTargets(roots: readonly string[], home: string): string[] {
  const targets = new Set<string>(), visited = new Set<string>();
  let remaining = AGENT_POLICY_LIMITS.discoveryDirectoryEntries;
  const queue = roots.map(path => ({ path, parents: [] as string[] }));
  for (let index = 0; index < queue.length; index++) {
    const { path, parents } = queue[index]!;
    if (path.length > AGENT_POLICY_LIMITS.pathCharacters || parents.length > AGENT_POLICY_LIMITS.discoveryPathSteps || --remaining < 0) throw new Error("Native discovery alias enumeration exceeds its bound");
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info) { if (parents.length) throw new Error(`Native discovery alias input disappeared: ${path}`); continue; }
    const physical = realpathSync(path);
    if (info.isSymbolicLink()) targets.add(physical);
    if (targets.size > AGENT_POLICY_LIMITS.discoveryRoots) throw new Error("Native discovery alias roots exceed their bound");
    if (parents.includes(physical)) throw new Error(`Native discovery alias cycle: ${path}`);
    if (visited.has(physical)) continue;
    visited.add(physical);
    const resolved = lstatSync(physical);
    if (!resolved.isDirectory()) continue;
    // Such a link makes account-wide traversal possible. Refuse it rather
    // than scanning the account or mistaking a bounded prefix for closure.
    const account = realpathSync(home);
    if (physical === dirname(physical) || account === physical || account.startsWith(physical + sep)) throw new Error(`Native discovery alias expands to an account ancestor: ${path}`);
    const directory = opendirSync(physical);
    try {
      for (let entry; (entry = directory.readSync()) !== null;) {
        if (--remaining < 0) throw new Error("Native discovery alias enumeration exceeds its bound");
        if (entry.isDirectory() || entry.isSymbolicLink()) queue.push({ path: join(physical, entry.name), parents: [...parents, physical] });
      }
    } finally { directory.closeSync(); }
  }
  return [...targets];
}

function resolveDiscovery(options: DiscoveryOptions, exclusion?: { retained?: AgentDiscoveryBinding; narrowed?: NarrowedWitnessLedger; nativeHome?: string }): AgentDiscoveryBinding {
  const canonical = options.canonical ?? resolve, home = resolve(options.home), agent = options.agent;
  const sources: DiscoverySource[] = [], roots = new Set<string>(), builtinNames: string[] = [];
  const budget = discoveryByteBudget();
  let remainingEntries = AGENT_POLICY_LIMITS.discoveryDirectoryEntries;
  const entries = (path: string): string[] => {
    if (!exclusion) return readdirSync(path);
    const directory = opendirSync(path), names: string[] = [];
    try {
      for (let entry; (entry = directory.readSync()) !== null;) {
        if (--remainingEntries < 0) throw new Error("Native discovery exclusion enumeration exceeds its bound");
        names.push(entry.name);
      }
    } finally { directory.closeSync(); }
    return names;
  };
  const witness = (path: string, format?: "json" | "toml" | "yaml", fields?: string[], hashMode?: DiscoverySource["hashMode"]) => {
    const source: DiscoverySource = { path: canonical(path), sha256: null, ...(format ? { format, fields } : {}), ...(hashMode ? { hashMode } : {}) };
    if (exclusion && sources.length >= AGENT_POLICY_LIMITS.discoverySources) throw new Error("Native discovery exclusion sources exceed their bound");
    if (exclusion) safe(source.path);
    const raw = exclusion && lstatSync(source.path, { throwIfNoEntry: false })
      ? readNativeDiscoveryWitnessFile(source.path, budget) : null;
    if (exclusion && raw !== null && (format === "json" || source.path.endsWith(".json"))) parseNativeJsonObject(raw);
    source.sha256 = projected(source, undefined, exclusion ? budget : undefined); sources.push(source); return exclusion ? raw : read(source.path);
  };
  if (agent === "hermes") assertHermesEnvironment(home);
  // Authoring exclusion can inspect another effective native home without
  // changing the home/configuration admitted by the native bridge.
  const nativeHome = exclusion?.nativeHome ?? join(home, `.${agent}`);
  const configPath = exclusion?.nativeHome === undefined ? agentDiscoveryConfigPath(home, agent)
    : join(nativeHome, agent === "codex" ? "config.toml" : "settings.json");
  const configText = witness(configPath, agent === "hermes" ? "yaml" : agent === "codex" ? "toml" : "json", agent === "hermes" ? ["skills", "plugins", "hooks"] : agent === "claude" ? ["enabledPlugins", "extraKnownMarketplaces"] : agent === "codex" ? [...CODEX_DISCOVERY_PROJECTION_FIELDS] : agent === "gemini" ? ["skills", "extensions", "security"] : agent === "opencode" ? ["plugin", "skills"] : agent === "sumi" ? [...SUMI_DISCOVERY_PROJECTION_FIELDS] : ["version"]);
  const config: any = configText === null ? {} : agent === "hermes" ? parseHermesConfig(configText) : parseConfig(configText, configPath, agent === "codex");
  const unresolved = (detail: string): never => { throw new Error(`Native discovery is unresolved (${agent}: ${detail}); provide a reviewed --discovery-inputs file`); };
  let opaqueClosureVerified = false;
  const verifyOpaqueClosure = (declarations: readonly string[]): void => {
    if (opaqueClosureVerified) return;
    const retained = exclusion?.retained;
    // An opaque declaration alone does not establish its executable behavior.
    // Reuse the supplied review's full source population, never infer a shell
    // dependency graph or manufacture a replacement no-injection attestation.
    if (!retained) return unresolved("opaque executable dependency closure is unavailable");
    if (retained.method !== "reviewed" || !retained.sources.some(source => source.path !== canonical(configPath)
      && !declarations.includes(source.path) && source.sha256 !== null && source.format === undefined && source.fields === undefined
      && [undefined, "bytes", "path-bytes", "executable-v1"].includes(source.hashMode))) unresolved("opaque executable dependency closure is unavailable");
    verifyDiscovery(retained, undefined, undefined, undefined, exclusion?.narrowed, canonical(configPath));
    opaqueClosureVerified = true;
  };
  if (exclusion) {
    // Strict JSON syntax and collection limits come from the owning witness
    // adapter. Settings outside its discovery projection may vary freely.
    if (configText !== null && agent !== "codex" && agent !== "hermes") parseNativeJsonObject(configText);
    const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
    const keys = (value: unknown, allowed: readonly string[], label: string): void => {
      if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) unresolved(`unsupported ${label} controls`);
    };
    const paths = (value: unknown, label: string): string[] => {
      if (!Array.isArray(value) || value.length > AGENT_POLICY_LIMITS.discoveryRoots || value.some(path => typeof path !== "string" || !path || path.length > AGENT_POLICY_LIMITS.pathCharacters || /[\0$]/.test(path))) unresolved(`malformed or unbounded ${label}`);
      return value as string[];
    };
    const supported: Record<IntegrationAgent, readonly string[]> = {
      claude: ["enabledPlugins", "extraKnownMarketplaces", "pluginConfigs", "env", "hooks", "disableAllHooks", "disableBundledSkills", "syncClaudeAiSkills", "permissions"],
      codex: ["plugins", "marketplaces", "skills", "hooks"],
      gemini: ["skills", "extensions", "hooks", "hooksConfig"],
      opencode: ["plugin", "skills"], cursor: ["hooks"], hermes: ["skills", "plugins", "hooks"], sumi: ["skills", "plugin", "plugins", "hooks"],
    };
    const controls = agent === "claude" ? claudeDiscoveryControlKeys(configText ?? "{}")
      : agent === "codex" ? codexDiscoveryControlKeys(config)
      : Object.keys(config).filter(key => /skill|plugin|hook|marketplace|extension|instruction/i.test(key));
    const fieldKey = (key: string): string => /^[A-Za-z_$][A-Za-z0-9_$.-]{0,22}$/.test(key)
      && !/(?:sk|rk|pk)_(?:live|test)_|whsec_/i.test(key) ? JSON.stringify(key) : "[withheld field key]";
    const unsupportedFields = (names: readonly string[], label: string): never => unresolved(`unknown discovery controls have no root-exclusion adapter for ${label}${names.slice(0, 8).map(fieldKey).join(", ")}${names.length > 8 ? ", additional keys withheld" : ""} in ${quotedPath(canonical(configPath))}`);
    const unsupportedControls = controls.filter(key => !supported[agent].includes(key));
    if (unsupportedControls.length) unsupportedFields(unsupportedControls, "");
    // A command can register roots dynamically. An existing exact or narrowed
    // settings review is required for that non-enumerable input only.
    if (config.hooks !== undefined && !object(config.hooks)) unresolved("hooks must be an object");
    const hasHooks = controls.includes("hooks") && config.hooks !== undefined && Object.keys(config.hooks).length > 0;
    let hasPluginConfigs = false, hasFunctionHookEnvironment = false;
    const verifyCurrentOpaqueSettings = (label: string): void => {
      const retained = exclusion.retained;
      const settings = retained?.sources.filter(source => source.path === canonical(configPath)
        && source.sha256 !== null && source.format === undefined && source.fields === undefined) ?? [];
      if (retained?.method !== "reviewed" || !settings.length || !settings.every(source => {
        try { return projected(source, undefined, budget) === source.sha256 || exclusion.narrowed?.accepts(source) === true; }
        catch { return exclusion.narrowed?.accepts(source) === true; }
      })) unresolved(`non-enumerable ${label} require a current settings review`);
    };
    if (hasHooks) verifyCurrentOpaqueSettings("hooks");
    if (agent === "claude") {
      if (config.env !== undefined) {
        if (!object(config.env) || Object.keys(config.env).length > 512) unresolved("malformed or unbounded Claude env controls");
        const discoveryEnvironment = claudeDiscoveryEnvironmentKeys(configText ?? "{}");
        const unsupportedEnvironment = discoveryEnvironment.filter(key => key !== "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS");
        if (unsupportedEnvironment.length) unsupportedFields(unsupportedEnvironment, "env.");
        hasFunctionHookEnvironment = discoveryEnvironment.includes("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS");
        if (hasFunctionHookEnvironment) {
          if (!["0", "1"].includes(config.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)) unresolved("malformed Claude env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS flag");
          verifyCurrentOpaqueSettings("function-hook environment controls");
        }
      }
      if (config.pluginConfigs !== undefined) {
        if (!object(config.pluginConfigs) || Object.keys(config.pluginConfigs).length > 512) unresolved("malformed or unbounded Claude plugin configurations");
        const optionString = (value: unknown): boolean => typeof value === "string" && value.length <= AGENT_POLICY_LIMITS.pathCharacters && !value.includes("\0");
        for (const [id, entry] of Object.entries(config.pluginConfigs)) {
          if (!id || id.length > AGENT_POLICY_LIMITS.pathCharacters || --remainingEntries < 0) unresolved("malformed or unbounded Claude plugin configuration");
          keys(entry, ["options"], "Claude plugin configuration");
          const values = (entry as Record<string, unknown>).options;
          if (!object(values) || Object.keys(values).length > 512) return unresolved("malformed or unbounded Claude plugin options");
          for (const [key, value] of Object.entries(values)) {
            if (!key || key.length > AGENT_POLICY_LIMITS.pathCharacters || --remainingEntries < 0) unresolved("malformed or unbounded Claude plugin option");
            if (Array.isArray(value)) {
              remainingEntries -= value.length;
              if (value.length > 512 || remainingEntries < 0 || !value.every(optionString)) unresolved("malformed or unbounded Claude plugin option array");
            } else if (!(optionString(value) || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) unresolved("unsupported Claude plugin option value");
          }
        }
        hasPluginConfigs = Object.keys(config.pluginConfigs).length > 0;
        // Options can feed executable plugin controls. Keep their complete
        // settings witness and the same reviewed closure required for hooks.
        if (hasPluginConfigs) verifyCurrentOpaqueSettings("plugin configurations");
      }
      if (config.enabledPlugins !== undefined && !object(config.enabledPlugins)) unresolved("enabledPlugins must be an object");
      if (config.extraKnownMarketplaces !== undefined) {
        if (!object(config.extraKnownMarketplaces) || Object.keys(config.extraKnownMarketplaces).length > 512) unresolved("malformed or unbounded extraKnownMarketplaces");
        for (const market of Object.values(config.extraKnownMarketplaces) as any[]) {
          keys(market, ["source", "autoUpdate"], "Claude marketplace");
          keys(market.source, ["source", "path"], "Claude marketplace source");
          if (market.source.source !== "directory") unresolved("non-local marketplace roots require a dedicated exclusion adapter");
          for (const path of paths([market.source.path], "Claude marketplace source")) {
            if (!isAbsolute(path)) unresolved("relative marketplace root"); roots.add(canonical(path));
          }
        }
      }
      if (config.permissions !== undefined) {
        if (!object(config.permissions)) unresolved("permissions must be an object");
        for (const name of ["allow", "deny", "ask"]) if (config.permissions[name] !== undefined
          && (!Array.isArray(config.permissions[name]) || config.permissions[name].length > 1024 || config.permissions[name].some((rule: unknown) => typeof rule !== "string"))) unresolved("malformed permission rules");
        if (config.permissions.additionalDirectories !== undefined) for (const path of paths(config.permissions.additionalDirectories, "additional directories")) {
          if (!isAbsolute(path)) unresolved("relative additional directory"); roots.add(canonical(path));
        }
      }
    }
    if (agent === "opencode") {
      if (config.skills !== undefined) keys(config.skills, ["paths", "urls"], "OpenCode skills");
      for (const key of ["paths", "urls"]) if (config.skills?.[key] !== undefined) paths(config.skills[key], `OpenCode skill ${key}`);
      if (config.plugin !== undefined && (!Array.isArray(config.plugin) || config.plugin.length > 512)) unresolved("malformed OpenCode plugins");
    }
    if (agent === "sumi") {
      if (config.skills !== undefined) paths(config.skills, "Sumi skills");
      for (const key of ["plugin", "plugins"]) if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].length > 512)) unresolved("malformed Sumi plugins");
    }
    if (agent === "hermes" && config.skills !== undefined) {
      keys(config.skills, ["external_dirs"], "Hermes skills");
      if (config.skills.external_dirs !== undefined) paths(typeof config.skills.external_dirs === "string" ? [config.skills.external_dirs] : config.skills.external_dirs, "Hermes external directories");
    }
    if (agent === "gemini") {
      if (config.skills !== undefined) {
        keys(config.skills, ["enabled", "disabled", "paths"], "Gemini skills");
        for (const key of ["disabled", "paths"]) if (config.skills[key] !== undefined) paths(config.skills[key], `Gemini skill ${key}`);
      }
      if (config.extensions !== undefined && !object(config.extensions)) unresolved("extensions must be an object");
    }
    if (agent === "codex") {
      for (const key of ["plugins", "marketplaces"]) if (config[key] !== undefined && !object(config[key])) unresolved(`malformed Codex ${key}`);
      for (const value of Object.values(config.plugins ?? {})) keys(value, ["enabled"], "Codex plugin registration");
      for (const value of Object.values(config.marketplaces ?? {})) keys(value, ["source_type", "source"], "Codex marketplace registration");
      if (config.skills !== undefined) keys(config.skills, ["config", "bundled"], "Codex skills");
      if (config.skills?.bundled !== undefined) {
        keys(config.skills.bundled, ["enabled"], "Codex bundled skills");
        if (typeof config.skills.bundled.enabled !== "boolean") unresolved("malformed Codex bundled skills");
      }
      if (config.skills?.config !== undefined) {
        if (!Array.isArray(config.skills.config) || config.skills.config.length > 512) unresolved("malformed Codex skill configuration");
        for (const row of config.skills.config) {
          keys(row, ["path", "name", "enabled"], "Codex skill entry");
          if (typeof row.enabled !== "boolean" || (row.path !== undefined) === (row.name !== undefined)
            || row.name !== undefined && (typeof row.name !== "string" || !row.name.trim())) unresolved("malformed Codex skill entry");
          if (row.path !== undefined) {
            paths([row.path], "Codex skill path");
            if (!isAbsolute(row.path)) unresolved("relative Codex skill path");
            const path = canonical(row.path); roots.add(path.endsWith(`${sep}SKILL.md`) ? dirname(path) : path);
          }
        }
      }
    }
    if (Object.keys(config.enabledPlugins ?? config.plugins ?? config.extensions ?? {}).length > 512) unresolved("unbounded native registrations");
    if (hasHooks || hasPluginConfigs || hasFunctionHookEnvironment) verifyOpaqueClosure([]);
  }

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
    for (const path of plugins) { safe(path); if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) for (const name of entries(path).sort()) {
      if (name === "skills-cli.js" && path === plugins[1]) continue;
      const target = join(path, name);
      if (!lstatSync(target).isFile()) unresolved("local plugin packages need a dedicated discovery adapter");
      witness(target);
    } }
    for (const root of roots) {
      safe(root);
      if (lstatSync(root, { throwIfNoEntry: false })?.isDirectory() && entries(root).some(name => name.endsWith(".md"))) unresolved("flat markdown skills require a dedicated native migration adapter");
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
      for (const name of entries(builtinRoot).sort()) {
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
    if (retained.sources.some(source => (source.hashMode === "sumi-settings-v1" || source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4" || source.hashMode === "claude-settings-v5" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" || source.hashMode === "codex-settings-v6" || source.hashMode === "codex-settings-v7")))) && source.path !== canonical(configPath))) unresolved("retained settings witness names another configuration source");
    // A retained typed witness already binds this file more strongly than
    // the order-sensitive TOML projection, so it replaces that projection
    // instead of requiring it again.
    let covered = supersedesSettingsProjection(agent, retained.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededSettingsProjection(agent, canonical(configPath), source))
      : sources;
    if (retained.codexSemanticCache) {
      const proof = retained.codexSemanticCache;
      const parents = [...new Set([...(retained.codexDisabledPluginSkills ?? []).map(control => control.pluginParent), ...proof.appOnlyParents.map(parent => parent.pluginParent)])];
      covered = covered.filter(source => !codexSemanticCacheSourceRole(source, proof.witness.cacheRoot, parents));
    }
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
    if (review.sources.some(source => (source.hashMode === "sumi-settings-v1" || source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4" || source.hashMode === "claude-settings-v5" || (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5" || source.hashMode === "codex-settings-v6" || source.hashMode === "codex-settings-v7")))) && source.path !== canonical(configPath))) throw new Error("Semantic settings witnesses must name the configured agent configuration source");
    if (!review.sources.some(source => source.path === canonical(configPath))) throw new Error("Discovery review must include the agent configuration source");
    // One witness per file: a reviewed typed witness replaces the
    // automatic projection of the same path rather than being shadowed by it.
    const reviewedSources = supersedesSettingsProjection(agent, review.sources, canonical(configPath))
      ? sources.filter(source => !isSupersededSettingsProjection(agent, canonical(configPath), source))
      : sources;
    // Verification above retained these sources without reading them, because
    // their whole retired Claude version is absent. Keep each one exactly as
    // supplied: projecting a manifest or converting a marker would read a file
    // that no longer exists and change the meaning of a historical witness.
    const absentRoots = absentRetiredClaudeRoots(supplied);
    const reviewedSourcesWithManifestProjection = review.sources.map(source => {
      if (retainedAbsentClaudeRoot(absentRoots, source) !== undefined) return source;
      // The supplied raw/path witness was verified above. A fresh explicit
      // review may replace it with typed native presence; retained bindings
      // never silently change the meaning of historical byte witnesses.
      if (agent === "claude" && source.format === undefined && source.fields === undefined
        && source.managedPlugins === undefined && source.reviewArtifact === undefined
        && [undefined, "bytes", "path-bytes"].includes(source.hashMode)
        && isClaudePluginCacheOrphanMarker(source.path)) {
        return { path: source.path, hashMode: CLAUDE_ORPHAN_MARKER_MODE, sha256: hashClaudePluginCacheOrphanMarker(source.path) };
      }
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
    if (agent === "claude") assertReviewedClaudeCacheClosures(home, config, review, canonical);
    for (const root of absentRoots) { safe(root); if (lstatSync(root, { throwIfNoEntry: false })) throw new Error("Retired native materialization changed during discovery review"); }
    const combined = [...reviewedSources, ...reviewedSourcesWithManifestProjection];
    const unique = combined.filter((source, index) => combined.findIndex(candidate => isDeepStrictEqual(candidate, source)) === index);
    return { ...supplied, roots: [...new Set([...roots, ...supplied.roots])].sort(), sources: unique, ...(agent === "gemini" ? { builtinNames } : {}) };
  }

  function plugin(root: string): void {
    root = canonical(root); safe(root);
    if (exclusion) roots.add(root);
    const manifestPath = join(root, agent === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json");
    const raw = witness(manifestPath, undefined, undefined, agent === "claude" ? "claude-plugin-manifest-v1" : undefined); if (raw === null) unresolved("plugin manifest missing");
    const manifest = parseConfig(raw!, manifestPath);
    if (exclusion && Object.keys(manifest).some(key => /skill|plugin|hook|marketplace|extension|instruction/i.test(key) && !["skills", "hooks"].includes(key))) unresolved("unknown plugin discovery controls");
    const hooks = witness(join(root, "hooks/hooks.json"));
    if (manifest.hooks !== undefined || hooks !== null) {
      if (!exclusion || exclusion.retained?.method !== "reviewed") unresolved("plugin hooks require a separate no-skill-injection review");
      const required = [manifestPath, ...(hooks !== null ? [join(root, "hooks/hooks.json")] : [])];
      if (manifest.hooks !== undefined) {
        if (typeof manifest.hooks !== "string") unresolved("unsupported plugin hooks target");
        const hook = resolve(root, manifest.hooks);
        if (!hook.startsWith(root + sep)) unresolved("plugin hooks target escapes its root");
        required.push(hook);
      }
      for (const path of required) {
        const saved = exclusion!.retained!.sources.filter(source => source.path === canonical(path)
          && source.sha256 !== null && source.format === undefined && source.fields === undefined);
        if (!saved.length || saved.some(source => projected(source, undefined, budget) !== source.sha256)) unresolved("plugin hooks require current independently reviewed sources");
      }
      verifyOpaqueClosure(required.map(path => canonical(path)));
    }
    const commands = join(root, "commands"); safe(commands);
    if (agent === "claude" && (manifest.commands !== undefined || (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && entries(commands).length))) unresolved("legacy command discovery requires retirement or a dedicated format adapter");
    const rootSkill = witness(join(root, "SKILL.md"));
    if (rootSkill !== null) roots.add(root);
    const declared = manifest.skills === undefined ? ["./skills"] : typeof manifest.skills === "string" ? [manifest.skills] : manifest.skills;
    if (!Array.isArray(declared) || declared.some(path => typeof path !== "string")
      || exclusion && (declared.length > AGENT_POLICY_LIMITS.discoveryRoots || declared.some(path => !path || path.length > AGENT_POLICY_LIMITS.pathCharacters || /[\0$]/.test(path)))) unresolved("unsupported plugin skill paths");
    if (agent === "claude") roots.add(join(root, "skills"));
    for (const value of declared) {
      const path = resolve(root, value);
      if (path !== root && !path.startsWith(root + sep)) unresolved("plugin skill path escapes its root");
      roots.add(path.endsWith(`${sep}SKILL.md`) ? dirname(path) : path);
    }
  }
  if (agent === "claude") {
    const registrations = witness(join(nativeHome, "plugins/installed_plugins.json"));
    const installed = registrations === null ? {} : parseConfig(registrations, join(nativeHome, "plugins/installed_plugins.json")).plugins;
    const commands = canonical(join(nativeHome, "commands")); safe(commands);
    if (lstatSync(commands, { throwIfNoEntry: false })?.isDirectory() && entries(commands).length) unresolved("legacy home command discovery requires a dedicated format adapter");
    for (const [id, enabled] of Object.entries(config.enabledPlugins ?? {})) {
      if (enabled === false) continue;
      if (enabled !== true) unresolved("unsupported plugin enablement");
      const matches = installed?.[id];
      if (!Array.isArray(matches) || matches.length !== 1 || typeof matches[0]?.installPath !== "string" || matches[0]?.scope !== "user") unresolved("enabled plugin registration is missing or ambiguous");
      if (exclusion && (!isAbsolute(matches[0].installPath) || resolve(matches[0].installPath) !== matches[0].installPath || matches[0].installPath.length > AGENT_POLICY_LIMITS.pathCharacters)) unresolved("malformed plugin installation root");
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
    if (lstatSync(localPlugins, { throwIfNoEntry: false }) && entries(localPlugins).some(name => name !== "skills-cli.js")) unresolved("additional local plugin hooks require review");
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
    if (lstatSync(directory, { throwIfNoEntry: false })) for (const name of entries(directory)) {
      const root = join(directory, name); safe(root);
      if (!lstatSync(root)?.isDirectory()) continue;
      const raw = witness(join(root, "gemini-extension.json"));
      if (raw === null) unresolved("extension registration missing");
      const manifest = parseConfig(raw!, join(root, "gemini-extension.json"));
      if (manifest.hooks !== undefined || witness(join(root, "hooks/hooks.json")) !== null || witness(join(root, ".gemini-extension-install.json")) !== null) unresolved("extension hooks or linked registration require review");
      roots.add(join(root, "skills"));
    }
  }
  if (exclusion && roots.size > AGENT_POLICY_LIMITS.discoveryRoots) unresolved("native discovery roots exceed their bound");
  return { agent, roots: [...roots].sort(), sources, method: "automatic", ...(agent === "gemini" ? { builtinNames } : {}), ...(agent === "hermes" ? { directories: captureDiscoveryDirectories([join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent")].map(path => canonical(path))) } : {}) };
}
