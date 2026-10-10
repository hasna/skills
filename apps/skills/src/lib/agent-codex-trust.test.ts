import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { useDefaultTestTimeout, withoutDataDirOverrideEnv } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync, linkSync, cpSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, planAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { enrollCodexNativeHooks, reconcileCodexNativeHooks } from "./agent-codex-trust.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { assertCodexHookDiscoveryRecovery, createCodexHookDiscoveryRecovery } from "./codex-hook-discovery-recovery.js";
import { captureDiscoveryByteSources } from "./agent-discovery.js";
import { snapshot } from "./codex-hook-trust-files.js";

const roots: string[] = [];
const initialPath = process.env.PATH;
beforeEach(() => { installCorpusInspectorFixture(); });
afterEach(() => { process.env.PATH = initialPath; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = `sha256:${"a".repeat(64)}`;
function intentFor(f: ReturnType<typeof fixture>, plan: any, hooksText: Buffer, policyText: Buffer) {
  const declarations = f.entries.map((entry: any) => ({ event: entry.eventName, key: entry.key, command: entry.command }));
  const nativeHooks = f.entries.map((hook: any) => ({ key: hook.key, eventName: hook.eventName, handlerType: hook.handlerType, command: hook.command, matcher: hook.matcher, timeoutSec: hook.timeoutSec, async: hook.async, statusMessage: hook.statusMessage, additionalContextLimit: hook.additionalContextLimit, sourcePath: hook.sourcePath, source: hook.source, pluginId: hook.pluginId, isManaged: hook.isManaged, currentHash: hook.currentHash, enabled: hook.enabled, trustStatus: hook.trustStatus }));
  return { version: 1, home: f.home, planDigest: plan.planDigest, skillsCli: plan.skillsCli, nativeVersion: "codex-cli 0.154.0", configPath: f.configPath, ...(plan.nativeConfigPath && plan.nativeConfigPath !== f.configPath ? { nativeConfigPath: plan.nativeConfigPath } : {}), configSha256: createHash("sha256").update(f.before).digest("hex"), configVersion: `sha256:${"b".repeat(64)}`, hooksSha256: createHash("sha256").update(hooksText).digest("hex"), policySha256: createHash("sha256").update(policyText).digest("hex"), declarations, admitted: plan.planned, hooks: plan.planned, nativeHooks };
}
function fixture(extraConfig = "", rootAlias = false, includeInstructionsHook = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-native-trust-")); roots.push(home);
  const dataDir = join(home, ".hasna/skills"), root = rootAlias ? join(home, ".hasna/projects/workspaces/selected/.codex") : join(home, ".codex"), command = join(home, "bin/skills");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  admitCorpusFixture(root);
  if (rootAlias) symlinkSync(root, join(home, ".codex"));
  const packageDir = join(home, "package"), cli = join(packageDir, "bin/index.js");
  mkdirSync(join(packageDir, "bin"), { recursive: true, mode: 0o700 }); mkdirSync(join(home, "bin"), { mode: 0o700 });
  writeFileSync(cli, "#!/usr/bin/env bun\n// Synthetic published CLI fixture\n", { mode: 0o700 });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.8.9", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  symlinkSync(cli, command); process.env.PATH = join(home, "bin") + ":" + process.env.PATH;
  const reviewedSkillsCli = { path: command, version: "0.8.9", sha256: createHash("sha256").update(readFileSync(cli)).digest("hex") };
  const configPath = join(root, "config.toml"), hooksPath = join(root, "hooks.json");
  writeFileSync(configPath, '# preserve this comment\nmodel = "synthetic"\n' + extraConfig, { mode: 0o600 });
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["codex"], command, profileId: "synthetic", allowRootAliases: rootAlias }));
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  const names = { UserPromptSubmit: "user_prompt_submit", SessionStart: "session_start", SubagentStart: "subagent_start" };
  const events = { UserPromptSubmit: "userPromptSubmit", SessionStart: "sessionStart", SubagentStart: "subagentStart" };
  const defaultHooksPath = join(home, ".codex/hooks.json");
  const entries: any[] = Object.entries(hooks.hooks).map(([event, groups]: [string, any]) => ({ key: `${defaultHooksPath}:${names[event as keyof typeof names]}:0:0`, eventName: events[event as keyof typeof events], handlerType: "command", command: groups[0].hooks[0].command, async: false, matcher: null as string | null, timeoutSec: 15, statusMessage: null, additionalContextLimit: null, sourcePath: defaultHooksPath, source: "user", pluginId: null, displayOrder: 0, enabled: false, isManaged: false, currentHash: hash, trustStatus: "trusted" }));
  const instructionHook = { key: `${join(home, ".codex/config.toml")}:session_start:0:0`, eventName: "sessionStart", handlerType: "command", command: "instructions session project-hook --scope-root /fixture/workspaces", async: false, matcher: null, timeoutSec: 120, statusMessage: null, additionalContextLimit: 0, sourcePath: configPath, source: "user", pluginId: null, displayOrder: 0, enabled: true, isManaged: false, currentHash: `sha256:${"e".repeat(64)}`, trustStatus: "trusted" };
  const canonicalTrust = rootAlias ? entries.map(h => `\n[hooks.state.${JSON.stringify(h.key.replace(defaultHooksPath, hooksPath))}]\nenabled = true # preserve canonical identity\ntrusted_hash = ${JSON.stringify(hash)}\n`).join("") : "";
  const instructionTrust = includeInstructionsHook ? `\n[hooks.state.${JSON.stringify(instructionHook.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(instructionHook.currentHash)}\n` : "";
  const before = readFileSync(configPath, "utf8") + '\n[hooks.state."unrelated"]\nenabled = false # preserve unrelated\ntrusted_hash = "sha256:unrelated"\n' + instructionTrust + entries.map(h => `\n[hooks.state.${JSON.stringify(h.key)}]\nenabled = false # preserve managed comment\ntrusted_hash = ${JSON.stringify(hash)}\n`).join("") + canonicalTrust;
  writeFileSync(configPath, before); chmodSync(configPath, 0o600);
  const calls: Array<{ method: string; params: any }> = [];
  let mode = "success", closed = false;
  const nativeHomes: Array<string | undefined> = [];
  const connect = async (options: { codexHome?: string } = {}) => {
    nativeHomes.push(options.codexHome);
    const nativeRoot = options.codexHome === undefined ? join(home, ".codex") : root;
    const nativeConfigPath = join(nativeRoot, "config.toml");
    return ({
    version: "codex-cli 0.154.0",
    async request(method: string, params: any) {
      calls.push({ method, params });
      if (method === "hooks/list") {
        const items = structuredClone(entries);
        if (rootAlias) {
          const state = (Bun.TOML.parse(readFileSync(configPath, "utf8")) as any).hooks.state;
          for (const item of items) {
            item.key = item.key.replace(defaultHooksPath, join(nativeRoot, "hooks.json"));
            item.sourcePath = join(nativeRoot, "hooks.json");
            item.enabled = Object.hasOwn(state, item.key) ? state[item.key]?.enabled ?? true : item.enabled;
            item.trustStatus = state[item.key]?.trusted_hash === item.currentHash ? "trusted" : "modified";
          }
        }
        if (includeInstructionsHook) items.push(structuredClone(instructionHook));
        if (mode === "extraNative") items.push({ ...items[0], key: "unmanaged-extra", command: "echo unrelated" });
        if (mode === "modified" && !items[0]!.enabled) items[0]!.trustStatus = "modified";
        if (mode === "missing") items.pop();
        if (mode === "unknownTrust") items[0]!.trustStatus = "new-native-status";
        if (mode === "changedHash") items[0]!.currentHash = `sha256:${"c".repeat(64)}`;
        if (mode === "duplicateCommand") items.push({ ...items[0], key: "unmanaged-duplicate" });
        if (mode === "duplicate") items.push(items[0]!);
        if (mode === "changedCommand") items[0]!.command += " --changed";
        const nativeRoots = [...new Set([root, join(home, ".codex")])];
        const knownCoexistenceWarning = `loading hooks from both ${join(nativeRoots[0]!, "hooks.json")} and ${join((rootAlias ? nativeRoots[1] : nativeRoots[0])!, "config.toml")}; prefer a single representation for this layer`;
        const warnings = mode === "coexistenceWarning" ? [knownCoexistenceWarning]
          : mode === "foreignWarning" ? [`loading hooks from both ${join(home, "foreign/hooks.json")} and ${join(home, "foreign/config.toml")}; prefer a single representation for this layer`]
          : mode === "multipleWarnings" ? [knownCoexistenceWarning, "unrelated discovery warning"] : [];
        const errors = mode === "discoveryError" ? ["synthetic native discovery error"] : [];
        return { data: [{ cwd: home, hooks: items, warnings, errors }] };
      }
      if (method === "config/read") {
        const config = Bun.TOML.parse(readFileSync(configPath, "utf8"));
        if (mode === "wrappedNumbers" || mode === "changedWrappedNumber") {
          const desktop = (config as any).desktop;
          desktop.sansFontSize = { "$serde_json::private::Number": mode === "changedWrappedNumber" ? "15" : String(desktop.sansFontSize) };
          desktop.codeFontSize = { "$serde_json::private::Number": String(desktop.codeFontSize) };
        }
        const layer = { name: { type: "user", file: nativeConfigPath }, version: `sha256:${"b".repeat(64)}`, config };
        if (mode === "override") return { config, layers: [{ name: { type: "sessionFlags" }, config: { hooks: { state: {} } } }, layer] };
        if (mode === "disabled") return { config: { features: { hooks: false } }, layers: [layer] };
        return { config, layers: [layer] };
      }
      if (method === "config/batchWrite") {
        if (mode === "writeOverride") return { status: "okOverridden", filePath: configPath };
        if (mode === "conflict") throw new Error("Native response may contain sensitive configuration");
        expect(params.expectedVersion).toBe(`sha256:${"b".repeat(64)}`); expect(params.filePath).toBe(configPath); expect(params.reloadUserConfig).toBe(true);
        expect(params.edits).toEqual([{ keyPath: "hooks.state", mergeStrategy: "upsert", value: Object.fromEntries(entries.map(h => [h.key, { enabled: true, trusted_hash: hash }])) }]);
        writeFileSync(configPath, readFileSync(configPath, "utf8").replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"));
        if (mode === "reorder") {
          const text = readFileSync(configPath, "utf8"), bundled = text.indexOf("[skills.bundled]");
          const block = text.slice(bundled).trim();
          const without = text.slice(0, bundled).trimEnd();
          writeFileSync(configPath, without + "\n\n" + block + "\n");
        }
        if (mode === "arrayReorder") {
          const text = readFileSync(configPath, "utf8"), headers = [...text.matchAll(/^[ \t]*(\[\[?[^\r\n]+\]\]?)[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm)];
          const bundled = headers.findIndex(header => header[1] === "[skills.bundled]"), array = headers.findIndex(header => header[1]?.startsWith("[["));
          expect(bundled).toBeGreaterThanOrEqual(0); expect(array).toBeGreaterThanOrEqual(0);
          const blocks = headers.map((header, index) => text.slice(header.index!, headers[index + 1]?.index ?? text.length));
          [blocks[bundled], blocks[array]] = [blocks[array]!, blocks[bundled]!];
          writeFileSync(configPath, text.slice(0, headers[0]!.index!) + blocks.join("").trimEnd() + "\n");
        }
        if (mode === "array") writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n[[fruits]]\nname = \"apple\"\n[[fruits]]\nname = \"pear\"\n");
        if (mode === "nested") writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n[parent]\nvalue = \"one\"\n[parent.child]\nvalue = \"two\"\n");
        for (const entry of entries) entry.enabled = true;
        return { status: "ok", filePath: configPath, version: `sha256:${"d".repeat(64)}` };
      }
      throw new Error("Unexpected synthetic RPC");
    },
    async close() { closed = true; },
  }); };
  return { home, dataDir, reviewedSkillsCli, cli, command, configPath, hooksPath, entries, instructionHook, before, calls, nativeHomes, connect, setMode: (value: string) => { mode = value; }, isClosed: () => closed };
}

