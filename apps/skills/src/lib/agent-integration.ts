import { upgradeSumiSettingsWitness, readSumiSettingsPreimage, SUMI_DISCOVERY_PROJECTION_FIELDS } from "./sumi-settings-witness.js";
import { codexAdmissionReceipt, codexCorpusRootForPath, withCodexCorpusWrite, type CodexAdmissionReceipt, type CodexCorpusAdmission, type CodexCorpusWriteOptions } from "./codex-corpus-write.js";
import { reviewCodexPluginControls, reviewedCodexPluginSourceRoots, isReviewedCodexPluginInactive, isReviewedCodexPluginSkillDisabled, reviewedCodexPluginCapabilitiesUnchanged, disableReviewedCodexPluginNames, absentDisabledCodexPluginParent, classifyCodexPluginCacheDocument, codexRemoteInstallReceipt, mergeReconciledCodexPluginControls, unenrolledCodexPluginEvidence, codexPluginRootEvidence, codexPluginCapabilityChanges, enrolledCodexPluginStrictChanges, CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, type CodexPluginCacheDocumentIdentity, type ReviewedCodexSkillDenial, type CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";
import { verifyCodexNativeSkillPolicy, parseCodexNativeHookEnvelope, recordCodexNativePolicyAcceptance, type CodexNativeHookEnvelope, type ProcessInspector, type NativePolicyHelperRunner } from "./codex-native-skill-policy.js";
import { projectCodexInstalledPluginEntries, projectCodexNativeSkillCatalog, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
import { upgradeCodexSettingsWitness, upgradeCodexSettingsWitnessV3, upgradeCodexSettingsWitnessV4, upgradeCodexSettingsWitnessV5, readCodexSettingsPreimage, CODEX_DISCOVERY_PROJECTION_FIELDS } from "./codex-settings-witness.js";
import { upgradeClaudeSettingsWitness, upgradeClaudeSettingsWitnessV4, hashNativeJsonControls } from "./claude-settings-witness.js";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";
import { captureCodexSemanticCacheWitness, codexLocalMarketplaceMapsPlugin, type CodexSemanticCacheAppOnlyParent, type CodexSemanticCacheReviewedHookParent } from "./codex-semantic-cache-witness.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import type { NativeDiscoveryWitnessChange, NativeDiscoveryWitnessKind, NativeDiscoveryWitnessTolerance } from "./native-discovery-witness-change.js";
import { CODEX_REMOTE_VENDOR_MARKETPLACES, codexVendorMarketplace, codexVendorPluginRefreshSafe, codexVendorSubtreeHookFree } from "./codex-vendor-refresh.js";
import { isCodexNativeSkillDisabled } from "./codex-native-skill-catalog.js";
import { codexPluginCacheSkillTree } from "./codex-node-modules.js";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { existsSync, lstatSync, statSync, mkdirSync, readFileSync, readdirSync, opendirSync, readlinkSync, realpathSync, renameSync, rmdirSync, writeFileSync, unlinkSync, chmodSync, openSync, closeSync, fsyncSync, fstatSync, readSync, constants, linkSync, type BigIntStats, type Dirent } from "node:fs";
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { getDataDir, getDataDirReadOnly } from "./config.js";
import { requiresCliSkillLoading, readManagedSkillPolicySnapshot, serializeManagedSkillPolicy, parseManagedSkillPolicy } from "./managed-policy.js";
import { CLI_BRIDGE_NAME, CLI_BRIDGE_FILES, CLI_BRIDGE_DIGEST, CLI_BRIDGE_VERSION, isOwnedCliBridge } from "./agent-bridge.js";
import { assertProjectDiscovery, rebaseCodexEnrolledCacheWitnesses, codexVendorConfigChangeOnly, discoveryTextKeepsWitness, discoveryExecutable, recordedDiscoveryExecutable, isDiscoveryRootUnresolved, resolveAgentDiscovery, verifyAgentDiscovery, verifyAutomaticDiscoveryClosure, type DiscoveryExecutable, rebindAgentDiscovery, captureDiscoveryDirectories, captureRetiredCodexDiscovery, projectNativeDiscoveryFields, codexSemanticCacheSourceRole, codexSemanticCacheDirectoryRole, assertCodexSemanticCacheHookSafety, type AgentDiscoveryBinding, type DiscoverySource, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, renderAgentHookCommand, renderOpenCodePlugin, type IntegrationAgent } from "./agent-adapters.js";
import { assertCodexPathConfigEditable, CODEX_SKILL_CONFIG_SECTIONS, disableCodexBundledSkills, normalizeCodexInlinePathConfig } from "./agent-codex.js";

import { sumiConfigDirectory, sumiConfigPath, sumiBridgeRoot, sumiSkillRoots, renderSumiPlugin, isManagedSumiPlugin, SUMI_SKILL_PERMISSIONS, SumiPathResolverError } from "./agent-sumi.js";
import { HERMES_OPT_OUT, parseHermesConfig, configureHermesHooks, assertHermesProtection, renderHermesSupervisor, assertNoHermesLegacyShadow, type HermesSupervisorBinding } from "./agent-hermes.js";
import type { CodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { assertClaudeHookEventsReplacement, type ClaudeCoordinatedHookEvent } from "./claude-settings-witness.js";
import { directAliasTarget, snapshot as hookFileSnapshot, trustedAncestorOwner, unchanged as hookFileUnchanged } from "./codex-hook-trust-files.js";
import { assertPinnedLauncherRuntimeSafe, resolveLauncherCommand } from "../cli/commands/runtime-launcher.js";
import { planReviewArtifactRetention, verifyRetainedReviewArtifact, verifyReviewArtifactOriginal, writeReviewArtifactExclusive, type ReviewArtifactChange } from "./retained-review-artifacts.js";

export type { IntegrationAgent } from "./agent-adapters.js";
export type ContextHookEvent = "UserPromptSubmit" | "SessionStart" | "SubagentStart";
export interface AgentRootAlias { agent: IntegrationAgent; home: string; alias: string; target: string; link: string; aliasIdentity: string; targetIdentity: string }
export interface NativeSkillEntry { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; system?: boolean; bridge?: boolean; bridgeHome?: string; rootAlias?: AgentRootAlias; codexHome?: string }
export interface NativeMigrationTarget { agent: string; projectRoot: string; path: string; treeSha256: string; vendor?: true }
export interface NativeMigrationTargetManifest { schema: "hasna.skills-native-migration-targets.v1"; targets: NativeMigrationTarget[]; digest: string }
export interface AgentConfigChange { path: string; before: string | null; after: string }
export interface AgentIntegrationPlan { codexReconcile?: CodexPluginReconcilePlanState; cacheWitnessUpgrade?: CodexSemanticCacheUpgrade; reviewArtifactSources?: Array<{ path: string; sha256: string }>; retainedReviewArtifacts?: ReviewArtifactChange[]; reviewArtifactMigration?: ReviewArtifactMigration; observedNativeSources?: Array<{ path: string; sha256: string | null }>; codexPluginSkillReview?: { version: string; cwd: string; catalogSha256: string; configSha256: string | null }; observedSettings?: { path: string; before: string }; settingsWitnessUpgrade?: { agent: "claude" | "codex" | "sumi"; path: string; fromHashMode: string; fromSha256: string; toHashMode: string; toSha256: string; reviewedPreimage: string; currentSettingsSha256: string; replacedWitnesses: Array<{ hashMode: string; sha256: string }> }; dataDir: string; profileId: string; changes: AgentConfigChange[]; nativeSkills: NativeSkillEntry[]; observedPolicy?: { path: string; before: string | null }; discoveryBefore?: AgentDiscoveryBinding[]; discoveryAfter?: AgentDiscoveryBinding[]; discoveryExecutables?: Record<string, DiscoveryExecutable>; rootAliases?: AgentRootAlias[]; managedAgentChecks?: { home: string; projectDir?: string; agents: IntegrationAgent[] }; retainedReviewChecks?: { home: string; projectDir: string; agents: IntegrationAgent[] } }

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const HOOK_EVENTS: readonly ContextHookEvent[] = ["UserPromptSubmit", "SessionStart", "SubagentStart"];
const ROOTS = NATIVE_SKILL_ROOTS;

function nativeAgentRoot(home: string, agent: IntegrationAgent, cwd = process.cwd()): string {
  if (agent === "sumi") return sumiBridgeRoot(home, cwd);
  const root = AGENT_ADAPTERS[agent].root;
  if (typeof root !== "string") throw new Error(`Native skill root is unavailable for ${agent}`);
  return join(home, root);
}

function nativeAgentConfig(home: string, agent: IntegrationAgent, cwd = process.cwd()): string {
  if (agent === "sumi") return sumiConfigPath(home, cwd);
  const config = AGENT_ADAPTERS[agent].config;
  if (typeof config !== "string") throw new Error(`Native configuration path is unavailable for ${agent}`);
  return join(home, config);
}

/** Darwin acl_get_fd reports an absent extended ACL as NULL/ENOENT. The
 * descriptor is already bound to a verified object, so ENOENT cannot mean a
 * missing pathname. System aliases require no ACL. Package projection also
 * permits deny-only ACLs (such as the standard home-directory delete denial);
 * these cannot grant another principal access. All allow entries, unknown
 * tags, unsupported capabilities and errors refuse. No shell text is parsed.
 * Contract: Apple Libc posix1e/acl_file.c, gen/filesec.c and sys/acl.h. */
function hasTrustedDarwinAcl(fd: number, allowDenyOnly = false): boolean {
  try {
    const { dlopen, read, ptr } = require("bun:ffi") as typeof import("bun:ffi");
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      acl_get_fd: { args: ["i32"], returns: "ptr" },
      acl_free: { args: ["ptr"], returns: "i32" },
      acl_valid: { args: ["ptr"], returns: "i32" },
      acl_get_entry: { args: ["ptr", "i32", "ptr"], returns: "i32" },
      acl_get_tag_type: { args: ["ptr", "ptr"], returns: "i32" },
      __error: { args: [], returns: "ptr" },
    });
    try {
      const errno = library.symbols.__error();
      if (!errno) return false;
      const acl = library.symbols.acl_get_fd(fd);
      if (acl) {
        try {
          if (!allowDenyOnly || library.symbols.acl_valid(acl) !== 0) return false;
          const entry = new BigUint64Array(1), tag = new Int32Array(1);
          // Darwin uses 0/-1 for first/next, and -1/EINVAL at exhaustion.
          // Bound enumeration by the SDK's ACL_MAX_ENTRIES (128).
          for (let count = 0; count <= 128; count++) {
            const status = library.symbols.acl_get_entry(acl, count === 0 ? 0 : -1, ptr(entry));
            if (status !== 0) {
              return status === -1 && read.i32(errno) === 22 && library.symbols.acl_valid(acl) === 0;
            }
            const value = read.ptr(ptr(entry));
            if (count === 128 || !value || library.symbols.acl_get_tag_type(value as import("bun:ffi").Pointer, ptr(tag)) !== 0
              || tag[0] !== 2 /* ACL_EXTENDED_DENY */) return false;
          }
          return false;
        } finally { library.symbols.acl_free(acl); }
      }
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
  // The three directories are root-owned, so no other account can change their
  // mode, owner or ACL; only entries change, and /private/tmp is sticky and
  // world-writable by design. Bind each directory by object and trust fields,
  // not by times that any process's entry churn moves.
  const directoryIdentity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}`;
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
        if (directoryIdentity(fstatSync(fd, { bigint: true })) !== directoryIdentity(stat) || !hasTrustedDarwinAcl(fd)
          || directoryIdentity(fstatSync(fd, { bigint: true })) !== directoryIdentity(stat)) throw new Error("Unverified system alias directory ACL");
      } finally { closeSync(fd); }
      return { directory, identity: directoryIdentity(stat) };
    });
    return realpathSync(path) === target && readlinkSync(path) === link
      && identity(lstatSync(path, { bigint: true })) === identity(before)
      && directories.every(item => directoryIdentity(lstatSync(item.directory, { bigint: true })) === item.identity);
  } catch { return false; }
}

/** Normalize only the verified OS prefix, never hide user-controlled links. */
export function canonicalSystemPath(path: string): string {
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

export function canonicalAgentPath(path: string, aliases: AgentRootAlias[]): string {
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

export function recheckRootAliases(aliases: AgentRootAlias[]): void {
  for (const binding of aliases) {
    if (!["claude", "codex"].includes(binding.agent) || binding.alias !== join(binding.home, `.${binding.agent}`)) throw new Error("Invalid agent root alias binding");
    const current = readRootAlias(binding.home, binding.agent);
    if (JSON.stringify(current) !== JSON.stringify(binding)) throw new Error(`Agent root alias changed after planning: ${binding.alias}`);
  }
}

/** Ownership hashing must not follow a replacement link or block on a FIFO. */
function nativeSourceDigest(path:string):string|null {
  assertSafePath(path);
  return lstatSync(path,{throwIfNoEntry:false}) ? sha(readNativeBytes(path,1024*1024)) : null;
}
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

/** Shared native discovery participates regardless of the selecting adapter. */
function isCodexSkillDiscoveryInput(path: string): boolean {
  for (let cursor = canonicalSystemPath(path); cursor !== dirname(cursor); cursor = dirname(cursor)) {
    if (ROOTS.some(([agent, root]) => agent === "codex" && cursor.endsWith(join(sep, root)))) return true;
  }
  return false;
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
  const rootDefinitions = (selectedAgents
    ? ROOTS.filter(([agent, path]) => (agent !== "sumi" && selectedAgents.has(agent as IntegrationAgent)) || (selectedAgents.has("hermes") && agent === "codex" && path === ".agents/skills"))
    : ROOTS.filter(([agent]) => agent !== "sumi"));
  const roots: Array<readonly [string, string]> = rootDefinitions.map(([agent, path]) => [agent, canonicalAgentPath(join(home, path), aliases)]);
  const includesSumi = !selectedAgents || selectedAgents.has("sumi");
  if (includesSumi) for (const path of sumiSkillRoots(home)) roots.push(["sumi", canonicalAgentPath(path, aliases)]);
  const bridgePaths = Object.entries(AGENT_ADAPTERS).filter(([agent]) => agent !== "sumi" || includesSumi).map(([agent]) => canonicalAgentPath(join(nativeAgentRoot(home, agent as IntegrationAgent), CLI_BRIDGE_NAME), aliases));
  for (const project of projectAncestorDirectories([...(options.projectDirs ?? []), ...(options.projectDir ? [options.projectDir] : [])])) {
    for (const [agent, path] of rootDefinitions) roots.push([agent, canonicalAgentPath(join(project, path), aliases)]);
    if (selectedAgents?.has("sumi")) {
      for (const path of sumiSkillRoots(home, project)) roots.push(["sumi", canonicalAgentPath(path, aliases)]);
      for (const directory of [".claude", ".agents"]) for (const name of ["skill", "skills"]) roots.push(["sumi", canonicalAgentPath(join(project, directory, name), aliases)]);
    }
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
    if (stat.isFile()) { if (agent === "sumi" && depth === 1 && path.endsWith(".md")) throw new Error("NATIVE_SKILL_DRIFT: flat Sumi skill documents require a dedicated migration adapter"); return scan; }
    if (!stat.isDirectory()) throw new Error(`Unsupported native discovery entry: ${path}`);
    if (existsSync(join(path, "SKILL.md"))) {
      scan.hasSkills = true;
      if (seen.has(path)) return scan; seen.add(path);
      let managed = false;
      const marker = join(path, ".hasna-skills.json");
      if (existsSync(marker)) { try { managed = JSON.parse(readFileSync(marker, "utf8")).managedBy === "@hasna/skills"; } catch { /* Unrecognized markers grant no ownership. */ } }
      const bridge = (!vendor || agent === "sumi") && isOwnedCliBridge(path, bridgePaths);
      const rootAlias = aliases.find(item => path === item.target || path.startsWith(item.target + sep));
      entries.push({ agent, path, hash: treeHash(path), managed, vendor, ...(agent === "codex" || isCodexSkillDiscoveryInput(path) ? { codexHome: process.env.CODEX_HOME ?? join(home, ".codex") } : {}), ...(agent === "codex" && path.startsWith(canonicalAgentPath(join(home, ".codex", "skills", ".system"), aliases) + sep) ? { system: true } : {}), ...(bridge ? { bridge: true, bridgeHome: resolve(home) } : {}), ...(rootAlias ? { rootAlias } : {}) }); return scan;
    }
    if (depth > (agent === "sumi" ? 32 : vendor ? 32 : 3)) return { ...scan, complete: false };
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
      // Codex loads skills below node_modules in its skill roots, and in its
      // plugin cache wherever that can be a plugin skill root
      // (codex-node-modules.ts). Elsewhere it stays an unscanned dependency tree.
      if (name === "node_modules" && !(agent === "codex" && (!pluginCache || codexPluginCacheSkillTree(join(path, name), depth + 1)))) continue;
      if (name.startsWith(".") && name !== ".system" && agent !== "hermes" && agent !== "sumi" && !(options.guardHermes && `${path}${sep}`.includes(`${sep}.agents${sep}skills${sep}`))) continue;
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
export function planAgentIntegration(options: { home?: string; dataDir?: string; agents: IntegrationAgent[]; command?: string; profileId?: string; includeVendor?: boolean; projectDir?: string; discoveryInputs?: ReviewedDiscoveryInputs; allowRootAliases?: boolean; reviewedCacheAlias?: string; codexNativeCatalog?: CodexNativeSkillCatalog; codexSkillDenials?: ReviewedCodexSkillDenial[]; codexReconcile?: CodexPluginReconcileInput }): AgentIntegrationPlan {
  if (options.discoveryInputs?.agents.some(review => review.reviewArtifacts !== undefined && !options.agents.includes(review.agent))) throw new Error("REVIEW_ARTIFACT_INVALID");
  if (options.codexSkillDenials !== undefined && (!options.codexNativeCatalog || !options.discoveryInputs || !options.agents.includes("codex"))) throw new Error("Explicit Codex skill denials require a fresh native catalog and discovery review");
  // The name reconcile reuses this reviewed planner for one exact purpose: it
  // never brings a new discovery review, explicit denial or another agent.
  if (options.codexReconcile !== undefined && (!options.codexNativeCatalog || options.discoveryInputs !== undefined || options.codexSkillDenials !== undefined
    || options.agents.length !== 1 || options.agents[0] !== "codex" || options.command !== undefined || options.profileId !== undefined)) throw new Error("Codex name reconcile plans only the Codex agent from a fresh native catalog and its saved review");
  const reconcileCopies = options.codexReconcile ? new Map(options.codexReconcile.copies.map(copy => [copy.path, copy.hash])) : undefined;
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
  // A review resolves runtimes through this process's PATH. When that PATH
  // cannot see a runtime the policy already recorded, keep the recorded one
  // while it still resolves, rather than silently dropping its discovery.
  const priorExecutables: Record<string, DiscoveryExecutable> = policy.bridge?.discoveryExecutables ?? {};
  const executables = new Map<IntegrationAgent, DiscoveryExecutable | null>();
  const discoveries = [...new Set(options.agents)].map(agent => {
    const prior = priorExecutables[agent];
    // A prior record counts only while its path still resolves; a dangling,
    // missing or unreadable one is treated as no record.
    const executable = discoveryExecutable(agent) ?? (prior ? recordedDiscoveryExecutable(agent, prior) : null);
    executables.set(agent, executable);
    // A reconcile may substitute the saved review with only its enrolled-plugin
    // cache witnesses re-captured; that binding is verified like the saved one.
    const reconcileDiscovery = agent === "codex" ? options.codexReconcile?.discovery : undefined;
    if (reconcileDiscovery && (reconcileDiscovery.agent !== "codex" || reconcileDiscovery.method !== "reviewed" || policy.bridge?.discovery?.codex?.method !== "reviewed")) throw new Error("Codex name reconcile can rebase only a saved reviewed binding");
    const retainedReview: AgentDiscoveryBinding | undefined = options.discoveryInputs === undefined && policy.bridge?.discovery?.[agent]?.method === "reviewed" ? {...(reconcileDiscovery ?? policy.bridge.discovery[agent]), ...(agent==="codex" ? {codexDisabledPluginSkills:policy.bridge.codexPluginSkills ?? []} : {})} : undefined;
    try {
      if (retainedReview) {
        // Reuse may repair bridge protection, but cannot silently enroll a new
        // native copy or discovery input by changing it before validation.
        assertRetainedReviewState(agent, { home, dataDir, projectDir: options.projectDir ?? home }, agent === "codex" ? reconcileCopies : undefined, reconcileDiscovery);
        retainedAgents.push(agent);
      }
      return resolveAgentDiscovery({ home, agent, reviewed: options.discoveryInputs, retainedReview, canonical: path => canonicalAgentPath(path, aliases), executable });
    }
    catch (error) {
      // An unresolvable runtime is an environment gap, not drift: keep its code.
      if (isDiscoveryRootUnresolved(error) || error instanceof SumiPathResolverError || error instanceof NativeSkillCopiesDriftError) throw error;
      // A reused review that no longer verifies cannot be repaired by this command: plain
      // `hook install` re-enters this same assertion, so name the explicit review form.
      if (!retainedReview) throw error;
      throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message.replace(/^NATIVE_SKILL_DRIFT: /, "")}. This agent reuses a saved discovery review and that review no longer verifies, so a fresh explicit review is required: skills hook install --agent ${agent} --discovery-inputs <review> --apply.`);
    }
  });
  const codexConfigBefore = options.agents.includes("codex") ? readOptional(canonicalAgentPath(join(home, ".codex", "config.toml"), aliases)) : null;
  const codexConfig = Bun.TOML.parse(codexConfigBefore ?? "") as { plugins?: unknown; skills?: { config?: Array<{ path?: string; enabled?: boolean }> } };
  const nativeSkills = inventoryNativeSkills(home, { includeVendor: true, guardHermes: options.agents.includes("hermes"), agents: options.agents, projectDir: options.projectDir, agentRoots: discoveries.flatMap(binding => binding.roots.map(path => ({ agent: binding.agent, path }))), allowRootAliases: options.allowRootAliases, reviewedCacheAlias: options.reviewedCacheAlias, disabledVendorPaths: disabledCodexSkillPaths(codexConfig, aliases) });
  // Review an omitted, already name-disabled remote materialization against
  // both current controls and the exact path denies this transaction will add.
  // Planning these bytes never changes native configuration or catalog rows.
  const codexPathConfig = options.agents.includes("codex")
    ? disableCodexSkills(codexConfigBefore ?? "", nativeSkills, aliases, canonicalAgentPath(join(home, ".codex/skills", CLI_BRIDGE_NAME), aliases))
    : undefined;
  const plannedCodexRules = codexPathConfig === undefined ? undefined : (Bun.TOML.parse(codexPathConfig) as any).skills?.config ?? [];
  const observedNativeSources: Array<{ path: string; sha256: string | null }> = [];
  // A reconcile reviews only the plugins it enrolls or already enrolled. Other
  // plugin-cache copies keep the exact-path denies planned above, and the saved
  // inactive-plugin and installation-input reviews carry over unchanged.
  const reconcileParents = options.codexReconcile ? new Set(options.codexReconcile.parents) : undefined;
  const reviewedPluginDocuments = nativeSkills.filter(entry=>entry.agent==="codex" && entry.vendor && (!reconcileParents || [...reconcileParents].some(parent=>entry.path.startsWith(parent+sep)))).map(entry=>join(entry.path,"SKILL.md"));
  const reviewedPluginControls: ReturnType<typeof reviewCodexPluginControls> | undefined = options.codexNativeCatalog
    ? reviewCodexPluginControls(options.codexNativeCatalog, reviewedPluginDocuments, canonicalAgentPath(join(home,".codex/plugins/cache"),aliases), resolve(options.projectDir ?? home), path=>{const bytes=readNativeBytes(path,1024*1024); observedNativeSources.push({path,sha256:sha(bytes)}); return new TextDecoder("utf-8",{fatal:true}).decode(bytes); }, codexConfig.skills?.config ?? [], codexConfig.plugins, plannedCodexRules, options.codexSkillDenials)
    : undefined;
  const savedPluginControls = {skills:policy.bridge?.codexPluginSkills ?? [],inactivePlugins:policy.bridge?.codexInactivePlugins ?? [],sourceInputs:policy.bridge?.discovery?.codex?.codexInstallationInputs?.plugins ?? []};
  const codexPluginControls: ReturnType<typeof reviewCodexPluginControls> = reviewedPluginControls === undefined ? savedPluginControls
    : options.codexReconcile ? {...savedPluginControls,skills:reviewedPluginControls.skills} : reviewedPluginControls;
  const cache=canonicalAgentPath(join(home,".codex/plugins/cache"),aliases);
  const retired=(policy.bridge?.codexPluginSkills ?? []).filter((control:CodexPluginSkillControl)=>absentDisabledCodexPluginParent(cache,control.pluginParent,policy.bridge.codexPluginSkills,codexConfig.skills?.config ?? []));
  for (const denial of options.codexSkillDenials ?? []) {
    const control=codexPluginControls.skills.find(item=>item.name===denial.name);
    if (!control) throw new Error("Explicit Codex denial did not resolve a reviewed identity");
    const root=join(control.pluginParent,relative(control.pluginParent,denial.path).split(sep)[0]!);
    const review=options.discoveryInputs!.agents.find(item=>item.agent==="codex");
    // Bind absence too: an unreviewed capability file appearing after preview
    // must refuse before any configuration write, not just on the next hook.
    for (const path of [join(root,".app.json"),join(root,".mcp.json"),join(root,"hooks")]) observedNativeSources.push({path,sha256:nativeSourceDigest(path)});
    const files=[join(root,".codex-plugin/plugin.json"),...(control.appSha256 ? [join(root,".app.json")] : []),...(control.mcpSha256 ? [join(root,".mcp.json")] : [])];
    for (const path of files) if (!review?.sources.some(source=>source.path===path && source.format===undefined && source.fields===undefined && [undefined,"bytes"].includes(source.hashMode) && source.sha256===sha(readNativeBytes(path,1024*1024)))) throw new Error("Explicit Codex denial requires current full manifest and capability discovery witnesses");
  }
  // A reconcile adds the exact new names to the saved controls; it never drops
  // or rewrites one, so a fresh catalog cannot silently replace a review.
  const codexPluginSkills: CodexPluginSkillControl[] = options.codexReconcile
    ? mergeReconciledCodexPluginControls(policy.bridge?.codexPluginSkills ?? [], codexPluginControls.skills, options.codexReconcile.names, options.codexReconcile.remoteIdentities)
    : [...codexPluginControls.skills,...retired.filter((control:CodexPluginSkillControl)=>!codexPluginControls.skills.some(item=>item.name===control.name))];
  for (const discovery of discoveries) if (discovery.agent==="codex" && discovery.method==="reviewed") discovery.codexDisabledPluginSkills=codexPluginSkills;
  if (options.agents.includes("codex") && !options.codexNativeCatalog && codexPluginSkills.length
    && !reviewedCodexPluginCapabilitiesUnchanged(canonicalAgentPath(join(home,".codex/plugins/cache"),aliases),codexPluginSkills,path=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024)),codexConfig.skills?.config ?? [])) {
    throw new Error(`NATIVE_SKILL_DRIFT: ${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}: reviewed native plugin capability controls changed; provide a fresh native catalog and discovery review`);
  }
  const codexInactivePlugins = codexPluginControls.inactivePlugins;
  const codexDiscovery=discoveries.find(binding=>binding.agent==="codex");
  const codexPluginSourceInputs = codexPluginControls.sourceInputs.filter(input=>codexDiscovery?.method==="reviewed"
    && codexDiscovery.roots.some(root=>root===input.sourceRoot || root.startsWith(input.sourceRoot+sep) || input.sourceRoot.startsWith(root+sep))
    && codexDiscovery.sources.some(source=>source.path===join(input.sourceRoot,".codex-plugin/plugin.json") && source.sha256!==null && source.format===undefined && source.fields===undefined));
  assertCodexInstallationInputs(home,[options.projectDir ?? home],codexPluginSourceInputs.map(input=>input.sourceRoot));
  const changes: AgentConfigChange[] = [];
  let observedSettings: AgentIntegrationPlan["observedSettings"];
  for (const agent of [...new Set(options.agents)]) {
    if (!INTEGRATION_AGENTS.includes(agent)) throw new Error(`Unsupported agent: ${agent}`);
    const { command, profileId } = bindings.get(agent)!;
    const bridgePath = canonicalAgentPath(join(nativeAgentRoot(home, agent, options.projectDir ?? process.cwd()), CLI_BRIDGE_NAME), aliases);
    assertSafePath(bridgePath);
    if (existsSync(bridgePath) && !isOwnedCliBridge(bridgePath, [bridgePath])) throw new Error(`Refusing to overwrite an unrecognized or modified Skills bridge: ${bridgePath}`);
    for (const [name, after] of Object.entries(CLI_BRIDGE_FILES)) {
      const path = join(bridgePath, name), before = readOptional(path);
      if (before !== after) changes.push({ path, before, after });
    }
    const path = canonicalAgentPath(nativeAgentConfig(home, agent, options.projectDir ?? process.cwd()), aliases);
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
    if (agent === "sumi") {
      if (config.permissions !== undefined && (!Array.isArray(config.permissions) || config.permissions.some((rule: any) => !rule || typeof rule.action !== "string" || typeof rule.resource !== "string" || !["allow", "deny", "ask"].includes(rule.effect)))) throw new Error("Expected Sumi native permission rules");
      config.permissions = [...(config.permissions ?? []).filter((rule: any) => rule.action !== "skill"), ...SUMI_SKILL_PERMISSIONS];
      const pluginPath = join(sumiConfigDirectory(home, process.env, options.projectDir ?? process.cwd()), "plugins", "skills-cli.js"), pluginBefore = readOptional(pluginPath);
      const pluginAfter = renderSumiPlugin(command, profileId);
      const priorCommand = policy.bridge?.commands?.sumi, priorProfile = policy.bridge?.profiles?.sumi ?? policy.profileId;
      if (pluginBefore !== null && pluginBefore !== pluginAfter && !(typeof priorCommand === "string" && typeof priorProfile === "string" && isManagedSumiPlugin(pluginBefore, priorCommand, priorProfile))) throw new Error("Refusing to overwrite a modified Sumi Skills plugin; preserve and review it first");
      if (pluginBefore !== pluginAfter) changes.push({ path: pluginPath, before: pluginBefore, after: pluginAfter });
    } else if (agent === "opencode") {
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
      if (previous !== codexConfigBefore) throw new Error(`Configuration changed during planning: ${configPath}`);
      let next = disableReviewedCodexPluginNames(codexPathConfig!, codexPluginSkills);
      // Reconcile only: runtime-cache skills Codex loads that no plugin control
      // covers. Deny-only rows: a stable qualified name, else the exact path.
      for (const name of options.codexReconcile?.nameDenies ?? []) if (!((Bun.TOML.parse(next) as any).skills?.config ?? []).some((rule:any)=>rule.name===name && rule.enabled===false)) next+=`\n[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = false\n`;
      for (const path of options.codexReconcile?.pathDenies ?? []) if (!((Bun.TOML.parse(next) as any).skills?.config ?? []).some((rule:any)=>rule.path===path && rule.enabled===false)) next+=`\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
      if (next !== (previous ?? "")) {
        if (previous !== null && isDeepStrictEqual(Bun.TOML.parse(previous), Bun.TOML.parse(next))) {
          // Native config writers may use inline tables. Preserve equivalent
          // bytes instead of requiring corpus admission for formatting alone,
          // but retain the exact preimage check through application.
          observedSettings = { path: configPath, before: previous };
        } else changes.push({ path: configPath, before: previous, after: next });
      }
    }
  }
  // A reconcile records itself in its receipt; the last reviewed catalog stays the review of record.
  const codexPluginSkillReview = options.codexNativeCatalog && !options.codexReconcile ? { version: options.codexNativeCatalog.version, cwd: options.codexNativeCatalog.cwd, catalogSha256: sha(JSON.stringify({version:options.codexNativeCatalog.version,cwd:options.codexNativeCatalog.cwd,skills:projectCodexNativeSkillCatalog({data:[{cwd:options.codexNativeCatalog.cwd,errors:[],skills:options.codexNativeCatalog.skills}]},options.codexNativeCatalog.cwd),...(options.codexNativeCatalog.plugins === undefined ? {} : {plugins:projectCodexInstalledPluginEntries(options.codexNativeCatalog.plugins)})})), configSha256: changes.find(change=>change.path===canonicalAgentPath(join(home,".codex/config.toml"),aliases))?.before === null ? null : sha(readOptional(canonicalAgentPath(join(home,".codex/config.toml"),aliases)) ?? "") } : policy.bridge?.codexPluginSkillReview;
  const discoveryAfter = discoveries.map(binding => {
    const rebound=rebindAgentDiscovery(binding, new Map(changes.map(change => [change.path, change.after])));
    if (binding.agent!=="codex") return rebound;
    const {codexInstallationInputs:previousInputs,...current}=rebound;
    const inputs=codexPluginSourceInputs.map(input=>input.sourceRoot);
    const directories=(options.codexNativeCatalog && !options.codexReconcile) || !previousInputs ? captureDiscoveryDirectories((binding.directories ?? []).filter(directory=>inputs.some(root=>root.startsWith(directory.path+sep))).map(directory=>directory.path),inputs) : previousInputs.directories;
    const installed=codexPluginSourceInputs.length ? {...current,codexInstallationInputs:{version:codexPluginSkillReview.version,catalogSha256:codexPluginSkillReview.catalogSha256,plugins:codexPluginSourceInputs,...(directories?.length ? {directories} : {})}} : current;
    return captureRetiredCodexDiscovery(installed,codexPluginSkills,(Bun.TOML.parse(changes.find(change=>change.path===canonicalAgentPath(join(home,".codex/config.toml"),aliases))?.after ?? codexConfigBefore ?? "") as any).skills?.config ?? []);
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
  } } as Record<string, any>;
  const discoveryExecutables: Record<string, DiscoveryExecutable> = { ...priorExecutables };
  for (const [agent, executable] of executables) { if (executable) discoveryExecutables[agent] = executable; else delete discoveryExecutables[agent]; }
  if (Object.keys(discoveryExecutables).length) nextPolicy.bridge.discoveryExecutables = discoveryExecutables;
  else delete nextPolicy.bridge.discoveryExecutables;
  const retainedReviewArtifacts: ReviewArtifactChange[] = [];
  const reviewArtifactSources: Array<{ path: string; sha256: string }> = [];
  for (let index = 0; index < discoveryAfter.length; index++) {
    const original = discoveryAfter[index]!;
    const artifacts = options.discoveryInputs?.agents.find(review => review.agent === original.agent)?.reviewArtifacts;
    const retained = planReviewArtifactRetention(original, artifacts, dataDir, home);
    retainedReviewArtifacts.push(...retained.changes); reviewArtifactSources.push(...retained.observed);
    discoveryAfter[index] = retained.binding;
    nextPolicy.bridge.discovery[original.agent] = retained.binding;
  }
  changes.push(...retainedReviewArtifacts);
  const serializedPolicy = serializeManagedSkillPolicy(nextPolicy);
  if (JSON.stringify(policy) !== JSON.stringify(nextPolicy)) changes.push({ path: policyPath, before: previousPolicy, after: serializedPolicy });
  recheckRootAliases(aliases);
  return { dataDir, profileId, changes, nativeSkills, ...(retainedReviewArtifacts.length ? { retainedReviewArtifacts } : {}), ...(reviewArtifactSources.length ? { reviewArtifactSources } : {}), ...(observedSettings ? { observedSettings } : {}), ...(observedNativeSources.length ? { observedNativeSources } : {}), ...(nextPolicy.bridge.codexPluginSkillReview ? { codexPluginSkillReview: nextPolicy.bridge.codexPluginSkillReview } : {}), observedPolicy: { path: policyPath, before: previousPolicy }, discoveryBefore: discoveries, discoveryAfter, ...(aliases.length ? { rootAliases: aliases } : {}), ...(retainedAgents.length ? { retainedReviewChecks: { home, projectDir: options.projectDir ?? home, agents: retainedAgents } } : {}) };
}

export interface ClaudeManagedHookProjection {
  schema: "hasna.claude-managed-hook-projection.v1";
  targetSha256: string;
  sourceSha256: string;
  replacements: Array<{ event: string; groupIndex: number; hookIndex: number; beforeSha256: string; command: string }>;
}

export interface ClaudeManagedHookProjectionOptions {
  home?: string;
  dataDir?: string;
  projectDir?: string;
  /** Exact caller-owned bytes, never a new native home or a path to be written. */
  targetSettings: string;
  expectedTargetSha256: string;
  /** Supply the preceding plan's source witness when checking it before use. */
  expectedSourceSha256?: string;
}

function hookProjectionRefusal(reason: string): never {
  throw new Error(`CLAUDE_MANAGED_HOOK_${reason}`);
}

/** Reuse the native ACL reader on a descriptor bound to the observed path.
 * File snapshots and parent identities remain the authority for bytes/modes. */
function projectedHookAcl(path: string, observed: BigIntStats): void {
  if (process.platform !== "darwin") return;
  // A file binds its full identity. A directory binds the object (dev, ino)
  // and its trust fields (uid, mode) only: its times, link count and size
  // change whenever any process adds or removes an unrelated entry, such as in
  // a shared TMPDIR or home. Replacing a bound descendant changes that
  // descendant's own identity, and recheck re-reads every ancestor's ACL.
  const identity = observed.isDirectory()
    ? (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}`
    : (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.uid}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeNs}`;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    | (observed.isDirectory() ? constants.O_DIRECTORY : 0));
  try {
    if (identity(fstatSync(fd, { bigint: true })) !== identity(observed) || !hasTrustedDarwinAcl(fd, true)
      || identity(fstatSync(fd, { bigint: true })) !== identity(observed)
      || identity(lstatSync(path, { bigint: true })) !== identity(observed)) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
  } finally { closeSync(fd); }
}

/** Only the final command leaf may be an alias. Bind its parent permissions,
 * link identity and exact resolved package bytes using the existing file guard.
 * The alias is a symlink that names its physical target directly (a chain of
 * links is refused, since a link in it could be re-pointed through a directory
 * no walk here sees), or a managed pinned launcher written by the copyfile
 * updater: its exact template text binds the entry it runs, the launcher file
 * is bound like a package file, and its pinned Bun must be a safe file in a
 * trusted directory chain, walked and rechecked like every other input. */
function projectedHookExecutable(command: string, expectedResolved?: string) {
  try {
    if (!isAbsolute(command) || /[\0\r\n]/.test(command) || resolve(command) !== command) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    command = canonicalSystemPath(command);
    const parents = (file = command) => {
      const result: string[] = [];
      for (let path = dirname(file); ; path = dirname(path)) {
        const stat = lstatSync(path, { bigint: true });
        // Another non-root owner could replace entries whatever the mode.
        if (!stat.isDirectory() || !trustedAncestorOwner(stat.uid)
          || ((stat.mode & 0o022n) !== 0n && !(stat.uid === 0n && (stat.mode & 0o1000n) !== 0n))) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
        projectedHookAcl(path, stat);
        result.push(`${path}:${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}`);
        if (dirname(path) === path) break;
      }
      return result;
    };
    const parentIdentity = parents(), link = lstatSync(command, { bigint: true });
    if (link.uid !== BigInt(process.getuid!()) || (!link.isFile() && !link.isSymbolicLink())) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    const linkIdentity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}:${stat.ctimeNs}`;
    const target = resolveLauncherCommand(command), resolved = target.entry;
    // A file command is its own physical path; a symlink must name it directly.
    const direct = () => link.isSymbolicLink() ? directAliasTarget(command) === target.physical : target.physical === command;
    if (!direct()) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    // Reject an unrelated target before opening any of its contents.
    if (expectedResolved !== undefined && resolved !== expectedResolved) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    let launcher: ReturnType<typeof hookFileSnapshot> | undefined, launcherParentIdentity: string[] | undefined;
    let runtime: { path: string; stat: BigIntStats; parents: string[] } | undefined;
    if (target.pinned) {
      launcherParentIdentity = parents(target.physical);
      launcher = hookFileSnapshot(target.physical, false);
      projectedHookAcl(launcher.file, launcher.stat);
      if (launcher.sha256 !== target.pinned.sha256 || (launcher.stat.mode & 0o100n) === 0n) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
      // The pinned Bun runs the hook, so whoever can replace it, or an entry
      // in any directory above it, controls the hook: walk it like the rest.
      const path = target.pinned.runtime;
      assertPinnedLauncherRuntimeSafe(path);
      if (resolve(path) !== path) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
      runtime = { path, parents: parents(path), stat: lstatSync(path, { bigint: true }) };
      if (!runtime.stat.isFile()) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
      projectedHookAcl(path, runtime.stat);
    }
    const resolvedParentIdentity = parents(resolved);
    const manifest = hookFileSnapshot(join(dirname(dirname(resolved)), "package.json"), false, { readOnlyPackage: true });
    projectedHookAcl(manifest.file, manifest.stat);
    const pkg = JSON.parse(manifest.text);
    if (pkg.name !== "@hasna/skills" || !/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.bin?.skills !== "bin/index.js"
      || resolved !== join(dirname(manifest.file), "bin/index.js")) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    const cli = hookFileSnapshot(resolved, false, { readOnlyPackage: true });
    projectedHookAcl(cli.file, cli.stat);
    if ((cli.stat.mode & 0o100n) === 0n) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
    const recheck = () => {
      try {
        const again = resolveLauncherCommand(command);
        if (again.entry !== resolved || again.physical !== target.physical || linkIdentity(lstatSync(command, { bigint: true })) !== linkIdentity(link)
          || !direct()
          || !isDeepStrictEqual(parents(), parentIdentity)
          || !isDeepStrictEqual(parents(resolved), resolvedParentIdentity)) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
        if (launcher) {
          if (!isDeepStrictEqual(parents(target.physical), launcherParentIdentity)) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
          projectedHookAcl(launcher.file, launcher.stat); hookFileUnchanged(launcher);
        }
        if (runtime) {
          assertPinnedLauncherRuntimeSafe(runtime.path);
          if (!isDeepStrictEqual(parents(runtime.path), runtime.parents)) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
          projectedHookAcl(runtime.path, runtime.stat);
        }
        projectedHookAcl(cli.file, cli.stat); projectedHookAcl(manifest.file, manifest.stat);
        hookFileUnchanged(cli); hookFileUnchanged(manifest);
      } catch { hookProjectionRefusal("EXECUTABLE_UNVERIFIED"); }
    };
    recheck();
    return { resolved, sha256: cli.sha256, manifestSha256: manifest.sha256, recheck };
  } catch { hookProjectionRefusal("EXECUTABLE_UNVERIFIED"); }
}

