import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureClaudeMarketplaceEntry, claudeMarketplaceEntrySourceValid, hashClaudeMarketplaceEntry } from "./claude-marketplace-entry-witness.js";

// Fixture shaped like the official marketplace on station04 (2026-10-07): the
// swift-lsp entry is copied field for field; neighbours cover the source shapes
// Claude's own refreshes change (git-subdir, url, relative, tags, skills).
type Entry = Record<string, any>;
const swiftLsp = (): Entry => ({
  name: "swift-lsp",
  description: "Swift language server (SourceKit-LSP) for code intelligence",
  version: "1.0.0",
  author: { name: "Anthropic", email: "support@anthropic.com" },
  source: "./plugins/swift-lsp",
  category: "development",
  strict: false,
  lspServers: { "sourcekit-lsp": { command: "sourcekit-lsp", extensionToLanguage: { ".swift": "swift" } } },
});
const catalog = (): Entry => ({
  $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
  name: "claude-plugins-official",
  description: "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
  owner: { name: "Anthropic", email: "support@anthropic.com" },
  renames: { adlc: "agentforce-adlc", vals: "valtown" },
  plugins: [
    { name: "amd-skills", description: "AMD skills", source: { source: "git-subdir", url: "https://github.com/amd/skills.git", path: "skills", ref: "main", sha: "e867fa4ae4516f644221cb04dcdf24008a43cb99" }, strict: false, skills: ["./local-ai-use"] },
    { name: "context7", description: "Docs lookup", source: "./external_plugins/context7", category: "development", tags: ["community-managed"] },
    swiftLsp(),
    { name: "atomic-agents", description: "Agents", source: { source: "url", url: "https://github.com/BrainBlend-AI/atomic-agents.git", path: "claude-plugin/atomic-agents", sha: "b15ca449a81278b1c92666bdf9a2e57a817dcacd" }, tags: ["community-managed"] },
  ],
});
const selector = { marketplace: "claude-plugins-official", plugin: "swift-lsp" };
const text = (mutate: (value: Entry, entry: Entry) => void = () => {}, indent = 2) => {
  const value = catalog();
  mutate(value, value.plugins.find((item: Entry) => item.name === "swift-lsp"));
  return JSON.stringify(value, null, indent);
};
const digest = (value: string) => hashClaudeMarketplaceEntry(value, selector);
const base = digest(text());

test("the digest is the domain-separated canonical projection of the bound marketplace fields and entry", () => {
  // Hand-written expected canonical text: sorted keys, no whitespace, omitted
  // metadata (description, version, author, category) and pluginRoot null.
  const canonical = '{"marketplace":{"name":"claude-plugins-official","pluginRoot":null},"plugin":{"lspServers":{"sourcekit-lsp":{"command":"sourcekit-lsp","extensionToLanguage":{".swift":"swift"}}},"name":"swift-lsp","source":"./plugins/swift-lsp","strict":false}}';
  expect(base).toBe(createHash("sha256").update("hasna.skills.claude-marketplace-entry.v1\0").update(canonical).digest("hex"));
  expect(base).not.toBe(createHash("sha256").update(canonical).digest("hex"));
  expect(base).toBe("10021f42a1a3d5d53b0b9da96ba0317b047e44187a77a7822a1c1a323871e04f");
});

test("control 1: other entries, catalog metadata and formatting leave the digest unchanged", () => {
  const unrelated: Array<(value: Entry, entry: Entry) => void> = [
    value => { value.plugins[0].description = "Refreshed description"; },
    value => { value.plugins[0].source.sha = "0".repeat(40); },
    value => { value.plugins[3].lspServers = { other: { command: "other-lsp", extensionToLanguage: { ".x": "x" } } }; },
    value => { value.plugins.push({ name: "new-plugin", description: "Added by a refresh", source: "./plugins/new-plugin", hooks: { SessionStart: [] } }); },
    value => { value.plugins.splice(0, 1); },
    value => { value.plugins.reverse(); },
    value => { value.plugins.push({ description: "entry without a name" }, "not an object", { name: 7 }); },
    value => { value.renames["old-name"] = "context7"; value.renames.gone = null; },
    value => { value.description = "New catalog description"; value.version = "2"; value.$schema = "https://example.invalid/schema.json"; },
    value => { value.owner = { name: "Anthropic PBC", url: "https://example.invalid" }; },
    value => { value.forceRemoveDeletedPlugins = true; value.allowCrossMarketplaceDependenciesOn = ["other-market"]; },
    value => { value.metadata = { description: "Alternate description", version: "3" }; },
    (_value, entry) => { const lsp = entry.lspServers; delete entry.lspServers; entry.zzz = undefined; entry.lspServers = lsp; },
  ];
  for (const mutate of unrelated) expect(digest(text(mutate))).toBe(base);
  expect(digest(text(undefined, 0))).toBe(base);
  expect(digest(text((_value, entry) => {
    const reordered = Object.fromEntries(Object.entries(entry).reverse());
    for (const key of Object.keys(entry)) delete entry[key];
    Object.assign(entry, reordered);
  }))).toBe(base);
});

