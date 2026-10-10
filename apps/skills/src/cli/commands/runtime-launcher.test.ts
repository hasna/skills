import { createHash } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { type LauncherProfile, inspectLauncher, launcherIs, launcherProfileForBin, materializeLauncher, parsePinnedLauncher, pinnedLauncherEnvironment, pinnedLauncherState, pinnedLauncherText, renderPinnedLauncher, resolveLauncherCommand } from "./runtime-launcher.js";
import { selectedSkillsCommand } from "./runtime.js";
import { selfSpawnCommand, selfSpawnRoot } from "../../lib/self-spawn.js";
import { resolveServerConfig } from "../../server/config.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

const appRoot = resolve(import.meta.dir, "..", "..", "..");
const launchCwdApply = join(appRoot, "src", "lib", "launch-cwd-apply.ts");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  roots.push(root);
  return root;
}

// A hostile working directory: a bunfig.toml preload that writes a marker on
// every load, and a .env the child would otherwise see.
function hostileDirectory() {
  const dir = scratch("skills-self-spawn-hostile-");
  const marker = join(dir, "preload-marker");
  writeFileSync(join(dir, "preload.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran\\n", { flag: "a" });\n`, { mode: 0o600 });
  writeFileSync(join(dir, "bunfig.toml"), `preload = [${JSON.stringify(join(dir, "preload.js"))}]\n`, { mode: 0o600 });
  writeFileSync(join(dir, ".env"), "HOSTILE_DOTENV=leaked\n", { mode: 0o600 });
  const markers = () => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0);
  return { dir, markers };
}

// A synthetic installed copyfile layout whose CLI entry restores the launch
// directory the way the real entries do, then reports what it received.
function installedProbe() {
  const root = scratch("skills-self-spawn-runtime-");
  const entry = join(root, "node_modules", "@hasna", "skills", "bin", "index.js");
  mkdirSync(dirname(entry), { recursive: true, mode: 0o700 });
  writeFileSync(entry, `import ${JSON.stringify(launchCwdApply)};
console.log(JSON.stringify({ cwd: process.cwd(), dotenv: process.env.HOSTILE_DOTENV ?? null, bunOptions: process.env.BUN_OPTIONS ?? null,
  nodeOptions: process.env.NODE_OPTIONS ?? null, proxy: process.env.HTTPS_PROXY ?? null, kept: process.env.HASNA_SKILLS_PROBE ?? null,
  launchCwd: process.env.HASNA_SKILLS_LAUNCH_CWD ?? null, argv: process.argv.slice(2) }));
`, { mode: 0o755 });
  return { root, entry };
}

test("self-spawned children get the pinned flags, the runtime root and the allowlisted environment, not the caller's cwd configuration", async () => {
  const hostile = hostileDirectory(), probe = installedProbe();
  const env = { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", BUN_OPTIONS: `--preload=${join(hostile.dir, "preload.js")}`,
    NODE_OPTIONS: `--require=${join(hostile.dir, "preload.js")}`, HTTPS_PROXY: "http://127.0.0.1:9", HASNA_SKILLS_PROBE: "kept" };
  // Positive control: the previous `[process.execPath, process.argv[1], ...]` shape from the caller's directory.
  const control = Bun.spawnSync([process.execPath, probe.entry, "context"], { cwd: hostile.dir, env, stdout: "pipe", stderr: "pipe" });
  expect(control.exitCode).toBe(0);
  expect(hostile.markers()).toBeGreaterThan(0);
  expect(JSON.parse(control.stdout.toString()).dotenv).toBe("leaked");
  const before = hostile.markers();
  const self = selfSpawnCommand(["context", "--stdin", "--json"], { entry: probe.entry, env, callerCwd: hostile.dir });
  expect(self.cwd).toBe(realpathSync(probe.root));
  expect(selfSpawnRoot(probe.entry)).toBe(realpathSync(probe.root));
  expect(self.command).toEqual([process.execPath, "--config=/dev/null", "--no-env-file", "--no-macros", "--no-install", `--cwd=${realpathSync(probe.root)}`, probe.entry, "context", "--stdin", "--json"]);
  expect(Object.keys(self.env).sort()).toEqual(["HASNA_SKILLS_LAUNCH_CWD", "HASNA_SKILLS_PROBE", "HOME", "PATH"]);
  const child = Bun.spawnSync(self.command, { cwd: self.cwd, env: self.env, stdout: "pipe", stderr: "pipe" });
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual({ cwd: realpathSync(hostile.dir), dotenv: null, bunOptions: null, nodeOptions: null, proxy: null, kept: "kept", launchCwd: null, argv: ["context", "--stdin", "--json"] });
  expect(hostile.markers()).toBe(before);
});

test("no CLI or MCP source re-executes itself outside the shared self-spawn helper", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx)$/.test(name.name) || /\.test\.ts$|fixture/.test(name.name) || path === join(appRoot, "src", "lib", "self-spawn.ts")) continue;
      const text = readFileSync(path, "utf8");
      if (/\[\s*process\.execPath\s*,\s*process\.argv\[1\]/.test(text)) offenders.push(relative(appRoot, path));
    }
  };
  walk(join(appRoot, "src"));
  expect(offenders).toEqual([]);
});

test("every pinned entry restores the launch directory before any other import", () => {
  const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { bin: Record<string, string> };
  const sources: Record<string, string> = {
    "bin/index.js": "src/cli/index.tsx", "bin/mcp.js": "src/mcp/index.ts", "bin/server.js": "src/server/index.ts",
    "bin/worker.js": "src/server/worker.ts", "bin/maintenance.js": "src/server/maintenance.ts", "bin/migrate.js": "src/server/migrate.ts",
  };
  expect(Object.keys(sources).sort()).toEqual([...new Set(Object.values(pkg.bin))].sort());
  for (const source of Object.values(sources)) {
    const firstImport = readFileSync(join(appRoot, source), "utf8").split("\n").find(line => /^import\b/.test(line));
    expect({ source, firstImport }).toEqual({ source, firstImport: 'import "../lib/launch-cwd-apply.js";' });
  }
});

test.each(["HASNA_SKILLS_DATABASE_URL", "SKILLS_DATABASE_URL", "DATABASE_URL"])("a pinned skills-serve preserves %s and resolves it in the caller directory", async (locator) => {
  const root = scratch("skills-pinned-serve-"), trusted = join(root, "trusted"), caller = join(root, "caller"), home = join(root, "home");
  for (const dir of [trusted, caller, home]) mkdirSync(dir, { mode: 0o700 });
  const launcher = join(root, "skills-serve");
  writeFileSync(launcher, renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: trusted, entry: join(appRoot, "src", "server", "index.ts"), format: "v2", profile: "server" }), { mode: 0o755 });
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port; probe.stop(true);
  // SKILLS_HOST names an address that cannot be bound, so a dropped HOST fails instead of listening widely.
  const child = Bun.spawn([launcher], { cwd: caller, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { HOME: home, PATH: "/usr/bin:/bin", HOST: "127.0.0.1", SKILLS_HOST: "192.0.2.1", PORT: String(port), NODE_ENV: "production",
      [locator]: "served.sqlite", SKILLS_PUBLIC_BASE_URL: `http://127.0.0.1:${port}` } });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  let output = "";
  try {
    const reader = child.stdout.getReader();
    while (!output.includes("storage:")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    reader.releaseLock();
  } finally { clearTimeout(timer); child.kill("SIGTERM"); await child.exited; }
  expect(output).toContain(`skills API listening on http://127.0.0.1:${port}`);
  expect(output).toContain(`storage: sqlite (${join(realpathSync(caller), "served.sqlite")})`);
  expect(existsSync(join(caller, "served.sqlite"))).toBe(true);
  expect(readdirSync(trusted)).toEqual([]);
});

test("command resolution reads a managed pinned launcher as its exact entry and leaves symlinks and edited files as they are", () => {
  const root = scratch("skills-launcher-resolve-");
  const entry = join(root, "pkg", "bin", "index.js");
  mkdirSync(dirname(entry), { recursive: true, mode: 0o700 });
  writeFileSync(entry, "#!/usr/bin/env bun\n", { mode: 0o755 });
  const link = join(root, "skills-link"), pinned = join(root, "skills-pinned"), edited = join(root, "skills-edited");
  symlinkSync(entry, link);
  const text = renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: root, entry });
  writeFileSync(pinned, text, { mode: 0o755 });
  writeFileSync(edited, text.replace("set -eu", "set -eu\n/usr/bin/true"), { mode: 0o755 });
  expect(resolveLauncherCommand(link)).toEqual({ physical: entry, entry, pinned: null });
  expect(resolveLauncherCommand(pinned)).toMatchObject({ physical: pinned, entry, pinned: { entry, cwd: root } });
  expect(resolveLauncherCommand(edited)).toEqual({ physical: edited, entry: edited, pinned: null });
  // self-update PATH verification: a pinned launcher on PATH runs the installed entry and is run as itself.
  expect(selectedSkillsCommand(pinned, link)).toBe(pinned);
  expect(selectedSkillsCommand(link, link)).toBe(entry);
  expect(() => selectedSkillsCommand(edited, link)).toThrow("Updated command is shadowed on PATH");
});

