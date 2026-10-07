import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { renderPinnedLauncher, resolveLauncherCommand } from "./runtime-launcher.js";
import { selectedSkillsCommand } from "./runtime.js";
import { selfSpawnCommand, selfSpawnRoot } from "../../lib/self-spawn.js";
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

test("a pinned skills-serve binds the caller's HOST and PORT and resolves a relative database URL in the caller's directory", async () => {
  const root = scratch("skills-pinned-serve-"), trusted = join(root, "trusted"), caller = join(root, "caller"), home = join(root, "home");
  for (const dir of [trusted, caller, home]) mkdirSync(dir, { mode: 0o700 });
  const launcher = join(root, "skills-serve");
  writeFileSync(launcher, renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: trusted, entry: join(appRoot, "src", "server", "index.ts") }), { mode: 0o755 });
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port; probe.stop(true);
  // SKILLS_HOST names an address that cannot be bound, so a dropped HOST fails instead of listening widely.
  const child = Bun.spawn([launcher], { cwd: caller, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { HOME: home, PATH: "/usr/bin:/bin", HOST: "127.0.0.1", SKILLS_HOST: "192.0.2.1", PORT: String(port), NODE_ENV: "production",
      HASNA_SKILLS_DATABASE_URL: "served.sqlite", SKILLS_PUBLIC_BASE_URL: `http://127.0.0.1:${port}` } });
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
