import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { captureSumiSettings, hashSumiSettingsReplacement } from "./sumi-settings-witness.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planAgentSettingsWitnessUpgrade } from "./agent-integration.js";
import { captureDiscoveryByteSources, resolveAgentDiscovery, verifyAgentDiscovery } from "./agent-discovery.js";

const roots: string[] = [];
const keys = ["SUMI_CONFIG", "SUMI_CONFIG_CONTENT", "SUMI_CONFIG_DIR", "SUMI_HOME", "XDG_CONFIG_HOME"];
const selectors = new Map<string, string | undefined>();
beforeEach(() => { for (const key of keys) { selectors.set(key, process.env[key]); delete process.env[key]; } });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const key of keys) { const value = selectors.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(typed = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-sumi-witness-")); roots.push(home);
  const dataDir = join(home, "data"), config = join(home, ".hasna-internal/sumi/config/sumi.json"), plugin = join(dirname(config), "plugins/reviewed.js");
  put(config, JSON.stringify({ username: "before", plugins: [{ package: "reviewed-plugin", options: { enabled: true } }], experimental: { statusline: true }, permissions: [] }));
  put(plugin, "export default { id: 'reviewed', async setup() {} };\n");
  const sources = [...(typed ? [captureSumiSettings(config)] : captureDiscoveryByteSources([config])), ...captureDiscoveryByteSources([plugin])];
  const discoveryInputs = { version: 1 as const, agents: [{ agent: "sumi" as const, roots: [], sources, pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["sumi"], discoveryInputs }));
  const policy = join(dataDir, "agent-policy.json"), preimage = join(home, "preserved/sumi.json"); put(preimage, readFileSync(config, "utf8"));
  const options = () => ({ home, dataDir, agent: "sumi" as const, reviewedPreimage: preimage, expectedPolicySha256: sha(readFileSync(policy, "utf8")), expectedSettingsSha256: sha(readFileSync(config, "utf8")) });
  return { home, dataDir, config, plugin, policy, preimage, options };
}

test("Sumi legacy reviews stay strict until exact-preimage upgrade; later display edits do not strand prompts", () => {
  const f = fixture(), originalPolicy = readFileSync(f.policy, "utf8"), originalSettings = JSON.parse(readFileSync(f.config, "utf8"));
  const changed = JSON.stringify({ ...originalSettings, username: "after", experimental: { statusline: false, compact_tools: true } }, null, 4);
  put(f.config, changed);
  expect(() => assertManagedAgentBridge("sumi", { ...f, projectDir: f.home })).toThrow("Native discovery input changed");
  expect(() => planAgentIntegration({ ...f, agents: ["sumi"] })).toThrow("Native discovery input changed");
  const plan = planAgentSettingsWitnessUpgrade(f.options());
  expect(plan.settingsWitnessUpgrade?.replacedWitnesses).toHaveLength(2);
  expect(plan.changes.map(change => change.path)).toEqual([f.policy]);
  const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(originalPolicy);
  expect(readFileSync(f.config, "utf8")).toBe(changed);
  const binding = JSON.parse(readFileSync(f.policy, "utf8")).bridge.discovery.sumi;
  expect(binding.sources.filter((source: any) => source.path === f.config).map((source: any) => source.hashMode)).toEqual(["sumi-settings-v1"]);
  put(f.config, JSON.stringify({ ...originalSettings, $schema: "https://example.test/schema.json", username: "later", experimental: { compact_tools: false, statusline: true } }));
  expect(() => assertManagedAgentBridge("sumi", { ...f, projectDir: f.home })).not.toThrow();
  expect(() => planAgentIntegration({ ...f, agents: ["sumi"] })).not.toThrow();
  // Foreign plugin review remains an exact source attestation, not a refreshed hash.
  put(f.plugin, "export default { id: 'unreviewed' };\n");
  expect(() => assertManagedAgentBridge("sumi", { ...f, projectDir: f.home })).toThrow("Native discovery input changed");
});

test("fresh typed Sumi review keeps executable, prompt, legacy and unknown authority changes closed", () => {
  const f = fixture(true), baseline = readFileSync(f.config, "utf8");
  const binding = JSON.parse(readFileSync(f.policy, "utf8")).bridge.discovery.sumi;
  expect(binding.sources.filter((source: any) => source.path === f.config)).toHaveLength(1);
  for (const delta of [
    { skills: [join(f.home, "new-skills")] }, { plugin: ["new-plugin"] },
    { plugins: [{ package: "reviewed-plugin", options: { enabled: false } }] },
    { permissions: [{ action: "skill", resource: "*", effect: "allow" }] }, { permission: { skill: "allow" } }, { tools: { skill: true } },
    { instructions: ["unreviewed.md"] }, { agents: { build: { prompt: "new" } } },
    { agent: { build: { permission: { skill: "allow" } } } }, { mode: { build: { prompt: "new" } } },
    { providers: { custom: { package: "unreviewed" } } }, { provider: { custom: { npm: "unreviewed" } } },
    { mcp: { custom: { command: ["unreviewed"] } } }, { commands: { custom: { template: "new" } } },
    { messages_aliases: [{ name: "new", sessionID: "other" }] },
    { experimental: { policies: [{ resource: "skill", effect: "allow" }] } }, { unknown_control: true },
  ]) {
    put(f.config, JSON.stringify({ ...JSON.parse(baseline), ...delta }));
    expect(() => verifyAgentDiscovery(binding)).toThrow();
    expect(() => resolveAgentDiscovery({ home: f.home, agent: "sumi", retainedReview: binding })).toThrow();
  }
  put(f.config, baseline);
  expect(() => assertManagedAgentBridge("sumi", { ...f, projectDir: f.home })).not.toThrow();
  const wrongAgent = { ...binding, agent: "claude" };
  expect(() => verifyAgentDiscovery(wrongAgent)).toThrow();
});

test("Sumi semantic upgrade refuses incorrect preimages, dropped coverage and concurrent changes", () => {
  const f = fixture(), original = readFileSync(f.config, "utf8"), originalPolicy = readFileSync(f.policy, "utf8");
  put(f.preimage, original + "\n");
  expect(() => planAgentSettingsWitnessUpgrade(f.options())).toThrow("preimage");
  put(f.preimage, original);
  put(f.config, JSON.stringify({ ...JSON.parse(original), instructions: ["new.md"] }));
  expect(() => planAgentSettingsWitnessUpgrade(f.options())).toThrow("non-display settings changed");
  put(f.config, original);
  const policy = JSON.parse(originalPolicy); policy.bridge.discovery.sumi.sources.find((source: any) => source.format === "json").fields = ["skills"];
  put(f.policy, JSON.stringify(policy));
  expect(() => planAgentSettingsWitnessUpgrade(f.options())).toThrow("unrecognized configuration witness");
  put(f.policy, originalPolicy);
  const plan = planAgentSettingsWitnessUpgrade(f.options());
  put(f.config, original + "\n");
  expect(() => applyAgentIntegration(plan)).toThrow("Native settings changed after witness planning");
  expect(readFileSync(f.policy, "utf8")).toBe(originalPolicy);
});

test("Sumi strict parser preserves unknown values and refuses ambiguous or invalid preference input", () => {
  const hash = (text: string) => hashSumiSettingsReplacement(text, { remaining: 1024 * 1024 });
  expect(hash('{"unknown":{"b":2,"a":1},"username":"one"}')).toBe(hash('{"username":"two", "unknown": {"b":2,"a":1}}'));
  expect(hash('{"permission":{"shell":{"*":"deny","safe":"allow"}}}')).not.toBe(hash('{"permission":{"shell":{"safe":"allow","*":"deny"}}}'));
  expect(hash('{"unknown":9007199254740992}')).not.toBe(hash('{"unknown":9007199254740993}'));
  for (const text of ['{"username":false}', '{"experimental":{"statusline":"yes"}}', '{"unknown":1,"unknown":2}', '{"skills":[]} trailing']) expect(() => hash(text)).toThrow();
});
