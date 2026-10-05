import { expect, test } from "bun:test";
import { hashCodexSettingsReplacementV4 as witness, hashCodexSettingsReplacementV3 } from "./codex-settings-witness.js";
const base = 'model = "gpt-6.1-sol"\nunknown = 1\n[skills.bundled]\nenabled = false\n[tui]\nshow_tooltips = true\n';
const inline = (value: string) => base + 'model_availability_nux = { "gpt-6.1-sol" = ' + value + ' }\n';
test("native inline availability count advances preserve the typed witness", () => {
  expect(witness(inline("4"))).toBe(witness(inline("3")));
  expect(witness(inline("0"))).toBe(witness(base));
  expect(witness(inline("4294967295"))).toBe(witness(base));
});
test("the native ordinary table and inline representation share one UI state contract", () => {
  expect(witness(base+'[tui.model_availability_nux]\n"gpt-6.1-sol" = 7\n')).toBe(witness(inline("3")));
});
test("unknown TUI controls and unrelated numeric spelling remain witnessed", () => {
  const before = witness(inline("3"));
  for (const value of ['pet = "custom-pet"', 'theme = "custom"', 'resume_cwd = "session"', 'unknown = 1', 'model_availability_nux_other = { count = 3 }']) {
    expect(witness(base + value + '\nmodel_availability_nux = { "gpt-6.1-sol" = 4 }\n')).not.toBe(before);
  }
  expect(witness(inline("4").replace('unknown = 1', 'unknown = 1.0'))).not.toBe(before);
  expect(witness(inline("4").replace('unknown = 1', 'unknown = 9007199254740993'))).not.toBe(before);
});
test("non-uint32 and integer-looking float state never receive the omission", () => {
  const before = witness(base);
  for (const value of ['3.0', '3e0', '-1', '4294967296', 'true', '"3"', '{ count = 3 }', '[3]']) {
    try { expect(witness(inline(value))).not.toBe(before); } catch (error) { if (!(error instanceof Error) || !error.message.includes('Invalid Codex settings witness')) throw error; }
  }
});
test("discovery and instruction controls stay bound during a count update", () => {
  const before = witness(inline("3"));
  for (const tail of ['[plugins.test]\nenabled = true\n', '[mcp_servers.remote]\nurl = "https://example.invalid/mcp"\n', '[hooks]\nenabled = false\n', '[model_providers.custom]\nbase_url = "https://example.invalid"\n']) {
    expect(witness(inline("4")+tail)).not.toBe(before);
  }
});
test("string-contained header and assignment lookalikes are not counter state", () => {
  const text = 'lookalike = """\n[tui.model_availability_nux]\ncount = 3\n"""\n'+inline("3");
  expect(witness(text.replace('count = 3', 'count = 4'))).not.toBe(witness(text));
  expect(witness(text.replace('"gpt-6.1-sol" = 3', '"gpt-6.1-sol" = 4'))).toBe(witness(text));
});

test("V3 retains its original counter-sensitive digest", () => {
  expect(hashCodexSettingsReplacementV3(inline("3"))).toBe("7377f4b2c6d9b8fbdb689fd445dc30ce88ea83210927655edd418a558425a062");
  expect(hashCodexSettingsReplacementV3(inline("4"))).not.toBe(hashCodexSettingsReplacementV3(inline("3")));
});

