import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planClaudeStopHookUpdate } from "./agent-integration.js";
import { assertClaudeStopHookReplacement, captureClaudeSettings } from "./claude-settings-witness.js";
import { captureDiscoveryByteSources, captureDiscoveryPathSources, type DiscoverySource } from "./agent-discovery.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (path: string) => readFileSync(path, "utf8");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(mode: "bytes" | "claude-settings-v1" = "bytes", alias = false, secondAgent = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-settings-update-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"), policyPath = join(dataDir, "agent-policy.json");
  const claudeRoot = alias ? join(home, "native", "claude") : join(home, ".claude");
  mkdirSync(claudeRoot, { recursive: true });
  if (alias) symlinkSync(claudeRoot, join(home, ".claude"));
  const settingsPath = join(claudeRoot, "settings.json"), executable = join(home, "runtime", "skills.js");
  put(settingsPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other-owner-stop" }] }] }, owner: { keep: true } }));
  put(executable, "// synthetic executable witness; never executed\n");
  if (secondAgent) admitCorpusFixture(join(home, ".codex"));
  const agents = secondAgent ? ["claude", "codex"] as const : ["claude"] as const;
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: [...agents], profileId: "synthetic", allowRootAliases: alias }));
  const settingsSource = (): DiscoverySource => mode === "bytes" ? captureDiscoveryByteSources([settingsPath])[0]! : captureClaudeSettings(settingsPath);
  const reviewed = { version: 1 as const, agents: [
    { agent: "claude" as const, roots: [], sources: [settingsSource(), ...captureDiscoveryPathSources([executable])], pluginHooks: "reviewed-no-skill-injection" as const },
    ...(secondAgent ? [{ agent: "codex" as const, roots: [], sources: captureDiscoveryByteSources([join(home, ".codex", "config.toml"), settingsPath]), pluginHooks: "reviewed-no-skill-injection" as const }] : []),
  ] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: [...agents], discoveryInputs: reviewed, allowRootAliases: alias }));
  return { home, dataDir, policyPath, settingsPath, executable, claudeRoot, agents };
}
function update(f: ReturnType<typeof fixture>) {
  const before = read(f.settingsPath), object = JSON.parse(before);
  object.hooks.Stop.push({ matcher: "", hooks: [{ type: "command", command: "synthetic-owner stop-hook" }] });
  return { before, replacement: JSON.stringify(object, null, 2) + "\n", expectedSettingsSha256: sha(before) };
}

for (const mode of ["bytes", "claude-settings-v1"] as const) test(`renews ${mode} with one guarded settings/policy transaction`, () => {
  const f = fixture(mode), request = update(f), prior = JSON.parse(read(f.policyPath));
  const plan = planClaudeStopHookUpdate({ ...f, ...request })!;
  expect(plan.changes.map(change => change.path)).toEqual([f.settingsPath, f.policyPath]);
  expect(read(f.settingsPath)).toBe(request.before);
  const result = applyAgentIntegration(plan);
  expect(result.changed).toEqual([f.settingsPath, f.policyPath]);
  expect(result.backups.map(read)).toEqual([request.before, plan.observedPolicy!.before!]);
  expect(read(f.settingsPath)).toBe(request.replacement);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  const after = JSON.parse(read(f.policyPath));
  const oldSources = prior.bridge.discovery.claude.sources, newSources = after.bridge.discovery.claude.sources;
  expect(newSources.length).toBe(oldSources.length);
  for (const [index, old] of oldSources.entries()) {
    if (old.path === f.settingsPath) expect({ ...newSources[index], sha256: old.sha256 }).toEqual(old);
    else expect(newSources[index]).toEqual(old);
  }
  after.bridge.discovery = prior.bridge.discovery;
  expect(after).toEqual(prior);
  expect(planClaudeStopHookUpdate({ ...f, expectedSettingsSha256: sha(request.replacement), replacement: request.replacement })!.changes).toEqual([]);
});

