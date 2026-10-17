import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { applyAgentIntegration, applyCodexPluginReconcile, assertCodexReconcileScope, assertManagedAgentBridge, planAgentIntegration, planCodexPluginNameReconcile, planCodexSemanticCacheWitnessUpgrade } from "./agent-integration.js";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { CodexHookRpc } from "./codex-hook-rpc.js";
import { captureCodexSettingsV3 } from "./codex-settings-witness.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, rebaseCodexEnrolledCacheWitnesses } from "./agent-discovery.js";
import { CODEX_CAPABILITY_PATH_MUTATIONS, CODEX_INERT_NESTED_NAMES } from "./codex-plugin-capability-paths.fixture.js";
import { codexPluginCapabilityChanges, codexPluginRootEvidence, enrolledCodexPluginStrictChanges, unenrolledCodexPluginEvidence } from "./codex-plugin-skill-controls.js";
import { CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, CODEX_REMOTE_RECEIPT_MISMATCH, CODEX_REMOTE_RECEIPT_MISSING, mergeReconciledCodexPluginControls, type CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { runCodexPluginReconcile, type CodexReconcileResult } from "./codex-plugin-reconcile.js";
import { captureCodexRemoteReceiptSnapshot, type CodexNativeSkill, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";

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

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
/** A synthetic Codex config writer: the owned app-server's `config/read` and
 * `config/batchWrite` over one config.toml, with Codex's expectedVersion check.
 * It emulates the two writes a reconcile sends: the existing rows plus appended
 * rows (written as appended text, as Codex's formatting-preserving writer does),
 * and a restore to a preimage it has already read. `behaviour` injects a
 * concurrent writer, a different result, an override status or no daemon. */
function fakeCodexWriter(config: string, behaviour: { unavailable?: boolean; refuseRead?: boolean; layerConfig?: (config: any) => any; beforeWrite?: (call: number) => void; write?: (call: number, current: string, emulated: string) => string; status?: (call: number) => string; afterWrite?: (call: number) => void; loseResponse?: (call: number) => boolean; respond?: (call: number, response: { status: string; version: string; filePath: string }) => unknown } = {}) {
  const log = { connects: 0, reads: 0, writes: [] as any[], closes: 0 };
  const seen = new Map<string, string>();
  const version = (text: string) => `sha256:${sha256(text)}`;
  const emulate = (current: string, rows: unknown[] | null): string => {
    const existing = plain(Bun.TOML.parse(current)).skills?.config ?? [];
    if (rows && rows.length >= existing.length && isDeepStrictEqual(plain(rows.slice(0, existing.length)), existing))
      return current + rows.slice(existing.length).map(row => `\n[[skills.config]]\n${Object.entries(row as Record<string, unknown>).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n")}\n`).join("");
    const target = plain(Bun.TOML.parse(current)); if (rows) { target.skills ??= {}; target.skills.config = rows; } else if (target.skills) delete target.skills.config;
    for (const text of seen.values()) { const candidate = plain(Bun.TOML.parse(text)); if (candidate.skills && !Object.keys(candidate.skills).length) delete candidate.skills; if (target.skills && !Object.keys(target.skills).length) delete target.skills; if (isDeepStrictEqual(candidate, target)) return text; }
    throw new Error("synthetic writer cannot emulate this edit");
  };
  const connect = async (_options: { command: string; home: string; codexHome?: string }): Promise<CodexHookRpc> => {
    log.connects++;
    if (behaviour.unavailable) throw new Error("CODEX_HOOK_TRUST_NATIVE_UNAVAILABLE: install Codex or pass --codex-command");
    return { version: "codex-cli 0.163.0", async request(method: string, params: any) {
      const text = readFileSync(config, "utf8"); seen.set(version(text), text);
      if (method === "config/read") {
        log.reads++;
        if (behaviour.refuseRead) throw new Error("CODEX_HOOK_TRUST_NATIVE_RPC_REFUSED");
        const layer = behaviour.layerConfig ? behaviour.layerConfig(plain(Bun.TOML.parse(text))) : plain(Bun.TOML.parse(text));
        return { config: layer, layers: [{ name: { type: "user", file: config }, version: version(text), config: layer }] };
      }
      if (method !== "config/batchWrite") throw new Error(`unexpected native request ${method}`);
      const call = log.writes.length; log.writes.push(structuredClone(params));
      behaviour.beforeWrite?.(call);
      const current = readFileSync(config, "utf8");
      if (params.expectedVersion !== version(current)) throw new Error("CODEX_HOOK_TRUST_NATIVE_RPC_REFUSED");
      const edit = params.edits?.[0];
      if (params.edits?.length !== 1 || edit.keyPath !== "skills.config" || edit.mergeStrategy !== "replace" || params.reloadUserConfig !== true || params.filePath !== config) throw new Error("CODEX_HOOK_TRUST_NATIVE_RPC_REFUSED");
      const emulated = emulate(current, edit.value), next = behaviour.write ? behaviour.write(call, current, emulated) : emulated;
      writeFileSync(config, next); seen.set(version(next), next);
      behaviour.afterWrite?.(call);
      if (behaviour.loseResponse?.(call)) throw new Error("CODEX_HOOK_TRUST_NATIVE_RPC_FAILED");
      const response = { status: behaviour.status?.(call) ?? "ok", version: version(next), filePath: params.filePath };
      return behaviour.respond ? behaviour.respond(call, response) : response;
    }, async close() { log.closes++; } };
  };
  return { connect, log };
}

/** A reviewed Codex binding that enrolled one remote, app-bearing plugin (the
 * station shape: a typed settings witness and qualified-name controls).
 * `listed`: Codex listed the skills at enrollment. Otherwise they were already
 * path-denied and omitted. Either way the controls record the remote installation. */
function enrolledStation(initialNames = ["maintain-space", "write-page"], extraConfig = "", listed = true, shape: { catalogReview?: boolean; byteWitnesses?: boolean; directories?: boolean; prepare?: (cache: string) => void; witnesses?: (cache: string) => string[] } = {}) {
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
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [cache], sources: [captureCodexSettingsV3(config), ...byteSources], ...(shape.directories ? { directories: captureDiscoveryDirectories([cache]) } : {}), pluginHooks: "reviewed-no-skill-injection" as const }] };
  // catalogReview false: the older binding shape that never recorded an installed-plugin catalog review.
  applyAgentIntegration(planAgentIntegration({ home, dataDir, projectDir: home, agents: ["codex"], ...(shape.catalogReview === false ? {} : { codexNativeCatalog: { ...enrollment, remoteReceipts: captureCodexRemoteReceiptSnapshot(cache) } }), discoveryInputs: review }));
  const options = { home, dataDir, projectDir: home };
  /** What Codex reports after a refresh: enabled (undenied) skills plus the bridge. */
  const catalog = (enabled: CodexNativeSkill[], overrides: Partial<CodexNativeSkillCatalog> = {}): CodexNativeSkillCatalog => ({ version: "codex-cli 0.163.0", cwd: home, plugins: [plugin],
    skills: [{ name: "skills-cli", path: bridge, enabled: true, pluginId: null }, ...enabled], ...overrides });
  const skill = (root: string, name: string, pluginId = PLUGIN, namespace = "pages"): CodexNativeSkill => ({ name: `${namespace}:${name}`, path: join(root, "skills", name, "SKILL.md"), enabled: true, pluginId });
  const writer = fakeCodexWriter(config);
  const run = (apply: boolean, value: CodexNativeSkillCatalog, connect: ReturnType<typeof fakeCodexWriter>["connect"] = writer.connect) => runCodexPluginReconcile({ apply, home, dataDir, projectDir: home, captureCatalog: async () => value, connect });
  const snapshot = () => ({ config: readFileSync(config, "utf8"), policy: readFileSync(policy, "utf8"), migrations: existsSync(join(dataDir, "migration")) ? readdirSync(join(dataDir, "migration")).sort() : [] });
  return { home, dataDir, cache, parent, config, policy, bridge, first, plugin, options, materialize, catalog, skill, run, snapshot, writer };
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
  expect(controls.every(control => control.remotePluginId === REMOTE)).toBe(true);
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
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: { ...station.catalog(enabled), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) } });
  put(join(root, "skills/late-arrival/SKILL.md"), payload("late-arrival"));
  await expect(applyCodexPluginReconcile(plan!, { connect: station.writer.connect })).rejects.toThrow("NATIVE_SKILL_DRIFT");
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
  // Inactive needs Codex to report it disabled from a config-controlled source, not config alone.
  const plugins = [station.plugin, { ...entry("browser@openai-bundled", false), sourceType: "git" as const, sourceSha256: "e".repeat(64) }, entry("chrome@openai-bundled", true), entry("unified-computer-use@openai-bundled", true), entry("visualize@openai-curated", true)];
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
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: { ...station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) } });
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
  const home = (cache: string) => dirname(dirname(dirname(cache)));
  const marketplace = (cache: string) => join(home(cache), "bridge-src/.agents/plugins/marketplace.json"), sourceManifest = (cache: string) => join(home(cache), "bridge-src/plugins/hasna-codex/.codex-plugin/plugin.json");
  const decoy = (cache: string) => join(home(cache), "decoy/chrome/.codex-plugin/plugin.json");
  const station = enrolledStation(undefined, ['pages@openai-curated-remote', 'hasna-codex@hasna-internal-bridge', 'chrome@openai-bundled', 'notes@local-market'].map(id => `[plugins.${JSON.stringify(id)}]\nenabled = true\n`).join(""), true, {
    // A reviewed hook plugin the binding knows only through an exact reviewed
    // local marketplace mapping and its source manifest (the station02 shape),
    // plus a decoy manifest witness that merely shares chrome's plugin name.
    prepare: cache => {
      const manifest = JSON.stringify({ name: "hasna-codex", version: "0.1.0", hooks: "./hooks/hooks.json" }), root = hookPlugin(cache);
      put(join(root, ".codex-plugin/plugin.json"), manifest); put(join(root, "hooks/hooks.json"), '{"hooks":{}}');
      put(marketplace(cache), JSON.stringify({ name: "hasna-internal-bridge", interface: { displayName: "Synthetic bridge" }, plugins: [{ name: "hasna-codex", source: { source: "local", path: "./plugins/hasna-codex" } }] }));
      put(sourceManifest(cache), manifest); put(decoy(cache), JSON.stringify({ name: "chrome", version: "1.0.0" }));
    },
    witnesses: cache => [marketplace(cache), sourceManifest(cache), decoy(cache)],
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

// ---- Capability-path corpus: every location Codex reads must refuse on every path.
const cacheWitnesses = (station: ReturnType<typeof enrolledStation>) => (JSON.parse(readFileSync(station.policy, "utf8")).bridge.discovery.codex.sources as Array<{ path: string; sha256: string | null }>).filter(source => source.path.startsWith(station.cache + sep));
const blocks = (station: ReturnType<typeof enrolledStation>, live: boolean) => { try { assertManagedAgentBridge("codex", { ...station.options, ...(live ? { codexPromptHook: true } : {}) }); return false; } catch { return true; } };
function addNotesPlugin(station: ReturnType<typeof enrolledStation>) {
  const root = join(station.cache, "local-market/notes/1.0.0"), id = "notes@local-market";
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "notes", version: "1.0.0" }));
  put(join(root, "skills/draft/SKILL.md"), payload("draft"));
  return { root, id, catalog: station.catalog([station.skill(root, "draft", id, "notes")], { plugins: [station.plugin, { id, name: "notes", installed: true, enabled: true, localVersion: "1.0.0" }] }) };
}
async function expectRefusedAndStillBlocked(station: ReturnType<typeof enrolledStation>, catalog: CodexNativeSkillCatalog, byteWitnesses: boolean) {
  const before = station.snapshot(), witnesses = cacheWitnesses(station);
  if (byteWitnesses) expect(witnesses.length).toBe(4);
  expect(blocks(station, true)).toBe(true);
  const result = await station.run(true, catalog);
  expect(result).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, changes: [], enrolled: [], rebasedWitnesses: 0 });
  expect(station.snapshot()).toEqual(before);
  // The byte witnesses are still present and unchanged: no rebase happened.
  expect(cacheWitnesses(station)).toEqual(witnesses);
  expect(blocks(station, true)).toBe(true);
  expect(blocks(station, false)).toBe(true);
}
for (const mutation of CODEX_CAPABILITY_PATH_MUTATIONS) {
  test(`must refuse, new plugin, live hook stays BLOCK: ${mutation.label}`, async () => {
    const station = enrolledStation(), { root, catalog } = addNotesPlugin(station);
    mutation.apply(root, "notes");
    await expectRefusedAndStillBlocked(station, catalog, false);
  });
  for (const byteWitnesses of [false, true]) test(`must refuse, enrolled bump${byteWitnesses ? " with byte witnesses" : ""}, live hook stays BLOCK: ${mutation.label}`, async () => {
    const station = enrolledStation(undefined, "", true, { byteWitnesses });
    const root = refresh(station, "1.1.0", byteWitnesses ? ["maintain-space", "write-page"] : ["maintain-space", "write-page", "publish-page"]);
    mutation.apply(root, "pages");
    await expectRefusedAndStillBlocked(station, station.catalog(byteWitnesses ? [] : [station.skill(root, "publish-page")]), byteWitnesses);
  });
}
for (const name of CODEX_INERT_NESTED_NAMES) test(`an inert nested ${name} stays enrollable on the new-plugin and byte-witness bump paths`, async () => {
  const station = enrolledStation(), { root, catalog } = addNotesPlugin(station);
  put(join(root, name), "inert");
  expect(await station.run(true, catalog)).toMatchObject({ outcome: "applied", enrolled: ["notes:draft"] });
  expect(blocks(station, false)).toBe(false);
  const bumped = enrolledStation(undefined, "", true, { byteWitnesses: true });
  put(join(refresh(bumped, "1.1.0", ["maintain-space", "write-page"]), name), "inert");
  expect(await bumped.run(true, bumped.catalog([]))).toMatchObject({ outcome: "applied", rebasedWitnesses: 4 });
  expect(blocks(bumped, false)).toBe(false);
});

