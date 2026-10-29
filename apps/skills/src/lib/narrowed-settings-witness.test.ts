import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  captureClaudeSettingsV5, hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3,
  hashClaudeSettingsReplacementV4, hashClaudeSettingsReplacementV5, upgradeClaudeSettingsWitnessV5,
} from "./claude-settings-witness.js";
import {
  captureCodexSettingsV7, hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4,
  hashCodexSettingsReplacementV5, hashCodexSettingsReplacementV7, upgradeCodexSettingsWitnessV7,
} from "./codex-settings-witness.js";
import { NARROWED_WITNESS_LEDGER_FILE, narrowedLegacyWitnessMode, openNarrowedWitnessLedger } from "./narrowed-witness-ledger.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";
import { boundedDriftReason, clearNativeDriftReceipt, isNativeSkillDrift, NATIVE_DRIFT_AGENT_NOTICE, NativeSkillPolicyRefusal, nativeDriftFailOpen, nativeDriftWarning, readNativeDriftReceipts, recordNativeDriftReceipt } from "./native-drift-receipt.js";
import { renderOpenCodePlugin } from "./agent-adapters.js";
import { renderHermesSupervisor } from "./agent-hermes.js";
import { renderSumiPlugin } from "./agent-sumi.js";

useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const budget = () => ({ remaining: 1024 * 1024 });
const text = (value: unknown) => JSON.stringify(value);
const claude = {
  v1: (t: string) => hashClaudeSettingsReplacement(t, budget()), v2: (t: string) => hashClaudeSettingsReplacementV2(t, budget()),
  v3: (t: string) => hashClaudeSettingsReplacementV3(t, budget()), v4: (t: string) => hashClaudeSettingsReplacementV4(t, budget()),
  v5: (t: string) => hashClaudeSettingsReplacementV5(t, budget()),
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scratch = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-narrowed-"))); roots.push(root); return root; };

// The station shape: Skills bridge entries, the user's own allow rules,
// a status line, a model and display preferences.
const base = {
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  model: "opus", effortLevel: "high", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } },
  permissions: { allow: ["Skill(skills-cli)", "Bash(npm run lint)"], deny: ["Read(./.env)"], defaultMode: "default" },
  hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/opt/skills/bin/skills hook user-prompt --agent claude" }] }] },
  env: { EXAMPLE_FLAG: "1" },
  enabledPlugins: { "vendor@market": true },
  disableBundledSkills: true, syncClaudeAiSkills: false,
  statusLine: { type: "command", command: "/opt/status/line" },
  showTurnDuration: true,
};

test("claude-settings-v5 ignores every ordinary-use setting, including any model", () => {
  const reviewed = claude.v5(text(base));
  const ordinary: Array<[string, (value: any) => void]> = [
    ["custom model", value => { value.model = "deepseek-flash"; }],
    ["current model", value => { value.model = "claude-opus-5-5"; }],
    ["sonnet 5.5", value => { value.model = "claude-sonnet-5-5"; }],
    ["haiku 5.5", value => { value.model = "claude-haiku-5-5"; }],
    ["provider path model", value => { value.model = "custom-provider/model-x"; }],
    ["non-string model", value => { value.model = 5; }],
    ["model removed", value => { delete value.model; }],
    ["modelSettings", value => { value.modelSettings = { "deepseek-flash": { effortLevel: "xhigh", maxEffortLevel: "xhigh" } }; }],
    ["effort", value => { value.effortLevel = "max"; }],
    ["always allow", value => { value.permissions.allow.push("Bash(npm test)", "WebFetch(domain:example.com)"); }],
    ["deny rule", value => { value.permissions.deny.push("Bash(rm *)"); }],
    ["ask rule", value => { value.permissions.ask = ["Bash(git push *)"]; }],
    ["default mode", value => { value.permissions.defaultMode = "bypassPermissions"; }],
    ["status line", value => { value.statusLine = { type: "command", command: "/opt/other/status" }; }],
    ["env", value => { value.env = { EXAMPLE_FLAG: "2", ANTHROPIC_BASE_URL: "https://example.invalid" }; }],
    ["custom theme", value => { value.theme = "custom:dracula"; }],
    ["tui", value => { value.tui = "fullscreen"; }],
    ["view", value => { value.viewMode = "focus"; }],
    ["dialog acknowledgment", value => { value.skipDangerousModePermissionPrompt = true; }],
    ["subagent status line", value => { value.subagentStatusLine = { type: "command", command: "/opt/other/status" }; }],
    ["unknown preference", value => { value.futurePreference = { anything: [1, 2.0] }; }],
  ];
  for (const [label, mutate] of ordinary) {
    const next = structuredClone(base) as any; mutate(next);
    if (claude.v5(text(next)) !== reviewed) throw new Error(`v5 bound ${label}`);
  }
  // Key order and whitespace carry no meaning.
  expect(claude.v5(JSON.stringify(base, null, 2))).toBe(reviewed);
  expect(claude.v5(text(Object.fromEntries(Object.entries(base).reverse())))).toBe(reviewed);
});

