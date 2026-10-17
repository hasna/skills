import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { applyAgentIntegration, assertCodexReconcileScope, assertManagedAgentBridge, planAgentIntegration, planCodexPluginNameReconcile } from "./agent-integration.js";
import { captureCodexSettingsV3 } from "./codex-settings-witness.js";
import { captureDiscoveryByteSources } from "./agent-discovery.js";
import { CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, mergeReconciledCodexPluginControls, type CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";
import { runCodexPluginReconcile, type CodexReconcileResult } from "./codex-plugin-reconcile.js";
import type { CodexNativeSkill, CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";

useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
// Synthetic fixtures only: every HOME, cache and data directory lives in a fresh
// directory under the test TMPDIR and is removed with it.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic ${name} fixture\n---\nSynthetic disabled body\n`;
const APP = '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
const REMOTE = "plugins~Plugin_00000000000000000000000000000755";
const PLUGIN = "pages@openai-curated-remote";

/** A reviewed Codex binding that enrolled one remote, app-bearing plugin (the
 * station shape: a typed settings witness and qualified-name controls).
 * `listed`: Codex listed the skills at enrollment. Otherwise they were already
 * path-denied and omitted, so the controls also record the remote installation. */
function enrolledStation(initialNames = ["maintain-space", "write-page"], extraConfig = "", listed = true, shape: { catalogReview?: boolean; byteWitnesses?: boolean; prepare?: (cache: string) => void; witnesses?: (cache: string) => string[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-reconcile-")); roots.push(home);
  admitCorpusFixture(join(home, ".codex"));
  const dataDir = join(home, "data"), cache = join(home, ".codex/plugins/cache"), parent = join(cache, "openai-curated-remote/pages");
  const config = join(home, ".codex/config.toml"), policy = join(dataDir, "agent-policy.json");
  const bridge = join(home, ".codex/skills/skills-cli/SKILL.md");
  const materialize = (version: string, names: string[], manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) => {
    const root = join(parent, version);
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "pages", version, description: "Synthetic Pages plugin", apps: "./.app.json", ...manifest }));
    put(join(root, ".app.json"), APP);
    for (const [path, text] of Object.entries(files)) put(join(root, path), text);
    for (const name of names) put(join(root, "skills", name, "SKILL.md"), payload(name));
    return root;
  };
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE }));
  const first = materialize("1.0.0", initialNames);
  put(config, `model = "synthetic"\n${extraConfig}${listed ? "" : initialNames.map(name => `[[skills.config]]\npath = ${JSON.stringify(join(first, "skills", name, "SKILL.md"))}\nenabled = false\n`).join("")}`);
  const plugin = { id: PLUGIN, name: "pages", installed: true, enabled: true, localVersion: null, remotePluginId: REMOTE, sourceType: "remote" as const };
  const enrollment: CodexNativeSkillCatalog = { version: "codex-cli 0.163.0", cwd: home, plugins: [plugin],
    skills: listed ? initialNames.map(name => ({ name: `pages:${name}`, path: join(first, "skills", name, "SKILL.md"), enabled: true, pluginId: PLUGIN })) : [] };
  // byteWitnesses: the review also binds the plugin's manifest, app and skill documents by bytes (station04 shape).
  shape.prepare?.(cache);
  const byteSources = captureDiscoveryByteSources([...(shape.byteWitnesses ? [join(first, ".codex-plugin/plugin.json"), join(first, ".app.json"), ...initialNames.map(name => join(first, "skills", name, "SKILL.md"))] : []), ...(shape.witnesses?.(cache) ?? [])]);
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [cache], sources: [captureCodexSettingsV3(config), ...byteSources], pluginHooks: "reviewed-no-skill-injection" as const }] };
  // catalogReview false: the older binding shape that never recorded an installed-plugin catalog review.
  applyAgentIntegration(planAgentIntegration({ home, dataDir, projectDir: home, agents: ["codex"], ...(shape.catalogReview === false ? {} : { codexNativeCatalog: enrollment }), discoveryInputs: review }));
  const options = { home, dataDir, projectDir: home };
  /** What Codex reports after a refresh: enabled (undenied) skills plus the bridge. */
  const catalog = (enabled: CodexNativeSkill[], overrides: Partial<CodexNativeSkillCatalog> = {}): CodexNativeSkillCatalog => ({ version: "codex-cli 0.163.0", cwd: home, plugins: [plugin],
    skills: [{ name: "skills-cli", path: bridge, enabled: true, pluginId: null }, ...enabled], ...overrides });
  const skill = (root: string, name: string, pluginId = PLUGIN, namespace = "pages"): CodexNativeSkill => ({ name: `${namespace}:${name}`, path: join(root, "skills", name, "SKILL.md"), enabled: true, pluginId });
  const run = (apply: boolean, value: CodexNativeSkillCatalog) => runCodexPluginReconcile({ apply, home, dataDir, projectDir: home, captureCatalog: async () => value });
  const snapshot = () => ({ config: readFileSync(config, "utf8"), policy: readFileSync(policy, "utf8"), migrations: existsSync(join(dataDir, "migration")) ? readdirSync(join(dataDir, "migration")).sort() : [] });
  return { home, dataDir, cache, parent, config, policy, bridge, first, plugin, options, materialize, catalog, skill, run, snapshot };
}

