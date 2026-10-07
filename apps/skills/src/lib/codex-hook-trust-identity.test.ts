import { afterEach, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindSkillsCli, inspectRecordedSkillsCli } from "./codex-hook-trust-identity.js";
import { renderPinnedLauncher } from "../cli/commands/runtime-launcher.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
const priorPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = priorPath;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A synthetic installed @hasna/skills package and a PATH directory holding its `skills` command.
function fixture(shape: "symlink" | "pinned", runtime = realpathSync(process.execPath)) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-trust-identity-")); roots.push(root);
  const pkg = join(root, "runtime", "node_modules", "@hasna", "skills"), entry = join(pkg, "bin", "index.js"), bin = join(root, "bin");
  mkdirSync(join(pkg, "bin"), { recursive: true, mode: 0o700 }); mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "1.2.3", bin: { skills: "bin/index.js" } }), { mode: 0o644 });
  writeFileSync(entry, "#!/usr/bin/env bun\nconsole.log(\"1.2.3\");\n", { mode: 0o755 });
  const command = join(bin, "skills");
  if (shape === "symlink") symlinkSync(entry, command);
  else writeFileSync(command, renderPinnedLauncher({ runtime, cwd: join(root, "runtime"), entry }), { mode: 0o755 });
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  const reviewed = { path: entry, version: "1.2.3", sha256: createHash("sha256").update(readFileSync(entry)).digest("hex") };
  return { root, entry, command, reviewed };
}

for (const shape of ["symlink", "pinned"] as const) {
  test(`codex hook trust binds a ${shape} skills command to the exact installed entry and rechecks it`, () => {
    const f = fixture(shape);
    for (const command of ["skills", f.command]) {
      const bound = bindSkillsCli(command, f.reviewed);
      expect(bound.receipt).toMatchObject({ path: f.entry, version: "1.2.3", sha256: f.reviewed.sha256 });
      expect(() => bound.recheck()).not.toThrow();
      const recorded = inspectRecordedSkillsCli(f.command, bound.receipt);
      expect(() => recorded.recheck()).not.toThrow();
    }
  });
}

test("a pinned skills command is rechecked by its exact launcher bytes and refused when edited or unsafe", () => {
  const f = fixture("pinned");
  const bound = bindSkillsCli("skills", f.reviewed);
  const recorded = inspectRecordedSkillsCli(f.command, bound.receipt);
  appendFileSync(f.command, "# edited\n");
  // Still pointing at the same entry is not enough: the launcher bytes are part of the binding.
  expect(() => bound.recheck()).toThrow("CODEX_HOOK_TRUST_");
  expect(() => recorded.recheck()).toThrow("CODEX_HOOK_TRUST_");
  // An edited launcher is not a managed launcher, so it no longer resolves to the entry.
  expect(() => bindSkillsCli("skills", f.reviewed)).toThrow("CODEX_HOOK_TRUST_SKILLS_ENTRYPOINT_MISMATCH");
  // A launcher pinned to a group/world-writable Bun is refused.
  const runtimeDir = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-trust-runtime-")); roots.push(runtimeDir);
  const writableBun = join(runtimeDir, "bun");
  writeFileSync(writableBun, "#!/bin/sh\n"); chmodSync(writableBun, 0o775);
  const unsafe = fixture("pinned", writableBun);
  expect(() => bindSkillsCli("skills", unsafe.reviewed)).toThrow("CODEX_HOOK_TRUST_SKILLS_LAUNCHER_UNVERIFIED");
});
