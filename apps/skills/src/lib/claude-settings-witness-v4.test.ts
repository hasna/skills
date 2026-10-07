import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  CLAUDE_BUILTIN_THEMES, captureClaudeSettingsV3, captureClaudeSettingsV4, hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2,
  hashClaudeSettingsReplacementV3, hashClaudeSettingsReplacementV4, upgradeClaudeSettingsWitness, upgradeClaudeSettingsWitnessV4,
} from "./claude-settings-witness.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planAgentSettingsWitnessUpgrade, planClaudeHookEventsUpdate } from "./agent-integration.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";
import { installCorpusInspectorFixture } from "./codex-corpus.fixture.js";

useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const budget = () => ({ remaining: 1024 * 1024 });
const v1 = (text: string) => hashClaudeSettingsReplacement(text, budget());
const v2 = (text: string) => hashClaudeSettingsReplacementV2(text, budget());
const v3 = (text: string) => hashClaudeSettingsReplacementV3(text, budget());
const v4 = (text: string) => hashClaudeSettingsReplacementV4(text, budget());

// A representative user settings file. Every key below is bound by v3 except the
// documented preferences (built-in model, effort, display booleans/enums).
const base = {
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  permissions: { allow: ["Bash(npm run lint)"], deny: ["Read(./.env)"], defaultMode: "default" },
  hooks: { Stop: [{ hooks: [{ type: "command", command: "/opt/skills/bin/skills hook stop" }] }] },
  env: { EXAMPLE_FLAG: "1" },
  enabledPlugins: { "vendor@market": true },
  model: "opus",
  effortLevel: "high",
  modelSettings: { "claude-future-9": { effortLevel: "medium" } },
  skipDangerousModePermissionPrompt: false,
  showTurnDuration: true,
  editorMode: "vim",
};
const text = (value: unknown) => JSON.stringify(value);

test("the built-in theme list is pinned to the documented values and frozen", () => {
  // https://code.claude.com/docs/en/settings-reference#theme, read 2026-10-07.
  expect([...CLAUDE_BUILTIN_THEMES]).toEqual(["auto", "dark", "light", "dark-daltonized", "light-daltonized", "dark-ansi", "light-ansi"]);
  expect(Object.isFrozen(CLAUDE_BUILTIN_THEMES)).toBe(true);
});

test("prior witness modes reproduce digests computed by the unchanged base implementation", () => {
  // Pinned from origin/main addc45fe (0.10.48 witness source) before v4 existed.
  const controls: Record<string, [string, { v1: string; v2: string; v3: string }]> = {
    empty: ["{}", { v1: "04f99b946fffdf7b294cb61bf102fab93c44ea4667015e4218749a2f84c6aded", v2: "69ab284240c665288fbd0c8aa3e69ae495fb128f3a79c892f36ffd66515127cb", v3: "ac390c98f2f9f2413f0ee75155ee68c8076ca631a7529c1b4cca35fb46740512" }],
    base: [text(base), { v1: "c43c31e1dc795414eeac1bf2e2d7b8a05832859384dd2f85a67bc2cac24d522f", v2: "900da6c85c2a8399a9a902b15736b07f4cc0e8b2ce1722816173b12affe3a3ad", v3: "4f9aaff63248bfec0cfa067eccd3bb3b4beeac7a96ce999cbfa181ac802e5cca" }],
    baseLight: [text({ ...base, theme: "light" }), { v1: "cd885a9f844ec845e629c213586380958d5090ce2f999002e3d549f9da291e2a", v2: "6e530f926612a3f2459d1953815d6be31ad6525fe7c377bc0a5c41f9b6b66920", v3: "d2fed985452523c6eea38fb49f699786dde99a1a43b1376ff4188c5318bd89a4" }],
    baseCustom: [text({ ...base, theme: "custom:dracula" }), { v1: "a7a4da1ab4573e6698ad41152d1b7bfb53a8ce036e4414394b723a05db07b668", v2: "2811a2b03a38c22dd8be2e9c041106708ceedf31f8c53e0c4aa09039047db47e", v3: "daa7b3124cabc9faf4f1330248783856a0da67974d0dec4a87aecd83f1639a43" }],
    baseSkip: [text({ ...base, skipDangerousModePermissionPrompt: true }), { v1: "52f3b1a6442311ec28f4f55403add2f158e2c6febc94f90f29b7fc7861d1aa77", v2: "b4cfc37486bd4952b09439a1a21ad8657e57e13258b6825b986202c0cd41187f", v3: "40c254bb1e1f55290c51233c6d122ec303f44a414646dcb02f2cd0e2b7fd1cfa" }],
  };
  for (const [input, expected] of Object.values(controls)) expect({ v1: v1(input), v2: v2(input), v3: v3(input) }).toEqual(expected);
  // v3 still binds every theme, including the built-in presets.
  for (const theme of CLAUDE_BUILTIN_THEMES) expect(v3(text({ ...base, theme }))).not.toBe(v3(text(base)));
});