test("strict classification refuses links, extra manifest-directory entries, unknown manifest keys and outside skill sources", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-classify-")); roots.push(home);
  const read = (path: string) => readFileSync(path, "utf8");
  const plugin = (name: string, manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) => {
    const parent = join(home, "cache/market", name), root = join(parent, "1.0.0");
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    put(join(root, "skills", name, "SKILL.md"), payload(name));
    for (const [path, text] of Object.entries(files)) put(join(root, path), text);
    return { parent, root };
  };
  const clean = plugin("clean", { description: "Synthetic", skills: "./skills/" });
  expect(unenrolledCodexPluginEvidence(clean.parent, read)).toEqual({ reasons: [], manifests: [join(clean.root, ".codex-plugin/plugin.json")] });
  const linked = plugin("linked"); symlinkSync(join(linked.root, "skills/linked/SKILL.md"), join(linked.root, "assets-link"));
  expect(unenrolledCodexPluginEvidence(linked.parent, read).reasons).toContain("unsupported");
  const nestedLink = plugin("nested-link", {}, { "assets/readme.txt": "inert" }); symlinkSync(join(nestedLink.root, "assets/readme.txt"), join(nestedLink.root, "assets/alias.txt"));
  expect(unenrolledCodexPluginEvidence(nestedLink.parent, read).reasons).toContain("unsupported");
  expect(unenrolledCodexPluginEvidence(plugin("root-doc", {}, { "Skill.md": payload("root-doc") }).parent, read).reasons).toEqual(["unsupported"]);
  expect(unenrolledCodexPluginEvidence(plugin("extra", {}, { ".codex-plugin/extra.json": "{}" }).parent, read).reasons).toContain("manifest-location");
  expect(unenrolledCodexPluginEvidence(plugin("nested-codex", {}, { "assets/starter/.codex-plugin/plugin.json": "{}" }).parent, read).reasons).toContain("manifest-location");
  expect(unenrolledCodexPluginEvidence(plugin("unknown-key", { extensions: { synthetic: true } }).parent, read).reasons).toEqual(["unsupported"]);
  expect(unenrolledCodexPluginEvidence(plugin("agents-key", { agents: "./agents" }).parent, read).reasons).toContain("agents");
  expect(unenrolledCodexPluginEvidence(plugin("outside", { skills: "../../../outside" }).parent, read).reasons).toEqual(["unsupported"]);
  const runtime = join(home, "runtime");
  put(join(runtime, ".codex-plugin/plugin.json"), JSON.stringify({ name: "runtime", version: "26.1" })); put(join(runtime, "skills/pdf/SKILL.md"), payload("pdf"));
  expect(codexPluginRootEvidence(runtime, read).reasons).toEqual([]);
  put(join(runtime, "plugin.json"), JSON.stringify({ name: "runtime", mcpServers: { x: { command: "node" } } }));
  expect(codexPluginRootEvidence(runtime, read).reasons).toEqual(["manifest-location"]);
});

test("the witness rebase moves nothing for a plugin that fails the strict scan, even when called directly", () => {
  for (const [label, files, expected] of [["clean", {}, 4], ["root hooks.json", { "hooks.json": '{"hooks":{}}' }, 0], ["root plugin.json", { "plugin.json": JSON.stringify({ name: "pages", mcpServers: { x: { command: "node" } } }) }, 0]] as const) {
    const station = enrolledStation(undefined, "", true, { byteWitnesses: true });
    refresh(station, "1.1.0", ["maintain-space", "write-page"], {}, files as Record<string, string>);
    const bridge = JSON.parse(readFileSync(station.policy, "utf8")).bridge, controls: CodexPluginSkillControl[] = bridge.codexPluginSkills;
    const read = (path: string) => readFileSync(path, "utf8"), rules = (Bun.TOML.parse(readFileSync(station.config, "utf8")) as any).skills.config;
    const gate = (parent: string) => { const group = controls.filter(control => control.pluginParent === parent); return codexPluginCapabilityChanges(station.cache, group, read, rules).length === 0 && enrolledCodexPluginStrictChanges(group, read).length === 0; };
    const result = rebaseCodexEnrolledCacheWitnesses({ ...bridge.discovery.codex, codexDisabledPluginSkills: controls }, station.cache, [station.parent], gate);
    expect({ label, rebased: result.rebased.length }).toEqual({ label, rebased: expected });
  }
});

test("A26: an explicit name enable rule for a runtime skill with no qualified name conflicts instead of gaining a path deny", async () => {
  const station = enrolledStation(undefined, '[[skills.config]]\nname = "spreadsheets"\nenabled = true\n');
  const runtime = join(station.home, ".cache/codex-runtimes/openai-primary-runtime/26.1");
  put(join(runtime, ".codex-plugin/plugin.json"), JSON.stringify({ name: "openai-primary-runtime", version: "26.1" }));
  put(join(runtime, "skills/spreadsheets/SKILL.md"), payload("spreadsheets"));
  const before = station.snapshot();
  const result = await station.run(true, station.catalog([{ name: "spreadsheets", path: join(runtime, "skills/spreadsheets/SKILL.md"), enabled: true, pluginId: null }]));
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_NAME_CONFLICT", changes: [] });
  expect(result.message).toContain('"spreadsheets"');
  expect(station.snapshot()).toEqual(before);
});

test("A27: a remote receipt the native catalog does not confirm is never recorded as the plugin's remote identity", async () => {
  const station = enrolledStation(), { catalog } = addNotesPlugin(station);
  put(join(station.cache, "local-market/notes/.codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000999" }));
  const before = station.snapshot();
  expect(await station.run(true, catalog)).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "notes@local-market", reasons: ["remote"] }] });
  expect(station.snapshot()).toEqual(before);
});

// ---- Correctness review (f26578aa): B1, B3 and the surviving mutants.
const runtimePdf = (station: ReturnType<typeof enrolledStation>) => {
  const runtime = join(station.home, ".cache/codex-runtimes/openai-primary-runtime/26.1");
  put(join(runtime, ".codex-plugin/plugin.json"), JSON.stringify({ name: "openai-primary-runtime", version: "26.1" }));
  put(join(runtime, "skills/pdf/SKILL.md"), payload("pdf"));
  return { name: "openai-primary-runtime:pdf", path: join(runtime, "skills/pdf/SKILL.md"), enabled: true, pluginId: "openai-primary-runtime@codex-runtimes" };
};

