import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { codexVendorPluginRefreshSafe } from "./codex-vendor-refresh.js";
import {
  CODEX_PLUGIN_MANIFEST_LOCATIONS,
  CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES,
  codexPluginRootCapabilityEntry,
  isCodexSkillDocumentName,
} from "./codex-plugin-capability-paths.js";
import { CODEX_CAPABILITY_PATH_MUTATIONS, CODEX_INERT_NESTED_NAMES } from "./codex-plugin-capability-paths.fixture.js";
import {
  assertCodexSemanticCacheWitnessUnchanged,
  captureCodexSemanticCacheWitness,
  type CodexSemanticCacheAppOnlyParent,
  type CodexSemanticCacheReviewedHookParent,
  type CodexSemanticCacheWitness,
} from "./codex-semantic-cache-witness.js";
import type { CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const REFUSAL = "CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED";

/** A Codex cache holding the three semantic roles stations use: the vendor
 * skill plugin openai-curated-remote/sites, the app-only vendor plugin
 * openai-curated-remote/pages and the reviewed local hasna-codex hook plugin. */
function station() {
  const home = mkdtempSync(join(tmpdir(), "skills-semantic-capability-")); roots.push(home);
  const cacheRoot = join(home, ".codex/plugins/cache");
  const sites = join(cacheRoot, "openai-curated-remote/sites"), pages = join(cacheRoot, "openai-curated-remote/pages");
  const bridge = join(cacheRoot, "hasna-internal-bridge/hasna-codex");
  const sitesRemote = `plugins~Plugin_${"sites".padEnd(32, "0")}`, pagesRemote = `plugins~Plugin_${"pages".padEnd(32, "0")}`;
  const sitesReceipt = JSON.stringify({ schema_version: 1, remote_plugin_id: sitesRemote });
  put(join(sites, ".codex-remote-plugin-install.json"), sitesReceipt);
  put(join(pages, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: pagesRemote }));
  const sitesApp = '{"apps":{"sites":{"id":"synthetic_sites_connector","required":true}}}';
  const pagesApp = '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  const sitesManifest = (version: string) => JSON.stringify({ name: "sites", version, description: "Synthetic plugin", skills: "./skills/", apps: "./.app.json", interface: { displayName: "Sites" } });
  const addSites = (version: string) => {
    const root = join(sites, version);
    put(join(root, ".codex-plugin/plugin.json"), sitesManifest(version)); put(join(root, ".app.json"), sitesApp);
    put(join(root, "skills/sites-remix/SKILL.md"), "---\nname: sites-remix\ndescription: Synthetic disabled vendor skill\n---\nContent");
    return root;
  };
  const addPages = (version: string) => {
    const root = join(pages, version);
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "pages", version, apps: "./.app.json" })); put(join(root, ".app.json"), pagesApp);
    return root;
  };
  const addBridge = (version: string) => {
    const root = join(bridge, version);
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "hasna-codex", version, hooks: "./hooks/hooks.json", description: "Synthetic Hasna Codex bridge hooks" }));
    put(join(root, "hooks/hooks.json"), JSON.stringify({ hooks: {
      SessionStart: [{ hooks: [{ type: "mcp_tool", server: "skills_bridge", tool: "activate_hook", input: {}, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: "mcp_tool", server: "skills_bridge", tool: "activate_hook", input: {}, timeout: 5 }] }],
    } }));
    return root;
  };
  addSites("1.0.0"); addPages("0.1.23"); addBridge("0.1.0");
  const marketplaceSourcePath = join(home, "bridge-package/plugin/.agents/plugins/marketplace.json");
  const marketplace = '{"interface":{"displayName":"Hasna internal bridge"},"name":"hasna-internal-bridge","plugins":[{"name":"hasna-codex","source":{"source":"local","path":"./plugins/hasna-codex"}}]}';
  put(marketplaceSourcePath, marketplace);
  const controls: CodexPluginSkillControl[] = [{
    name: "sites:sites-remix", pluginId: "sites@openai-curated-remote", namespace: "sites", pluginParent: sites,
    manifestSha256: hashNativeJsonControls(sitesManifest("1.0.0"), "version"), appSha256: hashNativeJsonControls(sitesApp), remotePluginId: sitesRemote,
  }];
  const appOnlyParents: CodexSemanticCacheAppOnlyParent[] = [{ role: "app-only", pluginId: "pages@openai-curated-remote", namespace: "pages", pluginParent: pages, remotePluginId: pagesRemote }];
  const reviewedHookParents: CodexSemanticCacheReviewedHookParent[] = [{ role: "reviewed-hook", pluginId: "hasna-codex@hasna-internal-bridge", namespace: "hasna-codex", pluginParent: bridge,
    installation: "local-marketplace", marketplaceSourcePath, marketplaceSha256: createHash("sha256").update(marketplace).digest("hex") }];
  const rules = [{ name: "sites:sites-remix", enabled: false }];
  const capture = (hookParents = reviewedHookParents) => captureCodexSemanticCacheWitness({
    cacheRoot, controls, appOnlyParents, reviewedHookParents: hookParents, rules, read: path => readFileSync(path, "utf8"),
  });
  const targets = [
    { label: "vendor plugin openai-curated-remote/sites 1.0.0 -> 1.0.1", namespace: "sites", hookParent: false, bump: () => addSites("1.0.1") },
    { label: "vendor app-only plugin openai-curated-remote/pages 0.1.23 -> 0.1.24", namespace: "pages", hookParent: false, bump: () => addPages("0.1.24") },
    { label: "reviewed hasna-codex hook plugin 0.1.0 -> 0.1.1", namespace: "hasna-codex", hookParent: true, bump: () => addBridge("0.1.1") },
  ] as const;
  return { home, cacheRoot, sites, pages, bridge, sitesReceipt, capture, targets, addSites };
}