test("v4 accepts theme-only drift for each built-in value", () => {
  const without = v4(text(base));
  for (const theme of CLAUDE_BUILTIN_THEMES) {
    expect(v4(text({ ...base, theme }))).toBe(without);
    for (const other of CLAUDE_BUILTIN_THEMES) expect(v4(text({ ...base, theme: other }))).toBe(v4(text({ ...base, theme })));
  }
  // Escaped spellings decode to the same documented string.
  expect(v4(text(base).replace(/}$/, ',"theme":"\\u006cight"}'))).toBe(without);
  // Domain separated: a v4 digest never equals the v3 digest of the same file.
  expect(without).not.toBe(v3(text(base)));
});

test("v4 binds custom, plugin, unknown, wrong-case and non-string themes", () => {
  const without = v4(text(base)), light = v4(text({ ...base, theme: "light" }));
  const bound: unknown[] = ["custom:dracula", "custom:plugin-name:slug", "custom:light", "Light", "LIGHT", "Dark", "light ", " dark", "light\n", "dark-ANSI",
    "solarized", "", "default", "system", "dark-daltonized-ansi", "light-ansi:x", true, false, null, 0, 1, ["light"], { base: "light" }, { name: "dark" }];
  const digests = new Set<string>();
  for (const theme of bound) {
    const digest = v4(text({ ...base, theme }));
    expect(digest).not.toBe(without);
    expect(digest).not.toBe(light);
    digests.add(digest);
  }
  expect(digests.size).toBe(bound.length);
  // A custom theme change is drift exactly as under v3.
  expect(v4(text({ ...base, theme: "custom:a" }))).not.toBe(v4(text({ ...base, theme: "custom:b" })));
});

test("v4 never inspects nested theme keys", () => {
  for (const nested of [{ env: { ...base.env, theme: "light" } }, { statusLine: { type: "command", command: "/bin/status", theme: "dark" } }, { modelSettings: { ...base.modelSettings, theme: "light" } }, { permissions: { ...base.permissions, theme: "auto" } }]) {
    const withNested = { ...base, ...nested };
    const withoutNested = JSON.parse(JSON.stringify(withNested));
    for (const value of Object.values(withoutNested)) if (value && typeof value === "object" && !Array.isArray(value)) delete (value as Record<string, unknown>).theme;
    expect(v4(text(withNested))).not.toBe(v4(text(withoutNested)));
  }
});

