import { NATIVE_SKILL_ROOTS, nativeProjectAncestorDirectories } from "./native-discovery-roots.js";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { INTEGRATION_AGENTS } from "./agent-adapters.js";
import { agentDiscoveryConfigPath, discoveryExecutable, recordedDiscoveryExecutable, resolveAgentDiscoveryExclusionRoots, nativeDiscoveryAliasTargets, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { getDataDirReadOnly } from "./config.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";
import { openNarrowedWitnessLedger } from "./narrowed-witness-ledger.js";
import { assertHermesEnvironment } from "./agent-hermes.js";

/**
 * Roots that an agent may discover as native instructions.  Portable Skills
 * authoring must never create a payload below one of these roots: a project
 * checkout can be nested below the user's home, and a native root can itself
 * be an alias, so checking only the default home is insufficient.
 */
const NATIVE_DISCOVERY_ROOTS = NATIVE_SKILL_ROOTS.map(([, path]) => path.split("/"));

function pathParts(path: string): string[] {
  return resolve(path).split(sep).filter(Boolean);
}

function nativeRootMatch(path: string): string | undefined {
  const parts = pathParts(path);
  for (let start = 0; start < parts.length; start += 1) {
    for (const root of NATIVE_DISCOVERY_ROOTS) {
      if (root.every((part, offset) => parts[start + offset] === part)) {
        return root.join("/");
      }
    }
  }
  return undefined;
}

// Resolve an absent destination through its nearest existing ancestor. This
// mirrors the import overlap guard and catches a legal-looking alias whose
// parent resolves into a native discovery tree.
function physicalPath(path: string): string {
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (!lstatSync(cursor, { throwIfNoEntry: false })) {
    suffix.unshift(basename(cursor));
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(path);
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...suffix);
}

export interface PortableAuthoringPathOptions {
  /** The account whose native discovery must remain free of authored payloads. */
  homeDir?: string;
}

function contains(root: string, path: string): boolean {
  const boundary = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(boundary);
}

/** These overrides change native discovery even without a default home or a
 * Skills bridge. Resolve relative Codex homes from the caller's cwd, as Codex
 * does, and canonicalize aliases through physicalPath at the boundary. Claude's
 * supported configuration-directory contract requires an absolute path. */
function selectedNativeHomes(): Array<{ agent: "codex" | "claude"; path: string }> {
  const homes: Array<{ agent: "codex" | "claude"; path: string }> = [];
  for (const [agent, variable] of [["codex", "CODEX_HOME"], ["claude", "CLAUDE_CONFIG_DIR"]] as const) {
    const value = process.env[variable];
    if (value === undefined) continue;
    if (!value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value) || agent === "claude" && !isAbsolute(value)) throw new Error(`Unsupported ${variable} for portable authoring`);
    homes.push({ agent, path: resolve(value) });
  }
  return homes;
}

/** Read the same configured discovery contract as the native bridge. Unknown
 * registrations must first be reviewed through Skills; they are not ignored
 * merely because the proposed destination has an ordinary directory name. */
function configuredRoots(home: string, explicitHome: boolean): string[] {
  // Relocating the authoring corpus does not relocate the account's native
  // policy. Prefer that owning home policy; also validate an explicitly
  // configured Skills policy below when it is a different binding.
  const homeData = join(home, ".hasna", "skills");
  const homePolicy = readManagedSkillPolicySnapshot(homeData);
  const configuredPolicy = !explicitHome && resolve(getDataDirReadOnly()) !== resolve(homeData)
    ? readManagedSkillPolicySnapshot(getDataDirReadOnly()) : null;
  const roots: string[] = [];
  const admitPolicy = (value: Record<string, any>, dataDir: string): void => {
    const current = value.bridge;
    if (!current) return;
    if (typeof current.home !== "string" || physicalPath(current.home) !== physicalPath(home)) throw new Error("Native discovery policy belongs to a different home; refusing portable authoring");
    // Root exclusion accepts physical aliases, but an unresolved or retargeted
    // retained alias is not evidence of the current discovery arrangement.
    for (const alias of current.rootAliases ?? []) {
      if (physicalPath(alias.home) !== physicalPath(home) || !["claude", "codex"].includes(alias.agent)
        || alias.alias !== join(alias.home, `.${alias.agent}`)
        || realpathSync(alias.alias) !== alias.target) throw new Error("Native discovery root alias is unresolved or changed");
    }
    const narrowed = openNarrowedWitnessLedger(dataDir, { record: false });
    for (const [agent, binding] of Object.entries(current.discovery ?? {}) as Array<[string, AgentDiscoveryBinding]>) {
      if (!INTEGRATION_AGENTS.includes(binding.agent) || agent !== binding.agent || !["automatic", "reviewed"].includes(binding.method)
        || [...binding.roots, ...binding.sources.map(source => source.path)].some(path => !isAbsolute(path) || resolve(path) !== path)
        || !binding.sources.some(source => source.path === physicalPath(agentDiscoveryConfigPath(home, binding.agent)))) {
        throw new Error("Native discovery policy does not bind the current account configuration");
      }
      const recorded = current.discoveryExecutables?.[agent];
      const onPath = discoveryExecutable(binding.agent);
      const executable = recorded ? recordedDiscoveryExecutable(binding.agent, recorded) : onPath;
      if (recorded && (!executable || executable.target !== recorded.target || onPath && onPath.target !== recorded.target)
        || !executable && (binding.builtinNames?.length || binding.agent === "gemini" && binding.sources.some(source => basename(source.path) === "package.json"))) {
        throw new Error("Native discovery runtime target is unresolved or changed");
      }
      roots.push(...resolveAgentDiscoveryExclusionRoots({ home, agent: binding.agent, canonical: physicalPath, retained: binding, executable, narrowed }));
    }
  };
  if (homePolicy) admitPolicy(homePolicy.value, homeData);
  if (configuredPolicy) admitPolicy(configuredPolicy.value, getDataDirReadOnly());
  for (const agent of INTEGRATION_AGENTS) {
    if (homePolicy?.value.bridge?.discovery?.[agent] !== undefined || configuredPolicy?.value.bridge?.discovery?.[agent] !== undefined) continue;
    const nativeHome = join(home, agent === "opencode" ? ".config/opencode" : `.${agent}`);
    // Absent agent configuration has only the known default roots. Do not
    // inspect another account's installed runtime through an ambient PATH.
    const sumiConfigured = agent === "sumi" && (Bun.which("sumi-paths", { PATH: process.env.PATH ?? "" }) !== null
      || lstatSync(join(home, ".config/sumi"), { throwIfNoEntry: false }) !== undefined
      || ["SUMI_HOME", "SUMI_CONFIG_DIR", "SUMI_CONFIG", "SUMI_CONFIG_CONTENT"].some(key => process.env[key] !== undefined));
    if (!lstatSync(nativeHome, { throwIfNoEntry: false }) && !sumiConfigured) continue;
    roots.push(...resolveAgentDiscoveryExclusionRoots({ home, agent, canonical: physicalPath }));
  }
  return roots;
}

