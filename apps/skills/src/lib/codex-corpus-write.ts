import { KernelLock } from "@hasna/contracts/kernel-lock";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const KEY = ".native-corpus-admission";
/** Fixed refusal vocabulary for the interim fallback; never native text. */
export type CodexCorpusRefusal = "native-lock-present" | "executable-unverified" | "probe-inconclusive" | "command-present" | "writer-busy" | "skills-lock-unavailable" | "lease-changed";
const fail = (reason?: CodexCorpusRefusal): never => {
  throw new Error(`CODEX_CORPUS_ADMISSION_REQUIRED: verified native admission and its existing shared lock are required${reason ? ` (${reason})` : ""}`);
};

export interface CodexCorpusWriteOptions {
  /** The selected native executable; never a shell command. */
  codexCommand?: string;
  /** Existing callers with a reviewed executable binding retain that binding. */
  codexSha256?: string;
}

/** The probe behind a fallback write. `executable`, `sha256` and `size` identify the
 * selected executable file (for an npm install, the launcher script), not the vendor
 * binary it starts. Never contains native output. */
export interface CodexAdmissionProbe {
  kind: "help-unrecognized-subcommand";
  executable: string;
  sha256: string;
  size: number;
  version: string;
  probeExitCode: 2;
  controlExitCode: 0;
}
export interface CodexCorpusAdmission { nativeAdmission: "verified" | "unavailable"; probe?: CodexAdmissionProbe }
export interface CodexAdmissionReceipt { nativeAdmission?: "unavailable"; nativeAdmissionProbe?: CodexAdmissionProbe }
export interface CodexCorpusLease { assertCurrent(): void; close(): void; admission: CodexCorpusAdmission }
/** Boolean writers have no receipt: they use the fallback only when the caller takes this record. */
export interface CodexAdmissionRecordOptions { onCodexAdmission?: (admission: CodexCorpusAdmission) => void }
/** Gate policy for one transaction; writers without a receipt disable the fallback. */
export interface CodexCorpusWritePolicy { fallback?: boolean }

/** Reads `onCodexAdmission` once. Only a function enables the fallback and receives the
 * record; any other defined value refuses before anything happens. */
export function codexAdmissionRecord(options: CodexAdmissionRecordOptions): { policy: CodexCorpusWritePolicy; deliver(admission: CodexCorpusAdmission | undefined): void } {
  const record: unknown = options.onCodexAdmission;
  if (record !== undefined && typeof record !== "function") throw new Error("CODEX_CORPUS_ADMISSION_RECORD_INVALID: onCodexAdmission must be a function");
  return { policy: { fallback: typeof record === "function" }, deliver(admission) {
    if (admission && typeof record === "function") (record as (value: CodexCorpusAdmission) => void)(admission);
  } };
}

/** Receipt fields for a write made under the interim fallback; native-path receipts are unchanged. */
export function codexAdmissionReceipt(admission: CodexCorpusAdmission | undefined): CodexAdmissionReceipt {
  return admission?.nativeAdmission === "unavailable" && admission.probe
    ? { nativeAdmission: "unavailable", nativeAdmissionProbe: { ...admission.probe } } : {};
}

