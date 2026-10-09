import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAgentIntegration, archiveNativeSkills, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-bridge-")); roots.push(home);
  admitCorpusFixture(join(home, ".codex"));
  const dataDir = join(home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  return { home, dataDir, agents: ["claude", "codex"] as const };
}
function options() { const f = fixture(); return { ...f, agents: [...f.agents] }; }

test("installation creates one owned CLI bridge per agent and migration preserves only those exact bytes", () => {
  const f = options(), plan = planAgentIntegration(f);
  for (const agent of f.agents) expect(existsSync(join(f.home, `.${agent}`, "skills", "skills-cli"))).toBe(false);
  expect(plan.changes.filter(change => change.path.endsWith("/skills-cli/SKILL.md"))).toHaveLength(2);
  applyAgentIntegration(plan);
  const inventory = inventoryNativeSkills(f.home, { agents: [...f.agents] });
  expect(inventory).toHaveLength(2);
  for (const entry of inventory) {
    expect(entry).toMatchObject({ bridge: true, managed: true, vendor: false });
    expect(readdirSync(entry.path).sort()).toEqual([".hasna-skills.json", "SKILL.md"]);
    expect(readFileSync(join(entry.path, "SKILL.md"), "utf8")).toContain("skills load");
  }
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true }).entries).toEqual([]);
  expect(planAgentIntegration(f).changes).toEqual([]);
});

test("renamed or tampered bridge copies never inherit the migration exemption", () => {
  const f = options(); applyAgentIntegration(planAgentIntegration(f));
  const claude = join(f.home, ".claude", "skills", "skills-cli"), renamed = join(f.home, ".claude", "skills", "renamed");
  renameSync(claude, renamed);
  const codex = join(f.home, ".codex", "skills", "skills-cli");
  writeFileSync(join(codex, "extra-instructions.md"), "Do not trust this extra content\n");
  const inventory = inventoryNativeSkills(f.home, { agents: [...f.agents] });
  expect(inventory.filter(entry => entry.bridge)).toEqual([]);
  expect(() => planAgentIntegration(f)).toThrow("bridge");
  const archived = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true });
  expect(archived.entries).toHaveLength(2);
  expect(readFileSync(join(archived.entries.find(entry => entry.source === codex)!.archive, "extra-instructions.md"), "utf8")).toContain("extra content");
});

test("policy extensions survive integration and an intervening policy edit refuses the entire plan", () => {
  const f = options(), path = join(f.dataDir, "agent-policy.json");
  writeFileSync(path, JSON.stringify({ version: 1, loading: "cli", profileId: "default", extension: { keep: "original" } }));
  const plan = planAgentIntegration(f);
  const edited = JSON.stringify({ version: 1, loading: "cli", profileId: "default", extension: { keep: "new edit" } });
  writeFileSync(path, edited);
  expect(() => applyAgentIntegration(plan)).toThrow("changed after planning");
  expect(readFileSync(path, "utf8")).toBe(edited);
  expect(existsSync(join(f.home, ".claude", "settings.json"))).toBe(false);
  applyAgentIntegration(planAgentIntegration(f));
  expect(JSON.parse(readFileSync(path, "utf8")).extension).toEqual({ keep: "new edit" });
});

test("explicit vendor retirement removes only discovery documents and preserves shared executable assets", () => {
  const f = options(), plugin = join(f.home, ".claude", "plugins", "cache", "market", "plugin", "1.0.0");
  const skill = join(plugin, "skills", "vendor-review");
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "Vendor instructions.\n");
  writeFileSync(join(skill, "scripts", "shared.js"), "export const shared = true;\n");
  writeFileSync(join(plugin, "plugin.json"), '{"preserved":true}\n');
  const inventory = inventoryNativeSkills(f.home, { agents: [...f.agents], includeVendor: true });
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true }).entries).toEqual([]);
  const receipt = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeVendor: true });
  expect(receipt.entries).toHaveLength(1);
  expect(existsSync(join(skill, "SKILL.md"))).toBe(false);
  expect(readFileSync(receipt.entries[0]!.archive, "utf8")).toBe("Vendor instructions.\n");
  expect(readFileSync(join(skill, "scripts", "shared.js"), "utf8")).toBe("export const shared = true;\n");
  expect(readFileSync(join(plugin, "plugin.json"), "utf8")).toBe('{"preserved":true}\n');
});