/** Codex replaces the cached remote materialization with a newer version. */
function refresh(station: ReturnType<typeof enrolledStation>, version: string, names: string[], manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  rmSync(station.first, { recursive: true });
  return station.materialize(version, names, manifest, files);
}

const BUMPED = ["maintain-space", "write-page", "manage-schedules", "organize-space", "publish-page"];
const NEW = ["pages:manage-schedules", "pages:organize-space", "pages:publish-page"];

for (const listed of [true, false]) test(`a plugin version bump that adds 3 skill names (${listed ? "listed" : "omitted"} enrollment): preview lists them, apply enrolls them, the strict guard passes and a second apply is unchanged`, async () => {
  const station = enrolledStation(undefined, "", listed);
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const root = refresh(station, "1.1.0", BUMPED);
  expect(() => assertManagedAgentBridge("codex", station.options)).toThrow("3 unexpected native skill copies");
  const catalog = station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name)));
  const before = station.snapshot();

  const preview = await station.run(false, catalog);
  expect(preview).toMatchObject({ schema: "hasna.skills-codex-reconcile.v1", mode: "preview", outcome: "planned", codexVersion: "codex-cli 0.163.0", enrolled: NEW, allowed: ["skills-cli"],
    counts: { enrolled: 3, alreadyEnrolled: 2, skipped: 0, allowed: 1 }, changes: [station.config, station.policy] });
  expect(preview.code).toBeUndefined();
  expect(station.snapshot()).toEqual(before);

  const applied = await station.run(true, catalog);
  expect(applied).toMatchObject({ mode: "apply", outcome: "applied", enrolled: NEW, allowed: ["skills-cli"], counts: { enrolled: 3, alreadyEnrolled: 2, allowed: 1 } });
  expect(applied.code).toBeUndefined();
  const after = readFileSync(station.config, "utf8");
  for (const name of NEW) expect(after).toContain(`[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = false\n`);
  const receipt = JSON.parse(readFileSync(applied.receipt!, "utf8"));
  expect(receipt.codexReconcile).toEqual({ codexVersion: "codex-cli 0.163.0", enrolled: NEW });
  expect(applied.backups!.some(path => readFileSync(path, "utf8") === before.config)).toBe(true);
  const controls: CodexPluginSkillControl[] = JSON.parse(readFileSync(station.policy, "utf8")).bridge.codexPluginSkills;
  expect(controls.map(control => control.name)).toEqual(["pages:maintain-space", "pages:write-page", ...NEW]);
  expect(new Set(controls.map(control => JSON.stringify([control.manifestSha256, control.appSha256, control.remotePluginId ?? null, control.skillsOnly ?? null]))).size).toBe(1);
  expect(controls.every(control => control.remotePluginId === (listed ? undefined : REMOTE))).toBe(true);
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  expect(() => assertManagedAgentBridge("codex", { ...station.options, codexPromptHook: true })).not.toThrow();

  const settled = station.snapshot();
  const again = await station.run(true, station.catalog([]));
  expect(again).toMatchObject({ outcome: "unchanged", enrolled: [], counts: { enrolled: 0, alreadyEnrolled: 5, allowed: 1 }, changes: [] });
  expect(station.snapshot()).toEqual(settled);
});

test("a manifest version-only change with the same names needs nothing and the guard passes", async () => {
  const station = enrolledStation();
  refresh(station, "1.0.1", ["maintain-space", "write-page"]);
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const before = station.snapshot();
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "unchanged", enrolled: [], counts: { enrolled: 0, alreadyEnrolled: 2, allowed: 1 } });
  expect(station.snapshot()).toEqual(before);
});