test("v4 refuses every authority-bearing change, with or without a theme change", () => {
  const mutations: Array<[string, (value: any) => void]> = [
    ["skipDangerousModePermissionPrompt enabled", value => { value.skipDangerousModePermissionPrompt = true; }],
    ["skipDangerousModePermissionPrompt removed", value => { delete value.skipDangerousModePermissionPrompt; }],
    ["permissions.allow added", value => { value.permissions.allow.push("Bash(curl *)"); }],
    ["permissions.deny removed", value => { value.permissions.deny = []; }],
    ["permissions.defaultMode bypass", value => { value.permissions.defaultMode = "bypassPermissions"; }],
    ["permissions.additionalDirectories", value => { value.permissions.additionalDirectories = ["/"]; }],
    ["hooks added", value => { value.hooks.PreToolUse = [{ hooks: [{ type: "command", command: "/tmp/x" }] }]; }],
    ["hook command changed", value => { value.hooks.Stop[0].hooks[0].command = "/tmp/other"; }],
    ["disableAllHooks", value => { value.disableAllHooks = true; }],
    ["env changed", value => { value.env.EXAMPLE_FLAG = "2"; }],
    ["env added", value => { value.env.ANTHROPIC_BASE_URL = "https://example.invalid"; }],
    ["custom model", value => { value.model = "custom-provider/model-x"; }],
    ["model path", value => { value.model = "../instructions"; }],
    ["apiKeyHelper", value => { value.apiKeyHelper = "/bin/key-helper"; }],
    ["awsAuthRefresh", value => { value.awsAuthRefresh = "/bin/refresh"; }],
    ["otelHeadersHelper", value => { value.otelHeadersHelper = "/bin/otel"; }],
    ["statusLine", value => { value.statusLine = { type: "command", command: "/bin/status" }; }],
    ["enabledPlugins", value => { value.enabledPlugins["other@market"] = true; }],
    ["extraKnownMarketplaces", value => { value.extraKnownMarketplaces = { m: { source: { source: "github", repo: "x/y" } } }; }],
    ["outputStyle", value => { value.outputStyle = "custom"; }],
    ["language", value => { value.language = "fr"; }],
    ["modelSettings extra property", value => { value.modelSettings["claude-future-9"].maxEffortLevel = "xhigh"; }],
    ["unknown key", value => { value.futureControl = 1; }],
  ];
  for (const preimageTheme of [undefined, "dark"]) for (const currentTheme of [undefined, "light", "auto"]) {
    const preimage = structuredClone(base) as any;
    if (preimageTheme !== undefined) preimage.theme = preimageTheme;
    for (const [label, mutate] of mutations) {
      const current = structuredClone(preimage);
      if (currentTheme !== undefined) current.theme = currentTheme;
      mutate(current);
      if (v4(text(current)) === v4(text(preimage))) throw new Error(`v4 accepted ${label} (theme ${preimageTheme} -> ${currentTheme})`);
    }
  }
  // The station15 shape: theme added together with the authority-bearing acknowledgment.
  expect(v4(text({ ...base, theme: "light", skipDangerousModePermissionPrompt: true }))).not.toBe(v4(text(base)));
  // Invalid recognized values are refused exactly as v3 refuses them.
  for (const invalid of [{ skipDangerousModePermissionPrompt: "yes" }, { effortLevel: "max" }, { showTurnDuration: "true" }, { editorMode: "emacs" }, { model: 5 }]) {
    const input = text({ ...base, theme: "light", ...invalid });
    expect(() => v3(input)).toThrow("Claude settings witness");
    expect(() => v4(input)).toThrow("Claude settings witness");
  }
});

test("without a theme, v4 groups settings exactly as v3 does", () => {
  const variants = [
    base, { ...base, model: "sonnet" }, { ...base, effortLevel: "low" }, { ...base, showTurnDuration: false }, { ...base, editorMode: "normal" },
    { ...base, modelSettings: { "claude-future-9": { effortLevel: "xhigh" } } }, { ...base, model: "custom-x" }, { ...base, skipDangerousModePermissionPrompt: true },
    { ...base, env: {} }, { ...base, permissions: { ...base.permissions, allow: [] } }, {}, { unknown: 1 }, { unknown: 1.0 },
  ].map(text);
  // Number spelling stays bound in both modes.
  variants.push(text({ unknown: 1 }).replace("1", "1.0"));
  for (const a of variants) for (const b of variants) expect(v4(a) === v4(b)).toBe(v3(a) === v3(b));
});

let restoreInspector: () => void;
const homes: string[] = [];
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true }); });

