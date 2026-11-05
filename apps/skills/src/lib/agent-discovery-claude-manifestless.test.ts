import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { resolveAgentDiscovery, resolveAgentDiscoveryExclusionRoots, verifyAgentDiscovery } from "./agent-discovery.js";
import { hashClaudeMarketplaceEntry } from "./claude-marketplace-entry-witness.js";

// A fetched plugin may have no .claude-plugin/plugin.json when its marketplace
// entry declares `strict: false`: the entry is then the manifest and may carry
// skills, hooks, commands, agents, MCP and LSP servers inline (measured on
// Claude Code 2.1.314 with the official swift-lsp entry and its installed
// cache). Discovery must accept that shape, keep the plugin root excluded, and
// still refuse an inline hook, an inline command surface, a malformed present
// manifest, a strict entry without a manifest and an absent installation root.
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const within = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);

function setup(entry: Record<string, unknown> | null, pluginFiles: (root: string) => void = () => {}) {
  const home = mkdtempSync(join(tmpdir(), "claude-manifestless-"));
  scratch.push(home);
  const root = join(home, "plugins", "fixture-plugin");
  mkdirSync(root, { recursive: true });
  pluginFiles(root);
  const marketplace = join(home, "marketplaces", "fixture-market");
  const entries = entry === null ? [] : [{ name: "fixture-plugin", source: "./plugin", ...entry }];
  put(join(marketplace, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "fixture-market", owner: { name: "Fixture" }, plugins: entries }));
  put(join(home, ".claude/plugins/known_marketplaces.json"), JSON.stringify({
    "fixture-market": { source: { source: "directory", path: marketplace }, installLocation: marketplace, lastUpdated: "2026-11-02T00:00:00.000Z" },
  }));
  put(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "fixture-plugin@fixture-market": true } }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({
    version: 2,
    plugins: { "fixture-plugin@fixture-market": [{ scope: "user", installPath: root, version: "1.0.0" }] },
  }));
  return { home, root, marketplace };
}

const roots = (home: string) => resolveAgentDiscoveryExclusionRoots({ home, agent: "claude" });

test("a strict:false entry with only inline LSP servers accepts a manifestless root", () => {
  const { home, root } = setup({ strict: false, lspServers: { "swift-lsp": { command: "sourcekit-lsp" } } });
  const resolved = roots(home);
  expect(resolved).toContain(root);
  // No inline skills: only the default location is claimed, and every root
  // stays inside the plugin root.
  expect(resolved).toContain(join(root, "skills"));
  for (const candidate of resolved.filter(rootEntry => within(root, rootEntry))) expect(within(root, candidate)).toBe(true);
});

test("an inline skills entry adds its declared skill roots", () => {
  const { home, root } = setup(
    { strict: false, skills: ["./skills-a", "./skills-b"] },
    root => { mkdirSync(join(root, "skills-a"), { recursive: true }); mkdirSync(join(root, "skills-b"), { recursive: true }); },
  );
  const resolved = roots(home);
  expect(resolved).toContain(join(root, "skills-a"));
  expect(resolved).toContain(join(root, "skills-b"));
});

test("a manifestless plugin falls back to the default skills location", () => {
  const { home, root } = setup({ strict: false }, root => { mkdirSync(join(root, "skills"), { recursive: true }); });
  expect(roots(home)).toContain(join(root, "skills"));
});

test("an inline hooks entry is refused, not silently accepted", () => {
  const { home } = setup({ strict: false, hooks: { Stop: [{ matcher: "x", hooks: [{ type: "command", command: "true" }] }] } });
  expect(() => roots(home)).toThrow("plugin hooks require a separate no-skill-injection review");
});

test("a physical hooks file without a manifest is refused", () => {
  const { home } = setup({ strict: false }, root => put(join(root, "hooks/hooks.json"), "{}"));
  expect(() => roots(home)).toThrow("plugin hooks require a separate no-skill-injection review");
});

test("an inline commands entry is refused as legacy command discovery", () => {
  const { home } = setup({ strict: false, commands: ["./commands"] });
  expect(() => roots(home)).toThrow("legacy command discovery requires retirement or a dedicated format adapter");
});

test("a present but malformed manifest still refuses even with an entry", () => {
  const { home } = setup({ strict: false }, root => put(join(root, ".claude-plugin/plugin.json"), "{not json"));
  expect(() => roots(home)).toThrow();
});

test("a strict entry without a manifest refuses", () => {
  const { home } = setup({});
  expect(() => roots(home)).toThrow("plugin manifest missing");
});

