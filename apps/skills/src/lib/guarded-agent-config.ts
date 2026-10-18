import { randomUUID } from "node:crypto";
import fs, { type BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNativePathAcl, canonicalSystemPath } from "./agent-integration.js";

type Refusal = "UNSAFE_PATH" | "OWNERSHIP_UNAVAILABLE" | "LOCKED" | "INVALID_CONFIG" | "BACKUP_FAILED"
  | "WRITE_FAILED" | "CONFIG_CHANGED" | "VERIFY_FAILED" | "ACCESS_METADATA_UNAVAILABLE";
const messages: Record<Refusal, string> = {
  ACCESS_METADATA_UNAVAILABLE: "configuration access metadata could not be verified or preserved",
  UNSAFE_PATH: "refused an unsafe or unowned configuration path",
  OWNERSHIP_UNAVAILABLE: "configuration ownership cannot be verified on this platform",
  LOCKED: "configuration is locked; no foreign lock was removed",
  INVALID_CONFIG: "existing configuration is invalid",
  BACKUP_FAILED: "could not preserve and verify the original configuration",
  WRITE_FAILED: "could not prepare the replacement configuration",
  CONFIG_CHANGED: "configuration or its path changed during registration",
  VERIFY_FAILED: "could not verify the committed configuration; retain the backup for recovery",
};

class ConfigWriteRefusal extends Error {
  constructor(readonly code: Refusal) { super(messages[code]); }
}

export function guardedAgentConfigRefusal(error: unknown): string {
  return error instanceof ConfigWriteRefusal ? error.message : "configuration update was refused";
}

type Snapshot = { bytes: Buffer; info: BigIntStats };
const owner = () => BigInt(process.getuid!());
const sameNode = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode && a.nlink === b.nlink;

function statOrMissing(path: string): BigIntStats | null {
  try { return fs.lstatSync(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function readSnapshot(path: string): Snapshot | null {
  const entry = statOrMissing(path);
  if (entry === null) return null;
  if (!entry.isFile() || entry.uid !== owner() || entry.nlink !== 1n || (entry.mode & 0o7000n) !== 0n
    || entry.size > 16n * 1024n * 1024n) throw new Error();
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!sameNode(entry, before)) throw new Error();
    // This writer does not copy file ACLs: refuse any extended file ACL,
    // including deny entries, before preserving or replacing its bytes.
    assertNativePathAcl(path, before, { descriptor: fd });
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), latest = statOrMissing(path);
    if (!latest || !sameNode(before, after) || !sameNode(after, latest)
      || after.size !== latest.size || after.mtimeNs !== latest.mtimeNs || after.ctimeNs !== latest.ctimeNs
      || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== after.size) throw new Error();
    return { bytes, info: after };
  } finally { fs.closeSync(fd); }
}

function unchanged(before: Snapshot | null, current: Snapshot | null): boolean {
  return before === null ? current === null : current !== null
    && sameNode(before.info, current.info) && before.info.mtimeNs === current.info.mtimeNs
    && before.info.ctimeNs === current.info.ctimeNs && before.bytes.equals(current.bytes);
}

function parentWitnesses(path: string): Array<{ path: string; info: BigIntStats }> {
  const home = canonicalSystemPath(homedir()), local = relative(home, path);
  const creationParent = dirname(path);
  if (!isAbsolute(path) || resolve(path) !== path || !local || local === ".." || local.startsWith(".." + sep)) throw new Error();
  const parents: string[] = [];
  for (let ancestor = home; ; ancestor = dirname(ancestor)) {
    parents.unshift(ancestor);
    if (ancestor === dirname(ancestor)) break;
  }
  for (const part of relative(home, dirname(path)).split(sep).filter(Boolean)) parents.push(join(parents[parents.length - 1]!, part));
  return parents.map(path => {
    if (!statOrMissing(path)) {
      if (!path.startsWith(home + sep)) throw new Error();
      // Only the immediate parent initializes the new directory's ACL.
      const parent = dirname(path);
      assertNativePathAcl(parent, fs.lstatSync(parent, { bigint: true }), { allowDenyOnly: true, creationParent: true });
      fs.mkdirSync(path, { mode: 0o700 });
    }
    const info = fs.lstatSync(path, { bigint: true });
    const privatePath = path === home || path.startsWith(home + sep);
    const stickySystemParent = !privatePath && info.uid === 0n && (info.mode & 0o1000n) !== 0n;
    if (!info.isDirectory() || (privatePath ? info.uid !== owner() : info.uid !== owner() && info.uid !== 0n)
      || ((info.mode & 0o022n) !== 0n && !stickySystemParent)) throw new Error();
    assertNativePathAcl(path, info, { allowDenyOnly: true, creationParent: path === creationParent });
    return { path, info };
  });
}