test("B1: a skill Codex still reports enabled despite an existing deny row counts as allowed and refuses", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), pdf = runtimePdf(station);
  expect(await station.run(true, station.catalog([...["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name)), pdf]))).toMatchObject({ outcome: "applied", denied: [pdf.name] });
  const settled = station.snapshot();
  // A fresh catalog in which Codex ignored the deny rows: never `unchanged`.
  for (const stale of [[station.skill(root, "publish-page")], [pdf]]) {
    const result = await station.run(true, station.catalog(stale));
    expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID", changes: [] });
    expect(result.message).toContain(stale[0]!.name);
    expect(station.snapshot()).toEqual(settled);
  }
  expect(await station.run(true, station.catalog([{ ...pdf, enabled: false }]))).toMatchObject({ outcome: "unchanged" });
});

/** Appends `[[skills.config]]` rows to the station config and re-runs the reviewed install, so the review binds them. */
function reviewWithRows(station: ReturnType<typeof enrolledStation>, rows: string) {
  writeFileSync(station.config, `${readFileSync(station.config, "utf8")}${rows}`);
  const enrollment: CodexNativeSkillCatalog = { version: "codex-cli 0.163.0", cwd: station.home, plugins: [station.plugin], skills: ["maintain-space", "write-page"].map(name => station.skill(station.first, name)), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) };
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [station.cache], sources: [captureCodexSettingsV3(station.config)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...station.options, agents: ["codex"], codexNativeCatalog: enrollment, discoveryInputs: review }));
  expect(blocks(station, false)).toBe(false);
}
const enableRow = (path: string) => `\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = true\n`;

test("B3: a reviewed explicit path enable rule conflicts for runtime skills denied by name or by path and for plugin-cache copies", async () => {
  const cases: Array<[string, (station: ReturnType<typeof enrolledStation>) => CodexNativeSkillCatalog]> = [
    ["qualified runtime skill", station => { const pdf = runtimePdf(station); reviewWithRows(station, enableRow(pdf.path)); return station.catalog([pdf]); }],
    ["unqualified runtime skill", station => { const pdf = runtimePdf(station); reviewWithRows(station, enableRow(pdf.path)); return station.catalog([{ ...pdf, name: "pdf", pluginId: null }]); }],
    ["runtime skill whose reviewed name deny Codex ignores", station => { const pdf = runtimePdf(station); reviewWithRows(station, `${enableRow(pdf.path)}\n[[skills.config]]\nname = ${JSON.stringify(pdf.name)}\nenabled = false\n`); return station.catalog([pdf]); }],
    ["new plugin-cache name", station => { reviewWithRows(station, enableRow(join(station.parent, "1.1.0/skills/publish-page/SKILL.md"))); const root = refresh(station, "1.1.0", BUMPED); return station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))); }],
  ];
  for (const [label, arrange] of cases) {
    const station = enrolledStation(), catalog = arrange(station), before = station.snapshot();
    const result = await station.run(true, catalog);
    expect({ label, outcome: result.outcome, code: result.code, changes: result.changes }).toEqual({ label, outcome: "refused", code: "CODEX_NATIVE_SKILL_NAME_CONFLICT", changes: [] });
    expect(result.message).toContain("skill path");
    expect(station.snapshot()).toEqual(before);
  }
});

test("M14: a remote receipt that disagrees with the catalog's remote identity refuses and binds nothing", async () => {
  const station = enrolledStation(), { catalog, id } = addNotesPlugin(station);
  put(join(station.cache, "local-market/notes/.codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000998" }));
  const plugins = catalog.plugins!.map(plugin => plugin.id === id ? { ...plugin, localVersion: null, remotePluginId: "plugins~Plugin_00000000000000000000000000000997", sourceType: "remote" as const } : plugin);
  const before = station.snapshot();
  expect(await station.run(true, { ...catalog, plugins })).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons: ["remote"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("M16: an in-place change to a witnessed but unenrolled hook plugin is never re-captured", async () => {
  const hookRoot = (cache: string) => join(cache, "hasna-internal-bridge/hasna-codex/0.1.0");
  const station = enrolledStation(undefined, '[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true\n', true, {
    prepare: cache => { put(join(hookRoot(cache), ".codex-plugin/plugin.json"), JSON.stringify({ name: "hasna-codex", version: "0.1.0", hooks: "./hooks/hooks.json" })); put(join(hookRoot(cache), "hooks/hooks.json"), '{"hooks":{}}'); },
    witnesses: cache => [join(hookRoot(cache), ".codex-plugin/plugin.json")],
  });
  expect(blocks(station, false)).toBe(false);
  put(join(hookRoot(station.cache), ".codex-plugin/plugin.json"), JSON.stringify({ name: "hasna-codex", version: "0.1.0", hooks: "./hooks/hooks.json", mcpServers: "./.mcp.json" }));
  put(join(hookRoot(station.cache), ".mcp.json"), '{"mcpServers":{"added":{"command":"node"}}}');
  const before = station.snapshot(), witnesses = cacheWitnesses(station);
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "refused", code: "NATIVE_SKILL_DRIFT", rebasedWitnesses: 0, changes: [] });
  expect(station.snapshot()).toEqual(before);
  expect(cacheWitnesses(station)).toEqual(witnesses);
  expect(blocks(station, true)).toBe(true);
});

test("M25: a cosmetic reformat of ~/.codex/hooks.json makes the plan exceed its scope and refuse without rewriting it", async () => {
  const station = enrolledStation(), hooks = join(station.home, ".codex/hooks.json");
  writeFileSync(hooks, JSON.stringify(JSON.parse(readFileSync(hooks, "utf8"))));
  const root = refresh(station, "1.1.0", BUMPED), reformatted = readFileSync(hooks, "utf8"), before = station.snapshot();
  expect(blocks(station, false)).toBe(true);
  expect(await station.run(true, station.catalog([station.skill(root, "publish-page"), station.skill(root, "manage-schedules"), station.skill(root, "organize-space")]))).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_SCOPE_EXCEEDED", changes: [] });
  expect(readFileSync(hooks, "utf8")).toBe(reformatted);
  expect(station.snapshot()).toEqual(before);
  // The planner refuses it, not only the writer: preview never lists hooks.json.
  expect(await station.run(false, station.catalog([station.skill(root, "publish-page"), station.skill(root, "manage-schedules"), station.skill(root, "organize-space")]))).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_SCOPE_EXCEEDED", changes: [] });
  expect(station.writer.log.connects).toBe(0);
});

test("M39: apply re-plans under the lock, so a capability added after planning refuses the write", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED);
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: { ...station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name))), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) } });
  // The retained-review post-write strict guard also covers reconcile writes.
  expect(plan!.retainedReviewChecks?.agents).toEqual(["codex"]);
  const before = station.snapshot();
  put(join(root, "hooks.json"), '{"hooks":{}}');
  await expect(applyCodexPluginReconcile(plan!, { connect: station.writer.connect })).rejects.toThrow(CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED);
  expect(station.snapshot()).toEqual(before);
});

test("each capability declaration on a new plugin refuses with its exact kind", async () => {
  // Each declaration reports its own kind. Forms the reviewed-controls shape check
  // cannot bind (inline objects, a hooks directory) also report "unsupported".
  const cases: Array<[string, Record<string, string>, Record<string, unknown>, string[]]> = [
    [".mcp.json declaration", { ".mcp.json": '{"mcpServers":{"tool":{"command":"node"}}}' }, { mcpServers: "./.mcp.json" }, ["mcp"]],
    [".app.json declaration", { ".app.json": APP }, { apps: "./.app.json" }, ["app"]],
    ["inline mcpServers", {}, { mcpServers: { tool: { command: "node" } } }, ["mcp", "unsupported"]],
    ["inline apps", {}, { apps: { pages: { id: "synthetic" } } }, ["app", "unsupported"]],
    ["inline hooks", {}, { hooks: { Stop: [] } }, ["hooks", "unsupported"]],
    ["hooks.json file", { "hooks.json": '{"hooks":{}}' }, {}, ["hooks"]],
    ["hooks directory", { "hooks/hooks.json": '{"hooks":{}}' }, {}, ["hooks", "unsupported"]],
    ["commands directory", { "commands/deploy.md": "synthetic" }, {}, ["commands"]],
    ["agents directory", { "agents/reviewer.md": "synthetic" }, {}, ["agents"]],
  ];
  const seen: unknown[] = [], expected: unknown[] = [];
  for (const [label, files, manifest, reasons] of cases) {
    const station = enrolledStation(), { root, id, catalog } = addNotesPlugin(station);
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "notes", version: "1.0.0", ...manifest }));
    for (const [path, text] of Object.entries(files)) put(join(root, path), text);
    const before = station.snapshot(), result = await station.run(true, catalog);
    seen.push({ label, outcome: result.outcome, code: result.code, refusals: result.refusals?.map(item => ({ pluginId: item.pluginId, reasons: item.reasons })), unchanged: JSON.stringify(station.snapshot()) === JSON.stringify(before) });
    expected.push({ label, outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons }], unchanged: true });
  }
  expect(seen).toEqual(expected);
});

test("census: an enabled plugin id that maps to no single cache parent refuses; an enabled plugin not installed is skipped", async () => {
  const odd = enrolledStation(undefined, '[plugins."odd.name@market"]\nenabled = true\n'), before = odd.snapshot();
  expect(await odd.run(true, odd.catalog([]))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, changes: [], refusals: [{ pluginId: "odd.name@market", reasons: ["unsupported"] }] });
  expect(odd.snapshot()).toEqual(before);
  const absent = enrolledStation(undefined, '[plugins."absent@market"]\nenabled = true\n');
  expect(await absent.run(true, absent.catalog([]))).toMatchObject({ outcome: "unchanged", classified: [] });
});

// ---- Second review (f43cf2be): A1, A2, B1, B2 and the recommended K tests.
const receipts = (station: ReturnType<typeof enrolledStation>) => existsSync(join(station.dataDir, "migration")) ? readdirSync(join(station.dataDir, "migration")).filter(dir => existsSync(join(station.dataDir, "migration", dir, "receipt.json"))) : [];
const newNames = (station: ReturnType<typeof enrolledStation>, root: string) => station.catalog(["manage-schedules", "organize-space", "publish-page"].map(name => station.skill(root, name)));

