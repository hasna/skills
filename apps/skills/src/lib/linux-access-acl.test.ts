import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LINUX_ACL_QUERY_ATTEMPTS, LINUX_ENODATA, LINUX_EOPNOTSUPP, linuxAccessAclAbsent, type LinuxAclProbe,
} from "./linux-access-acl.js";

const EINTR = 4, EIO = 5, EBADF = 9, EXT4 = 0xef53n, NFS = 0x6969n, FUSE = 0x65735546n;

type Answer = { result: number | bigint; errno?: number; clobber?: number };

/** A fake libc: each fgetxattr call consumes the next scripted answer for its
 * attribute, sets errno like glibc (only on failure) and may then overwrite it,
 * as a signal handler or a later libc call on this thread would. */
function fakeProbe(script: Record<string, Answer[]>, options: { arch?: string; errno?: boolean; filesystem?: bigint | null } = {}) {
  let errno = 0;
  const events: string[] = [];
  const probe: LinuxAclProbe = {
    arch: options.arch ?? "x64",
    errno: options.errno === false ? null : {
      get: () => { events.push(`get:${errno}`); return errno; },
      set: value => { events.push(`set:${value}`); errno = value; },
    },
    fgetxattr: (fd, attribute) => {
      expect(fd).toBe(7);
      const answer = script[attribute]?.shift();
      if (!answer) throw new Error(`unscripted query: ${attribute}`);
      events.push(`fgetxattr:${attribute}`);
      if ((answer.result === -1 || answer.result === -1n) && answer.errno !== undefined) errno = answer.errno;
      if (answer.clobber !== undefined) errno = answer.clobber;
      return answer.result;
    },
    filesystemType: fd => { expect(fd).toBe(7); events.push("fstatfs"); return options.filesystem === undefined ? EXT4 : options.filesystem; },
  };
  return { probe, events, remaining: () => Object.values(script).reduce((sum, answers) => sum + answers.length, 0) };
}

const access = "system.posix_acl_access", defaults = "system.posix_acl_default";
const noData: Answer = { result: -1, errno: LINUX_ENODATA };
const unsupported: Answer = { result: -1, errno: LINUX_EOPNOTSUPP };