function verifyParents(parents: Array<{ path: string; info: BigIntStats }>) {
  for (const parent of parents) {
    const current = fs.lstatSync(parent.path, { bigint: true });
    if (!current.isDirectory() || parent.info.dev !== current.dev || parent.info.ino !== current.ino
      || parent.info.uid !== current.uid || parent.info.gid !== current.gid || parent.info.mode !== current.mode) throw new Error();
    assertNativePathAcl(parent.path, current, { allowDenyOnly: true, creationParent: parent === parents[parents.length - 1] });
  }
}

function durableFile(path: string, bytes: Buffer, mode: number, gid?: bigint): Snapshot {
  const parent = dirname(path);
  assertNativePathAcl(parent, fs.lstatSync(parent, { bigint: true }), { allowDenyOnly: true, creationParent: true });
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const created = fs.fstatSync(fd, { bigint: true });
    // Inherited ACLs can grant access despite 0600. Admit the empty file before
    // any sensitive content, then recheck after group/mode preparation.
    assertNativePathAcl(path, created, { descriptor: fd });
    if (gid !== undefined && created.gid !== gid) {
      if (!Number.isSafeInteger(Number(gid))) throw new Error();
      fs.fchownSync(fd, -1, Number(gid));
    }
    fs.fchmodSync(fd, mode);
    const prepared = fs.fstatSync(fd, { bigint: true });
    if (prepared.uid !== owner() || (gid !== undefined && prepared.gid !== gid)
      || Number(prepared.mode & 0o777n) !== mode) throw new Error();
    assertNativePathAcl(path, prepared, { descriptor: fd });
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
  }
  finally { fs.closeSync(fd); }
  const saved = readSnapshot(path);
  if (!saved || !saved.bytes.equals(bytes) || Number(saved.info.mode & 0o777n) !== mode
    || (gid !== undefined && saved.info.gid !== gid)) throw new Error();
  return saved;
}

/** One transaction for the direct-file adapters. Failed evidence stays beside the original. */
export function guardedAgentConfigWrite(path: string, transform: (current: Buffer | null) => string): void {
  let refusal: Refusal = "UNSAFE_PATH", lock: { path: string; info: BigIntStats } | undefined;
  try {
    refusal = "OWNERSHIP_UNAVAILABLE";
    if (typeof process.getuid !== "function") throw new Error();
    refusal = "UNSAFE_PATH";
    if (!isAbsolute(path) || resolve(path) !== path) throw new Error();
    // Reuse the owning macOS alias/ACL verifier; never hide arbitrary symlinks.
    path = canonicalSystemPath(path);
    const parents = parentWitnesses(path);
    refusal = "LOCKED";
    const lockPath = path + ".skills-mcp.lock";
    fs.mkdirSync(lockPath, { mode: 0o700 });
    lock = { path: lockPath, info: fs.lstatSync(lockPath, { bigint: true }) };
    if (!lock.info.isDirectory() || lock.info.uid !== owner()) throw new Error();
    refusal = "UNSAFE_PATH";
    const original = readSnapshot(path);
    refusal = "BACKUP_FAILED";
    if (original) durableFile(path + ".skills-mcp-" + randomUUID() + ".backup", original.bytes, 0o600);
    refusal = "INVALID_CONFIG";
    const content = transform(original?.bytes ?? null);
    const next = Buffer.from(content.endsWith("\n") ? content : content + "\n");
    if (next.length > 16 * 1024 * 1024) throw new Error();
    refusal = "WRITE_FAILED";
    const temporary = path + ".skills-mcp-" + randomUUID() + ".tmp";
    const mode = original ? Number(original.info.mode & 0o777n) : 0o600;
    const prepared = durableFile(temporary, next, mode, original?.info.gid);
    refusal = "CONFIG_CHANGED";
    verifyParents(parents);
    const currentLock = fs.lstatSync(lock.path, { bigint: true });
    if (!sameNode(lock.info, currentLock) || !unchanged(original, readSnapshot(path))) throw new Error();
    fs.renameSync(temporary, path);
    refusal = "VERIFY_FAILED";
    const directory = fs.openSync(dirname(path), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    const committed = readSnapshot(path);
    if (!committed || !sameNode(prepared.info, committed.info) || !committed.bytes.equals(next)) throw new Error();
  } catch (error) {
    throw new ConfigWriteRefusal(error instanceof Error && error.message === "NATIVE_PATH_ACL_UNVERIFIED" ? "ACCESS_METADATA_UNAVAILABLE" : refusal);
  }
  finally {
    // Only release the exact directory this invocation created; never recover a foreign lock.
    if (lock) {
      const current = statOrMissing(lock.path);
      if (current?.isDirectory() && sameNode(lock.info, current)) fs.rmdirSync(lock.path);
    }
  }
}
