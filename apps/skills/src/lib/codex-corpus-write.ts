import { KernelLock } from "@hasna/contracts/kernel-lock";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDataDir } from "./config.js";

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

/** The build-level evidence behind a fallback write. Never contains native output. */
export interface CodexAdmissionProbe {
  kind: "help-unrecognized-subcommand";
  executable: string;
  sha256: string;
  size: number;
  version: string | null;
  probeExitCode: 2;
  controlExitCode: 0;
}
export interface CodexCorpusAdmission { nativeAdmission: "verified" | "unavailable"; probe?: CodexAdmissionProbe }
export interface CodexAdmissionReceipt { nativeAdmission?: "unavailable"; nativeAdmissionProbe?: CodexAdmissionProbe }
export interface CodexCorpusLease { assertCurrent(): void; close(): void; admission: CodexCorpusAdmission }

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
const VERSION = /^codex-cli [0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,31})?$/;
const LOCK_DIRECTORY = "codex-corpus-locks";
/** Fallback locks held by the enclosing transaction, so its own nested native client can reuse them. */
const enclosing = new AsyncLocalStorage<ReadonlyMap<string, KernelLock>>();
const leaseLocks = new WeakMap<CodexCorpusLease, ReadonlyMap<string, KernelLock>>();

function nativeLockAbsent(root: string): boolean {
  try { lstatSync(join(root, `${KEY}.flock-v1`)); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
/** Only the `help` form is probed: an upstream build treats an unknown leading word as a prompt. */
function probeAdmissionCommand(path: string): "absent" | "present" | "inconclusive" {
  const help = spawnSync(path, ["help", "corpus-admission-inspect"], { ...PROBE, stdio: ["ignore", "pipe", "pipe"] });
  if (help.error || help.signal !== null) return "inconclusive";
  if (help.status === 0) return "present";
  if (help.status !== 2 || help.stdout !== "" || typeof help.stderr !== "string" || !UNRECOGNIZED.test(help.stderr)) return "inconclusive";
  const control = spawnSync(path, ["help", "exec"], { ...PROBE, stdio: "ignore" });
  return !control.error && control.signal === null && control.status === 0 ? "absent" : "inconclusive";
}
function boundedVersion(path: string): string | null {
  const result = spawnSync(path, ["--version"], { ...PROBE, stdio: ["ignore", "pipe", "ignore"] });
  if (result.error || result.signal !== null || result.status !== 0 || typeof result.stdout !== "string") return null;
  const line = result.stdout.replace(/\r?\n$/, "");
  return VERSION.test(line) ? line : null;
}
function rootLockKey(root: string, id: { device: string; inode: string }): string {
  return `codex-corpus-${createHash("sha256").update(`${root}\0${id.device}\0${id.inode}`).digest("hex")}`;
}

function acquireFallback(inputs: Array<{ input: string; root: string }>, options: CodexCorpusWriteOptions): CodexCorpusLease {
  let reason: CodexCorpusRefusal = "executable-unverified";
  const held: Array<{ input: string; root: string; id: { device: string; inode: string }; lock: KernelLock; owned: boolean }> = [];
  const close = () => { for (const item of held.reverse()) if (item.owned) item.lock.close(); };
  try {
    const native = executable(options);
    reason = "probe-inconclusive";
    const state = probeAdmissionCommand(native.path);
    if (state === "present") reason = "command-present";
    if (state !== "absent") fail();
    const version = boundedVersion(native.path);
    native.assertCurrent();
    reason = "skills-lock-unavailable";
    const directory = join(getDataDir(), LOCK_DIRECTORY);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const physicalDirectory = realpathSync(directory);
    for (const { input, root } of inputs) {
      // The Skills lock never lives in, or creates anything under, the Codex corpus.
      const distance = relative(root, physicalDirectory);
      if (distance === "" || (!distance.startsWith(`..${sep}`) && distance !== ".." && !isAbsolute(distance))) fail();
      const id = identity(root), key = rootLockKey(root, id), outer = enclosing.getStore()?.get(key);
      if (outer) { held.push({ input, root, id, lock: outer, owned: false }); continue; }
      const lock = new KernelLock(directory, key, { mode: "exclusive" });
      held.push({ input, root, id, lock, owned: true });
      if (!lock.trySync(1000)) { reason = "writer-busy"; fail(); }
    }
    const assertCurrent = () => {
      try {
        for (const item of held) {
          item.lock.assertUnchanged();
          if (realpathSync(item.input) !== item.root || !sameIdentity(identity(item.root), item.id) || !nativeLockAbsent(item.root)) fail();
        }
        native.assertCurrent();
      } catch { fail("lease-changed"); }
    };
    reason = "lease-changed";
    assertCurrent();
    const lease: CodexCorpusLease = { assertCurrent, close, admission: { nativeAdmission: "unavailable", probe: {
      kind: "help-unrecognized-subcommand", executable: native.path, sha256: native.sha256, size: native.size, version, probeExitCode: 2, controlExitCode: 0,
    } } };
    leaseLocks.set(lease, new Map(held.filter(item => item.owned).map(item => [rootLockKey(item.root, item.id), item.lock])));
    return lease;
  } catch {
    close(); return fail(reason); // Never expose native diagnostics or corpus contents.
  }
}

export function acquireCodexCorpusWrite(roots: readonly string[], options: CodexCorpusWriteOptions): CodexCorpusLease {
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
    // Any existing lock entry, of any type, requires the native route.
    const absent = inputs.filter(({ root }) => nativeLockAbsent(root));
    if (absent.length && absent.length !== inputs.length) { refusal = "native-lock-present"; fail(); }
    if (absent.length) { fallback = true; return acquireFallback(inputs, options); }
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
  const locks = leaseLocks.get(lease);
  return locks?.size ? enclosing.run(new Map([...(enclosing.getStore() ?? []), ...locks]), run) : run();
}

/** Keep the descriptor through preimage checks, writes, rollback and readback. */
export function withCodexCorpusWrite<T>(roots: readonly string[], run: (assertCurrent: () => void, admission?: CodexCorpusAdmission) => T, options: CodexCorpusWriteOptions = {}): T {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options);
  try { lease.assertCurrent(); const result = scoped(lease, () => run(lease.assertCurrent, lease.admission)); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}

/** The callback must await every native child's close before settling. */
export async function withCodexCorpusWriteAsync<T>(roots: readonly string[], run: (assertCurrent: () => void, admission?: CodexCorpusAdmission) => Promise<T>, options: CodexCorpusWriteOptions = {}): Promise<T> {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options);
  try { lease.assertCurrent(); const result = await scoped(lease, () => run(lease.assertCurrent, lease.admission)); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}
