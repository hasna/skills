import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planAgentSettingsWitnessUpgrade } from "./agent-integration.js";
import { captureCodexSettingsV2, captureCodexSettings } from "./codex-settings-witness.js";
import { captureDiscoveryByteSources } from "./agent-discovery.js";
useDefaultTestTimeout();

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

/** A station before the bridge is installed: the owner's model selection and one
 * unrelated table that Codex's own writer re-serializes. */
const SEED = '# Codex user configuration\nmodel = "gpt-6.1-sol"\n[tui]\nscroll_rate = 4.0\n';

function station() {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-codex-witness-"));
  homes.push(home);
  const dataDir = join(home, "data"), configPath = join(home, ".codex/config.toml"), projectDir = home;
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(configPath, SEED, { mode: 0o600 });
  const fixture = { home, dataDir, projectDir };
  applyAgentIntegration(planAgentIntegration({ ...fixture, agents: ["codex"] }));
  const policyPath = join(dataDir, "agent-policy.json");
  const configWitnesses = () => (JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.codex.sources as Array<any>).filter(source => source.path === configPath);
  return { ...fixture, configPath, policyPath, configWitnesses };
}

/** Install the reviewed binding a station carries: one raw byte witness of the
 * exact reviewed configuration, which is what four stations were stranded by. */
function reviewed(f: ReturnType<typeof station>) {
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: captureDiscoveryByteSources([f.configPath]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review }));
  const preimage = join(f.home, "preserved", "config.toml");
  mkdirSync(join(f.home, "preserved"), { recursive: true });
  writeFileSync(preimage, readFileSync(f.configPath));
  return preimage;
}

/** What the stranded stations show: Codex wrote its own hook trust ledger, moved
 * an unrelated table while re-serializing, and another retired native copy was
 * registered as disabled. No hook, plugin, skill source or trust policy changed. */
function drift(text: string, note = 0) {
  const at = text.indexOf("[tui]");
  const moved = text.slice(at).trimEnd(), rest = text.slice(0, at).trimEnd();
  return `${rest}\n\n${moved}\n\n[hooks.state."/home/operator/.codex/hooks.json:session_start:0:${note}"]\nenabled = true\ntrusted_hash = "sha256:${"a".repeat(64)}"\n[[skills.config]]\npath = "/home/operator/.codex/skills/native/copy-${note}/SKILL.md"\nenabled = false\n`;
}

test("a stranded reviewed Codex station rebinds only after the exact-preimage proof", () => {
  const f = station(), preimage = reviewed(f);
  expect(f.configWitnesses().map((source: any) => source.hashMode ?? "toml-projection")).toEqual(["toml-projection", "bytes"]);
  const drifted = drift(readFileSync(f.configPath, "utf8"));
  writeFileSync(f.configPath, drifted);

  // The strand: the reviewed raw witness and the automatic projection both
  // stopped matching, so the managed bridge refuses and a retained install does
  // not silently adopt the new file.
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  expect(() => planAgentIntegration({ ...f, agents: ["codex"] })).toThrow("Native discovery input changed");

  const policyBefore = readFileSync(f.policyPath, "utf8");
  const plan = planAgentSettingsWitnessUpgrade({ ...f, agent: "codex", reviewedPreimage: preimage, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(drifted) });
  expect(plan.settingsWitnessUpgrade?.fromHashMode).toBe("bytes");
  expect(plan.settingsWitnessUpgrade?.toHashMode).toBe("codex-settings-v2");
  expect(plan.settingsWitnessUpgrade?.replacedWitnesses).toHaveLength(2);
  const applied = applyAgentIntegration(plan);

  // The native configuration is untouched and the previous policy is preserved.
  expect(readFileSync(f.configPath, "utf8")).toBe(drifted);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policyBefore);
  // One witness now covers the file, and it survives what stranded the station.
  expect(f.configWitnesses()).toHaveLength(1);
  expect(f.configWitnesses()[0].hashMode).toBe("codex-settings-v2");
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(f.configPath, drift(drifted, 1));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  // A retained install is usable again instead of demanding a fresh review.
  expect(() => planAgentIntegration({ ...f, agents: ["codex"] })).not.toThrow();
  // Real discovery inputs still refuse: an enabled plugin, a new hook
  // declaration, provider routing and project trust all remain bound.
  const current = readFileSync(f.configPath, "utf8");
  for (const change of [
    ['[plugins."unknown@market"]\nenabled = true\n', "append"],
    ['[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "/bin/unreviewed" }]\n', "append"],
    ['model_provider = "custom"\n', "prepend"],
    ['[projects."/home/operator/repo"]\ntrust_level = "trusted"\n', "append"],
  ] as const) {
    writeFileSync(f.configPath, change[1] === "append" ? current + change[0] : change[0] + current);
    expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  }
  writeFileSync(f.configPath, current);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
});