test("a version bump that adds an MCP refuses with the named code, writes nothing and the guard keeps blocking with that code", async () => {
  const station = enrolledStation();
  const root = refresh(station, "1.1.0", [...BUMPED.slice(0, 2), "publish-page"], { mcpServers: "./.mcp.json" }, { ".mcp.json": '{"mcpServers":{"pages":{"command":"node","args":["server.js"]}}}' });
  expect(() => assertManagedAgentBridge("codex", station.options)).toThrow(`NATIVE_SKILL_DRIFT: ${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}: reviewed native plugin capability controls changed`);
  expect(() => assertManagedAgentBridge("codex", { ...station.options, codexPromptHook: true })).toThrow(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED);
  const before = station.snapshot();
  for (const apply of [false, true]) {
    const result = await station.run(apply, station.catalog([station.skill(root, "publish-page")]));
    expect(result).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, enrolled: [], changes: [], refusals: [{ pluginId: PLUGIN, reasons: ["manifest", "mcp"] }] });
    expect(result.message).toContain("stays quarantined until reviewed");
    expect(station.snapshot()).toEqual(before);
  }
});

test("app, hooks, manifest and remote capability changes of an enrolled plugin refuse with the named code", async () => {
  for (const [label, change, reasons] of [
    ["app", (s: ReturnType<typeof enrolledStation>) => refresh(s, "1.1.0", BUMPED, {}, { ".app.json": APP.replace("true", "false") }), ["app"]],
    ["hooks", (s: ReturnType<typeof enrolledStation>) => refresh(s, "1.1.0", BUMPED, {}, { "hooks/hooks.json": "{}" }), ["hooks"]],
    ["manifest", (s: ReturnType<typeof enrolledStation>) => refresh(s, "1.1.0", BUMPED, { description: "Changed metadata" }), ["manifest"]],
    ["remote", (s: ReturnType<typeof enrolledStation>) => { const root = refresh(s, "1.1.0", BUMPED); put(join(s.parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000756" })); return root; }, ["remote"]],
  ] as const) {
    const station = enrolledStation(undefined, "", label !== "remote");
    const root = change(station);
    const before = station.snapshot();
    const result = await station.run(true, station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))));
    expect({ label, ...result }).toMatchObject({ label, outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: PLUGIN, reasons: [...reasons] }] });
    expect(station.snapshot()).toEqual(before);
  }
});

test("a plugin Skills has not enrolled is enrolled automatically only when it is skills-only", async () => {
  const station = enrolledStation();
  const local = join(station.cache, "local-market/notes/1.0.0");
  put(join(local, ".codex-plugin/plugin.json"), JSON.stringify({ name: "notes", version: "1.0.0" }));
  put(join(local, "skills/draft/SKILL.md"), payload("draft"));
  const catalog = station.catalog([station.skill(local, "draft", "notes@local-market", "notes")], { plugins: [station.plugin, { id: "notes@local-market", name: "notes", installed: true, enabled: true, localVersion: "1.0.0" }] });
  expect(await station.run(true, catalog)).toMatchObject({ outcome: "applied", enrolled: ["notes:draft"], counts: { enrolled: 1, alreadyEnrolled: 2, allowed: 1 } });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();

  const other = enrolledStation();
  const remote = join(other.cache, "openai-curated-remote/templates/0.1.6");
  put(join(other.cache, "openai-curated-remote/templates/.codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000757" }));
  put(join(remote, ".codex-plugin/plugin.json"), JSON.stringify({ name: "templates", version: "0.1.6", apps: "./.app.json" }));
  put(join(remote, ".app.json"), APP.replaceAll("pages", "templates"));
  put(join(remote, "skills/report/SKILL.md"), payload("report"));
  const before = other.snapshot();
  const refused = await other.run(true, other.catalog([other.skill(remote, "report", "templates@openai-curated-remote", "templates")], { plugins: [other.plugin, { id: "templates@openai-curated-remote", name: "templates", installed: true, enabled: true, localVersion: null, remotePluginId: "plugins~Plugin_00000000000000000000000000000757", sourceType: "remote" }] }));
  expect(refused).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "templates@openai-curated-remote", reasons: ["app"] }] });
  expect(other.snapshot()).toEqual(before);
});