// Captured from the unchanged .60 renderer, rather than derived from the current renderer.
const originalV1 = "#!/bin/sh -p\n# hasna-skills-pinned-launcher-v1\n# Written by `skills self-update`; rewrite it with `skills self-update`, do not edit by hand.\n# Runs the exact Skills entry below under one exact Bun from one trusted directory with\n# no working-directory configuration (no bunfig.toml, no .env, no macros, no auto-install)\n# and only the environment names allowed here. Everything else, BUN_* and NODE_OPTIONS\n# included, never reaches the runtime. The CLI returns to the caller's directory itself.\n# `-p` keeps the caller's exported functions and shell options out of this shell.\nset -eu\nHASNA_SKILLS_LAUNCH_CWD=$(pwd -P 2>/dev/null || :)\nexport HASNA_SKILLS_LAUNCH_CWD\nset -- '/opt/bun' --config=/dev/null --no-env-file --no-macros --no-install '--cwd=/opt/runtime' '/opt/pkg/bin/index.js' \"$@\"\nhasna_skills_env=$(LC_ALL=C /usr/bin/awk 'BEGIN {\n  n = split(\"HOME PATH TMPDIR TERM TERM_PROGRAM TERM_PROGRAM_VERSION COLORTERM LANG USER LOGNAME SHELL TZ NO_COLOR FORCE_COLOR CI COLUMNS LINES EDITOR VISUAL PAGER SSH_AUTH_SOCK DATABASE_URL TERMINAL_CWD CODEX_HOME HERMES_HOME HERMES_ENABLE_PROJECT_PLUGINS HOST PORT NODE_ENV AGENT_ID ECS_CONTAINER_METADATA_URI_V4\", exact, \" \")\n  for (i = 1; i <= n; i++) allow[exact[i]] = 1\n  for (name in ENVIRON) {\n    if (name !~ /^[A-Za-z_][A-Za-z0-9_]*$/) continue\n    if (name == \"LC_ALL\" || (!(name in allow) && name !~ /^(HASNA|SKILLS|SKILL|MCP|XDG|LC|AWS)_/)) continue\n    value = ENVIRON[name]; quoted = \"\"\n    while ((k = index(value, \"\\047\")) > 0) { quoted = quoted substr(value, 1, k - 1) \"\\047\\\\\\047\\047\"; value = substr(value, k + 1) }\n    printf \"\\047%s=%s\\047 \", name, quoted value\n  }\n}')\neval \"set -- $hasna_skills_env \\\"\\$@\\\"\"\nif [ \"${LC_ALL+x}\" = x ]; then set -- \"LC_ALL=$LC_ALL\" \"$@\"; fi\nexec /usr/bin/env -i \"$@\"\n";

