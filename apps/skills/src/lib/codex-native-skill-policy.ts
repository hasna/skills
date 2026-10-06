/**
 * Codex native skill policy adapter.
 *
 * A Codex build implementing the native contract host-path-allowlist-v1 can restrict its
 * native skill injection to an exact host-path allowlist and reports that
 * effective policy to its SessionStart and UserPromptSubmit hooks as
 * `native_skill_policy`, together with its own process id. This module parses
 * that envelope, verifies that the sole allowed document is the Skills-owned
 * bridge, binds the claimed process to the hook's real ancestor chain and to a
 * reviewed executable digest, and prepares a provenance receipt.
 *
 * What the format, lineage, start-time and digest checks do not prove: the
 * hook input is written by whichever process invokes the hook, so a descendant
 * of a trusted Codex can invoke this hook with a forged envelope naming its
 * unrestricted ancestor and pass all of them. Acceptance is therefore gated on
 * the authenticated channel binding of the native contract
 * native-hook-policy-peer-v1: the native hook runner creates a per-invocation Unix socketpair, forwards the receiver
 * to the hook child and names it in CODEX_NATIVE_SKILL_POLICY_FD; the hook
 * forwards that descriptor to the qualified ancestor's own executable, whose
 * `debug verify-hook-policy` sends a fresh challenge over it and accepts only
 * the kernel-authenticated reply of that process carrying the exact raw stdin
 * digest and the policy it actually emitted. Acceptance also needs reviewed
 * executable digests in the managed policy; that trust default is empty, so
 * nothing passes until an operator configures them.
 *
 * Hashing the file at the executable path is not code-signature identity
 * either: the file can be replaced after exec, and the running image is never
 * re-read. The digest only binds the path the OS reports to a reviewed artifact.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync, type BigIntStats, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const CODEX_NATIVE_POLICY_CAPABILITY = "host-path-allowlist-v1";
export const CODEX_NATIVE_POLICY_RECEIPT_SCHEMA = "skills.codex-native-policy-acceptance/v1";
/** Loop safety for the parent walk. It is not a policy bound on launch depth:
 * Unix hooks run through the configured shell (`-lc`, new session), which may
 * exec into the command or keep wrappers, so the real chain length varies. */
export const CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS = 64;
const POLICY_FIELDS = ["capability", "mode", "allowedHostPaths", "nonHostSources", "processId", "effectiveConfigDigest"] as const;
const MAX_ENVELOPE_ID_LENGTH = 256;
const MAX_EXECUTABLE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BRIDGE_DOCUMENT_BYTES = 1024 * 1024;
const PLATFORM_KEY = /^(darwin|linux)-(arm64|x64)$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;

export type CodexNativeHookEvent = "SessionStart" | "UserPromptSubmit";
/** Exactly the fields the native hook emits (hook_runtime.rs, native_skill_policy_for_hook). */
export interface CodexNativeSkillPolicy { capability: typeof CODEX_NATIVE_POLICY_CAPABILITY; mode: "restricted"; allowedHostPaths: [string]; nonHostSources: "disabled"; processId: number; effectiveConfigDigest: string }
export interface CodexNativeHookEnvelope {
  event: CodexNativeHookEvent;
  policy: unknown;
  sessionId: unknown;
  /** Present on UserPromptSubmit only; SessionStart input has no turn id. */
  turnId?: unknown;
  /** SHA-256 of the exact hook stdin bytes, for the authenticated channel binding. */
  hookInputSha256?: unknown;
  /** Inherited read end of the per-hook socketpair Codex passes to the hook
   * child, for the authenticated channel binding. Not yet named by the native
   * contract, so the hook does not supply it today. */
  inheritedFd?: unknown;
}

/** Native Codex sets this only on the current hook child; it names the
 * inherited read end of the per-hook socketpair (draft binding contract). */
export const CODEX_NATIVE_POLICY_FD_ENV = "CODEX_NATIVE_SKILL_POLICY_FD";

/** Map one native hook input object to the adapter envelope, exactly as the
 * Codex `hook user-prompt` path does. Undefined means the input carries no
 * native policy or is not a SessionStart/UserPromptSubmit input, so the guard
 * keeps today's behaviour. `inputBytes` are the exact raw stdin bytes, hashed
 * before any decoding; `input` must have been parsed from those same bytes. */