test("the rebind refuses an unexplained witness, a wrong preimage and any real change", () => {
  const f = station(), preimage = reviewed(f);
  const reviewedText = readFileSync(f.configPath, "utf8");
  const drifted = drift(reviewedText);
  writeFileSync(f.configPath, drifted);
  const options = { ...f, agent: "codex" as const, reviewedPreimage: preimage };
  const expected = () => ({ ...options, expectedPolicySha256: sha(readFileSync(f.policyPath, "utf8")), expectedSettingsSha256: sha(readFileSync(f.configPath, "utf8")) });
  const policy = () => JSON.parse(readFileSync(f.policyPath, "utf8"));
  const rewritePolicy = (edit: (value: any) => void) => { const value = policy(); edit(value); writeFileSync(f.policyPath, `${JSON.stringify(value, null, 2)}\n`); };
  const projection = (value: any) => value.bridge.discovery.codex.sources.find((source: any) => source.format === "toml");
  const pristinePolicy = readFileSync(f.policyPath, "utf8");

  // A policy whose narrower projection witness the preserved preimage does not explain.
  rewritePolicy(value => { projection(value).sha256 = "0".repeat(64); });
  expect(() => planAgentSettingsWitnessUpgrade(expected())).toThrow("Reviewed preimage does not explain the Codex discovery projection witness");

  // An unrecognized witness of the same file is never dropped by the rebind.
  rewritePolicy(value => { projection(value).fields = ["skills"]; });
  expect(() => planAgentSettingsWitnessUpgrade(expected())).toThrow("found an unrecognized configuration witness");
  writeFileSync(f.policyPath, pristinePolicy);
  expect(() => planAgentSettingsWitnessUpgrade(expected())).not.toThrow();

  // A preimage that is not the reviewed state at all.
  const other = join(f.home, "other", "config.toml");
  mkdirSync(join(f.home, "other"), { recursive: true });
  writeFileSync(other, `${drifted}# unrelated\n`);
  expect(() => planAgentSettingsWitnessUpgrade({ ...expected(), reviewedPreimage: other })).toThrow();

  // A real configuration change relative to the reviewed preimage.
  writeFileSync(f.configPath, `${drifted}[plugins."unknown@market"]\nenabled = true\n`);
  expect(() => planAgentSettingsWitnessUpgrade(expected())).toThrow("Codex non-preference settings changed");
  writeFileSync(f.configPath, `model_provider = "custom"\n${drifted}`);
  expect(() => planAgentSettingsWitnessUpgrade(expected())).toThrow("Codex non-preference settings changed");
});

test("a fresh reviewed install adopts the semantic witness and never re-arms the projection", () => {
  const f = station();
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [captureCodexSettingsV2(f.configPath)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review }));
  expect(f.configWitnesses().map((source: any) => source.hashMode)).toEqual(["codex-settings-v2"]);

  // Trust-state writes, re-serialization and retired registrations are not drift.
  const installed = readFileSync(f.configPath, "utf8");
  writeFileSync(f.configPath, drift(installed));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  expect(() => planAgentIntegration({ ...f, agents: ["codex"] })).not.toThrow();
  // The semantic witness covers the rest of the file exactly.
  writeFileSync(f.configPath, `${drift(installed)}[plugins."unknown@market"]\nenabled = true\n`);
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
});

function reviewedV1(f: ReturnType<typeof station>) {
  // A deployed .20 cohort: native trust state and retired registrations are
  // already present when the original v1 review is captured.
  writeFileSync(f.configPath, drift(readFileSync(f.configPath, "utf8")));
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [captureCodexSettings(f.configPath)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], discoveryInputs: review }));
  const preimage = join(f.home, "preserved-v1", "config.toml");
  mkdirSync(join(f.home, "preserved-v1"));
  writeFileSync(preimage, readFileSync(f.configPath));
  return preimage;
}

