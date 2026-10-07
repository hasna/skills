import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { DATA_DIR_ENV } from "./config.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";

// Gemini discovery reads its installed runtime through the `gemini` command.
// Bun.which uses the PATH a process starts with, so every PATH-sensitive step
// runs in a child (agent-discovery-runtime.fixture.ts) with the PATH under test.
useDefaultTestTimeout();
const runner = new URL("./agent-discovery-runtime.fixture.ts", import.meta.url).pathname;
const cli = new URL("../cli/index.tsx", import.meta.url).pathname;
const NARROW = "/usr/bin:/bin";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function geminiPackage(directory: string, version: string, builtins = ["skill-creator"]): string {
  mkdirSync(join(directory, "bundle"), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@google/gemini-cli", version }));
  writeFileSync(join(directory, "bundle", "gemini.js"), "#!/usr/bin/env node\n"); chmodSync(join(directory, "bundle", "gemini.js"), 0o755);
  for (const name of builtins) {
    mkdirSync(join(directory, "bundle", "builtin", name), { recursive: true });
    writeFileSync(join(directory, "bundle", "builtin", name, "SKILL.md"), `---\nname: ${name}\ndescription: Synthetic builtin\n---\nSynthetic builtin instructions\n`);
  }
  return join(directory, "bundle", "gemini.js");
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-gemini-runtime-"))); roots.push(root);
  const home = join(root, "home"), bin = join(root, "opt", "bin"), lib = join(root, "opt", "lib", "node_modules", "@google");
  mkdirSync(home); mkdirSync(bin, { recursive: true });
  const entry = geminiPackage(join(lib, "gemini-cli"), "0.1.0");
  // An npm-style launcher: a relative symlink into the package.
  const launcher = join(bin, "gemini"); symlinkSync("../lib/node_modules/@google/gemini-cli/bundle/gemini.js", launcher);
  const full = `${bin}:${NARROW}`;
  let nonce = 0;
  const run = (PATH: string, action: "install" | "claude-update" | "gemini-guard") => {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", runner, action, home, String(++nonce)], {
      cwd: home, env: { HOME: home, TMPDIR: tmpdir(), PATH, NO_COLOR: "1", HASNA_STATION: "skills-test-no-keychain" }, stdout: "pipe", stderr: "pipe", timeout: 20000,
    });
    expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
    return JSON.parse(child.stdout.toString()) as { ok?: true; error?: string };
  };
  // Gemini's own BeforeTool hook, exactly as installed, through the CLI.
  const hook = (PATH: string) => {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", cli, "hook", "user-prompt", "--agent", "gemini", "--selection-profile", "default", "--event", "BeforeTool"], {
      cwd: home, env: { HOME: home, [DATA_DIR_ENV]: join(home, "data"), TMPDIR: tmpdir(), PATH, NO_COLOR: "1", HASNA_STATION: "skills-test-no-keychain" },
      stdin: Buffer.from(JSON.stringify({ hook_event_name: "BeforeTool", cwd: home, tool_name: "activate_skill", tool_input: { name: "skills-cli" } })), stdout: "pipe", stderr: "pipe", timeout: 20000,
    });
    expect(child.exitCode).toBe(0);
    return JSON.parse(child.stdout.toString()) as { decision?: string; continue?: boolean; reason?: string };
  };
  const policyPath = join(home, "data", "agent-policy.json");
  const policy = () => JSON.parse(readFileSync(policyPath, "utf8"));
  return { root, home, bin, lib, entry, launcher, full, run, hook, policyPath, policy };
}
const ok = { ok: true as const };
const drift = (result: { error?: string }, detail?: string) => {
  expect(result.error).toStartWith("NATIVE_SKILL_DRIFT: ");
  if (detail) expect(result.error).toContain(detail);
};
const unresolved = (result: { error?: string }, detail: string) => {
  expect(result.error).toStartWith('DISCOVERY_ROOT_UNRESOLVED: gemini discovery cannot resolve its "gemini" executable: ');
  expect(result.error).toContain(detail);
  expect(result.error).not.toContain("NATIVE_SKILL_DRIFT");
};
const NOT_ON_PATH = "it is not on this process's PATH, and the reviewed policy has no recorded executable path";
const GONE = "no longer resolves";

