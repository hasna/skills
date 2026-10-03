import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planAgentSettingsWitnessUpgrade } from "./agent-integration.js";
import { captureCodexSettingsV2, captureCodexSettingsV3, hashCodexSettingsReplacementV2 as v2, hashCodexSettingsReplacementV3 as v3 } from "./codex-settings-witness.js";
useDefaultTestTimeout();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const BASE = 'model = "gpt-6.1-sol"\nretained = -0.0\n';
const LOCAL = '[mcp_servers.workflows]\ncommand = "/runtime/0.2.0/workflows"\nargs = ["--stdio", "0.2.0"]\nstartup_timeout_sec = 30.00\ntool_timeout_sec = 10\n';
function station(version: 2 | 3 = 3) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-codex-local-mcp-")); homes.push(home);
  const dataDir = join(home, "data"), configPath = join(home, ".codex/config.toml"), policyPath = join(dataDir, "agent-policy.json");
  mkdirSync(join(home, ".codex")); writeFileSync(configPath, BASE + LOCAL);
  const f = { home, dataDir, projectDir: home, configPath, policyPath };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: { version: 1, agents: [{ agent: "codex", roots: [], sources: [(version === 3 ? captureCodexSettingsV3 : captureCodexSettingsV2)(configPath)], pluginHooks: "reviewed-no-skill-injection" }] } }));
  return f;
}

test("ordinary local runtime, tool policy, addition/removal and numeric timeout updates keep v3 without policy writes", () => {
  const alternatives = [LOCAL, LOCAL.replaceAll("0.2.0", "0.2.1"), LOCAL.replace("30.00", "50.5").replace("= 10", "= 7.0"),
    LOCAL + '[mcp_servers.workflows.env]\nMODE = "safe"\n',
    LOCAL + '[mcp_servers.workflows.tools.run]\napproval_mode = "prompt"\noutput_token_limit = 1000\n',
    LOCAL + '[mcp_servers.second]\ncommand = "/other"\nenv_vars = ["PATH", {name = "MODE", source = "local"}]\n', ""];
  for (const row of alternatives) { expect(v3(BASE + row)).toBe(v3(BASE)); if (row) expect(v2(BASE + row)).not.toBe(v2(BASE)); }
  const f = station(), policy = readFileSync(f.policyPath, "utf8");
  const before = readFileSync(f.configPath, "utf8");
  for (const changed of [before.replaceAll("0.2.0", "0.2.1").replace("30.00", "45"), before + '[mcp_servers.extra]\ncommand = "/added"\n']) {
    writeFileSync(f.configPath, changed);
    expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
    expect(readFileSync(f.policyPath, "utf8")).toBe(policy);
  }
});

test("unknown/malformed, hosted Apps, HTTP/auth and remote contracts remain fully bound", () => {
  const rows = [
    LOCAL + 'unknown = true\n', LOCAL + '[mcp_servers.workflows.tools.run]\nunknown = true\n',
    LOCAL.replace('args = ["--stdio", "0.2.0"]', 'args = [false]'),
    LOCAL + 'url = "https://tools.invalid/mcp"\n', LOCAL + 'auth = "oauth"\n',
    LOCAL + 'http_headers_helper = "/helper"\n', LOCAL + 'oauth = {client_id = "public-id"}\n',
    LOCAL + 'environment_id = "cloud-environment"\n',
    LOCAL + 'env_vars = [{name = "MODE", source = "remote"}]\n',
    LOCAL.replace("workflows", "codex_apps"), LOCAL.replace("workflows", "_codex_apps"),
    '[mcp_servers.http]\nurl = "https://tools.invalid/mcp"\n',
    LOCAL.replace("30.00", "-1"), LOCAL + 'tools = {run = {output_token_limit = 0}}\n',
  ];
  for (const row of rows) { expect(v3(BASE + row)).not.toBe(v3(BASE)); expect(v3(BASE + row.replace("0.2.0", "0.2.1"))).not.toBe(v3(BASE)); }
});

