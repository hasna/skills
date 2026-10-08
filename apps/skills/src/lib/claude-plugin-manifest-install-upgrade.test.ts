import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { captureDiscoveryPathSources } from "./agent-discovery.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const put = (path: string, contents: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, contents); };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("installed semantic manifest witnesses survive retired cache removal without accepting active or native skill drift", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-retired-semantic-manifest-"));
  homes.push(home);
  const parent = join(home, ".claude/plugins/cache/market/plugin");
  const retired = join(parent, "1.0.0"), active = join(parent, "2.0.0");
  const settings = join(home, ".claude/settings.json"), registry = join(home, ".claude/plugins/installed_plugins.json");
  const projectPath = join(home, "project");
  put(settings, JSON.stringify({ enabledPlugins: { "plugin@market": true } }));
  const rows = [{ scope: "user", installPath: active, version: "2.0.0" },
    { scope: "project", projectPath, installPath: active, version: "2.0.0" }];
  const registryText = JSON.stringify({ version: 2, plugins: { "plugin@market": rows } });
  put(registry, registryText);
  for (const root of [retired, active]) {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: root === retired ? "1.0.0" : "2.0.0", skills: "./skills" }));
    put(join(root, "hooks/hooks.json"), JSON.stringify({ modules: ["register.ts"] }));
    put(join(root, "hooks/modules/register.ts"), "export function registerPlugin() {}\n");
    mkdirSync(join(root, "skills"), { recursive: true });
  }
  const paths = [settings, registry, ...[retired, active].flatMap(root =>
    [".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/modules/register.ts"].map(path => join(root, path)))];
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: { version: 1, agents: [{
    agent: "claude", roots: [join(retired, "skills"), join(active, "skills")],
    sources: paths.map(path => ({ path, sha256: sha(readFileSync(path, "utf8")) })), pluginHooks: "reviewed-no-skill-injection",
  }] } }));
  const policyPath = join(options.dataDir, "agent-policy.json");
  const originalSources = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources;
  for (const root of [retired, active]) {
    expect(originalSources.find((source: { path: string }) => source.path === join(root, ".claude-plugin/plugin.json")).hashMode).toBe("claude-plugin-manifest-v1");
  }
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  renameSync(retired, join(home, "preserved-retired"));
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  applyAgentIntegration(planAgentIntegration(options));
  expect(JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources).toEqual(originalSources);

  const manifest = join(active, ".claude-plugin/plugin.json"), manifestText = readFileSync(manifest, "utf8");
  put(manifest, JSON.stringify({ name: "plugin", skills: "./changed-skills" }));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
  put(manifest, manifestText);
  const hooks = join(active, "hooks/hooks.json"), hookText = readFileSync(hooks, "utf8");
  renameSync(hooks, join(home, "preserved-active-hooks"));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
  put(hooks, hookText);
  renameSync(active, join(home, "preserved-active"));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
  renameSync(join(home, "preserved-active"), active);
  put(registry, JSON.stringify({ version: 2, plugins: { "plugin@market": [rows[0], { ...rows[1], version: "3.0.0" }] } }));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
  put(registry, registryText);
  put(join(active, "skills/unreviewed/SKILL.md"), "---\nname: unreviewed\ndescription: synthetic regression fixture\n---\nUnknown native skill.\n");
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
});

