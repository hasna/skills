import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { captureDiscoveryDirectories, resolveAgentDiscovery, projectNativeDiscoveryFields, verifyAgentDiscovery } from "./agent-discovery.js";
import { scaffoldPortableSkill, portPortableSkill, writeCorpusSkill, installCorpusSkillAtomically } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";
import { captureClaudeSettingsV5 } from "./claude-settings-witness.js";
import { hashClaudePluginManifest } from "./claude-plugin-manifest-witness.js";

// The runner confines TMPDIR and HOME to a credential-free sandbox. Retain
// fixtures for evidence rather than removing anything outside that contract.
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(agent: "claude" | "opencode" = "claude") {
  const home = mkdtempSync(join(tmpdir(), "authoring-discovery-"));
  const config = join(home, agent === "claude" ? ".claude/settings.json" : ".config/opencode/opencode.json");
  put(config, "{}");
  const binding = resolveAgentDiscovery({ home, agent });
  // Retained full-file reviews are deliberately stricter than root exclusion.
  binding.method = "reviewed";
  binding.sources[0] = { path: config, sha256: createHash("sha256").update("{}").digest("hex") };
  const policy = join(home, ".hasna/skills/agent-policy.json");
  const save = () => put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { [agent]: binding } } }));
  save();
  return { home, config, binding, policy, save, rootDir: join(home, "corpus"), homeDir: home };
}
function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(path, entry.name), relative + "/");
      else result[relative] = createHash("sha256").update(readFileSync(join(path, entry.name))).digest("hex");
    }
  }
  visit(root, ""); return result;
}
test("unchanged portable authoring works with a retained review", () => {
  const f = fixture();
  expect(() => scaffoldPortableSkill("boundary-fixture", { ...f, kind: "instruction" })).not.toThrow();
});
test("settings-only drift permits prepare, preserves dry-run bytes and leaves policy unchanged", () => {
  const f = fixture();
  scaffoldPortableSkill("boundary-fixture", { ...f, kind: "instruction" });
  const before = bytes(f.rootDir), policy = readFileSync(f.policy, "utf8");
  const manifestPath = join(f.rootDir, "boundary-fixture/skill.json");
  const oldManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  put(f.config, JSON.stringify({ model: "ordinary-model-change", theme: "light", permissions: { allow: ["Read"] } }));
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("Native discovery input changed");
  const dry = prepareSkill("boundary-fixture", { ...f, version: "0.1.1", dryRun: true });
  expect(dry.written).toBe(false); expect(bytes(f.rootDir)).toEqual(before);
  const result = prepareSkill("boundary-fixture", { ...f, version: "0.1.1" });
  expect(result.written).toBe(true);
  const after = bytes(f.rootDir);
  expect(Object.keys(after).filter(name => after[name] !== before[name])).toEqual(["boundary-fixture/skill.json"]);
  const newManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  expect(newManifest).toEqual({ ...oldManifest, version: "0.1.1", provenance: { ...oldManifest.provenance, content_hash: result.contentHash } });
  expect(readFileSync(f.policy, "utf8")).toBe(policy);
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("Native discovery input changed");
});
test("stale witness unions retained and newly supported custom roots", () => {
  const f = fixture("opencode"), old = join(f.home, "old-custom"), current = join(f.home, "new-custom");
  f.binding.roots = [old]; f.save();
  put(f.config, JSON.stringify({ skills: { paths: [current] } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "safe"), f)).not.toThrow();
  for (const root of [old, current]) expect(() => assertPortableAuthoringPath(join(root, "payload"), f)).toThrow("configured native discovery root");
});