function reviewedClaude(mode: "claude-settings-v3" | "claude-settings-v4", initial: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-claude-v4-")); homes.push(home);
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"] }));
  const config = join(home, ".claude/settings.json"), policyPath = join(f.dataDir, "agent-policy.json");
  const installed = JSON.parse(readFileSync(config, "utf8"));
  writeFileSync(config, JSON.stringify({ ...installed, ...initial }));
  const binding = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude;
  const source = mode === "claude-settings-v4" ? captureClaudeSettingsV4(config) : captureClaudeSettingsV3(config);
  const reviewed = { version: 1 as const, agents: [{ agent: "claude" as const, roots: binding.roots, sources: binding.sources.map((s: any) => s.path === config ? source : s), pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], discoveryInputs: reviewed }));
  // The automatic enabledPlugins/extraKnownMarketplaces projection of the same
  // file is retained beside the typed witness; select the typed witness.
  const witness = () => JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude.sources.find((s: any) => s.path === config && s.format === undefined);
  expect(witness().hashMode).toBe(mode);
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  return { ...f, config, policyPath, witness, settings: () => JSON.parse(readFileSync(config, "utf8")) };
}

test("the managed bridge verifies a reviewed v4 witness across built-in theme drift and refuses authority drift", () => {
  const f = reviewedClaude("claude-settings-v4");
  const reviewed = f.settings();
  for (const theme of CLAUDE_BUILTIN_THEMES) {
    writeFileSync(f.config, JSON.stringify({ ...reviewed, theme }));
    expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  }
  for (const drift of [{ theme: "custom:dracula" }, { theme: "Light" }, { theme: "light", skipDangerousModePermissionPrompt: true }, { theme: "dark", permissions: { ...reviewed.permissions, allow: [...(reviewed.permissions?.allow ?? []), "Bash(*)"] } }, { theme: "auto", apiKeyHelper: "/bin/k" }]) {
    writeFileSync(f.config, JSON.stringify({ ...reviewed, ...drift }));
    expect(() => assertManagedAgentBridge("claude", f)).toThrow("Native discovery input changed");
  }
  writeFileSync(f.config, JSON.stringify(reviewed));
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
});

test("a normal reinstall retains a reviewed v4 witness after built-in theme drift", () => {
  const f = reviewedClaude("claude-settings-v4");
  const stored = f.witness();
  writeFileSync(f.config, JSON.stringify({ ...f.settings(), theme: "light-ansi" }));
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, projectDir: f.projectDir, agents: ["claude"] }));
  expect(f.witness()).toEqual(stored);
  expect(f.settings().theme).toBe("light-ansi");
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  writeFileSync(f.config, JSON.stringify({ ...f.settings(), theme: "custom:dracula" }));
  expect(() => planAgentIntegration({ home: f.home, dataDir: f.dataDir, projectDir: f.projectDir, agents: ["claude"] })).toThrow();
});

test("a reviewed v3 witness keeps its exact meaning: a built-in theme still refuses", () => {
  const f = reviewedClaude("claude-settings-v3");
  const reviewed = f.settings(), stored = f.witness();
  writeFileSync(f.config, JSON.stringify({ ...reviewed, theme: "light" }));
  expect(() => assertManagedAgentBridge("claude", f)).toThrow("Native discovery input changed");
  // Nothing silently rewrote the stored v3 witness.
  expect(f.witness()).toEqual(stored);
});

for (const mode of ["claude-settings-v3", "claude-settings-v4"] as const) test(`registered Claude settings consumers rebind a ${mode} witness in its own mode`, () => {
  const f = reviewedClaude(mode, mode === "claude-settings-v4" ? { theme: "dark" } : {});
  const before = readFileSync(f.config, "utf8"), stored = f.witness();
  const next = JSON.parse(before);
  next.hooks = { ...(next.hooks ?? {}), Stop: [{ hooks: [{ type: "command", command: "/opt/hooks/bin/stop-check" }] }] };
  const replacement = JSON.stringify(next);
  const plan = planClaudeHookEventsUpdate({ ...f, events: ["Stop"], expectedSettingsSha256: sha(before), replacement });
  expect(plan).not.toBeNull();
  applyAgentIntegration(plan!);
  expect(readFileSync(f.config, "utf8")).toBe(replacement);
  expect(f.witness().hashMode).toBe(mode);
  expect(f.witness().sha256).not.toBe(stored.sha256);
  expect(f.witness().sha256).toBe(mode === "claude-settings-v4" ? v4(replacement) : v3(replacement));
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  writeFileSync(f.config, JSON.stringify({ ...next, theme: "light" }));
  if (mode === "claude-settings-v4") expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  else expect(() => assertManagedAgentBridge("claude", f)).toThrow("Native discovery input changed");
});

