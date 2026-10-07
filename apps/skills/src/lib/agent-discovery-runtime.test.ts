import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { DATA_DIR_ENV } from "./config.js";

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
const drift = (result: { error?: string }) => { expect(result.error).toStartWith("NATIVE_SKILL_DRIFT: "); };
const unresolved = (result: { error?: string }) => {
  expect(result.error).toStartWith('DISCOVERY_ROOT_UNRESOLVED: gemini discovery cannot resolve its "gemini" executable');
  expect(result.error).not.toContain("NATIVE_SKILL_DRIFT");
};

test("a narrower PATH reports DISCOVERY_ROOT_UNRESOLVED instead of drift for a reviewed Gemini runtime", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  const gemini = f.policy().bridge.discovery.gemini;
  expect(gemini.builtinNames).toEqual(["skill-creator"]);
  expect(gemini.sources.map((source: { path: string }) => source.path)).toContain(join(f.lib, "gemini-cli", "package.json"));
  expect(f.run(f.full, "claude-update")).toEqual(ok);
  expect(f.run(f.full, "gemini-guard")).toEqual(ok);
  unresolved(f.run(NARROW, "claude-update"));
  unresolved(f.run(NARROW, "gemini-guard"));
  // The hook stays blocking and shows the distinct code, not drift.
  expect(f.hook(f.full)).toEqual({});
  const denied = f.hook(NARROW);
  expect(denied.decision).toBe("deny"); expect(denied.continue).toBe(false);
  unresolved({ error: denied.reason });
});

test("real discovery changes still refuse as drift under a narrower PATH", () => {
  const f = fixture();
  expect(f.run(f.full, "install")).toEqual(ok);
  const settingsPath = join(f.home, ".gemini", "settings.json"), settings = readFileSync(settingsPath, "utf8");
  // A changed bound configuration field.
  writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(settings), skills: { ...JSON.parse(settings).skills, disabled: [] } }));
  drift(f.run(NARROW, "claude-update"));
  writeFileSync(settingsPath, settings);
  // A new extension adds a source the review never saw.
  const extension = join(f.home, ".gemini", "extensions", "added");
  mkdirSync(extension, { recursive: true }); writeFileSync(join(extension, "gemini-extension.json"), JSON.stringify({ name: "added", version: "1.0.0" }));
  drift(f.run(NARROW, "claude-update"));
  rmSync(join(f.home, ".gemini", "extensions"), { recursive: true });
  // A different runtime on the reviewing PATH.
  const other = geminiPackage(join(f.root, "other", "gemini-cli"), "0.2.0");
  unlinkSync(f.launcher); symlinkSync(other, f.launcher);
  drift(f.run(f.full, "claude-update"));
});

test("a Gemini binding reviewed without a runtime stays current under any PATH", () => {
  const f = fixture();
  renameSync(f.launcher, `${f.launcher}.hidden`);
  expect(f.run(f.full, "install")).toEqual(ok);
  expect(f.policy().bridge.discovery.gemini.builtinNames).toEqual([]);
  expect(f.run(NARROW, "claude-update")).toEqual(ok);
  expect(f.run(f.full, "claude-update")).toEqual(ok);
  // A runtime that appears on the reviewing PATH is new discovery, so drift.
  renameSync(`${f.launcher}.hidden`, f.launcher);
  drift(f.run(f.full, "claude-update"));
});