test("claude-settings-v5 binds every setting that can add, remove or redirect skills, hooks or plugins", () => {
  const reviewed = claude.v5(text(base));
  const discovery: Array<[string, (value: any) => void]> = [
    ["hook added", value => { value.hooks.PostToolUse = [{ hooks: [{ type: "command", command: "/opt/foreign" }] }]; }],
    ["hook command changed", value => { value.hooks.UserPromptSubmit[0].hooks[0].command = "/tmp/other"; }],
    ["hooks removed", value => { delete value.hooks; }],
    ["disableAllHooks", value => { value.disableAllHooks = true; }],
    ["plugin enabled", value => { value.enabledPlugins["other@market"] = true; }],
    ["plugin disabled", value => { value.enabledPlugins["vendor@market"] = false; }],
    ["marketplace", value => { value.extraKnownMarketplaces = { m: { source: { source: "github", repo: "x/y" } } }; }],
    ["plugin config", value => { value.pluginConfigs = { "vendor@market": { mcpServers: {} } }; }],
    ["bundled skills", value => { value.disableBundledSkills = false; }],
    ["account skills", value => { value.syncClaudeAiSkills = true; }],
    ["skills directory", value => { value.skillsDirectory = "/opt/skills"; }],
    ["future hook key", value => { value.allowManagedHooksOnly = true; }],
    ["Skill allow removed", value => { value.permissions.allow = value.permissions.allow.filter((rule: string) => !rule.startsWith("Skill")); }],
    ["Skill deny added", value => { value.permissions.deny.push("Skill"); }],
    ["Skill ask added", value => { value.permissions.ask = ["Skill(other)"]; }],
    ["added directory", value => { value.permissions.additionalDirectories = ["/"]; }],
    ["config dir", value => { value.env.CLAUDE_CONFIG_DIR = "/tmp/claude"; }],
    ["plugin env", value => { value.env.EXTRA_PLUGIN_ROOT = "/tmp/plugins"; }],
    ["malformed permissions", value => { value.permissions = "allow-all"; }],
    ["malformed rule list", value => { value.permissions.allow = "Skill(*)"; }],
    ["non-string rule", value => { value.permissions.allow.push({ rule: "Skill(*)" }); }],
    ["malformed env", value => { value.env = ["CLAUDE_CONFIG_DIR=/tmp"]; }],
    // Settings that run a command the way a hook does, or select injected instructions.
    ["api key helper", value => { value.apiKeyHelper = "/bin/key-helper"; }],
    ["aws auth refresh", value => { value.awsAuthRefresh = "/bin/aws-refresh"; }],
    ["aws credential export", value => { value.awsCredentialExport = "/bin/aws-export"; }],
    ["otel headers helper", value => { value.otelHeadersHelper = "/bin/otel-headers"; }],
    ["file suggestion", value => { value.fileSuggestion = { type: "command", command: "/bin/files" }; }],
    ["output style", value => { value.outputStyle = "Explanatory"; }],
    ["main agent", value => { value.agent = "foreign-agent"; }],
  ];
  const digests = new Set<string>([reviewed]);
  for (const [label, mutate] of discovery) {
    const next = structuredClone(base) as any; mutate(next);
    const digest = claude.v5(text(next));
    if (digest === reviewed) throw new Error(`v5 ignored ${label}`);
    digests.add(digest);
  }
  expect(digests.size).toBe(discovery.length + 1);
  // Domain separated from every earlier mode, and strict parsing is unchanged.
  for (const mode of [claude.v1, claude.v2, claude.v3, claude.v4]) expect(mode(text(base))).not.toBe(reviewed);
  for (const invalid of ['{"a":1,"a":2}', "[]", "{} trailing", '{"hooks":'] as const) expect(() => claude.v5(invalid)).toThrow("Claude settings witness");
});

test("every legacy Claude mode binds what v5 binds: equal legacy digests imply equal v5 digests", () => {
  const variants: unknown[] = [base, {}, { model: "sonnet" }, { theme: "light" }];
  const mutations: Array<(value: any) => void> = [
    value => { value.model = "haiku"; }, value => { value.hooks = {}; }, value => { value.permissions = { allow: ["Skill(skills-cli)"] }; },
    value => { value.enabledPlugins = {}; }, value => { value.theme = "dark"; }, value => { value.effortLevel = "low"; }, value => { value.showTurnDuration = false; },
    value => { value.env = { CLAUDE_CONFIG_DIR: "/x" }; }, value => { value.editorMode = "vim"; },
  ];
  for (const mutate of mutations) { const next = structuredClone(base) as any; mutate(next); variants.push(next); }
  const inputs = variants.map(text);
  for (const mode of [claude.v1, claude.v2, claude.v3, claude.v4]) for (const a of inputs) for (const b of inputs) {
    if (mode(a) === mode(b)) expect(claude.v5(a)).toBe(claude.v5(b));
  }
});

