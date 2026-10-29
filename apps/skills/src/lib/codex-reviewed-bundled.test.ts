import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture } from "./codex-corpus.fixture.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories } from "./agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { codexLocalMarketplaceMapsPlugin } from "./codex-semantic-cache-witness.js";

useDefaultTestTimeout();
const originalPath = process.env.PATH;
afterEach(() => { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath; });
const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };

// The runner owns sandbox retention. Keep these synthetic fixtures for inspection
// without depending on a station cleanup service during this regression.
function fixture(runtime = false, hooks = true, registered = true) {
  const home = mkdtempSync(join(tmpdir(), "skills-reviewed-bundled-"));
  admitCorpusFixture(join(home, ".codex"));
  const inspector = join(home, "bin/codex");
  put(inspector, `#!${process.execPath}
import { lstatSync } from "node:fs";
if (process.argv[2] === "--version") { console.log("codex-cli 0.160.0"); process.exit(0); }
if (process.argv[2] === "help" && ["corpus-admission-inspect", "exec"].includes(process.argv[3])) process.exit(0);
if (process.argv[2] !== "corpus-admission-inspect" || process.argv[3] !== "--home") process.exit(2);
const root = process.argv[4], id = path => { const s = lstatSync(path, { bigint: true }); return { device: String(s.dev), inode: String(s.ino) }; };
console.log(JSON.stringify({ schema: "codex-corpus-admission-status/v1", state: "committed-v2", root: id(root), lock: id(root + "/.native-corpus-admission.flock-v1") }));
`);
  chmodSync(inspector, 0o700); process.env.PATH = dirname(inspector) + ":" + originalPath;
  const market = runtime ? join(home, ".cache/codex-runtimes/fixture/plugins/openai-bundled") : join(home, ".codex/.tmp/bundled-marketplaces/openai-bundled");
  const config = join(home, ".codex/config.toml"), catalog = join(market, ".agents/plugins/marketplace.json");
  const definitions = [["computer-use", ["computer-use"]], ["latex", ["latex-one", "latex-two", "latex-three"]], ["record-and-replay", ["record"]], ["sites", ["site-one", "site-two"]]] as const;
  const plugins = definitions.map(([name]) => join(market, "plugins", name));
  const registeredNames = registered ? definitions.map(([name]) => name) : ["browser", "chrome"];
  const catalogNames = [...definitions.map(([name]) => name), ...(registered ? [] : registeredNames)];
  const documents: string[] = [], manifests: string[] = [];
  put(config, `[marketplaces."openai-bundled"]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n` + registeredNames.map(name => `[plugins."${name}@openai-bundled"]\nenabled = true\n`).join(""));
  put(catalog, JSON.stringify({ interface: 1, name: "openai-bundled", plugins: catalogNames.map(name => ({ name, source: { source: "local", path: `./plugins/${name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: name === "latex" ? "Education & Research" : "Productivity" })) }));
  definitions.forEach(([name, skills], index) => {
    const plugin = plugins[index]!, manifest = join(plugin, ".codex-plugin/plugin.json"); manifests.push(manifest);
    put(manifest, JSON.stringify({ name, skills: "./skills", ...(hooks ? { hooks: { hooks: { Stop: [] } } } : {}) }));
    for (const skill of skills) { const document = join(plugin, "skills", skill, "SKILL.md"); documents.push(document); put(document, `---\nname: ${skill}\ndescription: Synthetic disabled fixture\n---\nSynthetic instructions.\n`); }
  });
  if (!registered) for (const name of registeredNames) {
    const manifest = join(market, "plugins", name, ".codex-plugin/plugin.json");
    manifests.push(manifest);
    put(manifest, JSON.stringify({ name, skills: "./skills", ...(hooks ? { hooks: { hooks: { Stop: [] } } } : {}) }));
  }
  const options = { home, dataDir: join(home, "data"), projectDir: home, agents: ["codex"] as ["codex"] };
  const extraSources: string[] = [];
  const review = () => ({ version: 1 as const, agents: [{ agent: "codex" as const, roots: plugins.map(plugin => join(plugin, "skills")), sources: captureDiscoveryByteSources([config, catalog, ...manifests, ...extraSources]), directories: captureDiscoveryDirectories(plugins), pluginHooks: "reviewed-no-skill-injection" as const }] });
  const install = () => applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: review(), includeVendor: true }));
  const guard = () => assertManagedAgentBridge("codex", options);
  const policy = join(options.dataDir, "agent-policy.json");
  const changePolicy = (change: (value: any) => void) => { const value = JSON.parse(readFileSync(policy, "utf8")); change(value); put(policy, JSON.stringify(value)); };
  return { ...options, config, catalog, documents, manifests, plugins, extraSources, review, install, guard, policy, changePolicy, options };
}

for (const runtime of [false, true]) test(`reviewed ${runtime ? "runtime" : "temporary bundled"} marketplace admits seven exact disabled skills and retains the review`, () => {
  const f = fixture(runtime);
  expect(() => planAgentIntegration({ ...f.options, discoveryInputs: { version: 1, agents: [] } })).toThrow("plugin hooks require");
  f.install();
  const config = Bun.TOML.parse(readFileSync(f.config, "utf8")) as any;
  expect(f.documents).toHaveLength(7);
  for (const path of f.documents) expect(config.skills.config).toContainEqual({ path, enabled: false });
  expect(JSON.parse(readFileSync(f.policy, "utf8")).bridge.discovery.codex.method).toBe("reviewed");
  expect(f.guard).not.toThrow();
  expect(planAgentIntegration(f.options).changes).toEqual([]);
  for (const path of f.documents) expect(readFileSync(path, "utf8")).toContain("Synthetic instructions.");
});

for (const runtime of [false, true]) test(`reviewed ${runtime ? "runtime" : "temporary bundled"} source-only plugins need no enablement entries`, () => {
  const f = fixture(runtime, true, false);
  const before = Bun.TOML.parse(readFileSync(f.config, "utf8")) as any;
  expect(Object.keys(before.plugins).sort()).toEqual(["browser@openai-bundled", "chrome@openai-bundled"]);
  f.install();
  const config = Bun.TOML.parse(readFileSync(f.config, "utf8")) as any;
  expect(config.plugins).toEqual(before.plugins);
  for (const path of f.documents) expect(config.skills.config).toContainEqual({ path, enabled: false });
  expect(f.guard).not.toThrow();
  expect(planAgentIntegration(f.options).changes).toEqual([]);
});

test("automatic bundled discovery keeps its existing exact-disable behavior", () => {
  const f = fixture(false, false);
  applyAgentIntegration(planAgentIntegration({ ...f.options, includeVendor: true }));
  expect(f.guard).not.toThrow();
});

for (const source of ["manifest", "catalog", "declared-root", "mapping"]) test(`reviewed method alone cannot replace exact bundled ${source} proof`, () => {
  const f = fixture(false, true, false); f.install();
  if (source === "manifest" || source === "catalog") f.changePolicy(value => { value.bridge.discovery.codex.sources = value.bridge.discovery.codex.sources.filter((s: any) => s.path !== (source === "manifest" ? f.manifests[0] : f.catalog)); });
  if (source === "declared-root") { put(f.manifests[0]!, JSON.stringify({ name: "computer-use", skills: "./other", hooks: { hooks: { Stop: [] } } })); f.install(); }
  if (source === "mapping") {
    const catalog = JSON.parse(readFileSync(f.catalog, "utf8"));
    catalog.plugins[0].source.path = "./alternate/computer-use";
    const otherManifest = join(dirname(dirname(dirname(f.catalog))), "alternate/computer-use/.codex-plugin/plugin.json");
    put(otherManifest, readFileSync(f.manifests[0]!, "utf8")); f.extraSources.push(otherManifest);
    put(f.catalog, JSON.stringify(catalog)); f.install();
  }
  expect(f.guard).toThrow("NATIVE_SKILL_DRIFT");
});

for (const mutation of ["enabled", "plugin-config", "unknown", "manifest", "hook", "catalog", "catalog-metadata", "unrelated"]) test(`reviewed bundled admission refuses ${mutation} drift`, () => {
  const f = fixture(false, true, false); f.install(); expect(f.guard).not.toThrow();
  if (mutation === "enabled") { const before = readFileSync(f.config, "utf8"), after = before.replace(`path = ${JSON.stringify(f.documents[0])}\nenabled = false`, `path = ${JSON.stringify(f.documents[0])}\nenabled = true`); expect(after).not.toBe(before); put(f.config, after); }
  if (mutation === "plugin-config") put(f.config, readFileSync(f.config, "utf8") + '\n[plugins."new@openai-bundled"]\nenabled = true\n');
  if (mutation === "unknown") put(join(f.plugins[0]!, "skills/unreviewed/SKILL.md"), "Unreviewed synthetic instructions\n");
  if (mutation === "unrelated") { put(join(f.home, ".codex/skills/unrelated/SKILL.md"), "Unrelated synthetic instructions\n"); }
  if (mutation === "manifest" || mutation === "hook") { const path = f.manifests[0]!, value = JSON.parse(readFileSync(path, "utf8")); if (mutation === "hook") value.hooks.hooks.Stop.push({ hooks: [{ type: "command", command: "synthetic-never-executed" }] }); else value.skills = "./different"; put(path, JSON.stringify(value)); }
  if (mutation === "catalog") put(f.catalog, readFileSync(f.catalog, "utf8") + "\n");
  if (mutation === "catalog-metadata") { const catalog = JSON.parse(readFileSync(f.catalog, "utf8")); catalog.plugins[0].category = "Engineering"; put(f.catalog, JSON.stringify(catalog)); }
  expect(f.guard).toThrow("NATIVE_SKILL_DRIFT");
});

// These are the policy/category shapes in the captured bundled catalog. They
// describe installation metadata, while the full current catalog still binds
// every byte and the existing local-source identity check remains mandatory.
test("local marketplace matching accepts reviewed policy/category metadata and the minimal schema", () => {
  const catalog = (row: unknown) => JSON.stringify({ interface: { displayName: "Synthetic marketplace" }, name: "openai-bundled", plugins: [row] });
  const row = { name: "computer-use", source: { source: "local", path: "./plugins/computer-use" } };
  expect(codexLocalMarketplaceMapsPlugin(catalog(row), "openai-bundled", "computer-use")).toBe(true);
  expect(codexLocalMarketplaceMapsPlugin(catalog({ ...row, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Education & Research" }), "openai-bundled", "computer-use")).toBe(true);
  for (const changed of [
    { ...row, hooks: {} },
    ...[null, [], {}, { installation: "AVAILABLE" }, { installation: "AVAILABLE", authentication: "ON_INSTALL", extra: true }, { installation: "FORCED", authentication: "ON_INSTALL" }, { installation: "AVAILABLE", authentication: "NONE" }].map(policy => ({ ...row, policy })),
    ...[null, 1, [], "", " ", " label", "label ", "line\nbreak", "x".repeat(129)].map(category => ({ ...row, category })),
    { ...row, source: { ...row.source, extra: true } },
    { ...row, source: { source: "remote", path: "./plugins/computer-use" } },
    { ...row, source: { source: "local", path: "../plugins/computer-use" } },
  ]) expect(codexLocalMarketplaceMapsPlugin(catalog(changed), "openai-bundled", "computer-use")).toBe(false);
  expect(codexLocalMarketplaceMapsPlugin(catalog(row), "different", "computer-use")).toBe(false);
  expect(codexLocalMarketplaceMapsPlugin(catalog(row), "openai-bundled", "different")).toBe(false);
});