test("native numeric wrappers permit exact enrollment without changing desktop settings", async () => {
  const f = fixture("\n[desktop]\nsansFontSize = 14.0\ncodeFontSize = 13.0\n");
  f.setMode("wrappedNumbers");
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect(plan.planned).toHaveLength(3);
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(applied.nativeEligible).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toContain("sansFontSize = 14.0\ncodeFontSize = 13.0");
});

test("a genuinely different wrapped native number still refuses before writing", async () => {
  const f = fixture("\n[desktop]\nsansFontSize = 14.0\ncodeFontSize = 13.0\n");
  f.setMode("changedWrappedNumber");
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("NATIVE_CONFIG_MISMATCH");
  expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

for (const changedOnFinalRead of [false, true]) test(`reconciliation ${changedOnFinalRead ? "refuses a changed" : "accepts an equal"} wrapped number on the final native read`, async () => {
  const f = fixture("\n[desktop]\nsansFontSize = 14.0\ncodeFontSize = 13.0\n");
  f.setMode("wrappedNumbers");
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  const journal = (applied as any).journal;
  rmSync(join(journal, "receipt.json"));
  writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  const before = readFileSync(f.configPath, "utf8");
  f.calls.length = 0;
  let reads = 0;
  const connect = async () => {
    const rpc = await f.connect();
    return { ...rpc, async request(method: string, params: any) {
      const result = await rpc.request(method, params);
      if (method === "config/read" && ++reads === 2 && changedOnFinalRead) {
        (result as any).layers[0].config.desktop.sansFontSize = { "$serde_json::private::Number": "15" };
      }
      return result;
    } };
  };
  if (changedOnFinalRead) {
    await expect(reconcileCodexNativeHooks({ ...f, journal }, connect)).rejects.toThrow("RECONCILE_NATIVE_CONFIG_CHANGED");
    expect(existsSync(join(journal, "receipt.json"))).toBe(false);
  } else {
    const receipt = await reconcileCodexNativeHooks({ ...f, journal }, connect);
    expect(receipt.reconciled).toBe(true);
    expect(receipt.nativeStateVerified).toBe(true);
  }
  expect(reads).toBe(2);
  expect(f.calls.map(call => call.method)).toEqual(["hooks/list", "config/read", "hooks/list", "config/read"]);
  expect(readFileSync(f.configPath, "utf8")).toBe(before);
});

test("native trust preserves the default native root identity for an admitted home alias", async () => {
  const f = fixture("", true);
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect(f.nativeHomes).toEqual([undefined]);
  expect(plan.nativeConfigPath).toBe(join(f.home, ".codex/config.toml"));
  expect(plan.planned).toHaveLength(3);
  expect(plan.planned.every(hook => hook.key.startsWith(join(f.home, ".codex/hooks.json") + ":"))).toBe(true);
  expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("aliased native apply preserves canonical trust and records the lexical view for reconciliation", async () => {
  const f = fixture("", true), plan = await enrollCodexNativeHooks(f, f.connect);
  const before = Bun.TOML.parse(f.before) as any;
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(applied.nativeEligible).toBe(true);
  const after = Bun.TOML.parse(readFileSync(f.configPath, "utf8")) as any;
  for (const [key, value] of Object.entries(before.hooks.state)) if (key.startsWith(f.hooksPath + ":")) expect(after.hooks.state[key]).toEqual(value);
  expect((await enrollCodexNativeHooks(f, f.connect)).planned).toHaveLength(0);
  const journal = (applied as any).journal;
  const intent = JSON.parse(readFileSync(join(journal, "intent.json"), "utf8"));
  expect(intent.configPath).toBe(f.configPath);
  expect(intent.nativeConfigPath).toBe(join(f.home, ".codex/config.toml"));
  rmSync(join(journal, "receipt.json"));
  writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  const beforeReconcile = readFileSync(f.configPath, "utf8"), writes = f.calls.filter(call => call.method === "config/batchWrite").length;
  expect((await reconcileCodexNativeHooks({ ...f, journal }, f.connect)).nativeStateVerified).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toBe(beforeReconcile);
  expect(f.calls.filter(call => call.method === "config/batchWrite")).toHaveLength(writes);
});
test("an explicitly selected admitted canonical native root remains a separate trust view", async () => {
  const f = fixture("", true), codexHome = join(f.home, ".hasna/projects/workspaces/selected/.codex");
  const plan = await enrollCodexNativeHooks({ ...f, codexHome }, f.connect);
  expect(f.nativeHomes).toEqual([codexHome]);
  expect(plan.nativeConfigPath).toBe(f.configPath);
  expect(plan.nativeEligible).toBe(true);
  expect(plan.planned).toHaveLength(0);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("an unadmitted native root is refused before native discovery", async () => {
  const f = fixture("", true);
  await expect(enrollCodexNativeHooks({ ...f, codexHome: join(f.home, "other") }, f.connect)).rejects.toThrow("NATIVE_HOME_NOT_ADMITTED");
  expect(f.nativeHomes).toHaveLength(0);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("changing native root invalidates a reviewed alias plan before any write", async () => {
  const f = fixture("", true), plan = await enrollCodexNativeHooks(f, f.connect);
  await expect(enrollCodexNativeHooks({ ...f, codexHome: join(f.home, ".hasna/projects/workspaces/selected/.codex"), apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("PLAN_CHANGED");
  expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

const nativeTestCommand = process.env.HASNA_SKILLS_NATIVE_CODEX_TEST;
test.skipIf(!nativeTestCommand)("real native Codex enrolls the default alias identities through canonical-file CAS", async () => {
  const f = fixture("", true);
  const connect = (options: Parameters<typeof connectCodexHookRpc>[0]) => connectCodexHookRpc({ ...options, command: nativeTestCommand! });
  const plan = await enrollCodexNativeHooks(f, connect);
  expect(plan.nativeConfigPath).toBe(join(f.home, ".codex/config.toml"));
  expect(plan.planned).toHaveLength(3);
  expect(plan.planned.every(hook => hook.key.startsWith(join(f.home, ".codex/hooks.json") + ":"))).toBe(true);
  const before = Bun.TOML.parse(f.before) as any;
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, connect);
  expect(applied.nativeEligible).toBe(true);
  const after = Bun.TOML.parse(readFileSync(f.configPath, "utf8")) as any;
  for (const [key, value] of Object.entries(before.hooks.state)) if (key.startsWith(f.hooksPath + ":")) expect(after.hooks.state[key]).toEqual(value);
  expect((await enrollCodexNativeHooks(f, connect)).planned).toHaveLength(0);
});

test("native trust dry run identifies disabled exact owned hooks without writing", async () => {
  const f = fixture(); const result = await enrollCodexNativeHooks(f, f.connect);
  expect(result.applied).toBe(false); expect(result.planned).toHaveLength(3); expect(result.existingSessionsReloaded).toBe(false);
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before); expect(f.isClosed()).toBe(true);
});
for (const rootAlias of [false, true]) test(`native trust accepts only the exact dual user hook representation warning (rootAlias=${rootAlias})`, async () => {
  const f = fixture("", rootAlias); f.setMode("coexistenceWarning");
  const result = await enrollCodexNativeHooks(f, f.connect);
  expect(result.applied).toBe(false); expect(result.planned).toHaveLength(3);
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("native trust apply preserves another app's SessionStart hook in config.toml when the exact coexistence warning is present", async () => {
  const instructionConfig = `\n[hooks]\nSessionStart = [{ hooks = [{ type = "command", command = "instructions session project-hook --scope-root /fixture/workspaces", timeout = 120, additionalContextLimit = 0 }] }]\n`;
  const f = fixture(instructionConfig, false, true); f.setMode("coexistenceWarning");
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toContain('command = "instructions session project-hook --scope-root /fixture/workspaces"');
  const after = Bun.TOML.parse(readFileSync(f.configPath, "utf8")) as any;
  expect(after.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: f.instructionHook.command, timeout: 120, additionalContextLimit: 0 }] }]);
  expect(after.hooks.state[f.instructionHook.key]).toEqual({ enabled: true, trusted_hash: f.instructionHook.currentHash });
  expect(f.calls.filter(c => c.method === "hooks/list").length).toBeGreaterThanOrEqual(3);
});
for (const mode of ["foreignWarning", "multipleWarnings", "discoveryError"]) test(`native trust refuses non-admitted native discovery diagnostics (${mode})`, async () => {
  const f = fixture("", true); f.setMode(mode);
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_NATIVE_DISCOVERY_REFUSED");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("native trust accepts Codex table reordering while preserving unrelated config", async () => {
  const f = fixture(); f.setMode("reorder"); const plan = await enrollCodexNativeHooks(f, f.connect);
  const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toContain("preserve unrelated");
});
test("native trust accepts a simple table move across an unchanged array-of-tables run", async () => {
  const f = fixture('\n[[codex.unrelated]]\npath = "/fixture/unrelated/SKILL.md"\nenabled = false\n');
  f.setMode("arrayReorder"); const plan = await enrollCodexNativeHooks(f, f.connect);
  const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toContain('path = "/fixture/unrelated/SKILL.md"');
});
test("native CAS enrollment preserves other trust/comments and becomes idempotent", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true); expect(result.existingSessionsReloaded).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toContain('enabled = false # preserve unrelated');
  expect(readFileSync(f.configPath, "utf8")).toContain('# preserve this comment');
  expect((await enrollCodexNativeHooks(f, f.connect)).planned).toHaveLength(0);
});
for (const layout of ["array", "nested"]) test(`native trust fails closed for ${layout} table layouts`, async () => {
  const f = fixture(); f.setMode(layout); const plan = await enrollCodexNativeHooks(f, f.connect);
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST");
});
for (const [mode, error] of Object.entries({ duplicate: "AMBIGUOUS_IDENTITY", duplicateCommand: "AMBIGUOUS_IDENTITY", changedCommand: "NATIVE_IDENTITY_CHANGED", missing: "AMBIGUOUS_IDENTITY", unknownTrust: "UNKNOWN_TRUST_STATUS", override: "NATIVE_CONFIG_OVERRIDDEN", disabled: "NATIVE_HOOKS_DISABLED" })) test(`refuses ${mode} native identities before write`, async () => {
  const f = fixture(); f.setMode(mode);
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow(`CODEX_HOOK_TRUST_${error}`);
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("native errors never expose configuration-bearing responses", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); f.setMode("conflict");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_NATIVE_WRITE_FAILED");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});


test("reviewed modified managed hooks enroll with their current native hashes", async () => {
  const f = fixture(); f.setMode("modified");
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect(plan.planned[0]!.trustStatus).toBe("modified");
  expect((await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).nativeEligible).toBe(true);
});
for (const drift of ["changedHash", "config", "cli", "digest"]) test(`reviewed plan refuses ${drift} drift before write`, async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect);
  if (drift === "changedHash") f.setMode(drift);
  if (drift === "config") writeFileSync(f.configPath, f.before + "\n# concurrent edit\n");
  if (drift === "cli") writeFileSync(f.cli, readFileSync(f.cli, "utf8") + "// changed CLI\n");
  const before = readFileSync(f.configPath, "utf8");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: drift === "digest" ? "0".repeat(64) : plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(before);
});
test("native override status stops and leaves an incomplete reconciliation journal", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); f.setMode("writeOverride");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("NATIVE_WRITE_OVERRIDDEN");
  f.setMode("success");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("RECONCILE_REQUIRED");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

test("native reconciliation resolves an effective partial write only after native readback", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "11111111-1111-4111-8111-111111111111");
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 });
  writeFileSync(join(journal, "stopped.json"), JSON.stringify({ error: "CODEX_HOOK_TRUST_PRESERVATION_FAILED", automaticRollback: false, reconcileBeforeRetry: true }) + "\n", { mode: 0o600 });
  const configAfter = f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"); writeFileSync(f.configPath, configAfter, { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex"), expectedVersion: `sha256:${"b".repeat(64)}` }) + "\n", { mode: 0o600 });
  const receipt = await reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, codexCommand: "codex", journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect);
  expect(receipt.reconciled).toBe(true); const saved = JSON.parse(readFileSync(join(journal, "receipt.json"), "utf8")); expect(saved.nativeStateVerified).toBe(true); expect(saved.nativeExecutionVerified).toBe(false); expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
});

