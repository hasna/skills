/**
 * Test-only: make one existing directory report another owner through lstat,
 * stat and fstat, keyed by its device and inode. This simulates a directory
 * owned by a second account without root, sudo or a real second account; the
 * filesystem itself is never changed.
 */
import * as fs from "node:fs";
import { spyOn } from "bun:test";

export function pretendOwner(path: string, uid: number): () => void {
  const target = fs.lstatSync(path, { bigint: true }), key = `${target.dev}:${target.ino}`;
  const disguise = (stat: unknown) => {
    const value = stat as { dev?: unknown; ino?: unknown; uid?: unknown } | undefined;
    if (!value || `${value.dev}:${value.ino}` !== key) return stat;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(value)), value);
    copy.uid = typeof value.uid === "bigint" ? BigInt(uid) : uid;
    return copy;
  };
  const real = { lstatSync: fs.lstatSync, statSync: fs.statSync, fstatSync: fs.fstatSync };
  const spies = (["lstatSync", "statSync", "fstatSync"] as const).map(name =>
    spyOn(fs, name).mockImplementation(((...args: unknown[]) => disguise((real[name] as (...input: unknown[]) => unknown)(...args))) as never));
  return () => { for (const spy of spies) spy.mockRestore(); };
}