/** Read-only projection for a copied Claude configuration. This does not install
 * hooks, adopt target discovery, change policy, or confer write/admission authority.
 * The caller must preserve the full target, hold its owning writer lease, replan
 * against both witnesses, CAS the full bytes and revalidate after application. */
export function planClaudeManagedHookProjection(options: ClaudeManagedHookProjectionOptions): ClaudeManagedHookProjection {
  if (typeof options.targetSettings !== "string" || Buffer.byteLength(options.targetSettings) > 1024 * 1024) hookProjectionRefusal("TARGET_INVALID");
  const targetSha256 = sha(options.targetSettings);
  if (!/^[a-f0-9]{64}$/.test(options.expectedTargetSha256) || options.expectedTargetSha256 !== targetSha256) hookProjectionRefusal("TARGET_CHANGED");
  let target: Record<string, any>;
  try { target = jsonObject(options.targetSettings, "target"); } catch { hookProjectionRefusal("TARGET_INVALID"); }
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  const policyPath = join(dataDir, "agent-policy.json");
  let policyBytes: Buffer, settingsBytes: Buffer, settingsPath: string, command: string, profile: string;
  try {
    policyBytes = readNativeBytes(policyPath, 1024 * 1024);
    const snapshot = readManagedSkillPolicySnapshot(dataDir);
    if (!snapshot || snapshot.text !== policyBytes.toString("utf8")) hookProjectionRefusal("SOURCE_UNVERIFIED");
    const binding = snapshot.value.bridge;
    settingsPath = canonicalAgentPath(join(home, AGENT_ADAPTERS.claude.config), binding?.rootAliases ?? []);
    settingsBytes = readNativeBytes(settingsPath, 1024 * 1024);
    command = binding?.commands?.claude; profile = binding?.profiles?.claude;
    if (typeof command !== "string" || typeof profile !== "string") hookProjectionRefusal("SOURCE_UNVERIFIED");
    assertManagedAgentBridge("claude", { home, dataDir, projectDir: options.projectDir, profileId: profile });
  } catch { hookProjectionRefusal("SOURCE_UNVERIFIED"); }
  const executable = projectedHookExecutable(command);
  const sourceSha256 = sha(JSON.stringify({ home, policyPath, policy: sha(policyBytes), settingsPath, settings: sha(settingsBytes),
    executable: { path: executable.resolved, sha256: executable.sha256, manifestSha256: executable.manifestSha256 } }));
  if (options.expectedSourceSha256 !== undefined && options.expectedSourceSha256 !== sourceSha256) hookProjectionRefusal("SOURCE_CHANGED");
  const replacements: ClaudeManagedHookProjection["replacements"] = [];
  const observed = [executable];
  if (target.hooks !== undefined) {
    if (!target.hooks || typeof target.hooks !== "object" || Array.isArray(target.hooks)) hookProjectionRefusal("TARGET_INVALID");
    for (const event of [...AGENT_ADAPTERS.claude.events, "PreToolUse"]) {
      const groups = target.hooks[event];
      if (groups === undefined) continue;
      if (!Array.isArray(groups)) hookProjectionRefusal("TARGET_INVALID");
      let recognized = 0;
      for (const [groupIndex, group] of groups.entries()) {
        if (!group || !Array.isArray(group.hooks)) hookProjectionRefusal("TARGET_INVALID");
        for (const [hookIndex, hook] of group.hooks.entries()) {
          if (hook?.type !== "command" || typeof hook.command !== "string") continue;
          // This marker can only cause refusal, never establish ownership.
          if (!hook.command.includes("hook user-prompt --agent claude")) continue;
          const match = /^('(?:[^']|'\\'')*') hook user-prompt --agent claude --selection-profile ([A-Za-z0-9][A-Za-z0-9._-]{0,127}) --event ([A-Za-z]+)$/.exec(hook.command);
          if (!match || match[3] !== event) hookProjectionRefusal("UNRECOGNIZED");
          const oldCommand = match[1]!.slice(1, -1).replaceAll("'\\''", "'");
          let rendered: string;
          try { rendered = renderAgentHookCommand(oldCommand, "claude", match[2]!, event); } catch { hookProjectionRefusal("UNRECOGNIZED"); }
          if (rendered !== hook.command) hookProjectionRefusal("UNRECOGNIZED");
          const legacy = projectedHookExecutable(oldCommand, executable.resolved);
          if (legacy.resolved !== executable.resolved || legacy.sha256 !== executable.sha256 || legacy.manifestSha256 !== executable.manifestSha256) hookProjectionRefusal("EXECUTABLE_UNVERIFIED");
          observed.push(legacy);
          if (++recognized > 1) hookProjectionRefusal("AMBIGUOUS");
          const replacement = renderAgentHookCommand(command, "claude", profile, event);
          if (replacement !== hook.command) replacements.push({ event, groupIndex, hookIndex, beforeSha256: sha(hook.command), command: replacement });
        }
      }
    }
  }
  try {
    if (!readNativeBytes(policyPath, 1024 * 1024).equals(policyBytes) || !readNativeBytes(settingsPath, 1024 * 1024).equals(settingsBytes)) hookProjectionRefusal("SOURCE_CHANGED");
  } catch { hookProjectionRefusal("SOURCE_CHANGED"); }
  for (const item of observed) item.recheck();
  return { schema: "hasna.claude-managed-hook-projection.v1", targetSha256, sourceSha256, replacements };
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
    // Sumi's native config path is not a Claude input. Its actual relationship
    // to this write is already represented by the frozen discovery bindings
    // below; resolving a foreign Sumi runtime here would make a Claude-only
    // update depend on an unrelated optional PATH helper.
    || (binding.agent !== "sumi" && canonical(nativeAgentConfig(home, binding.agent)) === path)
    || binding.sources.some(source => canonical(source.path) === path)
    || binding.roots.some(containsSettings)
    || binding.directories?.some(directory => containsSettings(directory.path)))
    .map(binding => binding.agent);
}