test("native reconciliation supersedes a stale journal only for an exact Codex binding migration", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "77777777-7777-4777-8777-777777777777");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex") }) + "\n", { mode: 0o600 });
  const currentPackage = join(f.home, "package-current"), currentCli = join(currentPackage, "bin/index.js"), currentCommand = join(f.home, "bin/skills-current");
  mkdirSync(join(currentPackage, "bin"), { recursive: true, mode: 0o700 }); writeFileSync(currentCli, "#!/usr/bin/env bun\n// Synthetic current published CLI fixture\n", { mode: 0o700 });
  writeFileSync(join(currentPackage, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.9.7", bin: { skills: "bin/index.js" } }), { mode: 0o600 }); symlinkSync(currentCli, currentCommand); rmSync(f.command); symlinkSync(currentCli, f.command);
  const currentCliWitness = { path: currentCommand, version: "0.9.7", sha256: createHash("sha256").update(readFileSync(currentCli)).digest("hex") };
  const policy = JSON.parse(policyText.toString()); policy.bridge.commands.codex = currentCommand; writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const hooks = JSON.parse(hooksText.toString()); for (const groups of Object.values(hooks.hooks) as any[]) groups[0].hooks[0].command = groups[0].hooks[0].command.replace(f.command, currentCommand); writeFileSync(f.hooksPath, JSON.stringify(hooks), { mode: 0o600 });
  for (const entry of f.entries) { entry.command = entry.command.replace(f.command, currentCommand); entry.enabled = true; entry.trustStatus = "modified"; }
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"), { mode: 0o600 });
  const artifactRoot = join(f.home, "artifact-root"), packageArtifact = join(artifactRoot, "package"), tarPath = join(f.home, "skills-0.9.7.tgz");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); cpSync(currentPackage, packageArtifact, { recursive: true });
  execFileSync("tar", ["-czf", tarPath, "-C", artifactRoot, "package"]); const tarBytes = readFileSync(tarPath);
  const releaseProof = { packageTarPath: tarPath, packageTarSha256: createHash("sha256").update(tarBytes).digest("hex"), packageTarBytes: tarBytes.byteLength, manifestSha256: createHash("sha256").update(readFileSync(join(currentPackage, "package.json"))).digest("hex"), executableSha256: currentCliWitness.sha256 };
  await expect(reconcileCodexNativeHooks({ ...f, journal, reviewedSkillsCli: { ...currentCliWitness, sha256: "d".repeat(64) }, supersedeBinding: true, releaseProof }, f.connect)).rejects.toThrow("SKILLS_RELEASE_MISMATCH");
  await expect(reconcileCodexNativeHooks({ ...f, journal, reviewedSkillsCli: currentCliWitness, supersedeBinding: true, releaseProof: { ...releaseProof, manifestSha256: "c".repeat(64) } }, f.connect)).rejects.toThrow("RECONCILE_RELEASE_MANIFEST_CHANGED");
  const foreignTar = join(f.home, "foreign.tgz"); writeFileSync(foreignTar, Buffer.concat([tarBytes, Buffer.from("foreign")]), { mode: 0o600 });
  await expect(reconcileCodexNativeHooks({ ...f, journal, reviewedSkillsCli: currentCliWitness, supersedeBinding: true, releaseProof: { ...releaseProof, packageTarPath: foreignTar } }, f.connect)).rejects.toThrow("RECONCILE_RELEASE_ARTIFACT_CHANGED");
  const receipt = await reconcileCodexNativeHooks({ ...f, journal, reviewedSkillsCli: currentCliWitness, supersedeBinding: true, releaseProof }, f.connect);
  expect(receipt.status).toBe("superseded"); expect(receipt.supersededBinding).toBe(true); expect(receipt.nativeStateVerified).toBe(false); expect(receipt.nativeTrustPending).toBe(true); expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
  expect(readFileSync(join(journal, "config.before.toml"), "utf8")).toBe(f.before); expect(JSON.parse(readFileSync(join(journal, "receipt.json"), "utf8")).status).toBe("superseded");
});

test("binding supersession refuses policy drift outside the Codex command", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "88888888-8888-4888-8888-888888888888");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex") }) + "\n", { mode: 0o600 });
  const policy = JSON.parse(policyText.toString()); policy.bridge.profileId = "unrelated"; writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"), { mode: 0o600 });
  await expect(reconcileCodexNativeHooks({ ...f, journal, supersedeBinding: true }, f.connect)).rejects.toThrow("RECONCILE_POLICY_CHANGED");
  expect(readFileSync(join(journal, "receipt.json"), { encoding: "utf8", flag: "a+" })).toBe("");
});

test("native reconciliation tolerates trailing whitespace while preserving comments", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "66666666-6666-4666-8666-666666666666");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex") }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment") + "\n\n", { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; });
  const receipt = await reconcileCodexNativeHooks({ ...f, journal }, f.connect); expect(receipt.reconciled).toBe(true); expect(receipt.nativeStateVerified).toBe(true); expect(readFileSync(f.configPath, "utf8")).toEndWith("\n\n");
});

test("native reconciliation accepts the persisted pre-inventory journal schema honestly", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "55555555-5555-4555-8555-555555555555");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ version: 1, planDigest: plan.planDigest, skillsCli: plan.skillsCli, nativeVersion: "codex-cli 0.154.0", configPath: f.configPath, beforeSha256: createHash("sha256").update(f.before).digest("hex"), hooksSha256: createHash("sha256").update(hooksText).digest("hex"), policySha256: createHash("sha256").update(policyText).digest("hex"), expectedVersion: `sha256:${"b".repeat(64)}`, hooks: plan.planned }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"), { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; });
  const receipt = await reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect);
  expect(receipt.nativeInventoryScope).toBe("declared-managed-hooks-only"); expect(receipt.unrelatedNativeHooksPreserved).toBe(false);
});

test("native reconciliation refuses unrelated effective configuration drift", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "22222222-2222-4222-8222-222222222222");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex") }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before + "\nmodel_provider = \"drift\"\n", { mode: 0o600 });
  await expect(reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(readFileSync(join(journal, "receipt.json"), { encoding: "utf8", flag: "a+" })).toBe("");
});

test("native reconciliation refuses a complete-list change and intent tampering", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "33333333-3333-4333-8333-333333333333");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  const intent = intentFor(f, plan, hooksText, policyText); writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intent, beforeSha256: intent.configSha256 }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"), { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; }); f.setMode("extraNative");
  await expect(reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_RECONCILE_NATIVE_HOOK_LIST_CHANGED");
  const tampered = JSON.parse(readFileSync(join(journal, "intent.json"), "utf8")); tampered.admitted[0].command = "skills --tampered"; writeFileSync(join(journal, "intent.json"), JSON.stringify(tampered) + "\n", { mode: 0o600 }); f.setMode("success");
  await expect(reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_RECONCILE_PLAN_CHANGED");
});

test("native reconciliation detects file drift during final native readback", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "44444444-4444-4444-8444-444444444444");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ ...intentFor(f, plan, hooksText, policyText), beforeSha256: createHash("sha256").update(f.before).digest("hex") }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"), { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; });
  let configReads = 0; const connect = async () => { const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) { const result = await rpc.request(method, params); if (method === "config/read" && ++configReads === 2) writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + "\n# concurrent drift\n", { mode: 0o600 }); return result; } }; };
  await expect(reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, connect)).rejects.toThrow("CODEX_HOOK_TRUST_INPUT_CHANGED");
});