test("an explicit preserved-preimage upgrade moves v3 to v4 only when theme is the whole drift", () => {
  const f = reviewedClaude("claude-settings-v3");
  const reviewedText = readFileSync(f.config, "utf8"), stored = f.witness();
  const preservedDir = join(f.home, "preserved"); mkdirSync(preservedDir);
  const preimage = join(preservedDir, "settings.json"); writeFileSync(preimage, reviewedText);
  expect(readFileSync(preimage, "utf8")).toBe(reviewedText);
  const policyBefore = readFileSync(f.policyPath, "utf8");
  const options = (current: string) => ({ ...f, agent: "claude" as const, targetClaudeVersion: 4 as const, reviewedPreimage: preimage, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(current) });

  // station15 shape: theme plus the authority-bearing acknowledgment refuses.
  const unsafe = JSON.stringify({ ...JSON.parse(reviewedText), theme: "light", skipDangerousModePermissionPrompt: true });
  writeFileSync(f.config, unsafe);
  expect(() => planAgentSettingsWitnessUpgrade(options(unsafe))).toThrow("non-preference settings changed");
  for (const theme of ["custom:dracula", "LIGHT"]) {
    const custom = JSON.stringify({ ...JSON.parse(reviewedText), theme });
    writeFileSync(f.config, custom);
    expect(() => planAgentSettingsWitnessUpgrade(options(custom))).toThrow("non-preference settings changed");
  }

  // station07 shape: the whole drift is a built-in theme.
  const current = JSON.stringify({ ...JSON.parse(reviewedText), theme: "light" });
  writeFileSync(f.config, current);
  expect(() => assertManagedAgentBridge("claude", f)).toThrow("Native discovery input changed");
  // The default target remains v3, which refuses to re-witness a v3 review.
  expect(() => planAgentSettingsWitnessUpgrade({ ...options(current), targetClaudeVersion: undefined })).toThrow("exact legacy settings witness");
  expect(() => planAgentSettingsWitnessUpgrade({ ...options(current), targetClaudeVersion: 5 as never })).toThrow("Invalid Claude witness target version");
  expect(() => planAgentSettingsWitnessUpgrade({ ...options(current), agent: "codex" })).toThrow("Invalid Claude witness target version");
  const wrongPreimage = join(preservedDir, "other", "settings.json"); mkdirSync(join(preservedDir, "other"));
  writeFileSync(wrongPreimage, JSON.stringify({ ...JSON.parse(reviewedText), env: { CHANGED: "1" } }));
  expect(() => planAgentSettingsWitnessUpgrade({ ...options(current), reviewedPreimage: wrongPreimage })).toThrow("does not match the prior witness");
  expect(readFileSync(f.policyPath, "utf8")).toBe(policyBefore);

  const plan = planAgentSettingsWitnessUpgrade(options(current));
  expect(plan.settingsWitnessUpgrade).toMatchObject({ agent: "claude", fromHashMode: "claude-settings-v3", fromSha256: stored.sha256, toHashMode: "claude-settings-v4", toSha256: v4(current) });
  expect(plan.changes.map(change => change.path)).toEqual([f.policyPath]);
  const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policyBefore);
  expect(readFileSync(f.config, "utf8")).toBe(current);
  const after = JSON.parse(readFileSync(f.policyPath, "utf8")), old = JSON.parse(policyBefore);
  const others = (policy: any) => policy.bridge.discovery.claude.sources.filter((s: any) => s.path !== f.config || s.format !== undefined);
  expect(others(after)).toEqual(others(old));
  expect(f.witness()).toEqual({ path: f.config, hashMode: "claude-settings-v4", sha256: v4(current) });
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  writeFileSync(f.config, JSON.stringify({ ...JSON.parse(current), theme: "dark-ansi" }));
  expect(() => assertManagedAgentBridge("claude", f)).not.toThrow();
  writeFileSync(f.config, unsafe);
  expect(() => assertManagedAgentBridge("claude", f)).toThrow("Native discovery input changed");
});