test("A1: a remote, MCP-bearing plugin that config disables but Codex reports enabled is active and refuses", async () => {
  const id = "docs@openai-curated-remote", remote = "plugins~Plugin_00000000000000000000000000000999";
  const station = enrolledStation(undefined, `[plugins."${id}"]\nenabled = false\n`);
  const parent = join(station.cache, "openai-curated-remote/docs"), root = join(parent, "2.0.0");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remote }));
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "docs", version: "2.0.0", mcpServers: "./.mcp.json" }));
  put(join(root, ".mcp.json"), '{"mcpServers":{"docs":{"command":"node","args":["server.js"]}}}');
  put(join(root, "skills/docs/SKILL.md"), payload("docs"));
  expect(blocks(station, false)).toBe(true);
  const docs = { id, name: "docs", installed: true, enabled: true, localVersion: null, remotePluginId: remote, sourceType: "remote" as const };
  const before = station.snapshot();
  const result = await station.run(true, station.catalog([station.skill(root, "docs", id, "docs")], { plugins: [station.plugin, docs] }));
  expect(result).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, inactive: [], pathDenied: [], changes: [], refusals: [{ pluginId: id, reasons: ["mcp"] }] });
  expect(station.snapshot()).toEqual(before);
  expect(station.writer.log.writes).toEqual([]);
  expect(blocks(station, false)).toBe(true);
  expect(blocks(station, true)).toBe(true);
  // Codex reporting it disabled is not enough while its source is remote (not config-controlled).
  const quiet = await station.run(true, station.catalog([], { plugins: [station.plugin, { ...docs, enabled: false }] }));
  expect(quiet).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, inactive: [], refusals: [{ pluginId: id, reasons: ["mcp"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("A1: the census classifies a config-disabled plugin Codex reports enabled, even with no skill blocking", async () => {
  const id = "relay@openai-curated-remote", remote = "plugins~Plugin_00000000000000000000000000000998";
  const station = enrolledStation(undefined, `[plugins."${id}"]\nenabled = false\n`);
  const parent = join(station.cache, "openai-curated-remote/relay"), root = join(parent, "1.0.0");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remote }));
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "relay", version: "1.0.0", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo synthetic" }] }] } }));
  const relay = { id, name: "relay", installed: true, enabled: true, localVersion: null, remotePluginId: remote, sourceType: "remote" as const };
  const before = station.snapshot();
  expect(await station.run(true, station.catalog([], { plugins: [station.plugin, relay] }))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons: ["hooks", "unsupported"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("A1: a runtime skill of a config-disabled plugin that Codex reports enabled is denied, not treated as inactive", async () => {
  const station = enrolledStation(undefined, '[plugins."openai-primary-runtime@codex-runtimes"]\nenabled = false\n'), pdf = runtimePdf(station);
  expect(await station.run(true, station.catalog([pdf]))).toMatchObject({ outcome: "applied", inactive: [], denied: [pdf.name] });
  expect(blocks(station, false)).toBe(false);
});

test("B1: a skill named like the bridge at another path is not the bridge", async () => {
  const station = enrolledStation(), evil = join(station.home, ".cache/codex-runtimes/evil-runtime/1.0/skills/skills-cli/SKILL.md");
  put(evil, payload("skills-cli"));
  const before = station.snapshot();
  const result = await station.run(true, station.catalog([], { skills: [{ name: "skills-cli", path: evil, enabled: true, pluginId: null }] }));
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID", changes: [] });
  expect(station.snapshot()).toEqual(before);
});

test("B2: a new skills-only plugin Codex reports as a remote installation without an install receipt refuses as remote", async () => {
  const station = enrolledStation(), { catalog, id } = addNotesPlugin(station);
  const plugins = catalog.plugins!.map(plugin => plugin.id === id ? { ...plugin, localVersion: null, sourceType: "remote" as const, remotePluginId: "plugins~Plugin_00000000000000000000000000000996" } : plugin);
  const before = station.snapshot();
  expect(await station.run(true, { ...catalog, plugins })).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons: ["remote"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("K15: the witness rebase re-captures only manifest, app, MCP and skill roles; another witnessed file refuses", async () => {
  const notes = (cache: string) => join(cache, "openai-curated-remote/pages/1.0.0/assets/notes.txt");
  const station = enrolledStation(undefined, "", true, { byteWitnesses: true, prepare: cache => put(notes(cache), "reviewed notes"), witnesses: cache => [notes(cache)] });
  expect(blocks(station, false)).toBe(false);
  refresh(station, "1.1.0", ["maintain-space", "write-page"], {}, { "assets/notes.txt": "reviewed notes" });
  const before = station.snapshot(), witnesses = cacheWitnesses(station);
  const result = await station.run(true, station.catalog([]));
  expect(result).toMatchObject({ outcome: "refused", code: "NATIVE_SKILL_DRIFT", changes: [] });
  expect(station.snapshot()).toEqual(before);
  expect(cacheWitnesses(station)).toEqual(witnesses);
  expect(blocks(station, true)).toBe(true);
});

test("K24: a catalog captured for another working directory refuses instead of returning unchanged", async () => {
  const station = enrolledStation(), before = station.snapshot();
  expect(await station.run(true, station.catalog([], { cwd: join(station.home, "elsewhere") }))).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_CATALOG_INVALID", changes: [] });
  expect(station.snapshot()).toEqual(before);
});

test("K29: a reviewed explicit name enable rule for a runtime skill conflicts instead of being overridden by an appended deny", async () => {
  const station = enrolledStation(), pdf = runtimePdf(station);
  reviewWithRows(station, `\n[[skills.config]]\nname = ${JSON.stringify(pdf.name)}\nenabled = true\n`);
  const before = station.snapshot();
  const result = await station.run(true, station.catalog([pdf]));
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_NAME_CONFLICT", changes: [] });
  expect(result.message).toContain(pdf.name);
  expect(station.snapshot()).toEqual(before);
});

test("K34: a binding that uses the semantic cache witness refuses with its own code when work is needed", async () => {
  const station = enrolledStation(undefined, "", true, { directories: true });
  const base = { agent: "codex" as const, home: station.home, dataDir: station.dataDir, appOnlyParents: [], expectedPolicySha256: sha256(readFileSync(station.policy, "utf8")), expectedSettingsSha256: sha256(readFileSync(station.config, "utf8")) };
  const preview = planCodexSemanticCacheWitnessUpgrade(base);
  applyAgentIntegration(planCodexSemanticCacheWitnessUpgrade({ ...base, expectedCacheWitnessSha256: preview.discoveryAfter![0]!.codexSemanticCache!.witness.sha256 }));
  expect(blocks(station, false)).toBe(false);
  const pdf = runtimePdf(station), before = station.snapshot();
  expect(await station.run(true, station.catalog([pdf]))).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_SEMANTIC_CACHE_UNSUPPORTED", changes: [] });
  expect(station.snapshot()).toEqual(before);
});

test("A2: the deny rows go through Codex's versioned writer, and the policy follows only after the config readback", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), configBefore = readFileSync(station.config, "utf8"), policyBefore = readFileSync(station.policy, "utf8");
  const planned = planCodexPluginNameReconcile({ ...station.options, catalog: { ...newNames(station, root), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) } }).plan!.changes.find(change => change.path === station.config)!.after;
  const result = await station.run(true, newNames(station, root));
  expect(result).toMatchObject({ outcome: "applied", enrolled: NEW });
  const configAfter = readFileSync(station.config, "utf8");
  expect(station.writer.log.writes).toHaveLength(1);
  expect(station.writer.log.writes[0]).toEqual({ edits: [{ keyPath: "skills.config", value: plain(Bun.TOML.parse(configAfter)).skills.config, mergeStrategy: "replace" }], filePath: station.config, expectedVersion: `sha256:${sha256(configBefore)}`, reloadUserConfig: true });
  // Readback: exactly the planned configuration; existing rows kept, then only disable rows.
  expect(plain(Bun.TOML.parse(configAfter))).toEqual(plain(Bun.TOML.parse(planned)));
  const appended = plain(Bun.TOML.parse(configAfter)).skills.config.slice(plain(Bun.TOML.parse(configBefore)).skills.config.length);
  expect(appended.every((row: any) => row.enabled === false)).toBe(true);
  expect(NEW.every(name => appended.some((row: any) => row.name === name))).toBe(true);
  expect(station.writer.log.closes).toBe(station.writer.log.connects);
  expect(readFileSync(station.policy, "utf8")).not.toBe(policyBefore);
  const receipt = JSON.parse(readFileSync(result.receipt!, "utf8"));
  expect(receipt.changes).toEqual([
    { path: station.config, beforeHash: sha256(configBefore), afterHash: sha256(configAfter), writer: "codex:config/batchWrite", nativeConfigVersion: `sha256:${sha256(configAfter)}` },
    { path: station.policy, beforeHash: sha256(policyBefore), afterHash: sha256(readFileSync(station.policy, "utf8")), writer: "skills" },
  ]);
  expect(blocks(station, false)).toBe(false);
});

test("A2: an expectedVersion conflict (a concurrent Codex write) refuses and this run writes nothing", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), policyBefore = readFileSync(station.policy, "utf8"), receiptsBefore = receipts(station);
  const desktop = fakeCodexWriter(station.config, { beforeWrite: () => appendFileSync(station.config, "\n# written by another Codex client\n") });
  const result = await station.run(true, newNames(station, root), desktop.connect);
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_NATIVE_WRITE_REFUSED", changes: [] });
  expect(desktop.log.writes).toHaveLength(1);
  expect(readFileSync(station.config, "utf8").includes("pages:publish-page")).toBe(false);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
  expect(receipts(station)).toEqual(receiptsBefore);
  expect(desktop.log.closes).toBe(desktop.log.connects);
  expect(blocks(station, false)).toBe(true);
});

test("A2: with no Codex writer reachable the reconcile refuses with a named code and never falls back to a file write", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), before = station.snapshot();
  const result = await station.run(true, newNames(station, root), fakeCodexWriter(station.config, { unavailable: true }).connect);
  expect(result).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_NATIVE_WRITER_UNAVAILABLE", changes: [] });
  expect(station.snapshot()).toEqual(before);
  // The ordinary file writer refuses a reconcile plan outright.
  const { plan } = planCodexPluginNameReconcile({ ...station.options, catalog: { ...newNames(station, root), remoteReceipts: captureCodexRemoteReceiptSnapshot(station.cache) } });
  expect(() => applyAgentIntegration(plan!)).toThrow("CODEX_RECONCILE_NATIVE_WRITER_REQUIRED");
  expect(station.snapshot()).toEqual(before);
  // A Codex that reports a different user configuration also refuses before any write.
  expect(await station.run(true, newNames(station, root), fakeCodexWriter(station.config, { refuseRead: true }).connect)).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_NATIVE_CONFIG_MISMATCH" });
  expect(station.snapshot()).toEqual(before);
});