/**
 * Refuse a write target that is, or physically aliases, an agent discovery
 * root. Read-only inventory and archive operations deliberately do not call
 * this guard; they must remain able to inspect and migrate native copies.
 */
export function assertPortableAuthoringPath(path: string, options: PortableAuthoringPathOptions = {}): void {
  if (typeof path !== "string" || !path || path.includes("\0")) throw new Error("Invalid portable authoring path");
  const lexical = resolve(path);
  const physical = physicalPath(lexical);
  const candidates = [lexical, physical];
  let native = candidates.map(nativeRootMatch).find(Boolean);
  const home = resolve(options.homeDir ?? homedir());
  if (process.env.HERMES_HOME !== undefined) assertHermesEnvironment(home);
  const selected = selectedNativeHomes();
  // Compare both sides physically: the destination may name the real target
  // of ~/.codex, without spelling any recognizable native path components.
  const contexts = [...new Set([home, ...nativeProjectAncestorDirectories([process.cwd()], physicalPath)])];
  const defaults = contexts.flatMap(context => [
    ...NATIVE_DISCOVERY_ROOTS.map(parts => join(context, ...parts)),
    join(context, ".codex/plugins/cache"), join(context, ".claude/plugins/cache"),
    join(context, ".claude/plugins/synced"), join(context, ".claude/commands"), join(context, ".gemini/extensions"),
  ]);
  // Each discovery subroot can itself be a symlink outside its native home.
  // Canonicalizing the home alone would leave that subroot's physical target
  // writable through an ordinary-looking path. Keep the same known skill and
  // plugin-cache roots as the default-home boundary, plus Claude's legacy
  // commands directory inspected by the owning discovery resolver.
  for (const value of selected) {
    defaults.push(join(value.path, "skills"), join(value.path, "plugins/cache"));
    if (value.agent === "claude") defaults.push(join(value.path, "plugins/synced"), join(value.path, "commands"));
  }
  for (const root of [...defaults, ...selected.map(value => value.path)]) {
    if (candidates.some(candidate => [resolve(root), physicalPath(root)].some(nativeRoot => contains(nativeRoot, candidate) || contains(candidate, nativeRoot)))) native ??= root;
  }
  if (native) {
    throw new Error(`Refusing portable Skills authoring below native discovery root '${native}': ${lexical}. Set HASNA_SKILLS_DIR to a private authoring corpus outside native roots.`);
  }
  const roots = configuredRoots(home, options.homeDir !== undefined);
  for (const value of selected) {
    // The account's existing binding continues to protect its recorded roots.
    // An override is another consumer, never a reason to rewrite that binding
    // or reuse its opaque executable review for a different configuration.
    if (physicalPath(value.path) === physicalPath(join(home, `.${value.agent}`))) continue;
    roots.push(...resolveAgentDiscoveryExclusionRoots({ home, agent: value.agent, nativeHome: value.path, canonical: physicalPath, executable: null }));
  }
  for (const root of roots) {
    if (candidates.some(candidate => [resolve(root), physicalPath(root)].some(nativeRoot => contains(nativeRoot, candidate) || contains(candidate, nativeRoot)))) {
      throw new Error(`Refusing portable Skills authoring below configured native discovery root: ${lexical}`);
    }
  }
  // One alias closure covers the complete owned default inventory and every
  // current/retained configured root, regardless of the provider label. This
  // includes shared roots and providers without an enrollment adapter.
  for (const root of nativeDiscoveryAliasTargets([...new Set([...defaults, ...roots])], home)) {
    if (candidates.some(candidate => contains(root, candidate) || contains(candidate, root))) {
      throw new Error(`Refusing portable Skills authoring below configured native discovery root: ${lexical}`);
    }
  }
}