export function codexNativeHookEnvelopeFromInput(input: Record<string, unknown>, event: string, inputBytes: Buffer, inheritedFd?: string): CodexNativeHookEnvelope | undefined {
  if ((event !== "SessionStart" && event !== "UserPromptSubmit") || !Object.hasOwn(input, "native_skill_policy")) return undefined;
  return {
    event, policy: input.native_skill_policy, sessionId: input.session_id,
    ...(Object.hasOwn(input, "turn_id") ? { turnId: input.turn_id } : {}),
    hookInputSha256: createHash("sha256").update(inputBytes).digest("hex"),
    ...(inheritedFd !== undefined ? { inheritedFd: /^(0|[1-9]\d{0,9})$/.test(inheritedFd) ? Number(inheritedFd) : inheritedFd } : {}),
  };
}
/** Injectable so tests can supply fake lineages; production uses the OS. */
export interface ProcessInspector {
  platform: string;
  arch: string;
  /** The hook process itself. */
  pid: number;
  parentOf(pid: number): number | null;
  /** Opaque start identity; two equal reads mean the same process incarnation. */
  startTime(pid: number): string | null;
  executablePath(pid: number): string | null;
}
/** Reviewed operator trust from the managed policy (`bridge.codexNativePolicy`). */
export interface CodexNativePolicyTrust { executableDigests: Readonly<Record<string, readonly string[]>> }
/** What the native helper attests over the inherited channel (draft contract). */
export interface CodexNativePolicyAttestation { schema: typeof CODEX_NATIVE_POLICY_PEER_SCHEMA; peerProcessId: number }
export interface CodexNativePolicyVerification {
  event: CodexNativeHookEvent; sessionId: string; turnId: string | null; policy: CodexNativeSkillPolicy;
  platform: string; ancestryHops: number; processStartTime: string; executablePath: string; executableSha256: string;
  /** No-follow identity of the qualified executable taken before hashing; re-taken after the helper. */
  executableWitness: ExecutableWitness;
  bridge: { path: string; sha256: string };
  attestation?: CodexNativePolicyAttestation;
}
export interface CodexNativePolicyAcceptedSkill { path: string; treeSha256: string }
export interface CodexNativePolicyAcceptance {
  schema: typeof CODEX_NATIVE_POLICY_RECEIPT_SCHEMA; acceptedAt: string; event: CodexNativeHookEvent; sessionId: string; turnId: string | null;
  process: { id: number; startTime: string; executablePath: string; executableSha256: string; platform: string };
  effectiveConfigDigest: string; bridge: { path: string; sha256: string }; acceptedCache: CodexNativePolicyAcceptedSkill[];
  attestation?: CodexNativePolicyAttestation;
}
/** Draft native helper transport: argv, bounded run, JSON attestation. */
export const CODEX_NATIVE_POLICY_PEER_SCHEMA = "native-hook-policy-peer-v1";
export const CODEX_NATIVE_POLICY_HELPER_TIMEOUT_MS = 5_000;
export const CODEX_NATIVE_POLICY_HELPER_MAX_OUTPUT_BYTES = 64 * 1024;
/** Hook-deadline bounds: the helper gets min(5 s, remaining minus the margin);
 * a first-run executable hash needs this much budget; below the minimum the
 * adapter refuses fast instead of spawning anything. */
export const CODEX_NATIVE_POLICY_DEADLINE_MARGIN_MS = 1_000;
export const CODEX_NATIVE_POLICY_HELPER_MIN_TIMEOUT_MS = 500;
export const CODEX_NATIVE_POLICY_FIRST_HASH_BUDGET_MS = 3_000;
export interface NativePolicyHelperRequest { executablePath: string; fd: number; expectedProcessId: number; inputSha256: string; timeoutMs: number; maxOutputBytes: number }
export interface NativePolicyHelperResult { exitCode: number | null; stdout: Buffer; timedOut: boolean; oversized: boolean }
/** Injectable so tests can fake the helper; production spawns the verified binary. */
export type NativePolicyHelperRunner = (request: NativePolicyHelperRequest) => NativePolicyHelperResult;
export const CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA = "skills.codex-native-policy-executable-cache/v1";
/** No-follow identity of the qualified executable file; the only thing cached. */
export interface ExecutableWitness { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string; uid: string }

function refuse(code: string, detail: string): never { throw new Error(`${code}: ${detail}`); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function boundedId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.length > MAX_ENVELOPE_ID_LENGTH || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) refuse("NATIVE_SKILL_POLICY_INVALID", `${field} must be a bounded non-empty string`);
  return value;
}

/** Absent trust is an empty set: every platform is unqualified and refuses.
 * The pinned digests are reviewed operator configuration, never a package default. */
export function parseCodexNativePolicyTrust(value: unknown): CodexNativePolicyTrust {
  if (value === undefined) return { executableDigests: {} };
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.executableDigests) || Object.keys(value.executableDigests).length > 8) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", "bridge.codexNativePolicy must hold only executableDigests");
  const executableDigests: Record<string, readonly string[]> = {};
  for (const [platform, digests] of Object.entries(value.executableDigests)) {
    if (!PLATFORM_KEY.test(platform) || !Array.isArray(digests) || digests.length > 16 || digests.some(digest => typeof digest !== "string" || !HEX_DIGEST.test(digest)) || new Set(digests).size !== digests.length) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `invalid executable digest set for ${JSON.stringify(platform)}`);
    executableDigests[platform] = Object.freeze([...(digests as string[])]);
  }
  return { executableDigests };
}

/** Strict envelope parsing. Unknown keys, unknown capability, unrestricted mode
 * and anything but the exact bridge document refuse. */