test("the bridge stays the only allowed skill: no allow entry is added and any other allowed skill refuses", async () => {
  const station = enrolledStation();
  const root = refresh(station, "1.1.0", BUMPED);
  const enabled = ["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name));
  const before = station.snapshot();
  const allowRows = (text: string) => (text.match(/enabled = true/g) ?? []).length;
  // A skill Codex loads from a root this package does not inventory.
  const rogue = { name: "rogue", path: join(station.home, "elsewhere/rogue/SKILL.md"), enabled: true, pluginId: null };
  for (const catalog of [station.catalog([...enabled, rogue]), { ...station.catalog(enabled), skills: enabled }]) {
    const result = await station.run(true, catalog);
    expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID", changes: [] });
    expect(station.snapshot()).toEqual(before);
  }
  const applied = await station.run(true, station.catalog(enabled));
  expect(applied).toMatchObject({ outcome: "applied", allowed: ["skills-cli"], counts: { allowed: 1 } });
  const after = readFileSync(station.config, "utf8");
  expect(allowRows(after)).toBe(allowRows(before.config));
  const beforeRules = (Bun.TOML.parse(before.config) as any).skills.config, afterRules = (Bun.TOML.parse(after) as any).skills.config;
  expect(afterRules.slice(0, beforeRules.length)).toEqual(beforeRules);
  expect(afterRules.slice(beforeRules.length).every((rule: any) => rule.enabled === false)).toBe(true);
  expect(afterRules.some((rule: any) => rule.name === "skills-cli" || String(rule.path ?? "").includes("skills-cli"))).toBe(false);
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
});

test("an existing explicit enable rule for a new plugin skill name conflicts and writes nothing", async () => {
  const station = enrolledStation(undefined, '[[skills.config]]\nname = "pages:publish-page"\nenabled = true\n');
  const root = refresh(station, "1.1.0", BUMPED);
  const before = station.snapshot();
  const result = await station.run(true, station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))));
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_NAME_CONFLICT", changes: [] });
  expect(result.message).toContain("pages:publish-page");
  expect(station.snapshot()).toEqual(before);
});

test("preview is read-only: configuration, policy and private backups stay byte-identical", async () => {
  const station = enrolledStation();
  const root = refresh(station, "1.1.0", BUMPED);
  const listing = (path: string): string[] => readdirSync(path, { recursive: true }).map(String).sort();
  const before = { ...station.snapshot(), codex: listing(join(station.home, ".codex")), data: listing(station.dataDir) };
  for (let index = 0; index < 2; index++) expect((await station.run(false, station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))))).outcome).toBe("planned");
  expect({ ...station.snapshot(), codex: listing(join(station.home, ".codex")), data: listing(station.dataDir) }).toEqual(before);
});

test("unknown Codex versions, other copies and a stale plan refuse without writing", async () => {
  const station = enrolledStation();
  const root = refresh(station, "1.1.0", BUMPED);
  const enabled = ["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name));
  const before = station.snapshot();
  for (const version of ["codex-cli 0.164.0", "codex-cli 0.158.0", "codex-cli 0.163.1"]) {
    expect(await station.run(true, station.catalog(enabled, { version }))).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION" });
    expect(station.snapshot()).toEqual(before);
  }
  // A user copy outside the plugin cache is not this command's to enroll.
  put(join(station.home, ".codex/skills/user-copy/SKILL.md"), payload("user-copy"));
  expect(await station.run(true, station.catalog(enabled))).toMatchObject({ outcome: "refused", code: "NATIVE_SKILL_DRIFT" });
  expect(station.snapshot()).toEqual(before);
  rmSync(join(station.home, ".codex/skills/user-copy"), { recursive: true });
  // A copy that appears after planning refuses the reviewed transaction.
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: station.catalog(enabled) });
  put(join(root, "skills/late-arrival/SKILL.md"), payload("late-arrival"));
  expect(() => applyAgentIntegration(plan!)).toThrow("NATIVE_SKILL_DRIFT");
  expect(station.snapshot()).toEqual(before);
});

