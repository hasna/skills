import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fstatSync, lstatSync, mkdtempSync, closeSync, openSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pretendOwner } from "./foreign-owner.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-foreign-owner-")); roots.push(root);
  return { root, real: lstatSync(root).uid, other: lstatSync(root).uid + 1000 };
}
const owners = (path: string) => {
  const fd = openSync(path, "r");
  try { return [lstatSync(path).uid, statSync(path).uid, fstatSync(fd).uid, Number(lstatSync(path, { bigint: true }).uid)]; } finally { closeSync(fd); }
};

test("pretendOwner disguises lstat, stat and fstat for one directory and restores them", () => {
  const d = directory(), restore = pretendOwner(d.root, d.other);
  try { expect(owners(d.root)).toEqual([d.other, d.other, d.other, d.other]); } finally { restore(); }
  expect(owners(d.root)).toEqual([d.real, d.real, d.real, d.real]);
});

for (const failing of [2, 3] as const) {
  test(`pretendOwner restores the spies it installed when spy ${failing} of 3 throws`, () => {
    const d = directory();
    let calls = 0;
    const install = ((target: object, name: string) => {
      if (++calls === failing) throw new Error("synthetic spy failure");
      return spyOn(target as never, name as never);
    }) as typeof spyOn;
    try {
      expect(() => pretendOwner(d.root, d.other, install)).toThrow("synthetic spy failure");
      expect(calls).toBe(failing);
      // No reader is left disguised by a spy installed before the failure.
      expect(owners(d.root)).toEqual([d.real, d.real, d.real, d.real]);
    } finally { mock.restore(); }
  });
}