export function parseCodexNativeHookEnvelope(envelope: CodexNativeHookEnvelope, bridgeDocument: string): { policy: CodexNativeSkillPolicy; sessionId: string; turnId: string | null; hookInputSha256: string | null; inheritedFd: number | null } {
  if (envelope.event !== "SessionStart" && envelope.event !== "UserPromptSubmit") refuse("NATIVE_SKILL_POLICY_INVALID", "native policy is only carried by SessionStart and UserPromptSubmit");
  const value = envelope.policy;
  if (!object(value)) refuse("NATIVE_SKILL_POLICY_INVALID", "native_skill_policy must be an object");
  const keys = Object.keys(value);
  for (const field of POLICY_FIELDS) if (!Object.hasOwn(value, field)) refuse("NATIVE_SKILL_POLICY_INVALID", `native_skill_policy.${field} is missing`);
  if (keys.length !== POLICY_FIELDS.length) refuse("NATIVE_SKILL_POLICY_INVALID", "native_skill_policy carries unknown fields");
  if (value.capability !== CODEX_NATIVE_POLICY_CAPABILITY) refuse("NATIVE_SKILL_POLICY_UNSUPPORTED", "unknown native skill policy capability");
  if (value.mode !== "restricted") refuse("NATIVE_SKILL_POLICY_UNSUPPORTED", "native skill policy is not restricted");
  if (value.nonHostSources !== "disabled") refuse("NATIVE_SKILL_POLICY_UNSUPPORTED", "native non-host skill sources are not disabled");
  const allowed = value.allowedHostPaths;
  if (!Array.isArray(allowed) || allowed.length !== 1 || typeof allowed[0] !== "string") refuse("NATIVE_SKILL_POLICY_INVALID", "allowedHostPaths must list exactly one document");
  if (allowed[0] !== bridgeDocument) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", "the allowed host path is not the Skills bridge document");
  if (typeof value.effectiveConfigDigest !== "string" || !HEX_DIGEST.test(value.effectiveConfigDigest)) refuse("NATIVE_SKILL_POLICY_INVALID", "effectiveConfigDigest must be lowercase SHA-256 hex");
  if (typeof value.processId !== "number" || !Number.isSafeInteger(value.processId) || value.processId <= 0 || value.processId > 0x7fffffff) refuse("NATIVE_SKILL_POLICY_INVALID", "processId must be a positive process id");
  const sessionId = boundedId(envelope.sessionId, "session_id");
  let turnId: string | null = null;
  if (envelope.event === "UserPromptSubmit") turnId = boundedId(envelope.turnId, "turn_id");
  else if (envelope.turnId !== undefined) refuse("NATIVE_SKILL_POLICY_INVALID", "SessionStart input carries no turn_id");
  let hookInputSha256: string | null = null;
  if (envelope.hookInputSha256 !== undefined) {
    if (typeof envelope.hookInputSha256 !== "string" || !HEX_DIGEST.test(envelope.hookInputSha256)) refuse("NATIVE_SKILL_POLICY_INVALID", "hook input digest must be lowercase SHA-256 hex");
    hookInputSha256 = envelope.hookInputSha256;
  }
  let inheritedFd: number | null = null;
  if (envelope.inheritedFd !== undefined) {
    if (typeof envelope.inheritedFd !== "number" || !Number.isSafeInteger(envelope.inheritedFd) || envelope.inheritedFd < 0) refuse("NATIVE_SKILL_POLICY_INVALID", "the inherited channel descriptor must be a non-negative integer");
    inheritedFd = envelope.inheritedFd;
  }
  return { policy: { capability: CODEX_NATIVE_POLICY_CAPABILITY, mode: "restricted", allowedHostPaths: [allowed[0]], nonHostSources: "disabled", processId: value.processId, effectiveConfigDigest: value.effectiveConfigDigest }, sessionId, turnId, hookInputSha256, inheritedFd };
}

function readBounded(path: string, maximum: number, what: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.size > maximum) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", `${what} is not a bounded regular file`);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", `${what} changed while reading`);
    const bytes = Buffer.allocUnsafe(before.size + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", `${what} changed while reading`);
    return bytes.subarray(0, length);
  } finally { closeSync(descriptor); }
}

/** The owned bridge document: a regular file, no link in any component, its
 * real path equal to its lexical path, and exactly the bytes the guard installs. */
export function verifyCodexNativeBridgeDocument(path: string, expectedContent: string, expectedSha256: string): { path: string; sha256: string } {
  if (!isAbsolute(path) || resolve(path) !== path || !path.endsWith("/SKILL.md")) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", "the bridge document path is not an exact absolute SKILL.md path");
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || (cursor === path ? !stat.isFile() : !stat.isDirectory())) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", `the bridge path has a missing, linked or unexpected component: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
  if (realpathSync.native(path) !== path) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", "the bridge document real path differs from its lexical path");
  const bytes = readBounded(path, MAX_BRIDGE_DOCUMENT_BYTES, "the bridge document");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!bytes.equals(Buffer.from(expectedContent, "utf8")) || sha256 !== expectedSha256) refuse("NATIVE_SKILL_POLICY_BRIDGE_UNVERIFIED", "the bridge document bytes differ from the managed bridge");
  return { path, sha256 };
}

/** Walk the real parent chain from the hook process to the root. The claimed
 * consumer must appear as a strict ancestor. Only a cycle/loop guard bounds
 * the walk; the expected launch-chain shape (which wrappers may sit between
 * Codex and this hook) is pending from the native author and plugs in here as
 * a predicate over the walked chain. */