test("lexical projection proves quoted and multiline table boundaries and keeps unsupported representations bound", () => {
  expect(v3(BASE + LOCAL.replace('[mcp_servers.workflows]', '[ mcp_servers."workflows" ] # reviewed'))).toBe(v3(BASE));
  const multiline = LOCAL + 'env = { NOTE = """\n[mcp_servers.codex_apps]\nordinary text\n""" }\n';
  // Multiline environment values exceed the established local metadata contract.
  expect(v3(BASE + multiline)).not.toBe(v3(BASE));
  const rootNote = BASE + 'note = """\n[mcp_servers.codex_apps]\nordinary text\n"""\n';
  expect(v3(rootNote + LOCAL)).toBe(v3(rootNote));
  const withSkills = BASE + LOCAL + '[[skills.config]]\nname = "native"\nenabled = true\n';
  expect(v3(withSkills)).not.toBe(v3(BASE));
  expect(v3(withSkills.replaceAll("0.2.0", "0.2.1"))).toBe(v3(withSkills));
  for (const row of ['mcp_servers = {workflows = {command = "/runtime", tool_timeout_sec = 30.0}}\n', 'mcp_servers.workflows.command = "/runtime"\nmcp_servers.workflows.tool_timeout_sec = 30.0\n']) {
    expect(v3(BASE + row)).not.toBe(v3(BASE));
    expect(v3(BASE + row.replace("30.0", "31.0"))).not.toBe(v3(BASE + row));
  }
  expect(v3(BASE.replace("-0.0", "0.0") + LOCAL)).not.toBe(v3(BASE + LOCAL));
  expect(v3(BASE + 'large = 9007199254740993\n' + LOCAL)).not.toBe(v3(BASE + 'large = 9007199254740992\n' + LOCAL));
});

test("v2-to-v3 proves legacy bytes then permits only newly irrelevant changes, with guarded preimage replay", () => {
  const f = station(2), before = readFileSync(f.configPath, "utf8"), policy = readFileSync(f.policyPath, "utf8");
  const preimage = join(f.home, "preserved", "config.toml"); mkdirSync(join(f.home, "preserved")); writeFileSync(preimage, before);
  const changed = 'service_tier = "flex"\nmodel_reasoning_effort = "ultra"\n' + before.replaceAll("0.2.0", "0.2.1").replace("30.00", "44");
  writeFileSync(f.configPath, changed);
  const options = () => ({ ...f, agent: "codex" as const, targetCodexVersion: 3 as const, reviewedPreimage: preimage, expectedPolicySha256: sha(policy), expectedSettingsSha256: sha(readFileSync(f.configPath, "utf8")) });
  expect(() => assertManagedAgentBridge("codex", f)).toThrow();
  for (const bad of ['model_provider = "custom"\n' + changed, changed + '[plugins.extra]\nenabled = true\n', changed + '[mcp_servers.cloud]\nurl = "https://tools.invalid"\n']) {
    writeFileSync(f.configPath, bad); expect(() => planAgentSettingsWitnessUpgrade(options())).toThrow("V3 contract"); expect(readFileSync(f.policyPath, "utf8")).toBe(policy);
  }
  writeFileSync(f.configPath, changed); const plan = planAgentSettingsWitnessUpgrade(options());
  writeFileSync(preimage, before.replace("0.2.0", "0.2.2")); expect(() => applyAgentIntegration(plan)).toThrow();
  expect(readFileSync(f.policyPath, "utf8")).toBe(policy); writeFileSync(preimage, before);
  writeFileSync(f.configPath, changed + '# concurrent\n'); expect(() => applyAgentIntegration(plan)).toThrow("changed");
  writeFileSync(f.configPath, changed); const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policy); expect(readFileSync(f.configPath, "utf8")).toBe(changed);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(f.configPath, changed.replaceAll("0.2.1", "0.2.2")); expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
});
