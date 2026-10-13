import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCodexSettingsV6, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV4, hashCodexSettingsReplacementV5 } from "./codex-settings-witness.js";
import { assertProjectDiscovery, captureDiscoveryByteSources, captureDiscoveryExecutableSources, captureDiscoveryPathSources, verifyAgentDiscovery, rebindAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";
import { selectCodexPluginVersion } from "./codex-hook-mcp-dependencies.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const hook = (server = "provider") => ({ hooks: { SessionStart: [{ hooks: [{ type: "mcp_tool", server, tool: "activate", input: {} }] }] } });
const route = '[mcp_servers.provider]\ncommand = "/owned/provider"\nargs = ["--stdio"]\ncwd = "/owned"\nenv = { MODE = "safe" }\ntool_timeout_sec = 10.5\ntools = { activate = { approval_mode = "prompt", output_token_limit = 1000 } }\n';
const unrelated = '[mcp_servers.ordinary]\ncommand = "/ordinary"\ntool_timeout_sec = 5.5\n';
const ui = '[tui]\nstatus_line = ["model", "future-display-id"]\nmodel_availability_nux = { model = 1 }\n';
function fixture() {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-hook-mcp-v6-")); homes.push(home);
  const config = join(home, ".codex/config.toml"), hooks = join(home, ".codex/hooks.json");
  mkdirSync(join(home, ".codex/plugins/cache"), { recursive: true });
  writeFileSync(hooks, JSON.stringify(hook()));
  const capture = (text = route + unrelated + ui) => { writeFileSync(config, text); return captureCodexSettingsV6(config, captureDiscoveryByteSources([hooks]).map(({ path, sha256 }) => ({ path, sha256 }))); };
  return { home, config, hooks, capture };
}

test("V6 binds referenced routes while retaining display and unrelated MCP tolerances", () => {
  const f = fixture(), before = f.capture();
  for (const text of [route + unrelated.replace("5.5", "99.25") + ui.replace("model = 1", "model = 8"), route + ui.replace('"model", "future-display-id"', '"other-future-id"'), route + unrelated + ui + 'theme = "changed"\n']) {
    if (text.includes("theme")) expect(f.capture(text).sha256).not.toBe(before.sha256);
    else expect(f.capture(text).sha256).toBe(before.sha256);
  }
  for (const text of [route.replace("/owned/provider", "/other/provider"), route.replace("--stdio", "--changed"), route.replace('MODE = "safe"', 'MODE = "other"'), route.replace('cwd = "/owned"', 'cwd = "/other"'), route.replace("10.5", "12.75"), route.replace('approval_mode = "prompt"', 'approval_mode = "approve"'), route.replace("1000", "1001"), route.replace("activate =", "different =")]) expect(f.capture(text + unrelated + ui).sha256).not.toBe(before.sha256);
  expect(() => f.capture(unrelated + ui)).toThrow();
  expect(() => f.capture(route + unrelated + '[tui]\nstatus_line = 7\n')).not.toThrow();
  expect(f.capture(route + unrelated + '[tui]\nstatus_line = 7\n').sha256).not.toBe(before.sha256);
});

test("V6 is independent of table, dotted and inline representation", () => {
  const f = fixture();
  const table = '[mcp_servers.provider]\ncommand = "/owned/provider"\ntool_timeout_sec = 10.5\n' + unrelated + ui;
  const dotted = 'mcp_servers.provider.command = "/owned/provider"\nmcp_servers.provider.tool_timeout_sec = 10.5\nmcp_servers.ordinary.command = "/ordinary"\nmcp_servers.ordinary.tool_timeout_sec = 5.5\ntui.status_line = ["model", "future-display-id"]\ntui.model_availability_nux.model = 1\n';
  const inline = 'mcp_servers = { provider = { command = "/owned/provider", tool_timeout_sec = 10.5 }, ordinary = { command = "/ordinary", tool_timeout_sec = 5.5 } }\ntui = { status_line = ["model", "future-display-id"], model_availability_nux = {model = 1} }\n';
  const expected = f.capture(table).sha256;
  expect(f.capture(dotted).sha256).toBe(expected); expect(f.capture(inline).sha256).toBe(expected);
  expect(f.capture(inline.replace("5.5", "999.25").replace("model = 1", "model = 200")).sha256).toBe(expected);
  expect(f.capture(inline.replace("10.5", "10.75")).sha256).not.toBe(expected);
});

test("V6 refuses lossy/unknown referenced contracts and duplicate native controls", () => {
  const f = fixture();
  for (const text of [route.replace("10.5", "nan"), route.replace("10.5", "inf"), 'unknown = 9007199254740993\n' + route, route.replace("1000", "9007199254740993"), route + '[mcp_servers.provider]\ncommand = "/duplicate"\n', route.replace('args = ["--stdio"]', 'args = [false]'), route.replace('env = { MODE = "safe" }', 'env = { MODE = "safe" }\nunknown = true')]) expect(() => f.capture(text)).toThrow();
  writeFileSync(f.hooks, '{"hooks":{},"hooks":{}}'); expect(() => f.capture()).toThrow();
  writeFileSync(f.hooks, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "unknown", server: "provider" }] }] } })); expect(() => f.capture()).toThrow();
});

