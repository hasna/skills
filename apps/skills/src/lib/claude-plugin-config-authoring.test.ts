import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, projectNativeDiscoveryFields, resolveAgentDiscovery } from "./agent-discovery.js";
import { claudeDiscoveryControlKeys, claudeDiscoveryEnvironmentKeys, captureClaudeSettingsV4 } from "./claude-settings-witness.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { scaffoldPortableSkill } from "./portable-skills.js";

useDefaultTestTimeout();
const originalPath = process.env.PATH;
beforeEach(() => { process.env.PATH = "/usr/bin:/bin"; });
afterEach(() => { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath; });
const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function fixture(hooks = false) {
  const home = mkdtempSync(join(tmpdir(), "claude-plugin-config-authoring-")), settings = join(home, ".claude/settings.json");
  const registry = join(home, ".claude/plugins/installed_plugins.json"), script = join(home, "reviewed-executor/hook.js");
  const ids = Array.from({ length: 7 }, (_, index) => `fixture-${index}@synthetic`);
  const pluginConfigs = Object.fromEntries(ids.map((id, index) => [id, { options: { label: `Fixture ${index}`, enabled: true, limit: index, choices: ["one", "two"] } }]));
  const config = { syncClaudeAiSkills: false, disableBundledSkills: true, permissions: { allow: ["Read", "Skill(skills-cli)"] }, extraKnownMarketplaces: {}, enabledPlugins: Object.fromEntries(ids.map(id => [id, true])), pluginConfigs, env: { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1", ORDINARY_PREFERENCE: "synthetic" }, ...(hooks ? { hooks: { SessionStart: [{ hooks: [{ type: "command", command: `bun ${script}` }] }] } } : {}) };
  put(settings, JSON.stringify(config)); put(script, "console.log('Synthetic reviewed executor');\n");
  const plugins = ids.map((_, index) => join(home, "reviewed-plugins", `fixture-${index}`));
  const manifests = plugins.map((plugin, index) => { const manifest = join(plugin, ".claude-plugin/plugin.json"); put(manifest, JSON.stringify({ name: `fixture-${index}`, skills: "./skills" })); return manifest; });
  put(registry, JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map((id, index) => [id, [{ scope: "user", installPath: plugins[index] }]])) }));
  const binding = resolveAgentDiscovery({ home, agent: "claude", reviewed: { version: 1, agents: [{ agent: "claude", roots: plugins.map(path => join(path, "skills")), pluginHooks: "reviewed-no-skill-injection", sources: [captureClaudeSettingsV4(settings), ...captureDiscoveryByteSources([registry, script, ...manifests])], directories: captureDiscoveryDirectories(plugins) }] } });
  const policy = join(home, ".hasna/skills/agent-policy.json"), save = () => put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude: binding } } })); save();
  const rootDir = join(home, "private-authoring"), options = { homeDir: home, rootDir };
  return { home, settings, config, binding, script, registry, policy, save, rootDir, options };
}

for (const hooks of [false, true]) test(`seven reviewed Claude plugin option entries permit private authoring ${hooks ? "with" : "without"} hooks`, () => {
  const f = fixture(hooks), policy = readFileSync(f.policy), settings = readFileSync(f.settings);
  expect(Object.keys(f.config.pluginConfigs)).toHaveLength(7);
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).not.toThrow();
  expect(readFileSync(f.policy).equals(policy)).toBe(true); expect(readFileSync(f.settings).equals(settings)).toBe(true);
  expect(scaffoldPortableSkill("synthetic-guide", { ...f.options, kind: "instruction" }).manifest.kind).toBe("instruction");
  expect(readFileSync(f.policy).equals(policy)).toBe(true); expect(readFileSync(f.settings).equals(settings)).toBe(true);
  expect(() => assertPortableAuthoringPath(join(f.home, "reviewed-plugins/fixture-0/skills/forbidden"), f.options)).toThrow("configured native discovery root");
});