test("original V1 bytes parse, inspect and restore with old receipt fields", () => {
  const binding = { runtime: "/opt/bun", cwd: "/opt/runtime", entry: "/opt/pkg/bin/index.js" };
  expect(parsePinnedLauncher(originalV1)).toEqual({ ...binding, format: "v1" });
  expect(renderPinnedLauncher({ ...binding, format: "v1" })).toBe(originalV1);
  const state = { shape: "pinned" as const, runtime: binding.runtime, cwd: binding.cwd,
    target: binding.entry, sha256: createHash("sha256").update(originalV1).digest("hex") };
  expect(pinnedLauncherText(state)).toBe(originalV1);
  const path = join(scratch("skills-v1-readback-"), "skills");
  materializeLauncher(path, state);
  expect(readFileSync(path, "utf8")).toBe(originalV1);
  expect(inspectLauncher(path)).toMatchObject({ kind: "pinned", format: "v1", sha256: state.sha256 });
  expect(launcherIs(path, state)).toBe(true);
  expect(parsePinnedLauncher(originalV1.replace("set -eu", "set -eu\ntrue"))).toBeNull();
});

const locatorNames = ["DATABASE_URL", "HASNA_SKILLS_DATABASE_URL", "SKILLS_DATABASE_URL"];
const configuredEnvironment = {
  HOME: "/synthetic/home", PATH: "/usr/bin:/bin", HASNA_HOME: "/synthetic/hasna",
  HASNA_CONFIG_HOME: "/synthetic/config", SKILLS_API_URL: "https://skills.example.test",
  SKILLS_API_KEY: "synthetic-fixture", HASNA_SKILLS_API_URL: "https://gateway.example.test",
  HASNA_SKILLS_API_KEY: "synthetic-fixture", SKILLS_PROFILE: "fixture", MCP_TRANSPORT: "stdio",
  SKILL_TEST_MODE: "1", XDG_CONFIG_HOME: "/synthetic/config", AWS_REGION: "eu-west-1", LC_ALL: "C",
  HOST: "127.0.0.1", PORT: "8080", NODE_ENV: "production", AGENT_ID: "fixture",
  ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/fixture", DATABASE_URL: "bare.sqlite",
  HASNA_SKILLS_DATABASE_URL: "canonical.sqlite", SKILLS_DATABASE_URL: "fallback.sqlite",
  BUN_OPTIONS: "--preload=/invalid", NODE_OPTIONS: "--require=/invalid", HTTPS_PROXY: "http://invalid",
};

