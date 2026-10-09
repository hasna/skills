import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planClaudeHookEventsUpdate } from "./agent-integration.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, captureDiscoveryPathSources, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (path: string) => readFileSync(path, "utf8");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
type Dependency = "none" | "source" | "root" | "directory" | "path";
function fixture(dependency: Dependency = "none", alias = false, openCode = false, automaticHermes = false) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-claude-consumers-")); homes.push(home);
  const dataDir = join(home, ".hasna/skills"), policyPath = join(dataDir, "agent-policy.json");
  const claudeRoot = alias ? join(home, "project/.claude") : join(home, ".claude");
  mkdirSync(claudeRoot, { recursive: true });
  if (alias) symlinkSync(claudeRoot, join(home, ".claude"));
  const settingsPath = join(claudeRoot, "settings.json"), extraSource = join(home, "reviewed/source.js");
  const extraDirectory = join(home, "reviewed/entries");
  put(extraSource, "// Synthetic reviewed source\n"); mkdirSync(extraDirectory);
  const agents = openCode ? ["claude", "hermes", "opencode"] as const : ["claude", "hermes"] as const;
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: [...agents], command: "/fixture/skills", allowRootAliases: alias }));
  const pathWitness = join(home, "settings-reader");
  if (dependency === "path") symlinkSync(settingsPath, pathWitness);
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [
    { agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: captureDiscoveryByteSources([settingsPath]) },
    ...(automaticHermes ? [] : [{ agent: "hermes" as const, roots: dependency === "root" ? [claudeRoot] : [], pluginHooks: "reviewed-no-skill-injection" as const,
      sources: [...captureDiscoveryByteSources([join(home, ".hermes/config.yaml"), extraSource, ...(dependency === "source" ? [settingsPath] : [])]),
        ...(dependency === "path" ? captureDiscoveryPathSources([pathWitness]) : [])],
      directories: captureDiscoveryDirectories([join(home, ".hermes/plugins"), join(home, ".hermes/hermes-agent"), extraDirectory, ...(dependency === "directory" ? [claudeRoot] : [])]) }]),
  ] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: [...agents], discoveryInputs: review, allowRootAliases: alias }));
  return { home, dataDir, policyPath, settingsPath, extraSource, extraDirectory, claudeRoot, pathWitness };
}
function update(f: ReturnType<typeof fixture>, noOp = false) {
  const before = read(f.settingsPath), value = JSON.parse(before);
  if (!noOp) value.hooks.Stop = [{ hooks: [{ type: "command", command: "synthetic-owned-stop" }] }];
  return { home: f.home, dataDir: f.dataDir, events: ["Stop"] as const, expectedSettingsSha256: sha(before), replacement: noOp ? before : JSON.stringify(value) };
}
const plan = (f: ReturnType<typeof fixture>, noOp = false) => planClaudeHookEventsUpdate(update(f, noOp))!;
const guard = (f: ReturnType<typeof fixture>, agent: "claude" | "hermes" | "opencode") => assertManagedAgentBridge(agent, { ...f, projectDir: f.home });

test("unrelated untrusted Hermes does not prevent a Claude-only transaction or gain trust", () => {
  const f = fixture(), before = JSON.parse(read(f.policyPath));
  expect(() => guard(f, "claude")).not.toThrow();
  expect(() => guard(f, "hermes")).toThrow("trust");
  const pending = plan(f);
  expect(pending.managedAgentChecks?.agents).toEqual(["claude"]);
  expect(pending.discoveryBefore?.map(binding => binding.agent)).toEqual(["claude", "hermes"]);
  expect(pending.nativeSkills.every(entry => entry.agent === "claude")).toBe(true);
  applyAgentIntegration(pending);
  const after = JSON.parse(read(f.policyPath));
  expect(after.bridge.discovery.hermes).toEqual(before.bridge.discovery.hermes);
  expect(after.bridge.supervisors).toEqual(before.bridge.supervisors);
  expect(after.bridge.commands).toEqual(before.bridge.commands);
  expect(after.bridge.profiles).toEqual(before.bridge.profiles);
  expect(after.bridge.agents).toEqual(before.bridge.agents);
  expect(existsSync(join(f.home, ".hermes/shell-hooks-allowlist.json"))).toBe(false);
  expect(() => guard(f, "claude")).not.toThrow();
  expect(() => guard(f, "hermes")).toThrow("trust");
});

test.each([false, true])("no-op and real updates preserve unrelated automatic discovery (noOp=%s)", noOp => {
  const f = fixture("none", false, false, true), before = read(f.policyPath);
  const pending = plan(f, noOp);
  expect(pending.managedAgentChecks?.agents).toEqual(["claude"]);
  expect(pending.discoveryAfter?.find(binding => binding.agent === "hermes")).toEqual(JSON.parse(before).bridge.discovery.hermes);
  applyAgentIntegration(pending);
  if (noOp) { expect(pending.changes).toEqual([]); expect(read(f.policyPath)).toBe(before); }
  expect(() => guard(f, "claude")).not.toThrow();
  expect(() => guard(f, "hermes")).toThrow("trust");
});

test.each(["source", "root", "directory"] as const)("Hermes %s dependence still requires its own native trust", dependency => {
  for (const alias of [false, true]) {
    const f = fixture(dependency, alias), before = read(f.settingsPath), policyBefore = read(f.policyPath);
    expect(() => plan(f)).toThrow("trust");
    expect(read(f.settingsPath)).toBe(before);
    expect(read(f.policyPath)).toBe(policyBefore);
  }
});