test("renews every agent binding that witnesses the same source", () => {
  const f = fixture("bytes", false, true), request = update(f), prior = JSON.parse(read(f.policyPath));
  applyAgentIntegration(planClaudeStopHookUpdate({ ...f, ...request })!);
  const next = JSON.parse(read(f.policyPath));
  for (const agent of f.agents) {
    expect(next.bridge.discovery[agent].sources.find((source: DiscoverySource) => source.path === f.settingsPath && source.hashMode === "bytes").sha256).toBe(sha(request.replacement));
    expect(next.bridge.commands[agent]).toBe(prior.bridge.commands[agent]);
    expect(() => assertManagedAgentBridge(agent, { ...f, projectDir: f.home })).not.toThrow();
  }
});

test("retains a reviewed root alias and writes only the canonical settings path", () => {
  const f = fixture("bytes", true), request = update(f), policyBefore = JSON.parse(read(f.policyPath));
  const plan = planClaudeStopHookUpdate({ ...f, ...request })!;
  expect(plan.changes[0]!.path).toBe(f.settingsPath);
  applyAgentIntegration(plan);
  expect(JSON.parse(read(f.policyPath)).bridge.rootAliases).toEqual(policyBefore.bridge.rootAliases);
  expect(read(join(f.home, ".claude", "settings.json"))).toBe(request.replacement);
});

test("absence is distinct from an unreadable or malformed managed policy", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-settings-unmanaged-")); roots.push(home);
  const dataDir = join(home, "data"), options = { home, dataDir, expectedSettingsSha256: "absent", replacement: "{}" };
  expect(planClaudeStopHookUpdate(options)).toBeNull();
  expect(existsSync(dataDir)).toBe(false);
  put(join(dataDir, "agent-policy.json"), "not json");
  expect(() => planClaudeStopHookUpdate(options)).toThrow("policy");
});

test("unknown existing Stop drift and executable changes cannot be adopted", () => {
  for (const target of ["settings", "executable"] as const) {
    const f = fixture(), policyBefore = read(f.policyPath);
    if (target === "settings") {
      const object = JSON.parse(read(f.settingsPath)); object.hooks.Stop.push({ hooks: [{ type: "command", command: "unreviewed-owner-edit" }] });
      put(f.settingsPath, JSON.stringify(object));
    } else put(f.executable, "// changed executable witness\n");
    const request = update(f);
    expect(() => planClaudeStopHookUpdate({ ...f, ...request })).toThrow("NATIVE_SKILL_DRIFT");
    expect(read(f.settingsPath)).toBe(request.before);
    expect(read(f.policyPath)).toBe(policyBefore);
  }
});

test("native copies and modified bridge commands fail before any write", () => {
  for (const native of [true, false]) {
    const f = fixture(), request = update(f), policyBefore = read(f.policyPath);
    if (native) put(join(f.claudeRoot, "skills", "unreviewed", "SKILL.md"), "Synthetic test instructions\n");
    else {
      const policy = JSON.parse(policyBefore); policy.bridge.commands.claude = "unreviewed-command";
      put(f.policyPath, JSON.stringify(policy));
    }
    const currentPolicy = read(f.policyPath);
    expect(() => planClaudeStopHookUpdate({ ...f, ...request })).toThrow("NATIVE_SKILL_DRIFT");
    expect(read(f.settingsPath)).toBe(request.before);
    expect(read(f.policyPath)).toBe(currentPolicy);
  }
});

test("apply rechecks the policy and settings exact preimages", () => {
  for (const target of ["settingsPath", "policyPath"] as const) {
    const f = fixture(), request = update(f), plan = planClaudeStopHookUpdate({ ...f, ...request })!;
    const changed = read(f[target]) + " \n"; put(f[target], changed);
    expect(() => applyAgentIntegration(plan)).toThrow();
    expect(read(f[target])).toBe(changed);
  }
});