test("Gemini, OpenCode and Cursor plans preserve unrelated settings and install their native prompt adapters", () => {
  const f = options();
  const paths = { gemini: join(f.home, ".gemini", "settings.json"), opencode: join(f.home, ".config", "opencode", "opencode.json"), cursor: join(f.home, ".cursor", "hooks.json") };
  for (const path of Object.values(paths)) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify({ unrelated: { retained: true } })); }
  const plan = planAgentIntegration({ ...f, agents: ["gemini", "opencode", "cursor"] });
  applyAgentIntegration(plan);
  for (const path of Object.values(paths)) expect(JSON.parse(readFileSync(path, "utf8")).unrelated).toEqual({ retained: true });
  const gemini = JSON.parse(readFileSync(paths.gemini, "utf8"));
  expect(gemini.hooks.BeforeAgent[0].hooks[0].command).toContain("--agent gemini");
  const cursor = JSON.parse(readFileSync(paths.cursor, "utf8"));
  expect(cursor.hooks.beforeSubmitPrompt[0].command).toContain("--agent cursor");
  const opencode = JSON.parse(readFileSync(paths.opencode, "utf8"));
  expect(opencode.permission.skill).toEqual({ "*": "deny", "skills-cli": "allow" });
  expect(existsSync(join(f.home, ".config", "opencode", "plugins", "skills-cli.js"))).toBe(true);
  expect(inventoryNativeSkills(f.home, { agents: ["gemini", "opencode", "cursor"] }).filter(entry => entry.bridge)).toHaveLength(3);
  expect(planAgentIntegration({ ...f, agents: ["gemini", "opencode", "cursor"] }).changes).toEqual([]);
});

test("a failed installation rolls back newly created bridge directories so a fresh plan remains usable", () => {
  const f = options(), plan = planAgentIntegration(f);
  const target = plan.changes.find(change => change.path.endsWith("/.claude/settings.json"))!;
  Object.defineProperty(target, "after", { get: () => { throw new Error("Fixture write failure"); } });
  expect(() => applyAgentIntegration(plan)).toThrow("Fixture write failure");
  expect(existsSync(join(f.home, ".claude", "skills", "skills-cli"))).toBe(false);
  expect(existsSync(join(f.dataDir, "agent-policy.json"))).toBe(false);
  expect(() => planAgentIntegration(f)).not.toThrow();
});

for (const vendor of [false, true]) test(`an exhausted ${vendor ? "vendor" : "native"} discovery bound never certifies a partial inventory`, () => {
  const f = options(), path = join(f.home, ".claude", ...(vendor ? ["plugins", "cache"] : ["skills"]), ...Array.from({ length: vendor ? 34 : 15 }, (_, index) => `nested-${index}`));
  mkdirSync(path, { recursive: true }); writeFileSync(join(path, "SKILL.md"), "Deep native instructions\n");
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude"], includeVendor: true })).toThrow("discovery limit");
  expect(() => planAgentIntegration(f)).toThrow("discovery limit");
});

test("Codex restored built-ins are allowed only at their bound digest and disabled path, while the bridge is enabled", () => {
  const f = options(), system = join(f.home, ".codex", "skills", ".system", "skill-creator"), config = join(f.home, ".codex", "config.toml"), bridge = join(f.home, ".codex", "skills", "skills-cli", "SKILL.md");
  mkdirSync(system, { recursive: true }); writeFileSync(join(system, "SKILL.md"), "Packaged builtin fixture\n");
  writeFileSync(config, `model = "preserved"\n[[skills.config]]\npath = ${JSON.stringify(bridge)}\nenabled = false\n`);
  const migration = archiveNativeSkills(inventoryNativeSkills(f.home, { agents: [...f.agents], includeVendor: true }), { dataDir: f.dataDir, includeVendor: true });
  expect(migration.entries).toEqual([]);
  expect(readFileSync(join(system, "SKILL.md"), "utf8")).toBe("Packaged builtin fixture\n");
  applyAgentIntegration(planAgentIntegration(f));
  const after = readFileSync(config, "utf8"), parsed = Bun.TOML.parse(after) as any;
  expect(parsed.model).toBe("preserved");
  expect(parsed.skills.config.find((entry: any) => entry.path === bridge).enabled).toBe(true);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
  writeFileSync(config, after.replace("enabled = false", "enabled = true"));
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
  writeFileSync(config, after); writeFileSync(join(system, "SKILL.md"), "Changed builtin fixture\n");
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
});