const codexBase = `model = "gpt-5.1"
model_reasoning_effort = "high"

[features]
codex_hooks = true
web_search = true

[plugins."hasna-codex@hasna-internal-bridge"]
enabled = true

[marketplaces.hasna-internal-bridge]
source_type = "local"
source = "/opt/bridge"

[skills.bundled]
enabled = false

[[skills.config]]
path = "/opt/cache/skill/SKILL.md"
enabled = false

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "/opt/skills/stop"
timeout = 30

[hooks.state]
"stop:0:0" = { enabled = true, trusted_hash = "abc" }

[profiles.fast]
model = "gpt-5.1-mini"
`;
const codex = {
  v1: (t: string) => hashCodexSettingsReplacement(t), v2: (t: string) => hashCodexSettingsReplacementV2(t), v3: (t: string) => hashCodexSettingsReplacementV3(t),
  v4: (t: string) => hashCodexSettingsReplacementV4(t), v5: (t: string) => hashCodexSettingsReplacementV5(t), v7: (t: string) => hashCodexSettingsReplacementV7(t),
};

test("codex-settings-v7 ignores what Codex rewrites on a model change, a folder trust and its notices", () => {
  const reviewed = codex.v7(codexBase);
  const ordinary = [
    codexBase.replace('model = "gpt-5.1"', 'model = "gpt-5.2-codex"').replace('"high"', '"xhigh"'),
    `service_tier = "fast"\nmodel_verbosity = "low"\nnotify = ["/opt/notify"]\nmodel_provider = "other"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n${codexBase}`,
    `${codexBase}\n[notice]\nhide_full_access_warning = true\n\n[notice.model_migrations]\n"gpt-5.1" = "gpt-5.2-codex"\n`,
    `${codexBase}\n[projects."/Users/someone/repo"]\ntrust_level = "trusted"\n`,
    `${codexBase}\n[tui]\nstatus_line = ["model"]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-5.2" = 3\n`,
    `${codexBase}\n[model_providers.other]\nbase_url = "https://example.invalid"\n`,
    `profile = "fast"\n${codexBase}`,
    codexBase.replace('"stop:0:0" = { enabled = true, trusted_hash = "abc" }', '"stop:0:0" = { enabled = true, trusted_hash = "def" }'),
    `${codexBase}\n[[skills.config]]\nname = "vendor:skill"\nenabled = false\n`,
    codexBase.replace('model = "gpt-5.1-mini"', 'model = "gpt-5.2-mini"\nmodel_reasoning_effort = "low"'),
    codexBase.replace("web_search = true", "web_search = false"),
  ];
  for (const [index, variant] of ordinary.entries()) if (codex.v7(variant) !== reviewed) throw new Error(`v7 bound ordinary variant ${index}`);
});

test("codex-settings-v7 binds hooks, plugins, marketplaces, enabling skill rules and hook or plugin features", () => {
  const reviewed = codex.v7(codexBase);
  const discovery = [
    `${codexBase}\n[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "/opt/foreign"\n`,
    codexBase.replace('command = "/opt/skills/stop"', 'command = "/tmp/other"'),
    codexBase.replace("timeout = 30", "timeout = 31"),
    `${codexBase}\n[plugins."foreign@market"]\nenabled = true\n`,
    codexBase.replace('[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = true', '[plugins."hasna-codex@hasna-internal-bridge"]\nenabled = false'),
    codexBase.replace('source = "/opt/bridge"', 'source = "/tmp/bridge"'),
    codexBase.replace("[skills.bundled]\nenabled = false", "[skills.bundled]\nenabled = true"),
    `${codexBase}\n[[skills.config]]\npath = "/opt/cache/skill/SKILL.md"\nenabled = true\n`,
    codexBase.replace("codex_hooks = true", "codex_hooks = false"),
    codexBase.replace("web_search = true", "web_search = true\nplugins = true"),
    codexBase.replace('model = "gpt-5.1-mini"', 'model = "gpt-5.1-mini"\n\n[profiles.fast.features]\ncodex_hooks = false'),
    `plugin_roots = ["/opt/plugins"]\n${codexBase}`,
    `features = "all"\n${codexBase.replace("[features]\ncodex_hooks = true\nweb_search = true\n", "")}`,
    // MCP servers, whole: an mcp_tool hook handler runs through a named server.
    `${codexBase}\n[mcp_servers.docs]\ncommand = "/opt/mcp/docs"\n`,
    `${codexBase}\n[mcp_servers.remote]\nurl = "https://mcp.example.invalid/a"\n`,
    codexBase.replace('model = "gpt-5.1-mini"', 'model = "gpt-5.1-mini"\n\n[profiles.fast.mcp_servers.docs]\ncommand = "/opt/mcp/docs"'),
    // Instruction sources, at the root and in a profile.
    `developer_instructions = "Load native skill copies."\n${codexBase}`,
    `model_instructions_file = "/tmp/instructions.md"\n${codexBase}`,
    `experimental_instructions_file = "/tmp/instructions.md"\n${codexBase}`,
    `project_doc_fallback_filenames = ["SKILL.md"]\n${codexBase}`,
    `experimental_compact_prompt_file = "/tmp/compact.md"\n${codexBase}`,
    codexBase.replace('model = "gpt-5.1-mini"', 'model = "gpt-5.1-mini"\nmodel_instructions_file = "/tmp/instructions.md"'),
    // Subagent roles: config_file loads a layer with developer_instructions.
    `${codexBase}\n[agents.reviewer]\nconfig_file = "/tmp/reviewer.toml"\n`,
    `${codexBase}\n[agents.reviewer]\ndescription = "Loads native skill copies."\n`,
  ];
  const digests = new Set([reviewed]);
  for (const [index, variant] of discovery.entries()) {
    const digest = codex.v7(variant);
    if (digest === reviewed) throw new Error(`v7 ignored discovery variant ${index}`);
    digests.add(digest);
  }
  expect(digests.size).toBe(discovery.length + 1);
  for (const mode of [codex.v1, codex.v2, codex.v3, codex.v4, codex.v5]) expect(mode(codexBase)).not.toBe(reviewed);
  expect(() => codex.v7("= invalid")).toThrow("Invalid Codex settings witness");
});

