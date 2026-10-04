import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { renderSumiPlugin, sumiConfigDirectory } from "./agent-sumi.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { assertProjectDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, type ReviewedDiscoveryInputs } from "./agent-discovery.js";

// Native V2 boundary fixture bound to Sumi 0.2.52, Harnesses e6776271ca8065a3a091eacedebd6fd7ef47ccd3,
// upstream 06b6c916a564c9c88af36cbd19817ba3d4ac4476. These are mutable
// SessionPrompt/SessionContext and promise Plugin shapes, not OpenCode hooks.
const roots: string[] = [];
const configSelectors = ["SUMI_CONFIG_DIR", "XDG_CONFIG_HOME", "SUMI_HOME", "SUMI_CONFIG", "SUMI_CONFIG_CONTENT"] as const;
const inheritedSelectors = new Map(configSelectors.map(key => [key, process.env[key]]));
const originalSelectors = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of configSelectors) {
    originalSelectors.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  try { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); }
  finally {
    for (const key of configSelectors) {
      const value = originalSelectors.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalSelectors.clear();
  }
});
afterAll(() => { expect(configSelectors.every(key => process.env[key] === inheritedSelectors.get(key))).toBe(true); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "skills-sumi-native-")); roots.push(root); return root; }
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

test("read-only Sumi resolver honors native selectors and adopted roots without creating state", () => {
  const home = fixture(), canonical = join(home, ".hasna-internal/sumi/config"), legacy = join(home, ".config/sumi");
  expect(sumiConfigDirectory(home, {})).toBe(canonical);
  expect(existsSync(canonical)).toBe(false);
  mkdirSync(legacy, { recursive: true });
  expect(sumiConfigDirectory(home, {})).toBe(legacy);
  mkdirSync(dirname(canonical), { recursive: true }); symlinkSync(legacy, canonical);
  expect(sumiConfigDirectory(home, {})).toBe(legacy);
  expect(sumiConfigDirectory(home, { SUMI_HOME: "~/native", XDG_CONFIG_HOME: "~/xdg", SUMI_CONFIG_DIR: "~/specific" })).toBe(join(home, "specific"));
  expect(sumiConfigDirectory(home, { SUMI_HOME: "~/native", XDG_CONFIG_HOME: "~/xdg" })).toBe(join(home, "xdg/sumi"));
  expect(sumiConfigDirectory(home, { SUMI_HOME: "~/native" })).toBe(join(home, "native/config"));
});

test("independent canonical and legacy config stores are refused", () => {
  const home = fixture();
  mkdirSync(join(home, ".hasna-internal/sumi/config"), { recursive: true }); mkdirSync(join(home, ".config/sumi"), { recursive: true });
  expect(() => sumiConfigDirectory(home, {})).toThrow("conflict");
});

test("Sumi-only integration canonicalizes reviewed home aliases before discovery guards", () => {
  const home = fixture(), dataDir = join(home, "skills-data"), workspace = join(home, "projects/workspace");
  const claude = join(workspace, ".claude"), codex = join(workspace, ".codex");
  mkdirSync(claude, { recursive: true }); mkdirSync(codex, { recursive: true });
  symlinkSync(claude, join(home, ".claude")); symlinkSync(codex, join(home, ".codex"));
  const canonical = join(home, ".hasna-internal/sumi/config"), legacy = join(home, ".config/sumi");
  const config = join(legacy, "sumi.json");
  put(config, JSON.stringify({ skills: [join(home, ".claude/skills")] }));
  mkdirSync(dirname(canonical), { recursive: true }); symlinkSync(legacy, canonical);
  const options = { home, dataDir, agents: ["sumi"] as const, projectDir: workspace };
  expect(() => planAgentIntegration({ ...options, agents: [...options.agents] })).toThrow("symlink");
  const plan = planAgentIntegration({ ...options, agents: [...options.agents], allowRootAliases: true });
  expect(plan.discoveryBefore![0]!.roots).toContain(join(claude, "skill"));
  expect(plan.discoveryBefore![0]!.roots).toContain(join(claude, "skills"));
  expect(plan.discoveryBefore![0]!.roots.some(path => path.startsWith(join(home, ".claude") + "/"))).toBe(false);
  expect(plan.changes.some(change => change.path === join(legacy, "plugins/skills-cli.js"))).toBe(true);
  expect(plan.changes.some(change => change.path.startsWith(claude + "/") || change.path.startsWith(codex + "/"))).toBe(false);
  expect(existsSync(join(legacy, "plugins/skills-cli.js"))).toBe(false);
  applyAgentIntegration(plan);
  expect(() => assertManagedAgentBridge("sumi", { home, dataDir, projectDir: workspace })).not.toThrow();
  const repeated = planAgentIntegration({ ...options, agents: [...options.agents], allowRootAliases: true });
  expect(repeated.changes).toEqual([]);
});