test("deployed v1 digests remain accepted unchanged and migrate explicitly to v2", () => {
  const f = station(), preimage = reviewedV1(f);
  const policyBefore = readFileSync(f.policyPath, "utf8");
  expect(f.configWitnesses().map(source => source.hashMode ?? "toml-projection")).toEqual(["toml-projection", "codex-settings-v1"]);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  expect(() => planAgentIntegration({ ...f, agents: ["codex"] })).not.toThrow();
  // Runtime retains the original policy and its v1 verifier.
  expect(readFileSync(f.policyPath, "utf8")).toBe(policyBefore);
  const changed = drift(readFileSync(f.configPath, "utf8"), 1);
  writeFileSync(f.configPath, changed);
  expect(() => assertManagedAgentBridge("codex", f)).toThrow("Native discovery input changed");
  const plan = planAgentSettingsWitnessUpgrade({ ...f, agent: "codex", reviewedPreimage: preimage, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(changed) });
  expect(plan.settingsWitnessUpgrade?.fromHashMode).toBe("codex-settings-v1");
  expect(plan.settingsWitnessUpgrade?.toHashMode).toBe("codex-settings-v2");
  expect(plan.settingsWitnessUpgrade?.replacedWitnesses).toHaveLength(2);
  const applied = applyAgentIntegration(plan);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(policyBefore);
  expect(readFileSync(f.configPath, "utf8")).toBe(changed);
  expect(f.configWitnesses().map(source => source.hashMode)).toEqual(["codex-settings-v2"]);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  writeFileSync(f.configPath, drift(changed, 2));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
});

test("v1 migration refuses missing or tampered preimages, real changes and stale apply without writes", () => {
  const f = station(), preimage = reviewedV1(f);
  const before = readFileSync(f.configPath, "utf8"), policyBefore = readFileSync(f.policyPath, "utf8");
  const changed = drift(before, 1);
  const options = () => ({ ...f, agent: "codex" as const, reviewedPreimage: preimage, expectedPolicySha256: sha(policyBefore), expectedSettingsSha256: sha(readFileSync(f.configPath, "utf8")) });
  const refused = (operation: () => unknown) => { const config = readFileSync(f.configPath, "utf8"); expect(operation).toThrow(); expect(readFileSync(f.policyPath, "utf8")).toBe(policyBefore); expect(readFileSync(f.configPath, "utf8")).toBe(config); };
  writeFileSync(f.configPath, changed);
  refused(() => planAgentSettingsWitnessUpgrade({ ...options(), reviewedPreimage: join(f.home, "missing", "config.toml") }));
  writeFileSync(preimage, before + '[unknown]\nenabled = true\n');
  refused(() => planAgentSettingsWitnessUpgrade(options()));
  writeFileSync(preimage, before);
  for (const delta of [
    '[plugins."new@market"]\nenabled = true\n',
    '[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "/bin/unreviewed" }]\n',
    '[model_providers.new]\nbase_url = "https://unreviewed.invalid"\n',
    '[projects."/home/operator/repo"]\ntrust_level = "trusted"\n',
    '[[skills.config]]\nname = "new"\nenabled = true\n',
    '[mcp_servers.new]\ncommand = "/bin/unreviewed"\n',
  ]) { writeFileSync(f.configPath, changed + delta); refused(() => planAgentSettingsWitnessUpgrade(options())); }
  writeFileSync(f.configPath, 'model_provider = "new"\n' + changed);
  refused(() => planAgentSettingsWitnessUpgrade(options()));
  writeFileSync(f.configPath, changed);
  refused(() => planAgentSettingsWitnessUpgrade({ ...options(), expectedSettingsSha256: "0".repeat(64) }));
  const plan = planAgentSettingsWitnessUpgrade(options());
  writeFileSync(f.configPath, changed + '# concurrent native write\n');
  refused(() => applyAgentIntegration(plan));
  writeFileSync(f.configPath, changed);
  writeFileSync(preimage, before + '[unknown]\nenabled = true\n');
  refused(() => applyAgentIntegration(plan));
});