/** Automatic discovery closure is independent of native runtime trust. Keep
 * checking it even for a consumer whose settings this transaction does not edit.
 */
function verifyCoordinatedDiscovery(binding: AgentDiscoveryBinding, home: string, aliases: AgentRootAlias[], executable?: DiscoveryExecutable): void {
  try {
    if (binding.method !== "automatic" && binding.method !== "reviewed") throw new Error("Invalid managed discovery method");
    verifyAgentDiscovery(binding, undefined, aliases);
    if (binding.method === "automatic") verifyAutomaticDiscoveryClosure(binding, { home, canonical: path => canonicalAgentPath(path, aliases), change: "Configured native discovery roots changed during Claude update", executable });
  } catch (error) {
    // An unresolvable runtime is an environment gap, not drift: keep its code.
    if (isDiscoveryRootUnresolved(error)) throw error;
    throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message}`);
  }
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
  const discoveryExecutables: Record<string, DiscoveryExecutable> | undefined = bridge.discoveryExecutables;
  for (const binding of discoveries) verifyCoordinatedDiscovery(binding, home, aliases, discoveryExecutables?.[binding.agent]);
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
    discoveryAfter, ...(discoveryExecutables ? { discoveryExecutables } : {}), rootAliases: aliases, managedAgentChecks: { home, agents: consumers } };
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
export function planAgentSettingsWitnessUpgrade(options: { agent: "claude" | "codex" | "sumi"; targetCodexVersion?: 2 | 3 | 4 | 5; targetClaudeVersion?: 3 | 4; reviewedPreimage: string; home?: string; dataDir?: string; projectDir?: string; expectedPolicySha256: string; expectedSettingsSha256: string }): AgentIntegrationPlan {
  if (options.targetCodexVersion !== undefined && (options.agent !== "codex" || ![2, 3, 4, 5].includes(options.targetCodexVersion))) throw new Error("Invalid Codex witness target version");
  // Claude v3 stays the default target; v4 (built-in theme presets) is opt-in.
  if (options.targetClaudeVersion !== undefined && (options.agent !== "claude" || ![3, 4].includes(options.targetClaudeVersion))) throw new Error("Invalid Claude witness target version");
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot || sha(snapshot.text) !== options.expectedPolicySha256) throw new Error("Managed policy preimage changed");
  const policy = snapshot.value, aliases: AgentRootAlias[] = policy.bridge?.rootAliases ?? [];
  recheckRootAliases(aliases);
  const binding: AgentDiscoveryBinding | undefined = policy.bridge?.discovery?.[options.agent];
  if (!binding || binding.agent !== options.agent || binding.method !== "reviewed") throw new Error("Settings witness upgrade requires an existing reviewed native binding");
  const configPath = canonicalAgentPath(options.agent === "sumi" ? nativeAgentConfig(home, "sumi", options.projectDir ?? process.cwd()) : join(home, options.agent === "claude" ? ".claude/settings.json" : ".codex/config.toml"), aliases);
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
    if (previous.hashMode !== undefined && previous.hashMode !== "bytes" && previous.hashMode !== "codex-settings-v1" && !((options.targetCodexVersion === 3 || options.targetCodexVersion === 4 || options.targetCodexVersion === 5) && previous.hashMode === "codex-settings-v2") && !((options.targetCodexVersion === 4 || options.targetCodexVersion === 5) && previous.hashMode === "codex-settings-v3") && !(options.targetCodexVersion === 5 && previous.hashMode === "codex-settings-v4")) throw new Error("Codex settings witness upgrade requires an eligible preserved configuration witness");
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
  if (options.agent === "sumi") {
    const preimage = readSumiSettingsPreimage(options.reviewedPreimage);
    for (const source of binding.sources) {
      if (source === previous || source.path !== configPath) continue;
      if (source.hashMode !== undefined || source.format !== "json" || !isDeepStrictEqual(source.fields, [...SUMI_DISCOVERY_PROJECTION_FIELDS]) || typeof source.sha256 !== "string") throw new Error("Sumi settings witness upgrade found an unrecognized configuration witness");
      if (projectNativeDiscoveryFields(preimage, "json", source.fields!, configPath) !== source.sha256) throw new Error("Reviewed preimage does not explain the Sumi discovery projection witness");
      replaced.push(source);
    }
  }
  const next = options.agent === "sumi"
    ? upgradeSumiSettingsWitness(previous as Parameters<typeof upgradeSumiSettingsWitness>[0], options.reviewedPreimage)
    : options.agent === "claude"
    ? options.targetClaudeVersion === 4
      ? upgradeClaudeSettingsWitnessV4(previous as Parameters<typeof upgradeClaudeSettingsWitnessV4>[0], options.reviewedPreimage)
      : upgradeClaudeSettingsWitness(previous as Parameters<typeof upgradeClaudeSettingsWitness>[0], options.reviewedPreimage)
    : options.targetCodexVersion === 5
      ? upgradeCodexSettingsWitnessV5(previous as Parameters<typeof upgradeCodexSettingsWitnessV5>[0], options.reviewedPreimage)
    : options.targetCodexVersion === 4
      ? upgradeCodexSettingsWitnessV4(previous as Parameters<typeof upgradeCodexSettingsWitnessV4>[0], options.reviewedPreimage)
    : options.targetCodexVersion === 3
      ? upgradeCodexSettingsWitnessV3(previous as Parameters<typeof upgradeCodexSettingsWitnessV3>[0], options.reviewedPreimage)
      : upgradeCodexSettingsWitness(previous as Parameters<typeof upgradeCodexSettingsWitness>[0], options.reviewedPreimage);
  const rebound: DiscoverySource[] = [];
  for (const source of binding.sources) {
    if (!replaced.includes(source)) { rebound.push(source); continue; }
    if (source === replaced[0]) rebound.push(next);
  }
  const replacement: AgentDiscoveryBinding = { ...binding, sources: rebound };
  // A proved semantic replacement is explicit in this plan. Verify every
  // unrelated source without rebinding it to whatever happens to be on disk.
  verifyAgentDiscovery(replacement, undefined, aliases);
  const after = serializeManagedSkillPolicy({ ...policy, bridge: { ...policy.bridge, discovery: { ...policy.bridge.discovery, [options.agent]: replacement } } });
  return { dataDir, profileId: policy.profileId, changes: [{ path: join(dataDir, "agent-policy.json"), before: snapshot.text, after }], nativeSkills: [], observedPolicy: { path: join(dataDir, "agent-policy.json"), before: snapshot.text }, observedSettings: { path: configPath, before: settings }, discoveryBefore: [replacement], discoveryAfter: [replacement], ...(policy.bridge.discoveryExecutables ? { discoveryExecutables: policy.bridge.discoveryExecutables } : {}), rootAliases: aliases, managedAgentChecks: { home, agents: [options.agent] }, settingsWitnessUpgrade: { agent: options.agent, path: configPath, fromHashMode: previous.hashMode ?? "bytes", fromSha256: previous.sha256, toHashMode: next.hashMode, toSha256: next.sha256, reviewedPreimage: options.reviewedPreimage, currentSettingsSha256: options.expectedSettingsSha256, replacedWitnesses: replaced.map(source => ({ hashMode: source.hashMode ?? "bytes", sha256: source.sha256! })) } };
}

export interface CodexSemanticCacheUpgrade {
  agent: "codex";
  appOnlyParents: string[];
  /** Explicit cache parents whose complete native mcp_tool hook contract was already enrolled. */
  reviewedHookParents?: string[];
  expectedPolicySha256: string;
  expectedSettingsSha256: string;
  expectedCacheWitnessSha256?: string;
  home?: string;
  dataDir?: string;
}
/** Explicit current capability review. Old aggregate directory digests remain
 * evidence, not a reconstructed historical tree or a new byte baseline. */
export function planCodexSemanticCacheWitnessUpgrade(options: CodexSemanticCacheUpgrade): AgentIntegrationPlan {
  if (options.agent !== "codex" || !/^[a-f0-9]{64}$/.test(options.expectedPolicySha256)
    || !/^[a-f0-9]{64}$/.test(options.expectedSettingsSha256)
    || options.expectedCacheWitnessSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedCacheWitnessSha256)
    || !Array.isArray(options.appOnlyParents) || options.appOnlyParents.length > 4096 || new Set(options.appOnlyParents).size !== options.appOnlyParents.length
    || options.reviewedHookParents !== undefined && (!Array.isArray(options.reviewedHookParents) || options.reviewedHookParents.length > 4096 || new Set(options.reviewedHookParents).size !== options.reviewedHookParents.length)) throw new Error("Invalid Codex semantic cache upgrade request");
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot || sha(snapshot.text) !== options.expectedPolicySha256) throw new Error("Managed policy preimage changed");
  const policy = snapshot.value, aliases = policy.bridge?.rootAliases ?? [];
  recheckRootAliases(aliases);
  const binding: AgentDiscoveryBinding | undefined = policy.bridge?.discovery?.codex;
  if (!binding || binding.agent !== "codex" || binding.method !== "reviewed" || binding.codexSemanticCache) throw new Error("Cache upgrade requires an existing legacy reviewed Codex binding");
  const controls: CodexPluginSkillControl[] = policy.bridge?.codexPluginSkills ?? [];
  if (!supportsCodexNativeCapability(policy.bridge?.codexPluginSkillReview?.version, "installed-plugin-review")) throw new Error("Cache upgrade requires prior installed-plugin review");
  if (!controls.length || !isDeepStrictEqual(controls, binding.codexDisabledPluginSkills ?? controls)) throw new Error("Cache upgrade requires unchanged enrolled plugin controls");
  const cacheRoot = canonicalAgentPath(join(home, ".codex/plugins/cache"), aliases);
  if (controls.some(control => dirname(dirname(control.pluginParent)) !== cacheRoot)) throw new Error("Cache upgrade names another enrolled cache");
  const configPath = canonicalAgentPath(join(home, ".codex/config.toml"), aliases), settings = readOptional(configPath);
  if (settings === null || sha(settings) !== options.expectedSettingsSha256) throw new Error("Native settings preimage changed");
  const boundedRead = (path: string): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readNativeBytes(path, 1024 * 1024));
  const unchangedFullSource = (path: string): string => {
    const sources = binding.sources.filter(source => source.path === path && source.sha256 !== null && source.format === undefined && source.fields === undefined && source.reviewArtifact === undefined && (source.hashMode === undefined || source.hashMode === "bytes"));
    if (sources.length !== 1) throw new Error("Cache upgrade requires one unambiguous prior full identity source");
    const source = sources[0]!;
    const text = boundedRead(path);
    if (sha(text) !== source.sha256) throw new Error("Reviewed cache identity source changed");
    return text;
  };
  const unchangedReviewedHookSource = (path: string): string => {
    const sources = binding.sources.filter(source => source.path === path);
    if (!sources.length) throw new Error("Cache upgrade lacks prior full identity source");
    if (sources.length !== 1) throw new Error("Reviewed hook identity source is ambiguous");
    return unchangedFullSource(path);
  };
  const appOnlyParents: CodexSemanticCacheAppOnlyParent[] = options.appOnlyParents.map(parent => {
    const parts = relative(cacheRoot, parent).split(sep);
    if (!isAbsolute(parent) || resolve(parent) !== parent || parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]{1,64}$/.test(part))
      || controls.some(control => control.pluginParent === parent)) throw new Error("Unsupported app-only parent role");
    const receipt = JSON.parse(unchangedFullSource(join(parent, ".codex-remote-plugin-install.json")));
    if (!receipt || Object.keys(receipt).length !== 2 || receipt.schema_version !== 1 || typeof receipt.remote_plugin_id !== "string") throw new Error("Invalid reviewed app-only parent identity");
    const manifests = binding.sources.filter(source => source.path.startsWith(parent + sep) && source.path.endsWith(join(sep, ".codex-plugin/plugin.json")));
    if (!manifests.length) throw new Error("App-only bootstrap lacks prior full manifests");
    for (const source of manifests) unchangedFullSource(source.path);
    return { role: "app-only" as const, pluginId: `${parts[1]}@${parts[0]}`, namespace: parts[1]!, pluginParent: parent, remotePluginId: receipt.remote_plugin_id };
  }).sort((a, b) => a.pluginParent.localeCompare(b.pluginParent));
  const reviewedHookParents: CodexSemanticCacheReviewedHookParent[] = (options.reviewedHookParents ?? []).map(parent => {
    const parts = relative(cacheRoot, parent).split(sep);
    if (!isAbsolute(parent) || resolve(parent) !== parent || parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]{1,64}$/.test(part))
      || controls.some(control => control.pluginParent === parent) || appOnlyParents.some(role => role.pluginParent === parent)) throw new Error("Unsupported reviewed native-hook parent role");
    const receiptPath = join(parent, ".codex-remote-plugin-install.json"), receiptStat = lstatSync(receiptPath, { throwIfNoEntry: false });
    let identity: CodexSemanticCacheReviewedHookParent;
    if (receiptStat) {
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 16 * 1024) throw new Error("Invalid reviewed native-hook install receipt");
      const receiptText = unchangedReviewedHookSource(receiptPath);
      let receipt: any;
      try { hashNativeJsonControls(receiptText); receipt = JSON.parse(receiptText); } catch { throw new Error("Invalid reviewed native-hook install receipt"); }
      if (!receipt || Array.isArray(receipt) || Object.keys(receipt).length !== 2 || receipt.schema_version !== 1
        || typeof receipt.remote_plugin_id !== "string" || !/^[A-Za-z0-9_~-]{1,1024}$/.test(receipt.remote_plugin_id)) throw new Error("Invalid reviewed native-hook install receipt");
      identity = { role: "reviewed-hook", pluginId: `${parts[1]}@${parts[0]}`, namespace: parts[1]!, pluginParent: parent, installation: "remote-receipt", remotePluginId: receipt.remote_plugin_id };
    } else {
      const pluginId = `${parts[1]}@${parts[0]}`;
      const marketplaceSources = binding.sources.filter(source => basename(source.path) === "marketplace.json" && source.sha256 !== null
        && source.format === undefined && source.fields === undefined && source.reviewArtifact === undefined && (source.hashMode === undefined || source.hashMode === "bytes"));
      const matches = marketplaceSources.flatMap(source => {
        const text = unchangedFullSource(source.path);
        return codexLocalMarketplaceMapsPlugin(text, parts[0]!, parts[1]!) ? [{ source, text }] : [];
      });
      if (matches.length !== 1) throw new Error("Local marketplace hook parent lacks one exact enrolled marketplace source");
      const { source } = matches[0]!;
      const config = Bun.TOML.parse(settings) as any;
      if (config.plugins?.[pluginId]?.enabled !== true) throw new Error("Local marketplace hook parent is not enabled in the unchanged Codex settings");
      identity = { role: "reviewed-hook", pluginId, namespace: parts[1]!, pluginParent: parent, installation: "local-marketplace", marketplaceSourcePath: source.path, marketplaceSha256: source.sha256! };
    }
    const versions = readdirSync(parent).filter(name => name !== ".codex-remote-plugin-install.json");
    if (!versions.length || versions.length > 4096) throw new Error("Reviewed native-hook parent has no bounded materializations");
    for (const version of versions) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version)) throw new Error("Invalid reviewed native-hook version identity");
      const root = join(parent, version), stat = lstatSync(root, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) throw new Error("Invalid reviewed native-hook materialization");
      unchangedReviewedHookSource(join(root, ".codex-plugin/plugin.json"));
      unchangedReviewedHookSource(join(root, "hooks/hooks.json"));
    }
    return identity;
  }).sort((a, b) => a.pluginParent.localeCompare(b.pluginParent));
  const parents = [...new Set([...controls.map(control => control.pluginParent), ...appOnlyParents.map(parent => parent.pluginParent), ...reviewedHookParents.map(parent => parent.pluginParent)])];
  const reviewedAlias = aliases.find((alias: AgentRootAlias) => alias.agent === "codex");
  const hookRootAlias = reviewedAlias ? { alias: reviewedAlias.alias, target: reviewedAlias.target } : null;
  assertCodexSemanticCacheHookSafety(cacheRoot, parents, configPath, hookRootAlias);
  const supersededSources = binding.sources.filter(source => codexSemanticCacheSourceRole(source, cacheRoot, parents, reviewedHookParents.map(parent => parent.pluginParent)));
  // Existing app/MCP full-byte witnesses must explain the bootstrap too. The
  // stale skill manifest is covered by its already enrolled semantic controls.
  for (const source of supersededSources) if ([".app.json", ".mcp.json"].includes(source.path.split(sep).at(-1)!)) unchangedFullSource(source.path);
  const supersededDirectories = (binding.directories ?? []).filter(directory => codexSemanticCacheDirectoryRole(directory.path, cacheRoot));
  if (!supersededDirectories.some(directory => directory.path === cacheRoot)
    || (binding.directories ?? []).some(directory => cacheRoot.startsWith(directory.path + sep))) throw new Error("Cache upgrade requires exact cache directory coverage without an unproved ancestor projection");
  const rules = (Bun.TOML.parse(settings) as any).skills?.config ?? [];
  const witness = captureCodexSemanticCacheWitness({ cacheRoot, controls, appOnlyParents, reviewedHookParents, rules, read: boundedRead });
  if (options.expectedCacheWitnessSha256 !== undefined && witness.sha256 !== options.expectedCacheWitnessSha256) throw new Error("Reviewed semantic cache preimage changed");
  const replacement: AgentDiscoveryBinding = { ...binding, codexDisabledPluginSkills: controls, codexSemanticCache: {
    schema: "hasna.codex-semantic-cache-discovery.v1", configPath, hookRootAlias, witness, appOnlyParents, reviewedHookParents, previousPolicySha256: options.expectedPolicySha256, supersededSources, supersededDirectories,
  } };
  verifyAgentDiscovery(replacement, undefined, aliases);
  const after = serializeManagedSkillPolicy({ ...policy, bridge: { ...policy.bridge, discovery: { ...policy.bridge.discovery, codex: replacement } } });
  return { dataDir, profileId: policy.profileId, nativeSkills: [], changes: [{ path: join(dataDir, "agent-policy.json"), before: snapshot.text, after }],
    observedPolicy: { path: join(dataDir, "agent-policy.json"), before: snapshot.text }, observedSettings: { path: configPath, before: settings },
    discoveryBefore: [replacement], discoveryAfter: [replacement], rootAliases: aliases, managedAgentChecks: { home, agents: ["codex"] },
    ...(policy.bridge.discoveryExecutables ? { discoveryExecutables: policy.bridge.discoveryExecutables } : {}),
    cacheWitnessUpgrade: { ...options, home, dataDir, appOnlyParents: appOnlyParents.map(parent => parent.pluginParent), reviewedHookParents: reviewedHookParents.map(parent => parent.pluginParent) } };
}

export interface ReviewArtifactMigration {
  kind: "codex-native-catalog"; sourcePath: string; expectedPolicySha256: string; expectedSourceSha256: string;
  home?: string; dataDir?: string; projectDir?: string;
}
/** Explicit exact-proof migration. Never captures a new catalog or refreshes live inputs. */
export function planReviewedArtifactMigration(options: ReviewArtifactMigration): AgentIntegrationPlan {
  if (options.kind !== "codex-native-catalog" || !/^[a-f0-9]{64}$/.test(options.expectedPolicySha256)
    || !/^[a-f0-9]{64}$/.test(options.expectedSourceSha256)) throw new Error("REVIEW_ARTIFACT_INVALID");
  const home = resolve(options.home ?? homedir()), dataDir = resolve(options.dataDir ?? getDataDirReadOnly());
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot || sha(snapshot.text) !== options.expectedPolicySha256) throw new Error("REVIEW_ARTIFACT_POLICY_CHANGED");
  const before = snapshot.value.bridge?.discovery?.codex as AgentDiscoveryBinding | undefined;
  if (!before || before.agent !== "codex" || before.method !== "reviewed") throw new Error("REVIEW_ARTIFACT_INVALID");
  // All existing native trust and live inputs must still pass. A recovered exact
  // source may satisfy its old witness; a missing source cannot be substituted.
  assertManagedAgentBridge("codex", { home, dataDir, projectDir: options.projectDir ?? home });
  const retained = planReviewArtifactRetention(before, [{ kind: options.kind, path: options.sourcePath, sha256: options.expectedSourceSha256 }], dataDir, home);
  const next = { ...snapshot.value, bridge: { ...snapshot.value.bridge,
    discovery: { ...snapshot.value.bridge.discovery, codex: retained.binding } } };
  return { dataDir, profileId: snapshot.value.profileId, nativeSkills: [],
    changes: [...retained.changes, { path: join(dataDir, "agent-policy.json"), before: snapshot.text, after: serializeManagedSkillPolicy(next) }],
    observedPolicy: { path: join(dataDir, "agent-policy.json"), before: snapshot.text },
    reviewArtifactSources: retained.observed, retainedReviewArtifacts: retained.changes,
    reviewArtifactMigration: { ...options, home, dataDir },
    discoveryBefore: [{ ...before, codexDisabledPluginSkills: snapshot.value.bridge.codexPluginSkills ?? [] }],
    discoveryAfter: [{ ...retained.binding, codexDisabledPluginSkills: snapshot.value.bridge.codexPluginSkills ?? [] }],
    rootAliases: snapshot.value.bridge.rootAliases ?? [],
    managedAgentChecks: { home, projectDir: options.projectDir ?? home, agents: ["codex"] } };
}

/** Exact copies, names and deny rows one Codex name reconcile plans. */
export interface CodexPluginReconcileInput {
  copies: Array<{ path: string; hash: string }>;
  /** New qualified names added to the reviewed controls. */
  names: string[];
  /** Plugin parents whose documents the reconcile reviews: enrolled and newly enrolled. */
  parents: string[];
  /** Caller-verified native install receipts of newly enrolled remote parents. */
  remoteIdentities: Record<string, string>;
  /** Catalog-only skills outside the plugin cache: deny-only rows, no control. */
  nameDenies: string[];
  pathDenies: string[];
  /** The saved review with stale enrolled-plugin cache witnesses re-captured. */
  discovery?: AgentDiscoveryBinding;
}
export interface CodexPluginReconcileRequest { home: string; dataDir: string; projectDir: string; catalog: CodexNativeSkillCatalog }
export interface CodexPluginReconcilePlanState extends CodexPluginReconcileInput { request: CodexPluginReconcileRequest }
/** What the strict guard refused, collected for the reconcile instead of thrown. */
interface CodexReconcileCollection { custody?: ManagedBridgeCustody; blocking: NativeSkillEntry[]; inventory: NativeSkillEntry[] }
export interface CodexPluginReconcileReport {
  codexVersion: string;
  /** Qualified names this reconcile adds to the reviewed controls and denies by name. */
  enrolled: string[];
  /** Qualified names already enrolled before this reconcile. */
  alreadyEnrolled: number;
  /** Catalog skills outside the plugin cache (Codex runtime plugins) denied by their stable qualified name. */
  denied: string[];
  /** Skills denied by exact path because no stable qualified name covers them, with the reason. */
  pathDenied: Array<{ name: string; path: string; reason: "plugin-disabled" | "no-qualified-name" }>;
  /** Plugins explicitly disabled in [plugins]: no enrollment and no refusal. */
  inactive: string[];
  /** Every plugin this run classified as skills-only, citing the manifests read. */
  classified: Array<{ pluginId: string; capabilities: string[]; manifests: string[] }>;
  /** Reviewed cache witnesses re-captured after a skills-only version change. */
  rebasedWitnesses: number;
  /** Plugin-cache skill names left as they are: an existing path rule or an inactive plugin already makes them inert. */
  skipped: number;
  /** Native skills Codex loads after the reconcile; always exactly the bridge. */
  allowed: string[];
}
/** A refusal: nothing was written and the guard keeps blocking with `code`. */
export class CodexPluginReconcileRefusal extends Error {
  constructor(readonly code: string, detail: string, readonly refusals: Array<{ pluginId: string; reasons: string[]; manifests?: string[] }> = []) { super(`${code}: ${detail}`); }
}
/** The native skills Codex reported enabled, less those disabled by the rows
 * this run appends: the bridge, or a refusal. Rules already in the config Codex
 * read are never simulated; a skill Codex still reports enabled despite one
 * counts as allowed, so an ineffective deny (or a wrong name guess) refuses. */
function codexReconcileAllowedSkills(catalog: CodexNativeSkillCatalog, appendedRules: unknown, bridgeDocument: string): string[] {
  const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
  const allowed = catalog.skills.filter(skill => skill.enabled === true && !isCodexNativeSkillDisabled(skill, appendedRules));
  if (allowed.length !== 1 || allowed[0]!.name !== CLI_BRIDGE_NAME || allowed[0]!.pluginId !== null || canonical(allowed[0]!.path) !== canonical(bridgeDocument)) {
    throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID", `Codex would load ${allowed.length} native skill(s) (${nativeSkillPathList(allowed.map(skill => skill.name))}), not only the ${CLI_BRIDGE_NAME} bridge; nothing was written`);
  }
  return [CLI_BRIDGE_NAME];
}
/** The reconcile writes only appended disable rows and the bounded policy fields
 * that record them; anything else is a different review and refuses. */
export function assertCodexReconcileScope(plan: AgentIntegrationPlan, scope: { configPath: string; policyPath: string; prior: CodexPluginSkillControl[]; names: string[]; discovery: AgentDiscoveryBinding }): void {
  const exceeded = (detail: string): never => { throw new CodexPluginReconcileRefusal("CODEX_RECONCILE_SCOPE_EXCEEDED", `${detail}; run skills hook install to review this change`); };
  for (const change of plan.changes) if (![scope.configPath, scope.policyPath].includes(resolve(change.path))) exceeded(`the plan would also write ${nativeSkillPathList([change.path])}`);
  const config = plan.changes.find(change => resolve(change.path) === scope.configPath);
  if (config) {
    const before = Bun.TOML.parse(config.before ?? "") as any, after = Bun.TOML.parse(config.after) as any;
    const beforeRules = before.skills?.config ?? [], afterRules = after.skills?.config ?? [];
    const rest = (value: any) => { const copy = structuredClone(value); if (copy.skills) { delete copy.skills.config; if (!Object.keys(copy.skills).length) delete copy.skills; } return copy; };
    if (!isDeepStrictEqual(rest(before), rest(after)) || !Array.isArray(beforeRules) || !Array.isArray(afterRules) || afterRules.length < beforeRules.length
      || !isDeepStrictEqual(afterRules.slice(0, beforeRules.length), beforeRules)
      || afterRules.slice(beforeRules.length).some((rule: any) => !rule || rule.enabled !== false || Object.keys(rule).length !== 2 || (typeof rule.name === "string") === (typeof rule.path === "string"))) exceeded("the Codex configuration change is not only appended disable rules");
  }
  const policy = plan.changes.find(change => resolve(change.path) === scope.policyPath);
  if (!policy) return;
  if (policy.before === null) exceeded("the managed policy has no prior binding");
  const before = JSON.parse(policy.before!) as Record<string, any>, after = JSON.parse(policy.after) as Record<string, any>;
  const { bridge: beforeBridge, ...beforeRest } = before, { bridge: afterBridge, ...afterRest } = after;
  if (!isDeepStrictEqual(beforeRest, afterRest)) exceeded("the managed policy would change outside the Codex bridge");
  const recorded = new Set(["codexPluginSkills", "codexInactivePlugins", "discovery"]);
  for (const key of new Set([...Object.keys(beforeBridge ?? {}), ...Object.keys(afterBridge ?? {})])) if (!recorded.has(key) && !isDeepStrictEqual(beforeBridge?.[key], afterBridge?.[key])) exceeded(`the managed bridge field ${JSON.stringify(key)} would change`);
  if (!isDeepStrictEqual(beforeBridge?.codexInactivePlugins ?? [], afterBridge?.codexInactivePlugins ?? [])) exceeded("the inactive plugin review would change");
  const controls: CodexPluginSkillControl[] = afterBridge?.codexPluginSkills ?? [];
  if (!isDeepStrictEqual(controls.slice(0, scope.prior.length), scope.prior) || !isDeepStrictEqual(controls.slice(scope.prior.length).map(control => control.name), [...scope.names].sort())) exceeded("the reviewed plugin controls would change beyond the new names");
  const { codex: _beforeCodex, ...beforeOthers } = beforeBridge?.discovery ?? {}, { codex: afterCodex, ...afterOthers } = afterBridge?.discovery ?? {};
  if (!isDeepStrictEqual(beforeOthers, afterOthers)) exceeded("another agent's discovery would change");
  // The retired-parent proof is derived by captureRetiredCodexDiscovery from the
  // controls: enrolling a remote skills-only parent may add parents, never roots.
  const shape = (binding: any) => { const { codexDisabledPluginSkills: _controls, codexRetiredMaterializations: _retired, sources, ...rest } = binding ?? {}; return { rest, sources: (sources ?? []).map((source: DiscoverySource) => source.path === scope.configPath ? { ...source, sha256: null } : source) }; };
  if (!isDeepStrictEqual(shape(scope.discovery), shape(afterCodex))) exceeded("the Codex discovery review would change beyond the written configuration witness and re-captured cache witnesses");
  const retiredBefore = scope.discovery?.codexRetiredMaterializations, retiredAfter = afterCodex?.codexRetiredMaterializations;
  const controlParents = new Set(controls.map(control => control.pluginParent));
  if (!isDeepStrictEqual(retiredBefore?.roots ?? [], retiredAfter?.roots ?? []) || (retiredBefore?.parents ?? []).some((parent: string) => !(retiredAfter?.parents ?? []).includes(parent))
    || (retiredAfter?.parents ?? []).some((parent: string) => !controlParents.has(parent))) exceeded("the retired Codex materialization proof would change beyond enrolled parents");
}
/** Whether the saved review binds a local marketplace (`.agents/plugins/
 * marketplace.json`, current bytes) that maps exactly `market`/`name` to a
 * plugin directory, and also binds that directory's exact manifest. A manifest
 * witness elsewhere that merely shares the plugin's name proves nothing. */
function codexReviewedMarketplaceManifest(sources: DiscoverySource[], market: string, name: string): boolean {
  const full = (source: DiscoverySource) => source.sha256 !== null && source.format === undefined && source.fields === undefined && source.reviewArtifact === undefined && (source.hashMode === undefined || source.hashMode === "bytes");
  for (const source of sources) {
    if (!full(source) || basename(source.path) !== "marketplace.json" || basename(dirname(source.path)) !== "plugins" || basename(dirname(dirname(source.path))) !== ".agents") continue;
    let text: string | null; try { text = readOptional(source.path); } catch { continue; }
    if (text === null || sha(text) !== source.sha256 || !codexLocalMarketplaceMapsPlugin(text, market, name)) continue;
    const row = (JSON.parse(text).plugins as Array<{ name: string; source: { path: string } }>).find(item => item.name === name)!;
    const manifest = join(dirname(dirname(dirname(source.path))), row.source.path, ".codex-plugin", "plugin.json");
    if (sources.some(other => full(other) && other.path === manifest)) return true;
  }
  return false;
}
/** The Codex runtime plugin root holding a catalog skill, or null outside one. */
function codexRuntimePluginRoot(document: string, runtimeCache: string): string | null {
  if (!document.startsWith(runtimeCache + sep) || basename(document) !== "SKILL.md") return null;
  for (let root = dirname(dirname(document)), depth = 0; root.startsWith(runtimeCache + sep) && depth < 12; root = dirname(root), depth++) {
    if (lstatSync(join(root, ".codex-plugin/plugin.json"), { throwIfNoEntry: false })?.isFile()) return root;
  }
  return null;
}
/** Read-only plan for `skills hook codex-reconcile`. Enumerates the plugin-cache
 * skills the strict guard refuses and the catalog skills Codex would load from
 * its runtime cache; enrolls plugin-cache names whose capability tuple is
 * unchanged (or a not yet enrolled skills-only plugin), denies runtime skills by
 * qualified name (by exact path, reported, when Codex gives none), and refreshes
 * the reviewed binding through planAgentIntegration. A null plan means nothing
 * needs writing. Every refusal writes nothing. */
export function planCodexPluginNameReconcile(request: CodexPluginReconcileRequest): { plan: AgentIntegrationPlan | null; report: CodexPluginReconcileReport } {
  const home = resolve(request.home), dataDir = request.dataDir, projectDir = resolve(request.projectDir), catalog = request.catalog;
  if (!catalog || typeof catalog !== "object" || !supportsCodexNativeCapability(catalog.version, "qualified-skill-catalog") || !Array.isArray(catalog.plugins)) throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION", "this Codex release has no reviewed qualified skill and installed-plugin catalog");
  if (catalog.cwd !== projectDir) throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_CATALOG_INVALID", "the native catalog was captured for another working directory");
  projectCodexNativeSkillCatalog({ data: [{ cwd: catalog.cwd, errors: [], skills: catalog.skills }] }, catalog.cwd);
  const installed = projectCodexInstalledPluginEntries(catalog.plugins);
  const options = { home, dataDir, projectDir };
  const custody = assertManagedBridgeCustody("codex", options), aliases = custody.aliases, binding = custody.binding;
  // A binding that never recorded an installed-plugin catalog review has no
  // reviewed plugin baseline to reconcile against; never guess one.
  if (!supportsCodexNativeCapability(binding.codexPluginSkillReview?.version, "installed-plugin-review")) throw new CodexPluginReconcileRefusal("CODEX_RECONCILE_DISCOVERY_REVIEW_REQUIRED", "this Codex binding predates the installed-plugin catalog review, so a fresh full discovery review is required: skills hook install --agent codex --discovery-inputs <reviewed-file> --codex-native-catalog <reviewed-catalog> --apply");
  const cache = canonicalAgentPath(join(home, ".codex/plugins/cache"), aliases), configPath = canonicalAgentPath(join(home, ".codex/config.toml"), aliases), policyPath = join(dataDir, "agent-policy.json");
  const runtimeCacheLexical = canonicalAgentPath(join(home, ".cache/codex-runtimes"), aliases);
  const runtimeCache = (() => { try { return realpathSync(runtimeCacheLexical); } catch { return runtimeCacheLexical; } })();
  const read = (path: string) => new TextDecoder("utf-8", { fatal: true }).decode(readNativeBytes(path, 1024 * 1024));
  const configText = readOptional(configPath), config = Bun.TOML.parse(configText ?? "") as any, rules = config.skills?.config ?? [];
  const prior: CodexPluginSkillControl[] = binding.codexPluginSkills ?? [];
  const priorParents = [...new Set(prior.map(control => control.pluginParent))];
  // Capability first: an enrolled plugin that moved an app, MCP, hooks,
  // manifest or remote capability refuses before anything else is considered.
  // The reviewed tuple binds only some locations, so every current version root
  // also gets the strict scan over every location Codex reads; either refuses.
  // The witness rebase below runs only when both pass.
  const capabilityRefusals = priorParents.flatMap(parent => {
    const group = prior.filter(control => control.pluginParent === parent);
    const reasons = [...new Set([...codexPluginCapabilityChanges(cache, group, read, rules), ...enrolledCodexPluginStrictChanges(group, read)])].sort();
    return reasons.length ? [{ pluginId: group[0]!.pluginId, reasons, manifests: [] as string[] }] : [];
  });
  if (capabilityRefusals.length) throw new CodexPluginReconcileRefusal(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, "an enrolled Codex plugin changed a reviewed app, MCP, hooks, manifest or remote capability; it stays quarantined until reviewed with skills hook install and a fresh native catalog and discovery review", capabilityRefusals);
  // Capability tuples are unchanged, so stale byte witnesses of those plugins'
  // version materializations are re-captured; the rebased review is verified below.
  const savedDiscovery: AgentDiscoveryBinding | undefined = binding.discovery?.codex;
  const strictlySkillsOnly = (parent: string) => { const group = prior.filter(control => control.pluginParent === parent); return codexPluginCapabilityChanges(cache, group, read, rules).length === 0 && enrolledCodexPluginStrictChanges(group, read).length === 0; };
  const rebase = savedDiscovery ? rebaseCodexEnrolledCacheWitnesses({ ...savedDiscovery, codexDisabledPluginSkills: prior }, cache, priorParents, strictlySkillsOnly) : { binding: savedDiscovery, rebased: [] as string[] };
  const discovery = rebase.rebased.length ? (() => { const { codexDisabledPluginSkills: _controls, ...rest } = rebase.binding!; return rest as AgentDiscoveryBinding; })() : undefined;
  const collected: CodexReconcileCollection = { blocking: [], inventory: [] };
  try { assertManagedAgentBridgeWithDiscovery("codex", options, discovery, collected); }
  catch (error) {
    if (error instanceof Error && error.message.includes(`${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}:`)) throw new CodexPluginReconcileRefusal(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, "an enrolled Codex plugin changed a reviewed capability; it stays quarantined until reviewed with skills hook install and a fresh native catalog and discovery review");
    throw error;
  }
  const identityOf = (entry: NativeSkillEntry) => entry.agent === "codex" && entry.vendor && !entry.system && !entry.bridge && entry.path.startsWith(cache + sep)
    ? classifyCodexPluginCacheDocument(join(entry.path, "SKILL.md"), cache, read) : null;
  // The plugin a cache copy belongs to comes from the cache layout; the strict
  // parser's identity (qualified name) exists only for a supported plugin root.
  const cacheParent = (entry: NativeSkillEntry) => {
    if (entry.agent !== "codex" || !entry.vendor || entry.system || entry.bridge || !entry.path.startsWith(cache + sep)) return null;
    const parts = relative(cache, entry.path).split(sep);
    return parts.length >= 4 && parts.slice(0, 2).every(part => /^[A-Za-z0-9_-]{1,64}$/.test(part)) ? { parent: join(cache, parts[0]!, parts[1]!), pluginId: `${parts[1]}@${parts[0]}` } : null;
  };
  const outside = collected.blocking.filter(entry => !cacheParent(entry));
  if (outside.length) throw new CodexPluginReconcileRefusal("NATIVE_SKILL_DRIFT", `native skill copies outside the Codex plugin cache need their own review: ${nativeSkillPathList(outside.map(item => item.path))}; this command enrolls plugin skills only (see skills migrate native, or a fresh discovery review for runtime roots)`);
  const copies = collected.blocking.map(entry => ({ entry, ...cacheParent(entry)!, identity: identityOf(entry) }));
  const pluginDisabled = (pluginId: string) => config.plugins?.[pluginId]?.enabled === false;
  const refusals: Array<{ pluginId: string; reasons: string[]; manifests: string[] }> = [], inactive = new Set<string>(), enrollableParents: string[] = [], remoteIdentities: Record<string, string> = {};
  const classified: CodexPluginReconcileReport["classified"] = [];
  const refuse = (pluginId: string, reasons: Iterable<string>, manifests: string[]) => { if (!refusals.some(item => item.pluginId === pluginId)) refusals.push({ pluginId, reasons: [...new Set(reasons)].sort(), manifests }); };
  const pathDenied: CodexPluginReconcileReport["pathDenied"] = [];
  for (const parent of [...new Set(copies.map(copy => copy.parent))].sort()) {
    const group = copies.filter(copy => copy.parent === parent), pluginId = group[0]!.pluginId;
    if (priorParents.includes(parent)) {
      if (group.some(copy => !copy.identity)) throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_IDENTITY_UNSUPPORTED", `a skill document of the enrolled plugin ${JSON.stringify(pluginId)} has no supported qualified name: ${nativeSkillPathList(group.filter(copy => !copy.identity).map(copy => copy.entry.path))}`);
      continue;
    }
    // Explicitly disabled: Codex loads none of its capabilities. The guard does
    // not trust a plugin-level disable alone, so the reviewed planner keeps its
    // exact-path denies; nothing is enrolled and nothing refuses.
    if (pluginDisabled(pluginId)) {
      inactive.add(pluginId);
      for (const copy of group) pathDenied.push({ name: copy.identity?.name ?? basename(copy.entry.path), path: join(copy.entry.path, "SKILL.md"), reason: "plugin-disabled" });
      continue;
    }
    const evidence = unenrolledCodexPluginEvidence(parent, read), reasons = new Set<string>(evidence.reasons);
    if (group.some(copy => !copy.identity) && !reasons.size) reasons.add("unsupported");
    const plugin = installed.find(item => item.id === pluginId), receipt = lstatSync(join(parent, ".codex-remote-plugin-install.json"), { throwIfNoEntry: false });
    // A receipt is recorded as the plugin's remote identity only when the native
    // catalog reports that same remote installation; anything else refuses.
    if (receipt) {
      const identity = codexRemoteInstallReceipt(parent, read);
      if (identity === null || plugin?.remotePluginId !== identity) reasons.add("remote");
      else remoteIdentities[parent] = identity;
    } else if (plugin?.sourceType === "remote" || plugin?.remotePluginId !== undefined) reasons.add("remote");
    if (reasons.size) refuse(pluginId, reasons, evidence.manifests);
    else { enrollableParents.push(parent); classified.push({ pluginId, capabilities: [], manifests: evidence.manifests }); }
  }
  // Census: every plugin explicitly enabled in [plugins] that the saved binding
  // does not know is classified, even when none of its skills is blocking now.
  // Known means enrolled, inactive, an installation input, a semantic cache
  // role, a full witness under its exact cache parent, or a reviewed local
  // marketplace that maps it with that row's manifest witnessed. An enabled id
  // that maps to no single cache parent refuses; one not installed is skipped.
  const savedSources: DiscoverySource[] = savedDiscovery?.sources ?? [];
  const semanticParents = [...(savedDiscovery?.codexSemanticCache?.appOnlyParents ?? []), ...(savedDiscovery?.codexSemanticCache?.reviewedHookParents ?? [])].map(role => role.pluginParent);
  for (const [pluginId, settings] of Object.entries((config.plugins ?? {}) as Record<string, any>).sort(([a], [b]) => a.localeCompare(b))) {
    if (settings?.enabled !== true || refusals.some(item => item.pluginId === pluginId) || classified.some(item => item.pluginId === pluginId)) continue;
    const at = pluginId.lastIndexOf("@"), name = pluginId.slice(0, at), market = pluginId.slice(at + 1);
    if (at < 1 || ![name, market].every(part => /^[A-Za-z0-9_-]{1,64}$/.test(part))) { refuse(pluginId, ["unsupported"], []); continue; }
    const parent = join(cache, market, name);
    if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) continue;
    const known = priorParents.includes(parent) || semanticParents.includes(parent)
      || (binding.codexInactivePlugins ?? []).some((control: { pluginId: string }) => control.pluginId === pluginId)
      || (savedDiscovery?.codexInstallationInputs?.plugins ?? []).some(input => input.pluginId === pluginId)
      || savedSources.some(source => source.sha256 !== null && source.path.startsWith(parent + sep))
      || codexReviewedMarketplaceManifest(savedSources, market, name);
    if (known) continue;
    const evidence = unenrolledCodexPluginEvidence(parent, read);
    if (evidence.reasons.length) refuse(pluginId, evidence.reasons, evidence.manifests);
    else classified.push({ pluginId, capabilities: [], manifests: evidence.manifests });
  }
  // Catalog skills Codex would load from its runtime cache, which the guard's
  // plugin controls do not cover: deny each by its stable qualified name.
  const nameDenies = new Set<string>(), pathDenies = new Set<string>(), denied = new Set<string>(), runtimeNameDeniedDocuments = new Set<string>();
  for (const skill of catalog.skills) {
    // Codex's own report decides: an enabled skill is acted on even when a deny
    // row already exists, and the allowed-set check then refuses if it stays enabled.
    if (skill.enabled !== true || skill.name === CLI_BRIDGE_NAME && skill.pluginId === null) continue;
    let document: string; try { document = realpathSync(skill.path); } catch { continue; }
    const root = codexRuntimePluginRoot(document, runtimeCache);
    if (!root) continue;
    const pluginId = skill.pluginId ?? `${basename(root)}@codex-runtime`;
    if (skill.pluginId !== null && pluginDisabled(skill.pluginId)) { inactive.add(skill.pluginId); continue; }
    const evidence = codexPluginRootEvidence(root, read);
    if (evidence.reasons.length) { refuse(pluginId, evidence.reasons, evidence.manifests); continue; }
    if (!classified.some(item => item.pluginId === pluginId)) classified.push({ pluginId, capabilities: [], manifests: evidence.manifests });
    let namespace: string | null = null; try { namespace = JSON.parse(read(join(root, ".codex-plugin/plugin.json")))?.name ?? null; } catch { /* unqualified below */ }
    const qualified = skill.pluginId !== null && typeof namespace === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(namespace) && skill.pluginId.slice(0, skill.pluginId.lastIndexOf("@")) === namespace
      && skill.name.startsWith(`${namespace}:`) && /^[A-Za-z0-9_-]{1,64}$/.test(skill.name.slice(namespace.length + 1));
    if (qualified) { nameDenies.add(skill.name); denied.add(skill.name); runtimeNameDeniedDocuments.add(document); }
    else { pathDenies.add(document); pathDenied.push({ name: skill.name, path: document, reason: "no-qualified-name" }); }
  }
  if (refusals.length) throw new CodexPluginReconcileRefusal(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, "a Codex plugin Skills has not enrolled carries an app, MCP or hooks capability (or an unverified remote installation); its skills stay quarantined until reviewed with skills hook install and a fresh native catalog and discovery review", refusals.sort((a, b) => a.pluginId.localeCompare(b.pluginId)));
  const priorNames = new Set(prior.map(control => control.name));
  const names = [...new Set(copies.filter(copy => priorParents.includes(copy.parent) || enrollableParents.includes(copy.parent)).map(copy => copy.identity!.name))].filter(name => !priorNames.has(name)).sort();
  // Never override an explicit enable rule, by name or by exact path; that
  // includes the catalog name of every skill this run would deny by path.
  const canonicalRule = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
  for (const name of [...priorNames, ...names, ...nameDenies, ...pathDenied.map(item => item.name)]) if (Array.isArray(rules) && rules.some((rule: any) => typeof rule?.name === "string" && rule.name.trim() === name && rule.enabled !== false)) throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_NAME_CONFLICT", `an existing [[skills.config]] rule enables ${JSON.stringify(name)}; review it before reconciling`);
  const deniedPaths = [...pathDenies, ...runtimeNameDeniedDocuments, ...copies.map(copy => join(copy.entry.path, "SKILL.md"))];
  if (Array.isArray(rules) && rules.some((rule: any) => typeof rule?.path === "string" && rule.enabled !== false && deniedPaths.includes(canonicalRule(rule.path)))) throw new CodexPluginReconcileRefusal("CODEX_NATIVE_SKILL_NAME_CONFLICT", "an existing [[skills.config]] rule enables a skill path this reconcile would deny; review it before reconciling");
  const missingDenies = prior.filter(control => !(Array.isArray(rules) && rules.some((rule: any) => typeof rule?.name === "string" && rule.name.trim() === control.name && rule.enabled === false)));
  const bridgeDocument = join(custody.expected, "SKILL.md");
  const report = (enrolledNames: string[], appendedRules: unknown): CodexPluginReconcileReport => {
    const controlled = new Set([...priorNames, ...enrolledNames, ...pathDenied.map(item => item.name)]);
    const skipped = new Set(collected.inventory.flatMap(entry => { const identity = identityOf(entry); return identity && !controlled.has(identity.name) ? [identity.name] : []; }));
    return { codexVersion: catalog.version, enrolled: enrolledNames, alreadyEnrolled: priorNames.size, denied: [...denied].sort(), pathDenied: pathDenied.sort((a, b) => a.path.localeCompare(b.path)),
      inactive: [...inactive].sort(), classified: [...classified].sort((a, b) => a.pluginId.localeCompare(b.pluginId)), rebasedWitnesses: rebase.rebased.length, skipped: skipped.size, allowed: codexReconcileAllowedSkills(catalog, appendedRules, bridgeDocument) };
  };
  if (!copies.length && !missingDenies.length && !nameDenies.size && !pathDenies.size && !rebase.rebased.length) return { plan: null, report: report([], []) };
  if (savedDiscovery?.codexSemanticCache) throw new CodexPluginReconcileRefusal("CODEX_RECONCILE_SEMANTIC_CACHE_UNSUPPORTED", "this binding uses the semantic cache witness, which binds the complete name set; refresh it with a fresh skills hook install review");
  const input: CodexPluginReconcileInput = { copies: copies.map(copy => ({ path: copy.entry.path, hash: copy.entry.hash })).sort((a, b) => a.path.localeCompare(b.path)), names,
    parents: [...priorParents, ...enrollableParents].sort(), remoteIdentities, nameDenies: [...nameDenies].sort(), pathDenies: [...pathDenies].sort(), ...(discovery ? { discovery } : {}) };
  const plan = planAgentIntegration({ home, dataDir, projectDir, agents: ["codex"], codexNativeCatalog: catalog, codexReconcile: input });
  assertCodexReconcileScope(plan, { configPath, policyPath, prior, names, discovery: discovery ?? savedDiscovery! });
  const configChange = plan.changes.find(change => resolve(change.path) === configPath);
  // Append-only is enforced by the scope check above, so the new rows are the tail.
  const plannedRules: unknown[] = configChange ? (Bun.TOML.parse(configChange.after) as any).skills?.config ?? [] : [];
  const result = report(names, configChange ? plannedRules.slice(Array.isArray(rules) ? rules.length : 0) : []);
  if (!plan.changes.length) throw new Error("CODEX_RECONCILE_FAILED: the reconcile found work but planned no change");
  plan.codexReconcile = { ...input, request: { home, dataDir, projectDir, catalog } };
  return { plan, report: result };
}

export function applyAgentIntegration(plan: AgentIntegrationPlan, options: CodexCorpusWriteOptions = {}): { changed: string[]; backups: string[]; rootAliases?: AgentRootAlias[] } & CodexAdmissionReceipt {
  const roots = plan.changes.flatMap(change => {
    const lexical = codexCorpusRootForPath(change.path);
    const alias = plan.rootAliases?.find(item => item.agent === "codex" && (change.path === item.target || change.path.startsWith(item.target + "/")));
    return lexical ? [lexical] : alias ? [alias.alias] : [];
  });
  return withCodexCorpusWrite(roots, (assertCurrent, admission) => applyAgentIntegrationUnlocked(plan, options, assertCurrent, admission), options);
}

function applyAgentIntegrationUnlocked(plan: AgentIntegrationPlan, options: CodexCorpusWriteOptions = {}, assertCurrent: () => void, admission?: CodexCorpusAdmission): { changed: string[]; backups: string[]; rootAliases?: AgentRootAlias[] } & CodexAdmissionReceipt {
  const fallback = codexAdmissionReceipt(admission);
  for (const source of plan.reviewArtifactSources ?? []) verifyReviewArtifactOriginal(source.path, source.sha256);
  for (const source of plan.observedNativeSources ?? []) if (nativeSourceDigest(source.path) !== source.sha256) throw new Error("Native identity source changed after planning");
  if (plan.observedSettings && readOptional(plan.observedSettings.path) !== plan.observedSettings.before) throw new Error("Native settings changed after witness planning");
  // Refuse an unusable policy before creating backups or changing native config.
  const policyPath = join(plan.dataDir, "agent-policy.json"); assertSafePath(policyPath);
  const currentText = (path: string) => resolve(path) === resolve(policyPath) ? readManagedSkillPolicySnapshot(plan.dataDir)?.text ?? null : readOptional(path);
  readManagedSkillPolicySnapshot(plan.dataDir);
  for (const change of plan.changes) if (resolve(change.path) === resolve(policyPath)) parseManagedSkillPolicy(change.after);
  const aliases = plan.rootAliases ?? [];
  assertCurrent(); recheckRootAliases(aliases);
  // Verify the old trust before writing. An explicit command/profile change
  // still uses the ordinary native approval flow for its newly installed hook.
  // Recheck custody, discovery and unexpected copies before backups or writes.
  // Only the repairable bridge protection waits for the post-write proof.
  const reconcileCopies = plan.codexReconcile ? new Map(plan.codexReconcile.copies.map(copy => [copy.path, copy.hash])) : undefined;
  for (const agent of plan.retainedReviewChecks?.agents ?? []) assertRetainedReviewState(agent, { ...plan.retainedReviewChecks!, dataDir: plan.dataDir }, agent === "codex" ? reconcileCopies : undefined, agent === "codex" ? plan.codexReconcile?.discovery : undefined);
  if (plan.codexReconcile) {
    // Re-derive the whole reconcile under the corpus lock from the same native
    // catalog; any native, configuration or policy movement refuses the write.
    const verified = planCodexPluginNameReconcile(plan.codexReconcile.request).plan;
    if (!verified || JSON.stringify(verified.changes) !== JSON.stringify(plan.changes)
      || JSON.stringify(verified.discoveryAfter) !== JSON.stringify(plan.discoveryAfter)
      || JSON.stringify(verified.codexReconcile) !== JSON.stringify(plan.codexReconcile)) throw new Error("CODEX_RECONCILE_PLAN_CHANGED: native state changed after the Codex name reconcile was planned; run it again");
  }
  if (plan.reviewArtifactMigration) {
    const verified = planReviewedArtifactMigration(plan.reviewArtifactMigration);
    if (JSON.stringify(verified.changes) !== JSON.stringify(plan.changes)
      || JSON.stringify(verified.discoveryAfter) !== JSON.stringify(plan.discoveryAfter)) throw new Error("REVIEW_ARTIFACT_PLAN_CHANGED");
  }
  let provenDiscovery: AgentDiscoveryBinding | undefined;
  if (plan.cacheWitnessUpgrade) {
    if (!plan.cacheWitnessUpgrade.expectedCacheWitnessSha256 || !plan.observedPolicy?.before || !plan.managedAgentChecks) throw new Error("Invalid cache witness upgrade plan");
    const verified = planCodexSemanticCacheWitnessUpgrade(plan.cacheWitnessUpgrade);
    if (JSON.stringify(verified.changes) !== JSON.stringify(plan.changes)
      || JSON.stringify(verified.cacheWitnessUpgrade) !== JSON.stringify(plan.cacheWitnessUpgrade)
      || JSON.stringify(verified.discoveryAfter) !== JSON.stringify(plan.discoveryAfter)) throw new Error("Cache witness upgrade plan changed");
    provenDiscovery = verified.discoveryBefore![0];
  }
  if (plan.settingsWitnessUpgrade) {
    if (plan.cacheWitnessUpgrade) throw new Error("Independent witness upgrades cannot be combined implicitly");
    const upgrade = plan.settingsWitnessUpgrade;
    if (!plan.managedAgentChecks || !plan.observedPolicy?.before) throw new Error("Invalid settings witness upgrade plan");
    const verified = planAgentSettingsWitnessUpgrade({ agent: upgrade.agent, ...(upgrade.agent === "codex" ? { targetCodexVersion: upgrade.toHashMode === "codex-settings-v5" ? 5 as const : upgrade.toHashMode === "codex-settings-v4" ? 4 as const : upgrade.toHashMode === "codex-settings-v3" ? 3 as const : 2 as const } : {}), ...(upgrade.agent === "claude" && upgrade.toHashMode === "claude-settings-v4" ? { targetClaudeVersion: 4 as const } : {}), reviewedPreimage: upgrade.reviewedPreimage, home: plan.managedAgentChecks.home, dataDir: plan.dataDir, expectedPolicySha256: sha(plan.observedPolicy.before), expectedSettingsSha256: upgrade.currentSettingsSha256 });
    if (JSON.stringify(verified.changes) !== JSON.stringify(plan.changes) || JSON.stringify(verified.settingsWitnessUpgrade) !== JSON.stringify(upgrade)) throw new Error("Settings witness upgrade plan changed");
    provenDiscovery = verified.discoveryBefore![0];
  }
  for (const agent of plan.managedAgentChecks?.agents ?? []) assertManagedAgentBridgeWithDiscovery(agent, { home: plan.managedAgentChecks!.home, dataDir: plan.dataDir, projectDir: plan.managedAgentChecks!.projectDir ?? plan.managedAgentChecks!.home }, provenDiscovery?.agent === agent ? provenDiscovery : undefined);
  for (const binding of plan.discoveryBefore ?? []) {
    if (plan.managedAgentChecks) verifyCoordinatedDiscovery(binding, plan.managedAgentChecks.home, aliases, plan.discoveryExecutables?.[binding.agent]);
    else verifyAgentDiscovery(binding, undefined, aliases);
  }
  if (plan.observedPolicy && currentText(plan.observedPolicy.path) !== plan.observedPolicy.before) throw new Error("Agent policy changed after planning");
  for (const change of plan.changes) if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
  const backupRoot = join(plan.dataDir, "migration", randomUUID()), backups: string[] = [], written: AgentConfigChange[] = [], createdDirectories = new Set<string>();
  if (!plan.changes.length) {
    assertCurrent(); recheckRootAliases(aliases);
    // A plan with nothing to write cannot prove a repair, so the current bridge is the only
    // evidence this path has. Without it, custody-gated reuse would report a successful
    // install for a binding whose protection was never repaired.
    for (const agent of plan.retainedReviewChecks?.agents ?? []) assertManagedAgentBridge(agent, { ...plan.retainedReviewChecks!, dataDir: plan.dataDir });
    return { changed: [], backups, ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback };
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
      assertCurrent(); recheckRootAliases(aliases);
      if (currentText(change.path) !== change.before) throw new Error(`Configuration changed after planning: ${change.path}`);
      for (let directory = dirname(change.path); !existsSync(directory); directory = dirname(directory)) createdDirectories.add(directory);
      const after = change.after;
      const immutable = plan.retainedReviewArtifacts?.find(item => item.path === change.path);
      if (immutable) {
        if (immutable.before !== null || immutable.after !== change.after || change.before !== null) throw new Error("REVIEW_ARTIFACT_PLAN_CHANGED");
        // Keep immutable evidence on transaction failure; compensate policy and
        // native changes only. An exact retry may reuse the retained bytes.
        writeReviewArtifactExclusive(immutable);
      } else { atomicWrite(change.path, after); written.push({ path: change.path, before: change.before, after }); }
    }
    assertCurrent(); recheckRootAliases(aliases);
    for (const source of plan.reviewArtifactSources ?? []) verifyReviewArtifactOriginal(source.path, source.sha256);
    for (const source of plan.observedNativeSources ?? []) if (nativeSourceDigest(source.path) !== source.sha256) throw new Error("Native identity source changed during application");
    if (plan.observedSettings && readOptional(plan.observedSettings.path) !== plan.observedSettings.before) throw new Error("Native settings changed during witness application");
    for (const binding of plan.discoveryAfter ?? []) {
      if (plan.managedAgentChecks) verifyCoordinatedDiscovery(binding, plan.managedAgentChecks.home, aliases, plan.discoveryExecutables?.[binding.agent]);
      else verifyAgentDiscovery(binding, undefined, aliases);
    }
    for (const agent of plan.managedAgentChecks?.agents ?? []) assertManagedAgentBridge(agent, { home: plan.managedAgentChecks!.home, dataDir: plan.dataDir, projectDir: plan.managedAgentChecks!.projectDir ?? plan.managedAgentChecks!.home });
    // The post-write proof that a reused reviewed binding is fully protected
    // again. A plan that did not repair the protection fails here and is
    // compensated, so custody-gating the pre-write check above cannot let a
    // broken bridge become a configured one.
    for (const agent of plan.retainedReviewChecks?.agents ?? []) assertManagedAgentBridge(agent, { ...plan.retainedReviewChecks!, dataDir: plan.dataDir });
    // A reconcile is complete only when the strict guard, with no reconcile
    // allowance, accepts the written state; otherwise every write is compensated.
    if (plan.codexReconcile) assertManagedAgentBridge("codex", { home: plan.codexReconcile.request.home, dataDir: plan.dataDir, projectDir: plan.codexReconcile.request.projectDir });
    atomicWrite(join(backupRoot, "receipt.json"), JSON.stringify({ version: 1, changes: written.map(change => ({ path: change.path, beforeHash: change.before === null ? null : sha(change.before), afterHash: sha(change.after) })), backups, ...(plan.cacheWitnessUpgrade ? { cacheWitnessUpgrade: plan.cacheWitnessUpgrade } : {}), ...(plan.codexReconcile ? { codexReconcile: { codexVersion: plan.codexReconcile.request.catalog.version, enrolled: plan.codexReconcile.names } } : {}), ...(plan.retainedReviewArtifacts?.length ? { retainedReviewArtifacts: plan.retainedReviewArtifacts.map(item => ({ path: item.path, ...item.artifact })) } : {}), ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback }) + "\n");
  } catch (error) {
    assertCurrent();
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
  return { changed: plan.changes.map(change => change.path), backups, ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback };
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

export function archiveNativeSkills(inventory: NativeSkillEntry[], options: CodexCorpusWriteOptions & { dataDir?: string; includeUnmanaged?: boolean; includeVendor?: boolean; allowRootAliases?: boolean; targetManifest?: NativeMigrationTargetManifest }): { entries: Array<{ source: string; archive: string; hash: string; discoveryOnly?: boolean }>; receiptPath?: string; rootAliases?: AgentRootAlias[]; targetManifest?: { schema: string; digest: string; targetCount: number } } & CodexAdmissionReceipt {
  const selected = options.targetManifest ? selectNativeMigrationTargets(inventory, options.targetManifest)
    : inventory.filter(entry => !entry.bridge && !entry.system && (entry.vendor ? options.includeVendor : entry.managed || options.includeUnmanaged));
  const roots = selected.flatMap(entry => {
    // Codex also reads HOME/project .agents/skills directly. Inventory binds
    // those external inputs to the native home instead of exempting the write.
    // A protected physical path remains guarded regardless of its agent label.
    const root = (entry.rootAlias?.agent === "codex" ? entry.rootAlias.alias : undefined) ?? codexCorpusRootForPath(entry.path);
    const owner = entry.codexHome ?? (entry.agent === "codex" && entry.bridgeHome ? join(entry.bridgeHome, ".codex") : undefined);
    if (!root && !owner && (entry.agent === "codex" || isCodexSkillDiscoveryInput(entry.path))) throw new Error("CODEX_CORPUS_ROOT_UNVERIFIED");
    return [...new Set([root, owner].filter((value): value is string => value !== undefined))];
  });
  return withCodexCorpusWrite(roots, (assertCurrent, admission) => archiveNativeSkillsUnlocked(inventory, options, assertCurrent, admission), options);
}

function archiveNativeSkillsUnlocked(inventory: NativeSkillEntry[], options: CodexCorpusWriteOptions & { dataDir?: string; includeUnmanaged?: boolean; includeVendor?: boolean; allowRootAliases?: boolean; targetManifest?: NativeMigrationTargetManifest }, assertCurrent: () => void, admission?: CodexCorpusAdmission): { entries: Array<{ source: string; archive: string; hash: string; discoveryOnly?: boolean }>; receiptPath?: string; rootAliases?: AgentRootAlias[]; targetManifest?: { schema: string; digest: string; targetCount: number } } & CodexAdmissionReceipt {
  const fallback = codexAdmissionReceipt(admission);
  const aliases = [...new Map(inventory.filter(entry => entry.rootAlias).map(entry => [entry.rootAlias!.alias, entry.rootAlias!])).values()];
  if (aliases.length && !options.allowRootAliases) throw new Error("Native migration requires explicit allowRootAliases for agent root aliases");
  assertCurrent(); recheckRootAliases(aliases);
  // Recompute ownership before exempting it: a stale plan or a forged bridge
  // flag must not protect subsequently modified native instructions.
  for (const entry of inventory.filter(entry => entry.bridge)) {
    const adapter = AGENT_ADAPTERS[entry.agent as IntegrationAgent];
    const expected = adapter && entry.bridgeHome ? canonicalAgentPath(join(nativeAgentRoot(entry.bridgeHome, entry.agent as IntegrationAgent), CLI_BRIDGE_NAME), aliases) : undefined;
    if (!expected || treeHash(entry.path) !== entry.hash || !isOwnedCliBridge(entry.path, [expected])) throw new Error(`Skills bridge changed after planning: ${entry.path}`);
  }
  const selected = options.targetManifest
    ? selectNativeMigrationTargets(inventory, options.targetManifest)
    : inventory.filter(entry => !entry.bridge && !entry.system && (entry.vendor ? options.includeVendor : entry.managed || options.includeUnmanaged));
  for (const entry of selected) if (treeHash(entry.path) !== entry.hash) throw new Error(`Native skill changed after planning: ${entry.path}`);
  const targetManifest = options.targetManifest ? { schema: options.targetManifest.schema, digest: options.targetManifest.digest, targetCount: options.targetManifest.targets.length } : undefined;
  if (!selected.length) return { entries: [], ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback };
  const operationId = randomUUID(), archiveRoot = join(options.dataDir ?? getDataDir(), "migration", operationId, "native"), receiptPath = join(archiveRoot, "receipt.json");
  type Move = { source: string; archive: string; hash: string; discoveryOnly?: boolean; status: "planned" | "moving" | "archived" | "restored" | "recovery-required"; conflict?: string };
  const entries: Move[] = selected.map((entry, index) => ({
    source: entry.vendor ? join(entry.path, "SKILL.md") : entry.path,
    archive: join(archiveRoot, `${index}-${sha(entry.path).slice(0, 12)}`),
    hash: entry.vendor ? sha(readNativeBytes(join(entry.path, "SKILL.md"))) : entry.hash,
    ...(entry.vendor ? { discoveryOnly: true } : {}), status: "planned",
  }));
  const journal = { version: 2, operationId, status: "planned", entries, ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback };
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
      assertCurrent(); recheckRootAliases(aliases);
      if (treeHash(entry.path) !== entry.hash) throw new Error("Native skill changed after planning");
      const move = entries[index]!;
      journal.status = "archiving"; move.status = "moving"; writeArchiveJournal(receiptPath, journal);
      // Vendor discovery documents move alone; shared scripts/assets remain.
      renameSync(move.source, move.archive); moved.push(move);
      syncArchiveDirectory(dirname(move.source)); syncArchiveDirectory(archiveRoot);
      verifyArchive(move); move.status = "archived"; writeArchiveJournal(receiptPath, journal);
    }
    assertCurrent(); recheckRootAliases(aliases);
    for (const entry of moved) verifyArchive(entry);
    journal.status = "completed"; writeArchiveJournal(receiptPath, journal);
  } catch (error) {
    journal.status = "compensating";
    try { writeArchiveJournal(receiptPath, journal); } catch { /* The durable intent still names every source and archive. */ }
    for (const entry of [...moved].reverse()) {
      try {
        assertCurrent(); recheckRootAliases(aliases); assertSafePath(entry.source); assertSafePath(entry.archive);
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
  return { entries: entries.map(({ status, conflict, ...entry }) => entry), receiptPath, ...(targetManifest ? { targetManifest } : {}), ...(aliases.length ? { rootAliases: aliases } : {}), ...fallback };
}

/** Native hook input for the Codex policy adapter. Only the Codex hook paths that
 * receive native SessionStart/UserPromptSubmit input supply it; install-time and
 * other guard calls never do. `inspector` is a test seam for process lineage. */
export interface CodexNativePolicyGuardInput extends CodexNativeHookEnvelope { inspector?: ProcessInspector; helperRunner?: NativePolicyHelperRunner; /** Absolute epoch ms by which the hook must answer; bounds the hash and helper. */ deadlineMs?: number }
interface ManagedBridgeOptions {
  home?: string; dataDir?: string; projectDir?: string; projectDirs?: string[]; profileId?: string; codexDiscoveryRecovery?: CodexHookDiscoveryRecovery; codexNativePolicy?: CodexNativePolicyGuardInput;
  /** Live Codex prompt hook only. Exempt vendor Codex plugin-cache copies that
   * Codex configuration provably disables, and tolerate, with a warning, the
   * discovery-witness changes a vendor plugin refresh provably makes. Enabled
   * vendor copies and every other change still refuse. Install, trust, migrate
   * and sync never pass it. */
  codexPromptHook?: boolean;
}

/** Result of a guard call; both lists are empty unless the caller opted in.
 * `codexInertVendorCopies` holds the canonical skill directories exempted as
 * disabled vendor copies; `codexDiscoveryChanges` the witnesses tolerated as a
 * vendor plugin refresh. */
export interface ManagedBridgeReport { codexInertVendorCopies: string[]; codexDiscoveryChanges: Array<{ kind: NativeDiscoveryWitnessKind; path: string | null }> }

/** Structural classification shared by the native-policy adapter and the live
 * prompt-hook vendor exemption: package-identified installed-plugin content inside
 * the canonical Codex plugin cache (no `..`, no symlinked component, real paths
 * equal), a regular SKILL.md and an unchanged inventoried tree. `admit` adds the
 * caller's condition on the canonical document and its identity before hashing. */
function classifiedCodexPluginCacheCopy(entry: NativeSkillEntry, cache: string, read: (path: string) => string, admit: (document: string, identity: CodexPluginCacheDocumentIdentity) => boolean): boolean {
  try {
    if (entry.agent !== "codex" || !entry.vendor || entry.bridge || entry.system) return false;
    const document = join(entry.path, "SKILL.md");
    const inside = relative(cache, entry.path);
    if (!inside || isAbsolute(inside) || inside.split(sep).some(segment => segment === "..")) return false;
    assertSafePath(entry.path);
    if (!lstatSync(cache).isDirectory() || !lstatSync(entry.path).isDirectory() || !lstatSync(document).isFile()) return false;
    if (realpathSync.native(cache) !== cache || realpathSync.native(entry.path) !== entry.path || realpathSync.native(document) !== document) return false;
    const identity = classifyCodexPluginCacheDocument(document, cache, read);
    if (!identity) return false;
    if (!admit(document, identity)) return false;
    return treeHash(entry.path) === entry.hash;
  } catch { return false; }
}

/** Package-classified installed-plugin content below the Codex plugin cache that
 * a verified restricted policy cannot load. Classification is the existing plugin
 * manifest identity and real-path binding, never a path prefix; user, repo and
 * project copies, unclassified cache files and any allowed host path refuse. */
export function isInertCodexPluginCacheCopy(entry: NativeSkillEntry, cache: string, allowedHostPaths: readonly string[], read: (path: string) => string): boolean {
  // The runtime policy must be unable to load it: the canonical document is not an allowed host path.
  return classifiedCodexPluginCacheCopy(entry, cache, read, document => !allowedHostPaths.includes(document));
}

/** A vendor plugin-cache copy that Codex configuration provably disables, so its
 * payload never loads natively. Vendor means: classified installed-plugin content
 * in an allowlisted OpenAI marketplace (exact names), with the native remote
 * install receipt for remote marketplaces, no Skills-managed or Hasna marker,
 * and a plugin whose every cached version passes the fail-closed refresh check
 * (codexVendorPluginRefreshSafe: one Codex manifest with only known keys, no
 * hooks, MCP, command, agent or extension declaration, no other manifest
 * location, no link and no skill hidden from the inventory or nested in
 * another). Classification reads only the Codex manifest, so without that check
 * a version could load payloads no rule here covers. Disabled means: a `[[skills.config]]`
 * rule names its exact SKILL.md path or its plugin-qualified name with
 * `enabled = false` (the native ordered evaluation agrees), and no matching rule
 * enables it. A whole-plugin `[plugins."<id>"] enabled = false` table is never
 * enough: remote state can enable a locally disabled remote plugin, and a
 * cache copy carries no proof that its source is configuration-controlled. */
export function isInertCodexVendorPluginCopy(entry: NativeSkillEntry, cache: string, rules: unknown, read: (path: string) => string): boolean {
  try {
    if (entry.managed || lstatSync(join(entry.path, ".hasna-skills.json"), { throwIfNoEntry: false })) return false;
    const marketplace = codexVendorMarketplace(cache, entry.path);
    if (!marketplace) return false;
    return classifiedCodexPluginCacheCopy(entry, cache, read, (document, identity) => {
      if (identity.pluginId !== `${identity.namespace}@${marketplace}`) return false;
      if (CODEX_REMOTE_VENDOR_MARKETPLACES.includes(marketplace) && codexRemoteInstallReceipt(identity.pluginParent, read) === null) return false;
      // Every version of the plugin, including this copy's root, must hold only
      // what the inventory and this rule account for; a fresh budget per copy.
      if (!codexVendorPluginRefreshSafe(identity.pluginParent)) return false;
      if (!Array.isArray(rules)) return false;
      // Native path rules canonicalize through links; so does this pre-check.
      const canonical = (path: string) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
      const matches = (rule: any) => (typeof rule?.name === "string" && rule.name.trim() === identity.name)
        || (typeof rule?.path === "string" && [document, entry.path].includes(canonical(rule.path)));
      if (rules.some(rule => matches(rule) && rule?.enabled !== false)) return false;
      return isCodexNativeSkillDisabled({ name: identity.name, path: document, pluginId: identity.pluginId, enabled: true }, rules);
    });
  } catch { return false; }
}

/** Show filenames only: never read payloads into diagnostics. Escape control
 * characters and cap both path count and length for native hook output.
 * `invisible` (warning text) escapes every format character (`\p{Cf}`: zero-width,
 * joiners, soft hyphen, bidirectional controls, byte-order and tag characters),
 * every control and the line and paragraph separators, as JSON `\uXXXX` units. */
function nativeSkillPathList(paths: readonly string[], invisible = false): string {
  const shown = paths.slice(0, 3).map(path => {
    const escaped = JSON.stringify(path).replace(invisible ? /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/gu : /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
      character => Array.from({ length: character.length }, (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`).join(""));
    return escaped.length > 768 ? `${escaped.slice(0, 384)}...${escaped.slice(-381)}` : escaped;
  });
  const remaining = paths.length - shown.length;
  return `${shown.join(", ")}${remaining ? `; ${remaining} more` : ""}`;
}