test("a narrower PATH verifies the recorded Gemini executable instead of re-resolving it", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  // Behaviour first: before this change these refused with NATIVE_SKILL_DRIFT.
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  expect(f.run(NARROW, "gemini-guard")).toEqual(ok);
  expect(f.hook(NARROW)).toEqual({});
  const bridge = f.policy().bridge;
  expect(bridge.discoveryExecutables).toEqual({ gemini: { command: "gemini", path: f.launcher, target: f.entry } });
  // The binding keeps its existing shape; the executable is stored beside it.
  expect(Object.keys(bridge.discovery.gemini).sort()).toEqual(["agent", "builtinNames", "method", "roots", "sources"]);
  expect(bridge.discovery.gemini.builtinNames).toEqual(["skill-creator"]);
  expect(bridge.discovery.gemini.sources.map((source: { path: string }) => source.path)).toContain(join(f.lib, "gemini-cli", "package.json"));
  for (const PATH of [NARROW, f.full]) {
    expect(f.run(PATH, "claude-update")).toEqual(ok);
    expect(f.run(PATH, "gemini-guard")).toEqual(ok);
    expect(f.hook(PATH)).toEqual({});
  }
  // A Claude update keeps the recorded executable unchanged.
  expect(f.policy().bridge.discoveryExecutables).toEqual(bridge.discoveryExecutables);
});

test("a changed recorded runtime is still drift under any PATH", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  const packageRoot = join(f.lib, "gemini-cli");
  // A builtin added behind the same recorded launcher.
  geminiPackage(packageRoot, "0.1.0", ["skill-creator", "added-builtin"]);
  drift(f.run(NARROW, "claude-update"), "Configured native discovery roots changed during Claude update");
  drift(f.run(NARROW, "gemini-guard"), "Configured native discovery roots changed");
  rmSync(join(packageRoot, "bundle", "builtin", "added-builtin"), { recursive: true });
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  // The reviewed package changed in place.
  geminiPackage(packageRoot, "0.1.1");
  drift(f.run(NARROW, "claude-update"), "Native discovery input changed");
  geminiPackage(packageRoot, "0.1.0");
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  // The recorded launcher now leads to another runtime.
  const other = geminiPackage(join(f.root, "other", "gemini-cli"), "0.1.0");
  unlinkSync(f.launcher); symlinkSync(other, f.launcher);
  for (const PATH of [NARROW, f.full]) {
    drift(f.run(PATH, "claude-update"), `the recorded gemini executable now resolves to ${JSON.stringify(other)}, not the reviewed ${JSON.stringify(f.entry)}`);
    drift(f.run(PATH, "gemini-guard"), "the recorded gemini executable now resolves to");
  }
});

test("a different gemini first on PATH shadows the recorded runtime and refuses as drift", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  // An unreviewed runtime with an extra builtin, earlier on the caller's PATH.
  const shadowEntry = geminiPackage(join(f.root, "shadow", "lib", "gemini-cli"), "9.9.9", ["skill-creator", "unreviewed-builtin"]);
  const shadowBin = join(f.root, "shadow", "bin"); mkdirSync(shadowBin, { recursive: true });
  symlinkSync(shadowEntry, join(shadowBin, "gemini"));
  const shadowed = `${shadowBin}:${f.full}`;
  const named = `the "gemini" on this process's PATH resolves to ${JSON.stringify(shadowEntry)}, not the reviewed ${JSON.stringify(f.entry)}`;
  drift(f.run(shadowed, "claude-update"), named);
  drift(f.run(shadowed, "gemini-guard"), named);
  const denied = f.hook(shadowed);
  expect(denied.decision).toBe("deny"); expect(denied.continue).toBe(false);
  drift({ error: denied.reason }, named);
  // The shadow also refuses when the recorded launcher itself is gone.
  renameSync(f.launcher, `${f.launcher}.moved`);
  drift(f.run(shadowed, "claude-update"), named);
  renameSync(`${f.launcher}.moved`, f.launcher);
  // Another launcher for the same reviewed runtime is not a shadow.
  const aliasBin = join(f.root, "alias", "bin"); mkdirSync(aliasBin, { recursive: true });
  symlinkSync(f.entry, join(aliasBin, "gemini"));
  expect(f.run(`${aliasBin}:${NARROW}`, "claude-update")).toEqual(ok);
  expect(f.hook(`${aliasBin}:${NARROW}`)).toEqual({});
  // Without a shadow, the narrower PATH still verifies the recorded path only.
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  expect(f.run(NARROW, "gemini-guard")).toEqual(ok);
});