export function verifyCodexNativeAncestry(inspector: ProcessInspector, processId: number): { hops: number; chain: number[]; startTime: string } {
  if (!Number.isSafeInteger(inspector.pid) || inspector.pid <= 0) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the hook process id is unknown");
  if (processId === inspector.pid) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the claimed consumer is the hook process itself");
  const chain: number[] = [], visited = new Set<number>([inspector.pid]);
  for (let current = inspector.pid, hops = 1; ; hops++) {
    if (hops > CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the parent chain exceeded the walk safety bound");
    const parent = inspector.parentOf(current);
    if (parent === null || !Number.isSafeInteger(parent) || parent <= 0) break;
    if (visited.has(parent)) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the parent chain loops");
    visited.add(parent); chain.push(parent);
    if (parent === processId) {
      // Bind the ancestor found by the walk to one incarnation: the same start
      // time must be read again before hashing and after the helper.
      const startTime = inspector.startTime(processId);
      if (typeof startTime !== "string" || !startTime || startTime.length > 128) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer start time is unreadable");
      return { hops, chain, startTime };
    }
    if (parent === 1) break;
    current = parent;
  }
  refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the claimed consumer is not an ancestor of the hook process");
}

export function hashExecutableFile(path: string): string {
  const identity = (stat: Stats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_EXECUTABLE_BYTES) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable is not a bounded regular file");
    const hasher = new Bun.CryptoHasher("sha256"), chunk = Buffer.allocUnsafe(1024 * 1024); let total = 0;
    for (;;) { const count = readSync(descriptor, chunk, 0, chunk.length, null); if (!count) break; hasher.update(chunk.subarray(0, count)); total += count; }
    if (total !== opened.size || identity(fstatSync(descriptor)) !== identity(opened)) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable changed while hashing");
    return hasher.digest("hex");
  } finally { closeSync(descriptor); }
}

/** Accept only a regular file owned by root or the current user that neither
 * group nor world can write. Pure over the no-follow stat so it is testable
 * with synthetic owners. */
export function assertExecutableWitnessStat(stat: Pick<BigIntStats, "isFile" | "isSymbolicLink" | "uid" | "mode" | "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">, currentUid: number): ExecutableWitness {
  if (stat.isSymbolicLink() || !stat.isFile()) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable is not a regular file");
  if (stat.uid !== 0n && stat.uid !== BigInt(currentUid)) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable is owned by another user");
  if ((stat.mode & 0o022n) !== 0n) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable is group- or world-writable");
  return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), uid: String(stat.uid) };
}

/** No-follow witness of the path proc_pidpath reported: no component may be a
 * link, and the file must satisfy assertExecutableWitnessStat. */
export function executableWitness(path: string): ExecutableWitness {
  if (!isAbsolute(path) || resolve(path) !== path) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable path is not an exact absolute path");
  for (let cursor = dirname(path); ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", `the consumer executable path has a missing, linked or unexpected component: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
  const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true });
  if (!stat) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable is missing");
  return assertExecutableWitnessStat(stat, process.getuid?.() ?? -1);
}

const witnessKey = (path: string, witness: ExecutableWitness) => JSON.stringify([path, witness.dev, witness.ino, witness.size, witness.mtimeNs, witness.ctimeNs, witness.uid]);
const executableDigestMemory = new Map<string, string>();
export function executableCachePath(dataDir: string): string { return join(resolve(dataDir), "agent-hooks", "codex-native-policy-executable-cache.json"); }
type CacheEntry = ExecutableWitness & { path: string; sha256: string };
function readExecutableCache(dataDir: string): CacheEntry[] {
  try {
    const path = executableCachePath(dataDir);
    if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) return [];
    const value = JSON.parse(readBounded(path, 64 * 1024, "the executable cache").toString("utf8"));
    if (!object(value) || value.schema !== CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA || !Array.isArray(value.entries) || value.entries.length > 16) return [];
    const fields = ["path", "sha256", "dev", "ino", "size", "mtimeNs", "ctimeNs", "uid"];
    return value.entries.filter((entry: unknown): entry is CacheEntry => object(entry) && Object.keys(entry).length === fields.length && fields.every(field => typeof entry[field] === "string")
      && HEX_DIGEST.test(entry.sha256 as string) && isAbsolute(entry.path as string) && ["dev", "ino", "size", "mtimeNs", "ctimeNs", "uid"].every(field => /^\d{1,30}$/.test(entry[field] as string)));
  } catch { return []; }
}
/** Best effort: a cache that cannot be written only costs the next re-hash.
 * The file holds artifact identity to digest mappings and nothing else. */
