import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { claudeMarketplaceEntrySourceValid } from "./claude-marketplace-entry-witness.js";
/** Shared bounds for stored policy, discovery, and pre-activation validation. */
export const AGENT_POLICY_LIMITS = Object.freeze({ bytes: 1024 * 1024, agents: 16, discoverySources: 2048, discoveryRawSourceBytes: 64 * 1024 * 1024, discoveryRawTotalBytes: 256 * 1024 * 1024, discoveryPathLinks: 40, discoveryPathSteps: 256, discoveryPathSourceMetadataBytes: 64 * 1024, discoveryPathTotalMetadataBytes: 8 * 1024 * 1024, discoveryRoots: 512, discoveryDirectories: 64, discoveryDirectoryEntries: 20000, discoveryDirectoryBytes: 8 * 1024 * 1024, builtinNames: 2048, rootAliases: 2, fields: 64, pathCharacters: 4096 });
function object(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function requireBound(value: unknown): asserts value { if (!value) throw new Error("Agent policy collection bounds are invalid"); }
function array(value: unknown, maximum: number): any[] { requireBound(Array.isArray(value) && value.length <= maximum); return value; }
function record(value: unknown, maximum: number): Record<string, any> { requireBound(object(value) && Object.keys(value).length <= maximum); return value; }
function text(value: unknown, maximum: number = AGENT_POLICY_LIMITS.pathCharacters): void { requireBound(typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0")); }
/** Unknown extension fields remain compatible within the serialized byte bound. */
export function assertAgentPolicyCollections(policy: Record<string, any>): void {
  if (policy.bridge === undefined) return;
  const bridge = record(policy.bridge, 64);
  if (bridge.agents !== undefined) for (const agent of array(bridge.agents, AGENT_POLICY_LIMITS.agents)) text(agent, 128);
  for (const key of ["commands", "profiles", "supervisors"]) if (bridge[key] !== undefined) {
    const entries = record(bridge[key], AGENT_POLICY_LIMITS.agents);
    for (const [agent, value] of Object.entries(entries)) {
      text(agent, 128);
      if (key === "supervisors") { requireBound(object(value)); text(value.path); text(value.runtime); text(value.sha256, 64); }
      else text(value, key === "profiles" ? 128 : AGENT_POLICY_LIMITS.pathCharacters);
    }
  }
  if (bridge.rootAliases !== undefined) for (const alias of array(bridge.rootAliases, AGENT_POLICY_LIMITS.rootAliases)) {
    requireBound(object(alias)); for (const key of ["agent", "home", "alias", "target", "link", "aliasIdentity", "targetIdentity"]) text(alias[key]);
  }
  if (bridge.codexPluginSkills !== undefined) for (const control of array(bridge.codexPluginSkills, 4096)) {
    requireBound(object(control) && Object.keys(control).every(key=>["name","pluginId","namespace","pluginParent","manifestSha256","appSha256","mcpSha256","remotePluginId","skillsOnly"].includes(key)));
    text(control.name,129); text(control.pluginId,1024); text(control.namespace,64); text(control.pluginParent);
    requireBound(isAbsolute(control.pluginParent) && resolve(control.pluginParent) === control.pluginParent && /^[a-f0-9]{64}$/.test(control.manifestSha256));
    if (control.remotePluginId !== undefined) requireBound(typeof control.remotePluginId === "string" && /^[A-Za-z0-9_~-]{1,1024}$/.test(control.remotePluginId));
    if(control.skillsOnly!==undefined) requireBound(control.skillsOnly===true && control.appSha256===undefined && control.mcpSha256===undefined);
    if (control.mcpSha256 !== undefined) requireBound(typeof control.mcpSha256 === "string" && /^[a-f0-9]{64}$/.test(control.mcpSha256));
    if (control.appSha256 !== undefined) requireBound(typeof control.appSha256 === "string" && /^[a-f0-9]{64}$/.test(control.appSha256));
  }
  if (bridge.codexInactivePlugins !== undefined) {
    const controls=array(bridge.codexInactivePlugins,4096), ids=new Set<string>();
    requireBound(controls.length===0 || object(bridge.codexPluginSkillReview) && supportsCodexNativeCapability(bridge.codexPluginSkillReview.version,"installed-plugin-review") && typeof bridge.codexPluginSkillReview.catalogSha256==="string" && /^[a-f0-9]{64}$/.test(bridge.codexPluginSkillReview.catalogSha256));
    for (const control of controls) {
      requireBound(object(control) && Object.keys(control).every(key=>["pluginId","namespace","pluginParent","sourceType","sourceSha256"].includes(key)));
      text(control.pluginId,1024); text(control.namespace,64); text(control.pluginParent);
      requireBound(!ids.has(control.pluginId) && isAbsolute(control.pluginParent) && resolve(control.pluginParent)===control.pluginParent
        && ["local","git","npm"].includes(control.sourceType) && typeof control.sourceSha256==="string" && /^[a-f0-9]{64}$/.test(control.sourceSha256));
      ids.add(control.pluginId);
    }
  }
  // Runtime executables recorded by a discovery review; only Gemini has one.
  if (bridge.discoveryExecutables !== undefined) for (const [agent, executable] of Object.entries(record(bridge.discoveryExecutables, AGENT_POLICY_LIMITS.agents))) {
    requireBound(agent === "gemini" && object(executable) && Object.keys(executable).length === 3 && executable.command === "gemini");
    for (const path of [executable.path, executable.target]) { text(path); requireBound(!/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(path) && isAbsolute(path) && resolve(path) === path); }
  }
  if (bridge.disabledBuiltins !== undefined) for (const builtin of array(bridge.disabledBuiltins, AGENT_POLICY_LIMITS.builtinNames)) { requireBound(object(builtin)); text(builtin.path); text(builtin.hash, 64); }
  // Reviewed Codex native policy trust: exact per-platform executable digests. Its
  // semantic validation lives with the adapter; this keeps the stored bytes bounded.
  if (bridge.codexNativePolicy !== undefined) {
    const trust = record(bridge.codexNativePolicy, 1);
    for (const [platform, digests] of Object.entries(record(trust.executableDigests, 8))) { text(platform, 32); for (const digest of array(digests, 16)) text(digest, 64); }
  }
  if (bridge.discovery === undefined) return;
  for (const [agent, value] of Object.entries(record(bridge.discovery, AGENT_POLICY_LIMITS.agents))) {
    text(agent, 128); requireBound(object(value)); text(value.agent, 128);
    if(value.codexRetiredMaterializations!==undefined) {
      const proof=record(value.codexRetiredMaterializations,3),roots=array(proof.roots,AGENT_POLICY_LIMITS.discoveryRoots),parents=proof.parents===undefined ? [] : array(proof.parents,AGENT_POLICY_LIMITS.discoveryRoots);
      requireBound(agent==="codex" && value.agent==="codex" && value.method==="reviewed" && Object.keys(proof).every(key=>["roots","parents","directories"].includes(key)) && roots.length+parents.length>0 && new Set(roots).size===roots.length && new Set(parents).size===parents.length);
      for(const root of roots) {text(root);requireBound(isAbsolute(root) && resolve(root)===root);}
      for(const parent of parents) {text(parent);requireBound(isAbsolute(parent) && resolve(parent)===parent);}
      for(const directory of array(proof.directories,AGENT_POLICY_LIMITS.discoveryDirectories)) {
        requireBound(object(directory));text(directory.path);requireBound(directory.sha256===null || typeof directory.sha256==="string" && /^[a-f0-9]{64}$/.test(directory.sha256));
        if(directory.entries!==undefined) for(const entry of array(directory.entries,AGENT_POLICY_LIMITS.discoveryDirectoryEntries)) text(entry,AGENT_POLICY_LIMITS.pathCharacters*6+100);
      }
    }
    if (value.codexInstallationInputs!==undefined) {
      const proof=record(value.codexInstallationInputs,4), inputs=array(proof.plugins,4096), ids=new Set<string>();
      requireBound(agent==="codex" && value.agent==="codex" && value.method==="reviewed" && supportsCodexNativeCapability(proof.version,"installed-plugin-review") && typeof proof.catalogSha256==="string" && /^[a-f0-9]{64}$/.test(proof.catalogSha256)
        && inputs.length>0 && object(bridge.codexPluginSkillReview) && bridge.codexPluginSkillReview.version===proof.version && bridge.codexPluginSkillReview.catalogSha256===proof.catalogSha256);
      for (const input of inputs) {
        requireBound(object(input) && Object.keys(input).every(key=>["pluginId","namespace","pluginParent","sourceRoot","sourceSha256"].includes(key)));
        text(input.pluginId,1024);text(input.namespace,64);text(input.pluginParent);text(input.sourceRoot);
        requireBound(!ids.has(input.pluginId) && [input.pluginParent,input.sourceRoot].every(path=>isAbsolute(path) && resolve(path)===path) && typeof input.sourceSha256==="string" && /^[a-f0-9]{64}$/.test(input.sourceSha256));
        ids.add(input.pluginId);
      }
      if (proof.directories!==undefined) for (const directory of array(proof.directories,AGENT_POLICY_LIMITS.discoveryDirectories)) {
        requireBound(object(directory));text(directory.path);
        requireBound(directory.sha256===null || typeof directory.sha256==="string" && /^[a-f0-9]{64}$/.test(directory.sha256));
      }
    }
    if (value.codexSemanticCache !== undefined) {
      const proof = record(value.codexSemanticCache, 8), witness = record(proof.witness, 6);
      requireBound(agent === "codex" && value.agent === "codex" && value.method === "reviewed"
        && Object.keys(proof).length === 8 && proof.schema === "hasna.codex-semantic-cache-discovery.v1"
        && typeof proof.previousPolicySha256 === "string" && /^[a-f0-9]{64}$/.test(proof.previousPolicySha256)
        && Object.keys(witness).length === 6 && witness.schema === "hasna.codex-semantic-cache-witness.v1"
        && typeof witness.sha256 === "string" && /^[a-f0-9]{64}$/.test(witness.sha256));
      text(proof.configPath); requireBound(isAbsolute(proof.configPath) && resolve(proof.configPath) === proof.configPath && basename(proof.configPath) === "config.toml");
      text(witness.cacheRoot); requireBound(isAbsolute(witness.cacheRoot) && resolve(witness.cacheRoot) === witness.cacheRoot);
      if (proof.hookRootAlias !== null) {
        requireBound(object(proof.hookRootAlias) && Object.keys(proof.hookRootAlias).length === 2);
        for (const key of ["alias", "target"]) { text(proof.hookRootAlias[key]); requireBound(isAbsolute(proof.hookRootAlias[key]) && resolve(proof.hookRootAlias[key]) === proof.hookRootAlias[key]); }
      }
      const parents = array(proof.appOnlyParents, 4096);
      for (const parent of parents) {
        requireBound(object(parent) && Object.keys(parent).length === 5 && parent.role === "app-only");
        for (const key of ["pluginId", "namespace", "pluginParent", "remotePluginId"]) text(parent[key]);
        requireBound(isAbsolute(parent.pluginParent) && resolve(parent.pluginParent) === parent.pluginParent);
      }
      for (const row of [...array(witness.controls, 4096), ...array(witness.appOnlyParents, 4096)]) {
        requireBound(object(row));
        for (const key of ["pluginId", "namespace", "pluginParent"]) text(row[key]);
        for (const key of ["manifestSha256", "appSha256", "mcpSha256", "receiptSha256"]) if (row[key] !== undefined) requireBound(typeof row[key] === "string" && /^[a-f0-9]{64}$/.test(row[key]));
      }
      for (const skill of array(witness.skills, 4096)) {
        requireBound(object(skill)); for (const key of ["name", "pluginId", "namespace", "pluginParent"]) text(skill[key]);
        for (const rule of array(skill.disabledRules, 4096)) text(rule);
      }
      for (const source of array(proof.supersededSources, AGENT_POLICY_LIMITS.discoverySources)) {
        requireBound(object(source)); text(source.path); requireBound(source.sha256 === null || typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256));
      }
      for (const directory of array(proof.supersededDirectories, AGENT_POLICY_LIMITS.discoveryDirectories)) {
        requireBound(object(directory)); text(directory.path); requireBound(directory.sha256 === null || typeof directory.sha256 === "string" && /^[a-f0-9]{64}$/.test(directory.sha256));
      }
    }
    for (const root of array(value.roots, AGENT_POLICY_LIMITS.discoveryRoots)) text(root);
    for (const source of array(value.sources, AGENT_POLICY_LIMITS.discoverySources)) {
      requireBound(object(source)); text(source.path);
      requireBound(source.sha256 === null || typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256));
      if (source.hashMode !== undefined) requireBound(["bytes", "path-bytes", "claude-plugin-manifest-v1", "claude-plugin-registry", "claude-marketplace-registry", "claude-settings-v1", "claude-settings-v2", "claude-settings-v3", "claude-settings-v4", "claude-marketplace-registry-v2", "codex-settings-v1", "codex-settings-v2", "codex-settings-v3", "codex-settings-v4", "codex-settings-v5", "sumi-settings-v1", "claude-marketplace-entry-v1"].includes(source.hashMode) && source.format === undefined && source.fields === undefined && (source.hashMode === "bytes" || source.sha256 !== null));
      if (source.hashMode === "claude-plugin-manifest-v1") requireBound(agent === "claude" && value.agent === "claude" && ["automatic", "reviewed"].includes(value.method) && !/[\x00-\x1f\x7f]/.test(source.path) && isAbsolute(source.path) && resolve(source.path) === source.path && source.path.endsWith(join(sep, ".claude-plugin", "plugin.json")) && source.managedPlugins === undefined);
      if (source.hashMode === "sumi-settings-v1") requireBound(agent === "sumi" && value.agent === "sumi" && value.method === "reviewed" && !/[\x00-\x1f\x7f]/.test(source.path) && isAbsolute(source.path) && resolve(source.path) === source.path && basename(source.path) === "sumi.json");
      if (source.hashMode === "codex-settings-v1" || source.hashMode === "codex-settings-v2" || (source.hashMode === "codex-settings-v3" || source.hashMode === "codex-settings-v4" || source.hashMode === "codex-settings-v5")) requireBound(agent === "codex" && value.agent === "codex" && value.method === "reviewed" && !/[\x00-\x1f\x7f]/.test(source.path) && isAbsolute(source.path) && resolve(source.path) === source.path && basename(source.path) === "config.toml");
      if ((source.hashMode === "claude-settings-v1" || source.hashMode === "claude-settings-v2" || (source.hashMode === "claude-settings-v3" || source.hashMode === "claude-settings-v4"))) requireBound(agent === "claude" && value.agent === "claude" && value.method === "reviewed" && !/[\x00-\x1f\x7f]/.test(source.path) && isAbsolute(source.path) && resolve(source.path) === source.path && basename(source.path) === "settings.json");
      if ((source.hashMode === "claude-marketplace-registry" || source.hashMode === "claude-marketplace-registry-v2")) requireBound(agent === "claude" && value.agent === "claude" && value.method === "reviewed" && !/[\x00-\x1f\x7f]/.test(source.path) && isAbsolute(source.path) && resolve(source.path) === source.path && basename(source.path) === "known_marketplaces.json");
      if (source.hashMode === "claude-marketplace-entry-v1") requireBound(agent === "claude" && value.agent === "claude" && value.method === "reviewed" && claudeMarketplaceEntrySourceValid(source));
      if (source.hashMode === "claude-plugin-registry") {
        requireBound(agent === "claude");
        const managed = array(source.managedPlugins, 64); requireBound(managed.length > 0);
        for (const entry of managed) { requireBound(object(entry) && Object.keys(entry).every(key => ["bindingId", "storeRoot"].includes(key))); text(entry.storeRoot); requireBound(typeof entry.bindingId === "string" && /^[a-f0-9]{64}$/.test(entry.bindingId)); }
      } else requireBound(source.managedPlugins === undefined);
      if (source.reviewArtifact !== undefined) {
        const artifact = source.reviewArtifact;
        requireBound(agent === "codex" && value.method === "reviewed" && source.hashMode === "bytes" && object(artifact)
          && Object.keys(artifact).length === 6 && Object.keys(artifact).every(key => ["version", "kind", "storeRoot", "originalPath", "sha256", "catalogSha256"].includes(key)) && artifact.version === 1 && artifact.kind === "codex-native-catalog"
          && artifact.sha256 === source.sha256 && /^[a-f0-9]{64}$/.test(artifact.catalogSha256));
        for (const path of [artifact.storeRoot, artifact.originalPath]) { text(path); requireBound(isAbsolute(path) && resolve(path) === path); }
        requireBound(source.path === join(artifact.storeRoot, "agent-discovery", "artifacts", artifact.sha256, "catalog.json"));
      }
      if (source.format !== undefined) requireBound(["json", "toml", "yaml"].includes(source.format));
      if (source.fields !== undefined) for (const field of array(source.fields, AGENT_POLICY_LIMITS.fields)) text(field, 256);
    }
    if (value.directories !== undefined) for (const directory of array(value.directories, AGENT_POLICY_LIMITS.discoveryDirectories)) {
      requireBound(object(directory)); text(directory.path);
      requireBound(directory.sha256 === null || typeof directory.sha256 === "string" && /^[a-f0-9]{64}$/.test(directory.sha256));
    }
    if (value.builtinNames !== undefined) for (const name of array(value.builtinNames, AGENT_POLICY_LIMITS.builtinNames)) text(name, 128);
  }
}