test("Sumi reviewed home aliases still refuse outside-home and nested symlink roots", () => {
  const home = fixture(), outside = fixture(), dataDir = join(home, "skills-data");
  symlinkSync(outside, join(home, ".claude"));
  expect(() => planAgentIntegration({ home, dataDir, agents: ["sumi"], allowRootAliases: true })).toThrow("inside the real home");
  const nestedHome = fixture(), target = join(nestedHome, "project/.claude"), nestedTarget = join(nestedHome, "native-skills");
  mkdirSync(target, { recursive: true }); mkdirSync(nestedTarget, { recursive: true });
  symlinkSync(target, join(nestedHome, ".claude")); symlinkSync(nestedTarget, join(target, "skills"));
  expect(() => planAgentIntegration({ home: nestedHome, dataDir: join(nestedHome, "skills-data"), agents: ["sumi"], allowRootAliases: true })).toThrow("symlink");
});

test("Sumi installation owns only its native plugin, config and bridge and guards reappearing sources", () => {
  const home = fixture(), dataDir = join(home, "skills-data"), config = join(home, ".hasna-internal/sumi/config/sumi.json");
  put(config, JSON.stringify({ experimental: { enabled: true }, permissions: [{ action: "shell", resource: "*", effect: "ask" }] }));
  const plan = planAgentIntegration({ home, dataDir, agents: ["sumi"], command: "skills", profileId: "engineering" });
  expect(plan.changes.every(change => !change.path.includes("opencode"))).toBe(true);
  applyAgentIntegration(plan);
  const installed = JSON.parse(readFileSync(config, "utf8"));
  expect(installed.experimental).toEqual({ enabled: true });
  expect(installed.hooks).toBeUndefined();
  expect(installed.permissions).toEqual([{ action: "shell", resource: "*", effect: "ask" }, { action: "skill", resource: "*", effect: "deny" }, { action: "skill", resource: "skills-cli", effect: "allow" }]);
  expect(() => assertManagedAgentBridge("sumi", { home, dataDir, projectDir: home, profileId: "engineering" })).not.toThrow();
  put(join(home, ".agents/skills/foreign/SKILL.md"), "---\nname: foreign\ndescription: foreign\n---\nRetired payload");
  expect(() => assertManagedAgentBridge("sumi", { home, dataDir, projectDir: home })).toThrow("NATIVE_SKILL_DRIFT");
});

test("modified Sumi plugins and unsupported native sources are explicitly refused", () => {
  const home = fixture(), dataDir = join(home, "skills-data"), config = join(home, ".hasna-internal/sumi/config/sumi.json");
  put(config, JSON.stringify({ skills: ["https://skills.example.com/"] }));
  expect(() => planAgentIntegration({ home, dataDir, agents: ["sumi"] })).toThrow("discovery");
  put(config, "{}"); put(join(dirname(config), "plugins/skills-cli.js"), "export default {};");
  expect(() => planAgentIntegration({ home, dataDir, agents: ["sumi"] })).toThrow("modified Sumi");
});

test("native plugin directory aliases cannot hide an unwitnessed plugin", () => {
  const home = fixture(), config = join(home, ".hasna-internal/sumi/config/sumi.json"), external = join(home, "external-plugins");
  put(config, "{}"); put(join(external, "foreign.js"), "export default {};");
  symlinkSync(external, join(dirname(config), "plugins"));
  expect(() => planAgentIntegration({ home, dataDir: join(home, "skills-data"), agents: ["sumi"] })).toThrow();
});

test("legacy singular Sumi plugin registrations require the same review as native plugins", () => {
  for (const plugin of [["foreign-plugin"], [["foreign-plugin", { enabled: true }]], "foreign-plugin"]) {
    const home = fixture(), config = join(home, ".hasna-internal/sumi/config/sumi.json");
    put(config, JSON.stringify({ plugin }));
    expect(() => resolveAgentDiscovery({ home, agent: "sumi" })).toThrow();
  }
  const home = fixture(), config = join(home, ".hasna-internal/sumi/config/sumi.json");
  put(config, JSON.stringify({ plugin: [], experimental: { enabled: true } }));
  const plan = planAgentIntegration({ home, dataDir: join(home, "skills-data"), agents: ["sumi"] });
  applyAgentIntegration(plan);
  expect(JSON.parse(readFileSync(config, "utf8")).plugin).toEqual([]);
  expect(() => assertManagedAgentBridge("sumi", { home, dataDir: join(home, "skills-data"), projectDir: home })).not.toThrow();
  for (const name of ["sumi.json", ".sumi/sumi.json"]) {
    const project = join(home, name === "sumi.json" ? "project-flat" : "project-directory");
    put(join(project, name), JSON.stringify({ plugin: ["foreign-plugin"] }));
    expect(() => assertProjectDiscovery("sumi", [project], home)).toThrow("higher-precedence");
  }
});