/** Remediation for blocking native skill copies, grouped by what actually works
 * for the guard call that refused (bounded, escaped like the path list):
 *   - user and project copies: `skills migrate native` without `--include-vendor`.
 *     It inventories the working directory and its ancestors and never resolves
 *     configured plugins, so a hook-bearing plugin does not refuse it.
 *   - live Codex prompt hook only: a copy in an OpenAI vendor marketplace of the
 *     Codex plugin cache that a plugin-qualified name rule would make inert. The
 *     offer is exact: the copy must pass isInertCodexVendorPluginCopy with that
 *     rule appended to the current rules (no Skills-managed or Hasna marker, the
 *     remote install receipt, plugin refresh safety and no enabling rule). Codex
 *     refreshes these caches on its own, so archiving does not last; the name
 *     rule also covers later versions.
 *   - other plugin-cache copies in the live hook: an exact-path disable rule,
 *     which the guard accepts for a plugin Skills has not enrolled while the
 *     recorded configuration is unchanged.
 *   - a refreshed binding (`skills hook install`, with a fresh discovery review
 *     for a reviewed binding, and a fresh native catalog for a plugin Skills
 *     enrolled), which writes and records the disables itself, for: every
 *     plugin-cache copy on a strict guard call (hook install reusing a saved
 *     review, trust enrolment and reconciliation, witness upgrades), which
 *     accepts no hand-added name rule; Codex system skills, which migration never
 *     archives; copies of an enrolled plugin, whose skills only a reviewed
 *     catalog exempts; and plugin-cache copies after the hook tolerated a vendor
 *     configuration change.
 *   - other vendor copies: `--include-vendor`, which resolves configured plugin
 *     discovery and so needs a reviewed `--discovery-inputs` file whenever a
 *     configured plugin declares hooks.
 * A config-edit step is followed by the refreshed binding whenever the edit
 * changes the recorded config witness: always on an automatic binding and when
 * an enabling rule must be removed (enabled rows count in every witness), and
 * otherwise when the binding's own digest mode would change with the appended
 * rows (`keepsConfig`; raw, `bytes` and `codex-settings-v1` count disable rows,
 * typed V2-V5 do not). */