test("the control merge is additive and keeps the enrolled parent's reviewed identity", () => {
  const prior: CodexPluginSkillControl = { name: "pages:write-page", pluginId: PLUGIN, namespace: "pages", pluginParent: "/cache/openai-curated-remote/pages", manifestSha256: "a".repeat(64), appSha256: "b".repeat(64), remotePluginId: REMOTE };
  const listed = { ...prior, name: "pages:publish-page", remotePluginId: undefined } as CodexPluginSkillControl;
  delete (listed as Partial<CodexPluginSkillControl>).remotePluginId;
  expect(mergeReconciledCodexPluginControls([prior], [listed], ["pages:publish-page"])).toEqual([prior, { ...prior, name: "pages:publish-page" }]);
  expect(mergeReconciledCodexPluginControls([prior], [prior], [])).toEqual([prior]);
  for (const changed of [{ appSha256: "c".repeat(64) }, { manifestSha256: "d".repeat(64) }, { mcpSha256: "e".repeat(64) }, { remotePluginId: "plugins~Other" }])
    expect(() => mergeReconciledCodexPluginControls([prior], [{ ...listed, ...changed }], ["pages:publish-page"])).toThrow(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED);
  const unenrolled: CodexPluginSkillControl = { name: "other:skill", pluginId: "other@market", namespace: "other", pluginParent: "/cache/market/other", manifestSha256: "f".repeat(64), appSha256: "b".repeat(64) };
  expect(() => mergeReconciledCodexPluginControls([prior], [unenrolled], ["other:skill"])).toThrow(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED);
  expect(() => mergeReconciledCodexPluginControls([prior], [], ["pages:missing"])).toThrow("IDENTITY_UNSUPPORTED");
});

test("every outcome is one bounded result object with a code exactly when it is refused or an error", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-reconcile-empty-")); roots.push(home);
  const results: CodexReconcileResult[] = [
    await runCodexPluginReconcile({ apply: true, home, dataDir: join(home, "data"), projectDir: home, captureCatalog: async () => ({ version: "codex-cli 0.163.0", cwd: home, skills: [], plugins: [] }) }),
    await runCodexPluginReconcile({ apply: true, home, dataDir: join(home, "data"), projectDir: home, captureCatalog: async () => { throw new Error("CODEX_HOOK_TRUST_NATIVE_UNAVAILABLE: install Codex or pass --codex-command"); } }),
    await runCodexPluginReconcile({ apply: true, home, dataDir: join(home, "data"), projectDir: home, codexHome: join(home, "elsewhere"), captureCatalog: async () => { throw new Error("not reached"); } }),
  ];
  expect(results.map(result => [result.outcome, result.code])).toEqual([["refused", "NATIVE_SKILL_DRIFT"], ["error", "CODEX_HOOK_TRUST_NATIVE_UNAVAILABLE"], ["refused", "CODEX_RECONCILE_CODEX_HOME_UNSUPPORTED"]]);
  for (const result of results) {
    expect(result).toMatchObject({ schema: "hasna.skills-codex-reconcile.v1", mode: "apply", enrolled: [], denied: [], pathDenied: [], inactive: [], rebasedWitnesses: 0, allowed: [], changes: [], counts: { enrolled: 0, alreadyEnrolled: 0, denied: 0, pathDenied: 0, skipped: 0, allowed: 0 } });
    expect(JSON.stringify(result).includes("\n")).toBe(false);
  }
  expect(existsSync(join(home, "data"))).toBe(false);
});

test("a remote skills-only plugin Skills has not enrolled is enrolled and binds its native install receipt", async () => {
  const station = enrolledStation();
  const parent = join(station.cache, "openai-curated-remote/sites"), root = join(parent, "1.0.0"), remote = "plugins~Plugin_00000000000000000000000000000759";
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remote }));
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "sites", version: "1.0.0" }));
  put(join(root, "skills/sites/SKILL.md"), payload("sites"));
  const sites = { id: "sites@openai-curated-remote", name: "sites", installed: true, enabled: true, localVersion: null, remotePluginId: remote, sourceType: "remote" as const };
  const result = await station.run(true, station.catalog([station.skill(root, "sites", sites.id, "sites")], { plugins: [station.plugin, sites] }));
  expect(result).toMatchObject({ outcome: "applied", enrolled: ["sites:sites"] });
  const controls: CodexPluginSkillControl[] = JSON.parse(readFileSync(station.policy, "utf8")).bridge.codexPluginSkills;
  expect(controls.find(control => control.name === "sites:sites")).toMatchObject({ pluginId: sites.id, remotePluginId: remote, skillsOnly: true });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  // The bound receipt is now a reviewed capability: replacing it refuses.
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000760" }));
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: sites.id, reasons: ["remote"] }] });
});

const CLEANUP_HOOKS = { hooks: { Stop: [{ hooks: [{ type: "mcp_tool", server: "node_repl", tool: "turn_ended", input: { hook_event_name: "${hook_event_name}", session_id: "${session_id}", turn_id: "${turn_id}" } }] }] } };