test("complete hook population pins absences and prevents omitted cache hooks", () => {
  const f = fixture(), before = f.capture();
  const root = join(f.home, ".codex/plugins/cache/market/plugin/1.0.0"), manifest = join(root, ".codex-plugin/plugin.json"), hooks = join(root, "hooks/hooks.json");
  mkdirSync(join(root, ".codex-plugin"), { recursive: true }); mkdirSync(join(root, "hooks"));
  writeFileSync(manifest, JSON.stringify({ name: "plugin", hooks: "./hooks/hooks.json" })); writeFileSync(hooks, JSON.stringify(hook()));
  expect(() => f.capture()).toThrow();
  const sources = captureDiscoveryByteSources([f.hooks, manifest, hooks, join(root, "plugin.json"), join(root, ".claude-plugin/plugin.json"), join(root, ".cursor-plugin/plugin.json")]).map(({ path, sha256 }) => ({ path, sha256 }));
  const next = captureCodexSettingsV6(f.config, sources); expect(next.sha256).not.toBe(before.sha256);
  writeFileSync(hooks, JSON.stringify(hook("absent"))); expect(() => captureCodexSettingsV6(f.config, sources)).toThrow();
  expect(() => captureCodexSettingsV6(f.config, [...sources, sources[0]!])).toThrow();
});

test("V6 uses selected roots and declared hooks rather than impossible cached hooks", () => {
  const f = fixture(); f.capture();
  const parent = join(f.home, ".codex/plugins/cache/market/plugin");
  const local = join(parent, "local"), old = join(parent, "1.0.0");
  for (const root of [local, old]) {
    mkdirSync(join(root, ".codex-plugin"), { recursive: true }); mkdirSync(join(root, "hooks"));
    writeFileSync(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "plugin", hooks: ["./declared.json"] }));
    writeFileSync(join(root, "hooks/hooks.json"), JSON.stringify(hook("unproved-default")));
  }
  writeFileSync(join(local, "declared.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "mcp_tool", server: "provider", tool: "activate", timeout: 0, statusMessage: "synthetic" }] }] } }));
  writeFileSync(join(old, "declared.json"), JSON.stringify(hook("unproved-old-version")));
  const inputs = [f.hooks, join(local, "plugin.json"), join(local, ".codex-plugin/plugin.json"), join(local, ".claude-plugin/plugin.json"), join(local, ".cursor-plugin/plugin.json"), join(local, "declared.json")];
  const source = () => captureDiscoveryByteSources(inputs).map(({ path, sha256 }) => ({ path, sha256 }));
  expect(() => captureCodexSettingsV6(f.config, source())).not.toThrow();
  // Neither omitted input/default nor old cached source can add a live route.
  expect(captureCodexSettingsV6(f.config, source()).hookSources.map(row => row.path).sort()).toEqual(inputs.sort());
});

