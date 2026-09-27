import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { INTEGRATION_AGENTS } from "./agent-adapters.js";
import { agentDiscoveryConfigPath, resolveAgentDiscovery, verifyAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { getDataDirReadOnly } from "./config.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";

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
  return path === root || path.startsWith(root + sep);
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
  const policy = homePolicy ?? configuredPolicy;
  const bridge = policy?.value.bridge;
  if (bridge && (typeof bridge.home !== "string" || physicalPath(bridge.home) !== physicalPath(home))) {
    throw new Error("Native discovery policy belongs to a different home; refusing portable authoring");
  }
  const roots: string[] = [];
  const admitBinding = (binding: AgentDiscoveryBinding): void => {
    if (!INTEGRATION_AGENTS.includes(binding.agent) || !binding.sources.some(source => source.path === physicalPath(agentDiscoveryConfigPath(home, binding.agent)))) {
      throw new Error("Native discovery policy does not bind the current account configuration");
    }
    verifyAgentDiscovery(binding); roots.push(...binding.roots);
  };
  if (homePolicy && configuredPolicy?.value.bridge) {
    if (physicalPath(configuredPolicy.value.bridge.home) !== physicalPath(home)) throw new Error("Native discovery policy belongs to a different home; refusing portable authoring");
    for (const binding of Object.values(configuredPolicy.value.bridge.discovery ?? {}) as AgentDiscoveryBinding[]) {
      admitBinding(binding);
    }
  }
  for (const agent of INTEGRATION_AGENTS) {
    const binding = bridge?.discovery?.[agent] as AgentDiscoveryBinding | undefined;
    if (binding !== undefined) {
      if (binding.agent !== agent) throw new Error("Invalid native discovery policy binding");
      admitBinding(binding);
      continue;
    }
    const nativeHome = join(home, agent === "opencode" ? ".config/opencode" : `.${agent}`);
    // Absent agent configuration has only the known default roots. Do not
    // inspect another account's installed runtime through an ambient PATH.
    if (!lstatSync(nativeHome, { throwIfNoEntry: false })) continue;
    roots.push(...resolveAgentDiscovery({ home, agent, canonical: physicalPath }).roots);
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
  // Compare both sides physically: the destination may name the real target
  // of ~/.codex, without spelling any recognizable native path components.
  const defaults = NATIVE_DISCOVERY_ROOTS.map(parts => join(home, ...parts));
  defaults.push(join(home, ".codex/plugins/cache"), join(home, ".claude/plugins/cache"), join(home, ".claude/plugins/synced"), join(home, ".gemini/extensions"));
  for (const root of defaults) {
    if (candidates.some(candidate => contains(resolve(root), candidate) || contains(physicalPath(root), candidate))) native ??= root;
  }
  if (native) {
    throw new Error(`Refusing portable Skills authoring below native discovery root '${native}': ${lexical}. Set HASNA_SKILLS_DIR to a private authoring corpus outside native roots.`);
  }
  for (const root of configuredRoots(home, options.homeDir !== undefined)) {
    if (candidates.some(candidate => contains(resolve(root), candidate) || contains(physicalPath(root), candidate))) {
      throw new Error(`Refusing portable Skills authoring below configured native discovery root: ${lexical}`);
    }
  }
}