test("the v4 upgrade helper accepts only exact prior witnesses and the legacy helper still targets v3", () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-claude-v4-unit-")); homes.push(home);
  mkdirSync(join(home, "a")); mkdirSync(join(home, "b"));
  const current = join(home, "a", "settings.json"), preimage = join(home, "b", "settings.json");
  writeFileSync(preimage, text(base)); writeFileSync(current, text({ ...base, theme: "light-daltonized" }));
  for (const previous of [
    { path: current, hashMode: "bytes" as const, sha256: sha(text(base)) },
    { path: current, sha256: sha(text(base)) },
    { path: current, hashMode: "claude-settings-v1" as const, sha256: v1(text(base)) },
    { path: current, hashMode: "claude-settings-v2" as const, sha256: v2(text(base)) },
    { path: current, hashMode: "claude-settings-v3" as const, sha256: v3(text(base)) },
  ]) expect(upgradeClaudeSettingsWitnessV4(previous, preimage)).toEqual({ path: current, hashMode: "claude-settings-v4", sha256: v4(text({ ...base, theme: "light-daltonized" })) });
  expect(() => upgradeClaudeSettingsWitnessV4({ path: current, hashMode: "claude-settings-v4" as never, sha256: v4(text(base)) }, preimage)).toThrow("exact prior settings witness");
  expect(() => upgradeClaudeSettingsWitnessV4({ path: current, hashMode: "claude-settings-v3", sha256: v3(text(base)), extra: 1 } as never, preimage)).toThrow("exact prior settings witness");
  expect(() => upgradeClaudeSettingsWitnessV4({ path: current, hashMode: "claude-settings-v3", sha256: v2(text(base)) }, preimage)).toThrow("does not match the prior witness");
  // The legacy helper keeps its v3 target and still binds the theme.
  expect(() => upgradeClaudeSettingsWitness({ path: current, hashMode: "claude-settings-v2", sha256: v2(text(base)) }, preimage)).toThrow("non-preference settings changed");
});

test("the policy schema accepts claude-settings-v4 only for a reviewed Claude settings.json source", () => {
  const policy = (agent: string, method: string, path: string) => ({ bridge: { discovery: { [agent]: { agent, method, roots: [], sources: [{ path, hashMode: "claude-settings-v4", sha256: "a".repeat(64) }] } } } });
  expect(() => assertAgentPolicyCollections(policy("claude", "reviewed", "/home/u/.claude/settings.json"))).not.toThrow();
  for (const [agent, method, path] of [["claude", "automatic", "/home/u/.claude/settings.json"], ["codex", "reviewed", "/home/u/.claude/settings.json"], ["claude", "reviewed", "/home/u/.claude/other.json"], ["claude", "reviewed", "relative/settings.json"]]) {
    expect(() => assertAgentPolicyCollections(policy(agent!, method!, path!))).toThrow();
  }
  expect(() => assertAgentPolicyCollections({ bridge: { discovery: { claude: { agent: "claude", method: "reviewed", roots: [], sources: [{ path: "/home/u/.claude/settings.json", hashMode: "claude-settings-v5", sha256: "a".repeat(64) }] } } } })).toThrow();
});

test("the CLI captures an explicit claude-settings-v4 witness and validates the rebind target", async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-claude-v4-cli-")); homes.push(home);
  mkdirSync(join(home, ".claude"));
  const settings = join(home, ".claude", "settings.json"); writeFileSync(settings, text({ ...base, theme: "dark-ansi" }));
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli/index.tsx"), ...args], { cwd: home, env: { ...process.env, HOME: home, HASNA_SKILLS_DIR: join(home, "data") }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  const captured = await run(["hook", "witness", "--kind", "claude-settings-v4", "--path", settings, "--json"]);
  expect(captured.status).toBe(0);
  expect(JSON.parse(captured.stdout)).toEqual({ path: settings, hashMode: "claude-settings-v4", sha256: v4(text(base)) });
  const refused = await run(["hook", "rebind-settings", "--agent", "claude", "--claude-witness-version", "5", "--reviewed-preimage", settings, "--expected-policy-sha256", "0".repeat(64), "--expected-settings-sha256", "0".repeat(64), "--json"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr.trim()).toBe("Claude witness version accepts 3 or 4");
});