test("reviewed absent plugin witnesses survive manifest upgrade and still refuse reappearance", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-absent-manifest-"));
  homes.push(home);
  const active = join(home, ".claude/plugins/cache/market/plugin/0.1.2");
  const retired = join(home, ".claude/plugins/cache/market/plugin/0.1.1");
  const manifest = join(active, ".claude-plugin/plugin.json");
  const absentManifest = join(retired, ".claude-plugin/plugin.json");
  const absentHooks = join(retired, "hooks/hooks.json");
  const settings = join(home, ".claude/settings.json");
  const registrations = join(home, ".claude/plugins/installed_plugins.json");
  put(settings, JSON.stringify({ enabledPlugins: { "plugin@market": true } }));
  put(registrations, JSON.stringify({ version: 2, plugins: { "plugin@market": [{ scope: "user", installPath: active }] } }));
  put(manifest, JSON.stringify({ name: "plugin", version: "0.1.2" }));
  const absentSources = [absentManifest, absentHooks].map(path => ({ path, hashMode: "bytes" as const, sha256: null }));
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const plan = planAgentIntegration({ ...options, discoveryInputs: { version: 1, agents: [{
    agent: "claude", roots: [join(active, "skills"), join(retired, "skills")],
    sources: [...[settings, registrations, manifest].map(path => ({ path, sha256: sha(readFileSync(path, "utf8")) })), ...absentSources],
    pluginHooks: "reviewed-no-skill-injection",
  }] } });
  // An absent witness is a real assertion, including between planning and apply.
  put(absentManifest, JSON.stringify({ name: "unexpected" }));
  expect(() => applyAgentIntegration(plan)).toThrow("Native discovery input changed");
  rmSync(absentManifest);
  applyAgentIntegration(plan);
  const policyPath = join(options.dataDir, "agent-policy.json");
  const sources = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources;
  for (const absent of absentSources) expect(sources.find((source: { path: string }) => source.path === absent.path)).toEqual(absent);
  expect(sources.find((source: { path: string }) => source.path === manifest).hashMode).toBe("claude-plugin-manifest-v1");
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  put(manifest, JSON.stringify({ name: "plugin", version: "0.1.3", description: "New metadata" }));
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  put(absentHooks, "{}");
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
});

test("legacy raw plugin manifest witnesses stay strict until guarded hook installation preserves and upgrades the policy", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-plugin-upgrade-"));
  homes.push(home);
  const plugin = join(home, ".claude/plugins/cache/market/hasna-autogoal/0.1.2"), manifest = join(plugin, ".claude-plugin/plugin.json");
  put(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "hasna-autogoal@market": true } }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({
    version: 2,
    plugins: { "hasna-autogoal@market": [{ scope: "user", installPath: plugin }] },
  }));
  put(manifest, JSON.stringify({ name: "hasna-autogoal", version: "0.1.2", description: "Agent guidance" }));
  mkdirSync(join(plugin, "skills"), { recursive: true });
  const dataDir = join(home, "skills-data"), options = { home, dataDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  applyAgentIntegration(planAgentIntegration(options));

  const policyPath = join(dataDir, "agent-policy.json"), originalManifest = readFileSync(manifest, "utf8");
  const policy = JSON.parse(readFileSync(policyPath, "utf8")), binding = policy.bridge.discovery.claude;
  const source = binding.sources.find((item: { path: string }) => item.path === manifest);
  delete source.hashMode;
  source.sha256 = sha(originalManifest);
  writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n");
  const legacyPolicy = readFileSync(policyPath, "utf8");

  put(manifest, JSON.stringify({ name: "hasna-autogoal", version: "0.1.3", description: "Updated metadata" }));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");

  const plan = planAgentIntegration(options), applied = applyAgentIntegration(plan);
  const upgraded = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources.find((item: { path: string }) => item.path === manifest);
  expect(upgraded.hashMode).toBe("claude-plugin-manifest-v1");
  expect(applied.backups.some(path => readFileSync(path, "utf8") === legacyPolicy)).toBe(true);
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
});