test("A2: a readback that differs from the plan, or an overridden write, is restored through Codex's writer", async () => {
  for (const [label, behaviour, code] of [
    ["readback", { write: (call: number, current: string, emulated: string) => call === 0 ? `${current}\n[[skills.config]]\nname = "pages:publish-page"\nenabled = false\n` : emulated }, "CODEX_RECONCILE_NATIVE_READBACK_FAILED"],
    ["overridden", { status: (call: number) => call === 0 ? "okOverridden" : "ok" }, "CODEX_RECONCILE_NATIVE_WRITE_OVERRIDDEN"],
  ] as const) {
    const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), configBefore = readFileSync(station.config, "utf8"), policyBefore = readFileSync(station.policy, "utf8"), receiptsBefore = receipts(station);
    const writer = fakeCodexWriter(station.config, behaviour);
    const result = await station.run(true, newNames(station, root), writer.connect);
    expect({ label, outcome: result.outcome, code: result.code }).toEqual({ label, outcome: "error", code });
    expect(writer.log.writes).toHaveLength(2);
    expect(writer.log.writes[1].expectedVersion).not.toBe(writer.log.writes[0].expectedVersion);
    expect(writer.log.writes[1].edits[0].value).toEqual(plain(Bun.TOML.parse(configBefore)).skills.config);
    expect(readFileSync(station.config, "utf8")).toBe(configBefore);
    expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
    expect(receipts(station)).toEqual(receiptsBefore);
  }
});

test("A2: compensation never overwrites a newer Codex write, and an unconfirmed write is finished by the next run", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), policyBefore = readFileSync(station.policy, "utf8");
  const raced = fakeCodexWriter(station.config, { status: () => "okOverridden", afterWrite: () => appendFileSync(station.config, "\n# written by another Codex client\n") });
  const result = await station.run(true, newNames(station, root), raced.connect);
  expect(result).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_COMPENSATION_INCOMPLETE" });
  expect(result.message).toContain("deny rows were left in place");
  expect(raced.log.writes).toHaveLength(1);
  expect(readFileSync(station.config, "utf8").endsWith("# written by another Codex client\n")).toBe(true);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
  // A lost confirmation: the rows landed, the policy did not; the next run finishes without another config write.
  const lost = enrolledStation(), lostRoot = refresh(lost, "1.1.0", BUMPED), lostPolicy = readFileSync(lost.policy, "utf8");
  const dropped = fakeCodexWriter(lost.config, { loseResponse: () => true });
  expect(await lost.run(true, newNames(lost, lostRoot), dropped.connect)).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_NATIVE_WRITE_UNCERTAIN" });
  expect(readFileSync(lost.policy, "utf8")).toBe(lostPolicy);
  expect(readFileSync(lost.config, "utf8").includes("pages:publish-page")).toBe(true);
  // Codex now reports the denied skills disabled; only the policy remains to be written.
  const finish = fakeCodexWriter(lost.config), reported = newNames(lost, lostRoot);
  expect(await lost.run(true, { ...reported, skills: reported.skills.map(skill => skill.pluginId === null ? skill : { ...skill, enabled: false }) }, finish.connect)).toMatchObject({ outcome: "applied", enrolled: NEW });
  expect(finish.log.writes).toEqual([]);
  expect(blocks(lost, false)).toBe(false);
});

// ---- Second review, surviving mutants: each test names the check it pins.
/** A new plugin with a hooks capability and one skill, as Codex reports it. */
function addRelayPlugin(station: ReturnType<typeof enrolledStation>, id: string, withSkill = true) {
  const [name, market] = id.split("@") as [string, string], root = join(station.cache, market, name, "1.0.0");
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo synthetic" }] }] } }));
  if (withSkill) put(join(root, "skills", name, "SKILL.md"), payload(name));
  return { root, skill: { name: `${name}:${name}`, path: join(root, "skills", name, "SKILL.md"), enabled: true, pluginId: id } };
}
const gitSource = { sourceType: "git" as const, sourceSha256: "e".repeat(64) };

test("inactive needs Codex to report the plugin disabled and to list none of its skills, not only a config-controlled source", async () => {
  // Codex reports it enabled (config disables it, the source is config-controlled, no skill listed).
  const enabled = enrolledStation(undefined, '[plugins."relay@local-market"]\nenabled = false\n');
  addRelayPlugin(enabled, "relay@local-market");
  const before = enabled.snapshot();
  expect(await enabled.run(true, enabled.catalog([], { plugins: [enabled.plugin, { id: "relay@local-market", name: "relay", installed: true, enabled: true, localVersion: "1.0.0", ...gitSource }] }))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, inactive: [], refusals: [{ pluginId: "relay@local-market" }] });
  expect(enabled.snapshot()).toEqual(before);
  // Codex reports it disabled, but still lists one of its skills.
  const listed = enrolledStation(undefined, '[plugins."relay@local-market"]\nenabled = false\n'), { skill } = addRelayPlugin(listed, "relay@local-market");
  const listedBefore = listed.snapshot();
  expect(await listed.run(true, listed.catalog([skill], { plugins: [listed.plugin, { id: "relay@local-market", name: "relay", installed: true, enabled: false, localVersion: "1.0.0", ...gitSource }] }))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, inactive: [], refusals: [{ pluginId: "relay@local-market" }] });
  expect(listed.snapshot()).toEqual(listedBefore);
  // Control: all four conditions hold, so it is inactive and path-denied.
  const inactive = enrolledStation(undefined, '[plugins."relay@local-market"]\nenabled = false\n'), quiet = addRelayPlugin(inactive, "relay@local-market");
  expect(await inactive.run(true, inactive.catalog([], { plugins: [inactive.plugin, { id: "relay@local-market", name: "relay", installed: true, enabled: false, localVersion: "1.0.0", ...gitSource }] }))).toMatchObject({ outcome: "applied", inactive: ["relay@local-market"], pathDenied: [{ path: quiet.skill.path, reason: "plugin-disabled" }] });
});

test("the census covers a plugin Codex reports enabled with no config entry, and a config-disabled plugin the catalog does not report", async () => {
  const reported = enrolledStation();
  addRelayPlugin(reported, "relay@openai-curated", false);
  const before = reported.snapshot();
  expect(await reported.run(true, reported.catalog([], { plugins: [reported.plugin, { id: "relay@openai-curated", name: "relay", installed: true, enabled: true, localVersion: "1.0.0" }] }))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "relay@openai-curated" }] });
  expect(reported.snapshot()).toEqual(before);
  const unreported = enrolledStation(undefined, '[plugins."relay@openai-curated"]\nenabled = false\n');
  addRelayPlugin(unreported, "relay@openai-curated", false);
  const unreportedBefore = unreported.snapshot();
  expect(await unreported.run(true, unreported.catalog([]))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: "relay@openai-curated" }] });
  expect(unreported.snapshot()).toEqual(unreportedBefore);
});

test("only the exact unqualified bridge is the bridge: a plugin skill named skills-cli is denied, and the bridge path with a plugin id refuses", async () => {
  const station = enrolledStation(), runtime = join(station.home, ".cache/codex-runtimes/tools-runtime/1.0");
  put(join(runtime, ".codex-plugin/plugin.json"), JSON.stringify({ name: "tools-runtime", version: "1.0" }));
  put(join(runtime, "skills/skills-cli/SKILL.md"), payload("skills-cli"));
  const named = { name: "skills-cli", path: join(runtime, "skills/skills-cli/SKILL.md"), enabled: true, pluginId: "tools-runtime@codex-runtimes" };
  expect(await station.run(true, station.catalog([named]))).toMatchObject({ outcome: "applied", pathDenied: [{ name: "skills-cli", path: named.path, reason: "no-qualified-name" }] });
  const other = enrolledStation(), before = other.snapshot();
  expect(await other.run(true, other.catalog([], { skills: [{ name: "skills-cli", path: other.bridge, enabled: true, pluginId: "skills-cli@elsewhere" }] }))).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID" });
  expect(other.snapshot()).toEqual(before);
});