/** Resolve existing ancestors too, so an alias cannot hide a protected corpus. */
function physicalTarget(path: string): string {
  const suffix: string[] = [];
  for (let cursor = path;; cursor = dirname(cursor)) {
    try { return join(realpathSync(cursor), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || cursor === dirname(cursor)) throw error;
      // A dangling link is not a missing ordinary component.
      try { if (lstatSync(cursor).isSymbolicLink()) fail(); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
      suffix.unshift(basename(cursor));
    }
  }
}

/** Protected aliases fail closed; unrelated project paths remain usable. */
export function codexCorpusRootForPath(path: string): string | undefined {
  const target = resolve(path), physical = physicalTarget(target);
  const selected = process.env.CODEX_HOME;
  const selectedRoots = selected && isAbsolute(selected) ? [resolve(selected), physicalTarget(resolve(selected))] : [];
  const classify = (candidate: string): string | undefined => {
    const checked = (root: string): string => {
      if (candidate === root || candidate === join(root, `${KEY}.flock-v1`)) fail();
      return root;
    };
    for (const root of selectedRoots) {
      const distance = relative(root, candidate);
      if (distance === "" || (!distance.startsWith(`..${sep}`) && distance !== ".." && !isAbsolute(distance))) return checked(root);
    }
    for (let cursor = candidate; cursor !== dirname(cursor); cursor = dirname(cursor)) {
      if (cursor.endsWith(`${sep}.codex`)) return checked(cursor);
    }
    return undefined;
  };
  const root = classify(target) ?? classify(physical);
  if (root && target !== physical) fail();
  return root;
}

function identity(path: string): { device: string; inode: string } {
  const stat = lstatSync(path, { bigint: true });
  return { device: String(stat.dev), inode: String(stat.ino) };
}
function sameIdentity(value: unknown, expected: { device: string; inode: string }): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "device,inode"
    && typeof row.device === "string" && /^(0|[1-9][0-9]*)$/.test(row.device)
    && typeof row.inode === "string" && /^(0|[1-9][0-9]*)$/.test(row.inode)
    && row.device === expected.device && row.inode === expected.inode;
}
function executable(options: CodexCorpusWriteOptions): { path: string; sha256: string; size: number; assertCurrent(): void } {
  const command = options.codexCommand ?? "codex";
  if (typeof command !== "string" || !command || command.includes("\0") || (options.codexSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.codexSha256))) return fail();
  let found: string | undefined;
  if (isAbsolute(command)) found = command;
  else if (!command.includes(sep)) {
    found = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute).map(dir => join(dir, command)).find(candidate => {
      try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
    });
  }
  if (!found) return fail();
  const path = realpathSync(found), initial = statSync(path, { bigint: true });
  if (!initial.isFile() || (initial.mode & 0o022n) !== 0n || (initial.mode & 0o111n) === 0n
      || (initial.uid !== BigInt(process.getuid!()) && initial.uid !== 0n)) return fail();
  const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const digest = hash();
  if (options.codexSha256 && digest !== options.codexSha256) return fail();
  return { path, sha256: digest, size: Number(initial.size), assertCurrent() {
    const current = statSync(path, { bigint: true });
    if (realpathSync(found!) !== path || ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(key => initial[key as keyof typeof initial] !== current[key as keyof typeof current]) || hash() !== digest) fail();
  } };
}

/* Interim fallback for upstream Codex builds without `corpus-admission-inspect`.
 * Sunset: retire it in the first Skills release after the Harnesses
 * enrollment/inspect route is live for that Codex build line. It excludes only
 * Skills writers; upstream Codex refresh writes are not coordinated with it. */
const PROBE = { timeout: 5000, maxBuffer: 4096, killSignal: "SIGKILL" as const, encoding: "utf8" as const };
const UNRECOGNIZED = /^error: unrecognized subcommand 'corpus-admission-inspect'(?:\r?\n|$)/;
const VERSION = /^codex-cli (?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z-]{1,32}(?:\.[0-9A-Za-z-]{1,32}){0,7})?$/;
const LOCK_DIRECTORY = "codex-corpus-locks", PROBE_HOME = "codex-probe-home";
/** One descriptor per corpus root, shared by a transaction and its own nested native
 * client while the transaction is open; it closes only when every holder, including a
 * still-running child, releases it. */
interface Hold { lock: KernelLock; refs: number }
interface HoldRef { hold: Hold; released: boolean }
const retain = (hold: Hold): HoldRef => { hold.refs++; return { hold, released: false }; };
const release = (ref: HoldRef): void => { if (ref.released) return; ref.released = true; if (--ref.hold.refs === 0) ref.hold.lock.close(); };
/** Each enclosing lease's own share, so reuse ends when that lease closes. */
const enclosing = new AsyncLocalStorage<ReadonlyMap<string, HoldRef>>();
const leaseHolds = new WeakMap<CodexCorpusLease, ReadonlyMap<string, HoldRef>>();
const contains = (base: string, path: string): boolean => {
  const distance = relative(base, path);
  return distance === "" || (!distance.startsWith(`..${sep}`) && distance !== ".." && !isAbsolute(distance));
};