function nativeSkillRemediation(agent: IntegrationAgent, blocking: readonly NativeSkillEntry[], context: { cache: string; config: string; aliases: boolean; strict: boolean; automatic: boolean; toleratedChange: boolean; rules: unknown; enrolled: (entry: NativeSkillEntry) => boolean; keepsConfig: (rows: readonly string[]) => boolean; read: (path: string) => string }): string {
  const quote = (value: string) => nativeSkillPathList([value], true);
  const codex = agent === "codex";
  const system = blocking.filter(entry => codex && entry.system === true);
  const cacheCopies = blocking.filter(entry => codex && !system.includes(entry) && entry.path.startsWith(context.cache + sep));
  // The qualified name a disable rule needs, only when that rule appended to the
  // current rules would make the live hook accept the copy; null otherwise.
  const nameRule = (entry: NativeSkillEntry): string | null => {
    if (context.strict || codexVendorMarketplace(context.cache, entry.path) === null) return null;
    if (context.rules !== undefined && !Array.isArray(context.rules)) return null;
    try {
      const identity = classifyCodexPluginCacheDocument(join(entry.path, "SKILL.md"), context.cache, context.read);
      if (!identity) return null;
      const rules = [...((context.rules as unknown[] | undefined) ?? []), { name: identity.name, enabled: false }];
      return isInertCodexVendorPluginCopy(entry, context.cache, rules, context.read) ? identity.name : null;
    } catch { return null; }
  };
  const named = cacheCopies.flatMap(entry => { const name = nameRule(entry); return name ? [{ entry, name }] : []; });
  const unnamed = cacheCopies.filter(entry => !named.some(item => item.entry === entry));
  const refresh = unnamed.filter(entry => context.strict || context.toleratedChange || context.enrolled(entry));
  const byPath = unnamed.filter(entry => !refresh.includes(entry));
  const otherVendor = blocking.filter(entry => entry.vendor && !system.includes(entry) && !cacheCopies.includes(entry));
  const user = blocking.filter(entry => !entry.vendor && !system.includes(entry) && !cacheCopies.includes(entry));
  // The refreshed binding; a plugin Skills enrolled also needs a fresh catalog.
  const install = (catalog: boolean) => {
    const fresh = [...(context.automatic ? [] : ["discovery review"]), ...(catalog ? ["native catalog"] : [])];
    return `skills hook install --agent codex${catalog ? " --codex-native-catalog <reviewed-catalog>" : ""}${context.automatic ? "" : " --discovery-inputs <reviewed-file>"} --apply${fresh.length ? `, with a fresh ${fresh.join(" and ")}` : ""}`;
  };
  // Said after a config edit that changes what the binding recorded, so the edit
  // alone would only trade this refusal for a changed-discovery-input refusal.
  const followUp = (rows: readonly string[], entries: readonly NativeSkillEntry[], removesRules = false) =>
    context.automatic || removesRules || !context.keepsConfig(rows)
      ? ` ${context.automatic ? "This automatic binding" : "The reviewed binding"} records that file, so follow the edit with ${install(entries.some(context.enrolled))}.`
      : "";
  const row = (selector: string) => `[[skills.config]]\n${selector}\nenabled = false\n`;
  const steps: string[] = [];
  if (user.length) steps.push(`For user and project copies, review skills migrate native --agent ${agent} --project <working-directory> --include-unmanaged${context.aliases ? " --allow-root-aliases" : ""} --json before continuing; it inventories that directory and its ancestors. Use --apply after reviewing the archive plan.`);
  if (named.length) {
    const names = [...new Set(named.map(item => item.name))];
    const rows = names.map(name => row(`name = ${JSON.stringify(name)}`));
    steps.push(`Codex refreshes OpenAI marketplace copies on its own, so disable each in Codex instead: add [[skills.config]] with name = ${nativeSkillPathList(names, true)}${names.length > 1 ? " (one rule per name)" : ""} and enabled = false to ${quote(context.config)}. Codex then never loads it and the Codex prompt hook accepts it.${followUp(rows, named.map(item => item.entry))}`);
  }
  if (byPath.length) {
    // Skills honours no exact-path disable while any name rule enables a skill,
    // nor one paired with a rule that enables the same document.
    const rules = Array.isArray(context.rules) ? context.rules : [];
    const enabling = rules.some((rule: any) => rule?.enabled !== false && (typeof rule?.name === "string" || (typeof rule?.path === "string" && byPath.some(entry => [entry.path, join(entry.path, "SKILL.md")].includes(resolve(rule.path))))));
    const rows = byPath.map(entry => row(`path = ${JSON.stringify(join(entry.path, "SKILL.md"))}`));
    steps.push(`For other Codex plugin-cache copies, add [[skills.config]] with the exact path of each SKILL.md and enabled = false to ${quote(context.config)}, or remove the plugin in Codex.${enabling ? " First remove the [[skills.config]] rules there that enable skills; no path rule counts while one does." : ""}${followUp(rows, byPath, enabling)}`);
  }
  if (system.length || refresh.length) {
    const reasons = [
      ...(system.length ? ["Codex system skills are never archived by skills migrate native"] : []),
      ...(context.strict && refresh.length ? ["this check, unlike the live Codex prompt hook, does not accept a hand-added Codex name rule for a plugin-cache copy"] : []),
      ...(!context.strict && context.toleratedChange && refresh.length ? ["plugin-cache copies keep their exact-path exemption only while the recorded configuration is unchanged"] : []),
      ...(refresh.some(context.enrolled) ? ["only a fresh native catalog review exempts a skill of a plugin Skills has enrolled"] : []),
    ];
    const sentence = reasons.join("; ");
    steps.push(`${sentence[0]!.toUpperCase()}${sentence.slice(1)}, so refresh the binding instead: ${install(refresh.some(context.enrolled))}. It disables and records each copy.`);
  }
  if (otherVendor.length) steps.push(`For other vendor copies, review skills migrate native --agent ${agent} --project <working-directory> --include-vendor --discovery-inputs <reviewed-file> --json; --include-vendor requires a reviewed --discovery-inputs file when a configured plugin declares hooks.`);
  return steps.join(" ");
}

