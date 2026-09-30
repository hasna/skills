import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import type { CodexHookRpc } from "./codex-hook-rpc.js";
import { captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled, projectCodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";

useDefaultTestTimeout();

const cwd = "/synthetic/project";
const vendor = { name: "vendor:deploy", path: "/synthetic/cache/vendor/3.0.0/skills/deploy/SKILL.md", enabled: false, pluginId: "vendor@probe" };
const bridge = { name: "skills-cli", path: "/synthetic/skills-cli/SKILL.md", enabled: true, pluginId: null };
const response = (skills: unknown[] = [vendor, bridge]) => ({ data: [{ cwd, skills, errors: [] }] });

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

test("native capture sends only the bounded read request and releases its child", async () => {
  const calls: Array<[string, unknown]> = [];
  let closed = 0;
  const rpc: CodexHookRpc = { version: "codex-cli 0.159.2", request: async (method, params) => { calls.push([method, params]); return response(); }, close: async () => { closed++; } };
  const options = { command: "codex", home: "/synthetic/home", cwd, timeoutMs: 3000 };
  let connected: unknown;
  const result = await captureCodexNativeSkillCatalog(options, async value => { connected = value; return rpc; });
  expect(connected).toEqual({ command: "codex", home: "/synthetic/home", timeoutMs: 3000 });
  expect(calls).toEqual([["skills/list", { cwds: [cwd], forceReload: true }]]);
  expect(result).toEqual({ version: "codex-cli 0.159.2", cwd, skills: [vendor, bridge] });
  expect(closed).toBe(1);
});

test("native capture closes on refused requests, validation failures, and unsupported versions", async () => {
  for (const mode of ["request", "projection", "version", "unmeasuredVersion"]) {
    let closed = 0, requested = 0;
    const rpc: CodexHookRpc = { version: mode === "version" ? "codex-cli 0.999.0" : mode === "unmeasuredVersion" ? "codex-cli 0.159.0" : "codex-cli 0.159.2", request: async () => { requested++; if (mode === "request") throw new Error("NATIVE_RPC_REFUSED"); return null; }, close: async () => { closed++; } };
    await expect(captureCodexNativeSkillCatalog({ command: "codex", home: "/synthetic/home", cwd }, async () => rpc)).rejects.toThrow();
    expect(closed).toBe(1);
    expect(requested).toBe(mode === "version" || mode === "unmeasuredVersion" ? 0 : 1);
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