/** The current lock file and the legacy `.lock` entry both route native; neither may exist. */
function nativeLockAbsent(root: string): boolean {
  for (const name of [`${KEY}.flock-v1`, `${KEY}.lock`]) {
    try { lstatSync(join(root, name)); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return true;
}
/** Skills-owned state beside the Codex home's physical location, never under a
 * data-root override: `<realpath(dirname(root))>/.hasna/skills/<leaf>`. Every
 * component is validated before anything is created. */
function skillsState(root: string, leaf: string, roots: readonly string[]): { path: string; ensure(): string } {
  const chain = [realpathSync(dirname(root))];
  for (const part of [".hasna", "skills", leaf]) chain.push(join(chain.at(-1)!, part));
  const path = chain.at(-1)!;
  const uid = process.getuid!();
  const verify = () => {
    if (roots.some(item => contains(item, path)) || codexCorpusRootForPath(path) !== undefined) fail();
    // Ancestors above the parent use the kernel lock's own rule, so nothing is probed
    // or created where the lock would later refuse.
    for (let ancestor = dirname(chain[0]!); ; ancestor = dirname(ancestor)) {
      const stat = lstatSync(ancestor), sticky = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if (!stat.isDirectory() || (stat.uid !== uid && stat.uid !== 0) || ((stat.mode & 0o022) !== 0 && !sticky)) fail();
      if (dirname(ancestor) === ancestor) break;
    }
    for (const component of chain) {
      const stat = lstatSync(component, { throwIfNoEntry: false });
      if (!stat) return;
      if (!stat.isDirectory() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0 || (component === path && stat.uid !== uid)) fail();
    }
  };
  verify();
  return { path, ensure() {
    verify();
    for (const component of chain.slice(1)) {
      try { mkdirSync(component, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    verify();
    if (realpathSync(path) !== path) fail();
    return path;
  } };
}
/** Probes see only PATH, HOME and a private Skills-owned CODEX_HOME, so upstream's
 * per-launch helper aliases never land in a Codex home. */
function probe(path: string, args: string[], home: string, stdio: "pipe" | "ignore") {
  const env: Record<string, string> = { CODEX_HOME: home };
  for (const key of ["PATH", "HOME"]) if (process.env[key] !== undefined) env[key] = process.env[key]!;
  return spawnSync(path, args, { ...PROBE, cwd: home, env, stdio: ["ignore", stdio, stdio] });
}
/** Only the `help` form is probed: an upstream build treats an unknown leading word as a prompt. */
function probeAdmissionCommand(path: string, home: string): "absent" | "present" | "inconclusive" {
  const help = probe(path, ["help", "corpus-admission-inspect"], home, "pipe");
  if (help.error || help.signal !== null) return "inconclusive";
  if (help.status === 0) return "present";
  if (help.status !== 2 || help.stdout !== "" || typeof help.stderr !== "string" || !UNRECOGNIZED.test(help.stderr)) return "inconclusive";
  const control = probe(path, ["help", "exec"], home, "ignore");
  return !control.error && control.signal === null && control.status === 0 ? "absent" : "inconclusive";
}
function strictVersion(path: string, home: string): string | undefined {
  const result = probe(path, ["--version"], home, "pipe");
  if (result.error || result.signal !== null || result.status !== 0 || typeof result.stdout !== "string") return undefined;
  const line = result.stdout.replace(/\r?\n$/, "");
  return VERSION.test(line) ? line : undefined;
}
function rootLockKey(root: string, id: { device: string; inode: string }): string {
  return `codex-corpus-${createHash("sha256").update(`${root}\0${id.device}\0${id.inode}`).digest("hex")}`;
}

function acquireFallback(inputs: Array<{ input: string; root: string }>, options: CodexCorpusWriteOptions): CodexCorpusLease {
  let reason: CodexCorpusRefusal = "executable-unverified";
  const refs = new Map<string, HoldRef>(), held: Array<{ input: string; root: string; id: { device: string; inode: string }; ref: HoldRef }> = [];
  const close = () => { for (const ref of [...refs.values()].reverse()) release(ref); };
  try {
    const native = executable(options);
    reason = "skills-lock-unavailable";
    const roots = inputs.map(item => item.root);
    const locks = new Map(roots.map(root => [root, skillsState(root, LOCK_DIRECTORY, roots)]));
    const home = skillsState(roots[0]!, PROBE_HOME, roots).ensure();
    reason = "probe-inconclusive";
    const state = probeAdmissionCommand(native.path, home);
    if (state === "present") reason = "command-present";
    if (state !== "absent") fail();
    const version = strictVersion(native.path, home);
    if (version === undefined) fail();
    reason = "executable-unverified";
    native.assertCurrent();
    reason = "skills-lock-unavailable";
    for (const { input, root } of inputs) {
      // An alias and its physical path share one descriptor; both inputs stay rechecked.
      const id = identity(root), key = rootLockKey(root, id);
      if (!refs.has(key)) {
        const owner = enclosing.getStore()?.get(key);
        if (owner && !owner.released) refs.set(key, retain(owner.hold));
        else {
          const lock = new KernelLock(locks.get(root)!.ensure(), key, { mode: "exclusive" });
          refs.set(key, retain({ lock, refs: 0 }));
          if (!lock.trySync(1000)) { reason = "writer-busy"; fail(); }
        }
      }
      held.push({ input, root, id, ref: refs.get(key)! });
    }
    const assertCurrent = () => {
      try {
        for (const item of held) {
          if (item.ref.released) fail();
          item.ref.hold.lock.assertUnchanged();
          if (realpathSync(item.input) !== item.root || !sameIdentity(identity(item.root), item.id) || !nativeLockAbsent(item.root)) fail();
        }
        native.assertCurrent();
      } catch { fail("lease-changed"); }
    };
    reason = "lease-changed";
    assertCurrent();
    const lease: CodexCorpusLease = { assertCurrent, close, admission: { nativeAdmission: "unavailable", probe: {
      kind: "help-unrecognized-subcommand", executable: native.path, sha256: native.sha256, size: native.size, version: version!, probeExitCode: 2, controlExitCode: 0,
    } } };
    leaseHolds.set(lease, refs);
    return lease;
  } catch {
    close(); return fail(reason); // Never expose native diagnostics or corpus contents.
  }
}

export function acquireCodexCorpusWrite(roots: readonly string[], options: CodexCorpusWriteOptions, policy: CodexCorpusWritePolicy = {}): CodexCorpusLease {
  const held: Array<{ input: string; root: string; lock: KernelLock }> = [];
  const close = () => { for (const item of held.reverse()) item.lock.close(); };
  const assertCurrent = () => {
    for (const { input, root, lock } of held) {
      lock.assertUnchanged();
      if (realpathSync(input) !== root) fail();
    }
  };
  let fallback = false, refusal: CodexCorpusRefusal | undefined;
  try {
    if (roots.some(root => typeof root !== "string" || !isAbsolute(root) || root.includes("\0"))) fail();
    const inputs = [...new Set(roots)].map(input => ({ input, root: realpathSync(input) })).sort((a, b) => a.root.localeCompare(b.root));
    // Any existing lock entry, current or legacy and of any type, requires the native route.
    const absent = inputs.filter(({ root }) => nativeLockAbsent(root));
    if (absent.length && absent.length !== inputs.length) { refusal = "native-lock-present"; fail(); }
    if (absent.length && policy.fallback !== false) { fallback = true; return acquireFallback(inputs, options); }
    for (const { input, root } of inputs) {
      // Never bootstrap native enrollment. A lock-only tree is partial native state.
      const lock = new KernelLock(root, KEY, { mode: "shared", existingOnly: true });
      held.push({ input, root, lock });
      if (!lock.trySync(1000)) fail();
    }
    const native = executable(options);
    for (const { root } of held) {
      assertCurrent(); native.assertCurrent();
      const rootIdentity = identity(root), lockIdentity = identity(join(root, `${KEY}.flock-v1`));
      assertCurrent();
      const output = execFileSync(native.path, ["corpus-admission-inspect", "--home", root], {
        encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
      });
      native.assertCurrent(); assertCurrent();
      const status: unknown = JSON.parse(output);
      if (!status || typeof status !== "object" || Array.isArray(status)) fail();
      const row = status as Record<string, unknown>;
      if (Object.keys(row).sort().join(",") !== "lock,root,schema,state" || row.schema !== "codex-corpus-admission-status/v1"
          || (row.state !== "committed-v1" && row.state !== "committed-v2")
          || !sameIdentity(row.root, rootIdentity) || !sameIdentity(row.lock, lockIdentity)) fail();
    }
    return { assertCurrent, close, admission: { nativeAdmission: "verified" } };
  } catch (error) {
    if (fallback) throw error; // Already released and refused with a fixed reason.
    close(); return fail(refusal); // Never expose native diagnostics or corpus contents.
  }
}

function scoped<T>(lease: CodexCorpusLease, run: () => T): T {
  const holds = leaseHolds.get(lease);
  return holds?.size ? enclosing.run(new Map([...(enclosing.getStore() ?? []), ...holds]), run) : run();
}

/** Keep the descriptor through preimage checks, writes, rollback and readback. */
export function withCodexCorpusWrite<T>(roots: readonly string[], run: (assertCurrent: () => void, admission?: CodexCorpusAdmission) => T, options: CodexCorpusWriteOptions = {}, policy: CodexCorpusWritePolicy = {}): T {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options, policy);
  try { lease.assertCurrent(); const result = scoped(lease, () => run(lease.assertCurrent, lease.admission)); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}

/** The callback must await every native child's close before settling. */
export async function withCodexCorpusWriteAsync<T>(roots: readonly string[], run: (assertCurrent: () => void, admission?: CodexCorpusAdmission) => Promise<T>, options: CodexCorpusWriteOptions = {}, policy: CodexCorpusWritePolicy = {}): Promise<T> {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options, policy);
  try { lease.assertCurrent(); const result = await scoped(lease, () => run(lease.assertCurrent, lease.admission)); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}