/** Visible, non-blocking warning for the discovery-witness changes the live Codex
 * prompt hook tolerated as a vendor plugin refresh, or undefined when there were
 * none. One bounded line; paths only, never payloads or file contents. */
export function codexPromptDriftWarning(report: ManagedBridgeReport): string | undefined {
  const changes = report.codexDiscoveryChanges;
  if (!changes.length) return undefined;
  const one = changes.length === 1;
  const kinds = [...new Set(changes.map(change => change.kind === "input" ? "vendor configuration entries" : "vendor plugin cache membership"))].join(", ");
  const paths = [...new Set(changes.flatMap(change => change.path === null ? [] : [change.path]))];
  return `Skills warning: ${changes.length} recorded Codex discovery ${one ? "witness" : "witnesses"} changed only by a vendor plugin refresh (${kinds}) and ${one ? "was" : "were"} not blocked${paths.length ? `: ${nativeSkillPathList(paths, true)}` : ""}. Enabled vendor skill copies and every other change still block. Refresh the binding with skills hook install --agent codex --apply, with a fresh discovery review for a reviewed binding.`;
}

/** Run before any prompt context load. Missing ownership or reappearing native
 * discovery files require repair; verified cache availability is not an override. */
export function assertManagedAgentBridge(agent: IntegrationAgent, options: ManagedBridgeOptions = {}): ManagedBridgeReport {
  return assertManagedAgentBridgeWithDiscovery(agent, options);
}