test.each(["client", "server"] as const)("V2 %s shell and JS environment projections agree on storage and documented options", (profile) => {
  const root = scratch("skills-v2-env-"), entry = join(root, "probe.ts"), launcher = join(root, "launcher");
  writeFileSync(entry, "console.log(JSON.stringify(process.env));\n", { mode: 0o755 });
  const binding = { runtime: realpathSync(process.execPath), cwd: root, entry, format: "v2" as const, profile };
  writeFileSync(launcher, renderPinnedLauncher(binding), { mode: 0o755 });
  const child = Bun.spawnSync([launcher], { cwd: root, env: configuredEnvironment, stdout: "pipe", stderr: "pipe" });
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toBe("");
  const actual = JSON.parse(child.stdout.toString());
  const expected = pinnedLauncherEnvironment(configuredEnvironment, profile);
  for (const [name, value] of Object.entries(expected)) expect(actual[name]).toBe(value);
  for (const name of locatorNames) expect(actual[name]).toBe(profile === "server" ? configuredEnvironment[name as keyof typeof configuredEnvironment] : undefined);
  for (const name of ["BUN_OPTIONS", "NODE_OPTIONS", "HTTPS_PROXY"]) expect(actual[name]).toBeUndefined();
  expect(parsePinnedLauncher(readFileSync(launcher, "utf8"))).toEqual(binding);
});