test("a plugin disabled in [plugins] neither refuses nor enrolls; enabled capability-bearing plugins are listed with their capability kinds", async () => {
  const station = enrolledStation(undefined, '[plugins."browser@openai-bundled"]\nenabled = false\n');
  const plugin = (market: string, name: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) => {
    const root = join(station.cache, market, name, "1.0.0");
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    for (const [path, text] of Object.entries(files)) put(join(root, path), text);
    put(join(root, "skills", name, "SKILL.md"), payload(name));
    return root;
  };
  const browser = plugin("openai-bundled", "browser", { hooks: CLEANUP_HOOKS });
  const chrome = plugin("openai-bundled", "chrome", { hooks: CLEANUP_HOOKS });
  // unified-computer-use shape: mcp_tool hooks plus .mcp.json, which the strict parser never admits.
  const unified = plugin("openai-bundled", "unified-computer-use", { hooks: CLEANUP_HOOKS, mcpServers: "./.mcp.json" }, { ".mcp.json": '{"mcpServers":{"cua":{"command":"node"}}}' });
  const visualize = plugin("openai-curated", "visualize", { mcpServers: "./.mcp.json" }, { ".mcp.json": '{"mcpServers":{"visualize":{"command":"node","args":["server.js"]}}}' });
  const entry = (id: string, enabled: boolean) => ({ id, name: id.slice(0, id.indexOf("@")), installed: true, enabled, localVersion: "1.0.0" });
  const plugins = [station.plugin, entry("browser@openai-bundled", false), entry("chrome@openai-bundled", true), entry("unified-computer-use@openai-bundled", true), entry("visualize@openai-curated", true)];
  const before = station.snapshot();
  const refused = await station.run(true, station.catalog([station.skill(chrome, "chrome", "chrome@openai-bundled", "chrome"), station.skill(unified, "unified-computer-use", "unified-computer-use@openai-bundled", "unified-computer-use"), station.skill(visualize, "visualize", "visualize@openai-curated", "visualize")], { plugins }));
  expect(refused).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "chrome@openai-bundled", reasons: ["hooks"] }, { pluginId: "unified-computer-use@openai-bundled", reasons: ["hooks", "mcp", "unsupported"] }, { pluginId: "visualize@openai-curated", reasons: ["mcp"] }] });
  expect(refused.refusals!.some(item => item.pluginId.startsWith("browser"))).toBe(false);
  expect(station.snapshot()).toEqual(before);
  for (const path of ["openai-bundled/chrome", "openai-bundled/unified-computer-use", "openai-curated"]) rmSync(join(station.cache, path), { recursive: true });
  const applied = await station.run(true, station.catalog([], { plugins: plugins.slice(0, 2) }));
  expect(applied).toMatchObject({ outcome: "applied", enrolled: [], inactive: ["browser@openai-bundled"], pathDenied: [{ name: "browser:browser", path: join(browser, "skills/browser/SKILL.md"), reason: "plugin-disabled" }], counts: { enrolled: 0, pathDenied: 1, allowed: 1 } });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  expect(await station.run(true, station.catalog([], { plugins: plugins.slice(0, 2) }))).toMatchObject({ outcome: "unchanged" });
});

