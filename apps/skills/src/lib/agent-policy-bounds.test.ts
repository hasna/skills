import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { readManagedSkillPolicy, parseManagedSkillPolicy } from "./managed-policy.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const home = mkdtempSync(join(tmpdir(), "skills-policy-bounds-")); roots.push(home); return { home, dataDir: join(home, ".hasna/skills"), agents: ["claude"] as const, command: "/fixture/skills", profileId: "engineering" }; }
function put(path: string, value: unknown) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function plan(f: ReturnType<typeof fixture>) { return planAgentIntegration({ ...f, agents: [...f.agents] }); }

test("a plugin-rich bridge policy remains readable and guarded after successful installation", () => {
  const f = fixture(), enabled: Record<string, boolean> = {}, plugins: Record<string, unknown> = {};
  for (let i = 0; i < 35; i++) {
    const id = `fixture-plugin-${i}@fixture-catalog`, root = join(f.home, ".claude/plugins/cache/fixture-catalog", `fixture-plugin-${i}`, "1.0.0");
    put(join(root, ".claude-plugin/plugin.json"), { name: `fixture-plugin-${i}` });
    enabled[id] = true; plugins[id] = [{ scope: "user", installPath: root }];
  }
  put(join(f.home, ".claude/settings.json"), { enabledPlugins: enabled }); put(join(f.home, ".claude/plugins/installed_plugins.json"), { version: 2, plugins });
  const candidate = plan(f), policy = candidate.changes.find(change => change.path.endsWith("agent-policy.json"))!;
  expect(Buffer.byteLength(policy.after)).toBeGreaterThan(16_384);
  applyAgentIntegration(candidate);
  expect(readManagedSkillPolicy(f.dataDir)).toMatchObject({ loading: "cli", profileId: "engineering" });
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  expect(plan(f).changes).toEqual([]);
});

test("planning refuses a grown policy before creating bridges or backups", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json");
  put(policyPath, { version: 1, loading: "cli", extension: "x".repeat(1024 * 1024 - 100) });
  const before = readFileSync(policyPath, "utf8"); expect(Buffer.byteLength(before)).toBeLessThan(1024 * 1024);
  expect(() => { plan(f); }).toThrow("size limit");
  expect(readFileSync(policyPath, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".claude/skills/skills-cli"))).toBe(false);
  expect(existsSync(join(f.dataDir, "migration"))).toBe(false);
});

test("apply revalidates UTF-8 policy bytes before writing any configuration or backup", () => {
  const f = fixture(), settings = join(f.home, ".claude/settings.json"); put(settings, { model: "preserved-fixture" });
  const before = readFileSync(settings, "utf8"), candidate = plan(f), policy = candidate.changes.find(change => change.path.endsWith("agent-policy.json"))!;
  const object = JSON.parse(policy.after); object.extension = "漢".repeat(400_000); policy.after = JSON.stringify(object);
  expect(policy.after.length).toBeLessThan(1024 * 1024); expect(Buffer.byteLength(policy.after)).toBeGreaterThan(1024 * 1024);
  expect(() => { applyAgentIntegration(candidate); }).toThrow("size limit");
  expect(readFileSync(settings, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".claude/skills/skills-cli"))).toBe(false);
  expect(existsSync(join(f.dataDir, "agent-policy.json"))).toBe(false);
  expect(existsSync(join(f.dataDir, "migration"))).toBe(false);
});

test("retained discovery collections must satisfy the same bound as active discovery", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json");
  const policy = { version: 1, loading: "cli", bridge: { agents: ["codex"], commands: { codex: "/fixture/skills" }, profiles: { codex: "engineering" }, discovery: { codex: { agent: "codex", method: "reviewed", roots: [], sources: Array.from({ length: 2049 }, () => ({ path: "/fixture/source", sha256: null })) } } } };
  put(policyPath, policy); const before = readFileSync(policyPath, "utf8");
  expect(() => { plan(f); }).toThrow("bounds");
  expect(readFileSync(policyPath, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".claude/skills/skills-cli"))).toBe(false);
  expect(existsSync(join(f.dataDir, "migration"))).toBe(false);
});


test("policy readers enforce the exact serialized byte boundary and guards reject later oversize drift", () => {
  const f = fixture(), path = join(f.dataDir, "agent-policy.json");
  const base = JSON.stringify({ loading: "cli", extension: "" });
  const exact = JSON.stringify({ loading: "cli", extension: "x".repeat(1024 * 1024 - Buffer.byteLength(base)) });
  expect(Buffer.byteLength(exact)).toBe(1024 * 1024);
  mkdirSync(f.dataDir, { recursive: true }); writeFileSync(path, exact);
  expect(readManagedSkillPolicy(f.dataDir)?.loading).toBe("cli");
  writeFileSync(path, exact + " ");
  expect(() => { readManagedSkillPolicy(f.dataDir); }).toThrow("size limit");
  expect(() => { assertManagedAgentBridge("claude", { ...f, projectDir: f.home }); }).toThrow("size limit");
  expect(readFileSync(path, "utf8")).toBe(exact + " ");
});

