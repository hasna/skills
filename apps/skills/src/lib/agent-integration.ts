import { reviewCodexPluginControls, reviewedCodexPluginSourceRoots, isReviewedCodexPluginInactive, isReviewedCodexPluginSkillDisabled, reviewedCodexPluginCapabilitiesUnchanged, disableReviewedCodexPluginNames, type CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";
import { projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
import { upgradeCodexSettingsWitness, readCodexSettingsPreimage, CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";
import { upgradeClaudeSettingsWitness } from "./claude-settings-witness.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { existsSync, lstatSync, statSync, mkdirSync, readFileSync, readdirSync, opendirSync, readlinkSync, realpathSync, renameSync, rmdirSync, writeFileSync, unlinkSync, chmodSync, openSync, closeSync, fsyncSync, fstatSync, readSync, constants, linkSync, type BigIntStats, type Dirent } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { getDataDir, getDataDirReadOnly } from "./config.js";
import { requiresCliSkillLoading, readManagedSkillPolicySnapshot, serializeManagedSkillPolicy, parseManagedSkillPolicy } from "./managed-policy.js";
import { CLI_BRIDGE_NAME, CLI_BRIDGE_FILES, CLI_BRIDGE_DIGEST, CLI_BRIDGE_VERSION, isOwnedCliBridge } from "./agent-bridge.js";
import { assertProjectDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, rebindAgentDiscovery, captureDiscoveryDirectories, projectNativeDiscoveryFields, type AgentDiscoveryBinding, type DiscoverySource, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, renderAgentHookCommand, renderOpenCodePlugin, type IntegrationAgent } from "./agent-adapters.js";
import { assertCodexPathConfigEditable, CODEX_SKILL_CONFIG_SECTIONS, disableCodexBundledSkills, normalizeCodexInlinePathConfig } from "./agent-codex.js";

import { HERMES_OPT_OUT, parseHermesConfig, configureHermesHooks, assertHermesProtection, renderHermesSupervisor, assertNoHermesLegacyShadow, type HermesSupervisorBinding } from "./agent-hermes.js";
import type { CodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { assertClaudeHookEventsReplacement, type ClaudeCoordinatedHookEvent } from "./claude-settings-witness.js";

export type { IntegrationAgent } from "./agent-adapters.js";
export type ContextHookEvent = "UserPromptSubmit" | "SessionStart" | "SubagentStart";
export interface AgentRootAlias { agent: IntegrationAgent; home: string; alias: string; target: string; link: string; aliasIdentity: string; targetIdentity: string }
export interface NativeSkillEntry { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; system?: boolean; bridge?: boolean; bridgeHome?: string; rootAlias?: AgentRootAlias }
export interface NativeMigrationTarget { agent: string; projectRoot: string; path: string; treeSha256: string; vendor?: true }
export interface NativeMigrationTargetManifest { schema: "hasna.skills-native-migration-targets.v1"; targets: NativeMigrationTarget[]; digest: string }
export interface AgentConfigChange { path: string; before: string | null; after: string }
export interface AgentIntegrationPlan { observedNativeSources?: Array<{ path: string; sha256: string }>; codexPluginSkillReview?: { version: string; cwd: string; catalogSha256: string; configSha256: string | null }; observedSettings?: { path: string; before: string }; settingsWitnessUpgrade?: { agent: "claude" | "codex"; path: string; fromHashMode: string; fromSha256: string; toHashMode: string; toSha256: string; reviewedPreimage: string; currentSettingsSha256: string; replacedWitnesses: Array<{ hashMode: string; sha256: string }> }; dataDir: string; profileId: string; changes: AgentConfigChange[]; nativeSkills: NativeSkillEntry[]; observedPolicy?: { path: string; before: string | null }; discoveryBefore?: AgentDiscoveryBinding[]; discoveryAfter?: AgentDiscoveryBinding[]; rootAliases?: AgentRootAlias[]; managedAgentChecks?: { home: string; agents: IntegrationAgent[] }; retainedReviewChecks?: { home: string; projectDir: string; agents: IntegrationAgent[] } }

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const HOOK_EVENTS: readonly ContextHookEvent[] = ["UserPromptSubmit", "SessionStart", "SubagentStart"];
const ROOTS = NATIVE_SKILL_ROOTS;

/** Darwin acl_get_fd reports an absent extended ACL as NULL/ENOENT. The
 * descriptor is already bound to a verified directory, so ENOENT cannot mean
 * a missing pathname. Any ACL (including another principal's), unsupported
 * capability, or other error is refused. The native module is loaded only in
 * this Darwin-only path; canonical paths and other platforms do not need it.
 * Contract: Apple Libc posix1e/acl_file.c and gen/filesec.c (FILESEC_ACL). */
function hasNoDarwinAcl(fd: number): boolean {
  try {
    const { dlopen, read } = require("bun:ffi") as typeof import("bun:ffi");
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      acl_get_fd: { args: ["i32"], returns: "ptr" },
      acl_free: { args: ["ptr"], returns: "i32" },
      __error: { args: [], returns: "ptr" },
    });
    try {
      const errno = library.symbols.__error();
      if (!errno) return false;
      const acl = library.symbols.acl_get_fd(fd);
      if (acl) { library.symbols.acl_free(acl); return false; }
      return (acl === null || acl === 0) && read.i32(errno) === 2; // ENOENT in Darwin's sys/errno.h.
    } finally { library.close(); }
  } catch { return false; }
}

/** macOS installs exactly these aliases. Ownership alone never admits a link:
 * its spelling, target and both containing directories must also be trusted. */
function isSystemRootAlias(path: string): boolean {
  if (process.platform !== "darwin" || !["/var", "/tmp", "/etc"].includes(path)) return false;
  const target = `/private${path}`, link = `private${path}`;
  const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.uid}:${stat.mode}`;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isSymbolicLink() || before.uid !== 0n || readlinkSync(path) !== link) return false;
    const directories = ["/", "/private", target].map(directory => {
      const stat = lstatSync(directory, { bigint: true });
      if (!stat.isDirectory() || stat.uid !== 0n) throw new Error("Untrusted system alias directory");
      // /private/tmp is intentionally writable; its sticky bit protects its
      // children. The alias itself is replaceable only through /, and its
      // destination only through /private, neither of which may be writable.
      if (directory !== "/private/tmp") {
        if ((stat.mode & 0o022n) !== 0n) throw new Error("Writable system alias directory");
      } else if ((stat.mode & 0o1000n) === 0n) throw new Error("Unprotected system temporary directory");
      const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        if (identity(fstatSync(fd, { bigint: true })) !== identity(stat) || !hasNoDarwinAcl(fd)
          || identity(fstatSync(fd, { bigint: true })) !== identity(stat)) throw new Error("Unverified system alias directory ACL");
      } finally { closeSync(fd); }
      return { directory, identity: identity(stat) };
    });
    return realpathSync(path) === target && readlinkSync(path) === link
      && identity(lstatSync(path, { bigint: true })) === identity(before)
      && directories.every(item => identity(lstatSync(item.directory, { bigint: true })) === item.identity);
  } catch { return false; }
}

/** Normalize only the verified OS prefix, never hide user-controlled links. */
function canonicalSystemPath(path: string): string {
  const absolute = resolve(path), root = `/${absolute.split(sep)[1]}`;
  if (process.platform !== "darwin" || !["/var", "/tmp", "/etc"].includes(root) || !lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink()) return absolute;
  if (!isSystemRootAlias(root)) throw new Error(`Refusing symlink path: ${root}`);
  return `/private${absolute}`;
}

function assertSafePath(path: string): void {
  let cursor = resolve(path);
  while (true) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink() && !isSystemRootAlias(cursor)) throw new Error(`Refusing symlink path: ${cursor}`);
    const parent = dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}

/** Opt-in applies only to the two recognized home roots, never their contents. */
function readRootAlias(home: string, agent: IntegrationAgent): AgentRootAlias {
  assertSafePath(home);
  const realHome = realpathSync(home), alias = join(realHome, `.${agent}`);
  const stat = lstatSync(alias, { throwIfNoEntry: false, bigint: true });
  if (!stat?.isSymbolicLink()) throw new Error(`Agent root alias changed after planning: ${alias}`);
  const link = readlinkSync(alias), targetPath = resolve(dirname(alias), link);
  // Refuse chained or nested aliases even if realpath would hide them.
  assertSafePath(targetPath);
  const targetStat = lstatSync(targetPath, { throwIfNoEntry: false });
  if (!targetStat?.isDirectory()) throw new Error(`Agent root alias must target an existing directory: ${alias}`);
  const target = realpathSync(targetPath), inside = relative(realHome, target);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Agent root alias target must be inside the real home: ${alias}`);
  return { agent, home: realHome, alias, target, link, aliasIdentity: `${stat.dev}:${stat.ino}:${stat.ctimeNs}`, targetIdentity: `${targetStat.dev}:${targetStat.ino}` };
}

function rootAliases(home: string, allowed = false): AgentRootAlias[] {
  if (!allowed) return [];
  const result: AgentRootAlias[] = [];
  for (const agent of ["claude", "codex"] as const) if (lstatSync(join(home, `.${agent}`), { throwIfNoEntry: false })?.isSymbolicLink()) result.push(readRootAlias(home, agent));
  if (result.some((item, index) => result.slice(index + 1).some(other => item.target === other.target || item.target.startsWith(other.target + sep) || other.target.startsWith(item.target + sep)))) throw new Error("Agent root alias targets must not overlap");
  return result;
}

function canonicalAgentPath(path: string, aliases: AgentRootAlias[]): string {
  const absolute = canonicalSystemPath(path), binding = aliases.find(item => absolute === item.alias || absolute.startsWith(item.alias + sep));
  return binding ? join(binding.target, relative(binding.alias, absolute)) : absolute;
}

function disabledCodexSkillPaths(config: { skills?: { config?: Array<{ path?: string; name?: string; enabled?: boolean }> } }, aliases: AgentRootAlias[]): string[] {
  const skills = config.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) return [];
  const rows = skills.config;
  if (!Array.isArray(rows)) return [];
  // A malformed row can invalidate Codex's whole SkillsConfig layer. Never
  // treat a disable in that layer as native proof in that case.
  if (rows.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry)
    || typeof entry.enabled !== "boolean"
    || (entry.path !== undefined) === (entry.name !== undefined)
    || (entry.path !== undefined && (typeof entry.path !== "string" || !isAbsolute(entry.path)))
    || (entry.name !== undefined && (typeof entry.name !== "string" || !entry.name.trim())))) return [];
  // Codex applies name rules after path rules in the same ordered list. Without
  // the parsed skill name, a name rule could re-enable a path we thought inert.
  if (rows.some(entry => entry.name !== undefined && entry.enabled !== false)) return [];
  const settings = new Map<string, boolean[]>();
  for (const entry of rows) {
    if (typeof entry.path !== "string" || !isAbsolute(entry.path)) continue;
    // Native Codex canonicalizes the document selector, so a `latest` path
    // and its versioned path are the same rule. Only an existing exact document
    // is evidence that the native skill is disabled; a directory is not.
    let document: string;
    try { document = realpathSync(canonicalAgentPath(entry.path, aliases)); } catch { continue; }
    if (!document.endsWith(`${sep}SKILL.md`)) continue;
    settings.set(document, [...(settings.get(document) ?? []), entry.enabled === false]);
  }
  return [...settings].filter(([, values]) => values.length === 1 && values[0] === true).map(([document]) => dirname(document));
}

