import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";

// End-to-end coverage through the existing hook installation and guard APIs.
// The expected digest is pinned (it equals the canonical projection checked in
// claude-marketplace-entry-witness.test.ts), so this file exercises only the
// public installation path: a build without the mode refuses the whole review.
const ENTRY_SHA256 = "2f0254eb4e00dd8200debb47139f25890488a82e782021ec3a21544af9673ae5";
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const put = (path: string, contents: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, contents); };
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Entry = Record<string, any>;
const catalog = (mutate: (value: Entry, entry: Entry) => void = () => {}) => {
  const value: Entry = {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "claude-plugins-official",
    description: "Directory of popular Claude Code extensions",
    owner: { name: "Anthropic", email: "support@anthropic.com" },
    renames: { vals: "valtown" },
    plugins: [
      { name: "context7", description: "Docs lookup", source: "./external_plugins/context7", tags: ["community-managed"] },
      { name: "swift-lsp", description: "Swift language server (SourceKit-LSP) for code intelligence", version: "1.0.0", author: { name: "Anthropic", email: "support@anthropic.com" }, source: "./plugins/swift-lsp", category: "development", strict: false, lspServers: { "sourcekit-lsp": { command: "sourcekit-lsp", extensionToLanguage: { ".swift": "swift" } } } },
    ],
  };
  mutate(value, value.plugins[1]);
  return JSON.stringify(value, null, 2);
};