test("the shared definition lists every manifest location in Codex lookup order and folds case", () => {
  expect(CODEX_PLUGIN_MANIFEST_LOCATIONS).toEqual(["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]);
  for (const location of CODEX_PLUGIN_MANIFEST_LOCATIONS) expect(CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES).toContain(location.split("/")[0]!);
  expect([...CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES].sort()).toEqual([".app.json", ".claude-plugin", ".codex-plugin", ".cursor-plugin", ".mcp.json", "agents", "commands", "hooks", "hooks.json", "plugin.json"]);
  expect(codexPluginRootCapabilityEntry("AGENTS")).toBe("agents");
  expect(codexPluginRootCapabilityEntry("hoo\u212As.json")).toBe("hooks.json");
  expect(codexPluginRootCapabilityEntry("assets")).toBeNull();
  expect(["SKILL.md", "skill.md", "Skill.MD", "\u017Fkill.md"].every(isCodexSkillDocumentName)).toBe(true);
  expect(isCodexSkillDocumentName("SKILL.md.bak")).toBe(false);
});

test("positive control: version bumps without new capability paths keep the semantic witness", () => {
  const s = station(), before = s.capture();
  expect(before.controls).toHaveLength(1);
  expect(before.appOnlyParents).toHaveLength(1);
  expect(before.hookParents).toHaveLength(1);
  for (const target of s.targets) {
    target.bump();
    const after = s.capture();
    expect([target.label, after.sha256]).toEqual([target.label, before.sha256]);
    expect(() => assertCodexSemanticCacheWitnessUnchanged(before, after)).not.toThrow();
  }
});

test("positive control: an identical receipt rewrite keeps the semantic witness", () => {
  const s = station(), before = s.capture();
  writeFileSync(join(s.sites, ".codex-remote-plugin-install.json"), s.sitesReceipt);
  const after = s.capture();
  expect(after.sha256).toBe(before.sha256);
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, after)).not.toThrow();
});

test("positive control: capability names nested below a version root stay inert assets", () => {
  const s = station(), before = s.capture();
  for (const target of s.targets) {
    const root = target.bump();
    for (const name of CODEX_INERT_NESTED_NAMES) put(join(root, name), "Synthetic inert asset");
    const after = s.capture();
    expect([target.label, after.sha256]).toEqual([target.label, before.sha256]);
  }
});