test("a path-bytes reader resolving to the target refuses without renewing its identity", () => {
  const f = fixture("path"), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  expect(() => plan(f)).toThrow("intersects a planned write");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test.each(["source", "directory"] as const)("unrelated %s drift is refused before rebinding", target => {
  const f = fixture(), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  if (target === "source") put(f.extraSource, "// Unreviewed changed source\n");
  else put(join(f.extraDirectory, "unreviewed.js"), "// Added entry\n");
  expect(() => plan(f)).toThrow("changed");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test("a real unrelated source rewrite between verification and rebind is never adopted", () => {
  const f = fixture(), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  // Isolate the fault injection to this freshly spawned test process. The real
  // verifier runs first; then a writer changes an actual reviewed source file.
  const script = `
import { mock } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [discoveryPath, integrationPath, home, dataDir, settingsPath, extraSource] = process.argv.slice(2);
const original = { ...await import(discoveryPath) };
let armed = true;
mock.module(discoveryPath, () => ({ ...original, verifyAgentDiscovery(binding, ...args) {
  original.verifyAgentDiscovery(binding, ...args);
  if (armed && binding.agent === "hermes") { armed = false; writeFileSync(extraSource, "// Concurrent changed source\\n"); }
} }));
const { planClaudeHookEventsUpdate } = await import(integrationPath);
const before = readFileSync(settingsPath, "utf8"), value = JSON.parse(before);
value.hooks.Stop = [{ hooks: [{ type: "command", command: "synthetic-owned-stop" }] }];
let refused = false;
try { planClaudeHookEventsUpdate({ home, dataDir, events: ["Stop"], expectedSettingsSha256: createHash("sha256").update(before).digest("hex"), replacement: JSON.stringify(value) }); }
catch (error) { refused = error.message.includes("Native discovery input changed; run skills hook install with a fresh discovery review:") && error.message.endsWith(extraSource); }
if (armed || !refused) throw Error("Expected unrelated source race refusal");
console.log(JSON.stringify({ refused, injected: !armed }));
`;
  const path = join(f.home, "race-check.mjs"); writeFileSync(path, script);
  const child = Bun.spawnSync([process.execPath, path, new URL("./agent-discovery.ts", import.meta.url).href,
    new URL("./agent-integration.ts", import.meta.url).href, f.home, f.dataDir, f.settingsPath, f.extraSource],
  { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual({ refused: true, injected: true });
  expect(read(f.extraSource)).toBe("// Concurrent changed source\n");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test.each(["source", "directory", "settings", "policy"] as const)("apply still rejects concurrent %s changes outside runtime scope", target => {
  const f = fixture(), pending = plan(f), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  if (target === "source") put(f.extraSource, "// Concurrent source\n");
  else if (target === "directory") put(join(f.extraDirectory, "concurrent.js"), "// Concurrent entry\n");
  else put(target === "settings" ? f.settingsPath : f.policyPath, (target === "settings" ? before : policyBefore) + "\n");
  expect(() => applyAgentIntegration(pending)).toThrow();
  expect(read(f.settingsPath)).toBe(before + (target === "settings" ? "\n" : ""));
  expect(read(f.policyPath)).toBe(policyBefore + (target === "policy" ? "\n" : ""));
});

test("automatic root closure cannot be replaced with an empty apparently clean witness set", () => {
  const f = fixture("none", false, false, true), policy = JSON.parse(read(f.policyPath));
  policy.bridge.discovery.hermes.sources = [];
  put(f.policyPath, JSON.stringify(policy));
  const before = read(f.policyPath);
  expect(() => plan(f)).toThrow("discovery roots changed");
  expect(read(f.policyPath)).toBe(before);
});

test.each(["method", "commands", "profiles"] as const)("unrelated malformed %s bindings still refuse", field => {
  const f = fixture(), policy = JSON.parse(read(f.policyPath));
  if (field === "method") policy.bridge.discovery.hermes.method = "unknown";
  else delete policy.bridge[field].hermes;
  put(f.policyPath, JSON.stringify(policy));
  expect(() => plan(f)).toThrow("Invalid managed discovery");
});

test("the explicit OpenCode compatibility reader remains guarded", () => {
  const f = fixture("none", false, true), pending = plan(f);
  expect(pending.managedAgentChecks?.agents).toEqual(["claude", "opencode"]);
  put(join(f.home, ".config/opencode/plugins/skills-cli.js"), "// Changed native compatibility reader\n");
  const before = read(f.settingsPath), policyBefore = read(f.policyPath);
  expect(() => applyAgentIntegration(pending)).toThrow("OpenCode bridge protection changed");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
});

test("post-write affected-consumer failure rolls back settings and policy", () => {
  const f = fixture(), pending = plan(f), before = read(f.settingsPath), policyBefore = read(f.policyPath);
  const change = pending.changes.find(change => change.path === f.policyPath)!;
  const broken = JSON.parse(change.after); broken.bridge.commands.claude = "synthetic-wrong-command";
  change.after = JSON.stringify(broken);
  expect(() => applyAgentIntegration(pending)).toThrow("NATIVE_SKILL_DRIFT");
  expect(read(f.settingsPath)).toBe(before);
  expect(read(f.policyPath)).toBe(policyBefore);
  expect(() => guard(f, "claude")).not.toThrow();
  expect(() => guard(f, "hermes")).toThrow("trust");
});

test("an existing policy without Claude coverage never selects standalone writing", () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-no-claude-consumer-")); homes.push(home);
  const dataDir = join(home, ".hasna/skills");
  admitCorpusFixture(join(home, ".codex"));
  const restore = installCorpusInspectorFixture();
  try { applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["codex"] })); }
  finally { restore(); }
  expect(() => planClaudeHookEventsUpdate({ home, dataDir, events: ["Stop"], expectedSettingsSha256: "absent", replacement: '{"hooks":{"Stop":[]}}' })).toThrow("Missing managed Claude discovery coverage");
  expect(existsSync(join(home, ".claude/settings.json"))).toBe(false);
});
