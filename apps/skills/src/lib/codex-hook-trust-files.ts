import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, writeFileSync, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export function need(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`CODEX_HOOK_TRUST_${code}`);
}
const sameStat = (a: BigIntStats, b: BigIntStats) => ["dev", "ino", "uid", "nlink", "mode", "size", "mtimeNs", "ctimeNs"].every(key => a[key as keyof BigIntStats] === b[key as keyof BigIntStats]);
function safeParents(file: string): void {
  for (let p = dirname(file); ; p = dirname(p)) {
    const s = lstatSync(p);
    need(s.isDirectory() && !s.isSymbolicLink(), "UNSAFE_PARENT");
    // A system temporary directory is safe only with the sticky bit. Every
    // other ancestor must prevent replacement by another account.
    need((s.mode & 0o022) === 0 || (s.uid === 0 && (s.mode & 0o1000) !== 0), "UNSAFE_PARENT");
    if (dirname(p) === p) break;
  }
}
// Bun may hardlink installed package artifacts to its cache. Only explicitly
// admitted read-only package witnesses allow this; private state stays single-link.
export function snapshot(file: string, privateFile = false, options: { readOnlyPackage?: true } = {}) {
  const readOnlyPackage = options.readOnlyPackage === true && !privateFile;
  safeParents(file);
  const initial = lstatSync(file, { bigint: true });
  need(initial.isFile() && initial.uid === BigInt(process.getuid!()) && (initial.nlink === 1n || (readOnlyPackage && initial.nlink > 1n)) && (initial.mode & 0o022n) === 0n && (!privateFile || (initial.mode & 0o777n) === 0o600n), "UNSAFE_FILE");
  need(initial.size <= 8n * 1024n * 1024n, "FILE_BOUND");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true }); need(sameStat(initial, before), "INPUT_CHANGED");
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n;
    }
    need(length === Number(before.size) && sameStat(before, fstatSync(fd, { bigint: true })) && sameStat(before, lstatSync(file, { bigint: true })), "INPUT_CHANGED");
    const content = bytes.subarray(0, length), text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return { file, privateFile, readOnlyPackage, text, bytes: content, stat: before, sha256: createHash("sha256").update(content).digest("hex") };
  } finally { closeSync(fd); }
}
export function unchanged(before: ReturnType<typeof snapshot>): void {
  const after = snapshot(before.file, before.privateFile, before.readOnlyPackage ? { readOnlyPackage: true } : {});
  need(sameStat(before.stat, after.stat) && after.sha256 === before.sha256, "INPUT_CHANGED");
}
export function save(file: string, content: string | Buffer): void {
  safeParents(file);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