test("Codex runtime-cache skills are denied by stable qualified name, by reported exact path when Codex gives none, and refuse when capability-bearing", async () => {
  const station = enrolledStation();
  const runtime = join(station.home, ".cache/codex-runtimes/openai-primary-runtime/26.1013.11914"), pluginId = "openai-primary-runtime@codex-runtimes";
  put(join(runtime, ".codex-plugin/plugin.json"), JSON.stringify({ name: "openai-primary-runtime", version: "26.1013.11914" }));
  for (const [directory, name] of [["documents", "documents"], ["pdf", "pdf"], ["spreadsheets", "spreadsheets"], ["spreadsheets-legacy", "spreadsheets"]]) put(join(runtime, "skills", directory, "SKILL.md"), payload(name));
  const runtimeSkill = (directory: string, name: string, qualified: boolean) => ({ name: qualified ? `openai-primary-runtime:${name}` : name, path: join(runtime, "skills", directory, "SKILL.md"), enabled: true, pluginId: qualified ? pluginId : null });
  const skills = [runtimeSkill("documents", "documents", true), runtimeSkill("pdf", "pdf", true), runtimeSkill("spreadsheets", "spreadsheets", true), runtimeSkill("spreadsheets-legacy", "spreadsheets", false)];
  const tools = join(station.home, ".cache/codex-runtimes/codex-app-tools/1.0.0");
  put(join(tools, ".codex-plugin/plugin.json"), JSON.stringify({ name: "codex-app-tools", version: "1.0.0", mcpServers: "./.mcp.json" }));
  put(join(tools, ".mcp.json"), '{"mcpServers":{"tools":{"command":"node"}}}'); put(join(tools, "skills/tools/SKILL.md"), payload("tools"));
  const before = station.snapshot();
  const refused = await station.run(true, station.catalog([...skills, { name: "codex-app-tools:tools", path: join(tools, "skills/tools/SKILL.md"), enabled: true, pluginId: "codex-app-tools@codex-runtimes" }]));
  expect(refused).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "codex-app-tools@codex-runtimes", reasons: ["mcp"] }] });
  expect(station.snapshot()).toEqual(before);
  const applied = await station.run(true, station.catalog(skills));
  expect(applied).toMatchObject({ outcome: "applied", enrolled: [], denied: ["openai-primary-runtime:documents", "openai-primary-runtime:pdf", "openai-primary-runtime:spreadsheets"],
    pathDenied: [{ name: "spreadsheets", path: join(runtime, "skills/spreadsheets-legacy/SKILL.md"), reason: "no-qualified-name" }], counts: { enrolled: 0, denied: 3, pathDenied: 1, allowed: 1 }, allowed: ["skills-cli"] });
  const rules = (Bun.TOML.parse(readFileSync(station.config, "utf8")) as any).skills.config;
  for (const name of applied.denied) expect(rules).toContainEqual({ name, enabled: false });
  expect(rules).toContainEqual({ path: join(runtime, "skills/spreadsheets-legacy/SKILL.md"), enabled: false });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const settled = station.snapshot();
  expect(await station.run(true, station.catalog(skills.map(skill => ({ ...skill, enabled: false }))))).toMatchObject({ outcome: "unchanged" });
  expect(station.snapshot()).toEqual(settled);
});

test("the older binding shape without an installed-plugin catalog review refuses and asks for a fresh full discovery review", async () => {
  const station = enrolledStation(undefined, "", true, { catalogReview: false });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const root = refresh(station, "1.1.0", BUMPED);
  const before = station.snapshot();
  for (const apply of [false, true]) {
    const result = await station.run(apply, station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))));
    expect(result).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_DISCOVERY_REVIEW_REQUIRED", changes: [] });
    expect(result.message).toContain("fresh full discovery review is required");
    expect(station.snapshot()).toEqual(before);
  }
});

test("a byte-witness binding (station04 shape) with a skills-only version bump re-captures the enrolled plugin witnesses and enrolls the new names", async () => {
  const station = enrolledStation(undefined, "", true, { byteWitnesses: true });
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const root = refresh(station, "1.1.0", BUMPED);
  expect(() => assertManagedAgentBridge("codex", station.options)).toThrow("Native discovery input changed");
  const catalog = station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name)));
  const before = station.snapshot();
  expect(await station.run(false, catalog)).toMatchObject({ outcome: "planned", enrolled: NEW, rebasedWitnesses: 4 });
  expect(station.snapshot()).toEqual(before);
  expect(await station.run(true, catalog)).toMatchObject({ outcome: "applied", enrolled: NEW, rebasedWitnesses: 4 });
  const sources: Array<{ path: string; hashMode?: string }> = JSON.parse(readFileSync(station.policy, "utf8")).bridge.discovery.codex.sources;
  for (const path of [".codex-plugin/plugin.json", ".app.json", "skills/maintain-space/SKILL.md", "skills/write-page/SKILL.md"]) {
    expect(sources).toContainEqual(expect.objectContaining({ path: join(root, path), hashMode: "bytes" }));
    expect(sources.some(source => source.path === join(station.first, path))).toBe(false);
  }
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "unchanged" });
  // A capability change is never re-captured: it refuses before any witness moves.
  const settled = station.snapshot();
  put(join(root, ".app.json"), APP.replace("true", "false"));
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: PLUGIN, reasons: ["app"] }] });
  expect(station.snapshot()).toEqual(settled);
});

