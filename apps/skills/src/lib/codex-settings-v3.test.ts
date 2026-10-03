import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { hashCodexSettingsReplacementV2 as v2, hashCodexSettingsReplacementV3 as v3 } from "./codex-settings-witness.js";
useDefaultTestTimeout();

test("v3 tolerates explicit and absent service tiers and model-advertised efforts; v2 keeps its contract", () => {
  const root = 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n';
  for (const tier of ["default", "priority", "flex", "fast", "future-request-id", ""]) {
    expect(v3(root + `service_tier = "${tier}"\n`)).toBe(v3(root));
    expect(v2(root + `service_tier = "${tier}"\n`)).not.toBe(v2(root));
    const profile = '[profiles.selected]\nmodel = "gpt-6.1-sol"\n';
    expect(v3(profile + `service_tier = "${tier}"\nmodel_reasoning_effort = "ultra"\nplan_mode_reasoning_effort = "high"\n`)).toBe(v3(profile));
  }
  expect(v3(root.replace('"high"', '"ultra"'))).toBe(v3(root));
  expect(() => v2(root.replace('"high"', '"ultra"'))).toThrow();
  expect(v3(root)).not.toBe(v2(root));
});

test("v3 retains routes, native injection controls, reserved MCP, context limits and unknown fields", () => {
  const root = 'model = "gpt-6.1-sol"\n';
  for (const extra of [
    'model_provider = "custom"\n', 'profile = "another"\n',
    'model_instructions_file = "/unreviewed/instructions"\n',
    'model_context_window = 10000\n', 'unrecognized = true\n',
    '[skills.bundled]\nenabled = true\n',
    '[plugins.extra]\nenabled = true\n', '[mcp_servers.codex_apps]\ncommand = "/unreviewed"\n',
    '[hooks]\nenabled = false\n', '[profiles.selected]\nmodel_provider = "custom"\n',
  ]) expect(v3(root + extra)).not.toBe(v3(root));
  for (const invalid of ['service_tier = false\n', 'model_reasoning_effort = ""\n', 'plan_mode_reasoning_effort = 3\n', 'service_tier = "' + 'x'.repeat(129) + '"\n']) expect(() => v3(root + invalid)).toThrow();
});

test("v3 tolerates only native personality enum preferences at root and profile scope", () => {
  const root = 'model = "gpt-6.1-sol"\n';
  // Exact released .27 absent-field digest remains usable. A stored .27 review
  // that included personality cannot silently match the extended projection.
  expect(v3(root)).toBe("aab472ba88490162eff91def99dad803de45ddf2db04580570b4eba0a40b2c2d");
  expect(v3(root + 'personality = "pragmatic"\n')).not.toBe("51fa067f3bb085b58300ae77a1d6f5c714d8fd05ff1e6f824f8193641d2bf14e");
  const profile = '[profiles.selected]\nmodel = "gpt-6.1-sol"\n';
  for (const personality of ["none", "friendly", "pragmatic"]) for (const base of [root, profile]) {
    const changed = base + `personality = "${personality}"\n`;
    expect(v3(changed)).toBe(v3(base));
    expect(v2(changed)).not.toBe(v2(base));
  }
  for (const invalid of ['"unknown"', '""', '"Pragmatic"', '" pragmatic "', 'false', '3', '[]', '{ path = "/unreviewed" }']) {
    for (const base of [root, profile]) expect(() => v3(base + `personality = ${invalid}\n`)).toThrow();
  }
  for (const extra of [
    '[features]\npersonality = true\n',
    '[profiles.selected.features]\npersonality = false\n',
    'model_catalog_json = "/unreviewed/catalog.json"\n',
    'model_instructions_file = "/unreviewed/instructions"\n',
    'developer_instructions = "unreviewed"\n',
    '[agents.worker]\nconfig_file = "/unreviewed/agent.toml"\n',
  ]) expect(v3(root + extra)).not.toBe(v3(root));
});