test("control 2: swift-lsp lspServers command, args and env changes drift", () => {
  const changed = [
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].command = "/tmp/other-sourcekit-lsp"; }),
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].args = ["--log-level", "debug"]; }),
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].args = ["debug", "--log-level"]; }),
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].env = { SOURCEKIT_LOGGING: "3" }; }),
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].env = { SOURCEKIT_LOGGING: "4" }; }),
    text((_value, entry) => { entry.lspServers["sourcekit-lsp"].extensionToLanguage[".swiftinterface"] = "swift"; }),
    text((_value, entry) => { entry.lspServers.second = { command: "clangd", extensionToLanguage: { ".m": "objective-c" } }; }),
  ];
  const digests = changed.map(digest);
  for (const value of digests) expect(value).not.toBe(base);
  expect(new Set(digests).size).toBe(digests.length);
});

test("control 3: adding injection or resolution fields to the entry drifts", () => {
  const additions: Entry = {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "inject" }] }] },
    mcpServers: { recorder: { command: "node", args: ["server.js"] } },
    skills: ["./skills"], commands: "./commands", agents: ["./agents/reviewer.md"], outputStyles: "./styles",
    workflows: "./workflows", themes: "./themes", monitors: [{ name: "m", command: "watch", description: "d" }],
    experimental: { themes: "./themes" }, settings: { agent: "reviewer" }, channels: [{ server: "recorder" }],
    userConfig: { token: { type: "string", title: "Token", description: "Token" } }, types: "./types.d.ts",
    dependencies: ["helper"], defaultEnabled: false, relevance: { topic: "swift", signals: ["xcode"] },
    headers: { "x-token": "a" }, headersHelper: "print-headers",
  };
  for (const [key, value] of Object.entries(additions)) expect(digest(text((_market, entry) => { entry[key] = value; }))).not.toBe(base);
  for (const changed of [
    text((_value, entry) => { entry.strict = true; }),
    text((_value, entry) => { delete entry.strict; }),
    text((_value, entry) => { entry.source = "./plugins/other-swift-lsp"; }),
    text((_value, entry) => { entry.source = { source: "github", repo: "attacker/swift-lsp" }; }),
  ]) expect(digest(changed)).not.toBe(base);
});

test("control 4: an unknown key in the entry, its source, experimental or the resolution context refuses", () => {
  for (const [mutate, reason] of [
    [(_value: Entry, entry: Entry) => { entry.futureInjector = { entrypoint: "inject.js" }; }, "refuses unreviewed plugin entry field: futureInjector"],
    [(_value: Entry, entry: Entry) => { entry.icon = "./logo.png"; }, "refuses unreviewed plugin entry field: icon"],
    [(_value: Entry, entry: Entry) => { entry.experimental = { agentsV2: "./agents" }; }, "refuses unreviewed experimental component: agentsV2"],
    [(_value: Entry, entry: Entry) => { entry.source = { source: "github", repo: "anthropics/swift-lsp", script: "run" }; }, "refuses unreviewed plugin source field: script"],
    [(_value: Entry, entry: Entry) => { entry.source = { source: "ftp", url: "ftp://example.invalid" }; }, "has an unreviewed plugin source type"],
    [(value: Entry) => { value.pluginSearchPaths = ["./more"]; }, "refuses unreviewed marketplace field: pluginSearchPaths"],
    [(value: Entry) => { value.metadata = { skillRoot: "./skills" }; }, "refuses unreviewed marketplace metadata field: skillRoot"],
  ] as Array<[(value: Entry, entry: Entry) => void, string]>) expect(() => digest(text(mutate))).toThrow(reason);
});

