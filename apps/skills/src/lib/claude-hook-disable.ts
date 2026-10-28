import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fchownSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { KernelLock } from "@hasna/contracts/kernel-lock";
import { renderAgentHookCommand, AGENT_ADAPTERS } from "./agent-adapters.js";
import { parseNativeJsonObject, type NativeJsonValue } from "./claude-settings-witness.js";
import { directAliasTarget, safeParents, save, snapshot, unchanged } from "./codex-hook-trust-files.js";
import { assertNativePathAcl } from "./agent-integration.js";
import { resolveLauncherCommand } from "../cli/commands/runtime-launcher.js";

const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
function fail(reason: string): never { throw new Error(`CLAUDE_HOOK_DISABLE_${reason}`); }
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const events = AGENT_ADAPTERS.claude.events;
const object = (value: NativeJsonValue | undefined) => value?.kind === "object" ? value : undefined;
const field = (value: NativeJsonValue | undefined, key: string) => object(value)?.entries.find(([name]) => name === key)?.[1];
const string = (value: NativeJsonValue | undefined) => value?.kind === "string" ? value.value : undefined;
function serialize(value: NativeJsonValue): string {
  if (value.kind === "object") return `{${value.entries.map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`).join(",")}}`;
  if (value.kind === "array") return `[${value.items.map(serialize).join(",")}]`;
  return value.kind === "string" ? JSON.stringify(value.value) : value.value;
}
function path(value: string): void {
  if (!isAbsolute(value) || resolve(value) !== value || /[\x00-\x1f\x7f]/.test(value)) fail("PATH_INVALID");
}
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.uid}:${stat.gid}:${stat.mode}`;
const movedIdentity = (stat: BigIntStats) => `${identity(stat)}:${stat.nlink}:${stat.size}:${stat.mtimeNs}`;
function parents(file: string): () => void {
  safeParents(file);
  const observed: Array<[string, string]> = [];
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const stat = lstatSync(directory, { bigint: true });
    assertNativePathAcl(directory, stat, { allowDenyOnly: true, creationParent: directory === dirname(file) });
    observed.push([directory, identity(stat)]);
    if (directory === dirname(directory)) break;
  }
  return () => {
    safeParents(file);
    for (const [directory, expected] of observed) {
      const stat = lstatSync(directory, { bigint: true });
      if (identity(stat) !== expected) fail("PARENT_CHANGED");
      assertNativePathAcl(directory, stat, { allowDenyOnly: true, creationParent: directory === dirname(file) });
    }
  };
}
function executable(command: string, expectedSha256: string): () => void {
  path(command);
  if (!digest(expectedSha256)) fail("COMMAND_DIGEST_INVALID");
  const parentCheck = parents(command), alias = lstatSync(command, { bigint: true });
  const resolved = resolveLauncherCommand(command);
  if (alias.isSymbolicLink() && directAliasTarget(command) !== resolved.physical) fail("COMMAND_UNVERIFIED");
  const commandFile = snapshot(resolved.physical, false, { readOnlyPackage: true });
  if (commandFile.sha256 !== expectedSha256) fail("COMMAND_CHANGED");
  const entry = resolved.entry, packageRoot = dirname(dirname(entry));
  if (entry !== join(packageRoot, "bin", "index.js") || realpathSync(entry) !== entry) fail("COMMAND_UNVERIFIED");
  const entryFile = snapshot(entry, false, { readOnlyPackage: true });
  const manifest = snapshot(join(packageRoot, "package.json"), false, { readOnlyPackage: true });
  const parsed = parseNativeJsonObject(manifest.text);
  if (string(field(parsed, "name")) !== "@hasna/skills" || string(field(field(parsed, "bin"), "skills")) !== "bin/index.js") fail("COMMAND_UNVERIFIED");
  return () => {
    parentCheck();
    const current = lstatSync(command, { bigint: true });
    if (movedIdentity(current) !== movedIdentity(alias) || current.ctimeNs !== alias.ctimeNs
      || (alias.isSymbolicLink() && directAliasTarget(command) !== resolved.physical)) fail("COMMAND_CHANGED");
    unchanged(commandFile); unchanged(entryFile); unchanged(manifest);
  };
}