test("every installed package bin has an explicit matching environment role", () => {
  const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
  const roles: Record<string, LauncherProfile> = { skills: "client", "skills-mcp": "client", "skills-serve": "server",
    "skills-server": "server", "skills-worker": "server", "skills-maintenance": "server", "skills-migrate": "server" };
  expect(Object.keys(roles).sort()).toEqual(Object.keys(pkg.bin).sort());
  for (const [name, entry] of Object.entries(pkg.bin)) expect(launcherProfileForBin(name, entry as string)).toBe(roles[name]);
  expect(() => launcherProfileForBin("skills", "bin/server.js")).toThrow("LAUNCHER_BIN_CONTRACT_INVALID");
  expect(() => launcherProfileForBin("unknown", "bin/server.js")).toThrow("LAUNCHER_BIN_CONTRACT_INVALID");
});

test("V2 refuses profile, text, format and digest tampering", () => {
  const state = pinnedLauncherState("/opt/bun", "/opt/runtime", "/opt/pkg/bin/index.js");
  const text = pinnedLauncherText(state);
  expect(state).toMatchObject({ format: "v2", profile: "client" });
  expect(parsePinnedLauncher(text.replace("environment-profile: client", "environment-profile: server"))).toBeNull();
  expect(parsePinnedLauncher(text.replace("environment-profile: client", "environment-profile: unknown"))).toBeNull();
  expect(() => pinnedLauncherText({ ...state, profile: "server" })).toThrow("LAUNCHER_TEXT_DIGEST_MISMATCH");
  expect(() => pinnedLauncherText({ ...state, format: undefined })).toThrow("LAUNCHER_PROFILE_INVALID");
  expect(() => pinnedLauncherText({ ...state, sha256: "0".repeat(64) })).toThrow("LAUNCHER_TEXT_DIGEST_MISMATCH");
  expect(parsePinnedLauncher(text.replace("set -eu", "set -eu\ntrue"))).toBeNull();
});


test("client projection rejects storage names before accessing any value", () => {
  const env: Record<string, string | undefined> = { SKILLS_API_URL: "https://skills.example.test" };
  for (const name of locatorNames) Object.defineProperty(env, name, { enumerable: true,
    get: () => { throw new Error(`storage locator read: ${name}`); } });
  expect(pinnedLauncherEnvironment(env)).toEqual({ SKILLS_API_URL: "https://skills.example.test" });
  expect(pinnedLauncherEnvironment(Object.fromEntries(locatorNames.map(name => [name, "fixture.sqlite"])), "server"))
    .toEqual(Object.fromEntries(locatorNames.map(name => [name, "fixture.sqlite"])));
});


test("server database locator aliases preserve canonical precedence and generic fallback", () => {
  expect(resolveServerConfig({}).databaseUrl).toBeUndefined();
  expect(resolveServerConfig({ SKILLS_DATABASE_URL: "skills.sqlite" }).databaseUrl).toBe("skills.sqlite");
  expect(resolveServerConfig({ DATABASE_URL: "generic.sqlite" }).databaseUrl).toBe("generic.sqlite");
  expect(resolveServerConfig({ SKILLS_DATABASE_URL: "skills.sqlite", DATABASE_URL: "generic.sqlite" }).databaseUrl).toBe("skills.sqlite");
  expect(resolveServerConfig({ HASNA_SKILLS_DATABASE_URL: "canonical.sqlite", SKILLS_DATABASE_URL: "skills.sqlite", DATABASE_URL: "generic.sqlite" }).databaseUrl).toBe("canonical.sqlite");
  expect(resolveServerConfig({ HASNA_SKILLS_DATABASE_URL: "", SKILLS_DATABASE_URL: "skills.sqlite", DATABASE_URL: "generic.sqlite" }).databaseUrl).toBe("skills.sqlite");
  expect(resolveServerConfig({ HASNA_SKILLS_DATABASE_URL: "", SKILLS_DATABASE_URL: "", DATABASE_URL: "generic.sqlite" }).databaseUrl).toBe("generic.sqlite");
});