import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, planAgentSettingsWitnessUpgrade } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
let restoreInspector: () => void;
const homes: string[] = [];
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true }); });
for (const aliased of [false, true]) for (const key of ['"gpt-6.1-sol"', "gpt-5", "o4-mini"]) test(`V3-to-V4 reviewed upgrade preserves native settings, other witnesses and pins (alias=${aliased}, key=${key})`, () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-nux-upgrade-")); homes.push(home);
  const codex = aliased ? join(home, "projects/owned/.codex") : join(home, ".codex");
  mkdirSync(codex, { recursive: true });
  if (aliased) symlinkSync(codex, join(home, ".codex"));
  admitCorpusFixture(codex);
  const f = { home, dataDir: join(home, "data"), projectDir: home, allowRootAliases: aliased };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  const config = join(codex, "config.toml"), policyPath = join(f.dataDir, "agent-policy.json");
  const before = `tui.model_availability_nux = {${key} = 3}\n` + readFileSync(config, "utf8");
  writeFileSync(config, before);
  const oldBinding = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.codex;
  const binding = { agent: "codex" as const, roots: oldBinding.roots, sources: [
    ...oldBinding.sources.filter((source: any) => source.path !== config),
    { path: config, hashMode: "codex-settings-v3" as const, sha256: hashCodexSettingsReplacementV3(before) },
  ], pluginHooks: "reviewed-no-skill-injection" as const };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: { version: 1, agents: [binding] } }));
  const policyBefore = readFileSync(policyPath, "utf8"), oldPolicy = JSON.parse(policyBefore);
  const preservedDir = join(home, "preserved"); mkdirSync(preservedDir);
  const original = join(preservedDir, "config.toml"); writeFileSync(original, before);
  expect(readFileSync(original, "utf8")).toBe(before);
  const pin = join(f.dataDir, "synthetic-session-pin.json"); writeFileSync(pin, '{"generation":7,"skills":["unchanged"]}');
  const pinned = readFileSync(pin, "utf8");
  const current = before.replace(`${key} = 3`, `${key} = 4`); writeFileSync(config, current);
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  const options = { ...f, agent: "codex" as const, targetCodexVersion: 4 as const, reviewedPreimage: original, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(current) };
  const plan = planAgentSettingsWitnessUpgrade(options);
  expect(plan.settingsWitnessUpgrade?.fromHashMode).toBe("codex-settings-v3");
  expect(plan.settingsWitnessUpgrade?.toHashMode).toBe("codex-settings-v4");
  expect(plan.changes.map(change => change.path)).toEqual([policyPath]);
  expect(plan.rootAliases).toEqual(oldPolicy.bridge.rootAliases ?? []);
  const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policyBefore);
  expect(readFileSync(config, "utf8")).toBe(current);
  expect(readFileSync(pin, "utf8")).toBe(pinned);
  const next = JSON.parse(readFileSync(policyPath, "utf8"));
  expect(next.bridge.rootAliases).toEqual(oldPolicy.bridge.rootAliases);
  expect(next.bridge.discovery.codex.sources.filter((source: any) => source.path !== config)).toEqual(oldPolicy.bridge.discovery.codex.sources.filter((source: any) => source.path !== config));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(config, current.replace(`${key} = 4`, `${key} = 5`));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(config, current + '\n[plugins."unexpected@market"]\nenabled=true\n');
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  writeFileSync(config, current);
  expect(() => planAgentSettingsWitnessUpgrade({ ...options, expectedPolicySha256: "0".repeat(64) })).toThrow("policy preimage");
});

test("bare native model keys and quoted assignment lookalikes do not become numeric value tokens", () => {
  for (const key of ["gpt-5", "o4-mini", '\"count=3e0\"', "'model-5'", '\"escaped\\\"=3.0\"']) {
    const inlineBefore = `model_availability_nux = {${key} = 3}\n`;
    const tableBefore = `[tui.model_availability_nux]\n${key} = 3\n`;
    expect(witness(base+inlineBefore)).toBe(witness(base+inlineBefore.replace("= 3", "= 4")));
    expect(witness(tableBefore)).toBe(witness(tableBefore.replace("= 3", "= 4")));
    expect(witness(tableBefore.replace("= 3", "= 3.0"))).not.toBe(witness(tableBefore));
  }
});
test("the first native startup count preserves absent and empty TUI representations", () => {
  const empty = "[tui]\n", count = 'model_availability_nux = {gpt-5 = 1}\n';
  expect(witness(empty)).toBe(witness(empty+count));
  expect(witness("")).toBe(witness(empty+count));
  expect(witness("")).toBe(witness('[tui.model_availability_nux]\no4-mini=1\n'));
  expect(witness(empty+'unknown=1\n')).not.toBe(witness(empty+count));
  expect(hashCodexSettingsReplacementV3(empty)).not.toBe(hashCodexSettingsReplacementV3(empty+count));
});