/** Exchange preserves the displaced entry too. It is deliberately not called CAS. */
function exchange(left: string, right: string, markExchanged: () => void): void {
  const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const a = Buffer.from(left + "\0"), b = Buffer.from(right + "\0");
  const RENAME_EXCHANGE_OR_SWAP = 2;
  if (process.platform === "linux") {
    const AT_FDCWD = -100;
    const library = dlopen("libc.so.6", { renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" } });
    try { if (library.symbols.renameat2(AT_FDCWD, ptr(a), AT_FDCWD, ptr(b), RENAME_EXCHANGE_OR_SWAP) !== 0) fail("EXCHANGE_UNAVAILABLE"); markExchanged(); }
    finally { library.close(); }
  } else if (process.platform === "darwin") {
    const library = dlopen("/usr/lib/libSystem.B.dylib", { renamex_np: { args: ["ptr", "ptr", "u32"], returns: "i32" } });
    try { if (library.symbols.renamex_np(ptr(a), ptr(b), RENAME_EXCHANGE_OR_SWAP) !== 0) fail("EXCHANGE_UNAVAILABLE"); markExchanged(); }
    finally { library.close(); }
  } else fail("EXCHANGE_UNAVAILABLE");
}

export interface ClaudeHookDisableOptions {
  settings: string;
  expectedSettingsSha256: string;
  expectedMode: "0600" | "absent";
  command: string;
  expectedCommandSha256: string;
  profile: string;
  apply?: boolean;
  /** New, exclusive, private directory. Its parent must already exist. */
  preimageDir?: string;
}
export interface ClaudeHookDisableResult {
  schema: "hasna.claude-hook-disable.v1";
  state: "preview" | "applied" | "no-op" | "no-data" | "ambiguous";
  mutationOccurred: boolean;
  target: string;
  beforeSha256: string | null;
  plannedAfterSha256: string | null;
  afterSha256: string | null;
  removed: Array<{ event: string; groupIndex: number; hookIndex: number }>;
  settingsWitness: "unchanged" | "not-renewed";
  preimage?: string;
  displaced?: string;
  receipt?: string;
  reason?: string;
}

/** Only removes exact rendered context registrations. Never installs, admits or rebinds. */
export function disableClaudeHooks(options: ClaudeHookDisableOptions): ClaudeHookDisableResult {
  if (options.apply !== undefined && typeof options.apply !== "boolean") fail("APPLY_INVALID");
  path(options.settings);
  if (basename(options.settings) !== "settings.json" || !["0600", "absent"].includes(options.expectedMode)
    || !(digest(options.expectedSettingsSha256) || options.expectedSettingsSha256 === "absent")) fail("TARGET_INVALID");
  const commands = new Map(events.map(event => [event, renderAgentHookCommand(options.command, "claude", options.profile, event)]));
  const checkCommand = executable(options.command, options.expectedCommandSha256), checkParents = parents(options.settings);
  const base: ClaudeHookDisableResult = { schema: "hasna.claude-hook-disable.v1", state: "no-data", mutationOccurred: false,
    target: options.settings, beforeSha256: null, plannedAfterSha256: null, afterSha256: null, removed: [], settingsWitness: "unchanged" };
  const exists = lstatSync(options.settings, { throwIfNoEntry: false });
  if (!exists) {
    if (options.expectedSettingsSha256 !== "absent" || options.expectedMode !== "absent") fail("TARGET_CHANGED");
    checkCommand(); checkParents();
    if (lstatSync(options.settings, { throwIfNoEntry: false })) fail("TARGET_CHANGED");
    return base;
  }
  const before = snapshot(options.settings, true);
  assertNativePathAcl(options.settings, before.stat);
  if (before.sha256 !== options.expectedSettingsSha256 || options.expectedMode !== "0600") fail("TARGET_CHANGED");
  const parsed = parseNativeJsonObject(before.text), hooks = field(parsed, "hooks");
  if (hooks !== undefined && !object(hooks)) fail("SETTINGS_INVALID");
  const removed: ClaudeHookDisableResult["removed"] = [];
  for (const event of events) {
    const groups = field(hooks, event);
    if (groups === undefined) continue;
    if (groups.kind !== "array") fail("SETTINGS_INVALID");
    groups.items = groups.items.flatMap((group, groupIndex) => {
      const handlers = field(group, "hooks");
      if (!object(group) || handlers?.kind !== "array") fail("SETTINGS_INVALID");
      const retained = handlers.items.filter((handler, hookIndex) => {
        const command = string(field(handler, "command"));
        if (command !== commands.get(event)) {
          // Detection can refuse a near match, but never authorizes removal.
          if (command?.startsWith(commands.get(event)!.split(" --selection-profile ")[0]!)) fail("REGISTRATION_AMBIGUOUS");
          return true;
        }
        const row = object(handler);
        if (!row || row.entries.map(([key]) => key).sort().join(",") !== "command,timeout,type"
          || string(field(handler, "type")) !== "command" || field(handler, "timeout")?.kind !== "number"
          || (field(handler, "timeout") as { value: string }).value !== "15") fail("REGISTRATION_AMBIGUOUS");
        removed.push({ event, groupIndex, hookIndex }); return false;
      });
      if (retained.length === handlers.items.length) return [group];
      handlers.items = retained;
      // Only a newly empty, exclusively owned container is removed.
      return !retained.length && object(group)!.entries.length === 1 ? [] : [group];
    });
  }
  const after = removed.length ? `${serialize(parsed)}\n` : before.text;
  const result: ClaudeHookDisableResult = { ...base, state: removed.length ? "preview" : "no-op", beforeSha256: before.sha256,
    plannedAfterSha256: hash(after), afterSha256: removed.length ? null : before.sha256, removed, settingsWitness: removed.length ? "not-renewed" : "unchanged" };
  checkCommand(); checkParents(); unchanged(before);
  if (!options.apply || !removed.length) return result;
  if (!options.preimageDir) fail("PREIMAGE_REQUIRED");
  path(options.preimageDir);
  if (options.preimageDir === options.settings || options.preimageDir.startsWith(options.settings + "/")) fail("PREIMAGE_INVALID");
  const checkPreimageParents = parents(options.preimageDir);
  const lock = new KernelLock(dirname(options.settings), "skills-claude-hook-disable", { mode: "exclusive" });
  let exchanged = false, preimage: string | undefined, displaced: string | undefined, receipt: string | undefined;
  try {
    if (!lock.trySync(1000)) fail("LOCK_BUSY");
    lock.assertUnchanged(); checkCommand(); checkParents(); checkPreimageParents(); unchanged(before);
    mkdirSync(options.preimageDir, { mode: 0o700 });
    if ((lstatSync(options.preimageDir).mode & 0o777) !== 0o700) fail("PREIMAGE_INVALID");
    preimage = join(options.preimageDir, "settings.preimage.json");
    save(preimage, before.bytes);
    const preserved = snapshot(preimage, true), checkPreservationRoot = parents(preimage);
    if (preserved.sha256 !== before.sha256 || !preserved.bytes.equals(before.bytes)) fail("PRESERVATION_FAILED");
    displaced = join(dirname(options.settings), `.settings.skills-disable-${randomUUID()}.json`);
    save(displaced, after);
    const fd = openSync(displaced, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fchownSync(fd, Number(before.stat.uid), Number(before.stat.gid)); fchmodSync(fd, 0o600); fsyncSync(fd); }
    finally { closeSync(fd); }
    const staged = snapshot(displaced, true);
    assertNativePathAcl(displaced, staged.stat);
    if (staged.sha256 !== result.plannedAfterSha256) fail("STAGING_CHANGED");
    receipt = join(options.preimageDir, "receipt.json");
    const preparationBytes = `${JSON.stringify({ ...result, state: "prepared", preimage, displaced, commandSha256: options.expectedCommandSha256,
      commandPathSha256: hash(options.command), profileSha256: hash(options.profile) })}\n`;
    save(receipt, preparationBytes);
    if (snapshot(receipt, true).sha256 !== hash(preparationBytes)) fail("RECEIPT_CHANGED");
    lock.assertUnchanged(); checkCommand(); checkParents(); checkPreimageParents(); unchanged(before); checkPreservationRoot(); unchanged(preserved); unchanged(staged);
    exchange(displaced, options.settings, () => { exchanged = true; });
    const displacedOriginal = snapshot(displaced, true), current = snapshot(options.settings, true);
    assertNativePathAcl(displaced, displacedOriginal.stat); assertNativePathAcl(options.settings, current.stat);
    checkParents(); checkPreimageParents(); lock.assertUnchanged(); checkCommand(); checkPreservationRoot(); unchanged(preserved);
    if (movedIdentity(displacedOriginal.stat) !== movedIdentity(before.stat) || displacedOriginal.sha256 !== before.sha256
      || movedIdentity(current.stat) !== movedIdentity(staged.stat) || current.sha256 !== staged.sha256) fail("POST_WRITE_CHANGED");
    const directory = openSync(dirname(options.settings), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    const applied = { ...result, state: "applied" as const, mutationOccurred: true, afterSha256: staged.sha256, preimage, displaced, receipt };
    // An exclusive completion receipt avoids rewriting any preserved evidence.
    const completed = join(options.preimageDir, "completed.json");
    const completionBytes = `${JSON.stringify({ ...applied, receipt: completed })}\n`;
    save(completed, completionBytes);
    if (snapshot(completed, true).sha256 !== hash(completionBytes)) fail("RECEIPT_CHANGED");
    unchanged(current); unchanged(displacedOriginal);
    receipt = completed;
    return { ...applied, receipt };
  } catch (error) {
    if (!exchanged) throw error;
    return { ...result, state: "ambiguous", mutationOccurred: true, preimage, displaced, receipt,
      reason: "POST_EXCHANGE_VERIFICATION_FAILED" };
  } finally {
    try { lock.close(); } catch (error) {
      if (!exchanged) throw error;
      return { ...result, state: "ambiguous", mutationOccurred: true, preimage, displaced, receipt, reason: "POST_EXCHANGE_LOCK_CLOSE_FAILED" };
    }
  }
}