test("every legacy Codex mode binds what v7 binds: equal legacy digests imply equal v7 digests", () => {
  const variants = [codexBase, "", 'model = "gpt-5.1"\n', `service_tier = "fast"\n${codexBase}`, `${codexBase}\n[tui]\nstatus_line = ["model"]\n`,
    codexBase.replace("codex_hooks = true", "codex_hooks = false"), `${codexBase}\n[[skills.config]]\nname = "a:b"\nenabled = false\n`,
    codexBase.replace("timeout = 30", "timeout = 30.0"), `${codexBase}\n[plugins."x@y"]\nenabled = true\n`];
  for (const mode of [codex.v1, codex.v2, codex.v3, codex.v4, codex.v5]) for (const a of variants) for (const b of variants) {
    if (mode(a) === mode(b)) expect(codex.v7(a)).toBe(codex.v7(b));
  }
});

test("explicit v5 and v7 upgrades prove the preserved preimage and refuse any discovery change", () => {
  const root = scratch();
  for (const directory of ["current/.claude", "preimage/.claude", "current/.codex", "preimage/.codex"]) mkdirSync(join(root, directory), { recursive: true });
  const settings = join(root, "current/.claude/settings.json"), settingsPreimage = join(root, "preimage/.claude/settings.json");
  writeFileSync(settingsPreimage, text(base)); writeFileSync(settings, text({ ...base, model: "deepseek-flash" }));
  for (const previous of [{ path: settings, hashMode: "bytes" as const, sha256: sha(text(base)) }, { path: settings, hashMode: "claude-settings-v4" as const, sha256: claude.v4(text(base)) }, { path: settings, hashMode: "claude-settings-v1" as const, sha256: claude.v1(text(base)) }]) {
    expect(upgradeClaudeSettingsWitnessV5(previous, settingsPreimage)).toEqual({ path: settings, hashMode: "claude-settings-v5", sha256: claude.v5(text({ ...base, model: "deepseek-flash" })) });
  }
  expect(captureClaudeSettingsV5(settings)).toEqual({ path: settings, hashMode: "claude-settings-v5", sha256: claude.v5(text(base)) });
  expect(() => upgradeClaudeSettingsWitnessV5({ path: settings, hashMode: "claude-settings-v4", sha256: claude.v3(text(base)) }, settingsPreimage)).toThrow("does not match the prior witness");
  expect(() => upgradeClaudeSettingsWitnessV5({ path: settings, hashMode: "claude-settings-v5" as never, sha256: claude.v5(text(base)) }, settingsPreimage)).toThrow("exact prior settings witness");
  writeFileSync(settings, text({ ...base, enabledPlugins: { ...base.enabledPlugins, "x@y": true } }));
  expect(() => upgradeClaudeSettingsWitnessV5({ path: settings, hashMode: "claude-settings-v4", sha256: claude.v4(text(base)) }, settingsPreimage)).toThrow("discovery settings changed");

  const config = join(root, "current/.codex/config.toml"), configPreimage = join(root, "preimage/.codex/config.toml");
  writeFileSync(configPreimage, codexBase); writeFileSync(config, `${codexBase}\n[projects."/repo"]\ntrust_level = "trusted"\n`);
  for (const previous of [{ path: config, hashMode: "codex-settings-v5" as const, sha256: codex.v5(codexBase) }, { path: config, hashMode: "codex-settings-v2" as const, sha256: codex.v2(codexBase) }, { path: config, sha256: sha(codexBase) }]) {
    expect(upgradeCodexSettingsWitnessV7(previous, configPreimage)).toEqual({ path: config, hashMode: "codex-settings-v7", sha256: codex.v7(codexBase) });
  }
  expect(captureCodexSettingsV7(config).sha256).toBe(codex.v7(codexBase));
  expect(() => upgradeCodexSettingsWitnessV7({ path: config, hashMode: "codex-settings-v6" as never, sha256: "a".repeat(64) }, configPreimage)).toThrow();
  writeFileSync(config, `${codexBase}\n[plugins."x@y"]\nenabled = true\n`);
  expect(() => upgradeCodexSettingsWitnessV7({ path: config, hashMode: "codex-settings-v5", sha256: codex.v5(codexBase) }, configPreimage)).toThrow("outside the reviewed V7 contract");
});