function currentRecoveryPackage(f: ReturnType<typeof fixture>, currentBody = "#!/usr/bin/env bun\n// Synthetic current recovery package\n") {
  const currentPackage = join(f.home, "current/package"), currentCli = join(currentPackage, "bin/index.js"), currentBin = join(f.home, "current/bin");
  mkdirSync(join(currentPackage, "bin"), { recursive: true, mode: 0o700 }); mkdirSync(currentBin, { mode: 0o700 });
  writeFileSync(currentCli, currentBody, { mode: 0o700 });
  writeFileSync(join(currentPackage, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.9.10", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  symlinkSync(currentCli, join(currentBin, "skills")); process.env.PATH = currentBin + ":" + process.env.PATH;
  const reviewedSkillsCli = { path: currentCli, version: "0.9.10", sha256: createHash("sha256").update(readFileSync(currentCli)).digest("hex") };
  const tarPath = join(f.home, "current.tgz"); execFileSync("tar", ["-czf", tarPath, "-C", join(f.home, "current"), "package"]);
  const tarBytes = readFileSync(tarPath), releaseProof = { packageTarPath: tarPath, packageTarSha256: createHash("sha256").update(tarBytes).digest("hex"), packageTarBytes: tarBytes.length, manifestSha256: createHash("sha256").update(readFileSync(join(currentPackage, "package.json"))).digest("hex"), executableSha256: reviewedSkillsCli.sha256 };
  return { reviewedSkillsCli, releaseProof, currentCli };
}

function addRawConfigWitness(policy: any, f: ReturnType<typeof fixture>) {
  policy.bridge.discovery.codex.method = "reviewed";
  policy.bridge.discovery.codex.sources.push({ path: f.configPath, hashMode: "bytes", sha256: createHash("sha256").update(f.before).digest("hex") });
}

async function discoveryRecoveryFixture(rawConfig = false, rootAlias = false, unrelatedHook = true) {
  const f = fixture("", rootAlias), policyPath = join(f.dataDir, "agent-policy.json");
  const originalPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
  originalPolicy.bridge.discovery.claude = { agent: "claude", method: "reviewed", roots: [join(f.home, ".claude/skills")], sources: [{ path: join(f.home, "retired-source"), sha256: null }] };
  if (rawConfig) addRawConfigWitness(originalPolicy, f);
  writeFileSync(policyPath, JSON.stringify(originalPolicy));
  if (unrelatedHook) f.entries.push({ ...f.entries[0]!, key: "unrelated-native-hook", command: "true", enabled: false, trustStatus: rootAlias ? "modified" : "untrusted" });
  const plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "99999999-9999-4999-8999-999999999999");
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  const hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath), intent = intentFor(f, plan, hooksText, policyText);
  intent.declarations = intent.declarations.filter((item: any) => item.key !== "unrelated-native-hook");
  for (const [file, bytes] of Object.entries({ "config.before.toml": f.before, "hooks.before.json": hooksText, "policy.before.json": policyText, "intent.json": JSON.stringify(intent) + "\n", "stopped.json": "{}\n" })) writeFileSync(join(journal, file), bytes, { mode: 0o600 });
  writeFileSync(f.configPath, f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"));
  f.entries.filter(entry => entry.key !== "unrelated-native-hook").forEach(entry => { entry.enabled = true; });
  const policy = structuredClone(originalPolicy);
  policy.bridge.discovery.claude.roots.push(join(f.home, "project/.claude/skills"));
  const discoverySource = join(f.home, "reviewed-source"); writeFileSync(discoverySource, "reviewed discovery\n", { mode: 0o600 });
  policy.bridge.discovery.claude.sources = [{ path: discoverySource, hashMode: "bytes", sha256: createHash("sha256").update(readFileSync(discoverySource)).digest("hex") }];
  writeFileSync(policyPath, JSON.stringify(policy));
  const { reviewedSkillsCli, releaseProof, currentCli } = currentRecoveryPackage(f);
  const options = { home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli, releaseProof, claudeDiscoveryRecovery: { reason: "review: synthetic discovery migration receipt" } };
  f.calls.length = 0;
  return { ...f, options, journal, policyPath, policy, discoverySource, currentCli };
}

const fileSha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function writeAdditionsReview(f: { home: string; journal: string; policyPath: string; configPath: string; hooksPath: string }, producerConfig: string, producerHooks: string, nativeHook: any) {
  const reviewPath = join(f.home, "additions-review.json");
  const review = {
    version: 1, kind: "native-hook-additions", reason: "review: synthetic independent producer addition", producerEvidence: "synthetic producer transaction receipt",
    journalIntentSha256: fileSha(join(f.journal, "intent.json")), policySha256: fileSha(f.policyPath), configCurrentSha256: fileSha(f.configPath), hooksCurrentSha256: fileSha(f.hooksPath),
    producerBefore: { configPath: producerConfig, configSha256: fileSha(producerConfig), hooksPath: producerHooks, hooksSha256: fileSha(producerHooks) },
    additions: [{ event: "UserPromptSubmit", nativeHook }],
  };
  writeFileSync(reviewPath, JSON.stringify(review), { mode: 0o600 });
  return { reviewPath, review };
}
async function additionsRecoveryFixture(claudeChange = true, rootAlias = false, unrelatedHook = true) {
  const f = await discoveryRecoveryFixture(true, rootAlias, unrelatedHook);
  if (!claudeChange) writeFileSync(f.policyPath, readFileSync(join(f.journal, "policy.before.json")));
  const producerConfig = join(f.home, "producer-before.toml"), producerHooks = join(f.home, "producer-before.json");
  writeFileSync(producerConfig, readFileSync(f.configPath), { mode: 0o600 }); writeFileSync(producerHooks, readFileSync(f.hooksPath), { mode: 0o600 });
  const entry = { ...f.entries[0]!, key: `${f.entries[0]!.sourcePath}:user_prompt_submit:1:0`, command: "printf synthetic-added-hook", currentHash: `sha256:${"c".repeat(64)}`, enabled: true, trustStatus: "trusted", timeoutSec: 12 };
  const { displayOrder, ...nativeHook } = entry;
  const hooks = JSON.parse(readFileSync(f.hooksPath, "utf8")); hooks.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: entry.command, timeout: 12 }] });
  writeFileSync(f.hooksPath, JSON.stringify(hooks));
  writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + `\n[hooks.state.${JSON.stringify(entry.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(entry.currentHash)}\n`);
  f.entries.push(entry);
  const review = writeAdditionsReview(f, producerConfig, producerHooks, nativeHook);
  return { ...f, ...review, producerConfig, producerHooks, entry, options: { ...f.options, claudeDiscoveryRecovery: claudeChange ? f.options.claudeDiscoveryRecovery : undefined, nativeHookAdditionsRecovery: { path: review.reviewPath } } };
}

async function matchedAdditionsRecoveryFixture(claudeChange = true, rootAlias = false, multiline = false) {
  const f = await additionsRecoveryFixture(claudeChange, rootAlias, false), review: any = structuredClone(f.review);
  review.version = 2;
  review.additions[0].trustState = { enabled: true, trusted_hash: f.entry.currentHash };
  const declarations = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  let current = readFileSync(f.configPath, "utf8");
  for (const [index, matcher] of ["^(Bash|apply_patch)$", "^(Write|Edit)$"].entries()) {
    const command = multiline ? `/usr/bin/env -i /bin/sh -c 'cd / || exit 2
exec 3<&0 || exit 2
/synthetic/bun --config=/dev/null --no-env-file --no-macros --no-install --eval "(async function supervise() {
  const input = await Bun.stdin.text();
  process.stdout.write(JSON.stringify({ verdict: null, guard: ${index}, input }));
})();" <&3 3<&-
result=$?
if [ "$result" -ne 0 ]; then exit 2; fi' synthetic-native-safety` : `printf synthetic-guard-${index}`;
    const entry = { ...f.entry, eventName: "preToolUse", key: `${f.entry.sourcePath}:pre_tool_use:${index}:0`, command, matcher, timeoutSec: 10, currentHash: `sha256:${createHash("sha256").update(command).digest("hex")}` };
    const { displayOrder, ...nativeHook } = entry;
    review.additions.push({ event: "PreToolUse", nativeHook, trustState: { trusted_hash: entry.currentHash } });
    (declarations.hooks.PreToolUse ??= []).push({ matcher, hooks: [{ type: "command", command: entry.command, timeout: 10 }] });
    current += `\n[hooks.state.${JSON.stringify(entry.key)}]\ntrusted_hash = ${JSON.stringify(entry.currentHash)}\n`;
    f.entries.push(entry);
  }
  writeFileSync(f.configPath, current); writeFileSync(f.hooksPath, JSON.stringify(declarations));
  review.configCurrentSha256 = fileSha(f.configPath); review.hooksCurrentSha256 = fileSha(f.hooksPath);
  writeFileSync(f.reviewPath, JSON.stringify(review));
  return { ...f, review };
}

