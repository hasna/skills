import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { reviewedReinstallFixture } from "./agent-reviewed-reinstall.fixture.js";
import { captureClaudeSettingsV2 } from "./claude-settings-witness.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories } from "./agent-discovery.js";
import { hermesHookDefinitions } from "./agent-hermes.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture(alias = false, cache = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-reviewed-reinstall-")); homes.push(home);
  const dataDir = join(home, ".hasna/skills"), root = join(home, alias ? "native-claude" : ".claude");
  if (alias) { mkdirSync(root); symlinkSync(root, join(home, ".claude")); }
  const plugin = reviewedReinstallFixture(home, root, cache ? join(root, "plugins/cache/fixture/reviewed/1.0.0") : undefined);
  const options = { home, dataDir, agents: ["claude"] as ["claude"], ...(alias ? { allowRootAliases: true } : {}) };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: plugin.review(), command: "/opt/bin/skills", profileId: "fleet" }));
  const policyPath = join(dataDir, "agent-policy.json");
  const policy = () => JSON.parse(readFileSync(policyPath, "utf8"));
  const changePolicy = (change: (value: any) => void) => { const value = policy(); change(value); writeFileSync(policyPath, JSON.stringify(value)); };
  return { ...plugin, ...options, policyPath, policy, changePolicy, options };
}

test("unchanged reviewed plugin hooks plan and reinstall without a replacement review", () => {
  const f = fixture(), before = readFileSync(f.policyPath, "utf8");
  const plan = planAgentIntegration(f.options);
  expect(plan.changes).toEqual([]);
  expect(plan.discoveryBefore?.[0]).toEqual(f.policy().bridge.discovery.claude);
  expect(applyAgentIntegration(plan).changed).toEqual([]);
  expect(readFileSync(f.policyPath, "utf8")).toBe(before);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home, profileId: "fleet" })).not.toThrow();
});

test("retained review coverage accepts reordered source object keys without rewriting policy", () => {
  const f = fixture();
  f.changePolicy(p => { p.bridge.discovery.claude.sources = p.bridge.discovery.claude.sources.map((source: object) => Object.fromEntries(Object.entries(source).reverse())); });
  const before = readFileSync(f.policyPath, "utf8"), plan = planAgentIntegration(f.options);
  expect(plan.changes).toEqual([]);
  expect(applyAgentIntegration(plan).changed).toEqual([]);
  expect(readFileSync(f.policyPath, "utf8")).toBe(before);
});

for (const field of ["settings", "registry", "manifest", "hook", "source"] as const) test(`stored review refuses changed ${field} without refreshing its witnesses`, () => {
  const f = fixture(), before = readFileSync(f.policyPath, "utf8");
  if (field === "settings" || field === "manifest") writeFileSync(f[field], JSON.stringify({ ...JSON.parse(readFileSync(f[field], "utf8")), fixtureDrift: true }));
  else writeFileSync(f[field], readFileSync(f[field], "utf8") + "\n");
  expect(() => planAgentIntegration(f.options)).toThrow("fresh discovery review");
  expect(readFileSync(f.policyPath, "utf8")).toBe(before);
});

test("stored directory coverage rejects a newly added plugin hook source", () => {
  const f = fixture(); f.put(join(f.plugin, "scripts/new.js"), "// New unreviewed source\n");
  expect(() => planAgentIntegration(f.options)).toThrow("directory membership changed");
});

test("a stored review cannot rely on projected configuration coverage alone", () => {
  const f = fixture();
  f.changePolicy(p => { p.bridge.discovery.claude.sources = p.bridge.discovery.claude.sources.filter((s: any) => s.path !== f.settings || s.format !== undefined); });
  expect(() => planAgentIntegration(f.options)).toThrow("configuration source");
});

for (const mutation of ["home", "agent", "command", "digest"] as const) test(`stored review preserves the managed ${mutation} custody gate`, () => {
  const f = fixture(); f.changePolicy(p => {
    if (mutation === "home") p.bridge.home = join(f.home, "other-home");
    if (mutation === "agent") p.bridge.discovery.claude.agent = "codex";
    if (mutation === "command") delete p.bridge.commands.claude;
    if (mutation === "digest") p.bridge.digest = "invalid";
  });
  expect(() => planAgentIntegration(f.options)).toThrow(mutation === "agent" ? "invalid collection bounds" : "NATIVE_SKILL_DRIFT");
});

test("explicit review replaces drift while empty explicit inputs do not silently reuse stored approval", () => {
  const f = fixture(); f.put(f.source, "// Newly reviewed source.\n");
  expect(() => planAgentIntegration({ ...f.options, discoveryInputs: { version: 1, agents: [] } })).toThrow("--discovery-inputs");
  applyAgentIntegration(planAgentIntegration({ ...f.options, discoveryInputs: f.review() }));
  expect(planAgentIntegration(f.options).changes).toEqual([]);
});

test("missing and automatic discovery bindings still use ordinary discovery", () => {
  for (const method of [undefined, "automatic"]) {
    const f = fixture(); f.changePolicy(p => { if (method) p.bridge.discovery.claude.method = method; else delete p.bridge.discovery.claude; });
    expect(() => planAgentIntegration(f.options)).toThrow("plugin hooks require a separate");
  }
});

test("review reuse allows explicit command and profile changes after checking the prior binding", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ ...f.options, command: "/opt/new/skills", profileId: "engineering" }));
  expect(f.policy().bridge.commands.claude).toBe("/opt/new/skills");
  expect(f.policy().bridge.profiles.claude).toBe("engineering");
  expect(planAgentIntegration(f.options).changes).toEqual([]);
});

