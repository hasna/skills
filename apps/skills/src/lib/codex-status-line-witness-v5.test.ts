import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  hashCodexSettingsReplacement as v1, hashCodexSettingsReplacementV2 as v2,
  hashCodexSettingsReplacementV3 as v3, hashCodexSettingsReplacementV4 as v4,
  hashCodexSettingsReplacementV5 as v5, upgradeCodexSettingsWitnessV5,
} from "./codex-settings-witness.js";
useDefaultTestTimeout();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const base = 'model = "gpt-6.1-sol"\n[skills.bundled]\nenabled = false\n';
const before = base + '[tui]\nstatus_line = ["model-with-reasoning", "current-dir", "git-branch"]\n';
const changed = before.replace('"git-branch"]', '"git-branch", "context-used"]');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("V1–V4 retain exact pre-change digest meanings", () => {
  // Measured from the preserved original source at 3517b9a before V5 changes.
  expect(v1(before)).toBe("6588707108c53b1ec68dc5962d0350991c5971373579003d5f31e3f7431bc992");
  expect(v2(before)).toBe("9ed4e463a979f0456e6f07b15f21955066a935a7ec27ba07088894fffa7ef955");
  expect(v3(before)).toBe("a968abc8ea590b3be3e6d7e6a32e0a5d1dce002c6d8c14ceb5691b095084ac42");
  expect(v4(before)).toBe("3d8a3e93ebad1e1904b6800f5857979a91f61cfb0b264db2cd132191ac34c7fd");
});

test("status display additions, removals and reordering are opt-in V5 preferences", () => {
  for (const old of [v1, v2, v3, v4]) expect(old(changed)).not.toBe(old(before));
  expect(v5(changed)).toBe(v5(before));
  expect(v5(base)).toBe(v5(before));
  expect(v5(base + '[tui]\nstatus_line=[]\n')).toBe(v5(before));
  expect(v5(base + '[tui]\nstatus_line=["context-used", "current-dir"]\n')).toBe(v5(before));
  expect(v5('tui.status_line=["model", "project", "session-id"]\n' + base)).toBe(v5(before));
  expect(v5('tui={status_line=["context-usage", "project-name", "thread-id"]}\n' + base)).toBe(v5(before));
});

test("unknown, executable-looking, malformed and excessive status lists remain bound", () => {
  for (const value of ['["future-item"]', '["/bin/unreviewed"]', '["$(command)"]', '["model", 1]', '"model"', '{command="/bin/unreviewed"}', '["model\\nname"]', JSON.stringify(Array(257).fill("model"))]) {
    expect(v5(base + `[tui]\nstatus_line=${value}\n`)).not.toBe(v5(before));
  }
  expect(v5(base + '[tui]\nstatus_line=["future-item"]\n')).not.toBe(v5(base + '[tui]\nstatus_line=["another-item"]\n'));
});

test("other TUI and discovery controls cannot hide behind a status edit", () => {
  for (const tail of ['theme="custom"', 'pet="custom-pet"', 'terminal_title=["thread-name"]', 'unknown=1']) {
    expect(v5(changed + tail + '\n')).not.toBe(v5(before));
  }
  for (const tail of [
    '[plugins.extra]\nenabled=true\n', '[marketplaces.extra]\npath="/unreviewed"\n',
    '[[skills.config]]\npath="/unreviewed/SKILL.md"\nenabled=true\n',
    '[hooks]\ncommand="/bin/unreviewed"\n',
    '[mcp_servers.codex_apps]\ncommand="/bin/unreviewed"\n',
    '[mcp_servers.remote]\nurl="https://example.invalid/mcp"\n',
    '[mcp_servers.unsupported]\ncommand="/bin/unreviewed"\nunknown=true\n',
    '[model_providers.custom]\nbase_url="https://example.invalid"\n',
    '[shell_environment_policy]\ninclude_only=["PATH"]\n',
    '[projects."/unreviewed"]\ntrust_level="trusted"\n',
  ]) expect(v5(changed + tail)).not.toBe(v5(before));
  expect(v5(changed.replace('enabled = false', 'enabled = true'))).not.toBe(v5(before));
  expect(v5(changed+'unknown=1\n')).not.toBe(v5(changed+'unknown=1.0\n'));
});

test("V5 retains V4 native counters and V3 ordinary local MCP semantics", () => {
  expect(v5(changed+'model_availability_nux={gpt-5=7}\n')).toBe(v5(before));
  expect(v5(changed+'model_availability_nux={gpt-5=7.0}\n')).not.toBe(v5(before));
  expect(v5(changed+'[mcp_servers.local]\ncommand="/bin/first"\n')).toBe(v5(before+'[mcp_servers.local]\ncommand="/bin/second"\n'));
});

test("string-contained TUI lookalikes and profiles remain protected", () => {
  const lookalike = 'instructions="""\n[tui]\nstatus_line=["model"]\n"""\n';
  expect(v5(lookalike+before)).not.toBe(v5(lookalike.replace('"model"', '"context-used"')+changed));
  expect(v5(before+'[profiles.other.tui]\nstatus_line=["model"]\n')).not.toBe(v5(changed+'[profiles.other.tui]\nstatus_line=["context-used"]\n'));
});

for (const [mode, originalHash] of [[undefined, sha], ["bytes", sha], ["codex-settings-v1", v1], ["codex-settings-v2", v2], ["codex-settings-v3", v3], ["codex-settings-v4", v4]] as const) {
  test(`explicit ${mode ?? "legacy bytes"}-to-V5 verifies original digest and refuses discovery changes`, () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-status-line-')); roots.push(root);
    const preserved = join(root, 'preserved'), current = join(root, 'current');
    mkdirSync(preserved); mkdirSync(current);
    const original = join(preserved, 'config.toml'), config = join(current, 'config.toml');
    writeFileSync(original, before); writeFileSync(config, changed);
    expect(readFileSync(original, 'utf8')).toBe(before);
    const previous = { path: config, ...(mode ? { hashMode: mode } : {}), sha256: originalHash(before) };
    expect(upgradeCodexSettingsWitnessV5(previous, original)).toEqual({ path: config, hashMode: "codex-settings-v5", sha256: v5(changed) });
    expect(readFileSync(config, 'utf8')).toBe(changed);
    expect(readFileSync(original, 'utf8')).toBe(before);
    // The current config cannot substitute for the genuine reviewed original.
    expect(() => upgradeCodexSettingsWitnessV5(previous, config)).toThrow('Invalid Codex settings witness');
    for (const tail of ['[plugins.extra]\nenabled=true\n', '[hooks]\ncommand="/bin/unreviewed"\n', '[[skills.config]]\nname="extra"\nenabled=true\n']) {
      writeFileSync(config, changed+tail);
      expect(() => upgradeCodexSettingsWitnessV5(previous, original)).toThrow('outside the reviewed V5 contract');
    }
  });
}