function recheckRootAliases(aliases: AgentRootAlias[]): void {
  for (const binding of aliases) {
    if (!["claude", "codex"].includes(binding.agent) || binding.alias !== join(binding.home, `.${binding.agent}`)) throw new Error("Invalid agent root alias binding");
    const current = readRootAlias(binding.home, binding.agent);
    if (JSON.stringify(current) !== JSON.stringify(binding)) throw new Error(`Agent root alias changed after planning: ${binding.alias}`);
  }
}

/** Ownership hashing must not follow a replacement link or block on a FIFO. */
function readNativeBytes(path: string, maximum = 64 * 1024 * 1024): Buffer {
  assertSafePath(path);
  const before = lstatSync(path);
  if (!before.isFile() || before.size > maximum) throw new Error("Unsupported or oversized native skill file");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("Native skill file changed while reading");
    const bytes = Buffer.allocUnsafe(before.size + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor), current = lstatSync(path);
    if (current.dev !== opened.dev || current.ino !== opened.ino || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs || length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Native skill file changed while reading");
    return bytes.subarray(0, length);
  } finally { closeSync(descriptor); }
}

/** Hash every relative filename and byte; refuse links, devices, and oversized migration input. */
function treeHash(root: string): string {
  const hash = createHash("sha256"); let bytes = 0, files = 0;
  function visit(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in skill: ${path}`);
    const rel = relative(root, path);
    if (stat.isDirectory()) { hash.update(`d\0${rel}\0`); for (const name of readdirSync(path).sort()) visit(join(path, name)); return; }
    if (!stat.isFile()) throw new Error(`Unsupported skill file: ${path}`);
    bytes += stat.size; files++;
    if (bytes > 64 * 1024 * 1024 || files > 10000) throw new Error("Native skill exceeds migration size limits");
    hash.update(`f\0${rel}\0${stat.size}\0`); hash.update(readNativeBytes(path, stat.size));
  }
  assertSafePath(root); visit(root); return hash.digest("hex");
}

/** Parse the reviewed exact-target binding used by native migration. Paths are
 * deliberately project-relative so a manifest cannot silently select another
 * checkout when a project root changes. */
export function parseNativeMigrationTargetManifest(input: string | Buffer): NativeMigrationTargetManifest {
  const digest = sha(input);
  let value: unknown;
  try { value = JSON.parse(input.toString()); } catch { throw new Error("Invalid native migration target manifest JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native migration target manifest");
  const record = value as Record<string, unknown>;
  if (record.schema !== "hasna.skills-native-migration-targets.v1" || Object.keys(record).some(key => !["schema", "targets"].includes(key))) throw new Error("Unsupported native migration target manifest schema");
  if (!Array.isArray(record.targets) || record.targets.length === 0 || record.targets.length > 1000) throw new Error("Native migration target manifest must contain 1 to 1000 targets");
  const targets: NativeMigrationTarget[] = [];
  const identities = new Set<string>();
  for (const target of record.targets) {
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("Invalid native migration target");
    const item = target as Record<string, unknown>;
    if (Object.keys(item).some(key => !["agent", "projectRoot", "path", "treeSha256", "vendor"].includes(key)) || typeof item.agent !== "string" || typeof item.projectRoot !== "string" || typeof item.path !== "string" || typeof item.treeSha256 !== "string" || (item.vendor !== undefined && item.vendor !== true)) throw new Error("Invalid native migration target fields");
    // Migration covers recognized native roots, including inventory-only agents
    // whose historical copies need retirement without adding hook support.
    if (!ROOTS.some(([agent]) => agent === item.agent)) throw new Error(`Unsupported native migration target agent: ${item.agent}`);
    if (!isAbsolute(item.projectRoot) || resolve(item.projectRoot) !== item.projectRoot) throw new Error(`Native migration target project root must be an existing absolute directory: ${item.projectRoot}`);
    const projectRoot = canonicalSystemPath(item.projectRoot);
    if (!existsSync(projectRoot) || !lstatSync(projectRoot).isDirectory()) throw new Error(`Native migration target project root must be an existing absolute directory: ${item.projectRoot}`);
    assertSafePath(projectRoot);
    if (isAbsolute(item.path) || item.path.includes("\\") || item.path.length === 0 || item.path.includes("\0")) throw new Error(`Native migration target path must be normalized and project-relative: ${item.path}`);
    const resolved = resolve(projectRoot, item.path), normalized = relative(projectRoot, resolved);
    if (!normalized || normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized) || normalized !== item.path) throw new Error(`Native migration target path escapes or is not normalized: ${item.path}`);
    if (!/^[0-9a-f]{64}$/.test(item.treeSha256)) throw new Error(`Invalid native migration tree digest for ${item.path}`);
    const identity = `${item.agent}\0${canonicalSystemPath(projectRoot)}\0${normalized}`;
    if (identities.has(identity)) throw new Error(`Duplicate native migration target: ${item.path}`);
    identities.add(identity);
    targets.push({ agent: item.agent, projectRoot, path: normalized, treeSha256: item.treeSha256, ...(item.vendor === true ? { vendor: true as const } : {}) });
  }
  return { schema: "hasna.skills-native-migration-targets.v1", targets, digest };
}

/** Read a manifest without following links or opening special files, with a
 * finite bound so a CLI cannot block on an untrusted path. */
export function readNativeMigrationTargetManifest(path: string): NativeMigrationTargetManifest {
  return parseNativeMigrationTargetManifest(readNativeBytes(path, 4 * 1024 * 1024));
}

/** Validate every reviewed target before any archive directory or journal is created. */
export function selectNativeMigrationTargets(inventory: NativeSkillEntry[], manifest: NativeMigrationTargetManifest): NativeSkillEntry[] {
  if (manifest.schema !== "hasna.skills-native-migration-targets.v1" || !/^[0-9a-f]{64}$/.test(manifest.digest) || !Array.isArray(manifest.targets) || manifest.targets.length === 0) throw new Error("Invalid native migration target manifest");
  const identities = new Set<string>();
  const selected: NativeSkillEntry[] = [];
  for (const target of manifest.targets) {
    if (!isAbsolute(target.projectRoot) || resolve(target.projectRoot) !== target.projectRoot) throw new Error(`Native migration target project root must be an existing absolute directory: ${target.projectRoot}`);
    const projectRoot = canonicalSystemPath(target.projectRoot), normalized = relative(projectRoot, resolve(projectRoot, target.path));
    if (!existsSync(projectRoot) || !lstatSync(projectRoot).isDirectory()) throw new Error(`Native migration target project root must be an existing absolute directory: ${target.projectRoot}`);
    assertSafePath(projectRoot);
    if (isAbsolute(target.path) || target.path.includes("\\") || target.path.includes("\0") || !normalized || normalized === ".." || normalized.startsWith(`..${sep}`) || normalized !== target.path || !/^[0-9a-f]{64}$/.test(target.treeSha256)) throw new Error(`Invalid native migration target: ${target.path}`);
    const identity = `${target.agent}\0${canonicalSystemPath(projectRoot)}\0${normalized}`;
    if (identities.has(identity)) throw new Error(`Duplicate native migration target: ${target.path}`);
    identities.add(identity);
    const expected = canonicalSystemPath(resolve(target.projectRoot, target.path));
    const matches = inventory.filter(entry => entry.agent === target.agent && resolve(entry.path) === expected);
    if (matches.length !== 1) throw new Error(`Native migration target was not found exactly once: ${target.agent} ${target.projectRoot}/${target.path}`);
    const entry = matches[0]!;
    if (entry.bridge || entry.system || entry.vendor !== (target.vendor === true)) throw new Error(`Native migration target is protected or vendor classification changed: ${entry.path}`);
    if (entry.hash !== target.treeSha256 || treeHash(entry.path) !== target.treeSha256) throw new Error(`Native migration target changed after review: ${entry.path}`);
    selected.push(entry);
  }
  return selected;
}

/** Native project discovery includes each ancestor; migration must inspect the same roots as hooks. */
function projectAncestorDirectories(projects: string[]): string[] {
  const directories = new Set<string>();
  for (const project of projects) {
    for (let path = canonicalSystemPath(project), depth = 0; ; depth++) {
      if (depth >= 100) throw new Error("NATIVE_SKILL_DRIFT: project ancestor discovery limit exceeded");
      directories.add(path);
      const parent = dirname(path); if (parent === path) break; path = parent;
    }
  }
  return [...directories];
}

export function inventoryNativeSkills(home = homedir(), options: { includeVendor?: boolean; guardHermes?: boolean; projectDir?: string; projectDirs?: string[]; agents?: readonly IntegrationAgent[]; agentRoots?: Array<{ agent: string; path: string }>; configured?: boolean; discoveryInputs?: ReviewedDiscoveryInputs; allowRootAliases?: boolean; reviewedCacheAlias?: string; disabledVendorPaths?: readonly string[]; disabledVendorSkill?: (entry: NativeSkillEntry) => boolean; codexInstallationInputRoots?: readonly string[] } = {}): NativeSkillEntry[] {
  home = canonicalSystemPath(home);
  if (options.reviewedCacheAlias !== undefined && (!options.includeVendor || !isAbsolute(options.reviewedCacheAlias) || resolve(options.reviewedCacheAlias) !== options.reviewedCacheAlias)) throw new Error("A reviewed cache alias requires vendor inventory and an exact absolute path");
  if (options.disabledVendorPaths?.some(path => !isAbsolute(path) || resolve(path) !== path)) throw new Error("Disabled vendor paths must be exact absolute paths");
  const reviewedCacheAlias = options.reviewedCacheAlias === undefined ? undefined : canonicalSystemPath(options.reviewedCacheAlias);
  const disabledVendorPaths = new Set((options.disabledVendorPaths ?? []).map(canonicalSystemPath));
  const aliases = rootAliases(home, options.allowRootAliases);
  const selectedAgents = options.agents ? new Set(options.agents) : undefined;
  const includesAgent = (agent: string) => !selectedAgents || selectedAgents.has(agent as IntegrationAgent);
  const rootDefinitions = selectedAgents
    ? ROOTS.filter(([agent, path]) => selectedAgents.has(agent as IntegrationAgent) || (selectedAgents.has("hermes") && agent === "codex" && path === ".agents/skills"))
    : ROOTS;
  const roots: Array<readonly [string, string]> = rootDefinitions.map(([agent, path]) => [agent, canonicalAgentPath(join(home, path), aliases)]);
  const bridgePaths = Object.values(AGENT_ADAPTERS).map(adapter => canonicalAgentPath(join(home, adapter.root, CLI_BRIDGE_NAME), aliases));
  for (const project of projectAncestorDirectories([...(options.projectDirs ?? []), ...(options.projectDir ? [options.projectDir] : [])])) {
    for (const [agent, path] of rootDefinitions) roots.push([agent, canonicalAgentPath(join(project, path), aliases)]);
  }
  const installationInputs=options.codexInstallationInputRoots ?? [];
  if (installationInputs.some(input=>resolve(input)!==input || realpathSync(input)!==input || roots.some(([agent,path])=>agent==="codex" && (path===input || path.startsWith(input+sep) || input.startsWith(path+sep))))) throw new Error("Native installation input overlaps an unconditional skill-loading root");
  const entries: NativeSkillEntry[] = [], seen = new Set<string>();
  type Scan = { complete: boolean; hasSkills: boolean; entries: number };
  const cacheScans = new Map<string, Scan>(), maxAliasProofEntries = 10000;
  let discoveryEntries = 0, discoveryPathBytes = 0;
  function admit(path: string): void {
    if (++discoveryEntries > 20000) throw new Error("Native skill discovery entry limit exceeded");
    discoveryPathBytes += Buffer.byteLength(path, "utf8");
    if (discoveryPathBytes > 4 * 1024 * 1024) throw new Error("Native skill discovery metadata limit exceeded");
  }
  let reviewedCacheAliasFound = false;
  function verifiedSiblingCacheAlias(agent: string, path: string, parent: string): boolean {
    const link = readlinkSync(path), lexicalTarget = resolve(parent, link);
    // A lexical normalization must not conceal an intermediate symlink escape.
    if (isAbsolute(link) ? link !== lexicalTarget : dirname(link) !== ".") return false;
    const target = canonicalSystemPath(lexicalTarget);
    if (dirname(target) !== parent) return false;
    if (!lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) return false;
    const scan = cacheScans.get(target);
    if (!scan?.complete || scan.entries > maxAliasProofEntries) return false;
    if (scan.hasSkills) {
      // A native plugin may retain a `latest` link after Skills has disabled
      // every real skill below its fully inventoried version. The link adds no
      // discovery in that case. A new or enabled skill still fails closed.
      const targetSkills = entries.filter(entry => entry.agent === agent && entry.vendor && (entry.path === target || entry.path.startsWith(target + sep)));
      if (path === reviewedCacheAlias && targetSkills.length > 0) reviewedCacheAliasFound = true;
      if (agent === "codex" && targetSkills.length > 0 && targetSkills.every(entry => disabledVendorPaths.has(entry.path) || options.disabledVendorSkill?.(entry) === true)) return true;
      // A plugin's `latest` link may point at a fully inventoried version.
      // Only migration opts in to that exact link so it can archive the real
      // SKILL.md; ordinary hook checks continue to refuse the native copy.
      if (path !== reviewedCacheAlias) return false;
    }
    return true;
  }
  function visit(agent: string, path: string, vendor = false, depth = 0, pluginCache = false, admitted = false, configuredRoot = false): Scan {
    if (!admitted) admit(path);
    const scan: Scan = { complete: true, hasSkills: false, entries: 1 };
    assertSafePath(path);
    if (configuredRoot && agent === "codex" && installationInputs.some(root => path === root || path.startsWith(`${root}${sep}`))) return scan;
    if (!existsSync(path)) return scan;
    const stat = lstatSync(path);
    if (stat.isFile()) return scan;
    if (!stat.isDirectory()) throw new Error(`Unsupported native discovery entry: ${path}`);
    if (existsSync(join(path, "SKILL.md"))) {
      scan.hasSkills = true;
      if (seen.has(path)) return scan; seen.add(path);
      let managed = false;
      const marker = join(path, ".hasna-skills.json");
      if (existsSync(marker)) { try { managed = JSON.parse(readFileSync(marker, "utf8")).managedBy === "@hasna/skills"; } catch { /* Unrecognized markers grant no ownership. */ } }
      const bridge = !vendor && isOwnedCliBridge(path, bridgePaths);
      const rootAlias = aliases.find(item => path === item.target || path.startsWith(item.target + sep));
      entries.push({ agent, path, hash: treeHash(path), managed, vendor, ...(agent === "codex" && path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep) ? { system: true } : {}), ...(bridge ? { bridge: true, bridgeHome: resolve(home) } : {}), ...(rootAlias ? { rootAlias } : {}) }); return scan;
    }
    if (depth > (vendor ? 32 : 3)) return { ...scan, complete: false };
    // Retired vendor documents leave their shared assets in place. Bound the
    // entire discovery walk before retaining or sorting directory entries.
    const children: Dirent[] = [], directory = opendirSync(path);
    try {
      let child: Dirent | null;
      while ((child = directory.readSync()) !== null) { admit(join(path, child.name)); children.push(child); }
    } finally { directory.closeSync(); }
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    // Complete real sibling scans before considering cache aliases, regardless
    // of their names. Never recurse through an alias to discover its contents.
    if (pluginCache) children.sort((a, b) => Number(a.isSymbolicLink()) - Number(b.isSymbolicLink()));
    for (const { name } of children) {
      if (name === "node_modules") continue;
      if (name.startsWith(".") && name !== ".system" && agent !== "hermes" && !(options.guardHermes && `${path}${sep}`.includes(`${sep}.agents${sep}skills${sep}`))) continue;
      const isVendor = vendor || name === ".system";
      if (isVendor && !options.includeVendor) continue;
      const child = join(path, name);
      // Vendor containers can have linked metadata beside their skills. Follow
      // only for target metadata; never read its bytes or descend through the
      // link. Real skills return through treeHash above, which refuses all links.
      if (isVendor && lstatSync(child, { throwIfNoEntry: false })?.isSymbolicLink()) {
        const target = statSync(child, { throwIfNoEntry: false });
        if (target?.isFile() || (pluginCache && target?.isDirectory() && verifiedSiblingCacheAlias(agent, child, path))) {
          scan.entries++; continue;
        }
      }
      const childScan = visit(agent, child, isVendor, depth + 1, pluginCache, true, configuredRoot);
      scan.complete &&= childScan.complete; scan.hasSkills ||= childScan.hasSkills; scan.entries += childScan.entries;
    }
    if (pluginCache) cacheScans.set(path, scan);
    return scan;
  }
  function scanRoot(agent: string, path: string, vendor = false, pluginCache = false, configuredRoot = false): void {
    if (agent === "hermes" || (options.guardHermes && `${path}${sep}`.includes(`${sep}.agents${sep}skills${sep}`))) assertNoHermesLegacyShadow(path);
    if (!visit(agent, path, vendor, 0, pluginCache, false, configuredRoot).complete) throw new Error(`Native skill discovery limit exceeded; review this root before continuing: ${path}`);
  }
  for (const [agent, path] of roots) scanRoot(agent, path);
  if (options.includeVendor) {
    for (const agent of ["codex", "claude"].filter(includesAgent)) scanRoot(agent, canonicalAgentPath(join(home, `.${agent}`, "plugins", "cache"), aliases), true, true);
    if (includesAgent("claude")) scanRoot("claude", canonicalAgentPath(join(home, ".claude", "plugins", "synced"), aliases), true);
    if (includesAgent("gemini")) scanRoot("gemini", join(home, ".gemini", "extensions"), true);
  }
  const configured = options.configured ? INTEGRATION_AGENTS.filter(includesAgent).flatMap(agent => resolveAgentDiscovery({ home, agent, reviewed: options.discoveryInputs, canonical: path => canonicalAgentPath(path, aliases) }).roots.map(path => ({ agent, path }))) : [];
  for (const root of [...(options.agentRoots ?? []), ...configured]) if (includesAgent(root.agent)) scanRoot(root.agent, canonicalAgentPath(root.path, aliases), true, false, true);
  if (options.reviewedCacheAlias !== undefined && !reviewedCacheAliasFound) throw new Error("Reviewed cache alias was not an inventoried skill-containing sibling alias");
  recheckRootAliases(aliases);
  return entries;
}

function readOptional(path: string): string | null {
  assertSafePath(path); return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function jsonObject(text: string | null, path: string): Record<string, any> {
  if (text === null) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Invalid JSON configuration: ${path}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected configuration object: ${path}`);
  return value;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

function configureHooks(config: Record<string, any>, agent: IntegrationAgent, command: string, profileId: string, nativeReady: boolean): void {
  config.hooks ??= {};
  if (typeof config.hooks !== "object" || Array.isArray(config.hooks)) throw new Error("Expected hooks configuration object");
  for (const event of AGENT_ADAPTERS[agent].events) {
    const existing: unknown = config.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Expected ${event} hooks array`);
    const hookCommand = renderAgentHookCommand(command, agent, profileId, event);
    if (agent === "codex") {
      // Native trust keys include both group and handler indexes. Replace the
      // one owned group in place: removing it and appending its replacement
      // would silently change every later unrelated hook's native identity.
      let ownedIndex = -1;
      for (const [index, entry] of existing.entries()) {
        if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
        const owned = entry.hooks.filter((hook: any) => hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent codex(?: --selection-profile [A-Za-z0-9._-]+)?(?: --event [A-Za-z]+)?$/.test(hook.command));
        if (!owned.length) continue;
        if (ownedIndex !== -1 || entry.hooks.length !== 1 || Object.keys(entry).length !== 1) throw new Error(`Review ambiguous ${event} Codex Skills hook groups before installation; unrelated native hook positions must be preserved`);
        ownedIndex = index;
      }
      const replacement = { hooks: [{ type: "command", command: hookCommand, timeout: 15 }] };
      config.hooks[event] = ownedIndex === -1 ? [...existing, replacement] : existing.map((entry: any, index: number) => index === ownedIndex ? replacement : entry);
      continue;
    }
    const retained = existing.flatMap((entry: any) => {
      if (agent === "cursor") {
        if (!entry || typeof entry.command !== "string") throw new Error(`Malformed ${event} hook entry`);
        return /(?:^|\s)hook user-prompt --agent cursor(?:\s|$)/.test(entry.command) ? [] : [entry];
      }
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
      const hooks = entry.hooks.filter((hook: any) => !(hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent (?:claude|codex|gemini)(?: --selection-profile [A-Za-z0-9._-]+)?(?: --event [A-Za-z]+)?$/.test(hook.command)));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    retained.push(agent === "cursor" ? { command: hookCommand, timeout: 15 } : { hooks: [{ type: "command", command: hookCommand, timeout: agent === "gemini" ? 15000 : 15 }] });
    config.hooks[event] = retained;
  }
  if (agent === "claude") {
    config.permissions ??= {};
    if (typeof config.permissions !== "object" || Array.isArray(config.permissions)) throw new Error("Expected permissions configuration object");
    const denied: unknown = config.permissions.deny ?? [];
    if (!Array.isArray(denied)) throw new Error("Expected permission deny array");
    const allowed: unknown = config.permissions.allow ?? [];
    if (!Array.isArray(allowed)) throw new Error("Expected permission allow array");
    config.permissions.deny = nativeReady ? denied.filter(rule => rule !== "Skill") : [...new Set([...denied, "Skill"])];
    config.permissions.allow = nativeReady ? [...new Set([...allowed, `Skill(${CLI_BRIDGE_NAME})`])] : allowed;
    config.disableBundledSkills = true;
    // Claude account sync can recreate native copies independently of bundled
    // skills. This setting must live in user settings; project settings cannot disable it.
    config.syncClaudeAiSkills = false;
  }
  if (agent === "gemini") {
    config.skills ??= {};
    if (!config.skills || typeof config.skills !== "object" || Array.isArray(config.skills)) throw new Error("Expected skills configuration object");
    const disabled = config.skills.disabled ?? [];
    if (!Array.isArray(disabled) || disabled.some(value => typeof value !== "string")) throw new Error("Expected disabled skills array");
    config.skills.enabled = true;
    config.skills.disabled = [...new Set([...disabled.filter(name => name !== CLI_BRIDGE_NAME), "antigravity-support", "skill-creator"])];
    if (config.hooksConfig?.enabled === false) throw new Error("Gemini hooks are disabled; enable them before installing the Skills bridge");
  }
  if (agent === "cursor") config.version = 1;
  if (agent === "claude" || agent === "gemini") {
    const event = agent === "claude" ? "PreToolUse" : "BeforeTool", matcher = agent === "claude" ? "Skill" : "activate_skill";
    const existing = config.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Expected ${event} hooks array`);
    const retained = existing.flatMap((entry: any) => {
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`Malformed ${event} hook entry`);
      const hooks = entry.hooks.filter((hook: any) => !(hook?.type === "command" && typeof hook.command === "string" && /(?:^|\s)hook user-prompt --agent (?:claude|gemini) --selection-profile [A-Za-z0-9._-]+ --event (?:PreToolUse|BeforeTool)$/.test(hook.command)));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    config.hooks[event] = [...retained, { matcher, hooks: [{ type: "command", command: renderAgentHookCommand(command, agent, profileId, event), timeout: agent === "gemini" ? 15000 : 15 }] }];
  }
}

function disableCodexSkills(text: string, skills: NativeSkillEntry[], aliases: AgentRootAlias[], bridgePath: string): string {
  const bundled = disableCodexBundledSkills(text);
  let result = normalizeCodexInlinePathConfig(bundled);
  const bridgeSelector = (entry: { path?: string; name?: string }) => (typeof entry.name === "string" && entry.name.trim() === CLI_BRIDGE_NAME) || (typeof entry.path === "string" && [resolve(bridgePath), resolve(join(bridgePath, "SKILL.md"))].includes(canonicalAgentPath(entry.path, aliases)));
  const previousConfig = (Bun.TOML.parse(bundled) as { skills?: { config?: Array<{ path?: string; name?: string; enabled?: boolean }> } }).skills?.config;
  if (previousConfig !== undefined && (!Array.isArray(previousConfig) || previousConfig.some(entry => !entry || typeof entry !== "object" || (entry.path !== undefined && entry.name !== undefined)))) throw new Error("Codex skill controls require one path or name selector per [[skills.config]] entry; review ambiguous entries before running skills hook install");
  const bridgeNeedsRepair = previousConfig?.some(entry => entry.enabled === false && bridgeSelector(entry));
  const selections = [...skills.filter(entry => entry.agent === "codex" && !entry.bridge).map(skill => ({ path: skill.path, enabled: false })), { path: bridgePath, enabled: true }];
  for (const skill of selections) {
    const path = join(skill.path, "SKILL.md"); let found = false;
    result = result.replace(CODEX_SKILL_CONFIG_SECTIONS, section => {
      const parsed = Bun.TOML.parse(section) as { skills?: { config?: Array<{ path?: string; name?: string }> } };
      const declared = parsed.skills?.config?.[0];
      if (!declared || !(skill.enabled && bridgeSelector(declared)) && !(typeof declared.path === "string" && [resolve(path), resolve(skill.path)].includes(canonicalAgentPath(declared.path, aliases)))) return section;
      found = true;
      return /^\s*enabled\s*=/m.test(section) ? section.replace(/^\s*enabled\s*=.*$/m, `enabled = ${skill.enabled}`) : `${section.trimEnd()}\nenabled = ${skill.enabled}\n`;
    });
    if (!found && !skill.enabled) result = `${result.trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
  }
  if (result !== bundled || bridgeNeedsRepair) assertCodexPathConfigEditable(bundled);
  Bun.TOML.parse(result); return result;
}

function assertCodexInstallationInputs(home:string, projectDirs:string[], inputs:string[]):void {
  const nativeRoots=[home,...projectAncestorDirectories(projectDirs)].flatMap(directory=>ROOTS.filter(([agent])=>agent==="codex").map(([,path])=>resolve(directory,path)));
  if (inputs.some(input=>nativeRoots.some(root=>root===input || root.startsWith(input+sep) || input.startsWith(root+sep)))) throw new Error("Native installation input overlaps an unconditional skill-loading root");
}

/** Planning is read-only; credentials and unrelated settings never appear in CLI output. */
export function planAgentIntegration(options: { home?: string; dataDir?: string; agents: IntegrationAgent[]; command?: string; profileId?: string; includeVendor?: boolean; projectDir?: string; discoveryInputs?: ReviewedDiscoveryInputs; allowRootAliases?: boolean; reviewedCacheAlias?: string; codexNativeCatalog?: CodexNativeSkillCatalog }): AgentIntegrationPlan {
  const home = options.home ?? homedir(), dataDir = options.dataDir ?? getDataDirReadOnly();
  const aliases = rootAliases(home, options.allowRootAliases);
  const policyPath = join(dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const priorSnapshot = readManagedSkillPolicySnapshot(dataDir), previousPolicy = priorSnapshot?.text ?? null, policy = priorSnapshot?.value ?? {};
  if (policy.bridge !== undefined && (!policy.bridge || typeof policy.bridge !== "object" || Array.isArray(policy.bridge))) throw new Error("Invalid existing Skills bridge policy");
  if (policy.bridge?.agents !== undefined && (!Array.isArray(policy.bridge.agents) || policy.bridge.agents.some((agent: unknown) => !INTEGRATION_AGENTS.includes(agent as IntegrationAgent)))) throw new Error("Invalid existing bridge agent inventory");
  for (const field of ["commands", "profiles"]) if (policy.bridge?.[field] !== undefined && (!policy.bridge[field] || typeof policy.bridge[field] !== "object" || Array.isArray(policy.bridge[field]) || Object.entries(policy.bridge[field]).some(([key, value]) => !INTEGRATION_AGENTS.includes(key as IntegrationAgent) || typeof value !== "string" || !value || value.includes("\0")))) throw new Error(`Invalid existing bridge ${field} binding`);
  const priorAgents: IntegrationAgent[] = policy.bridge?.agents ?? [];
  const profileId = options.profileId ?? policy.profileId ?? "default";
  const validateProfile = (value: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) throw new Error("Invalid selection profile id");
  };
  validateProfile(profileId);
  // Omitted options retain each managed agent's choices. Legacy agents used
  // the policy-wide profile; newly added agents still get installation defaults.
  const bindings = new Map([...new Set(options.agents)].map(agent => {
    const command = options.command ?? policy.bridge?.commands?.[agent] ?? "skills";
    const profileId = options.profileId ?? policy.bridge?.profiles?.[agent] ?? (priorAgents.includes(agent) ? policy.profileId : undefined) ?? "default";
    validateProfile(profileId);
    return [agent, { command, profileId }] as const;
  }));
  const retainedAgents: IntegrationAgent[] = [];
  const discoveries = [...new Set(options.agents)].map(agent => {
    const retainedReview: AgentDiscoveryBinding | undefined = options.discoveryInputs === undefined && policy.bridge?.discovery?.[agent]?.method === "reviewed" ? policy.bridge.discovery[agent] : undefined;
    if (retainedReview) {
      // A saved review is usable only in its current managed home, with the
      // original bridge protections, aliases and native trust still intact.
      assertManagedAgentBridge(agent, { home, dataDir, projectDir: options.projectDir ?? home });
      retainedAgents.push(agent);
    }
    return resolveAgentDiscovery({ home, agent, reviewed: options.discoveryInputs, retainedReview, canonical: path => canonicalAgentPath(path, aliases) });
  });
  const codexConfig = options.agents.includes("codex") ? Bun.TOML.parse(readOptional(canonicalAgentPath(join(home, ".codex", "config.toml"), aliases)) ?? "") as { plugins?: unknown; skills?: { config?: Array<{ path?: string; enabled?: boolean }> } } : {};
  const nativeSkills = inventoryNativeSkills(home, { includeVendor: true, guardHermes: options.agents.includes("hermes"), agents: options.agents, projectDir: options.projectDir, agentRoots: discoveries.flatMap(binding => binding.roots.map(path => ({ agent: binding.agent, path }))), allowRootAliases: options.allowRootAliases, reviewedCacheAlias: options.reviewedCacheAlias, disabledVendorPaths: disabledCodexSkillPaths(codexConfig, aliases) });
  const observedNativeSources: Array<{ path: string; sha256: string }> = [];
  const codexPluginControls: ReturnType<typeof reviewCodexPluginControls> = options.codexNativeCatalog
    ? reviewCodexPluginControls(options.codexNativeCatalog, nativeSkills.filter(entry=>entry.agent==="codex" && entry.vendor).map(entry=>join(entry.path,"SKILL.md")), canonicalAgentPath(join(home,".codex/plugins/cache"),aliases), resolve(options.projectDir ?? home), path=>{const bytes=readNativeBytes(path,1024*1024); observedNativeSources.push({path,sha256:sha(bytes)}); return new TextDecoder("utf-8",{fatal:true}).decode(bytes); }, codexConfig.skills?.config ?? [], codexConfig.plugins)
    : {skills:policy.bridge?.codexPluginSkills ?? [],inactivePlugins:policy.bridge?.codexInactivePlugins ?? [],sourceInputs:policy.bridge?.discovery?.codex?.codexInstallationInputs?.plugins ?? []};
  const codexPluginSkills: CodexPluginSkillControl[] = codexPluginControls.skills;
  const codexInactivePlugins = codexPluginControls.inactivePlugins;
  const codexDiscovery=discoveries.find(binding=>binding.agent==="codex");
  const codexPluginSourceInputs = codexPluginControls.sourceInputs.filter(input=>codexDiscovery?.method==="reviewed"
    && codexDiscovery.roots.some(root=>root===input.sourceRoot || root.startsWith(input.sourceRoot+sep) || input.sourceRoot.startsWith(root+sep))
    && codexDiscovery.sources.some(source=>source.path===join(input.sourceRoot,".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined));
  assertCodexInstallationInputs(home,[options.projectDir ?? home],codexPluginSourceInputs.map(input=>input.sourceRoot));
  const changes: AgentConfigChange[] = [];
  for (const agent of [...new Set(options.agents)]) {
    if (!INTEGRATION_AGENTS.includes(agent)) throw new Error(`Unsupported agent: ${agent}`);
    const { command, profileId } = bindings.get(agent)!;
    const adapter = AGENT_ADAPTERS[agent];
    const bridgePath = canonicalAgentPath(join(home, adapter.root, CLI_BRIDGE_NAME), aliases);
    assertSafePath(bridgePath);
    if (existsSync(bridgePath) && !isOwnedCliBridge(bridgePath, [bridgePath])) throw new Error(`Refusing to overwrite an unrecognized or modified Skills bridge: ${bridgePath}`);
    for (const [name, after] of Object.entries(CLI_BRIDGE_FILES)) {
      const path = join(bridgePath, name), before = readOptional(path);
      if (before !== after) changes.push({ path, before, after });
    }
    const path = canonicalAgentPath(join(home, adapter.config), aliases);
    const before = readOptional(path);
    if (agent === "hermes") {
      const supervisorPath = join(dataDir, "agent-hooks", "hermes.js"), supervisorBefore = readOptional(supervisorPath), supervisorAfter = renderHermesSupervisor(command, profileId);
      const priorCommand = policy.bridge?.commands?.hermes, priorProfile = policy.bridge?.profiles?.hermes ?? policy.profileId;
      const previous = policy.bridge?.supervisors?.hermes as HermesSupervisorBinding | undefined;
      if (supervisorBefore !== null && supervisorBefore !== supervisorAfter && !(previous?.path === supervisorPath && typeof priorCommand === "string" && typeof priorProfile === "string" && supervisorBefore === renderHermesSupervisor(priorCommand, priorProfile))) throw new Error("Refusing to overwrite an unrecognized Hermes supervisor");
      if (supervisorBefore !== supervisorAfter) changes.push({ path: supervisorPath, before: supervisorBefore, after: supervisorAfter });
      const supervisor = { path: supervisorPath, runtime: process.execPath, sha256: sha(supervisorAfter) };
      const after = configureHermesHooks(before, supervisor, previous);
      if (before !== after) changes.push({ path, before, after });
      const optOut = join(home, ".hermes", HERMES_OPT_OUT), optOutBefore = readOptional(optOut);
      if (optOutBefore === null) changes.push({ path: optOut, before: null, after: "Managed by @hasna/skills: bundled native skill reseeding is disabled.\n" });
      continue;
    }
    const config = jsonObject(before, path);
    if (agent === "opencode") {
      const permission = config.permission ?? {};
      if (!permission || typeof permission !== "object" || Array.isArray(permission)) throw new Error("Expected OpenCode permission object");
      config.permission = { ...permission, skill: { "*": "deny", [CLI_BRIDGE_NAME]: "allow" } };
      const pluginPath = join(home, ".config", "opencode", "plugins", "skills-cli.js"), pluginBefore = readOptional(pluginPath);
      const pluginAfter = renderOpenCodePlugin(command, profileId);
      const priorCommand = policy.bridge?.commands?.opencode;
      const ownedPrevious = typeof priorCommand === "string" && typeof policy.profileId === "string" && pluginBefore === renderOpenCodePlugin(priorCommand, policy.bridge?.profiles?.opencode ?? policy.profileId);
      if (pluginBefore !== null && pluginBefore !== pluginAfter && !ownedPrevious) throw new Error("Refusing to overwrite a modified OpenCode Skills plugin; preserve and review it first");
      if (pluginBefore !== pluginAfter) changes.push({ path: pluginPath, before: pluginBefore, after: pluginAfter });
    } else configureHooks(config, agent, command, profileId, !nativeSkills.some(entry => entry.agent === agent && !entry.bridge));
    if (agent === "gemini") config.skills.disabled = [...new Set([...config.skills.disabled, ...(discoveries.find(binding => binding.agent === agent)?.builtinNames ?? [])])];
    const after = `${JSON.stringify(config, null, 2)}\n`;
    if (before !== after) changes.push({ path, before, after });
    if (agent === "codex") {
      const configPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases), previous = readOptional(configPath);
      const next = disableReviewedCodexPluginNames(disableCodexSkills(previous ?? "", nativeSkills, aliases, bridgePath), codexPluginSkills);
      if (next !== (previous ?? "")) changes.push({ path: configPath, before: previous, after: next });
    }
  }
  const codexPluginSkillReview = options.codexNativeCatalog ? { version: options.codexNativeCatalog.version, cwd: options.codexNativeCatalog.cwd, catalogSha256: sha(JSON.stringify({version:options.codexNativeCatalog.version,cwd:options.codexNativeCatalog.cwd,skills:projectCodexNativeSkillCatalog({data:[{cwd:options.codexNativeCatalog.cwd,errors:[],skills:options.codexNativeCatalog.skills}]},options.codexNativeCatalog.cwd),...(options.codexNativeCatalog.plugins === undefined ? {} : {plugins:projectCodexInstalledPluginEntries(options.codexNativeCatalog.plugins)})})), configSha256: changes.find(change=>change.path===canonicalAgentPath(join(home,".codex/config.toml"),aliases))?.before === null ? null : sha(readOptional(canonicalAgentPath(join(home,".codex/config.toml"),aliases)) ?? "") } : policy.bridge?.codexPluginSkillReview;
  const discoveryAfter = discoveries.map(binding => {
    const rebound=rebindAgentDiscovery(binding, new Map(changes.map(change => [change.path, change.after])));
    if (binding.agent!=="codex") return rebound;
    const {codexInstallationInputs:previousInputs,...current}=rebound;
    const inputs=codexPluginSourceInputs.map(input=>input.sourceRoot);
    const directories=options.codexNativeCatalog || !previousInputs ? captureDiscoveryDirectories((binding.directories ?? []).filter(directory=>inputs.some(root=>root.startsWith(directory.path+sep))).map(directory=>directory.path),inputs) : previousInputs.directories;
    return codexPluginSourceInputs.length ? {...current,codexInstallationInputs:{version:"codex-cli 0.160.0" as const,catalogSha256:codexPluginSkillReview.catalogSha256,plugins:codexPluginSourceInputs,...(directories?.length ? {directories} : {})}} : current;
  });
  const nextPolicy = { ...policy, version: 1, loading: "cli", profileId, bridge: {
    ...policy.bridge,
    version: CLI_BRIDGE_VERSION, digest: CLI_BRIDGE_DIGEST,
    agents: [...new Set([...priorAgents, ...options.agents])].sort(),
    home: resolve(home), includeVendor: true,
    ...(options.agents.includes("hermes") ? { supervisors: { ...policy.bridge?.supervisors, hermes: { path: join(dataDir, "agent-hooks", "hermes.js"), runtime: process.execPath, sha256: sha(renderHermesSupervisor(bindings.get("hermes")!.command, bindings.get("hermes")!.profileId)) } } } : {}),
    commands: { ...policy.bridge?.commands, ...Object.fromEntries([...bindings].map(([agent, binding]) => [agent, binding.command])) },
    profiles: Object.fromEntries([...new Set<IntegrationAgent>([...priorAgents, ...options.agents])].sort().map(agent => [agent, bindings.get(agent)?.profileId ?? policy.bridge?.profiles?.[agent] ?? policy.profileId])),
    disabledBuiltins: options.agents.includes("codex") ? nativeSkills.filter(entry => entry.agent === "codex" && entry.vendor && entry.path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep)).map(entry => ({ path: entry.path, hash: entry.hash })) : (policy.bridge?.disabledBuiltins ?? []),
    rootAliases: aliases,
    ...(options.codexNativeCatalog || codexPluginSkills.length || codexInactivePlugins.length || codexPluginSourceInputs.length ? { codexPluginSkills, codexInactivePlugins, codexPluginSkillReview } : {}),
    discovery: { ...policy.bridge?.discovery, ...Object.fromEntries(discoveryAfter.map(binding => [binding.agent, binding])) },
  } };
  const serializedPolicy = serializeManagedSkillPolicy(nextPolicy);
  if (JSON.stringify(policy) !== JSON.stringify(nextPolicy)) changes.push({ path: policyPath, before: previousPolicy, after: serializedPolicy });
  recheckRootAliases(aliases);
  return { dataDir, profileId, changes, nativeSkills, ...(observedNativeSources.length ? { observedNativeSources } : {}), ...(nextPolicy.bridge.codexPluginSkillReview ? { codexPluginSkillReview: nextPolicy.bridge.codexPluginSkillReview } : {}), observedPolicy: { path: policyPath, before: previousPolicy }, discoveryBefore: discoveries, discoveryAfter, ...(aliases.length ? { rootAliases: aliases } : {}), ...(retainedAgents.length ? { retainedReviewChecks: { home, projectDir: options.projectDir ?? home, agents: retainedAgents } } : {}) };
}

/** Plan an explicitly authorized Stop hook replacement without adopting drift.
 * The caller owns authorization of its exact Stop hook delta; Skills refuses
 * every other settings change and owns discovery witnesses and guarded writes.
 * No policy means this installer has no Skills integration to update.
 */
export interface ClaudeHookUpdateOptions {
  home?: string; dataDir?: string; expectedSettingsSha256: string;
  replacement: string;
}
export function planClaudeStopHookUpdate(options: ClaudeHookUpdateOptions): AgentIntegrationPlan | null {
  return planClaudeHookEventsUpdate({ ...options, events: ["Stop"] });
}
/** Cooperating safety installers may replace only PreToolUse. The caller owns
 * its exact hook authorization; Skills retains discovery and native guards. */
export function planClaudePreToolUseHookUpdate(options: ClaudeHookUpdateOptions): AgentIntegrationPlan | null {
  return planClaudeHookEventsUpdate({ ...options, events: ["PreToolUse"] });
}

/** Limit runtime trust checks to consumers of this write, never discovery
 * verification. The complete policy and every source/directory remain checked.
 * OpenCode has an explicit Claude compatibility surface; include it even when
 * its current sources do not declare the settings file. Unknown directory/root
 * readers remain conservative. A path-bytes reader intersecting this write is
 * refused separately by rebindAgentDiscovery rather than silently renewed.
 */
function claudeSettingsConsumers(home: string, path: string, discoveries: AgentDiscoveryBinding[], aliases: AgentRootAlias[]): IntegrationAgent[] {
  const canonical = (value: string) => canonicalAgentPath(value, aliases);
  const containsSettings = (root: string) => {
    const distance = relative(canonical(root), path);
    return distance === "" || distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
  };
  return discoveries.filter(binding => binding.agent === "claude" || binding.agent === "opencode"
    || canonical(join(home, AGENT_ADAPTERS[binding.agent].config)) === path
    || binding.sources.some(source => canonical(source.path) === path)
    || binding.roots.some(containsSettings)
    || binding.directories?.some(directory => containsSettings(directory.path)))
    .map(binding => binding.agent);
}

/** Automatic discovery closure is independent of native runtime trust. Keep
 * checking it even for a consumer whose settings this transaction does not edit.
 */
function verifyCoordinatedDiscovery(binding: AgentDiscoveryBinding, home: string, aliases: AgentRootAlias[]): void {
  try {
    if (binding.method !== "automatic" && binding.method !== "reviewed") throw new Error("Invalid managed discovery method");
    verifyAgentDiscovery(binding);
    if (binding.method === "automatic") {
      const current = resolveAgentDiscovery({ home, agent: binding.agent, canonical: path => canonicalAgentPath(path, aliases) });
      if (JSON.stringify(current) !== JSON.stringify(binding)) throw new Error("Configured native discovery roots changed during Claude update");
    }
  } catch (error) { throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message}`); }
}