const outcome = (capture: () => unknown): string => { try { capture(); return "captured"; } catch (error) { return (error as Error).message; } };

for (const mutation of CODEX_CAPABILITY_PATH_MUTATIONS) {
  test(`semantic capture and verification refuse a version that gains ${mutation.label}`, () => {
    let exercised = 0;
    for (const label of station().targets.map(target => target.label)) {
      const s = station(), target = s.targets.find(candidate => candidate.label === label)!;
      if (target.hookParent && !mutation.appliesToHookParent) continue;
      const baseline = s.capture();
      const root = target.bump();
      expect(s.capture().sha256).toBe(baseline.sha256);
      mutation.apply(root, target.namespace);
      // Capture refuses, so a stored witness can never be re-verified as unchanged.
      expect([label, outcome(() => s.capture())]).toEqual([label, expect.stringContaining(REFUSAL)]);
      expect(() => assertCodexSemanticCacheWitnessUnchanged(baseline, s.capture())).toThrow(REFUSAL);
      exercised++;
    }
    expect(exercised).toBe(mutation.appliesToHookParent ? 3 : 2);
  });
}

test("a capability path added to the already reviewed version root also refuses", () => {
  for (const mutation of CODEX_CAPABILITY_PATH_MUTATIONS) {
    if (mutation.label.startsWith("capability-named")) continue;
    const s = station();
    s.capture();
    mutation.apply(join(s.sites, "1.0.0"), "sites");
    expect([mutation.label, outcome(() => s.capture())]).toEqual([mutation.label, expect.stringContaining(REFUSAL)]);
  }
});

test("an old v1 witness without the hook-role field fails closed when a capability path appears", () => {
  const s = station();
  // v0.10.76 and earlier persisted this shape for a cache with no hook parent.
  rmSync(dirname(s.bridge), { recursive: true });
  const current = s.capture([]), previous = structuredClone(current) as Partial<CodexSemanticCacheWitness>;
  delete previous.hookParents;
  const encode = (value: any): string => value === null || typeof value !== "object" ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(encode).join(",")}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode(value[key])}`).join(",")}}`;
  const { sha256: _sha, ...projection } = previous;
  const legacy = { ...previous, sha256: createHash("sha256").update(encode(projection)).digest("hex") } as CodexSemanticCacheWitness;
  expect(() => assertCodexSemanticCacheWitnessUnchanged(legacy, s.capture([]))).not.toThrow();
  const root = s.addSites("1.0.1");
  expect(() => assertCodexSemanticCacheWitnessUnchanged(legacy, s.capture([]))).not.toThrow();
  put(join(root, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/plugin.json", name: "sites", mcpServers: { remote: { type: "http", url: "https://mcp.example.com/mcp" } } }));
  expect(() => assertCodexSemanticCacheWitnessUnchanged(legacy, s.capture([]))).toThrow(REFUSAL);
});

test("semantic mode is never weaker than the vendor-refresh guard on a vendor version root", () => {
  const vendorRefused: string[] = [];
  for (const mutation of CODEX_CAPABILITY_PATH_MUTATIONS) {
    const s = station(), root = s.addSites("1.0.1");
    expect(codexVendorPluginRefreshSafe(s.sites)).toBe(true);
    mutation.apply(root, "sites");
    const vendorSafe = codexVendorPluginRefreshSafe(s.sites), semanticSafe = outcome(() => s.capture()) === "captured";
    if (!vendorSafe) vendorRefused.push(mutation.label);
    expect([mutation.label, semanticSafe]).toEqual([mutation.label, false]);
  }
  // Both modes read the shared definition: every manifest, hook, MCP, command
  // and agent location the vendor guard refuses is refused here too.
  for (const label of ["Agent Plugins root plugin.json with an HTTPS MCP server and a command hook", "agents/ directory", "commands/ directory",
    ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", "root hooks.json", "hooks/hooks.json without a reviewed hook role", ".mcp.json",
    "AGENTS/ case variant", "Hooks/hooks.json case variant", "Kelvin-sign hooks.json fold"]) expect(vendorRefused).toContain(label);
});