test("the policy schema accepts v5 and v7 only for their reviewed agent configuration", () => {
  const policy = (agent: string, method: string, path: string, hashMode: string) => ({ bridge: { discovery: { [agent]: { agent, method, roots: [], sources: [{ path, hashMode, sha256: "a".repeat(64) }] } } } });
  expect(() => assertAgentPolicyCollections(policy("claude", "reviewed", "/home/u/.claude/settings.json", "claude-settings-v5"))).not.toThrow();
  expect(() => assertAgentPolicyCollections(policy("codex", "reviewed", "/home/u/.codex/config.toml", "codex-settings-v7"))).not.toThrow();
  for (const [agent, method, path, mode] of [["claude", "automatic", "/home/u/.claude/settings.json", "claude-settings-v5"], ["codex", "reviewed", "/home/u/.claude/settings.json", "claude-settings-v5"], ["claude", "reviewed", "/home/u/.claude/other.json", "claude-settings-v5"],
    ["codex", "automatic", "/home/u/.codex/config.toml", "codex-settings-v7"], ["claude", "reviewed", "/home/u/.codex/config.toml", "codex-settings-v7"], ["codex", "reviewed", "/home/u/.codex/other.toml", "codex-settings-v7"],
    ["claude", "reviewed", "/home/u/.claude/settings.json", "claude-settings-v6"], ["codex", "reviewed", "/home/u/.codex/config.toml", "codex-settings-v8"]]) {
    expect(() => assertAgentPolicyCollections(policy(agent!, method!, path!, mode!))).toThrow();
  }
});

test("the narrowed ledger records only a verified legacy match and accepts only an unchanged narrowed projection", () => {
  const root = scratch(), data = join(root, "data"), home = join(root, "home");
  mkdirSync(data); mkdirSync(join(home, ".claude"), { recursive: true });
  const settings = join(home, ".claude", "settings.json");
  writeFileSync(settings, text(base));
  const source = { path: settings, hashMode: "claude-settings-v4" as const, sha256: claude.v4(text(base)) };
  expect(narrowedLegacyWitnessMode(source)).toBe("claude-settings-v5");
  expect(narrowedLegacyWitnessMode({ path: settings, sha256: sha(text(base)) })).toBe("claude-settings-v5");
  expect(narrowedLegacyWitnessMode({ path: join(home, "other", "settings.json"), sha256: sha(text(base)) })).toBeNull();
  expect(narrowedLegacyWitnessMode({ path: settings, hashMode: "claude-settings-v5", sha256: "a".repeat(64) })).toBeNull();
  expect(narrowedLegacyWitnessMode({ path: join(home, ".codex", "config.toml"), hashMode: "codex-settings-v6", sha256: "a".repeat(64), hookSources: [] })).toBeNull();
  expect(narrowedLegacyWitnessMode({ path: settings, sha256: sha(text(base)), format: "json", fields: ["hooks"] })).toBeNull();

  // Nothing recorded yet: a changed file is not accepted.
  writeFileSync(settings, text({ ...base, model: "deepseek-flash" }));
  const first = openNarrowedWitnessLedger(data);
  expect(first.accepts(source)).toBe(false);
  // An observation of a file the legacy witness does not verify records nothing.
  first.observe(source); first.flush();
  expect(existsSync(join(data, NARROWED_WITNESS_LEDGER_FILE))).toBe(false);

  // A verified observation is recorded from the same bytes.
  writeFileSync(settings, text(base));
  const second = openNarrowedWitnessLedger(data);
  second.observe(source); second.flush();
  const recorded = JSON.parse(readFileSync(join(data, NARROWED_WITNESS_LEDGER_FILE), "utf8"));
  expect(recorded.entries).toEqual([{ path: settings, hashMode: "claude-settings-v4", sha256: source.sha256, narrowedMode: "claude-settings-v5", narrowedSha256: claude.v5(text(base)), recordedAt: expect.any(String) }]);

  // Ordinary use is accepted; a discovery change is not.
  writeFileSync(settings, text({ ...base, model: "claude-opus-5-5", permissions: { ...base.permissions, allow: [...base.permissions.allow, "Bash(*)"] } }));
  const third = openNarrowedWitnessLedger(data);
  expect(third.accepts(source)).toBe(true);
  expect(third.accepted).toEqual([settings]);
  writeFileSync(settings, text({ ...base, model: "claude-opus-5-5", hooks: { ...base.hooks, Stop: [{ hooks: [{ type: "command", command: "/opt/foreign" }] }] } }));
  expect(openNarrowedWitnessLedger(data).accepts(source)).toBe(false);
  // The entry is bound to the exact legacy witness: a new review does not reuse it.
  writeFileSync(settings, text({ ...base, model: "claude-opus-5-5" }));
  expect(openNarrowedWitnessLedger(data).accepts({ ...source, sha256: "b".repeat(64) })).toBe(false);
  expect(openNarrowedWitnessLedger(data).accepts({ ...source, hashMode: "claude-settings-v3" })).toBe(false);
});