for (const hooks of [false, true]) test(`literal new instruction command respects reviewed plugin options ${hooks ? "with" : "without"} hooks`, () => {
  const f = fixture(hooks), policy = hash(f.policy), settings = hash(f.settings);
  const cli = join(import.meta.dir, "../cli/index.tsx");
  const result = Bun.spawnSync({ cmd: [process.execPath, "--no-install", "--no-env-file", cli, "new", "synthetic-new-guide", "--kind", "instruction", "--description", "Synthetic authoring acceptance", "--json"], cwd: f.home,
    env: { HOME: f.home, TMPDIR: tmpdir(), PATH: "/usr/bin:/bin", HASNA_STATION: "skills-suite-no-such-keychain-account", HASNA_SKILLS_DIR: join(f.home, ".hasna/skills"), CODEX_HOME: join(f.home, ".codex"), CLAUDE_CONFIG_DIR: join(f.home, ".claude"), HASNA_SKILLS_API_URL: "http://127.0.0.1:1", SKILLS_API_URL: "http://127.0.0.1:1", NO_COLOR: "1" } });
  if (result.exitCode !== 0) throw new Error(`Literal new refused: ${result.stdout.toString()} ${result.stderr.toString()}`);
  expect(result.stderr.toString()).toBe("");
  const created = JSON.parse(result.stdout.toString());
  expect(created.manifest.kind).toBe("instruction"); expect(existsSync(join(created.path, "SKILL.md"))).toBe(true);
  expect(hash(f.policy)).toBe(policy); expect(hash(f.settings)).toBe(settings);
});

for (const mutation of ["option", "entry", "executor", "function-hook-flag", "unknown-control"]) test(`Claude option authoring refuses ${mutation} drift`, () => {
  const f = fixture(); expect(() => assertPortableAuthoringPath(join(f.rootDir, "probe"), f.options)).not.toThrow();
  if (mutation === "executor") put(f.script, "console.log('Changed executor');\n");
  else { const config: any = structuredClone(f.config); if (mutation === "option") config.pluginConfigs["fixture-0@synthetic"].options.label = "Changed"; if (mutation === "entry") config.pluginConfigs["another@synthetic"] = { options: {} }; if (mutation === "unknown-control") config.futurePluginControl = {}; if (mutation === "function-hook-flag") config.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "0"; put(f.settings, JSON.stringify(config)); }
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow();
  expect(existsSync(f.rootDir)).toBe(false);
});

for (const review of ["absent", "projected", "settings-only"]) test(`Claude options refuse ${review} executable review even without hooks`, () => {
  const f = fixture();
  if (review === "absent") put(f.policy, JSON.stringify({ loading: "cli" }));
  if (review === "settings-only") { f.binding.sources = [captureClaudeSettingsV4(f.settings)]; f.save(); }
  if (review === "projected") { const text = readFileSync(f.settings, "utf8"); f.binding.sources = [{ path: f.settings, format: "json", fields: ["enabledPlugins"], sha256: projectNativeDiscoveryFields(text, "json", ["enabledPlugins"], f.settings) }, ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save(); }
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow(); expect(existsSync(f.rootDir)).toBe(false);
});

for (const malformed of [null, [], { "fixture-0@synthetic": [] }, { "fixture-0@synthetic": {} }, { "fixture-0@synthetic": { options: "bad" } }, { "fixture-0@synthetic": { options: { nested: {} } } }, { "fixture-0@synthetic": { options: { mixed: ["ok", 1] } } }, { "fixture-0@synthetic": { options: {}, extra: true } }]) test(`Claude malformed option configuration ${JSON.stringify(malformed)} refuses even with a current full witness`, () => {
  const f = fixture(); put(f.settings, JSON.stringify({ ...f.config, pluginConfigs: malformed })); f.binding.sources = [captureClaudeSettingsV4(f.settings), ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save();
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow(); expect(existsSync(f.rootDir)).toBe(false);
});


test("owning classifiers enumerate every actual-shaped control including nested function-hook env", () => {
  const f = fixture(true), text = JSON.stringify(f.config);
  expect(claudeDiscoveryControlKeys(text).sort()).toEqual(["syncClaudeAiSkills", "env", "permissions", "disableBundledSkills", "hooks", "enabledPlugins", "extraKnownMarketplaces", "pluginConfigs"].sort());
  expect(claudeDiscoveryEnvironmentKeys(text)).toEqual(["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"]);
});

for (const flag of ["0", "1"]) test(`function-hook env flag ${flag} independently requires current settings and opaque closure`, () => {
  const f = fixture(), config: any = structuredClone(f.config); config.pluginConfigs = {}; config.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = flag;
  put(f.settings, JSON.stringify(config)); f.binding.sources = [captureClaudeSettingsV4(f.settings), ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save();
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "probe"), f.options)).not.toThrow();
  const sources = f.binding.sources;
  f.binding.sources = [captureClaudeSettingsV4(f.settings)]; f.save();
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow("dependency closure is unavailable");
  expect(existsSync(f.rootDir)).toBe(false);
  f.binding.sources = sources; f.save(); put(f.script, "console.log('Unreviewed function hook');\n");
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(f.rootDir)).toBe(false);
});