/**
 * The binding-custody half of the managed bridge check. It answers one
 * question: does this saved review still belong to this host — the same bridge
 * binding, home, alias set, agent, command/profile binding and reviewed
 * discovery? Custody must hold before a saved review is reused.
 *
 * Bridge PROTECTION (the native plugin bytes, the permission or hook rules and
 * the bundled-skill switches) is deliberately NOT part of custody. Protection is
 * repairable by the very install that reuses the review, so gating reuse on it
 * would refuse the repair command in the state it exists to repair; the
 * protection is asserted in full after the writes, by
 * {@link assertManagedAgentBridge}.
 *
 * One implementation, called by both, so the two halves cannot drift apart.
 */
interface ManagedBridgeCustody {
  home: string; dataDir: string; binding: any; aliases: AgentRootAlias[]; expected: string;
  roots: string[]; discovery: AgentDiscoveryBinding | undefined;
  configPath: string; config: any; command: string; profile: string;
}
function assertManagedBridgeCustody(agent: IntegrationAgent, options: ManagedBridgeOptions = {}, provenDiscovery?: AgentDiscoveryBinding): ManagedBridgeCustody {
  const home = resolve(options.home ?? homedir()), dataDir = options.dataDir ?? getDataDirReadOnly();
  assertSafePath(join(dataDir, "agent-policy.json"));
  const snapshot = readManagedSkillPolicySnapshot(dataDir);
  if (!snapshot) throw new Error("NATIVE_SKILL_DRIFT: install the Skills bridge with skills hook install");
  const binding = snapshot.value.bridge;
  if (!binding || binding.version !== CLI_BRIDGE_VERSION || binding.digest !== CLI_BRIDGE_DIGEST || binding.home !== home || !Array.isArray(binding.agents) || !binding.agents.includes(agent)) throw new Error("NATIVE_SKILL_DRIFT: the managed Skills bridge binding is missing or incompatible; run skills hook install");
  const aliases: AgentRootAlias[] = binding.rootAliases ?? [];
  if (!Array.isArray(aliases)) throw new Error("NATIVE_SKILL_DRIFT: invalid root alias binding");
  recheckRootAliases(aliases);
  const expected = canonicalAgentPath(join(nativeAgentRoot(home, agent, options.projectDir ?? process.cwd()), CLI_BRIDGE_NAME), aliases);
  if (!isOwnedCliBridge(expected, [expected])) throw new Error("NATIVE_SKILL_DRIFT: the native Skills bridge is missing or modified; repair it before continuing");
  const roots = projectAncestorDirectories([options.projectDir ?? process.cwd(), ...(options.projectDirs ?? []), ...(agent === "hermes" && process.env.TERMINAL_CWD ? [process.cwd()] : [])]);
  const discovery: AgentDiscoveryBinding | undefined = provenDiscovery ?? binding.discovery?.[agent];
  assertProjectDiscovery(agent, [...roots], home, path => canonicalAgentPath(path, aliases), discovery);
  for (const source of discovery?.sources ?? []) if (source.reviewArtifact !== undefined) {
    if (agent !== "codex") throw new Error("NATIVE_SKILL_DRIFT: invalid review artifact consumer");
    verifyRetainedReviewArtifact(source, dataDir);
  }
  const configPath = canonicalAgentPath(nativeAgentConfig(home, agent, options.projectDir ?? process.cwd()), aliases), config = agent === "hermes" ? parseHermesConfig(readOptional(configPath)) : jsonObject(readOptional(configPath), configPath);
  const command = binding.commands?.[agent], profile = binding.profiles?.[agent];
  if (typeof command !== "string" || typeof profile !== "string") throw new Error("NATIVE_SKILL_DRIFT: the native hook command/profile binding is missing");
  if (options.profileId !== undefined && options.profileId !== profile) throw new Error("NATIVE_SKILL_DRIFT: the hook selection profile differs from its managed binding; restart the native client after reviewing skills hook install");
  return { home, dataDir, binding, aliases, expected, roots, discovery, configPath, config, command, profile };
}