test("reviewed hook plugins migrate only after exact raw manifest and hook review", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-reviewed-plugin-upgrade-"));
  homes.push(home);
  const plugin = join(home, ".claude/plugins/cache/market/hasna-autogoal/0.1.2");
  const manifest = join(plugin, ".claude-plugin/plugin.json"), hooks = join(plugin, "hooks/hooks.json");
  const register = join(plugin, "hooks/modules/register.ts"), runtime = join(plugin, "hooks/modules/runtime.ts");
  const settings = join(home, ".claude/settings.json"), registrations = join(home, ".claude/plugins/installed_plugins.json");
  put(settings, JSON.stringify({ enabledPlugins: { "hasna-autogoal@market": true } }));
  put(registrations, JSON.stringify({ version: 2, plugins: { "hasna-autogoal@market": [{ scope: "user", installPath: plugin }] } }));
  const originalManifest = JSON.stringify({ name: "hasna-autogoal", version: "0.1.2", description: "Agent guidance", skills: "./skills" });
  const originalHooks = JSON.stringify({ modules: ["register.ts"] });
  const originalRegister = 'import { registerAutoGoal } from "./runtime";\nregisterAutoGoal();\n';
  const originalRuntime = "export function registerAutoGoal() {}\n";
  put(manifest, originalManifest);
  put(hooks, originalHooks);
  put(register, originalRegister);
  put(runtime, originalRuntime);
  mkdirSync(join(plugin, "skills"), { recursive: true });

  const dataDir = join(home, "skills-data"), base = { home, dataDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const reviewed = () => ({ version: 1 as const, agents: [{
    agent: "claude" as const,
    roots: [join(plugin, "skills")],
    sources: [settings, registrations, manifest, hooks, register, runtime].map(path => ({ path, sha256: sha(path) })),
    pluginHooks: "reviewed-no-skill-injection" as const,
  }] });
  const incomplete = reviewed();
  incomplete.agents[0]!.sources = incomplete.agents[0]!.sources.filter(source => source.path !== hooks);
  expect(() => planAgentIntegration({ ...base, discoveryInputs: incomplete })).toThrow("separately reviewed exact hook file sources");
  applyAgentIntegration(planAgentIntegration({ ...base, discoveryInputs: reviewed() }));

  const policyPath = join(dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const binding = policy.bridge.discovery.claude;
  const manifestSource = binding.sources.find((item: { path: string }) => item.path === manifest);
  expect(manifestSource.hashMode).toBe("claude-plugin-manifest-v1");
  const hookSource = binding.sources.find((item: { path: string }) => item.path === hooks);
  expect(hookSource.hashMode).toBeUndefined();
  expect(binding.sources.find((item: { path: string }) => item.path === register).sha256).toBe(sha(register));
  expect(binding.sources.find((item: { path: string }) => item.path === runtime).sha256).toBe(sha(runtime));

  delete manifestSource.hashMode;
  manifestSource.sha256 = sha(manifest);
  writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n");
  const legacyPolicy = readFileSync(policyPath, "utf8");
  put(manifest, JSON.stringify({ name: "hasna-autogoal", version: "0.1.3", description: "Updated guidance", skills: "./skills" }));
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).toThrow("NATIVE_SKILL_DRIFT");

  const upgraded = applyAgentIntegration(planAgentIntegration({ ...base, discoveryInputs: reviewed() }));
  const after = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources;
  expect(after.find((item: { path: string }) => item.path === manifest).hashMode).toBe("claude-plugin-manifest-v1");
  expect(after.find((item: { path: string }) => item.path === hooks).hashMode).toBeUndefined();
  expect(after.find((item: { path: string }) => item.path === register).sha256).toBe(sha(register));
  expect(after.find((item: { path: string }) => item.path === runtime).sha256).toBe(sha(runtime));
  expect(upgraded.backups.some(path => readFileSync(path, "utf8") === legacyPolicy)).toBe(true);
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).not.toThrow();

  const metadataOnly = JSON.stringify({ name: "hasna-autogoal", version: "0.1.4", description: "Another summary", skills: "./skills" });
  put(manifest, metadataOnly);
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).not.toThrow();
  put(manifest, JSON.stringify({ name: "hasna-autogoal", version: "0.1.4", description: "Another summary", skills: "./changed-skills" }));
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).toThrow("NATIVE_SKILL_DRIFT");
  put(manifest, metadataOnly);
  put(hooks, JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "changed" }] }] } }));
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).toThrow("NATIVE_SKILL_DRIFT");
  put(hooks, originalHooks);
  put(runtime, "export function registerAutoGoal() { return \"changed\"; }\n");
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).toThrow("NATIVE_SKILL_DRIFT");
});


