import { afterEach, expect, test } from "bun:test";
import { appendFileSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as integration from "./agent-integration.js";
import { renderAgentHookCommand } from "./agent-adapters.js";
import { renderPinnedLauncher } from "../cli/commands/runtime-launcher.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const events = ["UserPromptSubmit", "SessionStart", "SubagentStart", "PreToolUse"] as const;

function fixture(commandShape: "symlink" | "pinned" = "symlink") {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-projection-")); roots.push(home);
  const dataDir = join(home, "data"), executable = join(home, "runtime", "bin", "index.js");
  mkdirSync(join(home, "runtime", "bin"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "runtime", "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.32", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const command = join(home, "current-skills"), legacy = join(home, "legacy-skills");
  if (commandShape === "pinned") writeFileSync(command, renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: join(home, "runtime"), entry: executable }), { mode: 0o755 });
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
  return { ...source, settings, policy, target, command, legacy, executable, before, plan };
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