const name = "boundary-fixture";
const writers = {
  scaffold: (options: ReturnType<typeof fixture>) => scaffoldPortableSkill(name, { ...options, kind: "instruction" }),
  port: (options: ReturnType<typeof fixture>) => portPortableSkill(join(options.home, "source", name), { ...options, allowShadow: true }),
  corpus: (options: ReturnType<typeof fixture>) => writeCorpusSkill({ name, skillMd: "# Fixture" }, options),
  atomicCorpus: (options: ReturnType<typeof fixture>) => installCorpusSkillAtomically({ name, skillMd: "# Fixture" }, options),
  prepare: (options: ReturnType<typeof fixture>) => prepareSkill(name, { ...options, version: "0.1.1", dryRun: true }),
};
test("every guarded payload writer refuses default and retained/current custom roots before mutation", () => {
  for (const writer of Object.values(writers)) {
    const f = fixture("opencode"), old = join(f.home, "old-custom"), current = join(f.home, "new-custom");
    scaffoldPortableSkill(name, { ...f, rootDir: join(f.home, "source"), kind: "instruction" });
    f.binding.roots = [old]; f.save();
    put(f.config, JSON.stringify({ skills: { paths: [current] } }));
    for (const rootDir of [join(f.home, ".claude/skills"), old, current]) {
      const before = bytes(f.home);
      expect(() => writer({ ...f, rootDir })).toThrow("native discovery root");
      expect(bytes(f.home)).toEqual(before);
      expect(existsSync(join(rootDir, name))).toBe(false);
    }
  }
});
test("physical aliases and absent descendants cannot hide default or custom roots", () => {
  const f = fixture("opencode"), custom = join(f.home, "custom");
  mkdirSync(custom); mkdirSync(join(f.home, ".claude/skills"), { recursive: true });
  put(f.config, JSON.stringify({ skills: { paths: [custom] } }));
  for (const [alias, target] of [["native-alias", join(f.home, ".claude/skills")], ["custom-alias", custom]]) {
    const path = join(f.home, alias); symlinkSync(target, path);
    expect(() => assertPortableAuthoringPath(join(path, "absent", "descendant"), f)).toThrow("native discovery root");
  }
  symlinkSync(join(f.home, "gone"), join(f.home, "dangling"));
  put(f.config, JSON.stringify({ skills: { paths: [join(f.home, "dangling")] } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "safe"), f)).toThrow();
});
test("unknown, malformed, ambiguous and unbounded discovery controls fail before corpus creation", () => {
  const configs = [
    { extraSkillRoots: ["/unknown"] }, { hooks: [] }, { permissions: { additionalDirectories: "bad" } },
    { env: { CLAUDE_CONFIG_DIR: "/elsewhere" } }, { apiKeyHelper: "opaque-command" },
    { enabledPlugins: [] }, { enabledPlugins: { "missing@market": true } },
  ];
  for (const config of configs) {
    const f = fixture(); put(f.config, JSON.stringify(config));
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow();
    expect(existsSync(f.rootDir)).toBe(false);
  }
  const f = fixture(); put(f.config, '{"enabledPlugins":{},"enabledPlugins":{}}');
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow("duplicate JSON key");
  for (const skills of [{ paths: "bad" }, { paths: ["relative"] }, { paths: ["/expanded/$ROOT"] }, { newPaths: [] }, { paths: Array(513).fill("/custom") }]) {
    const g = fixture("opencode"); put(g.config, JSON.stringify({ skills }));
    expect(() => scaffoldPortableSkill(name, { ...g, kind: "instruction" })).toThrow();
    expect(existsSync(g.rootDir)).toBe(false);
  }
});
test("invalid policy, wrong-home bindings and relative retained roots fail closed", () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => put(f.policy, "invalid"),
    (f: ReturnType<typeof fixture>) => put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: join(f.home, "other"), discovery: { claude: f.binding } } })),
    (f: ReturnType<typeof fixture>) => { f.binding.roots = ["relative"]; f.save(); },
    (f: ReturnType<typeof fixture>) => { f.binding.sources[0]!.path = join(f.home, "another/settings.json"); f.save(); },
  ]) {
    const f = fixture(); mutation(f);
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow();
    expect(existsSync(f.rootDir)).toBe(false);
  }
});
test("reviewed V5 hooks allow irrelevant settings drift but still block changed executable inputs", () => {
  const f = fixture();
  const implementation = join(f.home, "hook.js"); put(implementation, 'console.log("reviewed");');
  const hooks = { SessionStart: [{ hooks: [{ type: "command", command: `bun ${implementation}` }] }] };
  put(f.config, JSON.stringify({ hooks, model: "before" }));
  f.binding.sources[0] = captureClaudeSettingsV5(f.config);
  f.binding.sources.push({ path: implementation, hashMode: "bytes", sha256: createHash("sha256").update(readFileSync(implementation)).digest("hex") }); f.save();
  put(f.config, JSON.stringify({ hooks, model: "after" }));
  const before = bytes(f.home);
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  expect(bytes(f.home)).toEqual(before);
  put(f.config, JSON.stringify({ hooks: { SessionStart: [] }, model: "after" }));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("current settings review");
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("Native discovery input changed");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("legacy opaque hooks cannot manufacture a narrowed review after drift", () => {
  const f = fixture();
  const hooks = { SessionStart: [{ hooks: [{ type: "command", command: "opaque-command" }] }] };
  const original = JSON.stringify({ hooks, model: "before" }); put(f.config, original);
  f.binding.sources[0]!.sha256 = createHash("sha256").update(original).digest("hex"); f.save();
  put(f.config, JSON.stringify({ hooks, model: "after" }));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("current settings review");
  expect(existsSync(join(f.home, ".hasna/skills/native-witness-narrowed.json"))).toBe(false);
  expect(existsSync(f.rootDir)).toBe(false);
});
test("missing recorded runtime targets refuse instead of trusting retained roots", () => {
  const f = fixture();
  const config = join(f.home, ".gemini/settings.json"); put(config, "{}");
  const binding = resolveAgentDiscovery({ home: f.home, agent: "gemini", executable: null });
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { gemini: binding }, discoveryExecutables: { gemini: { command: "gemini", path: join(f.home, "missing/gemini"), target: join(f.home, "runtime/gemini") } } } }));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("runtime target is unresolved");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("current supported plugin roots are excluded and ambiguous registrations refuse", () => {
  const f = fixture(), plugin = join(f.home, "plugin"), custom = join(plugin, "custom");
  put(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "fixture", skills: ["./custom"] }));
  const registry = join(f.home, ".claude/plugins/installed_plugins.json");
  const row = { installPath: plugin, scope: "user" };
  put(registry, JSON.stringify({ version: 2, plugins: { "fixture@market": [row] } }));
  put(f.config, JSON.stringify({ enabledPlugins: { "fixture@market": true } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(custom, name), f)).toThrow("configured native discovery root");
  put(registry, JSON.stringify({ version: 2, plugins: { "fixture@market": [row, row] } }));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("missing or ambiguous");
  expect(existsSync(f.rootDir)).toBe(false);
});