function writeExecutableCache(dataDir: string, entries: CacheEntry[]): void {
  const path = executableCachePath(dataDir), directory = dirname(path), temporary = `${path}.skills-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) return;
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schema: CODEX_NATIVE_POLICY_EXECUTABLE_CACHE_SCHEMA, entries: entries.slice(-16) })}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
  } catch { /* The next invocation re-hashes. */ } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

/** Digest of the qualified executable through the artifact-identity cache.
 * Only (path, dev, ino, size, mtimeNs, ctimeNs, uid) -> sha256 is cached, in
 * process and optionally in a 0600 file under the Skills data dir. A witness
 * that changes between before and after, or differs from the cached key, is
 * re-hashed. Policy, attestation, session and turn results are never cached. */
export function qualifiedExecutableSha256(path: string, options: { dataDir?: string; hasher?: (path: string) => string; deadlineMs?: number } = {}): { sha256: string; witness: ExecutableWitness; cached: boolean } {
  const before = executableWitness(path), key = witnessKey(path, before);
  const fileEntries = options.dataDir ? readExecutableCache(options.dataDir) : [];
  const cached = executableDigestMemory.get(key) ?? fileEntries.find(entry => witnessKey(entry.path, entry) === key)?.sha256;
  if (cached !== undefined && witnessKey(path, executableWitness(path)) === key) {
    executableDigestMemory.set(key, cached);
    return { sha256: cached, witness: before, cached: true };
  }
  if (options.deadlineMs !== undefined && options.deadlineMs - Date.now() < CODEX_NATIVE_POLICY_FIRST_HASH_BUDGET_MS) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "insufficient hook budget to hash the consumer executable on first use");
  const sha256 = (options.hasher ?? hashExecutableFile)(path);
  const after = executableWitness(path);
  if (witnessKey(path, after) !== key) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable changed while hashing");
  executableDigestMemory.set(key, sha256);
  if (options.dataDir) writeExecutableCache(options.dataDir, [...fileEntries.filter(entry => entry.path !== path), { path, ...before, sha256 }]);
  return { sha256, witness: before, cached: false };
}

/** Bind the claimed process to its start identity and a pinned executable
 * digest. The pin set is reviewed operator trust; an absent or empty set for
 * this platform means the platform is unqualified and refuses. Linux stays
 * unqualified until its artifact is reviewed. The helper cannot attest that it
 * is itself reviewed, so this trust stays in the managed policy. */
export function verifyCodexNativeExecutable(inspector: ProcessInspector, processId: number, trust: CodexNativePolicyTrust, cache: { dataDir?: string; hasher?: (path: string) => string; deadlineMs?: number } = {}, expectations: { ancestryStartTime?: string } = {}): { platform: string; startTime: string; executablePath: string; executableSha256: string; witness: ExecutableWitness } {
  const platform = `${inspector.platform}-${inspector.arch}`;
  const pinned = PLATFORM_KEY.test(platform) ? trust.executableDigests[platform] ?? [] : [];
  if (!pinned.length) refuse("NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED", `no reviewed Codex executable digest is configured for ${platform}`);
  const before = inspector.startTime(processId);
  if (typeof before !== "string" || !before || before.length > 128) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer start time is unreadable");
  if (expectations.ancestryStartTime !== undefined && before !== expectations.ancestryStartTime) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer start time changed after the ancestry walk");
  const executablePath = inspector.executablePath(processId);
  if (typeof executablePath !== "string" || !executablePath) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable path is unreadable");
  const { sha256: executableSha256, witness } = qualifiedExecutableSha256(executablePath, cache);
  // The same pid with another start time is a reused pid, not the consumer.
  if (inspector.startTime(processId) !== before) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer process changed while its executable was hashed");
  if (!pinned.includes(executableSha256)) refuse("NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED", "the consumer executable digest is not a reviewed Codex artifact");
  return { platform, startTime: before, executablePath, executableSha256, witness };
}

/** The Skills data directory is the operator trust root: the managed policy
 * that carries the reviewed executable digests, and the executable identity
 * cache, must each be a regular file reached through no symlink, owned by the
 * current user or root and writable by neither group nor world. Anything else
 * fails the adapter closed. A writer with the same uid is outside this
 * boundary. */
export function assertOperatorTrustRoot(dataDir: string): void {
  const check = (path: string, what: string, required: boolean) => {
    if (!isAbsolute(path) || resolve(path) !== path) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} path is not an exact absolute path`);
    for (let cursor = dirname(path); ; cursor = dirname(cursor)) {
      const stat = lstatSync(cursor, { throwIfNoEntry: false });
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} has a missing, linked or unexpected path component: ${cursor}`);
      if (dirname(cursor) === cursor) break;
    }
    const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true });
    if (!stat) { if (required) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} is missing`); return; }
    if (stat.isSymbolicLink() || !stat.isFile()) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} is not a regular file`);
    if (stat.uid !== 0n && stat.uid !== BigInt(process.getuid?.() ?? -1)) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} is owned by another user`);
    if ((stat.mode & 0o022n) !== 0n) refuse("NATIVE_SKILL_POLICY_TRUST_INVALID", `${what} is group- or world-writable`);
  };
  check(join(resolve(dataDir), "agent-policy.json"), "the managed policy", true);
  check(executableCachePath(dataDir), "the executable identity cache", false);
}

/** Production helper runner: the verified binary, no shell, an allowlisted
 * empty environment, cwd `/`, the inherited descriptor forwarded as fd 3, and
 * bounded time and output. Bun.spawnSync accepts a fourth stdio entry, which
 * dup2s that descriptor to 3 in the child (measured on bun 1.3.14). */
export function runCodexNativePolicyHelper(request: NativePolicyHelperRequest): NativePolicyHelperResult {
  const result = Bun.spawnSync([request.executablePath, "debug", "verify-hook-policy", "--fd", "3", "--expected-process-id", String(request.expectedProcessId), "--input-sha256", request.inputSha256], {
    stdio: ["ignore", "pipe", "pipe", request.fd], env: {}, cwd: "/", timeout: request.timeoutMs, maxBuffer: request.maxOutputBytes, killSignal: "SIGKILL",
  });
  const flags = result as unknown as { exitedDueToTimeout?: boolean; exitedDueToMaxBuffer?: boolean };
  return { exitCode: result.exitCode, stdout: Buffer.from(result.stdout ?? new Uint8Array()), timedOut: flags.exitedDueToTimeout === true, oversized: flags.exitedDueToMaxBuffer === true || (result.stdout?.length ?? 0) > request.maxOutputBytes };
}