test("other discovery changes still refuse as drift under a narrower PATH", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  const settingsPath = join(f.home, ".gemini", "settings.json"), settings = readFileSync(settingsPath, "utf8");
  writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(settings), skills: { ...JSON.parse(settings).skills, disabled: [] } }));
  drift(f.run(NARROW, "claude-update"), "Native discovery input changed");
  writeFileSync(settingsPath, settings);
  const extension = join(f.home, ".gemini", "extensions", "added");
  mkdirSync(extension, { recursive: true }); writeFileSync(join(extension, "gemini-extension.json"), JSON.stringify({ name: "added", version: "1.0.0" }));
  drift(f.run(NARROW, "claude-update"), "Configured native discovery roots changed during Claude update");
});

test("a missing recorded executable is DISCOVERY_ROOT_UNRESOLVED, not drift, and stays blocking", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  renameSync(f.launcher, `${f.launcher}.moved`);
  for (const PATH of [NARROW, f.full]) {
    unresolved(f.run(PATH, "claude-update"), `the recorded executable ${JSON.stringify(f.launcher)} ${GONE}`);
    unresolved(f.run(PATH, "gemini-guard"), GONE);
    const denied = f.hook(PATH);
    expect(denied.decision).toBe("deny"); expect(denied.continue).toBe(false);
    unresolved({ error: denied.reason }, GONE);
  }
  // With the runtime gone, any other change is still drift, not a gap.
  const settingsPath = join(f.home, ".gemini", "settings.json"), settings = readFileSync(settingsPath, "utf8");
  writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(settings), skills: { ...JSON.parse(settings).skills, disabled: [] } }));
  drift(f.run(NARROW, "claude-update"), "Native discovery input changed");
  writeFileSync(settingsPath, settings);
  const extension = join(f.home, ".gemini", "extensions", "added");
  mkdirSync(extension, { recursive: true }); writeFileSync(join(extension, "gemini-extension.json"), JSON.stringify({ name: "added", version: "1.0.0" }));
  drift(f.run(NARROW, "claude-update"), "Configured native discovery roots changed during Claude update");
  rmSync(join(f.home, ".gemini", "extensions"), { recursive: true });
  renameSync(`${f.launcher}.moved`, f.launcher);
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  // A dangling launcher does not resolve either.
  renameSync(f.entry, `${f.entry}.moved`);
  unresolved(f.run(NARROW, "claude-update"), GONE);
});

test("a policy without a recorded executable keeps PATH verification and names the unresolvable command", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  // Model a policy written before executables were recorded.
  const legacy = f.policy(); delete legacy.bridge.discoveryExecutables;
  writeFileSync(f.policyPath, `${JSON.stringify(legacy, null, 2)}\n`);
  expect(f.run(f.full, "claude-update")).toEqual(ok);
  expect(f.policy().bridge.discoveryExecutables).toBeUndefined();
  unresolved(f.run(NARROW, "claude-update"), NOT_ON_PATH);
  unresolved(f.run(NARROW, "gemini-guard"), NOT_ON_PATH);
  unresolved({ error: f.hook(NARROW).reason }, NOT_ON_PATH);
  // Any other difference is still drift, even without the runtime.
  const settingsPath = join(f.home, ".gemini", "settings.json"), settings = readFileSync(settingsPath, "utf8");
  writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(settings), skills: { ...JSON.parse(settings).skills, disabled: [] } }));
  drift(f.run(NARROW, "claude-update"));
  writeFileSync(settingsPath, settings);
  // A new review from the reviewing PATH records the executable again.
  expect(f.run(f.full, "install")).toEqual(ok);
  expect(f.policy().bridge.discoveryExecutables.gemini.path).toBe(f.launcher);
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
});

test("a narrower-PATH review keeps a recorded runtime that still resolves, and drops one that is gone", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  const before = f.policy().bridge;
  expect(f.run(NARROW, "install")).toEqual(ok);
  expect(f.policy().bridge.discoveryExecutables).toEqual(before.discoveryExecutables);
  expect(f.policy().bridge.discovery.gemini).toEqual(before.discovery.gemini);
  // Gone from its recorded path and from PATH: the review records no runtime.
  renameSync(f.launcher, `${f.launcher}.moved`);
  expect(f.run(NARROW, "install")).toEqual(ok);
  expect(f.policy().bridge.discoveryExecutables).toBeUndefined();
  expect(f.policy().bridge.discovery.gemini.builtinNames).toEqual([]);
});