test("Codex profile, MCP and instruction controls cannot bypass root exclusion", () => {
  for (const text of [
    '[profiles.test.skills]\npaths = ["/unknown"]\n',
    '[mcp_servers.opaque]\ncommand = "opaque"\n',
    'model_instructions_file = "/unknown"\n',
    '[features]\nnew_skill_discovery = true\n',
  ]) {
    const f = fixture(); put(join(f.home, ".codex/config.toml"), text);
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("unknown discovery controls");
    expect(existsSync(f.rootDir)).toBe(false);
  }
});

test("oversized and invalid UTF8 native controls refuse before authoring", () => {
  const f = fixture();
  writeFileSync(f.config, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow();
  expect(existsSync(f.rootDir)).toBe(false);
  put(f.config, JSON.stringify({ model: "x".repeat(1024 * 1024) }));
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("bounded regular file");
  expect(existsSync(f.rootDir)).toBe(false);
});

test("reviewed plugin hooks retain exact executable inputs while descriptive metadata may vary", () => {
  const f = fixture(), plugin = join(f.home, "plugin");
  const manifest = join(plugin, ".claude-plugin/plugin.json"), hook = join(plugin, "hooks/hooks.json");
  const metadata = { name: "fixture", skills: ["./skills"], hooks: "./hooks/hooks.json", description: "Before" };
  const implementation = join(plugin, "hook.js"); put(implementation, 'console.log("reviewed");');
  put(manifest, JSON.stringify(metadata)); put(hook, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `bun ${implementation}` }] }] } }));
  put(join(f.home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "fixture@market": [{ installPath: plugin, scope: "user" }] } }));
  put(f.config, JSON.stringify({ enabledPlugins: { "fixture@market": true } }));
  const reviewed = resolveAgentDiscovery({ home: f.home, agent: "claude", reviewed: { version: 1, agents: [{ agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [
    captureClaudeSettingsV5(f.config), { path: manifest, hashMode: "claude-plugin-manifest-v1", sha256: hashClaudePluginManifest(readFileSync(manifest, "utf8")) },
    ...[hook, implementation].map(path => ({ path, hashMode: "bytes" as const, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  ] }] } });
  Object.assign(f.binding, reviewed); f.save();
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  put(manifest, JSON.stringify({ ...metadata, description: "After" }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(plugin, "skills", name), f)).toThrow("configured native discovery root");
  put(hook, '{"hooks":{"SessionStart":[]}}');
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("current independently reviewed sources");
  expect(existsSync(f.rootDir)).toBe(false);
});

test("Sumi canonical config uses its owning resolver without a legacy .sumi directory", () => {
  const f = fixture(), custom = join(f.home, "sumi-custom"), bin = join(f.home, "bin");
  put(join(f.home, ".config/sumi/sumi.json"), JSON.stringify({ skills: [custom] }));
  const command = join(bin, "sumi-paths");
  put(command, `#!${process.execPath}\nconst home = process.argv[process.argv.indexOf("--home") + 1];
const cwd = process.argv[process.argv.indexOf("--cwd") + 1];
const config = home + "/.config/sumi";
console.log(JSON.stringify({ schemaVersion: 1, kind: "sumi-paths", home, cwd,
  roots: { data: home + "/sumi-data", cache: home + "/sumi-cache", config, state: home + "/sumi-state" },
  legacyRoots: { data: null, cache: null, config: null, state: null },
  configFiles: { canonical: config + "/sumi.json", legacy: null }, skillRoots: { canonical: config + "/skills", legacy: null } }));\n`);
  chmodSync(command, 0o755);
  const previous = process.env.PATH;
  try {
    process.env.PATH = bin + ":" + previous;
    expect(existsSync(join(f.home, ".sumi"))).toBe(false);
    expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
    expect(() => assertPortableAuthoringPath(join(custom, name), f)).toThrow("configured native discovery root");
    process.env.PATH = "/no-sumi-resolver";
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("SUMI_PATH_RESOLVER_UNAVAILABLE");
    expect(existsSync(f.rootDir)).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
  }
});

test("field projections cannot stand in for a full opaque-hook review", () => {
  const f = fixture();
  const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "opaque" }] }] } });
  put(f.config, text);
  f.binding.sources = [{ path: f.config, format: "json", fields: ["enabledPlugins"], sha256: projectNativeDiscoveryFields(text, "json", ["enabledPlugins"], f.config) }]; f.save();
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("current settings review");
  expect(existsSync(f.rootDir)).toBe(false);
});


