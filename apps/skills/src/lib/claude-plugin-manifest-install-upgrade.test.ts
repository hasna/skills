import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const put = (path: string, contents: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, contents); };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

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
