import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { applyAgentIntegration, archiveNativeSkills, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";

const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function put(path: string, content: string | Uint8Array) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-root-alias-test-")); roots.push(root);
  const home = join(root, "home"), workspace = join(home, ".hasna", "projects", "workspaces", "selected"), dataDir = join(home, ".hasna", "skills");
  mkdirSync(dataDir, { recursive: true });
  for (const agent of ["claude", "codex"] as const) {
    const target = join(workspace, "." + agent); mkdirSync(target, { recursive: true });
    if (agent === "codex") admitCorpusFixture(target);
    symlinkSync(relative(home, target), join(home, "." + agent));
    put(join(target, "skills", agent, "SKILL.md"), agent + " instructions\n");
    put(join(target, "skills", agent, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills" }));
    put(join(target, "skills", agent, "assets", "binary.dat"), new Uint8Array([0, 1, 127, 255]));
  }
  put(join(home, ".agents", "skills", "separate", "SKILL.md"), "Separate .agents instructions\n");
  put(join(workspace, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Read"] }, existing: true }));
  put(join(workspace, ".codex", "config.toml"), 'model = "preserved"\n\n[[skills.config]]\npath = ' + JSON.stringify(join(home, ".codex", "skills", "codex", "SKILL.md")) + "\nenabled = true\n");
  return { root, home, workspace, dataDir };
}
function bytes(root: string) {
  const result: Record<string, string> = {};
  function visit(path: string) { if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) visit(join(path, name)); else result[relative(root, path)] = readFileSync(path).toString("hex"); }
  visit(root); return result;
}

test("root aliases require opt-in and hooks use canonical paths while preserving .agents and existing Codex disables", () => {
  const f = fixture();
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude", "codex"] })).toThrow("symlink");
  expect(() => planAgentIntegration({ ...f, agents: ["claude", "codex"] })).toThrow("symlink");
  const before = bytes(join(f.workspace, ".claude", "skills"));
  const plan = planAgentIntegration({ ...f, agents: ["claude", "codex"], allowRootAliases: true });
  expect(plan.rootAliases?.map(binding => ({ alias: binding.alias, target: binding.target }))).toEqual(["claude", "codex"].map(agent => ({ alias: join(f.home, "." + agent), target: join(f.workspace, "." + agent) })));
  expect(plan.changes.every(change => change.path.startsWith(f.workspace) || change.path === join(f.dataDir, "agent-policy.json"))).toBe(true);
  expect(plan.nativeSkills.some(entry => entry.path === join(f.home, ".agents", "skills", "separate") && !entry.rootAlias)).toBe(true);
  expect(plan.nativeSkills.filter(entry => entry.rootAlias)).toHaveLength(2);
  const result = applyAgentIntegration(plan);
  expect(result.rootAliases).toEqual(plan.rootAliases);
  const config = Bun.TOML.parse(readFileSync(join(f.workspace, ".codex", "config.toml"), "utf8")) as any;
  expect(config.model).toBe("preserved");
  expect(config.skills.config.filter((entry: any) => entry.path.includes("/skills/codex/"))).toHaveLength(1);
  expect(config.skills.config.every((entry: any) => entry.enabled === false)).toBe(true);
  const settings = JSON.parse(readFileSync(join(f.workspace, ".claude", "settings.json"), "utf8"));
  expect(settings.existing).toBe(true); expect(settings.permissions.allow).toEqual(["Read"]);
  const after = bytes(join(f.workspace, ".claude", "skills"));
  for (const [path, content] of Object.entries(before)) expect(after[path]).toBe(content);
  expect(inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true }).filter(entry => entry.bridge)).toHaveLength(2);
  expect(lstatSync(join(f.home, ".claude")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(f.home, ".agents", "skills", "separate", "SKILL.md"), "utf8")).toContain("Separate");
  const receipt = JSON.parse(readFileSync(join(dirname(result.backups[0]!), "receipt.json"), "utf8"));
  expect(receipt.rootAliases).toEqual(plan.rootAliases);
});

test("native archive preserves complete canonical bytes and alias binding, leaving separate unmanaged .agents intact", () => {
  const f = fixture(), inventory = inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true });
  const originals = new Map(inventory.filter(entry => entry.managed).map(entry => [entry.path, bytes(entry.path)]));
  expect(() => archiveNativeSkills(inventory, { dataDir: f.dataDir })).toThrow("explicit allowRootAliases");
  const result = archiveNativeSkills(inventory, { dataDir: f.dataDir, allowRootAliases: true });
  expect(result.entries).toHaveLength(2); expect(result.rootAliases).toHaveLength(2);
  for (const entry of result.entries) { expect(bytes(entry.archive)).toEqual(originals.get(entry.source)!); expect(existsSync(entry.source)).toBe(false); }
  expect(existsSync(join(f.home, ".agents", "skills", "separate", "SKILL.md"))).toBe(true);
  expect(lstatSync(join(f.home, ".codex")).isSymbolicLink()).toBe(true);
  const receipt = JSON.parse(readFileSync(join(dirname(result.entries[0]!.archive), "receipt.json"), "utf8")); expect(receipt.rootAliases).toEqual(result.rootAliases);
});

