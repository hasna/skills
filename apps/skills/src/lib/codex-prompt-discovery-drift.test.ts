import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { captureCodexRemoteReceiptSnapshot } from "./codex-native-skill-catalog.js";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, codexPromptDriftWarning } from "./agent-integration.js";
import { captureDiscoveryDirectories, codexVendorConfigChangeOnly, verifyAgentDiscovery } from "./agent-discovery.js";
import { verifyDiscoveryDirectories } from "./agent-discovery-directories.js";
import { captureCodexSettingsV3 } from "./codex-settings-witness.js";
import { codexVendorConfigCandidates, codexVendorSubtreeHookFree } from "./codex-vendor-refresh.js";
import { NativeDiscoveryWitnessChange, type NativeDiscoveryWitnessTolerance } from "./native-discovery-witness-change.js";
import { readManagedSkillPolicySnapshot, serializeManagedSkillPolicy } from "./managed-policy.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (path: string) => readFileSync(path, "utf8");
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic fixture\n---\nSynthetic native instructions\n`;
function refusal(run: () => unknown): string {
  try { run(); return "ACCEPTED"; } catch (error) { return (error as Error).message; }
}

interface Station { home: string; dataDir: string; projectDir: string; cache: string; config: string; vendor: string }
function home(prefix: string): Station {
  // Real path: macOS maps /tmp and /var to /private, and the guard compares real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix))); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const cache = join(home, ".codex", "plugins", "cache");
  return { home, dataDir: join(home, "data"), projectDir: home, cache, config: join(home, ".codex", "config.toml"), vendor: join(cache, "openai-curated-remote") };
}
const opts = (s: Station) => ({ home: s.home, dataDir: s.dataDir, projectDir: s.projectDir });
const live = (s: Station) => ({ ...opts(s), codexPromptHook: true });
/** A vendor plugin parent present at review time, as fleet stations have. */
function vendorPlugin(s: Station, name = "sites"): void {
  put(join(s.vendor, name, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins_synthetic_00_0000000000000000000" }));
}
/** Automatic Codex discovery (raw TOML projection of plugins, marketplaces and skills). */
function automatic(): Station {
  const s = home("skills-witness-auto-"); vendorPlugin(s);
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"] }));
  return s;
}
/** Reviewed discovery: a typed V3 settings witness plus bound directory membership. */
function reviewed(directories: (s: Station) => string[] = s => [s.vendor]): Station {
  const s = home("skills-witness-reviewed-"); vendorPlugin(s);
  mkdirSync(join(s.cache, "hasna-internal-bridge", "hasna-codex"), { recursive: true }); put(s.config, "");
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [captureCodexSettingsV3(s.config)], directories: captureDiscoveryDirectories(directories(s)), pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: review }));
  expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex.method).toBe("reviewed");
  expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
  return s;
}
const append = (s: Station, rows: string) => writeFileSync(s.config, `${read(s.config).trimEnd()}\n\n${rows}`);
const nameRule = (name: string, enabled = false) => `[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = ${enabled}\n`;
/** Connector files a vendor refresh may not carry: each fails the strict
 * `.app.json` validation that reviewed plugin controls apply. */
const VALID_CONNECTOR = '{"apps":{"sites":{"id":"synthetic_sites_connector","required":true}}}';
const BAD_CONNECTORS: Array<[string, string | Buffer]> = [
  ["malformed JSON", '{"apps":{"sites":{"id":"synthetic_sites_connector"}'],
  ["oversized", VALID_CONNECTOR + " ".repeat(1024 * 1024)],
  ["unknown top-level key", '{"apps":{"sites":{"id":"synthetic_sites_connector"}},"hooks":{}}'],
  ["unknown app key", '{"apps":{"sites":{"id":"synthetic_sites_connector","command":"true"}}}'],
  ["duplicate keys", '{"apps":{"sites":{"id":"synthetic_sites_connector"}},"apps":{"sites":{"id":"other_connector"}}}'],
  ["wrong id type", '{"apps":{"sites":{"id":7}}}'],
  ["wrong required type", '{"apps":{"sites":{"id":"synthetic_sites_connector","required":"yes"}}}'],
  ["apps as a list", '{"apps":[{"id":"synthetic_sites_connector"}]}'],
  ["empty apps", '{"apps":{}}'],
  ["non-UTF-8 bytes", Buffer.concat([Buffer.from('{"apps":{"sites":{"id":"synthetic_sites_connector","category":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}}')])],
];
const INPUT = (s: Station) => `NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`;
function changePolicy(s: Station, change: (bridge: any) => void): void {
  const snapshot = readManagedSkillPolicySnapshot(s.dataDir)!;
  change(snapshot.value.bridge);
  writeFileSync(join(s.dataDir, "agent-policy.json"), serializeManagedSkillPolicy(snapshot.value));
}

describe("B3: only changes a vendor plugin refresh provably makes are tolerated", () => {
  test("appended vendor disable rules in config.toml warn under automatic discovery; the strict guard refuses", () => {
    const s = automatic(), policy = readFileSync(join(s.dataDir, "agent-policy.json"));
    append(s, nameRule("sites:sites-remix"));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(INPUT(s));
    const report = assertManagedAgentBridge("codex", live(s));
    // Reported once although verifyAgentDiscovery and the automatic closure both see it.
    expect(report).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "input", path: s.config }] });
    expect(codexPromptDriftWarning(report)).toBe(`Skills warning: 1 recorded Codex discovery witness changed only by a vendor plugin refresh (vendor configuration entries) and was not blocked: ${JSON.stringify(s.config)}. Enabled vendor skill copies and every other change still block. Refresh the binding with skills hook install --agent codex --apply, with a fresh discovery review for a reviewed binding.`);
    // Several appended vendor rules, by name and by exact vendor path.
    append(s, `[[skills.config]]\npath = ${JSON.stringify(join(s.vendor, "sites", "1.0.2", "skills", "x", "SKILL.md"))}\nenabled = false\n`);
    expect(assertManagedAgentBridge("codex", live(s)).codexDiscoveryChanges).toEqual([{ kind: "input", path: s.config }]);
    expect(readFileSync(join(s.dataDir, "agent-policy.json")).equals(policy)).toBe(true);
  });

  test("any other configuration change refuses, alone or beside vendor rules", () => {
    const cases = (s: Station): string[] => [
      nameRule("hasna-codex:x"),
      nameRule("sites:sites-remix", true),
      nameRule("unknown-plugin:x"),
      `[[skills.config]]\npath = ${JSON.stringify(join(s.home, ".agents", "skills", "x", "SKILL.md"))}\nenabled = false\n`,
      `${nameRule("sites:sites-remix")}\n[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = false\n`,
      `[marketplaces.local-x]\nsource_type = "local"\nsource = "/tmp/local-x"\n\n${nameRule("sites:sites-remix")}`,
    ];
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const s = automatic();
      append(s, cases(s)[index]!);
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: (Native discovery input changed|Configured native discovery roots changed)/);
    }
    // A vendor rule followed by a non-vendor rule is not an appended vendor-only change.
    const s = automatic();
    append(s, `${nameRule("sites:sites-remix")}\n${nameRule("hasna-codex:x")}`);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(INPUT(s));
  });

  test("a reviewed typed settings witness tolerates a vendor plugin table but no other setting", () => {
    const s = reviewed();
    append(s, `[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(INPUT(s));
    expect(assertManagedAgentBridge("codex", live(s)).codexDiscoveryChanges).toEqual([{ kind: "input", path: s.config }]);
    for (const other of ['approval_policy = "never"\n', `[plugins."sites@acme"]\nenabled = false\n`, `[plugins."sites@openai-curated-remote"]\nenabled = false\nextra = 1\n`]) {
      const t = reviewed();
      writeFileSync(t.config, `${other}${read(t.config)}`.replace(/^(\[plugins[^\n]*\n[^\n]*\n)(.*)$/s, "$2\n$1"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(t)))).toBe(INPUT(t));
    }
  });

  test("a reviewed binding cannot activate a pre-existing hook-bearing vendor plugin by adding enabled=true", () => {
    const s = home("skills-witness-vendor-hooks-"); vendorPlugin(s);
    const root = join(s.vendor, "sites", "1.0.0");
    put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.0", hooks: "./hooks/hooks.json" }));
    put(join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: {} })); put(s.config, "");
    const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [captureCodexSettingsV3(s.config)], directories: captureDiscoveryDirectories([s.vendor]), pluginHooks: "reviewed-no-skill-injection" as const }] };
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: review }));
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe("ACCEPTED");
    append(s, `[plugins."sites@openai-curated-remote"]\nenabled = true\n`);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(INPUT(s));
  });

  test("membership changes under a bound, hook-free vendor marketplace warn; hooks there refuse", () => {
    const s = reviewed();
    put(join(s.vendor, "sites", "1.0.2-remix-b.1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2-remix-b.1" }));
    put(join(s.vendor, "sites", "1.0.2-remix-b.1", "assets", "logo.txt"), "synthetic asset");
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.vendor}`);
    const report = assertManagedAgentBridge("codex", live(s));
    expect(report).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: s.vendor }] });
    expect(codexPromptDriftWarning(report)).toContain("(vendor plugin cache membership)");
    // A vendor plugin that gains hooks is not a routine refresh.
    for (const hooks of [(root: string) => put(join(root, "hooks", "hooks.json"), "{}"), (root: string) => put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2-remix-b.1", hooks: "./hooks.json" }))]) {
      const t = reviewed();
      const root = join(t.vendor, "sites", "1.0.2-remix-b.1");
      put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2-remix-b.1" }));
      hooks(root);
      expect(refusal(() => assertManagedAgentBridge("codex", live(t)))).toMatch(/^NATIVE_SKILL_DRIFT: Native discovery directory membership changed/);
    }
    // An enabled vendor skill that arrives with the refresh still blocks.
    put(join(s.vendor, "sites", "1.0.2-remix-b.1", "skills", "sites-remix", "SKILL.md"), payload("sites-remix"));
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
  });

  test("B-2: a refreshed vendor version is tolerated only with one hook-free Codex manifest and only visible skills", () => {
    const at = (s: Station, version = "1.0.3") => join(s.vendor, "sites", version);
    const codex = (root: string, extra: Record<string, unknown> = {}) => put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: basename(root), description: "Synthetic plugin", ...extra }));
    const startup = (root: string) => put(join(root, "startup.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] } }));
    const refused: Array<[string, (s: Station) => void]> = [
      // Codex 0.162.1 also reads these manifest locations (codex-hook-mcp-dependencies.ts).
      ["Claude manifest declaring a hooks path", s => { put(join(at(s), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3", hooks: "./startup.json" })); startup(at(s)); }],
      ["Cursor manifest declaring a hooks path", s => { put(join(at(s), ".cursor-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3", hooks: "./startup.json" })); startup(at(s)); }],
      ["Claude manifest with inline hooks", s => put(join(at(s), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3", hooks: { hooks: { SessionStart: [] } } }))],
      ["root AgentPlugin manifest", s => { put(join(at(s), "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/plugin.json", name: "sites", hooks: "./startup.json" })); startup(at(s)); }],
      ["hook-free Claude manifest beside the Codex manifest", s => { codex(at(s)); put(join(at(s), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3" })); }],
      ["root manifest beside the Codex manifest", s => { codex(at(s)); put(join(at(s), "plugin.json"), JSON.stringify({ name: "sites" })); }],
      ["Codex manifest hooks path", s => { codex(at(s), { hooks: "./startup.json" }); startup(at(s)); }],
      ["Codex manifest hooks list", s => { codex(at(s), { hooks: ["./startup.json"] }); startup(at(s)); }],
      ["Codex manifest inline hooks", s => codex(at(s), { hooks: { hooks: {} } })],
      ["Codex manifest null hooks", s => codex(at(s), { hooks: null })],
      ["Codex manifest commands", s => codex(at(s), { commands: "./commands" })],
      ["Codex manifest extensions", s => codex(at(s), { extensions: "./extensions" })],
      ["hooks directory", s => { codex(at(s)); put(join(at(s), "hooks", "hooks.json"), "{}"); }],
      // Custom skill roots, and payloads the native inventory never sees.
      ["skills path into a dot-directory", s => { codex(at(s), { skills: "./.payload" }); put(join(at(s), ".payload", "hidden", "SKILL.md"), payload("hidden")); }],
      ["custom visible skills path", s => { codex(at(s), { skills: "./more" }); put(join(at(s), "more", "x", "SKILL.md"), payload("x")); }],
      ["skills path list", s => codex(at(s), { skills: ["./skills/"] })],
      ["dot-directory skill below the default root", s => { codex(at(s), { skills: "./skills/" }); put(join(at(s), "skills", ".hidden", "SKILL.md"), payload("hidden")); }],
      ["dot-directory skill elsewhere in the version", s => { codex(at(s)); put(join(at(s), ".agents", "skills", "x", "SKILL.md"), payload("x")); }],
      ["node_modules skill", s => { codex(at(s)); put(join(at(s), "skills", "node_modules", "x", "SKILL.md"), payload("x")); }],
      ["nested skill", s => { codex(at(s)); put(join(at(s), "skills", "a", "SKILL.md"), payload("a")); put(join(at(s), "skills", "a", "inner", "SKILL.md"), payload("inner")); }],
      ["missing Codex manifest", s => put(join(at(s), "assets", "logo.txt"), "synthetic asset")],
      ["duplicate manifest keys", s => put(join(at(s), ".codex-plugin", "plugin.json"), '{"name":"sites","version":"1.0.3","skills":"./.payload","skills":"./skills/"}')],
      ["dot-named version directory", s => { codex(at(s, ".1.0.3")); put(join(at(s, ".1.0.3"), "skills", "x", "SKILL.md"), payload("x")); }],
      ["hidden marketplace directory", s => put(join(s.vendor, ".staging", "sites", "1.0.3", "skills", "x", "SKILL.md"), payload("x"))],
      ["symlinked version outside the cache", s => { const outside = join(s.home, "outside-plugin"); codex(outside, { hooks: "./startup.json" }); startup(outside); symlinkSync(outside, at(s, "1.0.9")); }],
      // F3: MCP, command, agent, connector and unknown declarations need their own review.
      ["MCP declaration file", s => { codex(at(s)); put(join(at(s), ".mcp.json"), JSON.stringify({ mcpServers: {} })); }],
      ["inline MCP servers", s => codex(at(s), { mcpServers: { x: { command: "true" } } })],
      ["MCP servers by path", s => { codex(at(s), { mcpServers: "./.mcp.json" }); put(join(at(s), ".mcp.json"), JSON.stringify({ mcpServers: {} })); }],
      ["default commands directory", s => { codex(at(s)); put(join(at(s), "commands", "c.md"), "synthetic command"); }],
      ["default agents directory", s => { codex(at(s)); put(join(at(s), "agents", "a.md"), "synthetic agent"); }],
      ["manifest agents", s => codex(at(s), { agents: "./more-agents" })],
      ["unknown manifest key", s => codex(at(s), { $schema: "https://example.invalid/plugin.json" })],
      ["second file beside the Codex manifest", s => { codex(at(s)); put(join(at(s), ".codex-plugin", "notes.json"), "{}"); }],
      ["connector declaration without its file", s => codex(at(s), { apps: "./.app.json" })],
      ["connector declaration at another path", s => { codex(at(s), { apps: "./apps.json" }); put(join(at(s), "apps.json"), '{"apps":{}}'); }],
      ["connector file without a declaration", s => { codex(at(s)); put(join(at(s), ".app.json"), '{"apps":{}}'); }],
      ["root hooks file", s => { codex(at(s)); startup(at(s)); put(join(at(s), "hooks.json"), "{}"); }],
      ["differently cased hooks directory", s => { codex(at(s)); put(join(at(s), "Hooks", "hooks.json"), "{}"); }],
      // The connector declaration is validated as strictly as reviewed plugin
      // controls are: any malformed, oversized or schema-unknown file refuses.
      ...BAD_CONNECTORS.map(([label, bytes]): [string, (s: Station) => void] => [`connector ${label}`, s => { codex(at(s), { apps: "./.app.json" }); mkdirSync(at(s), { recursive: true }); writeFileSync(join(at(s), ".app.json"), bytes); }]),
    ];
    for (const [label, make] of refused) {
      const s = reviewed();
      make(s);
      expect([label, codexVendorSubtreeHookFree(s.cache, s.vendor)]).toEqual([label, false]);
      expect([label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([label, expect.stringMatching(/^NATIVE_SKILL_DRIFT: (Native discovery directory membership changed|Refusing symlink)/)]);
    }
    // Accepted control: a vendor-shaped refresh (manifest fields as fleet stations
    // have them) with a disabled skill under the default skills root.
    const s = reviewed();
    const root = at(s), copy = join(root, "skills", "sites-remix");
    codex(root, { skills: "./skills/", apps: "./.app.json", author: { name: "Synthetic" }, homepage: "https://example.invalid", interface: { displayName: "Sites" }, keywords: ["sites"], license: "MIT" });
    put(join(root, ".app.json"), '{"apps":{"sites":{"id":"synthetic_sites_connector","required":true}}}');
    put(join(root, "assets", "logo.txt"), "synthetic asset");
    put(join(copy, "SKILL.md"), payload("sites-remix"));
    append(s, nameRule("sites:sites-remix"));
    expect(codexVendorSubtreeHookFree(s.cache, s.vendor)).toBe(true);
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [copy], codexDiscoveryChanges: [{ kind: "membership", path: s.vendor }] });
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.vendor}`);
  });

  test("P3: a new plugin with hooks under hasna-internal-bridge refuses under a reviewed binding", () => {
    for (const bound of [(s: Station) => [s.cache], (s: Station) => [join(s.cache, "hasna-internal-bridge")]]) {
      const s = reviewed(bound);
      const root = join(s.cache, "hasna-internal-bridge", "hasna-hooks", "1.0.0");
      put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "hasna-hooks", version: "1.0.0", hooks: "./hooks/hooks.json" }));
      put(join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: Native discovery directory membership changed/);
    }
    // A whole-cache membership witness cannot be attributed to a vendor subtree.
    const s = reviewed(t => [t.cache]);
    put(join(s.vendor, "sites", "1.0.2", "assets", "logo.txt"), "synthetic asset");
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.cache}`);
  });

  test("P4: a newly registered local marketplace with an enabled payload plugin refuses", () => {
    for (const station of [automatic, () => reviewed()]) {
      const s = station();
      const source = join(s.home, "local-x");
      put(join(source, "payload", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "payload", version: "1.0.0" }));
      append(s, `[marketplaces.local-x]\nsource_type = "local"\nsource = ${JSON.stringify(source)}\n\n[plugins."payload@local-x"]\nenabled = true\n`);
      const root = join(s.cache, "local-x", "payload", "1.0.0");
      put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "payload", version: "1.0.0" }));
      put(join(root, "skills", "payload", "SKILL.md"), payload("payload"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: (Native discovery input changed|Native discovery directory membership changed|1 unexpected native skill copies)/);
    }
  });

  test("changed reviewed plugin capability controls stay strict on the live hook", () => {
    const s = home("skills-witness-pages-");
    const root = join(s.cache, "openai-curated-remote", "pages", "1.0.0"), names = ["maintain-space", "write-page"];
    const app = '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
    put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "pages", version: "1.0.0", apps: "./.app.json" })); put(join(root, ".app.json"), app);
    put(join(root, "..", ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins_synthetic_00_0000000000000000000" }));
    for (const name of names) put(join(root, "skills", name, "SKILL.md"), payload(name));
    const catalog = { version: "codex-cli 0.162.1", cwd: s.home, skills: [], plugins: [{ id: "pages@openai-curated-remote", name: "pages", installed: true, enabled: true, localVersion: null, remotePluginId: "plugins_synthetic_00_0000000000000000000", sourceType: "remote" as const }], remoteReceipts: captureCodexRemoteReceiptSnapshot(join(s.home, ".codex/plugins/cache")) };
    put(s.config, names.map(name => `[[skills.config]]\npath = ${JSON.stringify(join(root, "skills", name, "SKILL.md"))}\nenabled = false\n`).join("\n"));
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], codexNativeCatalog: catalog }));
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe("ACCEPTED");
    put(join(root, ".app.json"), app.replace("true", "false"));
    const capability = "NATIVE_SKILL_DRIFT: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED: reviewed native plugin capability controls changed; run skills hook install with a fresh discovery review";
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(capability);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(capability);
  });
});

describe("fail-closed cases are unchanged on the live hook", () => {
  test("config candidates retain reviewed vendor tables and never tolerate a plugin activation", () => {
    // The read-only configuration proof needs no hook installation or admission.
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "skills-vendor-config-proof-"))); roots.push(directory);
    const cache = join(directory, "cache"), path = join(directory, "config.toml");
    const baseline = `[plugins."sites@openai-curated-remote"]\nenabled = false\n\n`;
    const source = { path, sha256: createHash("sha256").update(baseline).digest("hex") };
    put(path, `${baseline}[plugins."chrome@openai-curated"]\nenabled = false\n`);
    expect(codexVendorConfigCandidates(read(path), cache)).toContain(baseline);
    expect(codexVendorConfigChangeOnly(source, cache)).toBe(true);
    const enabledBaseline = baseline.replace("false", "true");
    put(path, baseline);
    expect(codexVendorConfigChangeOnly({ ...source, sha256: createHash("sha256").update(enabledBaseline).digest("hex") }, cache)).toBe(true);
    put(path, `${baseline}[plugins."chrome@openai-curated"]\nenabled = true\n`);
    expect(codexVendorConfigChangeOnly(source, cache)).toBe(false);
    put(path, `${baseline}[plugins."payload@acme"]\nenabled = false\n`);
    expect(codexVendorConfigChangeOnly(source, cache)).toBe(false);
    put(path, `${baseline}[marketplaces.local]\nsource_type = "local"\nsource = "/synthetic/local"\n\n[plugins."chrome@openai-curated"]\nenabled = false\n`);
    expect(codexVendorConfigChangeOnly(source, cache)).toBe(false);
    const many = Array.from({ length: 9 }, (_, index) => `[plugins."p${index}@openai-curated"]\nenabled = false\n`).join("\n");
    expect(codexVendorConfigCandidates(many, cache)).toEqual([]);
  });

  test("N-2: config candidates try the smallest edit first, so the documented table bound holds and bounds only refuse", () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "skills-vendor-config-bound-"))); roots.push(directory);
    const cache = join(directory, "cache"), path = join(directory, "config.toml");
    mkdirSync(join(cache, "openai-curated-remote", "sites"), { recursive: true });
    const tables = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => `[plugins."p${from + index}@openai-curated"]\nenabled = false\n`).join("\n");
    const typed = (reviewedText: string) => { put(path, reviewedText); return captureCodexSettingsV3(path); };
    const raw = (reviewedText: string) => ({ path, sha256: createHash("sha256").update(reviewedText).digest("hex") });
    // Typed V3 witness (disable-only rows never change it): one or two new tables
    // among eight are proven; a third is beyond the 128-candidate bound and refuses.
    for (const [reviewedTables, proven] of [[7, true], [6, true], [5, false]] as const) {
      const reviewedText = `model = "x"\n\n${tables(0, reviewedTables)}`;
      const source = typed(reviewedText);
      put(path, `${reviewedText}\n${tables(reviewedTables, 8)}`);
      expect([reviewedTables, codexVendorConfigChangeOnly(source, cache)]).toEqual([reviewedTables, proven]);
    }
    // A raw witness binds rows: appended vendor rows beside eight reviewed tables are proven.
    const eight = `model = "x"\n\n${tables(0, 8)}`;
    put(path, `${eight}${nameRule("sites:a")}${nameRule("sites:b")}`);
    expect(codexVendorConfigChangeOnly(raw(eight), cache)).toBe(true);
    // A non-vendor change is never proven, and nine tables exceed the bound.
    put(path, `${eight}\napproval_policy = "never"\n\n${nameRule("sites:a")}`);
    expect(codexVendorConfigChangeOnly(raw(eight), cache)).toBe(false);
    const nine = typed(eight);
    put(path, `${eight}\n${tables(8, 9)}`);
    expect(codexVendorConfigChangeOnly(nine, cache)).toBe(false);
    expect(codexVendorConfigCandidates(read(path), cache)).toEqual([]);
  });

  test("a non-vendor native copy beside a tolerated change still refuses", () => {
    for (const copy of [join(".agents", "skills", "user-copy"), join(".codex", "skills", "user-copy"), join(".codex", "skills", ".system", "builtin")]) {
      const s = automatic();
      append(s, nameRule("sites:sites-remix"));
      put(join(s.home, copy, "SKILL.md"), payload("user-copy"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
    }
  });

  test("missing discovery coverage, changed automatic roots and unsafe roots still refuse", () => {
    const missing = automatic();
    changePolicy(missing, bridge => { delete bridge.discovery.codex; });
    expect(refusal(() => assertManagedAgentBridge("codex", live(missing)))).toBe("NATIVE_SKILL_DRIFT: native discovery coverage is missing; run skills hook install");
    const extra = automatic(), root = join(extra.home, "extra-root"); mkdirSync(root);
    changePolicy(extra, bridge => { bridge.discovery.codex.roots = [...bridge.discovery.codex.roots, root].sort(); });
    expect(refusal(() => assertManagedAgentBridge("codex", live(extra)))).toBe("NATIVE_SKILL_DRIFT: Configured native discovery roots changed");
    const linked = reviewed(), real = join(linked.home, "real-root"), link = join(linked.home, "linked-root"); mkdirSync(real); symlinkSync(real, link);
    changePolicy(linked, bridge => { bridge.discovery.codex.roots = [link]; });
    expect(refusal(() => assertManagedAgentBridge("codex", live(linked)))).toBe(refusal(() => assertManagedAgentBridge("codex", opts(linked))));
    expect(refusal(() => assertManagedAgentBridge("codex", live(linked)))).toMatch(/^(NATIVE_SKILL_DRIFT: )?Refusing symlink/);
  });

  test("verifiers throw the typed change with the unchanged message unless a tolerance accepts it", () => {
    const s = reviewed();
    put(join(s.vendor, "extra", "README"), "x");
    append(s, `[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
    const binding = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex;
    const tolerance = (input: boolean, membership: boolean): NativeDiscoveryWitnessTolerance => ({ changes: [], acceptsInput: () => input, acceptsMembership: () => membership });
    let thrown: unknown;
    try { verifyAgentDiscovery(binding); } catch (error) { thrown = error; }
    // Membership is verified before sources; both throw their unchanged plain message.
    expect(thrown).toBeInstanceOf(NativeDiscoveryWitnessChange);
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as NativeDiscoveryWitnessChange).kind).toBe("membership");
    expect((thrown as Error).message).toBe(`Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.vendor}`);
    expect(() => verifyAgentDiscovery(binding, undefined, undefined, tolerance(false, true))).toThrow(`Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
    expect(() => verifyAgentDiscovery(binding, undefined, undefined, tolerance(false, true))).toThrow(NativeDiscoveryWitnessChange);
    expect(() => verifyAgentDiscovery(binding, undefined, undefined, tolerance(true, false))).toThrow(`Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.vendor}`);
    const accepting = tolerance(true, true);
    verifyAgentDiscovery(binding, undefined, undefined, accepting);
    expect([...new Set(accepting.changes.map(change => `${change.kind}:${change.path}`))].sort()).toEqual([`input:${s.config}`, `membership:${s.vendor}`]);
    expect(() => verifyDiscoveryDirectories(binding.directories)).toThrow(NativeDiscoveryWitnessChange);
  });

  test("config candidates are proven by structure: string bodies and inline tables never count as vendor rows", () => {
    const s = reviewed();
    const source = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex.sources.find((item: any) => item.path === s.config);
    // A real appended vendor rule, then a bound setting whose multi-line string
    // body looks like another appended vendor rule.
    append(s, nameRule("sites:a"));
    append(s, `[profiles.p]\nmodel_instructions = """\n[[skills.config]]\nname = "sites:b"\nenabled = false\n"""\n`);
    expect(codexVendorConfigChangeOnly(source, s.cache)).toBe(false);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(INPUT(s));
    expect(codexVendorConfigCandidates('plugins = { "sites@openai-curated-remote" = { enabled = false } }\n', s.cache)).toEqual([]);
    expect(codexVendorConfigCandidates("not = [toml", s.cache)).toEqual([]);
  });
});