test("retired plugin cache version requires fresh exact review before guarded policy rebind", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-retired-plugin-version-"));
  homes.push(home);
  const id = "plugin@marketplace";
  const oldRoot = join(home, ".claude/plugins/cache/marketplace/plugin/0.1.2");
  const newRoot = join(home, ".claude/plugins/cache/marketplace/plugin/0.1.4");
  const settings = join(home, ".claude/settings.json"), registrations = join(home, ".claude/plugins/installed_plugins.json");
  const dataDir = join(home, "skills-data"), options = { home, dataDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const writePlugin = (root: string, version: string) => {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version, description: "Reviewed metadata", skills: "./skills" }));
    put(join(root, "hooks/hooks.json"), JSON.stringify({ modules: ["register.ts"] }));
    put(join(root, "hooks/modules/register.ts"), 'import { registerPlugin } from "./runtime";\nregisterPlugin();\n');
    put(join(root, "hooks/modules/runtime.ts"), "export function registerPlugin() {}\n");
    mkdirSync(join(root, "skills"), { recursive: true });
  };
  const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const reviewed = (root: string) => {
    const manifest = join(root, ".claude-plugin/plugin.json"), hooks = join(root, "hooks/hooks.json");
    const register = join(root, "hooks/modules/register.ts"), runtime = join(root, "hooks/modules/runtime.ts");
    return { version: 1 as const, agents: [{ agent: "claude" as const, roots: [join(root, "skills")],
      sources: [settings, registrations, manifest, hooks, register, runtime].map(path => ({ path, sha256: hashFile(path) })),
      pluginHooks: "reviewed-no-skill-injection" as const }] };
  };

  put(settings, JSON.stringify({ enabledPlugins: { [id]: true } }));
  writePlugin(oldRoot, "0.1.2");
  put(registrations, JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user", installPath: oldRoot }] } }));
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: reviewed(oldRoot) }));

  const policyPath = join(dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const oldManifest = join(oldRoot, ".claude-plugin/plugin.json");
  const oldSource = policy.bridge.discovery.claude.sources.find((source: { path: string }) => source.path === oldManifest);
  expect(oldSource).toBeDefined();
  delete oldSource.hashMode;
  oldSource.sha256 = hashFile(oldManifest);
  writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n");
  const legacyPolicy = readFileSync(policyPath, "utf8");

  writePlugin(newRoot, "0.1.4");
  put(registrations, JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user", installPath: newRoot }] } }));
  rmSync(oldRoot, { recursive: true, force: true });
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");

  const applied = applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: reviewed(newRoot) }));
  expect(applied.backups.some(path => readFileSync(path, "utf8") === legacyPolicy)).toBe(true);
  const sources = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources;
  // The runtime.ts drift check at the end relies on runtime.ts being a reviewed source. The
  // reviewed path enforces only hooks.json and a declared hooks target; other plugin files are
  // bound only when the review lists them. Fail here, by name, if the fixture stops listing it.
  const reviewedRuntime = join(newRoot, "hooks/modules/runtime.ts");
  expect(sources.map((source: { path: string }) => source.path)).toContain(reviewedRuntime);
  expect(sources.some((source: { path: string }) => source.path.startsWith(oldRoot + "/"))).toBe(false);
  expect(sources.find((source: { path: string }) => source.path === join(newRoot, ".claude-plugin/plugin.json")).hashMode).toBe("claude-plugin-manifest-v1");
  for (const relative of ["hooks/hooks.json", "hooks/modules/register.ts", "hooks/modules/runtime.ts"]) {
    const path = join(newRoot, relative);
    expect(sources.find((source: { path: string }) => source.path === path).sha256).toBe(hashFile(path));
  }
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();

  put(join(newRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: "0.1.5", description: "Updated metadata", skills: "./skills" }));
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  put(join(newRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: "0.1.5", description: "Updated metadata", skills: "./changed-skills" }));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
  put(join(newRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: "0.1.5", description: "Updated metadata", skills: "./skills" }));
  put(join(newRoot, "hooks/modules/runtime.ts"), "export function registerPlugin() { return 'changed'; }\n");
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
});