test("legacy Sumi plugin changes invalidate automatic and retained reviewed witnesses", () => {
  const home = fixture(), config = join(home, ".hasna-internal/sumi/config/sumi.json");
  const raw = JSON.stringify({ plugin: [] }); put(config, raw);
  const automatic = resolveAgentDiscovery({ home, agent: "sumi" });
  expect(automatic.sources.find(source => source.path === config)?.fields).toContain("plugin");
  const reviewed: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "sumi", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [{ path: config, sha256: createHash("sha256").update(raw).digest("hex") }] }] };
  const binding = resolveAgentDiscovery({ home, agent: "sumi", reviewed });
  put(config, JSON.stringify({ plugin: ["foreign-plugin"] }));
  expect(() => verifyAgentDiscovery(automatic)).toThrow();
  expect(() => resolveAgentDiscovery({ home, agent: "sumi", retainedReview: binding })).toThrow();
});

test("native prompt and request hooks preserve actual root, child and nested custody", async () => {
  const root = fixture(), log = join(root, "calls.jsonl"), command = join(root, "fixture-skills"), pluginPath = join(root, "plugin.js");
  put(command, `#!${process.execPath}\nimport {appendFileSync} from "node:fs";\nconst input = await Bun.stdin.json(); appendFileSync(${JSON.stringify(log)}, JSON.stringify(input)+"\\n");\nif (input.prompt === "refuse") console.log(JSON.stringify({decision:"block"}));\nelse if (input.prompt === "malformed") console.log("invalid");\nelse console.log(JSON.stringify({hookSpecificOutput:{hookEventName:input.hook_event_name,additionalContext:input.prompt === "optional" ? "No Skills instructions were delivered by this hook. Ordinary work may continue." : "Verified fixture instructions"}}));\n`); chmodSync(command, 0o700);
  put(pluginPath, renderSumiPlugin(command, "engineering"));
  const plugin = (await import(pluginPath)).default;
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const sessions: Record<string, { id: string; parentID?: string; agent?: string; location: { directory: string } }> = {
    root: { id: "root", agent: "native-build", location: { directory: root } },
    child: { id: "child", parentID: "root", agent: "native-explore", location: { directory: root } },
    nested: { id: "nested", parentID: "child", location: { directory: root } },
  };
  const skills = [{ id: "skills-cli", name: "skills-cli" }, { id: "foreign", name: "skills-cli" }, { id: "other", name: "other" }];
  const removed: string[] = [];
  const cleanup = await plugin.setup({ tool: { hook: async (name: string, callback: (event: any) => Promise<void>) => { hooks.set(name, callback); return { dispose: async () => hooks.delete(name) }; } }, session: { get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID], hook: async (name: string, callback: (event: any) => Promise<void>) => { hooks.set(name, callback); return { dispose: async () => hooks.delete(name) }; } }, skill: { transform: async (callback: (editor: any) => void) => { callback({ list: () => skills, remove: (id: string) => removed.push(id) }); return { dispose: async () => {} }; } } });
  expect(removed).toEqual(["foreign", "other"]);
  for (const sessionID of ["root", "child", "nested"]) {
    const event = { sessionID, messageID: "message", prompt: { text: "review" }, delivery: "steer" };
    await hooks.get("prompt")!(event);
    expect(event.prompt.text).toBe("review");
    const request = { sessionID, agent: "native-build", model: {}, system: [] as Array<{ type: string; text: string }>, messages: [{ role: "user", content: [{ type: "text", text: "review" }] }], options: {}, tools: {} };
    await hooks.get("context")!(request);
    expect(request.system).toEqual([{ type: "text", text: "Verified fixture instructions" }]);
  }
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(calls.map(call => [call.hook_event_name, call.session_id, call.parent_session_id])).toEqual([
    ["SessionStart", "root", null], ["UserPromptSubmit", "root", null], ["SubagentStart", "child", "root"], ["UserPromptSubmit", "child", "root"], ["SubagentStart", "nested", "child"], ["UserPromptSubmit", "nested", "child"],
  ]);
  expect(calls.every(call => call.agent_id === undefined && call.restore === true)).toBe(true);
  await expect(hooks.get("prompt")!({ sessionID: "root", prompt: { text: "refuse" } })).rejects.toThrow("refused");
  await expect(hooks.get("prompt")!({ sessionID: "root", prompt: { text: "malformed" } })).rejects.toThrow();
  const request = { sessionID: "root", system: [] as Array<{ type: string; text: string }>, messages: [{ role: "user", content: [{ type: "text", text: "optional" }] }] };
  await hooks.get("context")!(request);
  expect(JSON.stringify(request.system)).toContain("Ordinary work may continue");
  await expect(hooks.get("prompt")!({ sessionID: "root", prompt: { text: "review", skills: [{ id: "foreign" }] } })).rejects.toThrow("attachment refused");
  expect(() => hooks.get("execute.before")!({ tool: "skill", input: { id: "foreign" } })).toThrow("payload refused");
  expect(() => hooks.get("execute.before")!({ tool: "skill", input: { name: "skills-cli" } })).toThrow("payload refused");
  await hooks.get("execute.before")!({ tool: "skill", input: { id: "skills-cli" } });
  await hooks.get("execute.before")!({ tool: "read", input: {} });
  await cleanup(); expect(hooks.size).toBe(0);
});