test("a missing marketplace entry refuses", () => {
  const { home } = setup(null);
  expect(() => roots(home)).toThrow("plugin manifest missing: the marketplace entry is missing or ambiguous");
});

test("a duplicated marketplace entry refuses", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-manifestless-dupe-"));
  scratch.push(home);
  const root = join(home, "plugins", "fixture-plugin");
  mkdirSync(root, { recursive: true });
  const marketplace = join(home, "marketplaces", "fixture-market");
  put(join(marketplace, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "fixture-market", plugins: [
    { name: "fixture-plugin", source: "./a", strict: false },
    { name: "fixture-plugin", source: "./b", strict: false },
  ] }));
  put(join(home, ".claude/plugins/known_marketplaces.json"), JSON.stringify({ "fixture-market": { installLocation: marketplace } }));
  put(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "fixture-plugin@fixture-market": true } }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "fixture-plugin@fixture-market": [{ scope: "user", installPath: root, version: "1.0.0" }] } }));
  expect(() => roots(home)).toThrow("plugin manifest missing: the marketplace entry is missing or ambiguous");
});

test("a missing marketplace registry refuses", () => {
  const { home } = setup({ strict: false });
  rmSync(join(home, ".claude/plugins/known_marketplaces.json"));
  expect(() => roots(home)).toThrow("plugin manifest missing: the marketplace registry is missing");
});

test("an absent installation root refuses", () => {
  const { home } = setup({ strict: false });
  rmSync(join(home, "plugins", "fixture-plugin"), { recursive: true, force: true });
  expect(() => roots(home)).toThrow("plugin installation root is missing");
});

test("a manifestless plugin binds its marketplace entry and its registry as live witnesses", () => {
  const { home, marketplace } = setup({ strict: false, skills: ["./skills-a"] });
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  const entries = binding.sources.filter(source => source.hashMode === "claude-marketplace-entry-v1");
  expect(entries).toHaveLength(1);
  expect(entries[0].marketplace).toBe("fixture-market");
  expect(entries[0].plugin).toBe("fixture-plugin");
  const text = readFileSync(join(marketplace, ".claude-plugin/marketplace.json"), "utf8");
  expect(entries[0].sha256).toBe(hashClaudeMarketplaceEntry(text, { marketplace: "fixture-market", plugin: "fixture-plugin" }));
  // The registry row that routes the plugin id to its catalog is bound too.
  expect(binding.sources.filter(source => source.hashMode === "claude-marketplace-registry-v2")).toHaveLength(1);
  // The live binding is verifiable: a live entry witness carries a content
  // digest, so the reviewed-only gate would refuse this binding.
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
});

test("a registry redirect to a different catalog refuses the older binding", () => {
  const { home } = setup({ strict: false, skills: ["./skills-a"] });
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  const other = join(home, "marketplaces", "fixture-market-b");
  put(join(other, ".claude-plugin/marketplace.json"), JSON.stringify({
    name: "fixture-market",
    plugins: [{ name: "fixture-plugin", source: "./plugin", strict: false, skills: ["./skills-b"] }],
  }));
  put(join(home, ".claude/plugins/known_marketplaces.json"), JSON.stringify({
    "fixture-market": { source: { source: "directory", path: other }, installLocation: other, lastUpdated: "2026-11-02T00:00:00.000Z" },
  }));
  // The catalog the old binding recorded is untouched; only the registry route
  // moved, so the registry witness is what must refuse it.
  expect(() => verifyAgentDiscovery(binding)).toThrow();
  expect(roots(home)).toContain(join(home, "plugins", "fixture-plugin", "skills-b"));
});

test("an entry declaring an unmodelled loading control is refused", () => {
  const { home } = setup({ strict: false, settings: { env: { FIXTURE: "1" } } });
  expect(() => roots(home)).toThrow("unsupported loading control");
});

test("a catalog refresh that changes the entry changes the bound digest", () => {
  const { home, marketplace } = setup({ strict: false, skills: ["./skills-a"] });
  const digest = () => resolveAgentDiscovery({ home, agent: "claude" }).sources
    .find(source => source.hashMode === "claude-marketplace-entry-v1")!.sha256;
  const before = digest();
  put(join(marketplace, ".claude-plugin/marketplace.json"), JSON.stringify({
    name: "fixture-market",
    plugins: [{ name: "fixture-plugin", source: "./plugin", strict: false, skills: ["./skills-b"] }],
  }));
  expect(digest()).not.toBe(before);
});