test("control 5: entry description, version and other display metadata leave the digest unchanged", () => {
  for (const mutate of [
    (_value: Entry, entry: Entry) => { entry.description = "Refreshed summary"; },
    (_value: Entry, entry: Entry) => { entry.version = "1.0.1"; },
    (_value: Entry, entry: Entry) => { delete entry.version; delete entry.description; },
    (_value: Entry, entry: Entry) => { entry.author = "Anthropic"; entry.homepage = "https://example.invalid"; entry.license = "Apache-2.0"; },
    (_value: Entry, entry: Entry) => { entry.repository = { type: "git", url: "https://example.invalid/repo" }; entry.keywords = ["swift"]; },
    (_value: Entry, entry: Entry) => { entry.category = "languages"; entry.tags = ["lsp"]; entry.displayName = "Swift LSP"; },
    (_value: Entry, entry: Entry) => { entry.metadata = { catalogId: "cat-1", nested: { any: [1] } }; entry.$schema = "https://example.invalid/plugin.json"; },
  ]) expect(digest(text(mutate))).toBe(base);
  // Omitted fields keep their documented types; malformed metadata refuses.
  for (const mutate of [
    (_value: Entry, entry: Entry) => { entry.version = 1; },
    (_value: Entry, entry: Entry) => { entry.description = { text: "x" }; },
    (_value: Entry, entry: Entry) => { entry.author = { name: "a", command: "run" }; },
    (_value: Entry, entry: Entry) => { entry.tags = "lsp"; },
    (_value: Entry, entry: Entry) => { entry.metadata = ["not", "an", "object"]; },
    (_value: Entry, entry: Entry) => { entry.strict = "false"; },
  ]) expect(() => digest(text(mutate))).toThrow("Claude marketplace entry witness has an invalid entry");
});

test("control 6: a missing, duplicated, case-ambiguous or redirected entry refuses", () => {
  expect(() => digest(text(value => { value.plugins = value.plugins.filter((item: Entry) => item.name !== "swift-lsp"); }))).toThrow("selected plugin entry is missing");
  expect(() => digest(text(value => { value.plugins.push(swiftLsp()); }))).toThrow("selected plugin entry is duplicated or ambiguous");
  expect(() => digest(text(value => { value.plugins.push({ ...swiftLsp(), name: "Swift-LSP" }); }))).toThrow("selected plugin entry is duplicated or ambiguous");
  expect(() => digest(text(value => { value.renames["swift-lsp"] = "swift-lsp-next"; }))).toThrow("plugin id is redirected by the marketplace renames map");
  expect(() => digest(text(value => { value.renames["swift-lsp"] = null; }))).toThrow("plugin id is redirected by the marketplace renames map");
  expect(() => digest(text(value => { value.renames = { old: 3 }; }))).toThrow("has an invalid renames map");
  expect(() => digest(text(value => { value.name = "claude-plugins-unofficial"; }))).toThrow("marketplace name does not match the reviewed binding");
  expect(() => digest(text(value => { delete value.plugins; }))).toThrow("requires a plugins array");
  expect(() => hashClaudeMarketplaceEntry(text(), { marketplace: "claude-plugins-official", plugin: "swift lsp" })).toThrow("requires an exact marketplace and plugin name");
  expect(() => hashClaudeMarketplaceEntry(text(), { marketplace: "a..b", plugin: "swift-lsp" })).toThrow("requires an exact marketplace and plugin name");
});

test("control 7: metadata.pluginRoot is bound, including its presence", () => {
  const withRoot = digest(text(value => { value.metadata = { pluginRoot: "./plugins" }; }));
  const otherRoot = digest(text(value => { value.metadata = { pluginRoot: "./vendor" }; }));
  expect(withRoot).not.toBe(base);
  expect(otherRoot).not.toBe(base);
  expect(otherRoot).not.toBe(withRoot);
  expect(digest(text(value => { value.metadata = { pluginRoot: "./plugins", description: "only metadata" }; }))).toBe(withRoot);
  expect(() => digest(text(value => { value.metadata = { pluginRoot: 3 }; }))).toThrow("has an invalid marketplace metadata.pluginRoot");
});

test("cross-marketplace dependency permission is bound only for an entry that declares dependencies", () => {
  const withDependencies = (allowed?: string[]) => digest(text((value, entry) => {
    entry.dependencies = ["helper@other-market"];
    if (allowed) value.allowCrossMarketplaceDependenciesOn = allowed;
  }));
  expect(withDependencies()).not.toBe(withDependencies(["other-market"]));
  expect(withDependencies(["other-market"])).not.toBe(withDependencies(["other-market", "third"]));
  expect(digest(text(value => { value.allowCrossMarketplaceDependenciesOn = ["anything"]; }))).toBe(base);
  expect(() => digest(text(value => { value.allowCrossMarketplaceDependenciesOn = "other-market"; }))).toThrow("invalid allowCrossMarketplaceDependenciesOn");
});