test("concurrent hooks for different agents both keep their ledger observation", () => {
  // Review finding (2026-10-20): flush() replaced the whole ledger, so a Claude
  // and a Codex prompt at the same moment could drop one observation.
  const root = scratch(), data = join(root, "data"), home = join(root, "home");
  mkdirSync(data); mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(home, ".codex"), { recursive: true });
  const settings = join(home, ".claude", "settings.json"), config = join(home, ".codex", "config.toml");
  writeFileSync(settings, text(base)); writeFileSync(config, codexBase);
  const claudeSource = { path: settings, hashMode: "claude-settings-v4" as const, sha256: claude.v4(text(base)) };
  const codexSource = { path: config, hashMode: "codex-settings-v5" as const, sha256: codex.v5(codexBase) };
  // Both hooks open the empty ledger before either flushes.
  const claudeHook = openNarrowedWitnessLedger(data), codexHook = openNarrowedWitnessLedger(data);
  claudeHook.observe(claudeSource); codexHook.observe(codexSource);
  claudeHook.flush(); codexHook.flush();
  const entries = JSON.parse(readFileSync(join(data, NARROWED_WITNESS_LEDGER_FILE), "utf8")).entries;
  expect(entries.map((entry: any) => entry.path).sort()).toEqual([settings, config].sort());
  // A later observation of an already recorded witness keeps the first entry.
  const again = openNarrowedWitnessLedger(data); again.observe(claudeSource); again.flush();
  expect(JSON.parse(readFileSync(join(data, NARROWED_WITNESS_LEDGER_FILE), "utf8")).entries).toEqual(entries);
  // Ordinary use is then accepted for both agents.
  writeFileSync(settings, text({ ...base, model: "deepseek-flash" }));
  writeFileSync(config, codexBase.replace('model = "gpt-5.1"', 'model = "gpt-5.2-codex"'));
  const later = openNarrowedWitnessLedger(data);
  expect([later.accepts(claudeSource), later.accepts(codexSource)]).toEqual([true, true]);
});

test("a malformed, oversized or linked ledger accepts nothing and is never overwritten", () => {
  const root = scratch(), data = join(root, "data"), home = join(root, "home");
  mkdirSync(data); mkdirSync(join(home, ".codex"), { recursive: true });
  const config = join(home, ".codex", "config.toml"); writeFileSync(config, codexBase);
  const source = { path: config, hashMode: "codex-settings-v5" as const, sha256: codex.v5(codexBase) };
  const ledger = join(data, NARROWED_WITNESS_LEDGER_FILE);
  // A forged entry for the current narrowed digest is ignored when the file is malformed.
  writeFileSync(ledger, JSON.stringify({ schema: "hasna.skills.narrowed-witness-ledger.v1", entries: [{ path: config, hashMode: "codex-settings-v5", sha256: source.sha256, narrowedMode: "codex-settings-v7", narrowedSha256: "c".repeat(64), recordedAt: "x", extra: 1 }] }));
  const before = readFileSync(ledger, "utf8");
  const opened = openNarrowedWitnessLedger(data);
  expect(opened.accepts(source)).toBe(false);
  opened.observe(source); opened.flush();
  expect(readFileSync(ledger, "utf8")).toBe(before);
  writeFileSync(ledger, "x".repeat(300 * 1024));
  expect(openNarrowedWitnessLedger(data).accepts(source)).toBe(false);
  rmSync(ledger);
  const target = join(root, "elsewhere.json"); writeFileSync(target, "{}");
  symlinkSync(target, ledger);
  const linked = openNarrowedWitnessLedger(data);
  linked.observe(source); linked.flush();
  expect(readFileSync(target, "utf8")).toBe("{}");
  // Codex's screen-reader receipt still verifies the legacy witness, so it is observed.
  rmSync(ledger);
  writeFileSync(config, `${codexBase}\n[tui]\nscreen_reader_detection_done = true\n`);
  const receipt = openNarrowedWitnessLedger(data); receipt.observe(source); receipt.flush();
  expect(JSON.parse(readFileSync(ledger, "utf8")).entries[0].narrowedSha256).toBe(codex.v7(codexBase));
});

test("drift receipts are bounded, escaped, private and never create the app home", () => {
  const root = scratch(), data = join(root, "data");
  const message = "NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: /home/u/.claude/settings‮.json\n";
  expect(recordNativeDriftReceipt(data, "claude", "UserPromptSubmit", message)).toBeNull();
  expect(existsSync(data)).toBe(false);
  mkdirSync(data);
  const path = recordNativeDriftReceipt(data, "claude", "UserPromptSubmit", message, new Date("2026-10-20T13:00:00Z"))!;
  expect(path).toBe(join(data, "native-drift", "claude.json"));
  recordNativeDriftReceipt(data, "claude", "SessionStart", message, new Date("2026-10-20T13:05:00Z"));
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  expect(receipt).toMatchObject({ schema: "hasna.skills.native-drift-receipt.v1", agent: "claude", status: "active", promptBlocked: false, skillsContext: "omitted", firstSeenAt: "2026-10-20T13:00:00.000Z", lastSeenAt: "2026-10-20T13:05:00.000Z", occurrences: 2 });
  expect(receipt.reason).toContain("settings\\u202e.json\\u000a");
  expect(receipt.reason).not.toContain("‮");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(data, "native-drift")).mode & 0o777).toBe(0o700);
  expect(nativeDriftWarning("claude", message, path)).not.toContain("‮");
  expect(boundedDriftReason("NATIVE_SKILL_DRIFT: " + "x".repeat(10_000)).length).toBe(4000);
  clearNativeDriftReceipt(data, "claude", new Date("2026-10-20T13:10:00Z"));
  expect(readNativeDriftReceipts(data)).toEqual([expect.objectContaining({ agent: "claude", status: "cleared", clearedAt: "2026-10-20T13:10:00.000Z", occurrences: 2 })]);
  expect(isNativeSkillDrift(new Error(message))).toBe(true);
  expect(isNativeSkillDrift(new NativeSkillPolicyRefusal("NATIVE_SKILL_DRIFT: invoke only skills-cli"))).toBe(false);
  expect(isNativeSkillDrift(new Error("DISCOVERY_ROOT_UNRESOLVED: x"))).toBe(false);
  expect(() => recordNativeDriftReceipt(data, "../x", "e", message)).not.toThrow();
  expect(recordNativeDriftReceipt(data, "../x", "e", message)).toBeNull();
});