export function planClaudeHookEventsUpdate(options: ClaudeHookUpdateOptions & { events: readonly ClaudeCoordinatedHookEvent[] }): AgentIntegrationPlan | null {
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  const policyPath = join(dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot) return null;
  const policy = snapshot.value, bridge = policy.bridge;
  if (!bridge || bridge.home !== home || bridge.version !== CLI_BRIDGE_VERSION || bridge.digest !== CLI_BRIDGE_DIGEST
    || !Array.isArray(bridge.agents) || !bridge.agents.length
    || bridge.agents.some((agent: unknown) => !INTEGRATION_AGENTS.includes(agent as IntegrationAgent))
    || new Set(bridge.agents).size !== bridge.agents.length
    || !bridge.discovery || typeof bridge.discovery !== "object" || Array.isArray(bridge.discovery)) {
    throw new Error("Invalid managed bridge for Claude settings update");
  }
  const aliases: AgentRootAlias[] = bridge.rootAliases ?? [];
  recheckRootAliases(aliases);
  const path = canonicalAgentPath(join(home, ".claude", "settings.json"), aliases);
  assertSafePath(path);
  const before = lstatSync(path, { throwIfNoEntry: false })
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readNativeBytes(path, 1024 * 1024)) : null;
  if ((before === null ? "absent" : sha(before)) !== options.expectedSettingsSha256) throw new Error("Claude settings preimage changed");
  // Reviewed roots cannot be re-used for changed plugin/discovery semantics.
  // Preserve every field outside the owned event, including preferences ignored by an
  // explicitly chosen semantic witness; never broaden the witness's mode.
  assertClaudeHookEventsReplacement(before, options.replacement, options.events);
  const agents = bridge.agents as IntegrationAgent[];
  const discoveries: AgentDiscoveryBinding[] = Object.entries(bridge.discovery).map(([agent, binding]) => {
    if (!agents.includes(agent as IntegrationAgent) || (binding as AgentDiscoveryBinding)?.agent !== agent
      || typeof bridge.commands?.[agent] !== "string" || typeof bridge.profiles?.[agent] !== "string") throw new Error("Invalid managed discovery owner or command/profile binding");
    return binding as AgentDiscoveryBinding;
  });
  if (discoveries.length !== agents.length || !agents.includes("claude")) throw new Error("Missing managed Claude discovery coverage");
  // Raw rebinding recomputes hashes. Verify ALL old witnesses before any rebind
  // so an unrelated source change cannot be adopted by the narrower transaction.
  for (const binding of discoveries) verifyCoordinatedDiscovery(binding, home, aliases);
  const consumers = claudeSettingsConsumers(home, path, discoveries, aliases);
  for (const agent of consumers) assertManagedAgentBridge(agent, { home, dataDir, projectDir: home });
  const replacements = new Map(before === options.replacement ? [] : [[path, options.replacement]]);
  const discoveryAfter = discoveries.map(binding => {
    const next = rebindAgentDiscovery(binding, replacements);
    // Also refuse a source race between verification and rebinding. Preserve
    // every unrelated witness exactly, including bindings outside consumers.
    for (const [index, source] of binding.sources.entries()) {
      if (source.path !== path && JSON.stringify(next.sources[index]) !== JSON.stringify(source)) {
        throw new Error(`Unrelated native discovery input changed during Claude update: ${source.path}`);
      }
    }
    return JSON.stringify(next) === JSON.stringify(binding) ? binding : next;
  });
  const nextPolicy = { ...policy, bridge: { ...bridge, discovery: Object.fromEntries(discoveryAfter.map(binding => [binding.agent, binding])) } };
  const changes: AgentConfigChange[] = before === options.replacement ? [] : [{ path, before, after: options.replacement }];
  if (JSON.stringify(nextPolicy) !== JSON.stringify(policy)) changes.push({ path: policyPath, before: snapshot.text, after: serializeManagedSkillPolicy(nextPolicy) });
  recheckRootAliases(aliases);
  const nativeSkills = inventoryNativeSkills(home, { agents: consumers, projectDir: home, includeVendor: true,
    guardHermes: consumers.includes("hermes"), allowRootAliases: aliases.length > 0,
    agentRoots: discoveries.filter(binding => consumers.includes(binding.agent)).flatMap(binding => binding.roots.map(path => ({ agent: binding.agent, path }))) });
  return { dataDir, profileId: policy.profileId ?? "default", changes, nativeSkills,
    observedPolicy: { path: policyPath, before: snapshot.text }, discoveryBefore: discoveries,
    discoveryAfter, rootAliases: aliases, managedAgentChecks: { home, agents: consumers } };
}