for (const invalid of [null, true, 1, [], {}, "", "true", "2", "01", " 1", "DO_NOT_ECHO_VALUE"]) test(`malformed function-hook environment flag type ${typeof invalid} refuses with current full review`, () => {
  const f = fixture(), config: any = structuredClone(f.config); config.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = invalid;
  put(f.settings, JSON.stringify(config)); f.binding.sources = [captureClaudeSettingsV4(f.settings), ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save();
  let message = ""; try { scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" }); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS flag"); expect(message).not.toContain("DO_NOT_ECHO_VALUE"); expect(existsSync(f.rootDir)).toBe(false);
});

for (const key of ["CLAUDE_CONFIG_DIR", "FUTURE_PLUGIN_ROOT"]) test(`unknown discovery env ${key} names its field but never its value`, () => {
  const f = fixture(), config: any = structuredClone(f.config); config.env[key] = "DO_NOT_ECHO_VALUE";
  put(f.settings, JSON.stringify(config)); f.binding.sources = [captureClaudeSettingsV4(f.settings), ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save();
  let message = ""; try { scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" }); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("unknown discovery controls"); expect(message).toContain(key); expect(message).toContain("env."); expect(message).toContain("settings.json"); expect(message).not.toContain("DO_NOT_ECHO_VALUE"); expect(existsSync(f.rootDir)).toBe(false);
});

for (const env of [null, [], "malformed"]) test(`malformed env container ${typeof env} refuses with a current witness`, () => {
  const f = fixture(); put(f.settings, JSON.stringify({ ...f.config, env })); f.binding.sources = [captureClaudeSettingsV4(f.settings), ...f.binding.sources.filter(source => source.path !== f.settings)]; f.save();
  expect(() => scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" })).toThrow("Claude env controls"); expect(existsSync(f.rootDir)).toBe(false);
});

test("unknown top-level discovery diagnostic names a safe field and its configuration path", () => {
  const f = fixture(); put(f.settings, JSON.stringify({ ...f.config, futurePluginControl: "DO_NOT_ECHO_VALUE" }));
  let message = ""; try { scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" }); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("futurePluginControl"); expect(message).toContain("settings.json"); expect(message).not.toContain("DO_NOT_ECHO_VALUE"); expect(existsSync(f.rootDir)).toBe(false);
});


test("unknown discovery diagnostics withhold opaque field names", () => {
  const f = fixture(), key = "plugin_" + "A".repeat(40); put(f.settings, JSON.stringify({ ...f.config, [key]: "DO_NOT_ECHO_VALUE" }));
  let message = ""; try { scaffoldPortableSkill("probe", { ...f.options, kind: "instruction" }); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("withheld field key"); expect(message).not.toContain(key); expect(message).not.toContain("DO_NOT_ECHO_VALUE"); expect(existsSync(f.rootDir)).toBe(false);
});