test("every adapter's drift envelope is one its native consumer accepts without refusing", () => {
  const root = scratch(), data = join(root, "data"); mkdirSync(data);
  const message = "NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: /home/u/.claude/settings.json";
  // The exact acceptance checks the managed plugins and supervisor apply to a
  // CLI result, read from the rendered sources so a contract change is noticed.
  const opencode = renderOpenCodePlugin("/opt/skills", "default"), sumi = renderSumiPlugin("/opt/skills", "default"), hermes = renderHermesSupervisor("/opt/skills", "default");
  expect(opencode).toContain('if (result.decision === "block" || result.continue === false) return deny();');
  expect(opencode).toContain('output.hookEventName !== input.hook_event_name || typeof output.additionalContext !== "string") return unavailable("INVALID_RESPONSE");');
  expect(opencode).toContain('if (input.hook_event_name === "BeforeTool" && result.nativeBridgeVerified !== true) return deny();');
  expect(sumi).toContain('if (result.decision === "block" || result.continue === false) throw');
  expect(sumi).toContain("result.hookSpecificOutput.hookEventName !== input.hook_event_name");
  expect(hermes).toContain('(output.action === "continue" && keys === "action")');
  expect(hermes).toContain('keys !== "context"');
  const contextPlugin = (result: any, event: string) => {
    if (result.decision === "block" || result.continue === false) return "refused";
    if (Object.keys(result).length && (!result.hookSpecificOutput || result.hookSpecificOutput.hookEventName !== event)) return "invalid";
    return result.hookSpecificOutput?.additionalContext ?? "";
  };
  for (const agent of ["sumi", "opencode"]) for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStart"]) {
    const text = contextPlugin(nativeDriftFailOpen(data, agent, event, event, message), event);
    expect(text).toStartWith("Skills warning: native discovery changed");
    expect(text).toContain("Skills context is unavailable for this turn");
  }
  const tool = nativeDriftFailOpen(data, "hermes", "pre_tool_call", "pre_tool_call", message);
  expect(Object.keys(tool).sort().join(",")).toBe("action"); expect(tool.action).toBe("continue");
  const prompt = nativeDriftFailOpen(data, "hermes", "UserPromptSubmit", "pre_llm_call", message);
  expect(Object.keys(prompt).sort().join(",")).toBe("context"); expect(prompt.context).toStartWith("Skills warning:");
  const cursor = nativeDriftFailOpen(data, "cursor", "UserPromptSubmit", "beforeSubmitPrompt", message) as any;
  expect(Object.keys(cursor).sort()).toEqual(["continue", "user_message"]); expect(cursor.continue).toBe(true); expect(cursor.user_message).toStartWith("Skills warning:");
  for (const agent of ["claude", "gemini"]) {
    const event = agent === "claude" ? "PreToolUse" : "BeforeTool";
    const decision = nativeDriftFailOpen(data, agent, event, event, message) as any;
    expect(Object.keys(decision)).toEqual(["systemMessage"]); expect(decision.systemMessage).toStartWith("Skills warning:");
  }
  for (const [agent, event, nativeEvent] of [["claude", "UserPromptSubmit", "UserPromptSubmit"], ["claude", "SessionStart", "SessionStart"], ["codex", "SubagentStart", "SubagentStart"], ["gemini", "UserPromptSubmit", "BeforeAgent"]] as const) {
    const result = nativeDriftFailOpen(data, agent, event, nativeEvent, message) as any;
    expect(result.decision).toBeUndefined(); expect(result.continue).toBeUndefined();
    expect(result.systemMessage).toContain("/home/u/.claude/settings.json");
    expect(result.hookSpecificOutput).toEqual({ hookEventName: nativeEvent, additionalContext: expect.stringContaining("Skills context is unavailable for this turn") });
  }
  expect(readNativeDriftReceipts(data).map(receipt => receipt.agent).sort()).toEqual(["claude", "codex", "cursor", "gemini", "hermes", "opencode", "sumi"]);
});

