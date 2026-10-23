import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import type { CodexHookRpc } from "./codex-hook-rpc.js";
import { CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA, captureCodexRemoteReceiptSnapshot, codexPluginSourceIsConfigControlled, captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled, projectCodexInstalledPlugins, projectCodexNativeSkillCatalog, projectCodexRemoteReceiptSnapshot } from "./codex-native-skill-catalog.js";

useDefaultTestTimeout();

const cwd = "/synthetic/project";
const vendor = { name: "vendor:deploy", path: "/synthetic/cache/vendor/3.0.0/skills/deploy/SKILL.md", enabled: false, pluginId: "vendor@probe" };
const bridge = { name: "skills-cli", path: "/synthetic/skills-cli/SKILL.md", enabled: true, pluginId: null };
const response = (skills: unknown[] = [vendor, bridge]) => ({ data: [{ cwd, skills, errors: [] }] });
const installed = { marketplaces: [{ name: "probe", plugins: [{ id: "vendor@probe", name: "vendor", installed: true, enabled: true, localVersion: "3.0.0" }] }], marketplaceLoadErrors: [] };

test("native projection preserves qualified identities and enabled states but omits opaque fields", () => {
  const raw = response([{ ...vendor, description: "untrusted diagnostic", interface: { iconLargeUrl: "untrusted" } }, bridge]);
  expect(projectCodexNativeSkillCatalog(raw, cwd)).toEqual([vendor, bridge]);
  expect(JSON.stringify(projectCodexNativeSkillCatalog(raw, cwd))).not.toContain("untrusted");
  expect(projectCodexNativeSkillCatalog(response([{ ...vendor, path: "/synthetic/a/SKILL.md" }, { ...vendor, path: "/synthetic/b/SKILL.md" }]), cwd)).toHaveLength(2);
  expect(projectCodexNativeSkillCatalog(response([]), cwd)).toEqual([]);
});

test("native projection refuses incomplete, wrong-population, malformed, or unbounded responses without rendering them", () => {
  const bad: unknown[] = [null, {}, { data: [] }, { data: [response().data[0], response().data[0]] },
    { data: [{ ...response().data[0], cwd: "/different" }] },
    { data: [{ ...response().data[0], errors: [{ message: "private diagnostic" }] }] },
    { data: [{ cwd, skills: [] }] }, response([{ ...vendor, name: "" }]), response([{ ...vendor, name: "bad\nname" }]),
    response([{ ...vendor, path: "relative/SKILL.md" }]), response([{ ...vendor, enabled: "false" }]),
    response([{ ...vendor, pluginId: {} }]), response([vendor, vendor]), response(Array(4097).fill(vendor)),
    response([{ ...vendor, name: "x".repeat(1025) }])];
  for (const value of bad) {
    expect(() => projectCodexNativeSkillCatalog(value, cwd)).toThrow("CODEX_NATIVE_SKILL_CATALOG_INVALID");
  }
});

test("installed plugin projection binds only complete exact local plugin identities", () => {
  expect(projectCodexInstalledPlugins(installed)).toEqual([{ id: "vendor@probe", name: "vendor", installed: true, enabled: true, localVersion: "3.0.0" }]);
  for (const value of [null, {}, { ...installed, marketplaceLoadErrors: [{}] },
    { marketplaces: [{ name: "probe", plugins: [{ ...installed.marketplaces[0]!.plugins[0]!, id: "other@probe" }] }], marketplaceLoadErrors: [] },
    { marketplaces: [{ name: "probe", plugins: [{ ...installed.marketplaces[0]!.plugins[0]!, enabled: "true" }] }], marketplaceLoadErrors: [] }]) {
    expect(() => projectCodexInstalledPlugins(value)).toThrow("CODEX_NATIVE_SKILL_CATALOG_INVALID");
  }
});

