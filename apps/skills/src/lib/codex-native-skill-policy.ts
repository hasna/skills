/**
 * Codex native skill policy adapter.
 *
 * A patched Codex (internal-apps #1475 @ 5d1968c9, patch 0025) can restrict its
 * native skill injection to an exact host-path allowlist and reports that
 * effective policy to its SessionStart and UserPromptSubmit hooks as
 * `native_skill_policy`, together with its own process id. This module parses
 * that envelope, verifies that the sole allowed document is the Skills-owned
 * bridge, binds the claimed process to the hook's real ancestor chain and to a
 * reviewed executable digest, and prepares a provenance receipt.
 *
 * What these checks do not prove: the hook input is written by whichever
 * process invokes the hook. A descendant of a trusted Codex can invoke this
 * hook with a forged envelope that names its unrestricted ancestor, and the
 * envelope, ancestry, start-time and digest checks all pass in that case.
 * Format and digest checks therefore never establish the runtime policy.
 * Acceptance is gated on an authenticated channel binding over the hook
 * transport (a bounded readback socket served by the actual Codex process,
 * proving the kernel peer pid, the exact hook stdin hash and the actual
 * policy). Its verifier is not delivered yet. Until it is,
 * `assertAuthenticatedChannelBinding` refuses every envelope, nothing becomes
 * inert through this adapter and no receipt is written.
 *
 * Hashing the file at the executable path is not code-signature identity
 * either: the file can be replaced after exec, and the running image is never
 * re-read. The digest only binds the path the OS reports to a reviewed artifact.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
export interface CodexNativePolicyVerification {
  event: CodexNativeHookEvent; sessionId: string; turnId: string | null; policy: CodexNativeSkillPolicy;
  platform: string; ancestryHops: number; processStartTime: string; executablePath: string; executableSha256: string;
  bridge: { path: string; sha256: string };
}
export interface CodexNativePolicyAcceptedSkill { path: string; treeSha256: string }
export interface CodexNativePolicyAcceptance {
  schema: typeof CODEX_NATIVE_POLICY_RECEIPT_SCHEMA; acceptedAt: string; event: CodexNativeHookEvent; sessionId: string; turnId: string | null;
  process: { id: number; startTime: string; executablePath: string; executableSha256: string; platform: string };
  effectiveConfigDigest: string; bridge: { path: string; sha256: string }; acceptedCache: CodexNativePolicyAcceptedSkill[];
}

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
export function parseCodexNativeHookEnvelope(envelope: CodexNativeHookEnvelope, bridgeDocument: string): { policy: CodexNativeSkillPolicy; sessionId: string; turnId: string | null; hookInputSha256: string | null } {
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
  return { policy: { capability: CODEX_NATIVE_POLICY_CAPABILITY, mode: "restricted", allowedHostPaths: [allowed[0]], nonHostSources: "disabled", processId: value.processId, effectiveConfigDigest: value.effectiveConfigDigest }, sessionId, turnId, hookInputSha256 };
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
export function verifyCodexNativeAncestry(inspector: ProcessInspector, processId: number): { hops: number; chain: number[] } {
  if (!Number.isSafeInteger(inspector.pid) || inspector.pid <= 0) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the hook process id is unknown");
  if (processId === inspector.pid) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the claimed consumer is the hook process itself");
  const chain: number[] = [], visited = new Set<number>([inspector.pid]);
  for (let current = inspector.pid, hops = 1; ; hops++) {
    if (hops > CODEX_NATIVE_POLICY_ANCESTRY_SAFETY_HOPS) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the parent chain exceeded the walk safety bound");
    const parent = inspector.parentOf(current);
    if (parent === null || !Number.isSafeInteger(parent) || parent <= 0) break;
    if (visited.has(parent)) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the parent chain loops");
    visited.add(parent); chain.push(parent);
    if (parent === processId) return { hops, chain };
    if (parent === 1) break;
    current = parent;
  }
  refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the claimed consumer is not an ancestor of the hook process");
}

function hashExecutable(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable path is not an exact absolute path");
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

/** Bind the claimed process to its start identity and a pinned executable
 * digest. The pin set is reviewed operator trust; an absent or empty set for
 * this platform means the platform is unqualified and refuses. Linux stays
 * unqualified until its artifact is reviewed. */
