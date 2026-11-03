import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveAgentDiscovery, resolveAgentDiscoveryExclusionRoots } from "./agent-discovery.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";

// SH-00053: a marketplace-defined plugin ("strict": false) ships no
// plugin.json, and Claude keeps a user row and a project row for a plugin
// installed in both scopes. Authoring exclusion must accept both shapes
// without loosening anything else. The runner confines TMPDIR and HOME to a
// credential-free sandbox; fixtures are retained for evidence.

function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

interface EntryOptions { strict?: boolean | "absent"; version?: string | null; source?: unknown; renames?: Record<string, string>; extra?: Record<string, unknown> }
function strictFalseHome(entry: EntryOptions = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-registration-")));
  const claude = join(home, ".claude"), market = join(claude, "plugins/marketplaces/market");
  const cache = join(claude, "plugins/cache/market/swift-lsp/1.0.0");
  put(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "swift-lsp@market": true } }));
  put(join(claude, "plugins/known_marketplaces.json"), JSON.stringify({ market: { source: { source: "github", repo: "example/market" }, installLocation: market, lastUpdated: "2026-11-03T00:00:00.000Z" } }));
  const plugin: Record<string, unknown> = { name: "swift-lsp", description: "Swift language server", source: entry.source === undefined ? "./plugins/swift-lsp" : entry.source, lspServers: { swift: { command: "sourcekit-lsp", extensionToLanguage: { ".swift": "swift" } } }, ...entry.extra };
  if (entry.strict !== "absent") plugin.strict = entry.strict ?? false;
  if (entry.version !== null) plugin.version = entry.version ?? "1.0.0";
  put(join(market, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "market", owner: { name: "Example" }, plugins: [plugin], ...(entry.renames ? { renames: entry.renames } : {}) }));
  put(join(cache, "README.md"), "Synthetic marketplace-defined plugin.\n");
  put(join(claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "swift-lsp@market": [{ scope: "user", installPath: cache, version: "1.0.0" }] } }));
  return { home, claude, market, cache };
}
const exclusion = (home: string) => resolveAgentDiscoveryExclusionRoots({ home, agent: "claude", canonical: resolve, executable: null });

test("a strict:false marketplace plugin without plugin.json is reviewed through its marketplace entry", () => {
  const f = strictFalseHome();
  const roots = exclusion(f.home);
  expect(roots).toContain(f.cache);
  expect(roots).toContain(join(f.cache, "skills"));
  // The authoring boundary that `skills create` and `prepare` call admits a
  // private corpus and still refuses the plugin's own skill root.
  expect(() => assertPortableAuthoringPath(join(f.home, "corpus/probe"), { homeDir: f.home })).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(f.cache, "skills/probe"), { homeDir: f.home })).toThrow("native discovery root");
});

test("a missing plugin.json still refuses when the entry is strict true or does not say strict", () => {
  for (const strict of [true, "absent"] as const) {
    const f = strictFalseHome({ strict });
    expect(() => exclusion(f.home)).toThrow("plugin manifest missing and its marketplace entry is not admissible: entry is not strict false");
    expect(() => assertPortableAuthoringPath(join(f.home, "corpus/probe"), { homeDir: f.home })).toThrow("plugin manifest missing");
  }
});

test("the marketplace entry must agree with the registration and stay inside the marketplace root", () => {
  const cases: Array<[EntryOptions, string]> = [
    [{ version: "2.0.0" }, "entry version is missing or differs from the registration"],
    [{ version: null }, "entry version is missing or differs from the registration"],
    [{ source: "../outside" }, "entry source is not a path inside the marketplace root"],
    [{ source: "./" }, "entry source is not a path inside the marketplace root"],
    [{ source: { source: "github", repo: "example/swift-lsp" } }, "entry source is not a path inside the marketplace root"],
    [{ renames: { "swift-lsp": "other-lsp" } }, "plugin id is redirected"],
    [{ extra: { injected: true } }, "unknown key"],
  ];
  for (const [entry, reason] of cases) expect(() => exclusion(strictFalseHome(entry).home)).toThrow(reason);
});

test("the registration must name the cache path of its marketplace, plugin and version", () => {
  const f = strictFalseHome(), elsewhere = join(f.claude, "plugins/cache/market/swift-lsp/9.9.9");
  put(join(elsewhere, "README.md"), "Elsewhere.\n");
  put(join(f.claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "swift-lsp@market": [{ scope: "user", installPath: elsewhere, version: "1.0.0" }] } }));
  expect(() => exclusion(f.home)).toThrow("installation root is not the registered cache path");
  put(join(f.claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "swift-lsp@market": [{ scope: "user", installPath: f.cache, version: "../1.0.0" }] } }));
  expect(() => exclusion(f.home)).toThrow("registration version");
  put(join(f.claude, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "swift-lsp@market": [{ scope: "user", installPath: f.cache }] } }));
  expect(() => exclusion(f.home)).toThrow("registration version");
});

