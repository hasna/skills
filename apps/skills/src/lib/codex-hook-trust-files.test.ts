import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { save, snapshot } from "./codex-hook-trust-files.js";
import { pretendOwner } from "./foreign-owner.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
// A non-root account that is not the current user.
const OTHER = process.getuid!() + 1000;
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-trust-owner-")); roots.push(root);
  const dir = join(root, "package", "bin"), file = join(dir, "index.js");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, "synthetic\n", { mode: 0o600 });
  return { root, dir, file };
}

test("files under ancestors owned by the current user or root are admitted", () => {
  const f = fixture();
  // The real chain already includes root-owned system ancestors such as / and /private.
  expect(snapshot(f.file).text).toBe("synthetic\n");
  for (const ancestor of [f.dir, dirname(f.dir), f.root]) {
    const restore = pretendOwner(ancestor, 0);
    try { expect(snapshot(f.file).text).toBe("synthetic\n"); } finally { restore(); }
  }
});

for (const level of ["parent", "grandparent", "fixture root"] as const) {
  test(`an ancestor owned by another non-root account refuses reads and writes (${level})`, () => {
    const f = fixture(), ancestor = level === "parent" ? f.dir : level === "grandparent" ? dirname(f.dir) : f.root;
    const written = join(f.dir, "new.json"), restore = pretendOwner(ancestor, OTHER);
    try {
      expect(() => snapshot(f.file)).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
      expect(() => save(written, "{}")).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
    } finally { restore(); }
    expect(existsSync(written)).toBe(false);
  });
}