test("versioned semantic witnesses remain unchanged and hook drift still refuses reuse", () => {
  const f = fixture();
  const review = f.review(); review.agents[0]!.sources[0] = captureClaudeSettingsV2(f.settings);
  applyAgentIntegration(planAgentIntegration({ ...f.options, discoveryInputs: review }));
  const before = f.policy().bridge.discovery.claude;
  expect(planAgentIntegration(f.options).discoveryAfter?.[0]).toEqual(before);
  const settings = JSON.parse(readFileSync(f.settings, "utf8")); settings.hooks.Stop = [{ hooks: [{ type: "command", command: "unreviewed" }] }];
  writeFileSync(f.settings, JSON.stringify(settings));
  expect(() => planAgentIntegration(f.options)).toThrow("fresh discovery review");
});

test("review reuse preserves explicit alias opt-in and refuses retargeted root aliases", () => {
  const f = fixture(true);
  expect(planAgentIntegration(f.options).changes).toEqual([]);
  expect(() => planAgentIntegration({ ...f.options, allowRootAliases: false })).toThrow();
  unlinkSync(join(f.home, ".claude")); const replacement = join(f.home, "other-claude"); mkdirSync(replacement); symlinkSync(replacement, join(f.home, ".claude"));
  expect(() => planAgentIntegration(f.options)).toThrow("root alias changed");
});

test("apply rechecks reviewed bridge protection even for an unchanged plan", () => {
  const f = fixture(), plan = planAgentIntegration(f.options), before = readFileSync(f.policyPath, "utf8");
  f.put(join(f.home, ".claude/skills/unreviewed/SKILL.md"), "Synthetic unreviewed payload\n");
  expect(() => applyAgentIntegration(plan)).toThrow("unexpected native skill copies");
  expect(readFileSync(f.policyPath, "utf8")).toBe(before);
});

test("reuse checks exact Hermes native trust before planning and again before applying", () => {
  const f = fixture(), config = join(f.home, ".hermes/config.yaml"), plugin = join(f.home, "hermes-plugin");
  f.put(config, "skills:\n  inline_shell: false\n"); mkdirSync(plugin);
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["hermes"], discoveryInputs: { version: 1, agents: [{ agent: "hermes", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: captureDiscoveryByteSources([config]), directories: captureDiscoveryDirectories([plugin]) }] } }));
  const options = { ...f, agents: ["hermes"] as ["hermes"] };
  expect(() => planAgentIntegration(options)).toThrow("approve the exact managed commands");
  const trust = join(f.home, ".hermes/shell-hooks-allowlist.json");
  f.put(trust, JSON.stringify({ approvals: Object.entries(hermesHookDefinitions({ runtime: process.execPath, path: join(f.dataDir, "agent-hooks/hermes.js") })).map(([event, entry]) => ({ event, command: entry.command })) }));
  const plan = planAgentIntegration(options); expect(plan.changes).toEqual([]);
  rmSync(trust);
  expect(() => applyAgentIntegration(plan)).toThrow("approve the exact managed commands");
});

for (const schema of ["missing-version", "legacy-version", "string-version", "array-plugins"] as const) test(`reviewed Claude reinstall refuses ${schema} registrations before writing`, () => {
  const f = fixture(), before = readFileSync(f.policyPath, "utf8");
  const registry = JSON.parse(readFileSync(f.registry, "utf8"));
  if (schema === "missing-version") delete registry.version;
  if (schema === "legacy-version") registry.version = 1;
  if (schema === "string-version") registry.version = "2";
  if (schema === "array-plugins") registry.plugins = [];
  writeFileSync(f.registry, JSON.stringify(registry));
  expect(() => planAgentIntegration({ ...f.options, discoveryInputs: f.review() })).toThrow("Reviewed Claude installed plugin registrations are invalid");
  expect(readFileSync(f.policyPath, "utf8")).toBe(before);
});

for (const cache of [false, true]) test(`reviewed Claude root alias preserves canonical ${cache ? "cache" : "custom"} registrations`, () => {
  const f = fixture(true, cache);
  expect(planAgentIntegration(f.options).changes).toEqual([]);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home, profileId: "fleet" })).not.toThrow();
  expect(() => planAgentIntegration({ ...f.options, allowRootAliases: false })).toThrow("symlink");
});

test("reviewed Claude cache alias still requires exact canonical registration source coverage", () => {
  const f = fixture(true, true), review = f.review();
  review.agents[0]!.sources = review.agents[0]!.sources.filter(source => source.path !== f.registry);
  expect(() => planAgentIntegration({ ...f.options, discoveryInputs: review })).toThrow("bind installed registrations");
});

test("reviewed Claude cache alias refuses a nested cache alias", () => {
  const f = fixture(true, true), alias = join(f.plugin, "..", "linked");
  symlinkSync(f.plugin, alias);
  writeFileSync(f.registry, JSON.stringify({ version: 2, plugins: { "reviewed@fixture": [{ scope: "user", installPath: alias }] } }));
  expect(() => planAgentIntegration({ ...f.options, discoveryInputs: f.review() })).toThrow("symlink");
});

test("reviewed Claude registrations through an approved root alias retain cache closure checks", () => {
  const f = fixture(true, true);
  writeFileSync(f.registry, JSON.stringify({ version: 2, plugins: { "reviewed@fixture": [{ scope: "user", installPath: join(f.home, ".claude/plugins/cache/fixture/reviewed/1.0.0") }] } }));
  const plan = planAgentIntegration({ ...f.options, discoveryInputs: f.review() });
  applyAgentIntegration(plan);
  expect(planAgentIntegration(f.options).changes).toEqual([]);
});