test("policy discovery bounds accept supported maximums and refuse excessive roots, sources, aliases, and agent maps", () => {
  const discovery = { agent: "claude", method: "reviewed", roots: Array.from({ length: 512 }, () => "/fixture/root"), sources: Array.from({ length: 2048 }, () => ({ path: "/fixture/source", sha256: null })) };
  expect(parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { claude: discovery } } })).loading).toBe("cli");
  const invalid = [
    { discovery: { claude: { ...discovery, roots: [...discovery.roots, "/extra"] } } },
    { discovery: { claude: { ...discovery, sources: [...discovery.sources, { path: "/extra", sha256: null }] } } },
    { rootAliases: [{}, {}, {}] },
    { agents: Array.from({ length: 17 }, () => "claude") },
    { discovery: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i), { ...discovery, roots: [], sources: [] }])) },
  ];
  for (const bridge of invalid) expect(() => { parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge })); }).toThrow("bounds");
});


test("default installation planning does not initialize the selected data root", () => {
  const f = fixture(), previous = process.env.HASNA_SKILLS_DIR;
  try {
    process.env.HASNA_SKILLS_DIR = f.dataDir;
    const candidate = planAgentIntegration({ home: f.home, agents: ["claude"], command: f.command, profileId: f.profileId });
    expect(candidate.changes.some(change => change.path === join(f.dataDir, "agent-policy.json"))).toBe(true);
    expect(existsSync(f.dataDir)).toBe(false);
    expect(existsSync(join(f.home, ".claude"))).toBe(false);
  } finally { if (previous === undefined) delete process.env.HASNA_SKILLS_DIR; else process.env.HASNA_SKILLS_DIR = previous; }
});

test.each(["malformed", "oversized", "nonregular"])("compensation preserves a concurrent %s policy while restoring unchanged native files", (kind) => {
  const f = fixture(), settings = join(f.home, ".claude/settings.json"), policyPath = join(f.dataDir, "agent-policy.json");
  put(settings, { model: "original-fixture" }); const before = readFileSync(settings, "utf8"), candidate = plan(f);
  const concurrent = kind === "malformed" ? "{concurrent-invalid-policy" : JSON.stringify({ loading: "cli", extension: "x".repeat(1024 * 1024) });
  Object.defineProperty(candidate, "discoveryAfter", { get() {
    if (kind === "nonregular") { rmSync(policyPath); mkdirSync(policyPath); writeFileSync(join(policyPath, "owned-fixture"), "preserved"); }
    else writeFileSync(policyPath, concurrent);
    throw new Error("controlled-post-write-failure");
  } });
  expect(() => { applyAgentIntegration(candidate); }).toThrow("controlled-post-write-failure");
  expect(readFileSync(kind === "nonregular" ? join(policyPath, "owned-fixture") : policyPath, "utf8")).toBe(kind === "nonregular" ? "preserved" : concurrent);
  expect(readFileSync(settings, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".claude/skills/skills-cli"))).toBe(false);
});

test("policy readers refuse malformed UTF-8 without replacing bytes during decoding", () => {
  const f = fixture(), path = join(f.dataDir, "agent-policy.json"); mkdirSync(f.dataDir, { recursive: true });
  const bytes = Buffer.concat([Buffer.from('{"loading":"cli","extension":"'), Buffer.from([255]), Buffer.from('"}')]);
  writeFileSync(path, bytes);
  expect(() => { readManagedSkillPolicy(f.dataDir); }).toThrow("refusing legacy fallback");
  expect(readFileSync(path)).toEqual(bytes);
});

test.skipIf(process.platform === "win32")("a regular policy replaced by a FIFO between lstat and open cannot hang", () => {
  const f = fixture(), target = join(f.dataDir, "agent-policy.json"); put(target, { loading: "cli" });
  const script = `import { mock } from "bun:test";
import * as original from "node:fs";
const fs = { ...original }, target = ${JSON.stringify(target)}; let swapped = false;
mock.module("node:fs", () => ({ ...fs, lstatSync(path, ...args) {
  const stat = fs.lstatSync(path, ...args);
  if (String(path) === target && !swapped) { swapped = true; fs.unlinkSync(target); if (Bun.spawnSync(["mkfifo", target]).exitCode !== 0) throw Error("fixture setup failed"); }
  return stat;
} }));
const { readManagedSkillPolicy } = await import(${JSON.stringify(new URL("./managed-policy.ts", import.meta.url).href)});
try { readManagedSkillPolicy(${JSON.stringify(f.dataDir)}); process.exit(3); }
catch (error) { if (!swapped || error.code !== "INVALID_AGENT_POLICY") process.exit(4); console.log("bounded-refusal"); }`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
    cwd: f.home, env: { HOME: f.home, PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe", timeout: 3000,
  });
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString().trim()).toBe("bounded-refusal");
});