test("the reconcile scope admits only appended disable rows and the bounded policy record, never an allow entry", () => {
  const station = enrolledStation();
  const root = refresh(station, "1.1.0", BUMPED);
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))) });
  const policy = JSON.parse(readFileSync(station.policy, "utf8"));
  const scope = { configPath: station.config, policyPath: station.policy, prior: policy.bridge.codexPluginSkills, names: NEW, discovery: policy.bridge.discovery.codex };
  expect(() => assertCodexReconcileScope(plan!, scope)).not.toThrow();
  const withConfig = (after: (text: string) => string) => ({ ...plan!, changes: plan!.changes.map(change => change.path === station.config ? { ...change, after: after(change.after) } : change) });
  const withPolicy = (edit: (value: any) => void) => ({ ...plan!, changes: plan!.changes.map(change => { if (change.path !== station.policy) return change; const value = JSON.parse(change.after); edit(value); return { ...change, after: JSON.stringify(value) }; }) });
  for (const changed of [
    withConfig(text => `${text}\n[[skills.config]]\nname = "pages:publish-page"\nenabled = true\n`),
    withConfig(text => `${text}\n[[skills.config]]\npath = ${JSON.stringify(join(station.home, "anything/SKILL.md"))}\nenabled = true\n`),
    withConfig(text => text.replace('model = "synthetic"', 'model = "other"')),
    withConfig(text => text.replace(/\[\[skills\.config\]\]\nname = "pages:maintain-space"\nenabled = false\n/, "")),
    withPolicy(value => { value.bridge.commands.codex = "/elsewhere/skills"; }),
    withPolicy(value => { value.bridge.codexPluginSkills.shift(); }),
    withPolicy(value => { value.bridge.codexPluginSkills.push({ ...value.bridge.codexPluginSkills[0], name: "pages:unreviewed" }); }),
    withPolicy(value => { value.bridge.codexPluginSkillReview = { ...value.bridge.codexPluginSkillReview, catalogSha256: "0".repeat(64) }; }),
    withPolicy(value => { value.bridge.discovery.codex.roots = []; }),
    { ...plan!, changes: [...plan!.changes, { path: join(station.home, ".codex/hooks.json"), before: null, after: "{}" }] },
  ]) expect(() => assertCodexReconcileScope(changed, scope)).toThrow("CODEX_RECONCILE_SCOPE_EXCEEDED");
});

test("every plugin enabled in [plugins] is classified, including ones the binding does not know; inline manifest hooks without hooks.json refuse", async () => {
  const hookPlugin = (cache: string) => join(cache, "hasna-internal-bridge/hasna-codex/0.1.0");
  const station = enrolledStation(undefined, ['pages@openai-curated-remote', 'hasna-codex@hasna-internal-bridge', 'chrome@openai-bundled', 'notes@local-market'].map(id => `[plugins.${JSON.stringify(id)}]\nenabled = true\n`).join(""), true, {
    // A reviewed hook plugin the binding knows through a full manifest witness.
    prepare: cache => { const root = hookPlugin(cache); put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "hasna-codex", version: "0.1.0", hooks: "./hooks/hooks.json" })); put(join(root, "hooks/hooks.json"), '{"hooks":{}}'); },
    witnesses: cache => [join(hookPlugin(cache), ".codex-plugin/plugin.json")],
  });
  const add = (market: string, name: string, manifest: Record<string, unknown>) => {
    const root = join(station.cache, market, name, "1.0.0");
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    put(join(root, "skills", name, "SKILL.md"), payload(name));
    // Already quarantined by an exact path deny: nothing about these plugins blocks the guard.
    writeFileSync(station.config, `${readFileSync(station.config, "utf8")}\n[[skills.config]]\npath = ${JSON.stringify(join(root, "skills", name, "SKILL.md"))}\nenabled = false\n`);
    return root;
  };
  const chrome = add("openai-bundled", "chrome", { hooks: CLEANUP_HOOKS }), notes = add("local-market", "notes", {});
  expect(existsSync(join(chrome, "hooks.json")) || existsSync(join(chrome, "hooks"))).toBe(false);
  expect(() => assertManagedAgentBridge("codex", station.options)).not.toThrow();
  const before = station.snapshot();
  const refused = await station.run(true, station.catalog([]));
  expect(refused).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, changes: [],
    refusals: [{ pluginId: "chrome@openai-bundled", reasons: ["hooks"], manifests: [join(chrome, ".codex-plugin/plugin.json")] }] });
  expect(station.snapshot()).toEqual(before);
  rmSync(join(station.cache, "openai-bundled"), { recursive: true });
  const settled = await station.run(true, station.catalog([]));
  expect(settled).toMatchObject({ outcome: "unchanged", classified: [{ pluginId: "notes@local-market", capabilities: [], manifests: [join(notes, ".codex-plugin/plugin.json")] }] });
  expect(station.snapshot()).toEqual(before);
});