describe("Linux POSIX ACL absence (SH-00084)", () => {
  test("no ACL: ENODATA for the access ACL, and for the default ACL on a creation parent", () => {
    const file = fakeProbe({ [access]: [noData] });
    expect(linuxAccessAclAbsent(file.probe, 7, false)).toBe(true);
    expect(file.events).toEqual(["set:0", `fgetxattr:${access}`, `get:${LINUX_ENODATA}`]);
    const parent = fakeProbe({ [access]: [noData], [defaults]: [noData] });
    expect(linuxAccessAclAbsent(parent.probe, 7, true)).toBe(true);
    expect(parent.remaining()).toBe(0);
  });

  test("ACL present: any non-negative size refuses at once, whatever errno says", () => {
    for (const result of [0, 28, 44n]) {
      const fake = fakeProbe({ [access]: [{ result, clobber: LINUX_ENODATA }] });
      expect(linuxAccessAclAbsent(fake.probe, 7, false)).toBe(false);
      expect(fake.events.filter(event => event.startsWith("fgetxattr"))).toHaveLength(1);
    }
    const defaultAcl = fakeProbe({ [access]: [noData], [defaults]: [{ result: 44 }] });
    expect(linuxAccessAclAbsent(defaultAcl.probe, 7, true)).toBe(false);
    // An anomalous negative result is not "absent" either.
    expect(linuxAccessAclAbsent(fakeProbe({ [access]: [{ result: -2, errno: LINUX_ENODATA }] }).probe, 7, false)).toBe(false);
  });

  test("ENOTSUP filesystem: no ACL only where the kernel then enforces none", () => {
    for (const filesystem of [EXT4, 0x58465342n, 0x9123683en, 0x01021994n]) {
      const fake = fakeProbe({ [access]: [unsupported], [defaults]: [unsupported] }, { filesystem });
      expect(linuxAccessAclAbsent(fake.probe, 7, true)).toBe(true);
    }
    // NFSv4, FUSE and an unreadable filesystem type can enforce access a
    // POSIX ACL query cannot see: they stay unverified.
    for (const filesystem of [NFS, FUSE, null]) {
      const fake = fakeProbe({ [access]: [unsupported] }, { filesystem });
      expect(linuxAccessAclAbsent(fake.probe, 7, false)).toBe(false);
    }
    // ENODATA on an ACL-capable filesystem never needs the filesystem type.
    const plain = fakeProbe({ [access]: [noData] }, { filesystem: NFS });
    expect(linuxAccessAclAbsent(plain.probe, 7, false)).toBe(true);
    expect(plain.events).not.toContain("fstatfs");
  });

  test("a genuine failure still fails closed after the bounded re-queries", () => {
    for (const errno of [EIO, EBADF, EINTR, 0]) {
      const fake = fakeProbe({ [access]: Array.from({ length: LINUX_ACL_QUERY_ATTEMPTS }, () => ({ result: -1, errno })) });
      expect(linuxAccessAclAbsent(fake.probe, 7, false)).toBe(false);
      expect(fake.remaining()).toBe(0);
    }
    const parent = fakeProbe({ [access]: [noData], [defaults]: Array.from({ length: LINUX_ACL_QUERY_ATTEMPTS }, () => ({ result: -1, errno: EIO })) });
    expect(linuxAccessAclAbsent(parent.probe, 7, true)).toBe(false);
  });

  test("errno clobbering: errno is reset before and read straight after each call, and an overwrite is re-queried", () => {
    // ENODATA overwritten by EINTR before the read: the next query answers truly.
    const clobbered = fakeProbe({ [access]: [{ result: -1, errno: LINUX_ENODATA, clobber: EINTR }, noData] });
    expect(linuxAccessAclAbsent(clobbered.probe, 7, false)).toBe(true);
    expect(clobbered.events).toEqual([
      "set:0", `fgetxattr:${access}`, `get:${EINTR}`,
      "set:0", `fgetxattr:${access}`, `get:${LINUX_ENODATA}`,
    ]);
    // A stale ENODATA left by the previous call never answers for a later
    // failure that did not set errno: the reset makes it read as 0.
    const stale = fakeProbe({ [access]: [noData], [defaults]: Array.from({ length: LINUX_ACL_QUERY_ATTEMPTS }, () => ({ result: -1 })) });
    expect(linuxAccessAclAbsent(stale.probe, 7, true)).toBe(false);
    // Overwrites never turn a present ACL into "absent".
    const present = fakeProbe({ [access]: [{ result: 28, clobber: LINUX_ENODATA }] });
    expect(linuxAccessAclAbsent(present.probe, 7, false)).toBe(false);
    // Overwritten on every attempt: refuse.
    const always = fakeProbe({ [access]: Array.from({ length: LINUX_ACL_QUERY_ATTEMPTS }, () => ({ result: -1, errno: LINUX_ENODATA, clobber: EINTR })) });
    expect(linuxAccessAclAbsent(always.probe, 7, false)).toBe(false);
  });

  test("an unknown errno table or a missing errno cell refuses before any query", () => {
    for (const options of [{ arch: "ia32" }, { arch: "mips" }, { errno: false }]) {
      const fake = fakeProbe({ [access]: [noData] }, options);
      expect(linuxAccessAclAbsent(fake.probe, 7, false)).toBe(false);
      expect(fake.remaining()).toBe(1);
    }
  });

  test("the glibc layer shape: read-only errno and BigInt results are handled the same way", () => {
    const readOnly = (fake: ReturnType<typeof fakeProbe>): LinuxAclProbe => ({ ...fake.probe, errno: { get: fake.probe.errno!.get } });
    const absent = fakeProbe({ [access]: [{ result: -1n, errno: LINUX_ENODATA }] });
    expect(linuxAccessAclAbsent(readOnly(absent), 7, false)).toBe(true);
    const present = fakeProbe({ [access]: [{ result: 8n }] });
    expect(linuxAccessAclAbsent(readOnly(present), 7, false)).toBe(false);
    const clobbered = fakeProbe({ [access]: [{ result: -1, errno: LINUX_ENODATA, clobber: EINTR }, noData] });
    expect(linuxAccessAclAbsent(readOnly(clobbered), 7, false)).toBe(true);
    expect(clobbered.events.filter(event => event.startsWith("set:"))).toEqual([]);
    const failing = fakeProbe({ [access]: Array.from({ length: LINUX_ACL_QUERY_ATTEMPTS }, () => ({ result: -1n, errno: EIO })) });
    expect(linuxAccessAclAbsent(readOnly(failing), 7, false)).toBe(false);
  });

  // The real glibc path runs in a child with a round cap, a time budget and a
  // hard kill, so a stall can never hold the suite past bun's test timeout.
  test.skipIf(process.platform !== "linux")("glibc: a fresh private directory reads as having no ACL in a bounded child", async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "linux-access-acl.fixture.ts"), "500", "5000"], {
      cwd: import.meta.dir, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: tmpdir() }, stdout: "pipe", stderr: "pipe",
    });
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ killed, code, stderr }).toEqual({ killed: false, code: 0, stderr: "" });
      const result = JSON.parse(stdout) as { completed: number; refused: number; queries: number; requeried: number; seen: Record<string, number> };
      console.log(`SH-00084 glibc ACL probe: ${JSON.stringify(result)}`);
      expect(result.completed).toBeGreaterThan(0);
      expect(result.refused).toBe(0);
    } finally { clearTimeout(timer); }
  }, 20_000);
});