test("reviewed Claude discovery requires the current registered cache manifest and hook closure", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-active-cache-review-"));
  homes.push(home);
  const parent = join(home, ".claude/plugins/cache/market/plugin");
  const retired = join(parent, "1.0.0"), active = join(parent, "1.0.4"), activeProject = join(parent, "1.0.5");
  const settings = join(home, ".claude/settings.json"), registry = join(home, ".claude/plugins/installed_plugins.json");
  const id = "plugin@market", unrelated = "swift-lsp@claude-plugins-official";
  put(settings, JSON.stringify({ enabledPlugins: { [id]: true, [unrelated]: true } }));
  put(registry, JSON.stringify({ version: 2, plugins: {
    [id]: [
      { scope: "project", projectPath: join(home, "project-a"), installPath: active, version: "1.0.4" },
      { scope: "project", projectPath: join(home, "project-b"), installPath: activeProject, version: "1.0.5" },
    ],
    [unrelated]: [{ scope: "local", installPath: join(home, ".claude/local/swift-lsp") }],
  } }));
  const writePlugin = (root: string, version: string) => {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version, skills: "./skills" }));
    put(join(root, "hooks/hooks.json"), JSON.stringify({ modules: ["register.ts"] }));
    put(join(root, "hooks/modules/register.ts"), 'import "./runtime";\n');
    put(join(root, "hooks/modules/runtime.ts"), "export function registerPlugin() {}\n");
    mkdirSync(join(root, "skills"), { recursive: true });
  };
  writePlugin(retired, "1.0.0");
  writePlugin(active, "1.0.4");
  writePlugin(activeProject, "1.0.5");
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const files = (roots: string[]) => [settings, registry, ...roots.flatMap(root => [
    ".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/modules/register.ts", "hooks/modules/runtime.ts",
  ].map(relative => join(root, relative)))];
  const reviewed = (roots: string[], paths: string[]) => ({ version: 1 as const, agents: [{
    agent: "claude" as const,
    roots: roots.map(root => join(root, "skills")),
    sources: paths.map(path => ({ path, sha256: sha(readFileSync(path, "utf8")) })),
    pluginHooks: "reviewed-no-skill-injection" as const,
  }] });

  // The prior review still covers the retired tree and current settings/registry,
  // but omits the active registered plugin cache entirely. It must fail before a
  // policy plan can be applied, even while the retired tree still exists. An
  // unrelated enabled local-scope integration is outside this cache check.
  const incomplete = reviewed([retired], files([retired]));
  expect(() => planAgentIntegration({ ...options, discoveryInputs: incomplete })).toThrow("active Claude cache plugin");

  const complete = reviewed([retired, active, activeProject], files([retired, active, activeProject]));
  expect(() => planAgentIntegration({ ...options, discoveryInputs: complete })).not.toThrow();
  const missingHookSource = reviewed([retired, active, activeProject], files([retired, active, activeProject]).filter(path => path !== join(active, "hooks/hooks.json")));
  expect(() => planAgentIntegration({ ...options, discoveryInputs: missingHookSource })).toThrow("separately reviewed exact hook file sources");
  const missingProjectRoot = { ...complete, agents: [{ ...complete.agents[0]!, roots: [join(retired, "skills"), join(active, "skills")] }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: missingProjectRoot })).toThrow("skill root is not covered");
  const explicitBytes = { ...complete, agents: [{ ...complete.agents[0]!, sources: complete.agents[0]!.sources.map(source => source.path === registry ? { ...source, hashMode: "bytes" as const } : source) }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: explicitBytes })).not.toThrow();
});

test("reviewed Claude inputs without enabled cache plugins do not acquire a registry requirement", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-no-cache-review-"));
  homes.push(home);
  const settings = join(home, ".claude/settings.json");
  put(settings, JSON.stringify({ enabledPlugins: { "swift-lsp@claude-plugins-official": true } }));
  const localRoot = join(home, ".claude/local/swift-lsp");
  mkdirSync(localRoot, { recursive: true });
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const review = { version: 1 as const, agents: [{ agent: "claude" as const, roots: [localRoot],
    sources: [{ path: settings, sha256: sha(readFileSync(settings, "utf8")) }], pluginHooks: "reviewed-no-skill-injection" as const }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: review })).not.toThrow();
});