export function verifyCodexNativeExecutable(inspector: ProcessInspector, processId: number, trust: CodexNativePolicyTrust): { platform: string; startTime: string; executablePath: string; executableSha256: string } {
  const platform = `${inspector.platform}-${inspector.arch}`;
  const pinned = PLATFORM_KEY.test(platform) ? trust.executableDigests[platform] ?? [] : [];
  if (!pinned.length) refuse("NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED", `no reviewed Codex executable digest is configured for ${platform}`);
  const before = inspector.startTime(processId);
  if (typeof before !== "string" || !before || before.length > 128) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer start time is unreadable");
  const executablePath = inspector.executablePath(processId);
  if (typeof executablePath !== "string" || !executablePath) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer executable path is unreadable");
  const executableSha256 = hashExecutable(executablePath);
  // The same pid with another start time is a reused pid, not the consumer.
  if (inspector.startTime(processId) !== before) refuse("NATIVE_SKILL_POLICY_PROCESS_UNBOUND", "the consumer process changed while its executable was hashed");
  if (!pinned.includes(executableSha256)) refuse("NATIVE_SKILL_POLICY_EXECUTABLE_UNPINNED", "the consumer executable digest is not a reviewed Codex artifact");
  return { platform, startTime: before, executablePath, executableSha256 };
}

/** Required acceptance gate. The authenticated channel binding is a bounded
 * readback socket served by the actual Codex process plus a read-only verifier
 * that proves the kernel peer pid, the exact hook stdin hash and the actual
 * policy. That verifier is not delivered yet, so this always refuses: the
 * earlier checks cannot distinguish the consumer's envelope from one forged by
 * a descendant process. The interface already takes the inputs the verifier
 * needs so it can slot in without reshaping the parser. */
export function assertAuthenticatedChannelBinding(_binding: { processId: number; hookInputSha256: string | null; verification: CodexNativePolicyVerification }): void {
  refuse("NATIVE_SKILL_POLICY_UNAUTHENTICATED", "the native hook transport has no authenticated channel binding yet; a forged envelope from a descendant process is indistinguishable from the consumer's own, so no native policy is accepted");
}

/** Full adapter verification. Every step refuses with a reason; today the
 * final channel-binding gate refuses unconditionally. */
export function verifyCodexNativeSkillPolicy(options: { envelope: CodexNativeHookEnvelope; bridgeDocument: string; expectedBridgeContent: string; expectedBridgeSha256: string; trust?: unknown; inspector?: ProcessInspector }): CodexNativePolicyVerification {
  const trust = parseCodexNativePolicyTrust(options.trust);
  const parsed = parseCodexNativeHookEnvelope(options.envelope, options.bridgeDocument);
  const bridge = verifyCodexNativeBridgeDocument(options.bridgeDocument, options.expectedBridgeContent, options.expectedBridgeSha256);
  const inspector = options.inspector ?? defaultProcessInspector();
  const ancestry = verifyCodexNativeAncestry(inspector, parsed.policy.processId);
  const executable = verifyCodexNativeExecutable(inspector, parsed.policy.processId, trust);
  const verification: CodexNativePolicyVerification = { event: options.envelope.event, sessionId: parsed.sessionId, turnId: parsed.turnId, policy: parsed.policy, platform: executable.platform, ancestryHops: ancestry.hops, processStartTime: executable.startTime, executablePath: executable.executablePath, executableSha256: executable.executableSha256, bridge };
  assertAuthenticatedChannelBinding({ processId: parsed.policy.processId, hookInputSha256: parsed.hookInputSha256, verification });
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