test("unparsable or ambiguous marketplace JSON refuses", () => {
  const raw = text();
  for (const invalid of [
    raw.slice(0, -2),
    raw + "\n{}",
    "[]",
    raw.replace('"name": "swift-lsp",', '"name": "swift-lsp",\n      "name": "swift-lsp",'),
    raw.replace('"name": "claude-plugins-official",', '"name": "claude-plugins-official",\n  "name": "claude-plugins-official",'),
    raw.replace('"strict": false', '"strict": False'),
  ]) expect(() => digest(invalid)).toThrow("Claude marketplace entry witness cannot parse marketplace.json");
});

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function tree(root: string): string {
  const rows: string[] = [];
  const walk = (path: string) => {
    const stat = lstatSync(path);
    rows.push(`${path} ${stat.mode} ${stat.size} ${stat.mtimeMs} ${stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : ""}`);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
  };
  walk(root);
  return rows.join("\n");
}

test("capture reads a normalized regular .claude-plugin/marketplace.json, refuses other paths and writes nothing", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-marketplace-entry-")));
  homes.push(home);
  const root = join(home, ".claude/plugins/marketplaces/claude-plugins-official");
  const path = join(root, ".claude-plugin/marketplace.json");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(path, text());
  mkdirSync(join(home, "real/.claude-plugin"), { recursive: true });
  writeFileSync(join(home, "real/.claude-plugin/marketplace.json"), text());
  symlinkSync(join(home, "real"), join(home, "linked"));
  mkdirSync(join(home, "file-link/.claude-plugin"), { recursive: true });
  symlinkSync(path, join(home, "file-link/.claude-plugin/marketplace.json"));
  mkdirSync(join(home, "directory/.claude-plugin/marketplace.json"), { recursive: true });
  writeFileSync(join(root, "marketplace.json"), text());
  const before = tree(home);

  expect(captureClaudeMarketplaceEntry(path, "claude-plugins-official", "swift-lsp")).toEqual({ path, hashMode: "claude-marketplace-entry-v1", marketplace: "claude-plugins-official", plugin: "swift-lsp", sha256: base });
  for (const invalid of [
    ".claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json",
    `${root}/../claude-plugins-official/.claude-plugin/marketplace.json`,
    path.replace("/.claude-plugin/", "//.claude-plugin/"),
    `${path}/`,
    path.replace("claude-plugins-official/", "claude-plugins-official\n/"),
    join(root, "marketplace.json"),
    join(root, ".claude-plugin/plugin.json"),
  ]) expect(() => captureClaudeMarketplaceEntry(invalid, "claude-plugins-official", "swift-lsp")).toThrow("requires a normalized absolute .claude-plugin/marketplace.json path");
  for (const unreadable of [
    join(home, "linked/.claude-plugin/marketplace.json"),
    join(home, "file-link/.claude-plugin/marketplace.json"),
    join(home, "directory/.claude-plugin/marketplace.json"),
    join(home, "missing/.claude-plugin/marketplace.json"),
  ]) expect(() => captureClaudeMarketplaceEntry(unreadable, "claude-plugins-official", "swift-lsp")).toThrow("cannot read marketplace.json");
  expect(() => captureClaudeMarketplaceEntry(path, "claude-plugins-official", "missing-plugin")).toThrow("selected plugin entry is missing");
  expect(() => captureClaudeMarketplaceEntry(path, "claude-plugins-official", "swift-lsp", { remaining: 10 })).toThrow("cannot read marketplace.json");
  expect(tree(home)).toBe(before);
});

test("source validation binds the agent-neutral path and names used by discovery and the stored policy", () => {
  const path = "/home/user/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json";
  expect(claudeMarketplaceEntrySourceValid({ path, marketplace: "claude-plugins-official", plugin: "swift-lsp" })).toBe(true);
  for (const source of [
    { path, marketplace: "claude-plugins-official" },
    { path, plugin: "swift-lsp" },
    { path, marketplace: "", plugin: "swift-lsp" },
    { path, marketplace: "claude-plugins-official", plugin: "-swift" },
    { path, marketplace: "claude-plugins-official", plugin: "swift@lsp" },
    { path, marketplace: "claude/plugins", plugin: "swift-lsp" },
    { path: path.replace(".claude-plugin", "claude-plugin"), marketplace: "claude-plugins-official", plugin: "swift-lsp" },
    { path: path.replace("/home/user", "/home/user/../user"), marketplace: "claude-plugins-official", plugin: "swift-lsp" },
    { path: path + "\0", marketplace: "claude-plugins-official", plugin: "swift-lsp" },
  ]) expect(claudeMarketplaceEntrySourceValid(source)).toBe(false);
});
