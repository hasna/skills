import type { Pointer } from "bun:ffi";

/**
 * Linux POSIX ACL absence check (SH-00084).
 *
 * Access ACLs change effective permissions independently of mode and group.
 * The guarded writers do not copy ACLs, so they require verified absence on
 * supported Linux/glibc. A default ACL initializes direct children at
 * creation, not existing descendants: query it only for directories where the
 * caller will create an object.
 *
 * Presence is queried only (size 0); no attribute value is read or copied.
 *
 * errno is thread-local and any later libc call on this thread, or a signal
 * handler that does not preserve it, can overwrite it. The probe therefore:
 * - resets errno immediately before each query,
 * - reads it as the very next step after the call, with nothing allocated in
 *   between (the call returns an immediate number, not a BigInt),
 * - re-queries a bounded number of times when the result is -1 with an errno
 *   other than the two "absent" answers, since a stray overwrite does not
 *   repeat while a genuine failure does. A persistent failure refuses.
 * A result other than -1 (the attribute exists, or an anomalous value) always
 * refuses at once and never depends on errno.
 */

/** ENODATA on the asm-generic errno table (Linux x86_64 and aarch64). */
export const LINUX_ENODATA = 61;
/** EOPNOTSUPP, which glibc also names ENOTSUP, on the asm-generic table. */
export const LINUX_EOPNOTSUPP = 95;
/** Queries per attribute before an unexplained failure refuses. */
export const LINUX_ACL_QUERY_ATTEMPTS = 4;

/**
 * Filesystems where an unsupported POSIX ACL attribute means the kernel
 * enforces no ACL at all (support compiled out, or mounted with noacl), so
 * mode and ownership are the whole access model. Network and FUSE filesystems
 * (NFSv4, SMB, 9p, FUSE and others) also answer EOPNOTSUPP while enforcing
 * their own ACLs or server-side access, so they stay unverified.
 */
export const LINUX_ACL_FREE_WHEN_UNSUPPORTED: ReadonlySet<bigint> = new Set([
  0xef53n, // ext2/ext3/ext4
  0x58465342n, // xfs
  0x9123683en, // btrfs
  0x01021994n, // tmpfs
]);

/** The raw operations, separable so tests can drive every errno path. */
export interface LinuxAclProbe {
  /** process.arch of the running binary; only asm-generic errno tables are admitted. */
  readonly arch: string;
  /** Thread-local errno of the calling thread, or null when it cannot be located. */
  readonly errno: { get(): number; set(value: number): void } | null;
  /** fgetxattr(fd, name, NULL, 0): the attribute size, or -1. */
  fgetxattr(fd: number, attribute: string): number | bigint;
  /** fstatfs(fd).f_type, or null when fstatfs fails. */
  filesystemType(fd: number): bigint | null;
}

type AttributeState = "absent" | "unsupported" | "unverified";

function queryAttribute(probe: LinuxAclProbe, errno: NonNullable<LinuxAclProbe["errno"]>, fd: number, attribute: string): AttributeState | "present" {
  for (let attempt = 0; attempt < LINUX_ACL_QUERY_ATTEMPTS; attempt++) {
    errno.set(0);
    const result = probe.fgetxattr(fd, attribute);
    // Capture errno before anything else can run on this thread.
    const code = errno.get();
    if (result !== -1) return "present";
    if (code === LINUX_ENODATA) return "absent";
    if (code === LINUX_EOPNOTSUPP) return "unsupported";
    // Any other errno, including 0, may be an overwrite or a real failure:
    // ask again; only a repeatable answer is trusted.
  }
  return "unverified";
}

/** True only when every queried POSIX ACL attribute is verifiably absent. */
export function linuxAccessAclAbsent(probe: LinuxAclProbe, fd: number, creationParent: boolean): boolean {
  if (probe.arch !== "x64" && probe.arch !== "arm64") return false;
  const errno = probe.errno;
  if (!errno) return false;
  let unsupported = false;
  for (const attribute of ["system.posix_acl_access", ...(creationParent ? ["system.posix_acl_default"] : [])]) {
    const state = queryAttribute(probe, errno, fd, attribute);
    if (state === "present" || state === "unverified") return false;
    if (state === "unsupported") unsupported = true;
  }
  if (!unsupported) return true;
  const type = probe.filesystemType(fd);
  return type !== null && LINUX_ACL_FREE_WHEN_UNSUPPORTED.has(type);
}

/** Run with the glibc probe; any loading or ABI failure refuses (false). */
export function withGlibcAclProbe(use: (probe: LinuxAclProbe) => boolean): boolean {
  try {
    const { dlopen, ptr, toArrayBuffer, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const library = dlopen("libc.so.6", {
      // i64_fast returns small values as immediate numbers: no allocation
      // (and so no collector activity) between the call and the errno read.
      fgetxattr: { args: ["i32", "ptr", "ptr", "u64"], returns: FFIType.i64_fast },
      fstatfs: { args: ["i32", "ptr"], returns: "i32" },
      __errno_location: { args: [], returns: "ptr" },
    });
    try {
      const location = library.symbols.__errno_location();
      const cell = location ? new Int32Array(toArrayBuffer(location as Pointer, 0, 4)) : null;
      const names = new Map<string, Buffer>();
      return use({
        arch: process.arch,
        errno: cell ? { get: () => cell[0]!, set: value => { cell[0] = value; } } : null,
        fgetxattr: (fd, attribute) => {
          let name = names.get(attribute);
          if (!name) names.set(attribute, name = Buffer.from(attribute + "\0"));
          return library.symbols.fgetxattr(fd, ptr(name), null, 0);
        },
        filesystemType: fd => {
          // struct statfs is 120 bytes on x86_64 and aarch64 glibc; f_type is
          // its first field, an unsigned long. Over-allocate for safety.
          const statfs = new BigUint64Array(32);
          return library.symbols.fstatfs(fd, ptr(statfs)) === 0 ? statfs[0]! : null;
        },
      });
    } finally { library.close(); }
  } catch { return false; }
}
