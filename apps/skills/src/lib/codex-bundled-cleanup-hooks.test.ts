import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { isReviewedCodexPluginSkillDisabled, reviewCodexPluginSkillControls, reviewedCodexPluginCapabilitiesUnchanged } from "./codex-plugin-skill-controls.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const cleanup = (server = "node_repl") => ({ hooks: Object.fromEntries(["Interrupt", "SubagentStop", "Stop"].map(event => [event, [{ hooks: [{
  type: "mcp_tool", server, tool: "turn_ended", input: {
    hook_event_name: "${hook_event_name}", session_id: event === "SubagentStop" ? "${agent_id}" : "${session_id}", turn_id: "${turn_id}",
  },
}] }]])) });

function fixture(namespace = "chrome", marketplace = "openai-bundled", server = "node_repl") {
  const home = mkdtempSync(join(tmpdir(), "skills-bundled-cleanup-")); roots.push(home); admitCorpusFixture(join(home,".codex"));
  const cache = join(home, ".codex/plugins/cache"), parent = join(cache, marketplace, namespace), root = join(parent, "26.908.70816");
  const document = join(root, "skills/browse/SKILL.md"), manifestPath = join(root, ".codex-plugin/plugin.json");
  const manifest = { name: namespace, version: "26.908.70816", hooks: cleanup(server) };
  put(manifestPath, JSON.stringify(manifest)); put(document, "---\nname: browse\ndescription: Synthetic cleanup contract fixture\n---\nDisabled instructions\n");
  const read = (path: string) => readFileSync(path, "utf8");
  const catalog = { version: "codex-cli 0.160.0", cwd: home, skills: [{ name: `${namespace}:browse`, path: document, enabled: false, pluginId: `${namespace}@${marketplace}` }], plugins: [{ id: `${namespace}@${marketplace}`, name: namespace, installed: true, enabled: true, localVersion: "26.908.70816" }] };
  const review = () => reviewCodexPluginSkillControls(catalog, [document], cache, home, read, []);
  return { home, cache, parent, root, document, manifestPath, manifest, read, catalog, review };
}

test("official Chrome cleanup shape passes the owning plan and retains hooks in its identity", () => {
  const f = fixture(), controls = f.review();
  expect(controls).toHaveLength(1);
  expect(controls[0]!.manifestSha256).toBe(hashNativeJsonControls(JSON.stringify(f.manifest), "version"));
  const input = { home: f.home, dataDir: join(f.home, "data"), projectDir: f.home, agents: ["codex"] as const, codexNativeCatalog: f.catalog };
  applyAgentIntegration(planAgentIntegration({ ...input, agents: [...input.agents] }));
  expect(() => assertManagedAgentBridge("codex", input)).not.toThrow();
  const config = f.read(join(f.home, ".codex/config.toml"));
  expect(config).toContain('name = "chrome:browse"');
  expect(f.read(f.manifestPath)).toBe(JSON.stringify(f.manifest));
});

for (const [namespace, server] of [["browser", "node_repl"], ["chrome", "node_repl"], ["chrome-dev", "node_repl"], ["chrome-internal", "node_repl"], ["computer-use", "node_repl"], ["unified-computer-use", "cua_repl"]]) {
  test(`native bundled cleanup identity ${namespace} remains restricted to ${server}`, () => {
    const f = fixture(namespace!, "openai-bundled", server!);
    expect(f.review()).toHaveLength(1);
    for (const version of ["codex-cli 0.159.2", "codex-cli 0.160.0", "codex-cli 0.160.1", "codex-cli 0.161.0"]) expect(reviewCodexPluginSkillControls({ ...f.catalog, version }, [f.document], f.cache, f.home, f.read, [])).toHaveLength(1);
    f.manifest.hooks.hooks.Stop![0]!.hooks[0]!.server = server === "node_repl" ? "cua_repl" : "node_repl";
    put(f.manifestPath, JSON.stringify(f.manifest)); expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
  });
}

test("cleanup admission never accepts another marketplace or a similarly named plugin", () => {
  for (const [namespace, marketplace] of [["chrome", "probe"], ["chrome", "openai-curated-remote"], ["browser", "openai-curated-remote"], ["chrome-other", "openai-bundled"], ["vendor", "openai-bundled"]]) {
    expect(fixture(namespace!, marketplace!).review).toThrow("IDENTITY_UNSUPPORTED");
  }
});