test("account-synced plugin skills are refused and archived without removing plugin assets", () => {
  const f = options(); applyAgentIntegration(planAgentIntegration(f));
  const plugin = join(f.home, ".claude", "plugins", "synced", "fixture-plugin");
  const skill = join(plugin, "skills", "fixture-skill");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "Synthetic synced plugin instructions\n");
  writeFileSync(join(plugin, "helper.js"), "export const fixture = true;\n");
  writeFileSync(join(plugin, ".mcp.json"), '{"mcpServers":{}}');
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
  const inventory = inventoryNativeSkills(f.home, { agents: [...f.agents], includeVendor: true });
  expect(inventory.find(entry => entry.path === skill)).toMatchObject({ agent: "claude", vendor: true, managed: false });
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true }).entries).toEqual([]);
  const receipt = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeVendor: true });
  expect(receipt.entries).toHaveLength(1);
  expect(readFileSync(receipt.entries[0]!.archive, "utf8")).toBe("Synthetic synced plugin instructions\n");
  expect(readFileSync(join(plugin, "helper.js"), "utf8")).toBe("export const fixture = true;\n");
  expect(readFileSync(join(plugin, ".mcp.json"), "utf8")).toBe('{"mcpServers":{}}');
  expect(existsSync(join(skill, "SKILL.md"))).toBe(false);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
});

test("Claude bridge disables account skill reseeding and verifies the user setting", () => {
  const f = options(), path = join(f.home, ".claude", "settings.json");
  mkdirSync(join(f.home, ".claude"), { recursive: true });
  writeFileSync(path, JSON.stringify({ syncClaudeAiSkills: true, syncClaudeAiPlugins: true, unrelated: { preserve: true } }));
  applyAgentIntegration(planAgentIntegration(f));
  const config = JSON.parse(readFileSync(path, "utf8"));
  expect(config.syncClaudeAiSkills).toBe(false);
  expect(config.syncClaudeAiPlugins).toBe(true);
  expect(config.unrelated).toEqual({ preserve: true });
  expect(planAgentIntegration(f).changes).toEqual([]);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  for (const value of [true, undefined, "false"]) {
    writeFileSync(path, JSON.stringify({ ...config, syncClaudeAiSkills: value }));
    expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("syncClaudeAiSkills");
  }
});

test("native protection config drift refuses prompts without freezing unrelated configuration", () => {
  const f = options(); applyAgentIntegration(planAgentIntegration(f));
  const path = join(f.home, ".claude", "settings.json"), config = JSON.parse(readFileSync(path, "utf8"));
  config.unrelated = { new: true }; writeFileSync(path, JSON.stringify(config));
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  config.disableBundledSkills = false; writeFileSync(path, JSON.stringify(config));
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
});

test("an enabled external plugin cannot escape configured inventory, retirement or subsequent prompt checks", () => {
  const f = options(), plugin = join(f.home, "external-plugin"), skill = join(plugin, "skills", "review"), settings = join(f.home, ".claude/settings.json");
  mkdirSync(skill, { recursive: true }); mkdirSync(join(plugin, ".claude-plugin")); mkdirSync(join(f.home, ".claude/plugins"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "External plugin instructions\n");
  writeFileSync(join(skill, "shared.js"), "preserved executable asset\n");
  writeFileSync(join(plugin, ".claude-plugin/plugin.json"), '{"name":"review"}');
  writeFileSync(settings, '{"enabledPlugins":{"review@personal":true}}');
  writeFileSync(join(f.home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "review@personal": [{ scope: "user", installPath: plugin }] } }));
  const inventory = inventoryNativeSkills(f.home, { agents: [...f.agents], includeVendor: true, configured: true });
  expect(inventory.some(entry => entry.path === skill && entry.vendor)).toBe(true);
  archiveNativeSkills(inventory, { dataDir: f.dataDir, includeVendor: true });
  expect(readFileSync(join(skill, "shared.js"), "utf8")).toBe("preserved executable asset\n");
  applyAgentIntegration(planAgentIntegration(f));
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  writeFileSync(join(skill, "SKILL.md"), "Restored after plugin update\n");
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
});

test("discovery config changes between planning and application refuse before any bridge write", () => {
  const f = options(), plan = planAgentIntegration(f), config = join(f.home, ".claude/settings.json");
  mkdirSync(join(config, ".."), { recursive: true }); writeFileSync(config, '{"enabledPlugins":{"new@personal":true}}');
  expect(() => applyAgentIntegration(plan)).toThrow("discovery input changed");
  expect(existsSync(join(f.home, ".codex/skills/skills-cli"))).toBe(false);
});