test("positive native source provenance distinguishes config-owned inactivity from remote overrides", () => {
  const plugin=installed.marketplaces[0]!.plugins[0]!;
  const inventory=(value:unknown,marketplace="probe")=>({marketplaces:[{name:marketplace,plugins:[value]}],marketplaceLoadErrors:[]});
  for (const source of [{type:"local",path:"/synthetic/source"},{type:"git",url:"https://example.test/synthetic.git",path:null,refName:null,sha:null},{type:"npm",package:"synthetic-plugin",version:null,registry:null}]) {
    const projected=projectCodexInstalledPlugins(inventory({...plugin,enabled:false,source}))[0]!;
    expect(projected.sourceType as string).toBe(source.type);
    expect(projected.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(codexPluginSourceIsConfigControlled(projected)).toBe(true);
    if (source.type==="local") expect(projected.sourcePath).toBe("/synthetic/source");
    else expect(projected.sourcePath).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain("example.test");
    expect(codexPluginSourceIsConfigControlled({...projected,remotePluginId:"remote_identity"})).toBe(false);
    for (const realm of ["openai-curated-remote","created-by-me-remote","workspace-directory","workspace-shared-with-me","workspace-shared-with-me-private","workspace-shared-with-me-unlisted"])
      expect(codexPluginSourceIsConfigControlled({...projected,id:`vendor@${realm}`})).toBe(false);
  }
  for (const source of [undefined,{type:"unknown"},{type:"local",path:"relative"},{type:"git"},{type:"remote"}]) {
    const projected=projectCodexInstalledPlugins(inventory({...plugin,enabled:false,source,sourceType:"local",sourceSha256:"a".repeat(64)}))[0]!;
    expect(codexPluginSourceIsConfigControlled(projected)).toBe(false);
  }
});

for (const nativeVersion of ["codex-cli 0.159.2", "codex-cli 0.160.0", "codex-cli 0.160.1", "codex-cli 0.161.0", "codex-cli 0.162.0", "codex-cli 0.162.1", "codex-cli 0.163.0"]) test(`native ${nativeVersion} capture sends only bounded reads and releases its child`, async () => {
  const calls: Array<[string, unknown]> = [];
  let closed = 0;
  const rpc: CodexHookRpc = { version: nativeVersion, request: async (method, params) => { calls.push([method, params]); return method === "skills/list" ? response() : installed; }, close: async () => { closed++; } };
  const options = { command: "codex", home: "/synthetic/home", cwd, timeoutMs: 3000 };
  let connected: unknown;
  const result = await captureCodexNativeSkillCatalog(options, async value => { connected = value; return rpc; });
  expect(connected).toEqual({ command: "codex", home: "/synthetic/home", timeoutMs: 3000 });
  expect(calls).toEqual([["skills/list", { cwds: [cwd], forceReload: true }], ["plugin/installed", { cwds: [cwd] }]]);
  expect(result).toEqual({ version: nativeVersion, cwd, skills: [vendor, bridge], plugins: [{ id: "vendor@probe", name: "vendor", installed: true, enabled: true, localVersion: "3.0.0" }],
    remoteReceipts: { schema: CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA, cacheRoot: "/synthetic/home/.codex/plugins/cache", plugins: [] } });
  expect(closed).toBe(1);
});

test("native capture closes on refused requests, validation failures, and unsupported versions", async () => {
  for (const mode of ["request", "projection", "version", "unmeasuredVersion", "unmeasuredFutureVersion"]) {
    let closed = 0, requested = 0;
    const rpc: CodexHookRpc = { version: mode === "version" ? "codex-cli 0.999.0" : mode === "unmeasuredVersion" ? "codex-cli 0.159.0" : mode === "unmeasuredFutureVersion" ? "codex-cli 0.160.2" : "codex-cli 0.159.2", request: async () => { requested++; if (mode === "request") throw new Error("NATIVE_RPC_REFUSED"); return null; }, close: async () => { closed++; } };
    await expect(captureCodexNativeSkillCatalog({ command: "codex", home: "/synthetic/home", cwd }, async () => rpc)).rejects.toThrow();
    expect(closed).toBe(1);
    expect(requested).toBe(["version", "unmeasuredVersion", "unmeasuredFutureVersion"].includes(mode) ? 0 : mode === "request" ? 1 : 2);
  }
});

for (const version of ["codex-cli 0.160.2", "codex-cli 0.161.1", "codex-cli 0.162.2", "codex-cli 0.163.1", "codex-cli 0.164.1", "codex-cli 0.165.0", "codex-cli 0.163.0-alpha.1", "codex-cli 0.163.0+build.1", "codex-cli 0.162.0-alpha.1", "codex-cli 0.162.0+build.1", "codex-cli 0.159.3", "codex-cli 0.160.1-alpha.1", "codex-cli 0.160.10", "0.160.1"])
  test(`native capture refuses the unmeasured neighbour ${JSON.stringify(version)} before any read`, async () => {
    let closed = 0, requested = 0;
    const rpc: CodexHookRpc = { version, request: async (method) => { requested++; return method === "skills/list" ? response() : installed; }, close: async () => { closed++; } };
    await expect(captureCodexNativeSkillCatalog({ command: "codex", home: "/synthetic/home", cwd }, async () => rpc)).rejects.toThrow("CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION");
    expect({ requested, closed }).toEqual({ requested: 0, closed: 1 });
  });

test("ordered exact names survive cache-path churn while preserving the bridge and path overrides", () => {
  const deny = [{ name: "vendor:deploy", enabled: false }];
  expect(isCodexNativeSkillDisabled(vendor, deny)).toBe(true);
  expect(isCodexNativeSkillDisabled({ ...vendor, path: "/synthetic/cache/vendor/4.0.0/skills/deploy/SKILL.md" }, deny)).toBe(true);
  expect(isCodexNativeSkillDisabled(bridge, deny)).toBe(false);
  expect(isCodexNativeSkillDisabled(vendor, [{ name: "deploy", enabled: false }])).toBe(false);
  expect(isCodexNativeSkillDisabled(vendor, [{ name: "vendor:*", enabled: false }])).toBe(false);
  expect(isCodexNativeSkillDisabled(vendor, [...deny, { path: vendor.path, enabled: true }])).toBe(false);
  expect(isCodexNativeSkillDisabled(vendor, [{ path: vendor.path, enabled: true }, ...deny])).toBe(true);
  expect(isCodexNativeSkillDisabled(vendor, [...deny, { name: vendor.name, enabled: true }])).toBe(false);
  expect(isCodexNativeSkillDisabled(vendor, [{ name: "  vendor:deploy  ", enabled: false, unrelated: "preserved" }])).toBe(true);
});

test("rule projection refuses ambiguous controls instead of claiming effective native suppression", () => {
  for (const rules of [[{ name: vendor.name, path: vendor.path, enabled: false }], [{ enabled: false }], [{ name: "", enabled: false }], [{ name: vendor.name, enabled: "false" }], [{ path: "relative", enabled: false }], {}]) {
    expect(() => isCodexNativeSkillDisabled(vendor, rules)).toThrow("CODEX_NATIVE_SKILL_CATALOG_INVALID");
  }
  expect(isCodexNativeSkillDisabled(vendor, undefined)).toBe(false);
});


test("remote inventory retains only native installation identity and never advertised release or source URLs", () => {
 const remotePluginId="plugins~Plugin_00000000000000000000000000000001";
 const plugin={id:"pages@openai-curated-remote",name:"pages",installed:true,enabled:true,localVersion:null,remotePluginId,source:{type:"remote",url:"opaque"},version:"99.0.0",description:"opaque",shareUrl:"opaque"};
 const inventory=(value:unknown)=>({marketplaces:[{name:"openai-curated-remote",plugins:[value]}],marketplaceLoadErrors:[]});
 expect(projectCodexInstalledPlugins(inventory(plugin))).toEqual([{id:plugin.id,name:plugin.name,installed:true,enabled:true,localVersion:null,remotePluginId,sourceType:"remote"}]);
 expect(JSON.stringify(projectCodexInstalledPlugins(inventory(plugin)))).not.toContain("opaque");
 expect(JSON.stringify(projectCodexInstalledPlugins(inventory(plugin)))).not.toContain("99.0.0");
 expect(projectCodexInstalledPlugins(inventory({...plugin,source:{type:"git"},sourceType:"remote"}))[0]?.sourceType).toBeUndefined();
 for (const remotePluginId of ["bad.identity", "https://opaque.example/identity", "bad\nidentity", {}, "", "x".repeat(1025)])
  expect(()=>projectCodexInstalledPlugins(inventory({...plugin,remotePluginId}))).toThrow("CATALOG_INVALID");
});


test("0.162.1 compatibility never converts a transport admission refusal into a catalog", async () => {
  let connected = 0;
  await expect(captureCodexNativeSkillCatalog({ command: "codex", home: "/synthetic/home", cwd }, async () => {
    connected++;
    throw new Error("CODEX_CORPUS_ADMISSION_REQUIRED");
  })).rejects.toThrow("CODEX_CORPUS_ADMISSION_REQUIRED");
  expect(connected).toBe(1);
});

// Synthetic fixtures only, under the test TMPDIR, removed with it.
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const receiptText = (id: string) => JSON.stringify({ schema_version: 1, remote_plugin_id: id });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("capture reads every remote install receipt before it starts Codex, whose app-server then rewrites them", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-receipt-snapshot-")); homes.push(home);
  const cache = join(home, ".codex/plugins/cache"), parent = (plugin: string) => join(cache, "openai-curated-remote", plugin);
  const receipt = (plugin: string) => join(parent(plugin), ".codex-remote-plugin-install.json");
  for (const plugin of ["templates", "pages", "sites", "docs", "decks"]) mkdirSync(parent(plugin), { recursive: true });
  mkdirSync(join(cache, "local-market/notes"), { recursive: true });
  writeFileSync(receipt("pages"), receiptText("plugins~Stale_0001"));
  const duplicate = '{"schema_version":1,"remote_plugin_id":"plugins~A","remote_plugin_id":"plugins~B"}';
  writeFileSync(receipt("sites"), duplicate);
  writeFileSync(join(home, "elsewhere.json"), receiptText("plugins~Aliased_0001")); symlinkSync(join(home, "elsewhere.json"), receipt("docs"));
  writeFileSync(receipt("decks"), receiptText("plugins~Current_0005"));
  const rpc: CodexHookRpc = { version: "codex-cli 0.163.0", request: async method => method === "skills/list" ? response() : installed, close: async () => {} };
  const result = await captureCodexNativeSkillCatalog({ command: "codex", home, cwd }, async () => {
    // What starting the app-server does: every remote plugin's receipt is rewritten to its own state.
    for (const plugin of ["templates", "pages", "sites", "docs", "decks"]) { rmSync(receipt(plugin), { force: true }); writeFileSync(receipt(plugin), receiptText(`plugins~Healed_${plugin}`)); }
    return rpc;
  });
  const snapshot = result.remoteReceipts!;
  expect(snapshot.schema).toBe(CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA);
  expect(snapshot.cacheRoot).toBe(cache);
  const byId = Object.fromEntries(snapshot.plugins.map(item => [item.pluginId, item]));
  expect(Object.keys(byId).sort()).toEqual(["decks@openai-curated-remote", "docs@openai-curated-remote", "notes@local-market", "pages@openai-curated-remote", "sites@openai-curated-remote", "templates@openai-curated-remote"]);
  expect(byId["templates@openai-curated-remote"]).toEqual({ pluginId: "templates@openai-curated-remote", receipt: "absent" });
  expect(byId["notes@local-market"]).toEqual({ pluginId: "notes@local-market", receipt: "absent" });
  expect(byId["pages@openai-curated-remote"]).toMatchObject({ receipt: "present", sha256: sha(receiptText("plugins~Stale_0001")), remotePluginId: "plugins~Stale_0001" });
  expect(byId["sites@openai-curated-remote"]).toMatchObject({ receipt: "present", sha256: sha(duplicate), remotePluginId: null });
  expect(byId["docs@openai-curated-remote"]).toMatchObject({ receipt: "present", sha256: null, remotePluginId: null });
  expect(byId["decks@openai-curated-remote"]).toMatchObject({ receipt: "present", remotePluginId: "plugins~Current_0005" });
  for (const item of snapshot.plugins) if (item.receipt === "present") expect(Number.isFinite(item.mtimeMs)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("Healed");
  // The same reader, called now, observes only the healed state.
  expect(captureCodexRemoteReceiptSnapshot(cache).plugins.filter(item => item.receipt === "present").map(item => item.receipt === "present" && item.remotePluginId)).toEqual(["plugins~Healed_decks", "plugins~Healed_docs", "plugins~Healed_pages", "plugins~Healed_sites", "plugins~Healed_templates"]);
});

test("an embedded receipt snapshot is validated exactly when a review consumes it", () => {
  const valid = { schema: CODEX_REMOTE_RECEIPT_SNAPSHOT_SCHEMA, cacheRoot: "/synthetic/cache", plugins: [{ pluginId: "pages@openai-curated-remote", receipt: "absent" }, { pluginId: "sites@openai-curated-remote", receipt: "present", sha256: "a".repeat(64), remotePluginId: "plugins~Sites", mtimeMs: 1 }] };
  expect(projectCodexRemoteReceiptSnapshot(valid) as unknown).toEqual(valid);
  for (const bad of [undefined, null, [], { ...valid, schema: "hasna.skills-codex-remote-receipts.v2" }, { ...valid, cacheRoot: "relative" }, { ...valid, extra: true },
    { ...valid, plugins: [valid.plugins[0], valid.plugins[0]] }, { ...valid, plugins: [{ pluginId: "pages", receipt: "absent" }] },
    { ...valid, plugins: [{ ...valid.plugins[0], sha256: null }] }, { ...valid, plugins: [{ ...valid.plugins[1], remotePluginId: "bad.id" }] },
    { ...valid, plugins: [{ ...valid.plugins[1], sha256: "A".repeat(64) }] }, { ...valid, plugins: [{ ...valid.plugins[1], mtimeMs: "1" }] },
    { ...valid, plugins: [{ pluginId: "sites@openai-curated-remote", receipt: "present", sha256: null, remotePluginId: null }] }, { ...valid, plugins: [{ pluginId: "x@y", receipt: "unknown" }] }])
    expect(projectCodexRemoteReceiptSnapshot(bad)).toBeNull();
});