function atomicWrite(path: string, content: string): void {
  assertSafePath(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.skills-${randomUUID()}`;
  try { writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Explicitly rebind one legacy review after exact preimage and semantic comparison.
 * Runtime readers never relax the old witness. All other discovery sources,
 * unknown settings, native controls and policy bytes remain guarded.
 */
export function planAgentSettingsWitnessUpgrade(options: { agent: "claude" | "codex"; reviewedPreimage: string; home?: string; dataDir?: string; projectDir?: string; expectedPolicySha256: string; expectedSettingsSha256: string }): AgentIntegrationPlan {
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot || sha(snapshot.text) !== options.expectedPolicySha256) throw new Error("Managed policy preimage changed");
  const policy = snapshot.value, aliases: AgentRootAlias[] = policy.bridge?.rootAliases ?? [];
  recheckRootAliases(aliases);
  const binding: AgentDiscoveryBinding | undefined = policy.bridge?.discovery?.[options.agent];
  if (!binding || binding.agent !== options.agent || binding.method !== "reviewed") throw new Error("Settings witness upgrade requires an existing reviewed native binding");
  const configPath = canonicalAgentPath(join(home, options.agent === "claude" ? ".claude/settings.json" : ".codex/config.toml"), aliases);
  const settings = readOptional(configPath);
  if (settings === null || sha(settings) !== options.expectedSettingsSha256) throw new Error("Native settings preimage changed");
  const sources = binding.sources.filter(source => source.path === configPath && source.format === undefined && source.fields === undefined);
  if (sources.length !== 1) throw new Error("Settings witness upgrade requires one exact settings source");
  const previous = sources[0]!;
  if (typeof previous.sha256 !== "string") throw new Error("Settings witness upgrade requires a preserved settings preimage");
  // A typed Codex witness replaces every witness of the same file: the exact
  // reviewed source and the automatic TOML projection, which is order-sensitive
  // and therefore stops matching as soon as Codex re-serializes the file it owns.
  const replaced: DiscoverySource[] = [previous];
  if (options.agent === "codex") {
    if (previous.hashMode !== undefined && previous.hashMode !== "bytes" && previous.hashMode !== "codex-settings-v1") throw new Error("Codex settings witness upgrade requires a preserved raw or codex-settings-v1 configuration witness");
    const preimage = readCodexSettingsPreimage(options.reviewedPreimage);
    for (const source of binding.sources) {
      if (source === previous || source.path !== configPath) continue;
      const fields = source.fields;
      if (source.hashMode !== undefined || source.format !== "toml" || !Array.isArray(fields) || !isDeepStrictEqual(fields, [...CODEX_DISCOVERY_PROJECTION_FIELDS]) || typeof source.sha256 !== "string") throw new Error("Codex settings witness upgrade found an unrecognized configuration witness");
      // The preserved preimage must explain the narrower witness as well, so a
      // projection can only be dropped when the review provably covered it.
      if (projectNativeDiscoveryFields(preimage, "toml", fields, configPath) !== source.sha256) throw new Error("Reviewed preimage does not explain the Codex discovery projection witness");
      replaced.push(source);
    }
  }
  const next = options.agent === "claude"
    ? upgradeClaudeSettingsWitness(previous as Parameters<typeof upgradeClaudeSettingsWitness>[0], options.reviewedPreimage)
    : upgradeCodexSettingsWitness(previous as Parameters<typeof upgradeCodexSettingsWitness>[0], options.reviewedPreimage);
  const rebound: DiscoverySource[] = [];
  for (const source of binding.sources) {
    if (!replaced.includes(source)) { rebound.push(source); continue; }
    if (source === replaced[0]) rebound.push(next);
  }
  const replacement: AgentDiscoveryBinding = { ...binding, sources: rebound };
  // A proved semantic replacement is explicit in this plan. Verify every
  // unrelated source without rebinding it to whatever happens to be on disk.
  verifyAgentDiscovery(replacement);
  const after = serializeManagedSkillPolicy({ ...policy, bridge: { ...policy.bridge, discovery: { ...policy.bridge.discovery, [options.agent]: replacement } } });
  return { dataDir, profileId: policy.profileId, changes: [{ path: join(dataDir, "agent-policy.json"), before: snapshot.text, after }], nativeSkills: [], observedPolicy: { path: join(dataDir, "agent-policy.json"), before: snapshot.text }, observedSettings: { path: configPath, before: settings }, discoveryBefore: [replacement], discoveryAfter: [replacement], rootAliases: aliases, managedAgentChecks: { home, agents: [options.agent] }, settingsWitnessUpgrade: { agent: options.agent, path: configPath, fromHashMode: previous.hashMode ?? "bytes", fromSha256: previous.sha256, toHashMode: next.hashMode, toSha256: next.sha256, reviewedPreimage: options.reviewedPreimage, currentSettingsSha256: options.expectedSettingsSha256, replacedWitnesses: replaced.map(source => ({ hashMode: source.hashMode ?? "bytes", sha256: source.sha256! })) } };
}

export function applyAgentIntegration(plan: AgentIntegrationPlan): { changed: string[]; backups: string[]; rootAliases?: AgentRootAlias[] } {
  for (const source of plan.observedNativeSources ?? []) if (sha(readNativeBytes(source.path,1024*1024)) !== source.sha256) throw new Error("Native identity source changed after planning");
  if (plan.observedSettings && readOptional(plan.observedSettings.path) !== plan.observedSettings.before) throw new Error("Native settings changed after witness planning");
  // Refuse an unusable policy before creating backups or changing native config.
  const policyPath = join(plan.dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const currentText = (path: string) => resolve(path) === resolve(policyPath) ? readManagedSkillPolicySnapshot(plan.dataDir)?.text ?? null : readOptional(path);
  readManagedSkillPolicySnapshot(plan.dataDir);
  for (const change of plan.changes) if (resolve(change.path) === resolve(policyPath)) parseManagedSkillPolicy(change.after);
  const aliases = plan.rootAliases ?? [];
  recheckRootAliases(aliases);
  // Verify the old trust before writing. An explicit command/profile change
  // still uses the ordinary native approval flow for its newly installed hook.
  for (const agent of plan.retainedReviewChecks?.agents ?? []) assertManagedAgentBridge(agent, { ...plan.retainedReviewChecks!, dataDir: plan.dataDir });
  let provenDiscovery: AgentDiscoveryBinding | undefined;
  if (plan.settingsWitnessUpgrade) {
    const upgrade = plan.settingsWitnessUpgrade;
    if (!plan.managedAgentChecks || !plan.observedPolicy?.before) throw new Error("Invalid settings witness upgrade plan");
    const verified = planAgentSettingsWitnessUpgrade({ agent: upgrade.agent, reviewedPreimage: upgrade.reviewedPreimage, home: plan.managedAgentChecks.home, dataDir: plan.dataDir, expectedPolicySha256: sha(plan.observedPolicy.before), expectedSettingsSha256: upgrade.currentSettingsSha256 });
    if (JSON.stringify(verified.changes) !== JSON.stringify(plan.changes) || JSON.stringify(verified.settingsWitnessUpgrade) !== JSON.stringify(upgrade)) throw new Error("Settings witness upgrade plan changed");
    provenDiscovery = verified.discoveryBefore![0];
  }
  for (const agent of plan.managedAgentChecks?.agents ?? []) assertManagedAgentBridgeWithDiscovery(agent, { home: plan.managedAgentChecks!.home, dataDir: plan.dataDir, projectDir: plan.managedAgentChecks!.home }, provenDiscovery?.agent === agent ? provenDiscovery : undefined);
  for (const binding of plan.discoveryBefore ?? []) {
    if (plan.managedAgentChecks) verifyCoordinatedDiscovery(binding, plan.managedAgentChecks.home, aliases);
    else verifyAgentDiscovery(binding);
  }
  if (plan.observedPolicy && currentText(plan.observedPolicy.path) !== plan.observedPolicy.before) throw new Error("Agent policy changed after planning");
  for (const change of plan.changes) if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
  const backupRoot = join(plan.dataDir, "migration", randomUUID()), backups: string[] = [], written: AgentConfigChange[] = [], createdDirectories = new Set<string>();
  if (!plan.changes.length) {
    recheckRootAliases(aliases);
    return { changed: [], backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
  }
  assertSafePath(backupRoot); mkdirSync(backupRoot, { recursive: true, mode: 0o700 }); chmodSync(backupRoot, 0o700);
  for (const [index, change] of plan.changes.entries()) if (change.before !== null) {
    const backup = join(backupRoot, `${index}-${sha(change.path).slice(0, 12)}.backup`);
    writeFileSync(backup, change.before, { mode: 0o600, flag: "wx" });
    if (readFileSync(backup, "utf8") !== change.before) throw new Error("Native configuration preservation readback failed");
    backups.push(backup);
  }
  try {
    for (const change of plan.changes) {
      recheckRootAliases(aliases);
      if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
      for (let directory = dirname(change.path); !existsSync(directory); directory = dirname(directory)) createdDirectories.add(directory);
      const after = change.after;
      atomicWrite(change.path, after); written.push({ path: change.path, before: change.before, after });
    }
    recheckRootAliases(aliases);
    for (const source of plan.observedNativeSources ?? []) if (sha(readNativeBytes(source.path,1024*1024)) !== source.sha256) throw new Error("Native identity source changed during application");
    if (plan.observedSettings && readOptional(plan.observedSettings.path) !== plan.observedSettings.before) throw new Error("Native settings changed during witness application");
    for (const binding of plan.discoveryAfter ?? []) {
      if (plan.managedAgentChecks) verifyCoordinatedDiscovery(binding, plan.managedAgentChecks.home, aliases);
      else verifyAgentDiscovery(binding);
    }
    for (const agent of plan.managedAgentChecks?.agents ?? []) assertManagedAgentBridge(agent, { home: plan.managedAgentChecks!.home, dataDir: plan.dataDir, projectDir: plan.managedAgentChecks!.home });
    atomicWrite(join(backupRoot, "receipt.json"), JSON.stringify({ version: 1, changes: written.map(change => ({ path: change.path, beforeHash: change.before === null ? null : sha(change.before), afterHash: sha(change.after) })), backups, ...(aliases.length ? { rootAliases: aliases } : {}) }) + "\n");
  } catch (error) {
    for (const change of written.reverse()) {
      // Do not erase a concurrent user's edit during compensation.
      // An unreadable or malformed replacement also belongs to that user;
      // preserve it while continuing to restore our other unchanged writes.
      let current: string | null;
      try { current = currentText(change.path); } catch { continue; }
      if (current !== change.after) continue;
      if (change.before === null) unlinkSync(change.path); else atomicWrite(change.path, change.before);
    }
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { rmdirSync(directory); } catch (cleanupError) {
        if (!["ENOENT", "ENOTEMPTY"].includes((cleanupError as NodeJS.ErrnoException).code ?? "")) throw cleanupError;
      }
    }
    throw error;
  }
  return { changed: plan.changes.map(change => change.path), backups, ...(aliases.length ? { rootAliases: aliases } : {}) };
}

function syncArchiveDirectory(path: string): void {
  assertSafePath(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** Persist the journal file and its containing directory before proceeding. */
function writeArchiveJournal(path: string, value: unknown): void {
  assertSafePath(path);
  const temporary = `${path}.skills-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path); syncArchiveDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

export function archiveNativeSkills(inventory: NativeSkillEntry[], options: { dataDir?: string; includeUnmanaged?: boolean; includeVendor?: boolean; allowRootAliases?: boolean; targetManifest?: NativeMigrationTargetManifest }): { entries: Array<{ source: string; archive: string; hash: string; discoveryOnly?: boolean }>; receiptPath?: string; rootAliases?: AgentRootAlias[]; targetManifest?: { schema: string; digest: string; targetCount: number } } {
  const aliases = [...new Map(inventory.filter(entry => entry.rootAlias).map(entry => [entry.rootAlias!.alias, entry.rootAlias!])).values()];
  if (aliases.length && !options.allowRootAliases) throw new Error("Native migration requires explicit allowRootAliases for agent root aliases");
  recheckRootAliases(aliases);
  // Recompute ownership before exempting it: a stale plan or a forged bridge
  // flag must not protect subsequently modified native instructions.
  for (const entry of inventory.filter(entry => entry.bridge)) {
    const adapter = AGENT_ADAPTERS[entry.agent as IntegrationAgent];
    const expected = adapter && entry.bridgeHome ? canonicalAgentPath(join(entry.bridgeHome, adapter.root, CLI_BRIDGE_NAME), aliases) : undefined;
    if (!expected || treeHash(entry.path) !== entry.hash || !isOwnedCliBridge(entry.path, [expected])) throw new Error(`Skills bridge changed after planning: ${entry.path}`);
  }
  const selected = options.targetManifest
    ? selectNativeMigrationTargets(inventory, options.targetManifest)
    : inventory.filter(entry => !entry.bridge && !entry.system && (entry.vendor ? options.includeVendor : entry.managed || options.includeUnmanaged));
  for (const entry of selected) if (treeHash(entry.path) !== entry.hash) throw new Error(`Native skill changed after planning: ${entry.path}`);
  const targetManifest = options.targetManifest ? { schema: options.targetManifest.schema, digest: options.targetManifest.digest, targetCount: options.targetManifest.targets.length } : undefined;
  if (!selected.length) return { entries: [], ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}) };
  const operationId = randomUUID(), archiveRoot = join(options.dataDir ?? getDataDir(), "migration", operationId, "native"), receiptPath = join(archiveRoot, "receipt.json");
  type Move = { source: string; archive: string; hash: string; discoveryOnly?: boolean; status: "planned" | "moving" | "archived" | "restored" | "recovery-required"; conflict?: string };
  const entries: Move[] = selected.map((entry, index) => ({
    source: entry.vendor ? join(entry.path, "SKILL.md") : entry.path,
    archive: join(archiveRoot, `${index}-${sha(entry.path).slice(0, 12)}`),
    hash: entry.vendor ? sha(readNativeBytes(join(entry.path, "SKILL.md"))) : entry.hash,
    ...(entry.vendor ? { discoveryOnly: true } : {}), status: "planned",
  }));
  const journal = { version: 2, operationId, status: "planned", entries, ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}) };
  const moved: Move[] = [];
  const verifyArchive = (entry: Move): void => {
    assertSafePath(entry.archive);
    const stat = lstatSync(entry.archive);
    if (entry.discoveryOnly ? !stat.isFile() : !stat.isDirectory()) throw new Error("Archive type changed");
    if ((entry.discoveryOnly ? sha(readNativeBytes(entry.archive)) : treeHash(entry.archive)) !== entry.hash) throw new Error("Archive bytes changed");
  };
  assertSafePath(archiveRoot);
  const created: string[] = [];
  for (let path = archiveRoot; !existsSync(path); path = dirname(path)) created.push(path);
  mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  try {
    for (const directory of created) syncArchiveDirectory(directory);
    if (created.length) syncArchiveDirectory(dirname(created.at(-1)!));
    writeArchiveJournal(receiptPath, journal);
    for (const [index, entry] of selected.entries()) {
      recheckRootAliases(aliases);
      if (treeHash(entry.path) !== entry.hash) throw new Error("Native skill changed after planning");
      const move = entries[index]!;
      journal.status = "archiving"; move.status = "moving"; writeArchiveJournal(receiptPath, journal);
      // Vendor discovery documents move alone; shared scripts/assets remain.
      renameSync(move.source, move.archive); moved.push(move);
      syncArchiveDirectory(dirname(move.source)); syncArchiveDirectory(archiveRoot);
      verifyArchive(move); move.status = "archived"; writeArchiveJournal(receiptPath, journal);
    }
    recheckRootAliases(aliases);
    for (const entry of moved) verifyArchive(entry);
    journal.status = "completed"; writeArchiveJournal(receiptPath, journal);
  } catch (error) {
    journal.status = "compensating";
    try { writeArchiveJournal(receiptPath, journal); } catch { /* The durable intent still names every source and archive. */ }
    for (const entry of [...moved].reverse()) {
      try {
        recheckRootAliases(aliases); assertSafePath(entry.source); assertSafePath(entry.archive);
        if (lstatSync(entry.source, { throwIfNoEntry: false })) { entry.status = "recovery-required"; entry.conflict = "source-occupied"; continue; }
        try { verifyArchive(entry); } catch { entry.status = "recovery-required"; entry.conflict = "archive-unverified"; continue; }
        if (entry.discoveryOnly) {
          // A hard link refuses EEXIST atomically, so a concurrent document wins.
          linkSync(entry.archive, entry.source); syncArchiveDirectory(dirname(entry.source)); unlinkSync(entry.archive);
        } else {
          // Portable directory rename has no no-replace option. Recheck directly
          // before it; callers must keep native writers quiescent during recovery.
          if (lstatSync(entry.source, { throwIfNoEntry: false })) { entry.status = "recovery-required"; entry.conflict = "source-occupied"; continue; }
          renameSync(entry.archive, entry.source);
        }
        entry.status = "restored";
        syncArchiveDirectory(dirname(entry.source)); syncArchiveDirectory(archiveRoot);
      } catch { entry.status = "recovery-required"; entry.conflict = "compensation-io"; }
      finally { try { writeArchiveJournal(receiptPath, journal); } catch { /* Preserve other recoverable entries even if journaling fails. */ } }
    }
    journal.status = "failed";
    try { writeArchiveJournal(receiptPath, journal); } catch { /* Inspect the last durable intent before retrying. */ }
    throw new Error(`Native archive failed; inspect the recovery journal at ${receiptPath} before retrying.`, { cause: error });
  }
  return { entries: entries.map(({ status, conflict, ...entry }) => entry), receiptPath, ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}) };
}

