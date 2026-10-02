import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import type { CodexHookRpc } from "./codex-hook-rpc.js";
import { captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled, projectCodexInstalledPlugins, projectCodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";

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

for (const nativeVersion of ["codex-cli 0.159.2", "codex-cli 0.160.0"]) test(`native ${nativeVersion} capture sends only bounded reads and releases its child`, async () => {
  const calls: Array<[string, unknown]> = [];
  let closed = 0;
  const rpc: CodexHookRpc = { version: nativeVersion, request: async (method, params) => { calls.push([method, params]); return method === "skills/list" ? response() : installed; }, close: async () => { closed++; } };
  const options = { command: "codex", home: "/synthetic/home", cwd, timeoutMs: 3000 };
  let connected: unknown;
  const result = await captureCodexNativeSkillCatalog(options, async value => { connected = value; return rpc; });
  expect(connected).toEqual({ command: "codex", home: "/synthetic/home", timeoutMs: 3000 });
  expect(calls).toEqual([["skills/list", { cwds: [cwd], forceReload: true }], ["plugin/installed", { cwds: [cwd] }]]);
  expect(result).toEqual({ version: nativeVersion, cwd, skills: [vendor, bridge], plugins: [{ id: "vendor@probe", name: "vendor", installed: true, enabled: true, localVersion: "3.0.0" }] });
  expect(closed).toBe(1);
});

test("native capture closes on refused requests, validation failures, and unsupported versions", async () => {
  for (const mode of ["request", "projection", "version", "unmeasuredVersion", "unmeasuredFutureVersion"]) {
    let closed = 0, requested = 0;
    const rpc: CodexHookRpc = { version: mode === "version" ? "codex-cli 0.999.0" : mode === "unmeasuredVersion" ? "codex-cli 0.159.0" : mode === "unmeasuredFutureVersion" ? "codex-cli 0.160.1" : "codex-cli 0.159.2", request: async () => { requested++; if (mode === "request") throw new Error("NATIVE_RPC_REFUSED"); return null; }, close: async () => { closed++; } };
    await expect(captureCodexNativeSkillCatalog({ command: "codex", home: "/synthetic/home", cwd }, async () => rpc)).rejects.toThrow();
    expect(closed).toBe(1);
    expect(requested).toBe(["version", "unmeasuredVersion", "unmeasuredFutureVersion"].includes(mode) ? 0 : mode === "request" ? 1 : 2);
  }
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
