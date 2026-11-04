import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { captureDiscoveryByteSources, captureDiscoveryPathSources, resolveAgentDiscovery } from "./agent-discovery.js";
import { captureClaudeSettingsV4 } from "./claude-settings-witness.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";

// A marketplace-defined Claude plugin may ship without .claude-plugin/plugin.json.
// The explicit review binds its default skills root and pins the manifest path
// as absent with a path-bytes witness; authoring exclusion must honor that review.
useDefaultTestTimeout();
const originalPath = process.env.PATH;
beforeEach(() => { process.env.PATH = "/usr/bin:/bin"; });
afterEach(() => { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath; });
const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const id = "manifestless@synthetic-market";
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "claude-manifestless-plugin-authoring-"));
  const settings = join(home, ".claude/settings.json"), registry = join(home, ".claude/plugins/installed_plugins.json");
  const plugin = join(home, ".claude/plugins/cache/synthetic-market/manifestless/1.0.0"), manifest = join(plugin, ".claude-plugin/plugin.json");
  const config = { enabledPlugins: { [id]: true } };
  put(settings, JSON.stringify(config)); put(join(plugin, "README.md"), "Synthetic manifest-less plugin\n");
  const rows = { [id]: [{ scope: "user", installPath: plugin, version: "1.0.0" }] };
  put(registry, JSON.stringify({ version: 2, plugins: rows }));
  const binding = resolveAgentDiscovery({ home, agent: "claude", reviewed: { version: 1, agents: [{ agent: "claude", roots: [join(plugin, "skills")], pluginHooks: "reviewed-no-skill-injection", sources: [captureClaudeSettingsV4(settings), ...captureDiscoveryByteSources([registry]), ...captureDiscoveryPathSources([manifest])] }] } });
  const policy = join(home, ".hasna/skills/agent-policy.json"), save = () => put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude: binding } } })); save();
  const rootDir = join(home, "private-authoring"), options = { homeDir: home, rootDir };
  return { home, settings, registry, config, rows, plugin, manifest, binding, policy, save, rootDir, options };
}
const refusal = (run: () => void): string => { try { run(); } catch (error) { return (error as Error).message; } return ""; };

test("the explicit review binds a manifest-less cache plugin by its default root and pinned absence", () => {
  const f = fixture();
  expect(f.binding.method).toBe("reviewed");
  expect(f.binding.roots).toContain(join(f.plugin, "skills"));
  expect(f.binding.sources.some(source => source.path === f.manifest && source.hashMode === "path-bytes" && source.sha256 !== null)).toBe(true);
});

test("a reviewed manifest-less Claude plugin permits private authoring", () => {
  const f = fixture(), policy = readFileSync(f.policy);
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).not.toThrow();
  expect(readFileSync(f.policy).equals(policy)).toBe(true);
});

for (const target of ["skills/forbidden", "skills", "forbidden"]) test(`authoring at reviewed manifest-less plugin path ${target} stays refused`, () => {
  const f = fixture();
  expect(() => assertPortableAuthoringPath(join(f.plugin, target), f.options)).toThrow("native discovery root");
});

test("authoring inside a reviewed manifest-less plugin skills root is refused as a configured root", () => {
  const f = fixture(), outside = join(f.home, "outside-cache");
  // Move the plugin outside the default cache boundary so only configured discovery protects it.
  const plugin = join(outside, "manifestless"), manifest = join(plugin, ".claude-plugin/plugin.json");
  put(join(plugin, "README.md"), "Synthetic manifest-less plugin\n");
  put(f.registry, JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user", installPath: plugin }] } }));
  const binding = resolveAgentDiscovery({ home: f.home, agent: "claude", reviewed: { version: 1, agents: [{ agent: "claude", roots: [join(plugin, "skills")], pluginHooks: "reviewed-no-skill-injection", sources: [captureClaudeSettingsV4(f.settings), ...captureDiscoveryByteSources([f.registry]), ...captureDiscoveryPathSources([manifest])] }] } });
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { claude: binding } } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(plugin, "skills/forbidden"), f.options)).toThrow("configured native discovery root");
});

test("an enabled manifest-less plugin outside the retained review still needs a manifest", () => {
  const f = fixture(), other = join(f.home, ".claude/plugins/cache/synthetic-market/unreviewed/2.0.0");
  put(join(other, "README.md"), "Synthetic unreviewed plugin\n");
  put(f.settings, JSON.stringify({ enabledPlugins: { ...f.config.enabledPlugins, "unreviewed@synthetic-market": true } }));
  put(f.registry, JSON.stringify({ version: 2, plugins: { ...f.rows, "unreviewed@synthetic-market": [{ scope: "user", installPath: other, version: "2.0.0" }] } }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).toThrow("plugin manifest missing");
});

test("a manifest-less plugin without any retained review still needs a manifest", () => {
  const f = fixture(); put(f.policy, JSON.stringify({ loading: "cli" }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).toThrow("plugin manifest missing");
});

test("a covered root without a pinned manifest absence still needs a manifest", () => {
  const f = fixture();
  f.binding.sources = f.binding.sources.filter(source => source.path !== f.manifest); f.save();
  expect(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options)).toThrow("plugin manifest missing");
});

test("hooks that appear in a reviewed manifest-less plugin after review are refused", () => {
  const f = fixture(); put(join(f.plugin, "hooks/hooks.json"), JSON.stringify({ hooks: {} }));
  expect(refusal(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options))).toContain("plugin hooks require current independently reviewed sources");
});

test("legacy commands in a reviewed manifest-less plugin are refused", () => {
  const f = fixture(); put(join(f.plugin, "commands/legacy.md"), "Synthetic legacy command\n");
  expect(refusal(() => assertPortableAuthoringPath(join(f.rootDir, "synthetic-guide"), f.options))).toContain("legacy command discovery requires retirement");
});