test("the marketplace must be a known marketplace with its own catalog", () => {
  const f = strictFalseHome();
  put(join(f.claude, "plugins/known_marketplaces.json"), JSON.stringify({ other: { installLocation: f.market } }));
  expect(() => exclusion(f.home)).toThrow("marketplace location");
  const g = strictFalseHome();
  put(join(g.claude, "plugins/known_marketplaces.json"), JSON.stringify({ market: { installLocation: join(g.claude, "plugins/marketplaces/missing") } }));
  expect(() => exclusion(g.home)).toThrow("marketplace catalog missing");
});

test("a strict:false plugin that carries hooks still needs its separate review", () => {
  const f = strictFalseHome();
  put(join(f.cache, "hooks/hooks.json"), JSON.stringify({ hooks: { SessionStart: [] } }));
  expect(() => exclusion(f.home)).toThrow("plugin hooks require a separate no-skill-injection review");
});

test("native admission is unchanged: a missing plugin.json still refuses there", () => {
  const f = strictFalseHome();
  expect(() => resolveAgentDiscovery({ home: f.home, agent: "claude", executable: null })).toThrow("plugin manifest missing");
});

function manifestPlugin(root: string): string {
  put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "fixture" }));
  return root;
}
function registrationHome(rows: Array<{ scope: string; installPath?: string; projectPath?: string }>) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-registration-rows-")));
  put(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "fixture@market": true } }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "fixture@market": rows } }));
  return home;
}

test("one user row and a project row: both roots are reviewed", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "claude-plugin-roots-")));
  const user = manifestPlugin(join(base, "user/fixture/f0dce59fec06")), project = manifestPlugin(join(base, "project/fixture/3deb821cb71c"));
  const home = registrationHome([{ scope: "user", installPath: user }, { scope: "project", installPath: project, projectPath: join(base, "work") }]);
  const roots = exclusion(home);
  expect(roots).toContain(join(user, "skills"));
  expect(roots).toContain(join(project, "skills"));
  // A single user row keeps working as before.
  expect(exclusion(registrationHome([{ scope: "user", installPath: user }]))).toContain(join(user, "skills"));
  // Two rows at the same root are reviewed once.
  expect(exclusion(registrationHome([{ scope: "user", installPath: user }, { scope: "local", installPath: user, projectPath: base }]))).toContain(join(user, "skills"));
});

test("native admission keeps refusing more than one registration row", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "claude-plugin-roots-")));
  const user = manifestPlugin(join(base, "user/fixture/1")), project = manifestPlugin(join(base, "project/fixture/1"));
  for (const extra of [{ scope: "project", installPath: project, projectPath: base }, { scope: "local", installPath: project, projectPath: base }]) {
    const home = registrationHome([{ scope: "user", installPath: user }, extra]);
    expect(() => resolveAgentDiscovery({ home, agent: "claude", executable: null })).toThrow("enabled plugin registration is missing or ambiguous");
    expect(exclusion(home)).toContain(join(project, "skills"));
  }
  expect(() => resolveAgentDiscovery({ home: registrationHome([{ scope: "user", installPath: user }]), agent: "claude", executable: null })).not.toThrow();
});

test("registration rows refuse with no user row, two user rows, an unknown scope or a failed row", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "claude-plugin-roots-")));
  const user = manifestPlugin(join(base, "user/fixture/1")), second = manifestPlugin(join(base, "second/fixture/1"));
  const ambiguous = "enabled plugin registration is missing or ambiguous";
  expect(() => exclusion(registrationHome([]))).toThrow(ambiguous);
  expect(() => exclusion(registrationHome([{ scope: "project", installPath: user, projectPath: base }]))).toThrow(ambiguous);
  expect(() => exclusion(registrationHome([{ scope: "user", installPath: user }, { scope: "user", installPath: second }]))).toThrow(ambiguous);
  expect(() => exclusion(registrationHome([{ scope: "user", installPath: user }, { scope: "managed", installPath: second }]))).toThrow(ambiguous);
  expect(() => exclusion(registrationHome([{ scope: "user", installPath: user }, { scope: "project" }]))).toThrow(ambiguous);
  // Every row passes the same manifest review: a project row whose root has
  // no manifest (and no strict:false entry) refuses the whole review.
  const bare = join(base, "bare/fixture/1"); put(join(bare, "README.md"), "No manifest.\n");
  expect(() => exclusion(registrationHome([{ scope: "user", installPath: user }, { scope: "project", installPath: bare, projectPath: base }]))).toThrow("plugin manifest missing");
});