function channelRefusal(detail: string): never { refuse("NATIVE_SKILL_POLICY_UNAUTHENTICATED", detail); }

/** Authenticated channel binding, against the frozen native source
 * (native-hook-policy-peer-v1; "line" numbers below index the native
 * producer's hook-policy-peer patch as reviewed):
 * - the hook runner creates a Unix socketpair per invocation (line 296),
 *   forwards the receiver to the hook child (line 171) and names it in
 *   CODEX_NATIVE_SKILL_POLICY_FD (lines 172-175, constant at line 264);
 * - the verifier is `<codex> debug verify-hook-policy --fd <i32>
 *   --expected-process-id <u32> --input-sha256 <hex>` (lines 88-97, dispatch
 *   lines 102-103), dispatched in main before config, auth-home or session
 *   setup (lines 55-58); it requires fd > 2 (line 449), a positive pid
 *   (line 450) and a lowercase 64-hex digest (line 456);
 * - success writes one compact JSON object to stdout followed by a newline and
 *   exits 0 (lines 56-58): {"schema":"native-hook-policy-peer-v1",
 *   "peerProcessId":<kernel peer pid>,"stdinSha256":<the digest>,
 *   "policy":<the native_skill_policy the producer emitted>} (lines 546-550,
 *   schema at line 263); any failure returns an error from main, so the
 *   process exits non-zero with the message on stderr and nothing on stdout;
 * - the producer hashes the exact bytes it wrote to the hook's stdin,
 *   lowercase hex (lines 286-288), and the verifier compares it with
 *   --input-sha256 (line 536), so the hook must hash its raw stdin bytes;
 * - the verifier checks the kernel peer before and after a fresh random
 *   challenge (lines 466-469, 490-491, 517-519, 526-528); Linux also
 *   authenticates every response chunk's writer through SCM_CREDENTIALS.
 *   A creator-pid-only binding was rejected (NO_GO: pre-exec forgery
 *   reproduced); the fresh challenge plus actual-writer verification is the
 *   correction.
 * The hook forwards the descriptor to the QUALIFIED ancestor's own executable
 * (the digest-verified path, never PATH) as fd 3, with no shell, an empty
 * environment, cwd `/` and bounded time and output, and accepts the
 * attestation only when every field matches. The proof is never cached:
 * once per invocation, SessionStart included. The channel pre-check here is
 * fstat only; the socket semantics are enforced by the verifier itself. */
export function verifyCodexNativeChannelBinding(options: { executablePath: string; inheritedFd: number | null; expectedProcessId: number; expectedStartTime: string; expectedWitness?: ExecutableWitness; inputSha256: string | null; emittedPolicy: unknown; inspector: ProcessInspector; runner?: NativePolicyHelperRunner; timeoutMs?: number; maxOutputBytes?: number; deadlineMs?: number }): CodexNativePolicyAttestation {
  if (options.inheritedFd === null) channelRefusal(`${CODEX_NATIVE_POLICY_FD_ENV} is not set; no inherited channel descriptor`);
  if (options.inputSha256 === null) channelRefusal("the raw hook input digest is missing");
  let kind: Stats;
  try { kind = fstatSync(options.inheritedFd); } catch { channelRefusal("the inherited channel descriptor is closed or not inheritable"); }
  if (!kind.isSocket() && !kind.isFIFO()) channelRefusal("the inherited channel descriptor is not a socket or pipe");
  let timeoutMs = options.timeoutMs ?? CODEX_NATIVE_POLICY_HELPER_TIMEOUT_MS;
  if (options.deadlineMs !== undefined) {
    const remaining = options.deadlineMs - Date.now() - CODEX_NATIVE_POLICY_DEADLINE_MARGIN_MS;
    if (remaining < CODEX_NATIVE_POLICY_HELPER_MIN_TIMEOUT_MS) channelRefusal("insufficient hook budget for the native policy helper");
    timeoutMs = Math.min(timeoutMs, remaining);
  }
  const runner = options.runner ?? runCodexNativePolicyHelper;
  const result = runner({ executablePath: options.executablePath, fd: options.inheritedFd, expectedProcessId: options.expectedProcessId, inputSha256: options.inputSha256, timeoutMs, maxOutputBytes: options.maxOutputBytes ?? CODEX_NATIVE_POLICY_HELPER_MAX_OUTPUT_BYTES });
  if (result.timedOut) channelRefusal("the native policy helper timed out");
  if (result.oversized || result.stdout.length > (options.maxOutputBytes ?? CODEX_NATIVE_POLICY_HELPER_MAX_OUTPUT_BYTES)) channelRefusal("the native policy helper output exceeded its bound");
  if (result.exitCode !== 0) channelRefusal(`the native policy helper exited with ${result.exitCode === null ? "a signal" : `status ${result.exitCode}`}`);
  // The consumer must still be the process whose executable was qualified,
  // and the file that was run must still be the file that was hashed.
  if (options.inspector.startTime(options.expectedProcessId) !== options.expectedStartTime) channelRefusal("the consumer process changed while the helper ran");
  if (options.expectedWitness !== undefined && witnessKey(options.executablePath, executableWitness(options.executablePath)) !== witnessKey(options.executablePath, options.expectedWitness)) channelRefusal("the consumer executable changed while the helper ran");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)); } catch { channelRefusal("the native policy helper output is not JSON"); }
  if (!object(value)) channelRefusal("the native policy helper output is not an object");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "peerProcessId,policy,schema,stdinSha256") channelRefusal("the native policy attestation has missing or unknown fields");
  if (value.schema !== CODEX_NATIVE_POLICY_PEER_SCHEMA) channelRefusal("unknown native policy attestation schema");
  if (value.peerProcessId !== options.expectedProcessId) channelRefusal("the attested peer process is not the qualified consumer");
  if (value.stdinSha256 !== options.inputSha256) channelRefusal("the attested hook input digest differs from the raw stdin digest");
  if (!isDeepStrictEqual(value.policy, options.emittedPolicy)) channelRefusal("the attested policy differs from the emitted native_skill_policy");
  return { schema: CODEX_NATIVE_POLICY_PEER_SCHEMA, peerProcessId: options.expectedProcessId };
}