test("a reinstall treats a dangling, blocked or unreachable recorded launcher as no record", () => {
  for (const [kind, PATH] of [["dangling", "full"], ["dangling", "narrow"], ["enotdir", "narrow"], ["eacces", "narrow"]] as const) {
    const f = fixture();
    expect(f.run(f.full, "install")).toEqual(ok);
    const path = PATH === "full" ? f.full : NARROW;
    if (kind === "dangling") renameSync(f.entry, `${f.entry}.moved`);
    if (kind === "enotdir") { renameSync(f.bin, `${f.bin}.moved`); writeFileSync(f.bin, "not a directory\n"); }
    if (kind === "eacces") chmodSync(f.bin, 0o000);
    try {
      // Before this change the install refused with DISCOVERY_ROOT_UNRESOLVED.
      expect(f.run(path, "install")).toEqual(ok);
      expect(f.policy().bridge.discoveryExecutables).toBeUndefined();
      expect(f.policy().bridge.discovery.gemini.builtinNames).toEqual([]);
    } finally { if (kind === "eacces") chmodSync(f.bin, 0o755); }
  }
});

test("a Gemini binding reviewed without a runtime stays current under any PATH", () => {
  const f = fixture();
  renameSync(f.launcher, `${f.launcher}.hidden`);
  expect(f.run(f.full, "install")).toEqual(ok);
  expect(f.policy().bridge.discoveryExecutables).toBeUndefined();
  expect(f.policy().bridge.discovery.gemini.builtinNames).toEqual([]);
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  expect(f.run(f.full, "claude-update")).toEqual(ok);
  // A runtime that appears on the reviewing PATH is new discovery, so drift.
  renameSync(`${f.launcher}.hidden`, f.launcher);
  drift(f.run(f.full, "claude-update"), "Configured native discovery roots changed during Claude update");
});

test("the SDK classifies the distinct code without treating drift as an environment gap", async () => {
  // Imported here so that the rest of this file also loads against older sources.
  const { DISCOVERY_ROOT_UNRESOLVED, isDiscoveryRootUnresolved } = await import("../index.js");
  expect(DISCOVERY_ROOT_UNRESOLVED).toBe("DISCOVERY_ROOT_UNRESOLVED");
  expect(isDiscoveryRootUnresolved(new Error('DISCOVERY_ROOT_UNRESOLVED: gemini discovery cannot resolve its "gemini" executable: x'))).toBe(true);
  for (const other of [new Error("NATIVE_SKILL_DRIFT: Configured native discovery roots changed"), new Error("NATIVE_SKILL_DRIFT: DISCOVERY_ROOT_UNRESOLVED: x"), "DISCOVERY_ROOT_UNRESOLVED: x", null]) expect(isDiscoveryRootUnresolved(other)).toBe(false);
});

test("the stored policy bounds recorded discovery executables", () => {
  const executable = { command: "gemini", path: "/home/user/.local/bin/gemini", target: "/home/user/.local/lib/node_modules/@google/gemini-cli/bundle/gemini.js" };
  const policy = (executables: unknown) => JSON.stringify({ version: 1, loading: "cli", bridge: { discoveryExecutables: executables } });
  expect(parseManagedSkillPolicy(policy({ gemini: executable })).bridge.discoveryExecutables.gemini).toEqual(executable);
  for (const invalid of [
    { codex: { ...executable, command: "codex" } }, { gemini: { ...executable, command: "other" } }, { gemini: { ...executable, path: "bin/gemini" } },
    { gemini: { ...executable, path: "/home/user/../user/.local/bin/gemini" } }, { gemini: { ...executable, target: "/home/user/x\n" } },
    { gemini: { ...executable, path: "/home/user/.local/bin/gem\u202eini" } }, { gemini: { ...executable, target: "/home/user/\u009bx" } },
    { gemini: { ...executable, path: "/home/user/\u2066gemini" } }, { gemini: { ...executable, target: "/home/user/\u200fx" } },
    { gemini: { ...executable, extra: true } }, { gemini: { command: "gemini", path: executable.path } }, { gemini: null }, [executable],
  ]) expect(() => parseManagedSkillPolicy(policy(invalid))).toThrow("has invalid collection bounds");
});
