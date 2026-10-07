import { afterEach, expect, test } from "bun:test";
import { appendFileSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as integration from "./agent-integration.js";
import { renderAgentHookCommand } from "./agent-adapters.js";
import { renderPinnedLauncher } from "../cli/commands/runtime-launcher.js";
import { pretendOwner } from "./foreign-owner.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const events = ["UserPromptSubmit", "SessionStart", "SubagentStart", "PreToolUse"] as const;

// `runtime` names a synthetic pinned Bun created inside the fixture; the
// projection checks it as a file and never runs it.
function fixture(commandShape: "symlink" | "pinned" = "symlink", runtime?: string) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-projection-")); roots.push(home);
  const dataDir = join(home, "data"), executable = join(home, "runtime", "bin", "index.js");
  mkdirSync(join(home, "runtime", "bin"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "runtime", "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.32", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const command = join(home, "current-skills"), legacy = join(home, "legacy-skills");
  if (runtime !== undefined) {
    runtime = join(home, runtime);
    mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 });
    writeFileSync(runtime, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  }
  if (commandShape === "pinned") writeFileSync(command, renderPinnedLauncher({ runtime: runtime ?? realpathSync(process.execPath), cwd: join(home, "runtime"), entry: executable }), { mode: 0o755 });
  else symlinkSync(executable, command);
  symlinkSync(executable, legacy);
  const source = { home, dataDir, projectDir: home };
  integration.applyAgentIntegration(integration.planAgentIntegration({ ...source, agents: ["claude"], command: legacy, profileId: "default" }));
  const settings = join(home, ".claude/settings.json"), policy = join(dataDir, "agent-policy.json");
  const target = JSON.parse(readFileSync(settings, "utf8"));
  target.oauthAccount = { accountUuid: "synthetic-local-account" };
  target.env = { LOCAL_NOTE: "retained-local-setting" };
  target.hooks.UserPromptSubmit[0].matcher = "local-matcher";
  target.hooks.UserPromptSubmit[0].hooks[0].timeout = 37;
  target.hooks.UserPromptSubmit[0].hooks.unshift({ type: "command", command: "echo unrelated", timeout: 2 });
  target.hooks.UserPromptSubmit.push({ hooks: [{ type: "prompt", prompt: "Local unrelated hook" }] });
  integration.applyAgentIntegration(integration.planAgentIntegration({ ...source, agents: ["claude"], command, profileId: "fleet" }));
  const before = { settings: readFileSync(settings, "utf8"), policy: readFileSync(policy, "utf8") };
  function plan(value = target, extra: Record<string, unknown> = {}) {
    const targetSettings = JSON.stringify(value);
    return integration.planClaudeManagedHookProjection({ ...source, targetSettings, expectedTargetSha256: sha(targetSettings), ...extra });
  }
  return { ...source, settings, policy, target, command, legacy, executable, runtime, before, plan };
}

test("a copied profile follows the changed managed selection without replacing unrelated hooks or settings", () => {
  const f = fixture();
  expect(() => integration.assertManagedAgentBridge("claude", { ...f, profileId: "default" })).toThrow("selection profile differs");
  expect(() => integration.assertManagedAgentBridge("claude", { ...f, profileId: "fleet" })).not.toThrow();
  const original = JSON.stringify(f.target), plan = f.plan();
  expect(plan.replacements).toHaveLength(4);
  expect(plan.targetSha256).toBe(sha(original));
  const next = structuredClone(f.target);
  for (const item of plan.replacements) {
    const hook = next.hooks[item.event][item.groupIndex].hooks[item.hookIndex];
    expect(sha(hook.command)).toBe(item.beforeSha256);
    hook.command = item.command;
  }
  for (const event of events) {
    const index = event === "UserPromptSubmit" ? 1 : 0;
    expect(next.hooks[event][0].hooks[index].command).toBe(renderAgentHookCommand(f.command, "claude", "fleet", event));
  }
  const restored = structuredClone(next);
  for (const item of plan.replacements) restored.hooks[item.event][item.groupIndex].hooks[item.hookIndex].command = f.target.hooks[item.event][item.groupIndex].hooks[item.hookIndex].command;
  expect(restored).toEqual(f.target);
  expect(JSON.stringify(f.target)).toBe(original);
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
  expect(JSON.stringify(plan)).not.toContain("synthetic-local-account");
  expect(JSON.stringify(plan)).not.toContain("retained-local-setting");
  expect(JSON.stringify(plan)).not.toContain("echo unrelated");
  expect(f.plan(next).replacements).toEqual([]);
});

test("explicit empty overrides and unrelated hooks remain unpopulated", () => {
  const f = fixture();
  for (const target of [{}, { hooks: {} }, { hooks: { UserPromptSubmit: [] } }, { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo local" }] }] } }]) {
    expect(f.plan(target).replacements).toEqual([]);
  }
});

test("stale target and source witnesses refuse without changing their originals", () => {
  const f = fixture(), prior = f.plan();
  expect(() => f.plan(f.target, { expectedTargetSha256: "0".repeat(64) })).toThrow("TARGET_CHANGED");
  expect(() => f.plan(f.target, { expectedSourceSha256: "0".repeat(64) })).toThrow("SOURCE_CHANGED");
  integration.applyAgentIntegration(integration.planAgentIntegration({ ...f, agents: ["claude"], command: f.command, profileId: "next" }));
  const current = readFileSync(f.settings, "utf8");
  expect(() => f.plan(f.target, { expectedSourceSha256: prior.sourceSha256 })).toThrow("SOURCE_CHANGED");
  expect(readFileSync(f.settings, "utf8")).toBe(current);
  expect(f.plan().replacements.every(item => item.command.includes("--selection-profile next "))).toBe(true);
});

test("canonical drift still fails its ordinary bridge gate", () => {
  const f = fixture();
  writeFileSync(f.settings, JSON.stringify({ ...JSON.parse(f.before.settings), disableAllHooks: true }));
  expect(() => f.plan()).toThrow("SOURCE_UNVERIFIED");
});

test("duplicate recognized hooks refuse ambiguous ownership", () => {
  const f = fixture();
  f.target.hooks.SessionStart.push(structuredClone(f.target.hooks.SessionStart[0]));
  expect(() => f.plan()).toThrow("AMBIGUOUS");
});

test("shell wrappers, extra arguments and mismatched events are never adopted", () => {
  const f = fixture(), original = f.target.hooks.SessionStart[0].hooks[0].command;
  for (const command of [`env ${original}`, `${original} --extra value`, `${original}; echo local`, original.replace("--event SessionStart", "--event UserPromptSubmit")]) {
    f.target.hooks.SessionStart[0].hooks[0].command = command;
    expect(() => f.plan()).toThrow("UNRECOGNIZED");
  }
});

test("a managed pinned launcher is a trusted command alias, bound by its exact launcher bytes", () => {
  const f = fixture("pinned");
  expect(lstatSync(f.command).isSymbolicLink()).toBe(false);
  const plan = f.plan();
  expect(plan.replacements).toHaveLength(4);
  for (const item of plan.replacements) expect(item.command).toBe(renderAgentHookCommand(f.command, "claude", "fleet", item.event));
  appendFileSync(f.command, "# edited\n");
  expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
});

test("a lookalike command in another executable is not Skills ownership", () => {
  const f = fixture(), other = join(f.home, "other");
  writeFileSync(other, readFileSync(f.executable), { mode: 0o700 });
  f.target.hooks.SessionStart[0].hooks[0].command = renderAgentHookCommand(other, "claude", "default", "SessionStart");
  expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
});

test("a writable executable or command directory is not a trusted alias", () => {
  const f = fixture();
  chmodSync(f.executable, 0o722);
  expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
  chmodSync(f.executable, 0o700);
  chmodSync(join(f.home, "runtime"), 0o722);
  expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
});

for (const subject of ["runtime", "manifest", "alias-parent", "runtime-parent", "manifest-parent"] as const) {
  test.skipIf(process.platform !== "darwin")(`a Darwin ACL write grant on the ${subject} refuses the public projection`, () => {
    const f = fixture(), aliases = join(f.home, "aliases");
    mkdirSync(aliases, { mode: 0o700 });
    const alias = join(aliases, "skills"); symlinkSync(f.executable, alias);
    f.target.hooks.SessionStart[0].hooks[0].command = renderAgentHookCommand(alias, "claude", "default", "SessionStart");
    expect(f.plan().replacements).toHaveLength(4);
    const path = subject === "runtime" ? f.executable
      : subject === "manifest" ? join(f.home, "runtime/package.json")
      : subject === "alias-parent" ? aliases
      : subject === "runtime-parent" ? join(f.home, "runtime/bin") : join(f.home, "runtime");
    const file = lstatSync(path).isFile(), before = file ? readFileSync(path) : null;
    const grant = file ? "everyone allow write,append" : "everyone allow add_file,add_subdirectory,delete_child";
    const acl = Bun.spawnSync(["/bin/chmod", "+a", grant, path], { stdout: "pipe", stderr: "pipe" });
    expect(acl.exitCode).toBe(0); expect(acl.stderr.toString()).toBe("");
    expect(lstatSync(path).mode & 0o022).toBe(0);
    expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
    if (before) expect(readFileSync(path)).toEqual(before);
    expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
    expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
    // Only this test's newly created synthetic ACL is removed for its control.
    const cleared = Bun.spawnSync(["/bin/chmod", "-N", path], { stdout: "pipe", stderr: "pipe" });
    expect(cleared.exitCode).toBe(0); expect(f.plan().replacements).toHaveLength(4);
  });
}

test.skipIf(process.platform !== "darwin")("deny-only home and runtime ACLs remain admissible, but a later grant does not", () => {
  const f = fixture(), paths = [f.home, f.executable, join(f.home, "runtime/package.json")];
  try {
    for (const path of paths) {
      const acl = Bun.spawnSync(["/bin/chmod", "+a", "everyone deny delete", path], { stdout: "pipe", stderr: "pipe" });
      expect(acl.exitCode).toBe(0); expect(acl.stderr.toString()).toBe("");
      expect(lstatSync(path).mode & 0o022).toBe(0);
    }
    expect(f.plan().replacements).toHaveLength(4);
    expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
    expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
    const added = Bun.spawnSync(["/bin/chmod", "+a", "everyone allow write,append", f.executable], { stdout: "pipe", stderr: "pipe" });
    expect(added.exitCode).toBe(0); expect(lstatSync(f.executable).mode & 0o022).toBe(0);
    expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED");
  } finally {
    // The synthetic deny-delete ACL must be retired before fixture cleanup.
    for (const path of paths) {
      const cleared = Bun.spawnSync(["/bin/chmod", "-N", path], { stdout: "pipe", stderr: "pipe" });
      expect(cleared.exitCode).toBe(0);
    }
  }
});

test.skipIf(process.platform !== "darwin")("an alias-parent ACL grant during projection is refused by the final recheck", () => {
  const f = fixture(), before = JSON.parse;
  let injected = false, grantStatus: number | undefined;
  // Inject only after the executable's initial parent checks, while reading its
  // manifest; source settings and policy bytes are never changed by the probe.
  JSON.parse = ((text: string, ...args: unknown[]) => {
    const value = before(text, ...args as []);
    if (!injected && value?.name === "@hasna/skills") {
      injected = true;
      grantStatus = Bun.spawnSync(["/bin/chmod", "+a", "everyone allow add_file,delete_child", f.home], { stdout: "pipe", stderr: "pipe" }).exitCode;
    }
    return value;
  }) as typeof JSON.parse;
  try { expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED"); }
  finally { JSON.parse = before; }
  expect(injected).toBe(true); expect(grantStatus).toBe(0);
  expect(lstatSync(f.home).mode & 0o022).toBe(0);
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

// A separate process adds and removes its own entries in one directory, as
// unrelated processes do in a shared TMPDIR or home directory. It stops at its
// own deadline, far beyond this test, in case the runner dies before killing it.
const CHURN = `const fs = require("node:fs"), path = require("node:path"), deadline = Date.now() + 120000; let n = 0; fs.writeSync(1, "ready\\n");
while (Date.now() < deadline) { const file = path.join(process.env.CHURN_DIR, ".churn-" + (n++ % 32)); fs.closeSync(fs.openSync(file, "wx", 0o600)); fs.unlinkSync(file); if (n % 8 === 0) Bun.sleepSync(1); }`;

test.skipIf(process.platform !== "darwin")("unrelated entry churn in an ancestor directory never refuses, while a grant there still does", async () => {
  const f = fixture();
  const churn = Bun.spawn([process.execPath, "--no-env-file", "-e", CHURN], { env: { PATH: "/usr/bin:/bin", CHURN_DIR: f.home }, stdout: "pipe", stderr: "pipe" });
  try {
    const ready = churn.stdout.getReader(); await ready.read(); ready.releaseLock();
    const refusals: string[] = [], homeBefore = lstatSync(f.home, { bigint: true }).mtimeNs;
    // Eight plans are enough: at the base, every one refused under this churn.
    for (let round = 0; round < 8; round++) {
      try { if (f.plan().replacements.length !== 4) refusals.push("unexpected replacements"); }
      catch (error) { refusals.push(String(error)); }
    }
    // The churn overlapped the projections (the home changed during them), and
    // the process is still running once an event-loop turn updates its status,
    // so "never refuses" cannot pass vacuously.
    expect(lstatSync(f.home, { bigint: true }).mtimeNs).not.toBe(homeBefore);
    await Bun.sleep(10); expect(churn.exitCode).toBeNull();
    expect(refusals).toEqual([]);
    const grant = Bun.spawnSync(["/bin/chmod", "+a", "everyone allow add_file,delete_child", f.home], { stdout: "pipe", stderr: "pipe" });
    expect(grant.exitCode).toBe(0); expect(lstatSync(f.home).mode & 0o022).toBe(0);
    try { expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED"); }
    finally { expect(Bun.spawnSync(["/bin/chmod", "-N", f.home], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0); }
    // Control: with the grant removed, the same churned ancestor projects again.
    expect(f.plan().replacements).toHaveLength(4);
    await Bun.sleep(10); expect(churn.exitCode).toBeNull();
  } finally { churn.kill("SIGKILL"); await churn.exited; }
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

test("an executable ancestor owned by another non-root account refuses the projection; own or root ancestors do not", () => {
  const f = fixture(), other = process.getuid!() + 1000;
  expect(f.plan().replacements).toHaveLength(4);
  for (const ancestor of [join(f.home, "runtime", "bin"), join(f.home, "runtime"), f.home]) {
    let restore = pretendOwner(ancestor, other);
    try { expect(() => f.plan(), ancestor).toThrow("EXECUTABLE_UNVERIFIED"); } finally { restore(); }
    restore = pretendOwner(ancestor, 0);
    try { expect(f.plan().replacements, ancestor).toHaveLength(4); } finally { restore(); }
  }
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

// M1: the command's own directory is walked only by the projection's own
// ancestor check, so this pins that check (the package-file guard never sees it).
test("a command alias whose own directory is owned by another non-root account refuses; own or root does not", () => {
  const f = fixture(), aliases = join(f.home, "aliases"), alias = join(aliases, "skills"), other = process.getuid!() + 1000;
  mkdirSync(aliases, { mode: 0o700 }); symlinkSync(f.executable, alias);
  f.target.hooks.SessionStart[0].hooks[0].command = renderAgentHookCommand(alias, "claude", "default", "SessionStart");
  expect(f.plan().replacements).toHaveLength(4);
  let restore = pretendOwner(aliases, other);
  try { expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED"); } finally { restore(); }
  restore = pretendOwner(aliases, 0);
  try { expect(f.plan().replacements).toHaveLength(4); } finally { restore(); }
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

// N2: only the command leaf may be an alias, and it must name its target directly.
test("a command alias that reaches the executable through another link refuses; a direct alias does not", () => {
  const f = fixture(), aliases = join(f.home, "aliases"), hops = join(f.home, "hops"), other = process.getuid!() + 1000;
  mkdirSync(aliases, { mode: 0o700 }); mkdirSync(hops, { mode: 0o700 });
  symlinkSync(f.executable, join(hops, "skills"));
  symlinkSync(join(f.home, "runtime"), join(f.home, "runtime-link"));
  const shapes: Record<string, string> = {
    "a second file link": join(hops, "skills"),
    "a linked directory": join(f.home, "runtime-link", "bin", "index.js"),
    "a relative link through a linked directory": "../runtime-link/bin/index.js",
    "a name stepped back over with ..": "../runtime-link/../runtime/bin/index.js",
    "a current-directory step": "./../runtime/bin/index.js",
  };
  const project = (name: string, text: string) => {
    const alias = join(aliases, name); symlinkSync(text, alias);
    f.target.hooks.SessionStart[0].hooks[0].command = renderAgentHookCommand(alias, "claude", "default", "SessionStart");
    return () => f.plan();
  };
  // Controls: an absolute and a relative direct alias still project.
  expect(project("absolute", f.executable)().replacements).toHaveLength(4);
  expect(project("relative", "../runtime/bin/index.js")().replacements).toHaveLength(4);
  for (const [index, [shape, text]] of Object.entries(shapes).entries()) {
    expect(project(`chain-${index}`, text), shape).toThrow("EXECUTABLE_UNVERIFIED");
  }
  // The reviewed probe: the hop sits in a directory another account owns.
  const probe = project("probe", join(hops, "skills")), restore = pretendOwner(hops, other);
  try { expect(probe).toThrow("EXECUTABLE_UNVERIFIED"); } finally { restore(); }
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

// N1: the pinned Bun's directories are trust inputs like the entry's.
test("a pinned Bun whose directory chain another account owns, or others can write, refuses; root-owned does not", () => {
  const f = fixture("pinned", "pinned-bun/bin/bun"), runtime = f.runtime!, other = process.getuid!() + 1000;
  expect(f.plan().replacements).toHaveLength(4);
  for (const ancestor of [dirname(runtime), dirname(dirname(runtime))]) {
    let restore = pretendOwner(ancestor, other);
    try { expect(() => f.plan(), ancestor).toThrow("EXECUTABLE_UNVERIFIED"); } finally { restore(); }
    restore = pretendOwner(ancestor, 0);
    try { expect(f.plan().replacements, ancestor).toHaveLength(4); } finally { restore(); }
    chmodSync(ancestor, 0o770);
    try { expect(() => f.plan(), ancestor).toThrow("EXECUTABLE_UNVERIFIED"); } finally { chmodSync(ancestor, 0o700); }
  }
  expect(f.plan().replacements).toHaveLength(4);
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

test("a pinned Bun directory that changes owner during projection is refused by the final recheck", () => {
  const f = fixture("pinned", "pinned-bun/bin/bun"), before = JSON.parse;
  let restore: (() => void) | undefined;
  // Inject after the initial runtime walk, while the entry's manifest is read.
  JSON.parse = ((text: string, ...args: unknown[]) => {
    const value = before(text, ...args as []);
    if (!restore && value?.name === "@hasna/skills") restore = pretendOwner(dirname(f.runtime!), process.getuid!() + 1000);
    return value;
  }) as typeof JSON.parse;
  try { expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED"); }
  finally { JSON.parse = before; restore?.(); }
  expect(restore).toBeDefined();
  expect(f.plan().replacements).toHaveLength(4);
});

for (const subject of ["file", "directory"] as const) {
  test.skipIf(process.platform !== "darwin")(`a Darwin ACL write grant on the pinned Bun ${subject} refuses the projection`, () => {
    const f = fixture("pinned", "pinned-bun/bin/bun"), path = subject === "file" ? f.runtime! : dirname(f.runtime!);
    expect(f.plan().replacements).toHaveLength(4);
    const grant = subject === "file" ? "everyone allow write,append" : "everyone allow add_file,delete_child";
    const acl = Bun.spawnSync(["/bin/chmod", "+a", grant, path], { stdout: "pipe", stderr: "pipe" });
    expect(acl.exitCode).toBe(0); expect(lstatSync(path).mode & 0o022).toBe(0);
    try { expect(() => f.plan()).toThrow("EXECUTABLE_UNVERIFIED"); }
    finally { expect(Bun.spawnSync(["/bin/chmod", "-N", path], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0); }
    expect(f.plan().replacements).toHaveLength(4);
  });
}

test("single quotes in a trusted executable path round trip through the owning renderer", () => {
  const f = fixture(), alias = join(f.home, "skills' alias");
  symlinkSync(f.executable, alias);
  f.target.hooks.SessionStart[0].hooks[0].command = renderAgentHookCommand(alias, "claude", "default", "SessionStart");
  expect(f.plan().replacements).toHaveLength(4);
});

test("the normal CLI projects stdin bytes without echoing unrelated settings or writing them", async () => {
  const f = fixture(), input = JSON.stringify(f.target);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli/index.tsx"), "hook", "project-claude-settings", "--expected-target-sha256", sha(input), "--json"], {
    cwd: f.home, env: { ...process.env, HOME: f.home, HASNA_SKILLS_DIR: f.dataDir }, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(0); expect(stderr).toBe("");
  expect(JSON.parse(stdout).replacements).toHaveLength(4);
  for (const privateField of ["synthetic-local-account", "retained-local-setting", "echo unrelated"]) expect(stdout).not.toContain(privateField);
  expect(readFileSync(f.settings, "utf8")).toBe(f.before.settings);
  expect(readFileSync(f.policy, "utf8")).toBe(f.before.policy);
});

test("CLI refusals never echo malformed private input", async () => {
  const f = fixture(), input = "unparsed-local-settings";
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli/index.tsx"), "hook", "project-claude-settings", "--expected-target-sha256", sha(input), "--json"], {
    cwd: f.home, env: { ...process.env, HOME: f.home, HASNA_SKILLS_DIR: f.dataDir }, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(1); expect(stdout).toBe("");
  expect(stderr.trim()).toBe("CLAUDE_MANAGED_HOOK_TARGET_INVALID");
});

test("oversized target bytes are refused before source inspection", () => {
  const targetSettings = " ".repeat(1024 * 1024 + 1);
  expect(() => integration.planClaudeManagedHookProjection({ targetSettings, expectedTargetSha256: sha(targetSettings), home: "/does-not-exist" })).toThrow("TARGET_INVALID");
});