function fixture(prefix: string) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  homes.push(home);
  const installPath = join(home, ".claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0");
  const paths = {
    home, installPath,
    settings: join(home, ".claude/settings.json"),
    registrations: join(home, ".claude/plugins/installed_plugins.json"),
    known: join(home, ".claude/plugins/known_marketplaces.json"),
    marketplace: join(home, ".claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json"),
    dataDir: join(home, "skills-data"),
  };
  put(paths.settings, JSON.stringify({ enabledPlugins: { "swift-lsp@claude-plugins-official": true } }));
  put(paths.registrations, JSON.stringify({ version: 2, plugins: { "swift-lsp@claude-plugins-official": [{ scope: "user", installPath, version: "1.0.0" }] } }));
  put(paths.known, JSON.stringify({ "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: join(home, ".claude/plugins/marketplaces/claude-plugins-official"), lastUpdated: "2026-10-07T12:00:00.000Z" } }));
  put(paths.marketplace, catalog());
  mkdirSync(installPath, { recursive: true });
  const options = { home, dataDir: paths.dataDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const review = (entry: Entry): any => ({ version: 1 as const, agents: [{
    agent: "claude" as const,
    roots: [join(installPath, "skills")],
    sources: [
      ...[paths.settings, paths.registrations, paths.known].map(path => ({ path, sha256: sha(path) })),
      entry,
      ...[join(installPath, ".claude-plugin/plugin.json"), join(installPath, "hooks/hooks.json")].map(path => ({ path, hashMode: "bytes" as const, sha256: null })),
    ],
    pluginHooks: "reviewed-no-skill-injection" as const,
  }] });
  const scoped = { path: paths.marketplace, hashMode: "claude-marketplace-entry-v1", marketplace: "claude-plugins-official", plugin: "swift-lsp", sha256: ENTRY_SHA256 } as any;
  return { paths, options, review, scoped };
}
function snapshot(root: string): string {
  const rows: string[] = [];
  const walk = (path: string) => {
    const stat = lstatSync(path);
    rows.push(`${path} ${stat.mode} ${stat.size} ${stat.mtimeMs} ${stat.isFile() ? sha(path) : ""}`);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
  };
  walk(root);
  return rows.join("\n");
}

test("a reviewed scoped entry survives Claude's own marketplace refreshes and still guards swift-lsp injection", () => {
  const { paths, options, review, scoped } = fixture("skills-marketplace-entry-policy-");
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: review(scoped) }));
  const stored = JSON.parse(readFileSync(join(paths.dataDir, "agent-policy.json"), "utf8")).bridge.discovery.claude.sources;
  expect(stored.find((source: Entry) => source.path === paths.marketplace)).toEqual(scoped);
  const guard = () => assertManagedAgentBridge("claude", options);
  expect(guard).not.toThrow();
  const original = readFileSync(paths.marketplace, "utf8"), registrations = readFileSync(paths.registrations, "utf8");

  // Control 1: a refresh that changes other entries and catalog metadata.
  put(paths.marketplace, catalog(value => {
    value.description = "Refreshed"; value.plugins[0].description = "Refreshed";
    value.plugins.push({ name: "new-plugin", source: { source: "github", repo: "example/new-plugin" }, hooks: { SessionStart: [] } });
    value.renames.formatter = "code-formatter";
  }));
  expect(guard).not.toThrow();
  // Control 5: entry display metadata only.
  put(paths.marketplace, catalog((_value, entry) => { entry.description = "New summary"; entry.version = "1.0.1"; }));
  expect(guard).not.toThrow();
  put(paths.marketplace, original);
  // Control 5: a real version change still drifts through installed_plugins.json.
  put(paths.registrations, registrations.replaceAll("1.0.0", "1.0.1"));
  expect(guard).toThrow("NATIVE_SKILL_DRIFT");
  put(paths.registrations, registrations);
  expect(guard).not.toThrow();

  for (const [mutate, reason] of [
    // Control 2: what swift-lsp runs.
    [(_value: Entry, entry: Entry) => { entry.lspServers["sourcekit-lsp"].args = ["--log-level", "debug"]; }, "Native discovery input changed"],
    [(_value: Entry, entry: Entry) => { entry.lspServers["sourcekit-lsp"].env = { DYLD_INSERT_LIBRARIES: "/tmp/x.dylib" }; }, "Native discovery input changed"],
    // Control 3: a new component on the entry.
    [(_value: Entry, entry: Entry) => { entry.hooks = { UserPromptSubmit: [{ hooks: [{ type: "command", command: "inject" }] }] }; }, "Native discovery input changed"],
    [(_value: Entry, entry: Entry) => { entry.skills = ["./skills"]; }, "Native discovery input changed"],
    // Control 4: an unreviewed key, named with the mode, marketplace and exact path.
    [(_value: Entry, entry: Entry) => { entry.futureInjector = true; }, 'claude-marketplace-entry-v1: unknown key "plugins[swift-lsp].futureInjector" in claude-plugins-official'],
    [(value: Entry) => { value.pluginSearchPaths = ["./more"]; }, 'claude-marketplace-entry-v1: unknown top-level key "pluginSearchPaths" in claude-plugins-official'],
    [(value: Entry) => { value.metadata = { skillRoot: "./skills" }; }, 'claude-marketplace-entry-v1: unknown key "metadata.skillRoot" in claude-plugins-official'],
    // Control 6: missing or duplicated entry.
    [(value: Entry) => { value.plugins.pop(); }, "selected plugin entry is missing"],
    [(value: Entry, entry: Entry) => { value.plugins.push({ ...entry }); }, "selected plugin entry is duplicated or ambiguous"],
    // Control 7: plugin root.
    [(value: Entry) => { value.metadata = { pluginRoot: "./plugins" }; }, "Native discovery input changed"],
    // The cross-marketplace allowlist binds although swift-lsp declares no dependencies.
    [(value: Entry) => { value.allowCrossMarketplaceDependenciesOn = ["other-market"]; }, "Native discovery input changed"],
  ] as Array<[(value: Entry, entry: Entry) => void, string]>) {
    put(paths.marketplace, catalog(mutate));
    expect(guard).toThrow("NATIVE_SKILL_DRIFT");
    expect(guard).toThrow(reason);
    if (reason.startsWith("claude-marketplace-entry-v1: ")) expect(guard).toThrow(`NATIVE_SKILL_DRIFT: ${reason}`);
    put(paths.marketplace, original);
    expect(guard).not.toThrow();
  }
  put(paths.marketplace, "{ not json");
  expect(guard).toThrow("cannot parse marketplace.json");
});

