import { useDefaultTestTimeout } from "../test-preload.js";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, planAgentSettingsWitnessUpgrade } from "./agent-integration.js";
import { hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4 } from "./codex-settings-witness.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
let restoreInspector: () => void;
const homes: string[] = [];
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const aliased of [false, true]) for (const version of [3, 4] as const) test(`V${version}-to-V5 policy-only upgrade preserves controls, roots and pins (alias=${aliased})`, () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-status-line-upgrade-")); homes.push(home);
  const codex = aliased ? join(home, "owned/.codex") : join(home, ".codex");
  mkdirSync(codex, { recursive: true });
  if (aliased) symlinkSync(codex, join(home, ".codex"));
  admitCorpusFixture(codex);
  const f = { home, dataDir: join(home, "data"), projectDir: home, allowRootAliases: aliased };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  const config = join(codex, "config.toml"), policyPath = join(f.dataDir, "agent-policy.json");
  const before = 'tui.status_line=["model-with-reasoning","current-dir","git-branch"]\n' + readFileSync(config, "utf8");
  writeFileSync(config, before);
  const oldBinding = JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.codex;
  const mode = version === 3 ? "codex-settings-v3" as const : "codex-settings-v4" as const;
  const hash = version === 3 ? hashCodexSettingsReplacementV3 : hashCodexSettingsReplacementV4;
  const binding = { agent: "codex" as const, roots: oldBinding.roots, sources: [
    ...oldBinding.sources.filter((source: any) => source.path !== config),
    { path: config, hashMode: mode, sha256: hash(before) },
  ], pluginHooks: "reviewed-no-skill-injection" as const };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: { version: 1, agents: [binding] } }));
  const policyBefore = readFileSync(policyPath, "utf8"), oldPolicy = JSON.parse(policyBefore);
  const preservedDir = join(home, "preserved"); mkdirSync(preservedDir);
  const original = join(preservedDir, "config.toml"); writeFileSync(original, before);
  expect(readFileSync(original, "utf8")).toBe(before);
  const pin = join(f.dataDir, "synthetic-session-pin.json"), pinned = '{"generation":7,"skills":["unchanged"]}';
  writeFileSync(pin, pinned);
  const current = before.replace('"git-branch"]', '"git-branch","context-used"]'); writeFileSync(config, current);
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  const options = { ...f, agent: "codex" as const, targetCodexVersion: 5 as const, reviewedPreimage: original, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(current) };
  expect(() => planAgentSettingsWitnessUpgrade({ ...options, expectedPolicySha256: "0".repeat(64) })).toThrow("policy preimage");
  expect(() => planAgentSettingsWitnessUpgrade({ ...options, expectedSettingsSha256: "0".repeat(64) })).toThrow("settings preimage");
  expect(() => planAgentSettingsWitnessUpgrade({ ...options, reviewedPreimage: config })).toThrow("Invalid Codex settings witness");
  const plan = planAgentSettingsWitnessUpgrade(options);
  expect(plan.settingsWitnessUpgrade?.fromHashMode).toBe(mode);
  expect(plan.settingsWitnessUpgrade?.toHashMode).toBe("codex-settings-v5");
  expect(plan.changes.map(change => change.path)).toEqual([policyPath]);
  const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policyBefore);
  expect(readFileSync(config, "utf8")).toBe(current);
  expect(readFileSync(original, "utf8")).toBe(before);
  expect(readFileSync(pin, "utf8")).toBe(pinned);
  const policyAfter = readFileSync(policyPath, "utf8"), next = JSON.parse(policyAfter);
  expect(next.bridge.rootAliases).toEqual(oldPolicy.bridge.rootAliases);
  expect(next.bridge.discovery.codex.sources.filter((source: any) => source.path !== config)).toEqual(oldPolicy.bridge.discovery.codex.sources.filter((source: any) => source.path !== config));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(config, current.replace('"context-used"', '"weekly-limit"'));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  for (const tail of ['\n[plugins.extra]\nenabled=true\n', '\n[[skills.config]]\nname="extra"\nenabled=true\n', '\n[hooks]\ncommand="/bin/unreviewed"\n']) {
    writeFileSync(config, current + tail);
    expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
    expect(readFileSync(policyPath, "utf8")).toBe(policyAfter);
  }
  expect(readFileSync(pin, "utf8")).toBe(pinned);
});