/** Run before any prompt context load. Missing ownership or reappearing native
 * discovery files require repair; verified cache availability is not an override. */
export function assertManagedAgentBridge(agent: IntegrationAgent, options: { home?: string; dataDir?: string; projectDir?: string; projectDirs?: string[]; profileId?: string; codexDiscoveryRecovery?: CodexHookDiscoveryRecovery } = {}): void {
  assertManagedAgentBridgeWithDiscovery(agent, options);
}

function assertManagedAgentBridgeWithDiscovery(agent: IntegrationAgent, options: { home?: string; dataDir?: string; projectDir?: string; projectDirs?: string[]; profileId?: string; codexDiscoveryRecovery?: CodexHookDiscoveryRecovery } = {}, provenDiscovery?: AgentDiscoveryBinding): void {
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  assertSafePath(join(dataDir, "agent-policy.json"));
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot) throw new Error("NATIVE_SKILL_DRIFT: install the Skills bridge with skills hook install");
  const binding = snapshot.value.bridge;
  if (!binding || binding.version !== CLI_BRIDGE_VERSION || binding.digest !== CLI_BRIDGE_DIGEST || binding.home !== home || !Array.isArray(binding.agents) || !binding.agents.includes(agent)) throw new Error("NATIVE_SKILL_DRIFT: the managed Skills bridge binding is missing or incompatible; run skills hook install");
  const aliases: AgentRootAlias[] = binding.rootAliases ?? [];
  if (!Array.isArray(aliases)) throw new Error("NATIVE_SKILL_DRIFT: invalid root alias binding");
  recheckRootAliases(aliases);
  const expected = canonicalAgentPath(join(home, AGENT_ADAPTERS[agent].root, CLI_BRIDGE_NAME), aliases);
  if (!isOwnedCliBridge(expected, [expected])) throw new Error("NATIVE_SKILL_DRIFT: the native Skills bridge is missing or modified; repair it before continuing");
  const roots = projectAncestorDirectories([options.projectDir ?? process.cwd(), ...(options.projectDirs ?? []), ...(agent === "hermes" && process.env.TERMINAL_CWD ? [process.cwd()] : [])]);
  const visible = (entry: NativeSkillEntry) => entry.agent === agent || (["codex", "gemini", "opencode", "hermes"].includes(agent) && entry.path.includes(`${sep}.agents${sep}skills${sep}`)) || (agent === "opencode" && entry.agent === "claude");
  const discovery: AgentDiscoveryBinding | undefined = provenDiscovery ?? binding.discovery?.[agent];
  assertProjectDiscovery(agent, [...roots], home, path => canonicalAgentPath(path, aliases), discovery);
  const configPath = canonicalAgentPath(join(home, AGENT_ADAPTERS[agent].config), aliases), config = agent === "hermes" ? parseHermesConfig(readOptional(configPath)) : jsonObject(readOptional(configPath), configPath);
  const command = binding.commands?.[agent], profile = binding.profiles?.[agent];
  if (typeof command !== "string" || typeof profile !== "string") throw new Error("NATIVE_SKILL_DRIFT: the native hook command/profile binding is missing");
  if (options.profileId !== undefined && options.profileId !== profile) throw new Error("NATIVE_SKILL_DRIFT: the hook selection profile differs from its managed binding; restart the native client after reviewing skills hook install");
  if (agent === "hermes") {
    const supervisor = binding.supervisors?.hermes;
    if (supervisor?.path !== join(dataDir, "agent-hooks", "hermes.js") || supervisor?.sha256 !== sha(renderHermesSupervisor(command, profile))) throw new Error("NATIVE_SKILL_DRIFT: Hermes supervisor binding changed; run skills hook install");
    assertHermesProtection(home, config, command, profile, supervisor);
  } else if (agent === "opencode") {
    if (JSON.stringify(config.permission?.skill) !== JSON.stringify({ "*": "deny", [CLI_BRIDGE_NAME]: "allow" }) || readOptional(join(home, ".config", "opencode", "plugins", "skills-cli.js")) !== renderOpenCodePlugin(command, profile)) throw new Error("NATIVE_SKILL_DRIFT: OpenCode bridge protection changed; run skills hook install");
  } else {
    const required: Record<string, any> = {}; configureHooks(required, agent, command, profile, true);
    for (const [event, entries] of Object.entries(required.hooks) as Array<[string, any[]]>) for (const entry of entries) {
      if (!Array.isArray(config.hooks?.[event]) || config.hooks[event].filter((actual: unknown) => JSON.stringify(actual) === JSON.stringify(entry)).length !== 1) throw new Error("NATIVE_SKILL_DRIFT: required native prompt/skill hooks changed; run skills hook install");
    }
    if (agent === "claude" && (config.disableBundledSkills !== true || config.disableAllHooks === true || !config.permissions?.allow?.includes(`Skill(${CLI_BRIDGE_NAME})`) || config.permissions?.deny?.includes("Skill"))) throw new Error("NATIVE_SKILL_DRIFT: Claude bridge or bundled-skill protection changed; retire copies and run skills hook install");
    if (agent === "claude" && config.syncClaudeAiSkills !== false) throw new Error("NATIVE_SKILL_DRIFT: Claude account skill synchronization is not disabled (syncClaudeAiSkills); run skills hook install to prevent native copies from returning");
    if (agent === "gemini" && (config.hooksConfig?.enabled === false || config.skills?.enabled !== true || !["antigravity-support", "skill-creator"].every(name => config.skills?.disabled?.includes(name)) || config.skills?.disabled?.includes(CLI_BRIDGE_NAME))) throw new Error("NATIVE_SKILL_DRIFT: Gemini bridge or bundled-skill protection changed; run skills hook install");
  }
  const codexPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases);
  if (options.codexDiscoveryRecovery && (agent !== "codex" || options.codexDiscoveryRecovery.configPath !== codexPath)) throw new Error("NATIVE_SKILL_DRIFT: Codex trust recovery names a different configuration root");
  const codexConfig = agent === "codex" ? Bun.TOML.parse(readOptional(codexPath) ?? "") as { plugins?: unknown; skills?: { bundled?: { enabled?: boolean }; config?: Array<{ path?: string; name?: string; enabled?: boolean }> } } : {};
  if (agent === "codex" && codexConfig.skills?.bundled?.enabled !== false) throw new Error("NATIVE_SKILL_DRIFT: Codex bundled skill reseeding is not disabled (skills.bundled.enabled); run skills hook install");
  const setting = (path: string) => (codexConfig.skills?.config ?? []).filter(entry => typeof entry.path === "string" && [path, join(path, "SKILL.md")].includes(canonicalAgentPath(entry.path, aliases)));
  if (agent === "codex" && [...setting(expected), ...(codexConfig.skills?.config ?? []).filter(entry => typeof entry.name === "string" && entry.name.trim() === CLI_BRIDGE_NAME)].some(entry => entry.enabled === false)) throw new Error("NATIVE_SKILL_DRIFT: the Codex CLI bridge is disabled; run skills hook install");
  if (agent === "codex" && !reviewedCodexPluginCapabilitiesUnchanged(canonicalAgentPath(join(home,".codex/plugins/cache"),aliases),binding.codexPluginSkills ?? [],path=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024)))) throw new Error("NATIVE_SKILL_DRIFT: reviewed native plugin capability controls changed; run skills hook install with a fresh discovery review");
  const disabledPlugin = (entry: NativeSkillEntry): boolean => {
    if (agent !== "codex" || !entry.vendor) return false;
    const document=join(entry.path,"SKILL.md"), cache=canonicalAgentPath(join(home,".codex/plugins/cache"),aliases), read=(path:string)=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024));
    return isReviewedCodexPluginInactive(document,cache,binding.codexInactivePlugins ?? [],codexConfig.plugins,codexConfig.skills?.config ?? [],read)
      || isReviewedCodexPluginSkillDisabled(document,cache,binding.codexPluginSkills ?? [],codexConfig.skills?.config,read);
  };
  const disabledPaths = new Set(disabledCodexSkillPaths(codexConfig, aliases));
  const disabledVendorSkill = (entry: NativeSkillEntry): boolean => {
    if (agent !== "codex" || !entry.vendor) return false;
    if ((binding.codexPluginSkills ?? []).some((control: CodexPluginSkillControl) => entry.path.startsWith(control.pluginParent + sep))) return disabledPlugin(entry);
    if (disabledPlugin(entry)) return true;
    if (!disabledPaths.has(entry.path)) return false;
    // Codex can refresh plugin caches after Skills archives their discovery
    // documents. Its exact per-skill disable setting prevents those files from
    // becoming native instructions when they reappear. The config is covered
    // by the verified discovery binding above; other roots still fail closed.
    if (entry.path.startsWith(canonicalAgentPath(join(home, ".codex", "plugins", "cache"), aliases) + sep)) return true;
    // The Codex app can also materialize its bundled marketplace beneath its
    // runtime cache. Admit only an exact disabled skill inside a verified,
    // automatically discovered plugin root; unrelated cache files still fail.
    const runtimeCache = canonicalAgentPath(join(home, ".cache", "codex-runtimes"), aliases);
    if (entry.path.startsWith(runtimeCache + sep) && discovery?.method === "automatic"
      && discovery.roots.some(root => entry.path.startsWith(root + sep))) return true;
    // The Codex app may materialize enabled bundled plugins in this temporary
    // marketplace. Only an exact disabled skill under a verified automatic
    // plugin root is inert; a new path or changed discovery source still fails.
    const bundledMarketplaces = canonicalAgentPath(join(home, ".codex", ".tmp", "bundled-marketplaces"), aliases);
    if (entry.path.startsWith(bundledMarketplaces + sep) && discovery?.method === "automatic"
      && discovery.roots.some(root => entry.path.startsWith(root + sep))) return true;
    if (!entry.path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep)) return false;
    return Array.isArray(binding.disabledBuiltins) && binding.disabledBuiltins.some((item: any) => item.path === entry.path && item.hash === entry.hash);
  };
  if (!discovery || discovery.agent !== agent) throw new Error("NATIVE_SKILL_DRIFT: native discovery coverage is missing; run skills hook install");
  if (agent === "gemini" && !discovery.builtinNames?.every(name => config.skills.disabled.includes(name))) throw new Error("NATIVE_SKILL_DRIFT: an installed Gemini builtin is not disabled");
  try {
    verifyAgentDiscovery(discovery, options.codexDiscoveryRecovery);
    if (discovery.method === "automatic") {
      const current = resolveAgentDiscovery({ home, agent, canonical: path => canonicalAgentPath(path, aliases) });
      if (JSON.stringify(current) !== JSON.stringify(discovery)) throw new Error("Configured native discovery roots changed");
    }
  } catch (error) { throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message}`); }
  let installationInputRoots:string[]=[];
  if (agent==="codex") {
    try {
      installationInputRoots=reviewedCodexPluginSourceRoots(canonicalAgentPath(join(home,".codex/plugins/cache"),aliases),discovery.codexInstallationInputs?.plugins ?? [],path=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024))); }
    catch { throw new Error("NATIVE_SKILL_DRIFT: native installation input identity changed; review discovery and catalog"); }
  }
  const inventory = inventoryNativeSkills(home, { includeVendor: true, guardHermes: agent === "hermes", agents: [agent], projectDirs: [...roots], agentRoots: discovery.roots.map(path => ({ agent, path })), allowRootAliases: aliases.length > 0, disabledVendorPaths: agent === "codex" ? disabledCodexSkillPaths(codexConfig, aliases) : [], disabledVendorSkill: disabledPlugin, codexInstallationInputRoots: installationInputRoots });
  const unexpected = inventory.filter(entry => visible(entry) && !entry.bridge && !disabledVendorSkill(entry));
  if (unexpected.length) {
    // Show filenames only: never read payloads into diagnostics. Escape control
    // characters and cap both path count and length for native hook output.
    const paths = unexpected.slice(0, 3).map(entry => {
      const escaped = JSON.stringify(entry.path).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
      return escaped.length > 768 ? `${escaped.slice(0, 384)}...${escaped.slice(-381)}` : escaped;
    });
    const remaining = unexpected.length - paths.length;
    throw new Error(`NATIVE_SKILL_DRIFT: ${unexpected.length} unexpected native skill copies were found: ${paths.join(", ")}${remaining ? `; ${remaining} more` : ""}. Review skills migrate native --project <working-directory> --include-unmanaged --include-vendor --json before continuing; it inventories that directory and its ancestors. Use --apply after reviewing the archive plan.`);
  }
  recheckRootAliases(aliases);
}

const SKILLS_LOADING_POLICY = "Skills loading policy: discover skills with `skills list` or `skills search`, and read selected instructions with `skills load <slug>`. Use `skills sync` to refresh the shared profile. The only native skill is the owned skills-cli bridge. Create and edit payload skills in the Skills authoring workspace; do not copy payload instructions into native discovery folders. Context loading does not authorize execution; use `skills run` only when the task calls for running a skill.";

export function normalizeAgentHookPrompt(agent: IntegrationAgent, event: string, prompt: string): string {
  // Gemini prepends SessionStart context to BeforeAgent.prompt. Exclude only
  // our exact leading policy from selection; arbitrary hook/user text survives.
  if (agent !== "gemini" || event !== "BeforeAgent") return prompt;
  const prefix = `<hook_context>${SKILLS_LOADING_POLICY}`;
  if (!prompt.startsWith(prefix)) return prompt;
  const remainder = prompt.slice(prefix.length);
  const closing = "</hook_context>\n\n";
  if (remainder.startsWith(closing)) return remainder.slice(closing.length);
  if (remainder.startsWith("\n\n") && remainder.includes(closing)) return `<hook_context>${remainder.slice(2)}`;
  return prompt;
}

export function hookContextOutput(event: string, result: { context: string; receipt?: unknown; omitted?: Array<{ slug: string; version: string; loadCommand: string }> }): Record<string, unknown> {
  if (!HOOK_EVENTS.includes(event as ContextHookEvent)) throw new Error(`Unsupported context hook event: ${event}`);
  const omitted = result.omitted?.slice(0, 10).map(entry => `Additional selected skill ${entry.slug}@${entry.version}: ${entry.loadCommand}`).join("\n");
  const policy = event === "SessionStart" || event === "SubagentStart"
    ? SKILLS_LOADING_POLICY
    : "";
  const context = [policy, result.context, omitted].filter(Boolean).join("\n\n");
  if (!context) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

export function assertNativeExportAllowed(dataDir = getDataDirReadOnly()): void {
  if (requiresCliSkillLoading(dataDir)) throw new Error("NATIVE_SKILL_EXPORT_DISABLED: this station loads skills through the Skills CLI; use skills sync --selection-profile <id>");
}