/** Required acceptance gate: the authenticated channel binding of the native
 * contract, run with the qualified ancestor's verified executable and its
 * witness, its start time, the raw stdin digest, the inherited descriptor, the
 * emitted policy and the remaining hook budget. */
export function assertAuthenticatedChannelBinding(binding: { processId: number; hookInputSha256: string | null; inheritedFd: number | null; verification: CodexNativePolicyVerification; emittedPolicy: unknown; inspector: ProcessInspector; runner?: NativePolicyHelperRunner; deadlineMs?: number }): CodexNativePolicyAttestation {
  return verifyCodexNativeChannelBinding({ executablePath: binding.verification.executablePath, inheritedFd: binding.inheritedFd, expectedProcessId: binding.processId, expectedStartTime: binding.verification.processStartTime, expectedWitness: binding.verification.executableWitness, inputSha256: binding.hookInputSha256, emittedPolicy: binding.emittedPolicy, inspector: binding.inspector, runner: binding.runner, deadlineMs: binding.deadlineMs });
}

/** Full adapter verification. Every step refuses with a reason. Order: trust
 * configuration, envelope, bridge, ancestry, executable digest (reviewed trust),
 * then the authenticated channel binding, once per invocation. */
export function verifyCodexNativeSkillPolicy(options: { envelope: CodexNativeHookEnvelope; bridgeDocument: string; expectedBridgeContent: string; expectedBridgeSha256: string; trust?: unknown; inspector?: ProcessInspector; dataDir?: string; executableHasher?: (path: string) => string; helperRunner?: NativePolicyHelperRunner; deadlineMs?: number }): CodexNativePolicyVerification {
  if (options.dataDir !== undefined) assertOperatorTrustRoot(options.dataDir);
  const trust = parseCodexNativePolicyTrust(options.trust);
  const parsed = parseCodexNativeHookEnvelope(options.envelope, options.bridgeDocument);
  const bridge = verifyCodexNativeBridgeDocument(options.bridgeDocument, options.expectedBridgeContent, options.expectedBridgeSha256);
  const inspector = options.inspector ?? defaultProcessInspector();
  const ancestry = verifyCodexNativeAncestry(inspector, parsed.policy.processId);
  const executable = verifyCodexNativeExecutable(inspector, parsed.policy.processId, trust, { dataDir: options.dataDir, hasher: options.executableHasher, deadlineMs: options.deadlineMs }, { ancestryStartTime: ancestry.startTime });
  const verification: CodexNativePolicyVerification = { event: options.envelope.event, sessionId: parsed.sessionId, turnId: parsed.turnId, policy: parsed.policy, platform: executable.platform, ancestryHops: ancestry.hops, processStartTime: executable.startTime, executablePath: executable.executablePath, executableSha256: executable.executableSha256, executableWitness: executable.witness, bridge };
  // The trust check above runs first: with no reviewed digest for this
  // platform, the helper is never spawned.
  verification.attestation = assertAuthenticatedChannelBinding({ processId: parsed.policy.processId, hookInputSha256: parsed.hookInputSha256, inheritedFd: parsed.inheritedFd, verification, emittedPolicy: options.envelope.policy, inspector, runner: options.helperRunner, deadlineMs: options.deadlineMs });
  return verification;
}

/** Darwin: libproc through bun:ffi. proc_pidinfo(PROC_PIDTBSDINFO) yields the
 * parent pid and start time; proc_pidpath yields the executable path. Layout
 * from the SDK's sys/proc_info.h (struct proc_bsdinfo, 136 bytes): pbi_pid at
 * 12, pbi_ppid at 16, pbi_start_tvsec at 120, pbi_start_tvusec at 128. */
