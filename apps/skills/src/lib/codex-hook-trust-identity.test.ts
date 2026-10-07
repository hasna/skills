import { afterEach, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { bindSkillsCli, inspectRecordedSkillsCli } from "./codex-hook-trust-identity.js";
import { renderPinnedLauncher } from "../cli/commands/runtime-launcher.js";
import { pretendOwner } from "./foreign-owner.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
const priorPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = priorPath;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A synthetic installed @hasna/skills package and a PATH directory holding its `skills` command.
function fixture(shape: "symlink" | "pinned", runtime = realpathSync(process.execPath), base = realpathSync(tmpdir())) {
  const root = mkdtempSync(join(base, "skills-hook-trust-identity-")); roots.push(root);
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

// A non-root account that is not the current user.
const OTHER = process.getuid!() + 1000;
// A synthetic pinned Bun in its own directory chain; it is checked, never run.
function pinnedRuntime() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-trust-bun-")); roots.push(dir);
  const runtime = join(dir, "rt", "bin", "bun");
  mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 }); writeFileSync(runtime, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return runtime;
}
const receiptFor = (f: ReturnType<typeof fixture>) => ({ path: f.entry, version: "1.2.3", sha256: f.reviewed.sha256, manifestSha256: createHash("sha256").update(readFileSync(join(dirname(dirname(f.entry)), "package.json"))).digest("hex") });
const refusals = (f: ReturnType<typeof fixture>) => [() => bindSkillsCli("skills", f.reviewed), () => bindSkillsCli(f.command, f.reviewed), () => inspectRecordedSkillsCli(f.command, receiptFor(f))];