test("refused reviews and apply-time drift write nothing", () => {
  const { paths, options, review, scoped } = fixture("skills-marketplace-entry-refusal-");
  put(paths.marketplace, catalog((value, entry) => { value.plugins.push({ ...entry }); }));
  let state = snapshot(paths.home);
  expect(() => planAgentIntegration({ ...options, discoveryInputs: review(scoped) })).toThrow("selected plugin entry is duplicated or ambiguous");
  expect(snapshot(paths.home)).toBe(state);
  put(paths.marketplace, catalog());
  state = snapshot(paths.home);
  for (const [entry, reason] of [
    [{ ...scoped, sha256: "0".repeat(64) }, `Native discovery input changed; run skills hook install with a fresh discovery review: ${paths.marketplace}`],
    [{ ...scoped, plugin: "swift lsp" }, "Claude marketplace entry witnesses require explicit reviewed Claude discovery of one named entry"],
    [{ ...scoped, path: paths.marketplace.replace(".claude-plugin/marketplace.json", "marketplace.json") }, "Claude marketplace entry witnesses require explicit reviewed Claude discovery of one named entry"],
    [{ ...scoped, managedPlugins: [] }, "Claude marketplace entry witnesses require an exact reviewed entry without synthetic changes"],
    [{ ...scoped, format: "json", fields: ["plugins"] }, "Explicit discovery reviews require full source-file hashes"],
  ] as Array<[Entry, string]>) expect(() => planAgentIntegration({ ...options, discoveryInputs: review(entry) })).toThrow(reason);
  expect(snapshot(paths.home)).toBe(state);
  const settingsBefore = readFileSync(paths.settings, "utf8");

  // A valid plan cannot apply after the reviewed entry changed underneath it.
  const plan = planAgentIntegration({ ...options, discoveryInputs: review(scoped) });
  put(paths.marketplace, catalog((_value, entry) => { entry.lspServers["sourcekit-lsp"].command = "/tmp/other-lsp"; }));
  const drifted = snapshot(paths.home);
  expect(() => applyAgentIntegration(plan)).toThrow("Native discovery input changed");
  expect(snapshot(paths.home)).toBe(drifted);
  expect(existsSync(join(paths.dataDir, "agent-policy.json"))).toBe(false);
  expect(readFileSync(paths.settings, "utf8")).toBe(settingsBefore);
});

test("an older-style whole-file marketplace witness keeps its exact byte semantics", () => {
  const { paths, options, review } = fixture("skills-marketplace-entry-legacy-");
  const bytes = { path: paths.marketplace, sha256: sha(paths.marketplace) };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: review(bytes) }));
  const policy = readFileSync(join(paths.dataDir, "agent-policy.json"), "utf8");
  expect(JSON.parse(policy).bridge.discovery.claude.sources.find((source: Entry) => source.path === paths.marketplace)).toEqual(bytes);
  expect(policy).not.toContain("claude-marketplace-entry-v1");
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
  put(paths.marketplace, catalog(value => { value.plugins[0].description = "Refreshed"; }));
  expect(() => assertManagedAgentBridge("claude", options)).toThrow("NATIVE_SKILL_DRIFT");
});

test("the stored policy accepts the mode only for reviewed Claude discovery of one exact entry", () => {
  const path = "/home/user/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json";
  const source = { path, hashMode: "claude-marketplace-entry-v1", marketplace: "claude-plugins-official", plugin: "swift-lsp", sha256: ENTRY_SHA256 };
  const policy = (item: Entry, binding: Entry = { agent: "claude", method: "reviewed" }, agent = "claude") =>
    JSON.stringify({ version: 1, loading: "cli", bridge: { discovery: { [agent]: { roots: [], ...binding, sources: [item] } } } });
  expect(parseManagedSkillPolicy(policy(source)).bridge.discovery.claude.sources[0]).toEqual(source);
  for (const [item, binding, agent] of [
    [source, { agent: "claude", method: "automatic" }, "claude"],
    [source, { agent: "codex", method: "reviewed" }, "codex"],
    [{ ...source, sha256: null }],
    [{ ...source, path: ".claude-plugin/marketplace.json" }],
    [{ ...source, path: path.replace("/home/user", "/home/user/../user") }],
    [{ ...source, path: `${path}/` }],
    [{ ...source, path: path.replace("/.claude-plugin/", "/") }],
    [{ ...source, path: path.replace("marketplace.json", "plugin.json") }],
    [{ ...source, marketplace: undefined }],
    [{ ...source, plugin: "swift lsp" }],
    [{ ...source, marketplace: "a..b" }],
    [{ ...source, format: "json", fields: ["plugins"] }],
    [{ ...source, managedPlugins: [] }],
  ] as Array<[Entry, Entry?, string?]>) expect(() => parseManagedSkillPolicy(policy(item, binding, agent))).toThrow("has invalid collection bounds");
});