for (const kind of ["outside", "dangling", "file", "chained", "overlap"] as const) test("root alias opt-in rejects " + kind + " targets", () => {
  const f = fixture(), alias = join(f.home, ".claude"); unlinkSync(alias);
  let target: string;
  if (kind === "outside") { target = join(f.root, "outside"); mkdirSync(target); }
  else if (kind === "dangling") target = join(f.home, "absent");
  else if (kind === "file") { target = join(f.home, "file"); put(target, "not a directory"); }
  else if (kind === "overlap") target = join(f.workspace, ".codex");
  else { target = join(f.home, "other-link"); symlinkSync(join(f.workspace, ".claude"), target); }
  symlinkSync(target, alias);
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true })).toThrow();
});

test("opt-in never follows resource, configuration, or unrecognized .agents symlinks", () => {
  const f = fixture(), asset = join(f.workspace, ".claude", "skills", "claude", "assets", "link"), config = join(f.workspace, ".claude", "settings.json");
  symlinkSync(join(f.home, ".agents", "skills", "separate", "SKILL.md"), asset);
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true })).toThrow("symlink"); unlinkSync(asset);
  const text = readFileSync(config, "utf8"); unlinkSync(config); put(join(f.home, "configuration.json"), text); symlinkSync(join(f.home, "configuration.json"), config);
  expect(() => planAgentIntegration({ ...f, agents: ["claude"], allowRootAliases: true })).toThrow("symlink"); unlinkSync(config); put(config, text);
  renameSync(join(f.home, ".agents"), join(f.home, "agents-target")); symlinkSync(join(f.home, "agents-target"), join(f.home, ".agents"));
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true })).toThrow("symlink");
});

test("retargeted root aliases refuse both hook apply and native archive before any mutation", () => {
  const f = fixture(), plan = planAgentIntegration({ ...f, agents: ["claude", "codex"], allowRootAliases: true });
  const canonicalBefore = bytes(f.workspace), alias = join(f.home, ".claude"), link = readlinkSync(alias);
  const replacement = join(f.home, "replacement"); mkdirSync(replacement); unlinkSync(alias); symlinkSync(replacement, alias);
  expect(() => applyAgentIntegration(plan)).toThrow("changed after planning");
  expect(() => archiveNativeSkills(plan.nativeSkills, { dataDir: f.dataDir, allowRootAliases: true })).toThrow("changed after planning");
  expect(bytes(f.workspace)).toEqual(canonicalBefore); expect(readdirSync(f.dataDir)).toEqual([]);
  unlinkSync(alias); symlinkSync(link, alias); expect(() => applyAgentIntegration(plan)).toThrow("changed after planning");
});

test("replacing a canonical root directory at the same path invalidates the planned binding", () => {
  const f = fixture(), plan = planAgentIntegration({ ...f, agents: ["claude"], allowRootAliases: true });
  const target = join(f.workspace, ".claude"); renameSync(target, target + "-preserved"); mkdirSync(target);
  expect(() => applyAgentIntegration(plan)).toThrow("changed after planning");
  expect(existsSync(join(target + "-preserved", "skills", "claude", "SKILL.md"))).toBe(true);
});


test("managed prompts support reviewed home aliases and still refuse local discovery overrides or file aliases", () => {
  const f = fixture();
  archiveNativeSkills(inventoryNativeSkills(f.home, { agents: ["claude", "codex"], allowRootAliases: true }), { dataDir: f.dataDir, allowRootAliases: true, includeUnmanaged: true });
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude", "codex"], allowRootAliases: true }));
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  const local = join(f.workspace, ".claude", "settings.local.json");
  put(local, '{"enabledPlugins":{"unexpected@personal":true}}');
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
  unlinkSync(local); put(join(f.home, "outside-local.json"), '{}'); symlinkSync(join(f.home, "outside-local.json"), local);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("symlink");
});