function opaqueFixture(typed = false, pluginHook = false, directories = true) {
  const f = fixture(), script = join(f.home, "executor/hook.js"), dependency = join(f.home, "executor/dependencies/helper.js");
  put(script, `require(${JSON.stringify(dependency)});`); put(dependency, 'console.log("reviewed harmless output");');
  const hooks = { SessionStart: [{ hooks: [{ type: "command", command: `bun ${script}` }] }] };
  const declared: string[] = [];
  if (pluginHook) {
    const plugin = join(f.home, "custom-plugin"), manifest = join(plugin, ".claude-plugin/plugin.json"), declaration = join(plugin, "hooks/hooks.json");
    put(manifest, JSON.stringify({ name: "fixture", hooks: "./hooks/hooks.json", skills: ["./skills"] }));
    put(declaration, JSON.stringify({ hooks }));
    put(join(f.home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "fixture@market": [{ installPath: plugin, scope: "user" }] } }));
    put(f.config, JSON.stringify({ enabledPlugins: { "fixture@market": true }, model: "before" }));
    declared.push(manifest, declaration);
  } else put(f.config, JSON.stringify({ hooks, model: "before" }));
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const sources = [typed ? captureClaudeSettingsV5(f.config) : { path: f.config, hashMode: "bytes" as const, sha256: sha(f.config) },
    ...[script, dependency, ...declared].map(path => ({ path, hashMode: "bytes" as const, sha256: sha(path) }))];
  const directory = dirname(dependency); mkdirSync(join(directory, "empty"));
  const binding = resolveAgentDiscovery({ home: f.home, agent: "claude", reviewed: { version: 1, agents: [{ agent: "claude", roots: [], sources,
    ...(directories ? { directories: captureDiscoveryDirectories([directory]) } : {}), pluginHooks: "reviewed-no-skill-injection" }] } });
  Object.assign(f.binding, binding); f.save();
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  return { ...f, script, dependency, directory, hooks };
}
test("unchanged direct hook settings do not outlive a changed retained executable", () => {
  const f = opaqueFixture();
  put(f.script, `console.log(require("node:fs").readFileSync(${JSON.stringify(join(f.rootDir, name, "SKILL.md"))}, "utf8"));`);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("typed settings may drift irrelevantly while every retained hook dependency stays current", () => {
  const f = opaqueFixture(true);
  put(f.config, JSON.stringify({ hooks: f.hooks, model: "after", theme: "light" }));
  const before = bytes(f.home);
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  expect(bytes(f.home)).toEqual(before);
  put(f.dependency, `console.log(require("node:fs").readFileSync(${JSON.stringify(join(f.rootDir, name, "SKILL.md"))}, "utf8"));`);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("reviewed plugin declaration and manifest cannot outlive their executable dependency", () => {
  const f = opaqueFixture(true, true);
  put(f.dependency, 'console.log("changed executable behavior");');
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("retained dependency absence, removal and directory membership remain binding", () => {
  const added = opaqueFixture(true), optional = join(added.home, "optional-dependency.js");
  added.binding.sources.push({ path: optional, hashMode: "bytes", sha256: null }); added.save();
  expect(() => assertPortableAuthoringPath(join(added.rootDir, name), added)).not.toThrow();
  put(optional, 'console.log("added executable input");');
  expect(() => scaffoldPortableSkill(name, { ...added, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(added.rootDir)).toBe(false);
  const removed = opaqueFixture(true, false, false);
  renameSync(removed.dependency, join(removed.home, "preserved-helper.js"));
  expect(() => scaffoldPortableSkill(name, { ...removed, kind: "instruction" })).toThrow("Native discovery input changed");
  expect(existsSync(removed.rootDir)).toBe(false);
  for (const mutation of ["add", "remove"] as const) {
    const f = opaqueFixture(true);
    if (mutation === "add") put(join(f.directory, "new-helper.js"), 'console.log("new dependency");');
    else renameSync(join(f.directory, "empty"), join(f.home, "preserved-empty"));
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("Native discovery directory membership changed");
    expect(existsSync(f.rootDir)).toBe(false);
  }
});
test("opaque hooks without a retained executable closure remain unavailable", () => {
  const f = fixture();
  put(f.config, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "opaque-command" }] }] } }));
  f.binding.sources = [captureClaudeSettingsV5(f.config)]; f.save();
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("dependency closure is unavailable");
  expect(existsSync(f.rootDir)).toBe(false);
});
test("current and retained filesystem-root exclusions contain every descendant", () => {
  for (const retained of [false, true]) {
    const f = fixture("opencode");
    if (retained) { f.binding.roots = ["/"]; f.save(); }
    else put(f.config, JSON.stringify({ skills: { paths: ["/"] } }));
    expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow("configured native discovery root");
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow("configured native discovery root");
    expect(existsSync(f.rootDir)).toBe(false);
  }
  const f = fixture("opencode"), alias = join(f.home, "root-alias"); symlinkSync("/", alias);
  put(f.config, JSON.stringify({ skills: { paths: [alias] } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow("configured native discovery root");
  put(f.config, JSON.stringify({ skills: { paths: [join(f.home, "native")] } }));
  expect(() => assertPortableAuthoringPath(join(f.home, "native-sibling", name), f)).not.toThrow();
});