test("a new plugin's skill document without a supported qualified identity refuses as unsupported", async () => {
  const station = enrolledStation(), { root, catalog, id } = addNotesPlugin(station);
  put(join(root, "skills/draft/SKILL.md"), "no front matter\n");
  const before = station.snapshot();
  expect(await station.run(true, catalog)).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons: ["unsupported"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("A2: a Codex user layer that differs from the planned configuration refuses before any write", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), before = station.snapshot();
  const elsewhere = fakeCodexWriter(station.config, { layerConfig: config => ({ ...config, model: "another-model" }) });
  expect(await station.run(true, newNames(station, root), elsewhere.connect)).toMatchObject({ outcome: "refused", code: "CODEX_RECONCILE_NATIVE_CONFIG_MISMATCH", changes: [] });
  expect(elsewhere.log.writes).toEqual([]);
  expect(elsewhere.log.closes).toBe(1);
  expect(station.snapshot()).toEqual(before);
});

test("an enable rule for an already enrolled name is refused by the reviewed install, and unreviewed it refuses the reconcile as drift", async () => {
  const station = enrolledStation();
  expect(() => reviewWithRows(station, `\n[[skills.config]]\nname = "pages:write-page"\nenabled = true\n`)).toThrow("CODEX_NATIVE_SKILL_NAME_CONFLICT");
  const root = refresh(station, "1.1.0", BUMPED), before = station.snapshot();
  expect(await station.run(true, newNames(station, root))).toMatchObject({ outcome: "refused", code: "NATIVE_SKILL_DRIFT", changes: [] });
  expect(station.snapshot()).toEqual(before);
});

test("a skills-only plugin config disables but Codex reports enabled is active: never path-denied as inactive", async () => {
  // Codex reports it enabled from a config-controlled source and lists none of its
  // skills. Active, so its unlisted skill needs a qualified identity it lacks: refuse.
  const station = enrolledStation(undefined, '[plugins."notes@local-market"]\nenabled = false\n'), { catalog, id } = addNotesPlugin(station);
  const plugins = catalog.plugins!.map(plugin => plugin.id === id ? { ...plugin, ...gitSource } : plugin);
  const before = station.snapshot();
  expect(await station.run(true, { ...catalog, skills: catalog.skills.filter(skill => skill.pluginId !== id), plugins })).toMatchObject({ outcome: "refused", code: "CODEX_NATIVE_SKILL_IDENTITY_UNSUPPORTED", inactive: [], pathDenied: [], changes: [] });
  expect(station.snapshot()).toEqual(before);
});

// ---- Third review (b74ff9d5): the post-write proof, its compensation, and unverifiable writes.
for (const [label, mutate, expected] of [
  ["a late skill copy", (root: string) => put(join(root, "skills/late-arrival/SKILL.md"), payload("late-arrival")), { outcome: "refused", code: "NATIVE_SKILL_DRIFT" }],
  ["a late root hooks.json", (root: string) => put(join(root, "hooks.json"), '{"hooks":{}}'), { outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: PLUGIN, reasons: ["hooks"] }] }],
] as const) test(`post-write proof: ${label} landing while Codex writes is caught after the policy write, and both writes are compensated`, async () => {
  // afterWrite runs inside Codex's write, after the locked re-plan and before the
  // policy write: exactly the window only the post-write proof covers.
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED);
  const configBefore = readFileSync(station.config, "utf8"), policyBefore = readFileSync(station.policy, "utf8"), receiptsBefore = receipts(station);
  const writer = fakeCodexWriter(station.config, { afterWrite: call => { if (call === 0) mutate(root); } });
  const result = await station.run(true, newNames(station, root), writer.connect);
  expect(result).toMatchObject({ ...expected, changes: [] });
  expect(writer.log.writes).toHaveLength(2);
  // The second write is the restore: bound to the version Codex returned for this run's write.
  expect(writer.log.writes[1].expectedVersion).not.toBe(writer.log.writes[0].expectedVersion);
  expect(writer.log.writes[1].edits[0].value).toEqual(plain(Bun.TOML.parse(configBefore)).skills.config);
  expect(readFileSync(station.config, "utf8")).toBe(configBefore);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
  expect(receipts(station)).toEqual(receiptsBefore);
  expect(blocks(station, false)).toBe(true);
});

test("an unverifiable write is reported as uncertain, never as a refusal, naming the deny rows and the private backup", async () => {
  // Codex answers ok after the rows landed, but with no config version.
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), policyBefore = readFileSync(station.policy, "utf8");
  const versionless = fakeCodexWriter(station.config, { respond: (_call, response) => ({ status: response.status, filePath: response.filePath }) });
  const result = await station.run(true, newNames(station, root), versionless.connect);
  expect(result).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_NATIVE_WRITE_UNCERTAIN" });
  expect(result.message).toContain("without a valid config version");
  expect(result.message).toContain("private backup: ");
  expect(result.message).toContain("holds this run's deny rows");
  expect(result.message).toContain("pages:manage-schedules");
  expect(versionless.log.writes).toHaveLength(1);
  expect(readFileSync(station.config, "utf8").includes("pages:publish-page")).toBe(true);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
  // A write that times out and lands after the check is uncertain too, not refused.
  const late = enrolledStation(), lateRoot = refresh(late, "1.1.0", BUMPED), latePolicy = readFileSync(late.policy, "utf8");
  const planned = planCodexPluginNameReconcile({ ...late.options, catalog: { ...newNames(late, lateRoot), remoteReceipts: captureCodexRemoteReceiptSnapshot(late.cache) } }).plan!.changes.find(change => change.path === late.config)!.after;
  const timeout = fakeCodexWriter(late.config, { write: (call, current, emulated) => call === 0 ? current : emulated, loseResponse: call => call === 0 });
  const timedOut = await late.run(true, newNames(late, lateRoot), timeout.connect);
  expect(timedOut).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_NATIVE_WRITE_UNCERTAIN" });
  expect(timedOut.message).toContain("did not answer the config write");
  expect(timedOut.message).toContain("may still receive this run's deny rows");
  expect(timedOut.message).toContain("private backup: ");
  expect(readFileSync(late.policy, "utf8")).toBe(latePolicy);
  // The write lands later; the next run sees Codex report the skills disabled and finishes the policy only.
  writeFileSync(late.config, planned);
  const finish = fakeCodexWriter(late.config), reported = newNames(late, lateRoot);
  expect(await late.run(true, { ...reported, skills: reported.skills.map(skill => skill.pluginId === null ? skill : { ...skill, enabled: false }) }, finish.connect)).toMatchObject({ outcome: "applied", enrolled: NEW });
  expect(finish.log.writes).toEqual([]);
  expect(blocks(late, false)).toBe(false);
});

// ---- Fourth review (e7880cb6): a plugin Codex uninstalled, and message robustness.
/** Enroll templates@openai-curated-remote (remote, skills-only) through the reconcile, then let Codex uninstall it. */
async function enrollThenUninstallTemplates(station: ReturnType<typeof enrolledStation>) {
  const id = "templates@openai-curated-remote", remote = "plugins~Plugin_00000000000000000000000000000757";
  const parent = join(station.cache, "openai-curated-remote/templates"), root = join(parent, "0.1.6");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remote }));
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "templates", version: "0.1.6" }));
  put(join(root, "skills/report/SKILL.md"), payload("report"));
  const templates = { id, name: "templates", installed: true, enabled: true, localVersion: null, remotePluginId: remote, sourceType: "remote" as const };
  expect(await station.run(true, station.catalog([station.skill(root, "report", id, "templates")], { plugins: [station.plugin, templates] }))).toMatchObject({ outcome: "applied", enrolled: ["templates:report"] });
  // Codex 0.163 PluginStore::uninstall removes <CODEX_HOME>/plugins/cache/<marketplace>/<plugin>.
  rmSync(parent, { recursive: true });
  return { id, templates };
}

test("a plugin Codex uninstalled after the reconcile enrolled it is unchanged, as the guard treats it, and other bumps still apply", async () => {
  const station = enrolledStation();
  await enrollThenUninstallTemplates(station);
  expect(blocks(station, false)).toBe(false);
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "unchanged" });
  // A skills-only bump of another enrolled plugin still enrolls; the post-write check exempts the absent parent too.
  const root = refresh(station, "1.1.0", BUMPED);
  expect(await station.run(true, newNames(station, root))).toMatchObject({ outcome: "applied", enrolled: NEW });
  expect(blocks(station, false)).toBe(false);
});

test("an absent enrolled plugin the native catalog still reports installed and enabled is not exempt and refuses", async () => {
  const station = enrolledStation(), { id, templates } = await enrollThenUninstallTemplates(station);
  const before = station.snapshot();
  expect(await station.run(true, station.catalog([], { plugins: [station.plugin, templates] }))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: id, reasons: ["unsupported"] }] });
  expect(station.snapshot()).toEqual(before);
});

test("an uncertain write over an unparseable config.toml stays uncertain and names the private backup", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), policyBefore = readFileSync(station.policy, "utf8");
  // A timed-out write that leaves config.toml unparseable (for example half-written by another client).
  const broken = fakeCodexWriter(station.config, { write: (call, current, emulated) => call === 0 ? `${current}\n[[[not toml\n` : emulated, loseResponse: call => call === 0 });
  const result = await station.run(true, newNames(station, root), broken.connect);
  expect(result).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_NATIVE_WRITE_UNCERTAIN" });
  expect(result.message).toContain("may still receive this run's deny rows");
  expect(result.message).toContain("private backup: ");
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
});

test("a restore that Codex does not confirm is reported as unconfirmed, keeping COMPENSATION_INCOMPLETE", async () => {
  const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED), policyBefore = readFileSync(station.policy, "utf8");
  const writer = fakeCodexWriter(station.config, { status: call => call === 0 ? "okOverridden" : "ok", loseResponse: call => call === 1 });
  const result = await station.run(true, newNames(station, root), writer.connect);
  expect(result).toMatchObject({ outcome: "error", code: "CODEX_RECONCILE_COMPENSATION_INCOMPLETE" });
  expect(result.message).toContain("did not confirm the restore of config.toml");
  expect(result.message).not.toContain("refused to restore");
  expect(writer.log.writes).toHaveLength(2);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
});

test("a manifest, app or receipt change landing while Codex writes is an error with both writes compensated", async () => {
  for (const [label, mutate] of [
    ["manifest", (root: string) => put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "pages", version: "1.1.0", description: "Changed while writing", apps: "./.app.json" }))],
    [".app.json", (root: string) => put(join(root, ".app.json"), '{"apps":{"pages":{"id":"another_connector","required":true}}}')],
    ["remote receipt", (root: string) => put(join(dirname(root), ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "plugins~Plugin_00000000000000000000000000000995" }))],
  ] as const) {
    const station = enrolledStation(), root = refresh(station, "1.1.0", BUMPED);
    const configBefore = readFileSync(station.config, "utf8"), policyBefore = readFileSync(station.policy, "utf8"), receiptsBefore = receipts(station);
    const writer = fakeCodexWriter(station.config, { afterWrite: call => { if (call === 0) mutate(root); } });
    const result = await station.run(true, newNames(station, root), writer.connect);
    expect({ label, outcome: result.outcome, code: result.code, identity: String(result.message).includes("Native identity source changed during application") }).toEqual({ label, outcome: "error", code: "CODEX_RECONCILE_FAILED", identity: true });
    expect({ label, writes: writer.log.writes.length, config: readFileSync(station.config, "utf8") === configBefore, policy: readFileSync(station.policy, "utf8") === policyBefore, receipts: receipts(station).length === receiptsBefore.length })
      .toEqual({ label, writes: 2, config: true, policy: true, receipts: true });
  }
});

test("an absent enrolled plugin whose controls are not remote, skills-only and denied by name is not exempt and refuses", async () => {
  // Pages is enrolled with an app: an uninstalled Pages has no reviewed disabled identity to keep.
  // Every control records the remote receipt, so its absence also reports `remote`.
  const station = enrolledStation();
  rmSync(station.parent, { recursive: true });
  const before = station.snapshot();
  expect(await station.run(true, station.catalog([]))).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: PLUGIN, reasons: ["remote", "unsupported"] }] });
  expect(station.snapshot()).toEqual(before);
});