for (const alias of [false, true]) for (const claude of [false, true]) for (const multiline of [false, true]) test(`v2 matched recovery preserves all six native identities and omitted flags (alias=${alias}, claude=${claude}, multiline=${multiline})`, async () => {
  const f = await matchedAdditionsRecoveryFixture(claude, alias, multiline);
  const files = [f.configPath, f.hooksPath, f.policyPath, f.cli, ...readdirSync(f.journal).map(name => join(f.journal, name))];
  const before = files.map(path => readFileSync(path));
  const preview = await reconcileCodexNativeHooks(f.options, f.connect);
  expect(preview.reconciled).toBe(false); expect(preview.bindingRefreshRequired).toBe(true);
  expect(preview.recoveryPlan?.nativeHookAdditions?.version).toBe(2);
  expect(preview.recoveryPlan?.nativeHookAdditions?.additions).toEqual(f.review.additions);
  expect(preview.recoveryPlan?.nativeHookAdditions?.additions.map((row: any) => Object.hasOwn(row.trustState, "enabled"))).toEqual([true, false, false]);
  expect(f.entries).toHaveLength(6); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  const result = await reconcileCodexNativeHooks({ ...f.options, claudeDiscoveryRecovery: f.options.claudeDiscoveryRecovery ? { ...f.options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } : undefined, nativeHookAdditionsRecovery: { ...f.options.nativeHookAdditionsRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, f.connect);
  expect(result.reconciled).toBe(true); expect(result.nativeStateVerified).toBe(true); expect(result.nativeExecutionVerified).toBe(false);
  expect(JSON.parse(readFileSync(join(f.journal, "receipt.json"), "utf8")).recoveryPlan.nativeHookAdditions.additions).toEqual(f.review.additions);
  expect(files.map(path => readFileSync(path))).toEqual(before);
  expect(f.calls.every(call => ["hooks/list", "config/read"].includes(call.method))).toBe(true);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
});

test("v2 recovery rejects an old digest when omitted enabled becomes explicit true", async () => {
  const f = await matchedAdditionsRecoveryFixture(false), preview = await reconcileCodexNativeHooks(f.options, f.connect);
  const addition = f.review.additions[1]; addition.trustState.enabled = true;
  const header = `[hooks.state.${JSON.stringify(addition.nativeHook.key)}]\n`;
  writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace(header, header + "enabled = true\n"));
  f.review.configCurrentSha256 = fileSha(f.configPath); writeFileSync(f.reviewPath, JSON.stringify(f.review));
  const next = await reconcileCodexNativeHooks(f.options, f.connect);
  expect(next.recoveryPlanDigest).not.toBe(preview.recoveryPlanDigest);
  await expect(reconcileCodexNativeHooks({ ...f.options, nativeHookAdditionsRecovery: { ...f.options.nativeHookAdditionsRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, f.connect)).rejects.toThrow("RECONCILE_RECOVERY_PLAN_CHANGED");
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

for (const mutation of ["matcher", "disabled", "untrusted", "extra", "version", "override", "second-native-read", "second-config-read"] as const) test(`v2 matched recovery refuses native ${mutation} without a receipt`, async () => {
  const f = await matchedAdditionsRecoveryFixture(false); let hookReads = 0, configReads = 0;
  const connect = async () => { const rpc = await f.connect(); return { ...rpc, version: mutation === "version" ? "codex-cli 0.999.0" : rpc.version, async request(method: string, params: any) {
    const result: any = await rpc.request(method, params);
    if (method === "hooks/list") {
      hookReads++; const added = result.data[0].hooks.find((hook: any) => hook.eventName === "preToolUse");
      if (mutation === "matcher" || (mutation === "second-native-read" && hookReads === 2)) added.matcher = "Read";
      if (mutation === "disabled") added.enabled = false;
      if (mutation === "untrusted") added.trustStatus = "untrusted";
      if (mutation === "extra") result.data[0].hooks.push({ ...added, key: "unexpected" });
    }
    if (method === "config/read") {
      configReads++;
      if (mutation === "override") result.layers.unshift({ name: { type: "sessionFlags" }, config: { hooks: { state: {} } } });
      if (mutation === "second-config-read" && configReads === 2) result.layers[0].config = {};
    }
    return result;
  } }; };
  await expect(reconcileCodexNativeHooks(f.options, connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  expect(f.calls.every(call => ["hooks/list", "config/read"].includes(call.method))).toBe(true);
});

for (const rootAlias of [false, true]) for (const claudeChange of [false, true]) test(`reviewed producer additions preserve native state and require the exact preview (${claudeChange ? "combined" : "unchanged policy"}, alias=${rootAlias})`, async () => {
  const f = await additionsRecoveryFixture(claudeChange, rootAlias), config = readFileSync(f.configPath), hooks = readFileSync(f.hooksPath), policy = readFileSync(f.policyPath);
  const journal = Object.fromEntries(readdirSync(f.journal).map(name => [name, readFileSync(join(f.journal, name))]));
  const preview = await reconcileCodexNativeHooks(f.options, f.connect);
  expect(preview.status).toBe("recovery-review-required"); expect(preview.bindingRefreshRequired).toBe(true); expect(preview.nativeStateVerified).toBe(true);
  expect(preview.recoveryPlan?.kind).toBe(claudeChange ? "claude-discovery-and-native-hook-additions" : "native-hook-additions");
  expect(preview.recoveryPlan?.nativeHookAdditions?.additions).toHaveLength(1);
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  const receipt = await reconcileCodexNativeHooks({ ...f.options, claudeDiscoveryRecovery: f.options.claudeDiscoveryRecovery ? { ...f.options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } : undefined, nativeHookAdditionsRecovery: { ...f.options.nativeHookAdditionsRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, f.connect);
  expect(receipt.reconciled).toBe(true); expect(receipt.bindingRefreshRequired).toBe(true); expect(receipt.nativeExecutionVerified).toBe(false);
  expect(readFileSync(f.configPath)).toEqual(config); expect(readFileSync(f.hooksPath)).toEqual(hooks); expect(readFileSync(f.policyPath)).toEqual(policy);
  for (const [name, bytes] of Object.entries(journal)) expect(readFileSync(join(f.journal, name))).toEqual(bytes);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
  expect(f.calls.every(call => ["hooks/list", "config/read"].includes(call.method))).toBe(true);
});

for (const mutation of ["reason", "producer-evidence", "old-cli", "digest"]) test(`a saved additions preview refuses subsequent ${mutation} drift`, async () => {
  const f = await additionsRecoveryFixture(), preview = await reconcileCodexNativeHooks(f.options, f.connect);
  if (mutation === "reason" || mutation === "producer-evidence") {
    const review = JSON.parse(readFileSync(f.reviewPath, "utf8")); review[mutation === "reason" ? "reason" : "producerEvidence"] += " changed"; writeFileSync(f.reviewPath, JSON.stringify(review));
  } else if (mutation === "old-cli") writeFileSync(f.cli, readFileSync(f.cli, "utf8") + "// changed artifact\n");
  const digest = mutation === "digest" ? "0".repeat(64) : preview.recoveryPlanDigest;
  await expect(reconcileCodexNativeHooks({ ...f.options, claudeDiscoveryRecovery: { ...f.options.claudeDiscoveryRecovery!, reviewedPlanDigest: digest }, nativeHookAdditionsRecovery: { ...f.options.nativeHookAdditionsRecovery, reviewedPlanDigest: digest } }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false); expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
});

for (const mutation of ["no-review", "unreviewed-policy", "missing-native-inventory", "review-unknown-field", "review-policy-hash", "review-intent-hash", "review-current-hash", "wrong-root", "wrong-source", "wrong-event", "duplicate-old-command", "changed-command", "changed-hash", "untrusted", "disabled", "async", "extra-native-field", "missing-producer", "forged-producer-hash", "producer-comment", "producer-incomplete-trust", "producer-old-hooks", "current-comment", "current-other-config", "current-extra-state", "current-extra-hook", "original-hook-replaced", "review-symlink", "review-hardlink", "review-mode", "malformed-digest", "conflicting-digests"] as const) test(`additions review refuses ${mutation} before native RPC`, async () => {
  const f = await additionsRecoveryFixture(), options: any = structuredClone(f.options), review: any = structuredClone(f.review);
  if (mutation === "no-review") delete options.nativeHookAdditionsRecovery;
  else if (mutation === "unreviewed-policy") delete options.claudeDiscoveryRecovery;
  else if (mutation === "missing-native-inventory") { const intent = JSON.parse(readFileSync(join(f.journal, "intent.json"), "utf8")); delete intent.nativeHooks; writeFileSync(join(f.journal, "intent.json"), JSON.stringify(intent)); }
  else if (mutation === "review-unknown-field") review.ignoreOtherChanges = true;
  else if (mutation === "review-policy-hash") review.policySha256 = "0".repeat(64);
  else if (mutation === "review-intent-hash") review.journalIntentSha256 = "0".repeat(64);
  else if (mutation === "review-current-hash") review.configCurrentSha256 = "0".repeat(64);
  else if (mutation === "wrong-root") review.additions[0].nativeHook.key = review.additions[0].nativeHook.key.replace(".codex", "other");
  else if (mutation === "wrong-source") review.additions[0].nativeHook.source = "plugin";
  else if (mutation === "wrong-event") review.additions[0].event = "SessionStart";
  else if (mutation === "duplicate-old-command") review.additions[0].nativeHook.command = f.entries[0]!.command;
  else if (mutation === "changed-command") review.additions[0].nativeHook.command += " extra";
  else if (mutation === "changed-hash") review.additions[0].nativeHook.currentHash = `sha256:${"d".repeat(64)}`;
  else if (mutation === "untrusted") review.additions[0].nativeHook.trustStatus = "untrusted";
  else if (mutation === "disabled") review.additions[0].nativeHook.enabled = false;
  else if (mutation === "async") review.additions[0].nativeHook.async = true;
  else if (mutation === "extra-native-field") review.additions[0].nativeHook.extra = true;
  else if (mutation === "missing-producer") review.producerBefore.configPath += "-missing";
  else if (mutation === "forged-producer-hash") review.producerBefore.configSha256 = "0".repeat(64);
  else if (mutation === "producer-comment") { writeFileSync(f.producerConfig, readFileSync(f.producerConfig, "utf8") + "\n# changed producer bytes\n"); review.producerBefore.configSha256 = fileSha(f.producerConfig); }
  else if (mutation === "producer-incomplete-trust") { writeFileSync(f.producerConfig, f.before); review.producerBefore.configSha256 = fileSha(f.producerConfig); }
  else if (mutation === "producer-old-hooks") { writeFileSync(f.producerHooks, readFileSync(f.hooksPath)); review.producerBefore.hooksSha256 = fileSha(f.producerHooks); }
  else if (mutation === "current-comment") { writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + "\n# unrelated edit\n"); review.configCurrentSha256 = fileSha(f.configPath); }
  else if (mutation === "current-other-config") { writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace('model = "synthetic"', 'model = "changed"')); review.configCurrentSha256 = fileSha(f.configPath); }
  else if (mutation === "current-extra-state") { writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + '\n[hooks.state."extra"]\nenabled = true\n'); review.configCurrentSha256 = fileSha(f.configPath); }
  else if (mutation === "current-extra-hook" || mutation === "original-hook-replaced") { const hooks = JSON.parse(readFileSync(f.hooksPath, "utf8")); if (mutation === "current-extra-hook") hooks.hooks.UserPromptSubmit.push(hooks.hooks.UserPromptSubmit[1]); else hooks.hooks.UserPromptSubmit[0].hooks[0].command = "printf replaced"; writeFileSync(f.hooksPath, JSON.stringify(hooks)); review.hooksCurrentSha256 = fileSha(f.hooksPath); }
  else if (mutation === "malformed-digest") { options.claudeDiscoveryRecovery.reviewedPlanDigest = "bad"; options.nativeHookAdditionsRecovery.reviewedPlanDigest = "bad"; }
  else if (mutation === "conflicting-digests") options.nativeHookAdditionsRecovery.reviewedPlanDigest = "a".repeat(64);
  writeFileSync(f.reviewPath, JSON.stringify(review));
  if (mutation === "review-symlink") { const target = f.reviewPath + ".target"; writeFileSync(target, readFileSync(f.reviewPath), { mode: 0o600 }); rmSync(f.reviewPath); symlinkSync(target, f.reviewPath); }
  else if (mutation === "review-hardlink") linkSync(f.reviewPath, f.reviewPath + ".link");
  else if (mutation === "review-mode") chmodSync(f.reviewPath, 0o644);
  await expect(reconcileCodexNativeHooks(options, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(f.calls).toHaveLength(0); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

for (const mutation of ["native-extra", "native-missing", "native-command", "native-hash", "native-untrusted", "native-disabled", "native-original", "native-failure", "config-concurrent", "hooks-concurrent", "review-concurrent", "producer-concurrent", "policy-concurrent", "native-concurrent"] as const) test(`additions recovery refuses ${mutation} without recording a receipt`, async () => {
  const f = await additionsRecoveryFixture(); let configReads = 0, hookReads = 0;
  const connect = async () => { const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
    if (mutation === "native-failure") throw new Error("synthetic native refusal");
    const result: any = await rpc.request(method, params);
    if (method === "hooks/list") {
      hookReads++;
      const hooks = result.data[0].hooks, added = hooks.find((hook: any) => hook.key === f.entry.key);
      if (mutation === "native-extra") hooks.push({ ...added, key: "extra" });
      else if (mutation === "native-missing") hooks.pop();
      else if (mutation === "native-command") added.command += " changed";
      else if (mutation === "native-hash") added.currentHash = `sha256:${"d".repeat(64)}`;
      else if (mutation === "native-untrusted") added.trustStatus = "untrusted";
      else if (mutation === "native-disabled") added.enabled = false;
      else if (mutation === "native-original") hooks[0].command += " changed";
      else if (mutation === "native-concurrent" && hookReads === 2) added.command += " changed";
    }
    if (method === "config/read" && ++configReads === 2) {
      const targets: Record<string, string> = { "config-concurrent": f.configPath, "hooks-concurrent": f.hooksPath, "review-concurrent": f.reviewPath, "producer-concurrent": f.producerConfig, "policy-concurrent": f.policyPath };
      const target = targets[mutation];
      if (target) writeFileSync(target, readFileSync(target, "utf8") + "\n");
    }
    return result;
  } }; };
  await expect(reconcileCodexNativeHooks(f.options, connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false); expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
});

test.skipIf(!process.env.SKILLS_TEST_CODEX_COMMAND)("real native Codex verifies reviewed discovery recovery without executing the old package or writing native state", async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.bridge.discovery.claude = { agent: "claude", method: "reviewed", roots: [join(f.home, ".claude/skills")], sources: [] };
  writeFileSync(policyPath, JSON.stringify(policy));
  // If any hook runs, the old fixture records it. Native reads must not do so.
  const executionMarker = join(f.home, "unexpected-old-execution");
  writeFileSync(f.cli, `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(executionMarker)}, 'executed');\n`);
  f.reviewedSkillsCli.sha256 = createHash("sha256").update(readFileSync(f.cli)).digest("hex");
  const nativeConnect = (options: any) => connectCodexHookRpc({ ...options, command: process.env.SKILLS_TEST_CODEX_COMMAND! });
  const plan = await enrollCodexNativeHooks(f, nativeConnect);
  const interrupted = async (options: any) => {
    const rpc = await nativeConnect(options);
    return { ...rpc, async request(method: string, params: any) { const result = await rpc.request(method, params); if (method === "config/batchWrite") throw new Error("Synthetic post-write interruption"); return result; } };
  };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, interrupted)).rejects.toThrow("NATIVE_WRITE_FAILED");
  const journalRoot = join(f.dataDir, "native-hook-trust"), journals = readdirSync(journalRoot); expect(journals).toHaveLength(1);
  const journal = join(journalRoot, journals[0]!);
  policy.bridge.discovery.claude.roots.push(join(f.home, "project/.claude/skills"));
  policy.bridge.discovery.claude.sources.push({ path: join(f.home, "absent-reviewed-source"), sha256: null });
  writeFileSync(policyPath, JSON.stringify(policy));
  const current = currentRecoveryPackage(f), beforeConfig = readFileSync(f.configPath), beforePolicy = readFileSync(policyPath), methods: string[] = [];
  const readOnlyNative = async (options: any) => { const rpc = await nativeConnect(options); return { ...rpc, async request(method: string, params: any) { methods.push(method); needReadOnly(method); return rpc.request(method, params); } }; };
  function needReadOnly(method: string) { expect(["hooks/list", "config/read"]).toContain(method); }
  const options = { home: f.home, dataDir: f.dataDir, journal, ...current, claudeDiscoveryRecovery: { reason: "review: synthetic native discovery update" } };
  const preview = await reconcileCodexNativeHooks(options, readOnlyNative);
  expect(preview.reconciled).toBe(false); expect(preview.nativeStateVerified).toBe(true); expect(existsSync(join(journal, "receipt.json"))).toBe(false);
  const receipt = await reconcileCodexNativeHooks({ ...options, claudeDiscoveryRecovery: { ...options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, readOnlyNative);
  expect(receipt.reconciled).toBe(true); expect(receipt.nativeStateVerified).toBe(true); expect(receipt.nativeVersion).toBe(plan.nativeVersion);
  expect(methods).toEqual(["hooks/list", "config/read", "hooks/list", "config/read", "hooks/list", "config/read", "hooks/list", "config/read"]);
  expect(readFileSync(f.configPath)).toEqual(beforeConfig); expect(readFileSync(policyPath)).toEqual(beforePolicy); expect(existsSync(executionMarker)).toBe(false);
}, 30000);

test("reviewed discovery recovery previews exact changes and retains the old binding without executing it", async () => {
  const f = await discoveryRecoveryFixture(), before = readFileSync(f.configPath), policy = readFileSync(f.policyPath);
  const preview = await reconcileCodexNativeHooks(f.options, f.connect);
  expect(preview.reconciled).toBe(false); expect(preview.status).toBe("recovery-review-required"); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  expect(preview.bindingRefreshRequired).toBe(false);
  expect(preview.recoveryPlan?.changes?.map(change => change.path)).toEqual(["bridge.discovery.claude.roots", "bridge.discovery.claude.sources"]);
  expect(preview.recoveryPlan?.boundSkillsCli.version).toBe("0.8.9"); expect(preview.recoveryPlan?.recoveryCli.version).toBe("0.9.10");
  expect(preview.nativeInventoryScope).toBe("complete"); expect(preview.unrelatedNativeHooksPreserved).toBe(true);
  expect(f.calls.map(call => call.method)).toEqual(["hooks/list", "config/read", "hooks/list", "config/read"]);
  const receipt = await reconcileCodexNativeHooks({ ...f.options, claudeDiscoveryRecovery: { ...f.options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, f.connect);
  expect(receipt.reconciled).toBe(true); expect(receipt.nativeStateVerified).toBe(true); expect(receipt.nativeExecutionVerified).toBe(false);
  expect(receipt.recoveryPlanDigest).toBe(preview.recoveryPlanDigest); expect(readFileSync(f.configPath)).toEqual(before); expect(readFileSync(f.policyPath)).toEqual(policy);
  expect(JSON.parse(readFileSync(join(f.journal, "receipt.json"), "utf8"))).toEqual(receipt);
  expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
  await expect(reconcileCodexNativeHooks(f.options, f.connect)).rejects.toThrow("RECONCILE_ALREADY_COMPLETE");
});

test("journal recovery verifies both typed and historical raw config witnesses without relaxing the ordinary bridge gate", async () => {
  const f = await discoveryRecoveryFixture(true), before = readFileSync(f.configPath), policy = readFileSync(f.policyPath);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
  const preview = await reconcileCodexNativeHooks(f.options, f.connect);
  expect(preview.status).toBe("recovery-review-required"); expect(preview.nativeStateVerified).toBe(true);
  expect(preview.bindingRefreshRequired).toBe(true);
  expect(preview.recoveryPlan?.configDiscoveryRecovery).toMatchObject({ configPath: f.configPath, beforeSha256: createHash("sha256").update(f.before).digest("hex"), currentSha256: createHash("sha256").update(before).digest("hex") });
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  const receipt = await reconcileCodexNativeHooks({ ...f.options, claudeDiscoveryRecovery: { ...f.options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } }, f.connect);
  expect(receipt.reconciled).toBe(true); expect(receipt.recoveryPlanDigest).toBe(preview.recoveryPlanDigest);
  expect(receipt.bindingRefreshRequired).toBe(true);
  expect(readFileSync(f.configPath)).toEqual(before); expect(readFileSync(f.policyPath)).toEqual(policy);
  expect(f.calls.map(call => call.method)).toEqual(["hooks/list", "config/read", "hooks/list", "config/read", "hooks/list", "config/read", "hooks/list", "config/read"]);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
});

test("native enrollment completes exact writes while requiring an explicit same-command discovery refresh", async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  addRawConfigWitness(policy, f); writeFileSync(policyPath, JSON.stringify(policy));
  const beforePolicy = readFileSync(policyPath), beforeHooks = readFileSync(f.hooksPath);
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(applied.applied).toBe(true); expect(applied.nativeEligible).toBe(true); expect(applied.bindingRefreshRequired).toBe(true);
  expect(readFileSync(policyPath)).toEqual(beforePolicy); expect(readFileSync(f.hooksPath)).toEqual(beforeHooks);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
  const currentConfig = readFileSync(f.configPath);
  const discoveryInputs = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: captureDiscoveryByteSources([f.configPath]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  const refresh = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["codex"], command: f.command, discoveryInputs });
  expect(refresh.changes.map(change => change.path)).toEqual([policyPath]);
  applyAgentIntegration(refresh);
  expect(readFileSync(f.configPath)).toEqual(currentConfig); expect(readFileSync(f.hooksPath)).toEqual(beforeHooks);
  assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home });
  const writes = f.calls.filter(call => call.method === "config/batchWrite").length;
  const final = await enrollCodexNativeHooks(f, f.connect);
  expect(final.planned).toHaveLength(0); expect(final.nativeEligible).toBe(true); expect(final.bindingRefreshRequired).toBe(false);
  expect(f.calls.filter(call => call.method === "config/batchWrite")).toHaveLength(writes);
});

for (const mutation of ["config-comment", "config-typed", "config-unrelated-trust", "policy", "hooks", "cli", "discovery", "native-failure", "native-identity", "native-unrelated", "saved-config"] as const) test(`reviewed raw-witness enrollment refuses ${mutation} after native write without a completion receipt`, async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  addRawConfigWitness(policy, f);
  const otherSource = join(f.home, "plugin-source.json"); writeFileSync(otherSource, "{}\n", { mode: 0o600 });
  policy.bridge.discovery.codex.sources.push(...captureDiscoveryByteSources([otherSource])); writeFileSync(policyPath, JSON.stringify(policy));
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const connect = async () => { const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
    const result = await rpc.request(method, params);
    if (method === "config/batchWrite") {
      if (mutation === "config-comment") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + "\n# unreviewed comment\n");
      if (mutation === "config-typed") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace("[skills.bundled]\nenabled = false", "[skills.bundled]\nenabled = true"));
      if (mutation === "config-unrelated-trust") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace("enabled = false # preserve unrelated", "enabled = true # preserve unrelated"));
      if (mutation === "policy") writeFileSync(policyPath, readFileSync(policyPath, "utf8") + "\n");
      if (mutation === "hooks") writeFileSync(f.hooksPath, readFileSync(f.hooksPath, "utf8") + "\n");
      if (mutation === "cli") writeFileSync(f.cli, readFileSync(f.cli, "utf8") + "// changed package\n");
      if (mutation === "discovery") writeFileSync(otherSource, "{\"changed\":true}\n");
      if (mutation === "native-failure") throw new Error("synthetic native transport failure");
      if (mutation === "native-identity") f.entries[0]!.currentHash = `sha256:${"e".repeat(64)}`;
      if (mutation === "native-unrelated") f.entries.push({ ...f.entries[0]!, key: "unrelated-new-hook", command: "echo synthetic" });
      if (mutation === "saved-config") {
        const parent = join(f.dataDir, "native-hook-trust"), journal = join(parent, readdirSync(parent)[0]!);
        writeFileSync(join(journal, "config.before.toml"), f.before + "\n# changed journal witness\n");
      }
    }
    return result;
  } }; };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  const parent = join(f.dataDir, "native-hook-trust"), journals = readdirSync(parent); expect(journals).toHaveLength(1);
  expect(existsSync(join(parent, journals[0]!, "receipt.json"))).toBe(false); expect(existsSync(join(parent, journals[0]!, "stopped.json"))).toBe(true);
  expect(f.calls.filter(call => call.method === "config/batchWrite")).toHaveLength(1);
});

for (const mutation of ["stale-review", "config", "command", "other-witness"] as const) test(`same-command discovery refresh refuses intervening ${mutation}`, async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  addRawConfigWitness(policy, f); writeFileSync(policyPath, JSON.stringify(policy));
  const staleSources = captureDiscoveryByteSources([f.configPath]);
  const trustPlan = await enrollCodexNativeHooks(f, f.connect);
  const applied = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: trustPlan.planDigest }, f.connect);
  expect(applied.bindingRefreshRequired).toBe(true);
  const other = join(f.home, "plugin-review.json"); writeFileSync(other, "{}\n", { mode: 0o600 });
  const sources = mutation === "stale-review" ? staleSources : captureDiscoveryByteSources([f.configPath, other]);
  const options = { home: f.home, dataDir: f.dataDir, agents: ["codex" as const], command: f.command, discoveryInputs: { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources, pluginHooks: "reviewed-no-skill-injection" as const }] } };
  if (mutation === "stale-review") expect(() => planAgentIntegration(options)).toThrow("Native discovery input changed");
  else {
    const refresh = planAgentIntegration(options);
    if (mutation === "config") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + "\n# edit after review\n");
    if (mutation === "command") { const changed = JSON.parse(readFileSync(policyPath, "utf8")); changed.bridge.commands.codex += "-changed"; writeFileSync(policyPath, JSON.stringify(changed)); }
    if (mutation === "other-witness") writeFileSync(other, "{\"changed\":true}\n");
    const before = readFileSync(policyPath);
    expect(() => applyAgentIntegration(refresh)).toThrow(); expect(readFileSync(policyPath)).toEqual(before);
  }
  expect(f.calls.filter(call => call.method === "config/batchWrite")).toHaveLength(1);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow();
});

