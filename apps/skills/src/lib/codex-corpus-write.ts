import { KernelLock } from "@hasna/contracts/kernel-lock";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const KEY = ".native-corpus-admission";
const fail = (): never => { throw new Error("CODEX_CORPUS_ADMISSION_REQUIRED: verified native admission and its existing shared lock are required"); };

export interface CodexCorpusWriteOptions {
  /** The selected native executable; never a shell command. */
  codexCommand?: string;
  /** Existing callers with a reviewed executable binding retain that binding. */
  codexSha256?: string;
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
function executable(options: CodexCorpusWriteOptions): { path: string; assertCurrent(): void } {
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
  return { path, assertCurrent() {
    const current = statSync(path, { bigint: true });
    if (realpathSync(found!) !== path || ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(key => initial[key as keyof typeof initial] !== current[key as keyof typeof current]) || hash() !== digest) fail();
  } };
}

export function acquireCodexCorpusWrite(roots: readonly string[], options: CodexCorpusWriteOptions) {
  const held: Array<{ input: string; root: string; lock: KernelLock }> = [];
  const close = () => { for (const item of held.reverse()) item.lock.close(); };
  const assertCurrent = () => {
    for (const { input, root, lock } of held) {
      lock.assertUnchanged();
      if (realpathSync(input) !== root) fail();
    }
  };
  try {
    if (roots.some(root => typeof root !== "string" || !isAbsolute(root) || root.includes("\0"))) fail();
    const inputs = [...new Set(roots)].map(input => ({ input, root: realpathSync(input) })).sort((a, b) => a.root.localeCompare(b.root));
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
    return { assertCurrent, close };
  } catch {
    close(); return fail(); // Never expose native diagnostics or corpus contents.
  }
}

/** Keep the descriptor through preimage checks, writes, rollback and readback. */
export function withCodexCorpusWrite<T>(roots: readonly string[], run: (assertCurrent: () => void) => T, options: CodexCorpusWriteOptions = {}): T {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options);
  try { lease.assertCurrent(); const result = run(lease.assertCurrent); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}

/** The callback must await every native child's close before settling. */
export async function withCodexCorpusWriteAsync<T>(roots: readonly string[], run: (assertCurrent: () => void) => Promise<T>, options: CodexCorpusWriteOptions = {}): Promise<T> {
  if (!roots.length) return run(() => {});
  const lease = acquireCodexCorpusWrite(roots, options);
  try { lease.assertCurrent(); const result = await run(lease.assertCurrent); lease.assertCurrent(); return result; }
  finally { lease.close(); }
}