test("a redirected MCP server is never accepted through the ledger, whatever the legacy Codex witness", () => {
  // Review finding (2026-10-20): an mcp_tool hook runs through a named server,
  // so a server redirect must stay drift. Every legacy mode binds remote
  // servers; raw bytes and V1/V2 also bind local stdio ones.
  const reviewed = `${codexBase}\n[mcp_servers.remote]\nurl = "https://mcp.example.invalid/a"\n\n[mcp_servers.docs]\ncommand = "/opt/mcp/docs"\n`;
  const modelChange = (text: string) => text.replace('model = "gpt-5.1"', 'model = "deepseek-flash"');
  const remoteRedirect = (text: string) => text.replace("https://mcp.example.invalid/a", "https://attacker.example.invalid/a");
  const localRedirect = (text: string) => text.replace('command = "/opt/mcp/docs"', 'command = "/tmp/other-docs"');
  const witnesses = [
    (path: string) => ({ path, sha256: sha(reviewed) }),
    (path: string) => ({ path, hashMode: "codex-settings-v2" as const, sha256: codex.v2(reviewed) }),
    (path: string) => ({ path, hashMode: "codex-settings-v5" as const, sha256: codex.v5(reviewed) }),
  ];
  for (const witness of witnesses) {
    const root = scratch(), data = join(root, "data"), config = join(root, "home", ".codex", "config.toml");
    mkdirSync(data); mkdirSync(join(root, "home", ".codex"), { recursive: true });
    writeFileSync(config, reviewed);
    const source = witness(config);
    const observed = openNarrowedWitnessLedger(data); observed.observe(source); observed.flush();
    expect(JSON.parse(readFileSync(join(data, NARROWED_WITNESS_LEDGER_FILE), "utf8")).entries).toHaveLength(1);
    // Control: a model change alone is accepted.
    writeFileSync(config, modelChange(reviewed));
    expect(openNarrowedWitnessLedger(data).accepts(source)).toBe(true);
    for (const redirect of [remoteRedirect, localRedirect, (text: string) => modelChange(remoteRedirect(text)), (text: string) => modelChange(localRedirect(text))]) {
      writeFileSync(config, redirect(reviewed));
      expect(openNarrowedWitnessLedger(data).accepts(source)).toBe(false);
    }
  }
  // The documented exception: codex-settings-v3..v5 omit an ordinary local
  // stdio server that V7 binds, so equal V5 digests need not mean equal V7 ones.
  expect(codex.v5(localRedirect(reviewed))).toBe(codex.v5(reviewed));
  expect(codex.v7(localRedirect(reviewed))).not.toBe(codex.v7(reviewed));
});

test("the real Sumi plugin accepts the drift envelope: the prompt proceeds and the warning reaches the model context", async () => {
  const root = scratch(), data = join(root, "data"); mkdirSync(data);
  const mode = join(root, "mode"), command = join(root, "fixture-skills"), pluginPath = join(root, "plugin.js");
  writeFileSync(mode, "drift");
  // The CLI's own fail-open builder; only the guard result is synthetic. The
  // "refused" mode is the negative control: the same plugin rejects a block.
  writeFileSync(command, `#!${process.execPath}
import { readFileSync } from "node:fs";
import { nativeDriftFailOpen } from ${JSON.stringify(resolve(import.meta.dir, "native-drift-receipt.ts"))};
const input = JSON.parse(await Bun.stdin.text());
const message = "NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: /home/u/.config/sumi/sumi.json";
console.log(JSON.stringify(readFileSync(${JSON.stringify(mode)}, "utf8") === "refused" ? { decision: "block", reason: message } : nativeDriftFailOpen(${JSON.stringify(data)}, "sumi", input.hook_event_name, input.hook_event_name, message)));
`); chmodSync(command, 0o700);
  writeFileSync(pluginPath, renderSumiPlugin(command, "engineering"));
  const plugin = (await import(pluginPath)).default;
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const register = async (name: string, callback: any) => { hooks.set(name, callback); return { dispose: async () => {} }; };
  await plugin.setup({
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: root } }), hook: register },
    tool: { hook: register }, skill: { transform: async () => ({ dispose: async () => {} }) },
  });
  await hooks.get("prompt")!({ sessionID: "owner", prompt: { text: "continue the task" } });
  const event = { sessionID: "owner", system: [] as Array<{ type: string; text: string }>, messages: [] };
  await hooks.get("context")!(event);
  expect(event.system).toHaveLength(1);
  expect(event.system[0]!.text).toStartWith("Skills warning: native discovery changed; this prompt was not blocked");
  expect(event.system[0]!.text).toContain("sumi.json");
  expect(event.system[0]!.text).toContain(NATIVE_DRIFT_AGENT_NOTICE);
  expect(readNativeDriftReceipts(data)).toEqual([expect.objectContaining({ agent: "sumi", status: "active", promptBlocked: false })]);
  // The payload-skill guard of the same plugin still refuses under drift.
  expect(() => hooks.get("execute.before")!({ tool: "skill", input: { id: "some-payload" } })).toThrow();
  writeFileSync(mode, "refused");
  await expect(hooks.get("prompt")!({ sessionID: "owner", prompt: { text: "again" } })).rejects.toThrow("Skills verification blocked this request");
});