test("V6 binds alternate manifests/default hooks and refuses native fallback ambiguities", () => {
  const f = fixture(); f.capture();
  const root = join(f.home, ".codex/plugins/cache/market/plugin/local");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true }); mkdirSync(join(root, "hooks"));
  const manifest = join(root, ".claude-plugin/plugin.json"), standard = join(root, "hooks/hooks.json");
  writeFileSync(manifest, JSON.stringify({ name: "plugin" })); writeFileSync(standard, JSON.stringify(hook()));
  const paths = [f.hooks, join(root, "plugin.json"), join(root, ".codex-plugin/plugin.json"), manifest, join(root, ".cursor-plugin/plugin.json"), standard];
  const capture = () => captureCodexSettingsV6(f.config, captureDiscoveryByteSources(paths).map(({ path, sha256 }) => ({ path, sha256 })));
  expect(capture().hookSources.some(row => row.path === standard)).toBe(true);
  for (const value of [[], ["./declared.json", { hooks: {} }], { hooks: {}, extra: true }, { hooks: {}, description: 1 }, "declared.json"]) {
    writeFileSync(manifest, JSON.stringify({ name: "plugin", hooks: value })); expect(capture).toThrow();
  }
  writeFileSync(manifest, JSON.stringify({ name: "plugin", hooks: [{ hooks: {} }, { description: "synthetic" }] }));
  expect(capture().hookSources.some(row => row.path === standard)).toBe(false);
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "plugin" }));
  expect(capture).toThrow();
});

test("V6 retains routine old versions without turning inactive hooks into dependencies", () => {
  const f = fixture(); f.capture();
  const parent = join(f.home, ".codex/plugins/cache/market/plugin"), root = join(parent, "0.0.21");
  mkdirSync(join(root, ".codex-plugin"), { recursive: true }); mkdirSync(join(root, "hooks"));
  writeFileSync(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "plugin" })); writeFileSync(join(root, "hooks/hooks.json"), JSON.stringify(hook()));
  const paths = [f.hooks, ...["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", "hooks/hooks.json"].map(path => join(root, path))];
  const capture = () => captureCodexSettingsV6(f.config, captureDiscoveryByteSources(paths).map(({ path, sha256 }) => ({ path, sha256 })));
  const before = capture();
  const old = join(parent, "0.0.19"); mkdirSync(join(old, ".codex-plugin"), { recursive: true }); mkdirSync(join(old, "hooks"));
  writeFileSync(join(old, ".codex-plugin/plugin.json"), JSON.stringify({ name: "plugin" })); writeFileSync(join(old, "hooks/hooks.json"), JSON.stringify(hook("unproved-inactive-old")));
  expect(capture().sha256).toBe(before.sha256);
  mkdirSync(join(parent, "0.0.22")); // Actual selection change must require review.
  expect(capture).toThrow();
});

test("V6 native selector matches strict Rust semver, build ordering and local preference", () => {
  for (const [versions, expected] of [
    [["0.0.19", "0.0.21"], "0.0.21"], [["2.0.0", "10.0.0"], "10.0.0"],
    [["1.0.0-alpha.2", "1.0.0-alpha.10", "1.0.0"], "1.0.0"],
    [["1.0.0-99999999999999999999999999", "1.0.0-100000000000000000000000000"], "1.0.0-100000000000000000000000000"],
    [["1.0.0+2", "1.0.0+10"], "1.0.0+10"], [["1.0.0+1", "1.0.0+01", "1.0.0+001"], "1.0.0+001"],
    [["1.0.0+0", "1.0.0+00"], "1.0.0+00"], [["1.0.0+99", "1.0.0+alpha"], "1.0.0+alpha"],
    [["18446744073709551615.0.0", "999.0.0"], "18446744073709551615.0.0"],
    [["18446744073709551616.0.0", "999.0.0"], "999.0.0"],
    [["01.0.0", "1.0.0"], "1.0.0"], [["development", "snapshot"], "snapshot"],
    [["2.0.0", "10.0.0", "zz"], "zz"], [["2.0.0", "10.0.0", "15foo", "local"], "local"],
  ] as Array<[string[], string]>) {
    expect(selectCodexPluginVersion(versions)).toBe(expected); expect(selectCodexPluginVersion([...versions].reverse())).toBe(expected);
  }
  for (const versions of [["2.0.0", "10.0.0", "15foo"], ["15foo", "2.0.0", "10.0.0"], ["10.0.0", "15foo", "2.0.0"], ["2.0.0", "10.0.0", "15foo", "zz"]]) expect(() => selectCodexPluginVersion(versions)).toThrow();
  expect(() => selectCodexPluginVersion(["1.0.0", "2.0.0"], { remaining: 0 })).toThrow();
  expect(() => selectCodexPluginVersion(["1.0.0", "1.0.0"])).toThrow();
  expect(() => selectCodexPluginVersion(["1.0.0\n"])).toThrow();
});