const TEMPLATES = "templates@openai-curated-remote", TEMPLATES_REMOTE = "plugins~Plugin_00000000000000000000000000000761";
const OTHER_REMOTE = "plugins~Plugin_00000000000000000000000000000762";
/** The openai-templates shape (station02): a remote plugin that carries an app,
 * enrolled by its first reviewed `hook install`. `localVersion` is what Codex
 * reports for it (null: the receipt-bound omitted path). `listed` skills are
 * listed and enabled at enrollment; `omitted` ones are already path-denied and
 * omitted. `receipt` is the on-disk native install receipt (null: absent).
 * `locals` adds plugins Codex does not report as remote: no receipt exists.
 * `remote: false` leaves the remote plugin out entirely. */
type LocalPlugin = { name: string; source: "local" | "unreported"; listed: string[]; omitted: string[] };
function templatesStation(localVersion: string | null, listed: string[], omitted: string[], shape: { receipt?: string | null; locals?: LocalPlugin[]; remote?: false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-templates-")); roots.push(home);
  admitCorpusFixture(join(home, ".codex"));
  const dataDir = join(home, "data"), cache = join(home, ".codex/plugins/cache"), parent = join(cache, "openai-curated-remote/templates"), root = join(parent, "0.1.6");
  const config = join(home, ".codex/config.toml"), policy = join(dataDir, "agent-policy.json"), receiptPath = join(parent, ".codex-remote-plugin-install.json");
  const doc = (name: string, at = root) => join(at, "skills", name, "SKILL.md");
  const writeReceipt = (id: string) => put(receiptPath, JSON.stringify({ schema_version: 1, remote_plugin_id: id }));
  const plugin = { id: TEMPLATES, name: "templates", installed: true, enabled: true, localVersion, remotePluginId: TEMPLATES_REMOTE, sourceType: "remote" as const };
  const plugins: NonNullable<CodexNativeSkillCatalog["plugins"]> = [], skills: CodexNativeSkill[] = [], denied: string[] = [];
  if (shape.remote !== false) {
    put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "templates", version: "0.1.6", description: "Synthetic Templates plugin", apps: "./.app.json" }));
    put(join(root, ".app.json"), APP.replaceAll("pages", "templates"));
    for (const name of [...listed, ...omitted]) put(doc(name), payload(name));
    const receipt = shape.receipt === undefined ? TEMPLATES_REMOTE : shape.receipt;
    if (receipt !== null) writeReceipt(receipt);
    plugins.push(plugin);
    skills.push(...listed.map(name => ({ name: `templates:${name}`, path: doc(name), enabled: true, pluginId: TEMPLATES })));
    denied.push(...omitted.map(name => doc(name)));
  }
  for (const local of shape.locals ?? []) {
    const id = `${local.name}@local-market`, at = join(cache, "local-market", local.name, "1.0.0"), sourcePath = join(home, "sources", local.name);
    put(join(at, ".codex-plugin/plugin.json"), JSON.stringify({ name: local.name, version: "1.0.0" }));
    for (const name of [...local.listed, ...local.omitted]) put(doc(name, at), payload(name));
    plugins.push({ id, name: local.name, installed: true, enabled: true, localVersion: "1.0.0",
      ...(local.source === "local" ? { sourceType: "local" as const, sourceSha256: hashNativeJsonControls(JSON.stringify({ type: "local", path: sourcePath })), sourcePath } : {}) });
    skills.push(...local.listed.map(name => ({ name: `${local.name}:${name}`, path: doc(name, at), enabled: true, pluginId: id })));
    denied.push(...local.omitted.map(name => doc(name, at)));
  }
  put(config, `model = "synthetic"\n${denied.map(path => `[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`).join("")}`);
  const enrollment: CodexNativeSkillCatalog = { version: "codex-cli 0.163.0", cwd: home, plugins, skills };
  // A fresh discovery review of the current configuration, as each reviewed install takes.
  const review = () => ({ version: 1 as const, agents: [{ agent: "codex" as const, roots: [cache], sources: [captureCodexSettingsV3(config)], pluginHooks: "reviewed-no-skill-injection" as const }] });
  const options = { home, dataDir, projectDir: home };
  /** One reviewed enrollment. `skills hook native-catalog` reads the remote
   * receipts before it starts Codex; its app-server then rewrites them to the
   * catalog's identity (`heal`); `skills hook install --agent codex
   * --discovery-inputs <review> --codex-native-catalog <catalog> --apply` then
   * consumes that catalog. `snapshot: false` is an older capture without the
   * pre-start snapshot; `cacheRoot` relabels it as another Codex home's. */
  const install = (capture: { heal?: boolean; snapshot?: false; cacheRoot?: string } = {}) => {
    const remoteReceipts = captureCodexRemoteReceiptSnapshot(cache);
    if (capture.heal) writeReceipt(TEMPLATES_REMOTE);
    const catalog = capture.snapshot === false ? enrollment : { ...enrollment, remoteReceipts: capture.cacheRoot === undefined ? remoteReceipts : { ...remoteReceipts, cacheRoot: capture.cacheRoot } };
    return applyAgentIntegration(planAgentIntegration({ ...options, agents: ["codex"], codexNativeCatalog: catalog, discoveryInputs: review() }));
  };
  const controls = (): CodexPluginSkillControl[] => JSON.parse(readFileSync(policy, "utf8")).bridge.codexPluginSkills;
  const bridge = join(home, ".codex/skills/skills-cli/SKILL.md");
  /** Codex's catalog after enrollment: the bridge plus any newly listed skills.
   * `heal`: the capture's app-server rewrites the receipt to the catalog's identity. */
  const reconcile = (apply: boolean, enabled: CodexNativeSkill[] = [], heal = false) => runCodexPluginReconcile({ apply, home, dataDir, projectDir: home, captureCatalog: async () => {
    if (heal) writeReceipt(TEMPLATES_REMOTE);
    return { version: "codex-cli 0.163.0", cwd: home, plugins, skills: [{ name: "skills-cli", path: bridge, enabled: true, pluginId: null }, ...enabled] };
  } });
  /** A new skill name Codex adds to the installed remote materialization. */
  const addSkill = (name: string): CodexNativeSkill => { put(doc(name), payload(name)); return { name: `templates:${name}`, path: doc(name), enabled: true, pluginId: TEMPLATES }; };
  const read = (path: string) => readFileSync(path, "utf8");
  const changes = () => codexPluginCapabilityChanges(cache, controls().filter(control => control.pluginId === TEMPLATES), read, (Bun.TOML.parse(readFileSync(config, "utf8")) as any).skills?.config ?? []);
  /** Rewrite the stored controls, as a policy written before this fix could hold them. */
  const storeControls = (edit: (controls: CodexPluginSkillControl[]) => void) => {
    const value = JSON.parse(readFileSync(policy, "utf8")); edit(value.bridge.codexPluginSkills); writeFileSync(policy, JSON.stringify(value, null, 2));
  };
  /** Exact configuration and policy bytes (policy null while absent). */
  const bytes = () => ({ config: readFileSync(config, "utf8"), policy: existsSync(policy) ? readFileSync(policy, "utf8") : null });
  return { home, dataDir, cache, config, policy, parent, receiptPath, options, install, controls, reconcile, addSkill, changes, writeReceipt, storeControls, bytes };
}
const strictGuards = (station: ReturnType<typeof templatesStation>) => [() => assertManagedAgentBridge("codex", station.options), () => assertManagedAgentBridge("codex", { ...station.options, codexPromptHook: true })];
async function expectRemoteReceiptChangeCaught(station: ReturnType<typeof templatesStation>) {
  for (const guard of strictGuards(station)) expect(guard).not.toThrow();
  expect(await station.reconcile(true)).toMatchObject({ outcome: "unchanged" });
  station.writeReceipt(OTHER_REMOTE);
  for (const guard of strictGuards(station)) expect(guard).toThrow(`NATIVE_SKILL_DRIFT: ${CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED}: reviewed native plugin capability controls changed`);
  // The only capability the guard can be refusing is the bound receipt.
  expect(station.changes()).toEqual(["remote"]);
  const before = { config: readFileSync(station.config, "utf8"), policy: readFileSync(station.policy, "utf8") };
  for (const apply of [false, true]) {
    const result = await station.reconcile(apply);
    expect(result).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, enrolled: [], changes: [], refusals: [{ pluginId: TEMPLATES, reasons: ["remote"] }] });
    expect({ config: readFileSync(station.config, "utf8"), policy: readFileSync(station.policy, "utf8") }).toEqual(before);
  }
  // Positive control: restoring the reviewed receipt clears both refusals.
  station.writeReceipt(TEMPLATES_REMOTE);
  for (const guard of strictGuards(station)) expect(guard).not.toThrow();
  expect(station.changes()).toEqual([]);
  expect(await station.reconcile(true)).toMatchObject({ outcome: "unchanged" });
}

for (const [label, localVersion, listed, omitted] of [
  ["null localVersion: two listed and enabled, one omitted", null, ["make-deck", "make-report"], ["make-sheet"]],
  ["reported localVersion: one listed and enabled, two omitted", "0.1.6", ["make-deck"], ["make-report", "make-sheet"]],
] as const) test(`openai-templates first hook install records the remote receipt on every control (${label}), and a later receipt change is caught by the guard and the reconcile`, async () => {
  const station = templatesStation(localVersion, [...listed], [...omitted]);
  station.install();
  const controls = station.controls();
  expect(controls.map(control => control.name).sort()).toEqual([...listed, ...omitted].map(name => `templates:${name}`).sort());
  expect(controls).toHaveLength(3);
  for (const control of controls) expect(control).toMatchObject({ pluginId: TEMPLATES, remotePluginId: TEMPLATES_REMOTE });
  expect(controls.every(control => control.appSha256 !== undefined && control.skillsOnly === undefined)).toBe(true);
  await expectRemoteReceiptChangeCaught(station);
});