test("post-write consumer failure restores both unchanged writes", () => {
  const f = fixture(), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  const plan = planClaudeStopHookUpdate({ ...f, ...update(f) })!;
  // Fault injection in the in-memory plan: source hashes still match, but the
  // resulting consumer binding will not match its actual command. No process
  // or hook command is ever executed by this test.
  const change = plan.changes.find(change => change.path === f.policyPath)!;
  const faultyPolicy = JSON.parse(change.after); faultyPolicy.bridge.commands.claude = "synthetic-wrong-command";
  change.after = JSON.stringify(faultyPolicy);
  expect(() => applyAgentIntegration(plan)).toThrow("NATIVE_SKILL_DRIFT");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
});

test("alias retargeting and ambiguous replacement JSON fail closed", () => {
  const f = fixture("bytes", true), request = update(f), plan = planClaudeStopHookUpdate({ ...f, ...request })!;
  const alternate = join(f.home, "alternate"); mkdirSync(alternate); unlinkSync(join(f.home, ".claude")); symlinkSync(alternate, join(f.home, ".claude"));
  expect(() => applyAgentIntegration(plan)).toThrow("alias");
  expect(read(f.settingsPath)).toBe(request.before);
  const regular = fixture();
  expect(() => planClaudeStopHookUpdate({ ...regular, ...update(regular), replacement: '{"hooks":{},"hooks":{}}' })).toThrow("duplicate");
});

for (const key of ["enabledPlugins", "extraKnownMarketplaces", "skillOverrides"] as const) test(`Stop update refuses changed ${key} without adopting stale reviewed roots`, () => {
  const f = fixture(), before = read(f.settingsPath), policyBefore = read(f.policyPath), object = JSON.parse(before);
  object[key] = key === "enabledPlugins" ? { "synthetic-plugin@synthetic-market": true } : { synthetic: "unreviewed" };
  expect(() => applyAgentIntegration(planClaudeStopHookUpdate({ ...f, expectedSettingsSha256: sha(before), replacement: JSON.stringify(object) })!)).toThrow();
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test("Stop update preserves every other hook and even semantic-mode preferences", () => {
  const f = fixture("claude-settings-v1"), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  for (const mutation of [
    (object: any) => { object.hooks.SessionStart = []; },
    (object: any) => { object.model = "sonnet"; },
    (object: any) => { object.verbose = true; },
    (object: any) => { object.owner.keep = false; },
    (object: any) => { object.disableAllHooks = true; },
  ]) {
    const object = JSON.parse(before); mutation(object);
    expect(() => planClaudeStopHookUpdate({ ...f, expectedSettingsSha256: sha(before), replacement: JSON.stringify(object) })).toThrow("outside hooks.Stop");
  }
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test("Stop-only comparison retains unknown numeric spelling and permits first hook creation", () => {
  expect(() => assertClaudeStopHookReplacement(null, '{"hooks":{"Stop":[]}}')).not.toThrow();
  expect(() => assertClaudeStopHookReplacement('{}', '{"hooks":{"Stop":[],"Other":[]}}')).toThrow("outside hooks.Stop");
  expect(() => assertClaudeStopHookReplacement('{"owner":9007199254740993}', '{"owner":9007199254740992,"hooks":{"Stop":[]}}')).toThrow("outside hooks.Stop");
  expect(() => assertClaudeStopHookReplacement('{"owner":-0}', '{"owner":0,"hooks":{"Stop":[]}}')).toThrow("outside hooks.Stop");
  expect(() => assertClaudeStopHookReplacement('{"owner":1e2}', '{"owner":100,"hooks":{"Stop":[]}}')).toThrow("outside hooks.Stop");
  expect(() => assertClaudeStopHookReplacement('{"owner":9007199254740993,"hooks":{}}', '{ "hooks": {"Stop": []}, "owner": 9007199254740993 }')).not.toThrow();
  expect(() => assertClaudeStopHookReplacement('{}', '{"hooks":{"Stop":null}}')).toThrow("Stop array");
});