test("cleanup admission refuses unsupported events, handlers, arguments and code-bearing templates", () => {
  const f = fixture(), handler = f.manifest.hooks.hooks.Stop![0]!.hooks[0]!;
  const variants: unknown[] = [
    "./hooks.json", {}, { hooks: {} }, { hooks: [] }, { hooks: f.manifest.hooks.hooks, unknown: true },
    { hooks: { SessionStart: [{ hooks: [handler] }] } }, { hooks: { Stop: [] } },
    { hooks: { Stop: [{ hooks: [handler], matcher: "*" }] } },
    { hooks: { Stop: [{ hooks: [handler], matcher: null }] } },
    { hooks: { Stop: [{ hooks: [] }] } }, { hooks: { Stop: [{ hooks: [handler, handler] }] } },
    ...[{ type: "command", command: "synthetic-never-executed" }, { ...handler, server: "codex_apps" }, { ...handler, tool: "eval" },
      { ...handler, command: "synthetic-never-executed" }, { ...handler, timeout: 30 }, { ...handler, input: {} }, { ...handler, input: null },
      { ...handler, input: { ...handler.input, code: "synthetic-never-executed" } },
      ...["literal", "${tool_input.code}", "${session_id}; synthetic-never-executed", "$(synthetic-never-executed)", "${agent_id}"].map(session_id => ({ ...handler, input: { ...handler.input, session_id } })),
      { ...handler, input: { ...handler.input, turn_id: "${session_id}" } },
    ].map(h => ({ hooks: { Stop: [{ hooks: [h] }] } })),
    { hooks: { SubagentStop: [{ hooks: [{ ...handler, input: handler.input }] }] } },
  ];
  for (const hooks of variants) { put(f.manifestPath, JSON.stringify({ ...f.manifest, hooks })); expect(f.review).toThrow("IDENTITY_UNSUPPORTED"); }
  put(f.manifestPath, JSON.stringify(f.manifest).replace('"server":"node_repl"', '"server":"node_repl","server":"node_repl"'));
  expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
});

test("cleanup fingerprint controls cache continuity and guarded apply without suppressing hooks", () => {
  const f = fixture(), controls = f.review(), rules = [{ name: "chrome:browse", enabled: false }];
  const next = join(f.parent, "27.1.0"), nextDocument = join(next, "skills/browse/SKILL.md"), nextManifest = join(next, ".codex-plugin/plugin.json");
  put(nextManifest, JSON.stringify({ ...f.manifest, version: "27.1.0" })); put(nextDocument, f.read(f.document));
  expect(isReviewedCodexPluginSkillDisabled(nextDocument, f.cache, controls, rules, f.read)).toBe(true);
  expect(reviewedCodexPluginCapabilitiesUnchanged(f.cache, controls, f.read)).toBe(true);
  const changed = structuredClone(f.manifest); delete changed.hooks.hooks.Interrupt;
  put(nextManifest, JSON.stringify({ ...changed, version: "27.1.0" }));
  expect(isReviewedCodexPluginSkillDisabled(nextDocument, f.cache, controls, rules, f.read)).toBe(false);
  expect(reviewedCodexPluginCapabilitiesUnchanged(f.cache, controls, f.read)).toBe(false);
  put(nextManifest, JSON.stringify({ ...f.manifest, version: "27.1.0" }));
  const input = { home: f.home, dataDir: join(f.home, "data"), projectDir: f.home, agents: ["codex"] as const, codexNativeCatalog: f.catalog };
  const plan = planAgentIntegration({ ...input, agents: [...input.agents] });
  put(f.manifestPath, JSON.stringify(changed)); expect(() => applyAgentIntegration(plan)).toThrow();
  put(f.manifestPath, JSON.stringify(f.manifest));
  applyAgentIntegration(planAgentIntegration({ ...input, agents: [...input.agents] }));
  rmSync(join(f.root, "skills"), { recursive: true }); rmSync(join(next, "skills"), { recursive: true });
  expect(() => assertManagedAgentBridge("codex", input)).not.toThrow();
  put(nextManifest, JSON.stringify({ ...changed, version: "27.1.0" }));
  expect(() => assertManagedAgentBridge("codex", input)).toThrow("NATIVE_SKILL_DRIFT");
});

test("builtin cleanup refuses plugin MCP declarations and external hook controls", () => {
  const f = fixture();
  for (const server of ["node_repl", "unrelated"]) {
    put(join(f.root, ".mcp.json"), JSON.stringify({ mcpServers: { [server]: { command: "synthetic-never-executed" } } }));
    put(f.manifestPath, JSON.stringify({ ...f.manifest, mcpServers: "./.mcp.json" }));
    expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
    put(f.manifestPath, JSON.stringify(f.manifest)); expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
    rmSync(join(f.root, ".mcp.json"));
  }
  put(join(f.root, "hooks/hooks.json"), "{}"); expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
  rmSync(join(f.root, "hooks"), { recursive: true });
  put(f.manifestPath, JSON.stringify({ ...f.manifest, commands: "./commands" })); expect(f.review).toThrow("IDENTITY_UNSUPPORTED");
});

let restoreInspector: (()=>void)|undefined;
beforeEach(()=>{restoreInspector=installCorpusInspectorFixture();});
afterEach(()=>{restoreInspector?.();});