for (const mutation of ["raw-hash-only", "nonjournal-byte", "malformed", "replaced", "typed-drift", "unrelated-trust", "wrong-root"] as const) test(`raw discovery recovery refuses ${mutation} before native reads`, async () => {
  const f = await discoveryRecoveryFixture(true);
  if (mutation === "raw-hash-only") writeFileSync(f.configPath, f.before);
  if (mutation === "nonjournal-byte") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace("# preserve this comment", "# changed comment"));
  if (mutation === "malformed") writeFileSync(f.configPath, "[invalid\n");
  if (mutation === "replaced") { const replacement = join(f.home, "replacement.toml"); writeFileSync(replacement, readFileSync(f.configPath)); rmSync(f.configPath); symlinkSync(replacement, f.configPath); }
  if (mutation === "typed-drift") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace("[skills.bundled]\nenabled = false", "[skills.bundled]\nenabled = true"));
  if (mutation === "unrelated-trust") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace("enabled = false # preserve unrelated", "enabled = true # preserve unrelated"));
  if (mutation === "wrong-root") {
    const wrong = join(f.home, "wrong-root.toml"); writeFileSync(wrong, readFileSync(f.configPath), { mode: 0o600 });
    const path = join(f.journal, "intent.json"), intent = JSON.parse(readFileSync(path, "utf8")); intent.configPath = wrong; writeFileSync(path, JSON.stringify(intent));
  }
  await expect(reconcileCodexNativeHooks(f.options, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(f.calls).toHaveLength(0); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

test("raw discovery recovery refuses a concurrent config edit after native readback", async () => {
  const f = await discoveryRecoveryFixture(true); let reads = 0;
  const connect = async () => { const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
    const result = await rpc.request(method, params);
    if (method === "config/read" && ++reads === 2) writeFileSync(f.configPath, readFileSync(f.configPath, "utf8") + "\n# concurrent edit\n");
    return result;
  } }; };
  await expect(reconcileCodexNativeHooks(f.options, connect)).rejects.toThrow("INPUT_CHANGED");
  expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

test("the bridge refuses a valid discovery proof for a different configuration root", async () => {
  const f = await discoveryRecoveryFixture(true), other = join(f.home, "other-config.toml");
  writeFileSync(other, readFileSync(f.configPath), { mode: 0o600 });
  const binding = structuredClone(f.policy.bridge.discovery.codex);
  for (const source of binding.sources) if (source.path === f.configPath) source.path = other;
  const intent = JSON.parse(readFileSync(join(f.journal, "intent.json"), "utf8"));
  const proof = createCodexHookDiscoveryRecovery(binding, snapshot(join(f.journal, "config.before.toml"), true), snapshot(other, true), intent.hooks)!;
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home, codexDiscoveryRecovery: proof })).toThrow("different configuration root");
  expect(f.calls).toHaveLength(0); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

test("Codex recovery binds omitted and empty derived plugin controls equally, but binds non-empty controls", async () => {
  const f = await discoveryRecoveryFixture(true);
  const intent = JSON.parse(readFileSync(join(f.journal, "intent.json"), "utf8"));
  const witness = createCodexHookDiscoveryRecovery(
    f.policy.bridge.discovery.codex,
    snapshot(join(f.journal, "config.before.toml"), true),
    snapshot(f.configPath, true),
    intent.hooks,
  )!;
  const emptyControls = { ...f.policy.bridge.discovery.codex, codexDisabledPluginSkills: [] };
  expect(() => assertCodexHookDiscoveryRecovery(emptyControls, witness)).not.toThrow();
  const emptyControlsFirst = { codexDisabledPluginSkills: [], ...f.policy.bridge.discovery.codex };
  expect(() => assertCodexHookDiscoveryRecovery(emptyControlsFirst, witness)).not.toThrow();
  const reverseWitness = createCodexHookDiscoveryRecovery(
    emptyControlsFirst,
    snapshot(join(f.journal, "config.before.toml"), true),
    snapshot(f.configPath, true),
    intent.hooks,
  )!;
  expect(() => assertCodexHookDiscoveryRecovery(f.policy.bridge.discovery.codex, reverseWitness)).not.toThrow();

  const changedControls = structuredClone(f.policy.bridge.discovery.codex);
  changedControls.codexDisabledPluginSkills = [{
    name: "synthetic",
    pluginId: "synthetic@1.0.0",
    namespace: "synthetic",
    pluginParent: join(f.home, ".codex/plugins/cache/synthetic"),
    manifestSha256: "a".repeat(64),
  }];
  expect(() => assertCodexHookDiscoveryRecovery(changedControls, witness)).toThrow("RECONCILE_DISCOVERY_RECOVERY_CHANGED");
  expect(() => assertCodexHookDiscoveryRecovery({ ...f.policy.bridge.discovery.codex, codexDisabledPluginSkills: null } as any, witness)).toThrow("RECONCILE_DISCOVERY_RECOVERY_CHANGED");
  expect(() => assertCodexHookDiscoveryRecovery({ ...f.policy.bridge.discovery.codex, roots: [join(f.home, "changed-root")] }, witness)).toThrow("RECONCILE_DISCOVERY_RECOVERY_CHANGED");
});

for (const additionVersion of [0, 1, 2]) for (const format of ["json", "human"] as const) test.skipIf(!process.env.SKILLS_TEST_CODEX_COMMAND)(`real CLI recovers both witnesses, enrolls a new command and requires a reviewed same-command refresh (${format}, additions v${additionVersion})`, async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  addRawConfigWitness(policy, f);
  policy.bridge.discovery.claude = { agent: "claude", method: "reviewed", roots: [join(f.home, ".claude/skills")], sources: [] };
  writeFileSync(policyPath, JSON.stringify(policy));
  const marker = join(f.home, "old-package-executed"); writeFileSync(f.cli, `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(marker)}, 'unexpected');\n`);
  f.reviewedSkillsCli.sha256 = createHash("sha256").update(readFileSync(f.cli)).digest("hex");
  const connect = (options: any) => connectCodexHookRpc({ ...options, command: process.env.SKILLS_TEST_CODEX_COMMAND! });
  const plan = await enrollCodexNativeHooks(f, connect);
  // Reproduce the previous release's stopped journal after real native writes.
  // The old command remains an inert witness and is never executed.
  const interrupted = async (options: any) => { const rpc = await connect(options); return { ...rpc, async request(method: string, params: any) {
    const result = await rpc.request(method, params); if (method === "config/batchWrite") throw new Error("synthetic interruption after native write"); return result;
  } }; };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, interrupted)).rejects.toThrow("NATIVE_WRITE_FAILED");
  const journalRoot = join(f.dataDir, "native-hook-trust"), journals = readdirSync(journalRoot); expect(journals).toHaveLength(1);
  const journal = join(journalRoot, journals[0]!); expect(existsSync(join(journal, "stopped.json"))).toBe(true);
  policy.bridge.discovery.claude.roots.push(join(f.home, "project/.claude/skills")); writeFileSync(policyPath, JSON.stringify(policy));
  let additionsReviewPath: string | undefined, expectedAdditions: any[] = [], addedNative: any[] = [];
  const nativeProjection = (hook: any) => Object.fromEntries(["key", "eventName", "handlerType", "command", "matcher", "timeoutSec", "async", "statusMessage", "additionalContextLimit", "sourcePath", "source", "pluginId", "isManaged", "currentHash", "enabled", "trustStatus"].map(key => [key, hook[key]]));
  if (additionVersion) {
    const producerConfig = join(f.home, "producer-before.toml"), producerHooks = join(f.home, "producer-before.json");
    writeFileSync(producerConfig, readFileSync(f.configPath), { mode: 0o600 }); writeFileSync(producerHooks, readFileSync(f.hooksPath), { mode: 0o600 });
    const hooks = JSON.parse(readFileSync(f.hooksPath, "utf8"));
    hooks.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: "printf synthetic-added-hook", timeout: 12 }] }); writeFileSync(f.hooksPath, JSON.stringify(hooks));
    if (additionVersion === 2) {
      hooks.hooks.PreToolUse = [
        { matcher: "Bash|Write", hooks: [{ type: "command", command: "printf synthetic-guard-one", timeout: 10 }] },
        { matcher: "mcp__example__.*", hooks: [{ type: "command", command: "printf synthetic-guard-two", timeout: 11 }] },
      ];
      writeFileSync(f.hooksPath, JSON.stringify(hooks));
    }
    const rpc = await connect({ home: f.home });
    try {
      const inventory = await rpc.request("hooks/list", { cwds: [f.home] });
      const added = inventory.data[0].hooks.filter((hook: any) => ["printf synthetic-added-hook", "printf synthetic-guard-one", "printf synthetic-guard-two"].includes(hook.command));
      expect(added).toHaveLength(additionVersion === 2 ? 3 : 1);
      const config = await rpc.request("config/read", { cwd: f.home, includeLayers: true });
      const layer = config.layers.find((entry: any) => entry.name?.type === "user" && entry.name.file === f.configPath); expect(layer).toBeDefined();
      const states = Object.fromEntries(added.map((hook: any) => [hook.key, { ...(hook.eventName === "userPromptSubmit" ? { enabled: true } : {}), trusted_hash: hook.currentHash }]));
      const written = await rpc.request("config/batchWrite", { edits: [{ keyPath: "hooks.state", value: states, mergeStrategy: "upsert" }], filePath: f.configPath, expectedVersion: layer.version, reloadUserConfig: true }); expect(written.status).toBe("ok");
      const final = await rpc.request("hooks/list", { cwds: [f.home] });
      addedNative = added.map((entry: any) => nativeProjection(final.data[0].hooks.find((hook: any) => hook.key === entry.key)));
      for (const hook of addedNative) { expect(hook.enabled).toBe(true); expect(hook.trustStatus).toBe("trusted"); }
      const nativeStates = (Bun.TOML.parse(readFileSync(f.configPath, "utf8")) as any).hooks.state;
      for (const hook of addedNative) expect(nativeStates[hook.key]).toEqual(states[hook.key]);
      expectedAdditions = addedNative.map(hook => ({ event: hook.eventName === "userPromptSubmit" ? "UserPromptSubmit" : "PreToolUse", nativeHook: hook, trustState: states[hook.key] }));
    } finally { await rpc.close(); }
    const review = writeAdditionsReview({ ...f, journal, policyPath }, producerConfig, producerHooks, addedNative.find(hook => hook.eventName === "userPromptSubmit"));
    additionsReviewPath = review.reviewPath;
    if (additionVersion === 2) writeFileSync(additionsReviewPath, JSON.stringify({ ...review.review, version: 2, additions: expectedAdditions }));
  }
  // Build in an owned child: repeated in-process Bun builds share resolver
  // state with unrelated suite fixtures that create/remove temporary packages.
  const bundle = join(f.home, "current-cli.js"), builder = Bun.spawn([process.execPath, "build", join(import.meta.dir, "../cli/index.tsx"), "--target", "bun", "--outfile", bundle], { env: { HOME: f.home, PATH: process.env.PATH! }, stdout: "pipe", stderr: "pipe" });
  const [, buildError, buildStatus] = await Promise.all([new Response(builder.stdout).text(), new Response(builder.stderr).text(), builder.exited]);
  expect(buildStatus).toBe(0); expect(buildError).toBe("");
  const current = currentRecoveryPackage(f, readFileSync(bundle, "utf8")), proof = current.releaseProof;
  const args = ["hook", "trust", "reconcile", "--agent", "codex", "--journal", journal, "--codex-command", process.env.SKILLS_TEST_CODEX_COMMAND!, "--review-claude-discovery", "review: synthetic complete CLI recovery", ...(additionsReviewPath ? ["--review-native-hook-additions", additionsReviewPath] : []), "--skills-package-tar", proof.packageTarPath, "--skills-package-tar-sha256", proof.packageTarSha256, "--skills-package-tar-bytes", String(proof.packageTarBytes), "--skills-package-manifest-sha256", proof.manifestSha256, "--skills-executable-sha256", proof.executableSha256, "--json"];
  const beforeConfig = readFileSync(f.configPath), beforePolicy = readFileSync(policyPath);
  const command = async (commandArgs: string[], jsonOutput = true): Promise<any> => {
    const child = Bun.spawn([process.execPath, current.currentCli, ...commandArgs], { cwd: f.home, env: { ...withoutDataDirOverrideEnv({ ...process.env }), HOME: f.home, CODEX_HOME: join(f.home, ".codex"), PATH: process.env.PATH!, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(status).toBe(0); return jsonOutput ? JSON.parse(stdout) : stdout;
  };
  const run = (extra: string[] = []) => command([...args, ...extra]);
  const preview = await run(); expect(preview.status).toBe("recovery-review-required"); expect(preview.nativeStateVerified).toBe(true); expect(preview.recoveryPlan.configDiscoveryRecovery).toBeDefined();
  if (additionVersion) expect(preview.recoveryPlan.nativeHookAdditions.additions).toEqual(additionVersion === 2 ? expectedAdditions : addedNative);
  expect(existsSync(join(journal, "receipt.json"))).toBe(false);
  expect(preview.bindingRefreshRequired).toBe(true);
  let receipt: any;
  if (format === "json") receipt = await run(["--recovery-plan-digest", preview.recoveryPlanDigest]);
  else {
    const output = await command([...args.filter(arg => arg !== "--json"), "--recovery-plan-digest", preview.recoveryPlanDigest], false);
    expect(output).toContain("Managed context remains blocked"); expect(output).toContain("fresh --discovery-inputs"); expect(output).toContain("Policy was not changed");
    receipt = JSON.parse(readFileSync(join(journal, "receipt.json"), "utf8"));
  }
  expect(receipt.reconciled).toBe(true); expect(receipt.recoveryPlanDigest).toBe(preview.recoveryPlanDigest); expect(receipt.bindingRefreshRequired).toBe(true);
  expect(readFileSync(f.configPath)).toEqual(beforeConfig); expect(readFileSync(policyPath)).toEqual(beforePolicy); expect(existsSync(marker)).toBe(false);
  const originalReceipt = readFileSync(join(journal, "receipt.json")), oldPackage = readFileSync(f.cli);
  const reviewPath = join(f.home, "discovery-review.json");
  const writeReview = () => writeFileSync(reviewPath, JSON.stringify({ version: 1, agents: [{ agent: "codex", roots: [], sources: captureDiscoveryByteSources([f.configPath]), pluginHooks: "reviewed-no-skill-injection" }] }), { mode: 0o600 });
  writeReview();
  const install = ["hook", "install", "--agent", "codex", "--command", current.currentCli, "--discovery-inputs", reviewPath, "--json"];
  await command([...install, "--apply"]);
  const installedPolicy = readFileSync(policyPath), installedHooks = readFileSync(f.hooksPath);
  const trust = ["hook", "trust", "--agent", "codex", "--codex-command", process.env.SKILLS_TEST_CODEX_COMMAND!, "--json"];
  const trustPlan = await command(trust); expect(trustPlan.planned).toHaveLength(3);
  let applied: any;
  if (format === "json") applied = await command([...trust, "--apply", "--plan-digest", trustPlan.planDigest]);
  else {
    const output = await command([...trust.filter(arg => arg !== "--json"), "--apply", "--plan-digest", trustPlan.planDigest], false);
    expect(output).toContain("Managed context remains blocked"); expect(output).toContain("fresh --discovery-inputs and the same --command"); expect(output).toContain("Policy was not changed");
    const created = readdirSync(journalRoot).filter(name => join(journalRoot, name) !== journal); expect(created).toHaveLength(1);
    applied = JSON.parse(readFileSync(join(journalRoot, created[0]!, "receipt.json"), "utf8"));
  }
  expect(applied.nativeEligible).toBe(true); expect(applied.bindingRefreshRequired).toBe(true); expect(applied.nativeExecutionVerified).toBe(false);
  expect(readFileSync(policyPath)).toEqual(installedPolicy); expect(readFileSync(f.hooksPath)).toEqual(installedHooks);
  expect(() => assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Native discovery input changed");
  const enrolledConfig = readFileSync(f.configPath), nativeReceipt = readFileSync(join(applied.journal, "receipt.json"));
  writeReview();
  const refreshPlan = await command(install); expect(refreshPlan.planned).toEqual([policyPath]);
  const refreshed = await command([...install, "--apply"]); expect(refreshed.changed).toEqual([policyPath]);
  expect(readFileSync(f.configPath)).toEqual(enrolledConfig); expect(readFileSync(f.hooksPath)).toEqual(installedHooks);
  assertManagedAgentBridge("codex", { home: f.home, dataDir: f.dataDir, projectDir: f.home });
  const finalPolicy = JSON.parse(readFileSync(policyPath, "utf8")), expectedPolicy = JSON.parse(installedPolicy.toString());
  expectedPolicy.bridge.discovery.codex.sources.find((source: any) => source.hashMode === "bytes").sha256 = createHash("sha256").update(enrolledConfig).digest("hex");
  expect(finalPolicy).toEqual(expectedPolicy);
  const finalPlan = await command(trust); expect(finalPlan.planned).toHaveLength(0); expect(finalPlan.nativeEligible).toBe(true); expect(finalPlan.bindingRefreshRequired).toBe(false);
  expect(readdirSync(journalRoot)).toHaveLength(2); expect(readFileSync(join(journal, "receipt.json"))).toEqual(originalReceipt); expect(readFileSync(join(applied.journal, "receipt.json"))).toEqual(nativeReceipt);
  expect(readFileSync(f.configPath)).toEqual(enrolledConfig); expect(readFileSync(f.hooksPath)).toEqual(installedHooks); expect(readFileSync(f.cli)).toEqual(oldPackage); expect(existsSync(marker)).toBe(false);
  if (additionVersion) {
    const rpc = await connect({ home: f.home });
    try {
      const final = await rpc.request("hooks/list", { cwds: [f.home] });
      const finalStates = (Bun.TOML.parse(readFileSync(f.configPath, "utf8")) as any).hooks.state;
      for (const hook of addedNative) expect(nativeProjection(final.data[0].hooks.find((entry: any) => entry.key === hook.key))).toEqual(hook);
      for (const addition of expectedAdditions) expect(finalStates[addition.nativeHook.key]).toEqual(addition.trustState);
    }
    finally { await rpc.close(); }
  }
}, 60000);

for (const mutation of ["unreviewed", "conflicting-mode", "codex-profile", "codex-command", "codex-discovery", "root-alias", "claude-method", "claude-directories", "unrelated-policy", "missing-inventory", "journal", "config", "hooks", "old-cli", "runner", "artifact", "discovery-source", "reason"] as const) test(`discovery recovery refuses ${mutation} before native RPC`, async () => {
  const f = await discoveryRecoveryFixture(), options: any = structuredClone(f.options);
  if (mutation === "unreviewed") delete options.claudeDiscoveryRecovery;
  else if (mutation === "conflicting-mode") options.supersedeBinding = true;
  else if (mutation === "codex-profile") f.policy.bridge.profiles.codex = "changed";
  else if (mutation === "codex-command") f.policy.bridge.commands.codex += "-changed";
  else if (mutation === "codex-discovery") f.policy.bridge.discovery.codex.roots.push(join(f.home, "extra"));
  else if (mutation === "root-alias") delete f.policy.bridge.rootAliases;
  else if (mutation === "claude-method") f.policy.bridge.discovery.claude.method = "automatic";
  else if (mutation === "claude-directories") f.policy.bridge.discovery.claude.directories = [];
  else if (mutation === "unrelated-policy") f.policy.profileId = "changed";
  else if (mutation === "missing-inventory" || mutation === "journal") { const intent = JSON.parse(readFileSync(join(f.journal, "intent.json"), "utf8")); if (mutation === "missing-inventory") delete intent.nativeHooks; else intent.planDigest = "0".repeat(64); writeFileSync(join(f.journal, "intent.json"), JSON.stringify(intent)); }
  else if (mutation === "config") writeFileSync(f.configPath, readFileSync(f.configPath, "utf8").replace('model = "synthetic"', 'model = "changed"'));
  else if (mutation === "hooks") writeFileSync(f.hooksPath, readFileSync(f.hooksPath, "utf8") + "\n");
  else if (mutation === "old-cli") writeFileSync(f.cli, "#!/usr/bin/env bun\n// changed old binding\n");
  else if (mutation === "runner") options.reviewedSkillsCli.sha256 = "0".repeat(64);
  else if (mutation === "artifact") options.releaseProof.packageTarSha256 = "0".repeat(64);
  else if (mutation === "discovery-source") writeFileSync(f.discoverySource, "changed discovery\n");
  else options.claudeDiscoveryRecovery.reason = "";
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  await expect(reconcileCodexNativeHooks(options, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(f.calls).toHaveLength(0); expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
});

for (const mutation of ["review-digest", "review-reason", "later-policy", "extraNative", "changedHash", "changedCommand", "untrusted", "unrelated-native", "override", "disabled", "native-second-read", "concurrent-policy", "concurrent-config", "concurrent-source", "concurrent-runner", "concurrent-old-cli", "receipt-race"] as const) test(`discovery recovery refuses ${mutation} without a recovery receipt`, async () => {
  const f = await discoveryRecoveryFixture(), preview = await reconcileCodexNativeHooks(f.options, f.connect);
  const options = { ...f.options, claudeDiscoveryRecovery: { ...f.options.claudeDiscoveryRecovery, reviewedPlanDigest: preview.recoveryPlanDigest } };
  if (mutation === "review-digest") options.claudeDiscoveryRecovery.reviewedPlanDigest = "0".repeat(64);
  if (mutation === "review-reason") options.claudeDiscoveryRecovery.reason = "different review";
  if (mutation === "later-policy") { f.policy.bridge.discovery.claude.roots.push(join(f.home, "later-root")); writeFileSync(f.policyPath, JSON.stringify(f.policy)); }
  if (["extraNative", "changedHash", "changedCommand", "override", "disabled"].includes(mutation)) f.setMode(mutation);
  if (mutation === "untrusted") f.entries[0]!.trustStatus = "untrusted";
  if (mutation === "unrelated-native") f.entries.at(-1)!.enabled = true;
  let reads = 0;
  const connect = async () => { const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
    const result = await rpc.request(method, params);
    if (method === "config/read" && ++reads === 2) {
      if (mutation === "native-second-read") (result as any).layers[0].disabledReason = "new override";
      const changedFile = { "concurrent-policy": f.policyPath, "concurrent-config": f.configPath, "concurrent-source": f.discoverySource, "concurrent-runner": f.currentCli, "concurrent-old-cli": f.cli }[mutation as string];
      if (changedFile) writeFileSync(changedFile, readFileSync(changedFile, "utf8") + "\n");
      if (mutation === "receipt-race") writeFileSync(join(f.journal, "receipt.json"), "existing exclusive receipt\n", { mode: 0o600 });
    }
    return result;
  } }; };
  await expect(reconcileCodexNativeHooks(options, connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  if (mutation === "receipt-race") expect(readFileSync(join(f.journal, "receipt.json"), "utf8")).toBe("existing exclusive receipt\n");
  else expect(existsSync(join(f.journal, "receipt.json"))).toBe(false);
  expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
});

for (const profile of ["synthetic; true #", "../synthetic", "synthetic\ntrue", ""]) test(`coherent policy and declaration profile tampering refuses ${JSON.stringify(profile)}`, async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.bridge.profiles.codex = profile; writeFileSync(policyPath, JSON.stringify(policy));
  const hooks = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  for (const groups of Object.values(hooks.hooks) as any[]) groups[0].hooks[0].command = groups[0].hooks[0].command.replace("--selection-profile synthetic", "--selection-profile " + profile);
  writeFileSync(f.hooksPath, JSON.stringify(hooks));
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_REFUSED");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

test("native discovery changed after planning refuses immediately before write", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect);
  const racing = async () => {
    const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
      const result = await rpc.request(method, params); if (method === "config/read") f.setMode("changedHash"); return result;
    } };
  };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, racing)).rejects.toThrow("NATIVE_DISCOVERY_CHANGED");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("an unverified native release refuses before discovery", async () => {
  const f = fixture();
  await expect(enrollCodexNativeHooks(f, async () => ({ ...await f.connect(), version: "codex-cli 0.999.0" }))).rejects.toThrow("NATIVE_UNSUPPORTED_VERSION");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});


test("read-only package witnesses admit stable Bun cache hardlinks", async () => {
  const f = fixture();
  linkSync(f.cli, join(f.home, "cached-cli.js"));
  linkSync(join(f.home, "package/package.json"), join(f.home, "cached-package.json"));
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect((await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).nativeEligible).toBe(true);
});
for (const kind of ["cli", "manifest"]) for (const drift of ["bytes", "link count"]) test(`changed hardlinked ${kind} ${drift} refuses before native write`, async () => {
  const f = fixture(), source = kind === "cli" ? f.cli : join(f.home, "package/package.json"), cached = join(f.home, "cached-package-file");
  linkSync(source, cached);
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const racing = async () => {
    const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
      const result = await rpc.request(method, params);
      if (method === "config/read") {
        if (drift === "bytes") writeFileSync(cached, readFileSync(cached, "utf8") + "\n");
        else linkSync(cached, join(f.home, "another-package-link"));
      }
      return result;
    } };
  };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, racing)).rejects.toThrow("CODEX_HOOK_TRUST_INPUT_CHANGED");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
for (const kind of ["config", "hooks", "policy"]) test(`hardlinked ${kind} remains refused before native discovery`, async () => {
  const f = fixture(), source = kind === "config" ? f.configPath : kind === "hooks" ? f.hooksPath : join(f.dataDir, "agent-policy.json");
  linkSync(source, join(f.home, "linked-private-file"));
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_UNSAFE_FILE");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