/**
 * Protection this install cannot write, so it must hold before a plan is offered
 * and again before anything is applied. Hermes native shell-hook trust is the
 * user's own consent, obtained through Hermes' approval flow: no Skills write
 * creates it, so deferring it to the post-write proof would hand the operator a
 * plan that can only fail. Everything else in the protection half is written by
 * the same plan, so it is proven after the writes instead.
 */
function assertUnrepairableBridgeProtection(custody: ManagedBridgeCustody, agent: IntegrationAgent): void {
  if (agent !== "hermes") return;
  const { home, dataDir, binding, config, command, profile } = custody;
  const supervisor = binding.supervisors?.hermes;
  if (supervisor?.path !== join(dataDir, "agent-hooks", "hermes.js") || supervisor?.sha256 !== sha(renderHermesSupervisor(command, profile))) throw new Error("NATIVE_SKILL_DRIFT: Hermes supervisor binding changed; run skills hook install");
  assertHermesProtection(home, config, command, profile, supervisor);
}

/** Both planning and application validate the original native state. Repairable
 * hook/plugin protection is deliberately checked only after installation.
 * `reconcileCopies` (Codex name reconcile only) names the exact plugin-cache
 * copies, by canonical path and tree hash, that the plan enrolls; any other
 * unexpected copy, or a changed one, still refuses. */
function assertRetainedReviewState(agent: IntegrationAgent, options: ManagedBridgeOptions, reconcileCopies?: ReadonlyMap<string, string>, reconcileDiscovery?: AgentDiscoveryBinding): void {
  const custody = assertManagedBridgeCustody(agent, options, reconcileCopies ? reconcileDiscovery : undefined);
  assertUnrepairableBridgeProtection(custody, agent);
  if (!reconcileCopies) { assertManagedNativeDiscovery(custody, agent, options); return; }
  const collected: CodexReconcileCollection = { blocking: [], inventory: [] };
  assertManagedNativeDiscovery(custody, agent, options, collected);
  if (collected.blocking.some(entry => reconcileCopies.get(entry.path) !== entry.hash)) throw new NativeSkillCopiesDriftError("NATIVE_SKILL_DRIFT: native skill copies changed after the Codex name reconcile was planned; run skills hook codex-reconcile again");
}

// Preserve the specific copy-remediation message instead of appending the
// generic retained-discovery repair, which can duplicate or contradict it.
class NativeSkillCopiesDriftError extends Error {}

function assertManagedAgentBridgeWithDiscovery(agent: IntegrationAgent, options: ManagedBridgeOptions = {}, provenDiscovery?: AgentDiscoveryBinding, collect?: CodexReconcileCollection): ManagedBridgeReport {
  const custody = assertManagedBridgeCustody(agent, options, provenDiscovery);
  const { home, aliases, expected, discovery, config, command, profile } = custody;
  if (agent === "hermes") {
    assertUnrepairableBridgeProtection(custody, agent);
  } else if (agent === "sumi") {
    if (JSON.stringify(config.permissions?.filter((rule: any) => rule.action === "skill")) !== JSON.stringify(SUMI_SKILL_PERMISSIONS) || !isManagedSumiPlugin(readOptional(join(sumiConfigDirectory(home, process.env, options.projectDir ?? process.cwd()), "plugins", "skills-cli.js")), command, profile)) throw new Error("NATIVE_SKILL_DRIFT: Sumi bridge protection changed; run skills hook install");
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
  if (agent === "codex") {
    const codexConfig = Bun.TOML.parse(readOptional(canonicalAgentPath(join(home, ".codex", "config.toml"), aliases)) ?? "") as { skills?: { bundled?: { enabled?: boolean }; config?: Array<{ path?: string; name?: string; enabled?: boolean }> } };
    if (codexConfig.skills?.bundled?.enabled !== false) throw new Error("NATIVE_SKILL_DRIFT: Codex bundled skill reseeding is not disabled (skills.bundled.enabled); run skills hook install");
    const setting = (path: string) => (codexConfig.skills?.config ?? []).filter(entry => typeof entry.path === "string" && [path, join(path, "SKILL.md")].includes(canonicalAgentPath(entry.path, aliases)));
    if ([...setting(expected), ...(codexConfig.skills?.config ?? []).filter(entry => typeof entry.name === "string" && entry.name.trim() === CLI_BRIDGE_NAME)].some(entry => entry.enabled === false)) throw new Error("NATIVE_SKILL_DRIFT: the Codex CLI bridge is disabled; run skills hook install");
  }
  if (agent === "gemini" && discovery && !discovery.builtinNames?.every(name => config.skills.disabled.includes(name))) throw new Error("NATIVE_SKILL_DRIFT: an installed Gemini builtin is not disabled");
  return assertManagedNativeDiscovery(custody, agent, options, collect);
}

/** Native/discovery state is never repaired implicitly by reusing a review.
 * Share this validator with the full guard, including its live-hook-only policy
 * and vendor exceptions. Install callers pass neither exception. */
function assertManagedNativeDiscovery(custody: ManagedBridgeCustody, agent: IntegrationAgent, options: ManagedBridgeOptions, collect?: CodexReconcileCollection): ManagedBridgeReport {
  const { home, dataDir, binding, aliases, expected, roots, discovery } = custody;
  const visible = (entry: NativeSkillEntry) => entry.agent === agent || (["codex", "gemini", "opencode", "hermes", "sumi"].includes(agent) && entry.path.includes(`${sep}.agents${sep}skills${sep}`)) || (["opencode", "sumi"].includes(agent) && entry.agent === "claude");
  const codexPath = canonicalAgentPath(join(home, ".codex", "config.toml"), aliases);
  // Live Codex prompt hook only: tolerate a changed reviewed witness only when it
  // is provably a vendor plugin refresh (appended vendor disable rows or vendor
  // plugin tables in config.toml; membership under an allowlisted, hook-free
  // vendor marketplace). Every other caller passes no tolerance.
  const vendorCache = canonicalAgentPath(join(home, ".codex", "plugins", "cache"), aliases);
  const witnessTolerance: NativeDiscoveryWitnessTolerance | undefined = agent === "codex" && options.codexPromptHook === true ? {
    changes: [],
    acceptsInput: source => source.path === codexPath && codexVendorConfigChangeOnly(source, vendorCache),
    acceptsMembership: path => codexVendorMarketplace(vendorCache, path) !== null && codexVendorSubtreeHookFree(vendorCache, path),
  } : undefined;
  if (options.codexDiscoveryRecovery && (agent !== "codex" || options.codexDiscoveryRecovery.configPath !== codexPath)) throw new Error("NATIVE_SKILL_DRIFT: Codex trust recovery names a different configuration root");
  const codexConfig = agent === "codex" ? Bun.TOML.parse(readOptional(codexPath) ?? "") as { plugins?: unknown; skills?: { bundled?: { enabled?: boolean }; config?: Array<{ path?: string; name?: string; enabled?: boolean }> } } : {};
  if (agent === "codex" && !reviewedCodexPluginCapabilitiesUnchanged(canonicalAgentPath(join(home,".codex/plugins/cache"),aliases),binding.codexPluginSkills ?? [],path=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024)),codexConfig.skills?.config ?? [])) throw new Error(`NATIVE_SKILL_DRIFT: ${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}: reviewed native plugin capability controls changed; run skills hook install with a fresh discovery review`);
  const disabledPlugin = (entry: NativeSkillEntry): boolean => {
    if (agent !== "codex" || !entry.vendor) return false;
    const document=join(entry.path,"SKILL.md"), cache=canonicalAgentPath(join(home,".codex/plugins/cache"),aliases), read=(path:string)=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024));
    return isReviewedCodexPluginInactive(document,cache,binding.codexInactivePlugins ?? [],codexConfig.plugins,codexConfig.skills?.config ?? [],read)
      || isReviewedCodexPluginSkillDisabled(document,cache,binding.codexPluginSkills ?? [],codexConfig.skills?.config,read);
  };
  // Live Codex prompt hook only: a vendor plugin-cache copy that Codex
  // configuration disables by exact path or qualified name. With no tolerated
  // witness change it only adds to the exemptions every guard call has. Once the
  // hook has tolerated a witness change, the strict guard would refuse the whole
  // state, so no strict exemption is being kept: plugin-cache copies are then
  // exempt only through this narrow classifier. Read after discovery verification.
  // The inventory's sibling-alias check never uses it: a linked version gains
  // nothing from this rule, exactly as on every other guard call.
  const inertVendorCopy = (entry: NativeSkillEntry): boolean => agent === "codex" && options.codexPromptHook === true && entry.vendor && entry.path.startsWith(vendorCache + sep)
    && isInertCodexVendorPluginCopy(entry, vendorCache, codexConfig.skills?.config, path => new TextDecoder("utf-8", { fatal: true }).decode(readNativeBytes(path, 1024 * 1024)));
  const vendorOnlyCacheCopy = (entry: NativeSkillEntry): boolean => (witnessTolerance?.changes.length ?? 0) > 0 && entry.path.startsWith(vendorCache + sep);
  const disabledPaths = new Set(disabledCodexSkillPaths(codexConfig, aliases));
  const disabledVendorSkill = (entry: NativeSkillEntry): boolean => {
    if (agent !== "codex" || !entry.vendor) return false;
    if (vendorOnlyCacheCopy(entry)) return false;
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
  try {
    verifyAgentDiscovery(agent==="codex" ? {...discovery,codexDisabledPluginSkills:binding.codexPluginSkills ?? []} : discovery, options.codexDiscoveryRecovery, aliases, witnessTolerance);
    if (agent === "sumi" && discovery.method === "reviewed") resolveAgentDiscovery({ home, agent, retainedReview: discovery, canonical: path => canonicalAgentPath(path, aliases) });
    if (discovery.method === "automatic") verifyAutomaticDiscoveryClosure(discovery, { home, canonical: path => canonicalAgentPath(path, aliases), change: "Configured native discovery roots changed", executable: binding.discoveryExecutables?.[agent], ...(witnessTolerance ? { witnessTolerance } : {}) });
  } catch (error) {
    if (isDiscoveryRootUnresolved(error)) throw error;
    throw new Error(`NATIVE_SKILL_DRIFT: ${(error as Error).message}`);
  }
  let installationInputRoots:string[]=[];
  if (agent==="codex") {
    try {
      installationInputRoots=reviewedCodexPluginSourceRoots(canonicalAgentPath(join(home,".codex/plugins/cache"),aliases),discovery.codexInstallationInputs?.plugins ?? [],path=>new TextDecoder("utf-8",{fatal:true}).decode(readNativeBytes(path,1024*1024))); }
    catch { throw new Error("NATIVE_SKILL_DRIFT: native installation input identity changed; review discovery and catalog"); }
  }
  const inventory = inventoryNativeSkills(home, { includeVendor: true, guardHermes: agent === "hermes", agents: [agent], projectDirs: [...roots], agentRoots: discovery.roots.map(path => ({ agent, path })), allowRootAliases: aliases.length > 0, disabledVendorPaths: agent === "codex" ? disabledCodexSkillPaths(codexConfig, aliases) : [], disabledVendorSkill: entry => !vendorOnlyCacheCopy(entry) && disabledPlugin(entry), codexInstallationInputRoots: installationInputRoots });
  const unexpected = inventory.filter(entry => visible(entry) && !entry.bridge && !disabledVendorSkill(entry));
  // Codex native policy adapter: consulted only when a Codex hook supplied native
  // policy input and the guard would otherwise refuse. A verified restricted
  // policy from the actual calling Codex can make package-classified plugin-cache
  // copies inert; everything else, and any adapter failure, keeps today's refusal.
  // Acceptance is gated on the authenticated channel binding of the native
  // contract and on reviewed executable digests in the managed policy; the
  // trust default is empty, so nothing passes until an operator configures them.
  let adapterRefusal: string | undefined, inert: NativeSkillEntry[] = [];
  if (agent === "codex" && unexpected.length && options.codexNativePolicy) {
    const { inspector, helperRunner, deadlineMs, ...envelope } = options.codexNativePolicy;
    const cache = canonicalAgentPath(join(home, ".codex", "plugins", "cache"), aliases), read = (path: string) => new TextDecoder("utf-8", { fatal: true }).decode(readNativeBytes(path, 1024 * 1024)), bridgeDocument = join(expected, "SKILL.md");
    try {
      // Scope first, with no hashing and no helper: every unexpected entry must
      // be a classified plugin-cache copy that the claimed policy cannot load,
      // or the guard refuses without spawning anything. Classification only
      // narrows scope; inertness rests on the authenticated restricted policy.
      const claimed = parseCodexNativeHookEnvelope(envelope, bridgeDocument).policy;
      inert = unexpected.filter(entry => isInertCodexPluginCacheCopy(entry, cache, claimed.allowedHostPaths, read));
      if (inert.length !== unexpected.length) throw new Error("native copies outside the classified Codex plugin cache remain");
      const verification = verifyCodexNativeSkillPolicy({ envelope, bridgeDocument, expectedBridgeContent: CLI_BRIDGE_FILES["SKILL.md"]!, expectedBridgeSha256: CLI_BRIDGE_DIGEST, trust: binding.codexNativePolicy, dataDir, ...(inspector ? { inspector } : {}), ...(helperRunner ? { helperRunner } : {}), ...(deadlineMs !== undefined ? { deadlineMs } : {}) });
      recordCodexNativePolicyAcceptance(dataDir, verification, inert.map(entry => ({ path: entry.path, treeSha256: entry.hash })));
    } catch (error) { inert = []; adapterRefusal = (error as Error).message; }
  }
  // Live Codex prompt hook only (codexPromptHook): exempt vendor plugin-cache
  // copies that Codex configuration provably disables, so a vendor refresh that
  // is already retired by a disable rule does not stop every prompt. An enabled
  // vendor copy, and every other copy, refuses below; nothing is recorded.
  let inertVendor: NativeSkillEntry[] = [];
  if (agent === "codex" && options.codexPromptHook === true && unexpected.length > inert.length) {
    inertVendor = unexpected.filter(entry => !inert.includes(entry) && inertVendorCopy(entry));
  }
  if (collect) { collect.custody = custody; collect.inventory = inventory; }
  // Codex name reconcile only: report the copies this strict check refuses for
  // classification instead of refusing; every other check above still throws.
  if (collect && agent === "codex" && !options.codexPromptHook && !options.codexNativePolicy) collect.blocking = unexpected;
  else if (unexpected.length > inert.length + inertVendor.length) {
    // The adapter is all-or-nothing, so only exempted vendor copies leave the list.
    const blocking = unexpected.filter(entry => !inertVendor.includes(entry));
    // Strict callers (every guard call except the live Codex prompt hook) accept
    // no hand-added name rule, so they get the refreshed-binding step instead.
    const remediation = nativeSkillRemediation(agent, blocking, { cache: vendorCache, config: codexPath, aliases: aliases.length > 0, strict: options.codexPromptHook !== true, automatic: discovery.method === "automatic", toleratedChange: (witnessTolerance?.changes.length ?? 0) > 0, rules: codexConfig.skills?.config, enrolled: entry => (binding.codexPluginSkills ?? []).some((control: CodexPluginSkillControl) => entry.path.startsWith(control.pluginParent + sep)), keepsConfig: rows => { try { const text = readOptional(codexPath) ?? ""; return discoveryTextKeepsWitness(discovery, codexPath, `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${rows.join("\n")}`); } catch { return false; } }, read: path => new TextDecoder("utf-8", { fatal: true }).decode(readNativeBytes(path, 1024 * 1024)) });
    throw new NativeSkillCopiesDriftError(`NATIVE_SKILL_DRIFT: ${blocking.length} unexpected native skill copies were found: ${nativeSkillPathList(blocking.map(entry => entry.path))}. ${remediation}${adapterRefusal ? ` Native policy adapter refused: ${adapterRefusal}` : ""}`);
  }
  recheckRootAliases(aliases);
  // The automatic closure can re-report a source verifyAgentDiscovery collected.
  const discoveryChanges = (witnessTolerance?.changes ?? []).filter((change, index, all) => all.findIndex(other => other.kind === change.kind && other.path === change.path) === index);
  return { codexInertVendorCopies: inertVendor.map(entry => entry.path), codexDiscoveryChanges: discoveryChanges.map(change => ({ kind: change.kind, path: change.path })) };
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