export function darwinProcessInspector(): ProcessInspector {
  const PROC_PIDTBSDINFO = 3, PROC_BSDINFO_SIZE = 136, PROC_PIDPATHINFO_MAXSIZE = 4096;
  function withLibproc<T>(use: (symbols: { proc_pidinfo: (pid: number, flavor: number, arg: bigint, buffer: unknown, size: number) => number; proc_pidpath: (pid: number, buffer: unknown, size: number) => number }, ptr: (view: ArrayBufferView) => unknown) => T): T | null {
    try {
      const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
      const library = dlopen("/usr/lib/libSystem.B.dylib", {
        proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
        proc_pidpath: { args: ["i32", "ptr", "u32"], returns: "i32" },
      });
      try { return use(library.symbols as never, ptr as never); } finally { library.close(); }
    } catch { return null; }
  }
  const bsdInfo = (pid: number): DataView | null => withLibproc((symbols, ptr) => {
    const buffer = new Uint8Array(PROC_BSDINFO_SIZE);
    if (symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0n, ptr(buffer), PROC_BSDINFO_SIZE) !== PROC_BSDINFO_SIZE) return null;
    const view = new DataView(buffer.buffer);
    return view.getUint32(12, true) === pid ? view : null;
  });
  return {
    platform: process.platform, arch: process.arch, pid: process.pid,
    parentOf(pid) { const view = bsdInfo(pid); return view ? view.getUint32(16, true) : null; },
    startTime(pid) { const view = bsdInfo(pid); return view ? `${view.getBigUint64(120, true)}.${view.getBigUint64(128, true)}` : null; },
    executablePath(pid) {
      return withLibproc((symbols, ptr) => {
        const buffer = new Uint8Array(PROC_PIDPATHINFO_MAXSIZE);
        const length = symbols.proc_pidpath(pid, ptr(buffer), PROC_PIDPATHINFO_MAXSIZE);
        return length > 0 ? new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)) : null;
      });
    },
  };
}

/** Linux: procfs. The parent pid and start time (clock ticks since boot) come
 * from /proc/<pid>/stat after the bracketed command name; the executable from
 * /proc/<pid>/exe. Linux remains unqualified until its artifact is reviewed. */
export function linuxProcessInspector(): ProcessInspector {
  const fields = (pid: number): string[] | null => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8"), end = stat.lastIndexOf(")");
      return end < 0 ? null : stat.slice(end + 1).trim().split(/\s+/);
    } catch { return null; }
  };
  return {
    platform: process.platform, arch: process.arch, pid: process.pid,
    parentOf(pid) { const value = fields(pid)?.[1]; return value && /^\d+$/.test(value) ? Number(value) : null; },
    startTime(pid) { const value = fields(pid)?.[19]; return value && /^\d+$/.test(value) ? value : null; },
    executablePath(pid) { try { return readlinkSync(`/proc/${pid}/exe`); } catch { return null; } },
  };
}

export function defaultProcessInspector(): ProcessInspector {
  if (process.platform === "darwin") return darwinProcessInspector();
  if (process.platform === "linux") return linuxProcessInspector();
  return { platform: process.platform, arch: process.arch, pid: process.pid, parentOf: () => null, startTime: () => null, executablePath: () => null };
}

export function codexNativePolicyReceiptPath(dataDir: string): string {
  return join(resolve(dataDir), "agent-hooks", "codex-native-policy-acceptance.json");
}

/** Write the provenance receipt for one accepted hook: mode 0600, exclusive
 * no-follow temporary file, then rename. Any failure throws, and the caller
 * treats that as a refusal. Reachable only after the channel binding passes. */
export function recordCodexNativePolicyAcceptance(dataDir: string, verification: CodexNativePolicyVerification, accepted: readonly CodexNativePolicyAcceptedSkill[]): string {
  const path = codexNativePolicyReceiptPath(dataDir), directory = dirname(path);
  const acceptedCache = accepted.map(entry => ({ path: entry.path, treeSha256: entry.treeSha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (acceptedCache.some(entry => !isAbsolute(entry.path) || !HEX_DIGEST.test(entry.treeSha256)) || new Set(acceptedCache.map(entry => entry.path)).size !== acceptedCache.length) refuse("NATIVE_SKILL_POLICY_RECEIPT_FAILED", "accepted cache entries must be unique absolute paths with tree digests");
  const value: CodexNativePolicyAcceptance = {
    schema: CODEX_NATIVE_POLICY_RECEIPT_SCHEMA, acceptedAt: new Date().toISOString(), event: verification.event, sessionId: verification.sessionId, turnId: verification.turnId,
    process: { id: verification.policy.processId, startTime: verification.processStartTime, executablePath: verification.executablePath, executableSha256: verification.executableSha256, platform: verification.platform },
    effectiveConfigDigest: verification.policy.effectiveConfigDigest, bridge: verification.bridge, acceptedCache,
    ...(verification.attestation ? { attestation: { schema: verification.attestation.schema, peerProcessId: verification.attestation.peerProcessId } } : {}),
  };
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`the receipt directory is not a real directory: ${directory}`);
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`the receipt path is a link: ${path}`);
  } catch (error) { refuse("NATIVE_SKILL_POLICY_RECEIPT_FAILED", (error as Error).message); }
  const temporary = `${path}.skills-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    refuse("NATIVE_SKILL_POLICY_RECEIPT_FAILED", (error as Error).message);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
  return path;
}