test("old witnesses retain their UI and ordinary MCP meanings", () => {
  const base = route + unrelated + ui;
  expect(hashCodexSettingsReplacementV2(base.replace("model = 1", "model = 2"))).not.toBe(hashCodexSettingsReplacementV2(base));
  expect(hashCodexSettingsReplacementV4(base.replace("model = 1", "model = 2"))).toBe(hashCodexSettingsReplacementV4(base));
  expect(hashCodexSettingsReplacementV5(base.replace("10.5", "100.5"))).toBe(hashCodexSettingsReplacementV5(base));
});

test("V6 refuses effective project hook/provider overrides under an unchanged home witness", () => {
  const f = fixture(), witness = f.capture(), project = join(f.home, "project");
  mkdirSync(join(project, ".codex"), { recursive: true });
  const binding: AgentDiscoveryBinding = { agent: "codex", method: "reviewed", roots: [], sources: [witness, ...captureDiscoveryByteSources([f.hooks])] };
  const config = join(project, ".codex/config.toml");
  for (const text of ['mcp_servers.provider.command = "/override"\n', 'mcp_servers.provider.env = { MODE = "changed" }\n', 'hooks.SessionStart = [{hooks = [{type = "command", command = "synthetic"}]}]\n']) {
    writeFileSync(config, text);
    expect(() => verifyAgentDiscovery(binding)).not.toThrow();
    expect(() => assertProjectDiscovery("codex", [project], f.home, undefined, binding)).toThrow("higher-precedence project hook dependency");
  }
  writeFileSync(config, 'mcp_servers.ordinary.command = "/unrelated"\ntui.status_line = ["future"]\n');
  expect(() => assertProjectDiscovery("codex", [project], f.home, undefined, binding)).not.toThrow();
  const projectHooks = join(project, ".codex/hooks.json");
  writeFileSync(projectHooks, JSON.stringify(hook("unproved-project-route")));
  expect(() => assertProjectDiscovery("codex", [project], f.home, undefined, binding)).toThrow("higher-precedence project hook dependency");
  writeFileSync(projectHooks, JSON.stringify({ hooks: {} }));
  expect(() => assertProjectDiscovery("codex", [project], f.home, undefined, binding)).not.toThrow();
  // This new check is opt-in; legacy home witness meanings remain unchanged.
  writeFileSync(config, 'mcp_servers.provider.command = "/override"\n');
  expect(() => assertProjectDiscovery("codex", [project], f.home, undefined, { ...binding, sources: [] })).not.toThrow();
});

test("V6 preserves integer-only native fields and refuses fake built-in stdio routes", () => {
  const f = fixture();
  expect(f.capture(route + ui.replace("model = 1", "model = 1.0")).sha256).not.toBe(f.capture(route).sha256);
  expect(f.capture(route + ui).sha256).toBe(f.capture(route).sha256);
  expect(() => f.capture(route.replace("1000", "1000.0"))).toThrow();
  expect(f.capture('unknown = 1\n' + route).sha256).not.toBe(f.capture('unknown = 1.0\n' + route).sha256);
  const declaration = 'hooks.SessionStart = [{hooks = [{type = "mcp_tool", server = "provider", tool = "activate", timeout = 1}]}]\n';
  expect(() => f.capture(declaration + route)).not.toThrow();
  expect(() => f.capture(declaration.replace("timeout = 1", "timeout = 1.0") + route)).toThrow();
  writeFileSync(f.hooks, JSON.stringify(hook("codex_apps")));
  expect(() => f.capture('[mcp_servers.codex_apps]\ncommand = "/fake"\n')).toThrow();
});