// N3: the directory holding the command is walked, not only its physical target.
for (const shape of ["symlink", "pinned"] as const) {
  test(`a ${shape} skills command whose own directory another account owns or others can write is refused`, () => {
    const f = fixture(shape), bin = dirname(f.command);
    for (const run of refusals(f)) expect(run).not.toThrow();
    let restore = pretendOwner(bin, OTHER);
    try { for (const run of refusals(f)) expect(run).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT"); } finally { restore(); }
    restore = pretendOwner(bin, 0);
    try { for (const run of refusals(f)) expect(run).not.toThrow(); } finally { restore(); }
    chmodSync(bin, 0o770);
    try { for (const run of refusals(f)) expect(run).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT"); } finally { chmodSync(bin, 0o700); }
  });
}

test("a skills command directory that changes owner after binding is refused by the recheck", () => {
  const f = fixture("symlink"), bound = bindSkillsCli("skills", f.reviewed), recorded = inspectRecordedSkillsCli(f.command, bound.receipt);
  const restore = pretendOwner(dirname(f.command), OTHER);
  try {
    expect(() => bound.recheck()).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_CHANGED");
    expect(() => recorded.recheck()).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_CHANGED");
  } finally { restore(); }
  expect(() => bound.recheck()).not.toThrow();
});

// N3, consistent with the Claude projection: only the command leaf may be an alias.
test("a skills command that reaches its entry through another link is refused; a direct alias is not", () => {
  const f = fixture("symlink"), hops = join(f.root, "hops");
  mkdirSync(hops, { mode: 0o700 }); symlinkSync(f.entry, join(hops, "skills"));
  symlinkSync(join(f.root, "runtime"), join(f.root, "runtime-link"));
  const relative = "../runtime/node_modules/@hasna/skills/bin/index.js";
  const rebind = (text: string) => { rmSync(f.command); symlinkSync(text, f.command); return () => bindSkillsCli("skills", f.reviewed); };
  expect(rebind(relative)).not.toThrow();
  for (const text of [join(hops, "skills"), join(f.root, "runtime-link", "node_modules/@hasna/skills/bin/index.js"), "../runtime-link/../runtime/node_modules/@hasna/skills/bin/index.js"]) {
    expect(rebind(text), text).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_ALIAS_UNSAFE");
  }
  // The reviewed probe: the hop sits in a directory another account owns.
  const probe = rebind(join(hops, "skills")), restore = pretendOwner(hops, OTHER);
  try { expect(probe).toThrow("CODEX_HOOK_TRUST_"); } finally { restore(); }
  expect(rebind(f.entry)).not.toThrow();
});

test("a skills command alias owned by another account is refused; one owned by root is not", () => {
  const f = fixture("symlink");
  let restore = pretendOwner(f.command, OTHER);
  try { for (const run of refusals(f)) expect(run).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_ALIAS_UNSAFE"); } finally { restore(); }
  restore = pretendOwner(f.command, 0);
  try { for (const run of refusals(f)) expect(run).not.toThrow(); } finally { restore(); }
});

// N1: the pinned Bun's directories are trust inputs like the launcher's.
test("a launcher pinned to a Bun whose directory chain another account owns or others can write is refused", () => {
  const runtime = pinnedRuntime(), f = fixture("pinned", runtime);
  for (const run of refusals(f)) expect(run).not.toThrow();
  for (const ancestor of [dirname(runtime), dirname(dirname(runtime))]) {
    let restore = pretendOwner(ancestor, OTHER);
    try { for (const run of refusals(f)) expect(run, ancestor).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT"); } finally { restore(); }
    restore = pretendOwner(ancestor, 0);
    try { for (const run of refusals(f)) expect(run, ancestor).not.toThrow(); } finally { restore(); }
    chmodSync(ancestor, 0o770);
    try { for (const run of refusals(f)) expect(run, ancestor).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT"); } finally { chmodSync(ancestor, 0o700); }
  }
});

test("a pinned Bun directory that changes owner after binding is refused by the recheck", () => {
  const runtime = pinnedRuntime(), f = fixture("pinned", runtime);
  const bound = bindSkillsCli("skills", f.reviewed), recorded = inspectRecordedSkillsCli(f.command, bound.receipt);
  const restore = pretendOwner(dirname(runtime), OTHER);
  try {
    expect(() => bound.recheck()).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
    expect(() => recorded.recheck()).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
  } finally { restore(); }
  expect(() => bound.recheck()).not.toThrow();
});

// Compatibility: the verified macOS root alias stays admissible in a command's spelling.
test.skipIf(process.platform !== "darwin")("a skills command spelled through the macOS /tmp root alias still binds", () => {
  const f = fixture("symlink", undefined, "/private/tmp"), spelled = f.command.replace(/^\/private\/tmp\//, "/tmp/");
  expect(spelled.startsWith("/tmp/")).toBe(true);
  process.env.PATH = `${dirname(spelled)}:/usr/bin:/bin`;
  for (const command of ["skills", spelled]) {
    const bound = bindSkillsCli(command, f.reviewed);
    expect(bound.receipt.path).toBe(f.entry);
    expect(() => bound.recheck()).not.toThrow();
    expect(() => inspectRecordedSkillsCli(spelled, bound.receipt).recheck()).not.toThrow();
  }
});

// B1 (#73 security review): `..` after a linked component. path.resolve and
// Bun's realpath drop `..` as text, but the kernel follows the link first, so
// the walk and the execution would see different files. Layout from the
// reviewer's proof of concept: trusted/link -> foreign/sub,
// foreign/skills -> entry, trusted/skills -> entry, foreign owned by another account.
function dotDotLayout(f: ReturnType<typeof fixture>) {
  const foreign = join(f.root, "foreign"), trusted = join(f.root, "trusted");
  mkdirSync(join(foreign, "sub"), { recursive: true, mode: 0o700 }); mkdirSync(trusted, { mode: 0o700 });
  symlinkSync(f.entry, join(foreign, "skills"));
  symlinkSync(join(foreign, "sub"), join(trusted, "link"));
  symlinkSync(f.entry, join(trusted, "skills"));
  return { foreign, trusted, command: `${trusted}/link/../skills` };
}
// The refusal names its code and a fix hint, and no path.
const NOT_CANONICAL = /^CODEX_HOOK_TRUST_SKILLS_COMMAND_NOT_CANONICAL: [^/]+$/;

test("a skills command spelled with .. after a linked directory is refused before any walk or resolution", () => {
  const f = fixture("symlink"), l = dotDotLayout(f);
  // The kernel reaches the entry through the foreign link.
  expect(realpathSync(join(l.foreign, "skills"))).toBe(f.entry);
  const restore = pretendOwner(l.foreign, OTHER);
  try {
    // Control: the foreign link spelled directly is refused by its walk.
    expect(() => bindSkillsCli(join(l.foreign, "skills"), f.reviewed)).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
    // The reviewer's sequence, admitted at every step before: bind, recheck, recorded inspection, recheck.
    expect(() => {
      const bound = bindSkillsCli(l.command, f.reviewed); bound.recheck();
      inspectRecordedSkillsCli(l.command, bound.receipt).recheck();
    }).toThrow(NOT_CANONICAL);
    expect(() => inspectRecordedSkillsCli(l.command, receiptFor(f))).toThrow(NOT_CANONICAL);
    // The same spelling reached through PATH, as Bun.which returns it.
    process.env.PATH = `${l.trusted}/link/..:/usr/bin:/bin`;
    expect(Bun.which("skills", { PATH: process.env.PATH })).toBe(l.command);
    expect(() => bindSkillsCli("skills", f.reviewed)).toThrow(NOT_CANONICAL);
  } finally { restore(); }
  // Control: the normalized spelling of the trusted link still binds and rechecks.
  process.env.PATH = `${l.trusted}:/usr/bin:/bin`;
  const bound = bindSkillsCli("skills", f.reviewed);
  expect(() => bound.recheck()).not.toThrow();
  expect(() => inspectRecordedSkillsCli(join(l.trusted, "skills"), bound.receipt).recheck()).not.toThrow();
});

test("relative, repeated-slash, dot and trailing-slash command spellings are refused", () => {
  const f = fixture("symlink"), cwd = process.cwd();
  for (const spelled of [`/${f.command}`, f.command.replace(/\/bin\//, "//bin/"), f.command.replace(/\/bin\//, "/./bin/"), `${f.command}/`]) {
    expect(() => bindSkillsCli(spelled, f.reviewed), spelled).toThrow(NOT_CANONICAL);
    expect(() => inspectRecordedSkillsCli(spelled, receiptFor(f)), spelled).toThrow(NOT_CANONICAL);
  }
  // A relative PATH entry makes Bun.which return a relative command.
  process.chdir(f.root);
  try {
    process.env.PATH = "bin:/usr/bin:/bin";
    expect(Bun.which("skills", { PATH: process.env.PATH })).toBe("bin/skills");
    expect(() => bindSkillsCli("skills", f.reviewed)).toThrow(NOT_CANONICAL);
  } finally { process.chdir(cwd); }
});

// #73 security NB1: the recheck must bind the physical launcher and its Bun, not only the entry.
test("a skills command re-pointed after binding to another launcher for the same entry is refused by the recheck", () => {
  const f = fixture("symlink"), launchers = join(f.root, "launchers"), goodBun = pinnedRuntime(), otherBun = pinnedRuntime();
  mkdirSync(launchers, { mode: 0o700 });
  const launcher = (name: string, runtime: string) => {
    const path = join(launchers, name);
    writeFileSync(path, renderPinnedLauncher({ runtime, cwd: join(f.root, "runtime"), entry: f.entry }), { mode: 0o755 });
    return path;
  };
  const a = launcher("a", goodBun), b = launcher("b", otherBun), repoint = (to: string) => { rmSync(f.command); symlinkSync(to, f.command); };
  for (const foreignBun of [true, false]) {
    repoint(a);
    const bound = bindSkillsCli(f.command, f.reviewed), recorded = inspectRecordedSkillsCli(f.command, bound.receipt);
    expect(() => bound.recheck()).not.toThrow(); expect(() => recorded.recheck()).not.toThrow();
    repoint(b);
    const restore = foreignBun ? pretendOwner(dirname(otherBun), OTHER) : () => {};
    try {
      // A fresh bind through b refuses only when its Bun is unsafe; the recheck always does.
      if (foreignBun) expect(() => bindSkillsCli(f.command, f.reviewed)).toThrow("CODEX_HOOK_TRUST_UNSAFE_PARENT");
      expect(() => bound.recheck()).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_CHANGED");
      expect(() => recorded.recheck()).toThrow("CODEX_HOOK_TRUST_SKILLS_COMMAND_CHANGED");
    } finally { restore(); }
  }
});

// Runtime spellings the #73 security review probed: only the exact physical path of the Bun is admitted.
function runtimeSpellings(physical: string): Record<string, string> {
  const base = dirname(dirname(physical));
  mkdirSync(join(base, "x"), { mode: 0o700 });
  symlinkSync(base, `${base}-link`);
  symlinkSync(physical, join(dirname(physical), "bun-link"));
  const spellings: Record<string, string> = {
    "x/../bin": `${base}/x/../bin/bun`, "repeated slash": `${base}//bin/bun`, "dot step": `${base}/./bin/bun`, "trailing slash": `${physical}/`,
    "linked directory": `${base}-link/bin/bun`, "linked leaf": join(dirname(physical), "bun-link"),
  };
  if (process.platform === "darwin" && physical.startsWith("/private/var/")) spellings["/var alias"] = physical.replace(/^\/private\/var\//, "/var/");
  return spellings;
}

test("a launcher pinned to any spelling of its Bun but the exact physical path is refused", () => {
  const physical = pinnedRuntime(), spellings = runtimeSpellings(physical);
  expect(Object.keys(spellings).length).toBeGreaterThanOrEqual(process.platform === "darwin" ? 7 : 6);
  const control = fixture("pinned", physical);
  expect(() => bindSkillsCli("skills", control.reviewed)).not.toThrow();
  for (const [name, spelled] of Object.entries(spellings)) {
    const f = fixture("pinned", spelled);
    for (const run of refusals(f)) expect(run, name).toThrow(/^CODEX_HOOK_TRUST_(SKILLS_LAUNCHER_UNVERIFIED|UNSAFE_PARENT)$/);
  }
});