/** The refusal message, which must carry the named code and nothing of the receipt. */
function refusal(run: () => unknown): string {
  try { run(); } catch (error) { return (error as Error).message; }
  throw new Error("expected a refusal");
}
const receiptRefusal = (code: string, kind: string) => new RegExp(`^${code}: remote plugin "${TEMPLATES}" has no matching install receipt \\(${kind}\\); .*\`skills hook install\``);
const RECEIPT_CASES = [["missing", CODEX_REMOTE_RECEIPT_MISSING], ["mismatch", CODEX_REMOTE_RECEIPT_MISMATCH]] as const;
const CONTROL_PATHS = [
  ["listed and enabled", null, ["make-deck"], []],
  ["omitted with no localVersion", null, [], ["make-sheet"]],
  ["omitted under a reported localVersion", "0.1.6", [], ["make-sheet"]],
  ["listed, omitted and localVersion together", "0.1.6", ["make-deck"], ["make-report", "make-sheet"]],
] as const;
for (const heal of [false, true]) for (const [kind, code] of RECEIPT_CASES) for (const [label, localVersion, listed, omitted] of CONTROL_PATHS) test(`a remote plugin whose receipt was ${kind} before Codex started refuses at install with ${code} (${label}; the app-server ${heal ? "rewrote" : "left"} the receipt before install) and writes nothing`, () => {
  // First enrollment: nothing is written and no policy appears.
  const fresh = templatesStation(localVersion, [...listed], [...omitted], { receipt: kind === "missing" ? null : OTHER_REMOTE });
  const before = fresh.bytes();
  expect(before.policy).toBeNull();
  const message = refusal(() => fresh.install({ heal }));
  expect(message).toMatch(receiptRefusal(code, kind));
  expect(message).not.toContain("plugins~");
  expect(fresh.bytes()).toEqual(before);
  // The healed receipt now matches the catalog; only the pre-start snapshot shows it was not.
  if (heal) expect(readFileSync(fresh.receiptPath, "utf8")).toContain(TEMPLATES_REMOTE);
  // Re-enrollment over a reviewed policy: configuration and policy bytes stay identical.
  const enrolled = templatesStation(localVersion, [...listed], [...omitted]);
  enrolled.install();
  expect(enrolled.controls().every(control => control.remotePluginId === TEMPLATES_REMOTE)).toBe(true);
  expect(() => enrolled.install({ heal })).not.toThrow();
  const reviewed = enrolled.bytes();
  if (kind === "missing") rmSync(enrolled.receiptPath); else enrolled.writeReceipt(OTHER_REMOTE);
  expect(refusal(() => enrolled.install({ heal }))).toMatch(receiptRefusal(code, kind));
  expect(enrolled.bytes()).toEqual(reviewed);
});

test("a catalog without a pre-start receipt snapshot (an older capture), or with one of another Codex home, refuses and writes nothing", () => {
  for (const capture of [{ snapshot: false as const }, { cacheRoot: "/elsewhere/.codex/plugins/cache" }]) {
    const station = templatesStation(null, ["make-deck"], ["make-sheet"]);
    const before = station.bytes();
    const message = refusal(() => station.install(capture));
    expect(message).toMatch(/^CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED: .*re-capture it with `skills hook native-catalog`/);
    expect(station.bytes()).toEqual(before);
  }
});

test("plugins Codex does not report as remote have no receipt and never trip either receipt code", () => {
  const locals: LocalPlugin[] = [{ name: "notes", source: "local", listed: ["draft"], omitted: ["archive"] }, { name: "drafts", source: "unreported", listed: ["outline"], omitted: ["review"] }];
  const station = templatesStation("0.1.6", ["make-deck"], ["make-sheet"], { locals });
  for (const name of ["notes", "drafts"]) expect(existsSync(join(station.home, ".codex/plugins/cache/local-market", name, ".codex-remote-plugin-install.json"))).toBe(false);
  station.install();
  const controls = station.controls();
  expect(controls.map(control => control.name).sort()).toEqual(["drafts:outline", "drafts:review", "notes:archive", "notes:draft", "templates:make-deck", "templates:make-sheet"]);
  for (const control of controls) expect(control.remotePluginId).toBe(control.pluginId === TEMPLATES ? TEMPLATES_REMOTE : undefined);
  for (const guard of strictGuards(station)) expect(guard).not.toThrow();
  // With no remote plugin at all, local plugins enroll; the catalog still needs its pre-start snapshot.
  const local = templatesStation(null, [], [], { locals, remote: false });
  const before = local.bytes();
  expect(refusal(() => local.install({ snapshot: false }))).toMatch(/^CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED: /);
  expect(local.bytes()).toEqual(before);
  local.install();
  expect(local.controls().some(control => control.remotePluginId !== undefined)).toBe(false);
  for (const guard of strictGuards(local)) expect(guard).not.toThrow();
});

test("a reconcile of a policy stored before this fix refuses with the named receipt code when the receipt is gone, and writes nothing", async () => {
  const station = templatesStation(null, ["make-deck", "make-report"], ["make-sheet"]);
  station.install();
  // Pre-fix listed enrollment: no control recorded the receipt.
  station.storeControls(controls => { for (const control of controls) delete control.remotePluginId; });
  rmSync(station.receiptPath);
  const added = station.addSkill("make-chart");
  const before = station.bytes();
  for (const heal of [false, true]) for (const apply of [false, true]) {
    // heal: the capture's app-server rewrites the receipt; the reconcile read it before.
    if (heal) expect(existsSync(station.receiptPath)).toBe(false);
    const result = await station.reconcile(apply, [added], heal);
    expect(result).toMatchObject({ outcome: "refused", code: CODEX_REMOTE_RECEIPT_MISSING, enrolled: [], changes: [] });
    expect(result.message).toMatch(receiptRefusal(CODEX_REMOTE_RECEIPT_MISSING, "missing"));
    expect(station.bytes()).toEqual(before);
    if (heal) rmSync(station.receiptPath);
  }
});

for (const [label, kept] of [
  ["the first control lacks the id, two carry it", [false, true, true]],
  ["only a non-first control carries the id", [false, true, false]],
  ["only the last control carries the id", [false, false, true]],
] as const) test(`mixed stored controls (${label}): a receipt change is caught by the strict guard and the reconcile reports remote`, async () => {
  const station = templatesStation(null, ["make-deck", "make-report"], ["make-sheet"]);
  station.install();
  // A policy stored before every control recorded the receipt.
  station.storeControls(controls => { expect(controls).toHaveLength(3); controls.forEach((control, index) => { if (!kept[index]) delete control.remotePluginId; }); });
  expect(station.controls().map(control => control.remotePluginId !== undefined)).toEqual([...kept]);
  await expectRemoteReceiptChangeCaught(station);
});

// ---- #139 reviewer B's non-blocking uninstall cases, in this suite's style.
/** Enroll a remote skills-only plugin `atlas` (skill `plan`) in `market` through the reconcile. */
async function enrollRemoteAtlas(station: ReturnType<typeof enrolledStation>, market = "openai-curated-remote") {
  const id = `atlas@${market}`, remote = "plugins~Plugin_00000000000000000000000000000888";
  const parent = join(station.cache, market, "atlas"), root = join(parent, "2.0.0");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remote }));
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "atlas", version: "2.0.0" }));
  put(join(root, "skills/plan/SKILL.md"), payload("plan"));
  const row = { id, name: "atlas", installed: true, enabled: true, localVersion: null, remotePluginId: remote, sourceType: "remote" as const };
  expect(await station.run(true, station.catalog([station.skill(root, "plan", id, "atlas")], { plugins: [station.plugin, row] }))).toMatchObject({ outcome: "applied", enrolled: ["atlas:plan"] });
  return { id, parent, root, row };
}

test("an uninstalled plugin stays exempt when Codex reports it installed but disabled, or not installed at all", async () => {
  const station = enrolledStation(), atlas = await enrollRemoteAtlas(station);
  rmSync(atlas.parent, { recursive: true });
  expect(await station.run(true, station.catalog([], { plugins: [station.plugin, { ...atlas.row, enabled: false }] }))).toMatchObject({ outcome: "unchanged" });
  expect(await station.run(true, station.catalog([], { plugins: [station.plugin, { ...atlas.row, installed: false }] }))).toMatchObject({ outcome: "unchanged" });
});

test("an uninstalled plugin stays exempt when only a plugin of the same name in another marketplace is reported enabled", async () => {
  // The catalog check keys on the exact plugin id; nothing of the other marketplace is materialized.
  const station = enrolledStation(), atlas = await enrollRemoteAtlas(station);
  rmSync(atlas.parent, { recursive: true });
  expect(await station.run(true, station.catalog([], { plugins: [station.plugin, { ...atlas.row, id: "atlas@openai-curated" }] }))).toMatchObject({ outcome: "unchanged" });
});

test("a plugin Codex uninstalls during the write, while the plan's catalog reports it enabled, refuses after the write and both writes are compensated", async () => {
  // Codex refreshes atlas to a body-free materialization the guard still accepts.
  const station = enrolledStation(), atlas = await enrollRemoteAtlas(station);
  rmSync(join(atlas.root, "skills"), { recursive: true });
  const root = refresh(station, "1.1.0", BUMPED);
  const configBefore = readFileSync(station.config, "utf8"), policyBefore = readFileSync(station.policy, "utf8"), receiptsBefore = receipts(station);
  const writer = fakeCodexWriter(station.config, { afterWrite: call => { if (call === 0) rmSync(atlas.parent, { recursive: true }); } });
  const reported = station.catalog(newNames(station, root).skills.slice(1), { plugins: [station.plugin, atlas.row] });
  const result = await station.run(true, reported, writer.connect);
  expect(result).toMatchObject({ outcome: "refused", code: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, refusals: [{ pluginId: atlas.id, reasons: ["unsupported"] }] });
  expect(result.message).toContain("was removed while the reconcile was writing");
  expect(result.message).not.toContain("gained a capability");
  expect(writer.log.writes).toHaveLength(2);
  expect(readFileSync(station.config, "utf8")).toBe(configBefore);
  expect(readFileSync(station.policy, "utf8")).toBe(policyBefore);
  expect(receipts(station)).toEqual(receiptsBefore);
  // A fresh catalog no longer reports the uninstalled plugin: the bump applies.
  expect(await station.run(true, newNames(station, root))).toMatchObject({ outcome: "applied", enrolled: NEW });
  expect(blocks(station, false)).toBe(false);
});