test("reviewed Claude policy apply remains valid after the old cache is removed", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-reviewed-cache-retirement-"));
  homes.push(home);
  const parent = join(home, ".claude/plugins/cache/market/plugin"), old = join(parent, "1.0.0"), active = join(parent, "1.0.4");
  const settings = join(home, ".claude/settings.json"), registry = join(home, ".claude/plugins/installed_plugins.json");
  put(settings, JSON.stringify({ enabledPlugins: { "plugin@market": true } }));
  put(registry, JSON.stringify({ version: 2, plugins: { "plugin@market": [{ scope: "user", installPath: active, version: "1.0.4" }] } }));
  const writePlugin = (root: string, version: string) => {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version, skills: "./skills" }));
    put(join(root, "hooks/hooks.json"), JSON.stringify({ modules: ["./register.ts"] }));
    put(join(root, "hooks/register.ts"), 'import "./runtime";\n');
    put(join(root, "hooks/runtime.ts"), "export function registerPlugin() {}\n");
    put(join(root, "README.md"), "Ordinary unreviewed prose asset; not an executable discovery input.\n");
    mkdirSync(join(root, "skills"), { recursive: true });
  };
  writePlugin(old, "1.0.0"); writePlugin(active, "1.0.4");
  const paths = [settings, registry, ...[old, active].flatMap(root => [
    ".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.ts", "hooks/runtime.ts",
  ].map(relative => join(root, relative)))];
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const discoveryInputs = { version: 1 as const, agents: [{ agent: "claude" as const,
    roots: [join(old, "skills"), join(active, "skills")], sources: paths.map(path => ({ path, sha256: sha(readFileSync(path, "utf8")) })),
    pluginHooks: "reviewed-no-skill-injection" as const }] };
  const policyPath = join(options.dataDir, "agent-policy.json");
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs }));
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  const persisted = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude;
  expect(persisted.sources.find((source: { path: string }) => source.path === join(active, ".claude-plugin/plugin.json")).hashMode)
    .toBe("claude-plugin-manifest-v1");
  renameSync(old, join(home, "preserved-old-cache"));
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
});

test("reviewed Claude discovery preserves a typed absence witness for active plugins without plugin.json", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-optional-plugin-manifest-"));
  homes.push(home);
  const active = join(home, ".claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0");
  const settings = join(home, ".claude/settings.json"), registry = join(home, ".claude/plugins/installed_plugins.json");
  const manifest = join(active, ".claude-plugin/plugin.json"), id = "swift-lsp@claude-plugins-official";
  put(settings, JSON.stringify({ enabledPlugins: { [id]: true } }));
  put(registry, JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user", installPath: active, version: "1.0.0" }] } }));
  mkdirSync(join(active, "skills"), { recursive: true });
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const sources = [
    { path: settings, sha256: sha(readFileSync(settings, "utf8")) },
    { path: registry, sha256: sha(readFileSync(registry, "utf8")) },
    ...captureDiscoveryPathSources([manifest]),
  ];
  const review = { version: 1 as const, agents: [{ agent: "claude" as const, roots: [join(active, "skills")], sources,
    pluginHooks: "reviewed-no-skill-injection" as const }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: review })).not.toThrow();
  const missingAbsenceWitness = { ...review, agents: [{ ...review.agents[0]!, sources: sources.filter(source => source.path !== manifest) }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: missingAbsenceWitness })).toThrow("path-bytes witness");
  const untypedAbsence = { ...review, agents: [{ ...review.agents[0]!, sources: [...sources.filter(source => source.path !== manifest), { path: manifest, hashMode: "bytes" as const, sha256: null }] }] };
  expect(() => planAgentIntegration({ ...options, discoveryInputs: untypedAbsence })).toThrow("path-bytes witness");
});