test("serialized V6 policy requires full raw sources and preserves planned hook rebinding", () => {
  const f = fixture(), witness = f.capture();
  const raw = captureDiscoveryByteSources([f.hooks]);
  const binding: AgentDiscoveryBinding = { agent: "codex", method: "reviewed", roots: [], sources: [witness, ...raw] };
  const stored = JSON.parse(JSON.stringify(binding));
  expect(() => assertAgentPolicyCollections({ bridge: { discovery: { codex: stored } } })).not.toThrow();
  expect(() => verifyAgentDiscovery(stored)).not.toThrow();
  expect(() => verifyAgentDiscovery({ ...stored, sources: [witness] })).toThrow();
  expect(() => verifyAgentDiscovery({ ...stored, sources: [...stored.sources, raw[0]] })).toThrow();
  expect(() => assertAgentPolicyCollections({ bridge: { discovery: { codex: { ...stored, sources: [{ ...witness, hashMode: "codex-settings-v5" }, ...raw] } } } })).toThrow();
  const changed = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "synthetic-never-executed" }] }] } });
  const rebound = rebindAgentDiscovery(stored, new Map([[f.hooks, changed]]));
  expect(rebound.sources[0]!.sha256).not.toBe(witness.sha256);
  writeFileSync(f.hooks, changed);
  expect(() => verifyAgentDiscovery(rebound)).not.toThrow();
  expect(() => verifyAgentDiscovery(stored)).toThrow();
});

test("provider executable role is explicit, nonprojectable and aggregate bounded", () => {
  const f = fixture(), witness = f.capture(), runtime = join(f.home, "runtime"); writeFileSync(runtime, "x"); chmodSync(runtime, 0o700);
  const source = captureDiscoveryExecutableSources([runtime])[0]!;
  const binding: AgentDiscoveryBinding = { agent: "codex", method: "reviewed", roots: [], sources: [witness, ...captureDiscoveryByteSources([f.hooks]), source] };
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  expect(() => verifyAgentDiscovery({ ...binding, agent: "claude" })).toThrow();
  expect(() => verifyAgentDiscovery({ ...binding, sources: [source] })).toThrow();
  expect(() => rebindAgentDiscovery(binding, new Map([[runtime, "rewritten"]]))).toThrow();
  const other = join(f.home, "other"); writeFileSync(other, "x"); chmodSync(other, 0o700);
  truncateSync(runtime, 140 * 1024 * 1024); truncateSync(other, 140 * 1024 * 1024);
  expect(() => captureDiscoveryExecutableSources([runtime, other])).toThrow("aggregate");
});

test("streamed executable integrity covers actual Bun size without widening raw limits", () => {
  const f = fixture(), runtime = join(f.home, "runtime"); writeFileSync(runtime, "x"); chmodSync(runtime, 0o700);
  expect(captureDiscoveryExecutableSources([runtime])[0]!.sha256).toBe(captureDiscoveryByteSources([runtime])[0]!.sha256);
  truncateSync(runtime, 79_420_872);
  expect(() => captureDiscoveryByteSources([runtime])).toThrow(); expect(() => captureDiscoveryPathSources([runtime])).toThrow();
  const before = captureDiscoveryExecutableSources([runtime])[0]!.sha256; expect(before).toMatch(/^[a-f0-9]{64}$/);
  truncateSync(runtime, 79_420_871); expect(captureDiscoveryExecutableSources([runtime])[0]!.sha256).not.toBe(before);
  const alias = join(f.home, "alias"); symlinkSync(runtime, alias); expect(() => captureDiscoveryExecutableSources([alias])).toThrow();
  chmodSync(runtime, 0o722); expect(() => captureDiscoveryExecutableSources([runtime])).toThrow();
  chmodSync(runtime, 0o700); truncateSync(runtime, 256 * 1024 * 1024 + 1); expect(() => captureDiscoveryExecutableSources([runtime])).toThrow();
});
