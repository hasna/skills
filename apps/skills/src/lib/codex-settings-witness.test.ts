import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { hashCodexSettingsReplacementV2 as witness } from "./codex-settings-witness.js";
useDefaultTestTimeout();

// A reviewed Codex configuration: the owner's model selection, one unrelated
// table the native writer may move, the installer's bundled-skill switch and one
// retired native copy registered as disabled.
const REVIEWED = [
  'model = "gpt-6.1-sol"',
  'model_reasoning_effort = "high"',
  'model_verbosity = "low"',
  '[tui]',
  'scroll_rate = 4.0',
  '[skills.bundled]',
  'enabled = false',
  '[[skills.config]]',
  'path = "/home/operator/.codex/skills/native/gardener/SKILL.md"',
  'enabled = false',
  '',
].join("\n");
// The same configuration after Codex re-serialized it: the unrelated table moved
// below the managed registration block. Table order carries no TOML meaning.
const RESERIALIZED = [
  'model = "gpt-6.1-sol"',
  'model_reasoning_effort = "high"',
  'model_verbosity = "low"',
  '[skills.bundled]',
  'enabled = false',
  '[[skills.config]]',
  'path = "/home/operator/.codex/skills/native/gardener/SKILL.md"',
  'enabled = false',
  '[tui]',
  'scroll_rate = 4.0',
  '',
].join("\n");
const trustState = (n: number) => `\n[hooks.state."/home/operator/.codex/hooks.json:session_start:0:${n}"]\nenabled = true\ntrusted_hash = "sha256:${String(n).repeat(64)}"\n`;

test("native trust-state writes, re-serialization and retired registrations never change the reviewed witness", () => {
  const reviewed = witness(REVIEWED);
  expect(witness(RESERIALIZED)).toBe(reviewed);
  // Codex wrote its own hook trust state: new keys, changed keys, more keys.
  expect(witness(REVIEWED + trustState(0))).toBe(reviewed);
  expect(witness(REVIEWED + trustState(0) + trustState(1))).toBe(reviewed);
  expect(witness(REVIEWED + trustState(2))).toBe(reviewed);
  // Comments and blank lines the native writer adds are not configuration.
  expect(witness(`# rewritten by codex\n\n${REVIEWED}`)).toBe(reviewed);
  // The installer retired another native copy with an explicit disable.
  expect(witness(`${REVIEWED}[[skills.config]]\nname = "vendor-skill"\nenabled = false\n`)).toBe(reviewed);
  expect(witness(`${REVIEWED}[[skills.config]]\npath = "/home/operator/.codex/skills/native/other/SKILL.md"\nenabled = false\n`)).toBe(reviewed);
  // Inference selections — the model and its effort/verbosity — are not
  // discovery inputs, at the root or in an owner profile.
  expect(witness(REVIEWED.replace("gpt-6.1-sol", "gpt-6.1").replace('"high"', '"low"').replace('"low"', '"medium"'))).toBe(reviewed);
  expect(witness(`${REVIEWED}[profiles.fast]\nmodel = "gpt-6.1"\nmodel_reasoning_effort = "low"\n`)).toBe(witness(`${REVIEWED}[profiles.fast]\nmodel = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n`));
});

test("every hook declaration stays bound; only the trust ledger is normalized", () => {
  const reviewed = witness(REVIEWED);
  for (const tail of [
    '[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "/bin/unreviewed" }]\n',
    '[hooks]\nenabled = false\n',
    '[hooks.session_start]\ntrusted = true\n',
  ]) expect(witness(REVIEWED + tail)).not.toBe(reviewed);
});

test("skill registrations that can enable something stay bound", () => {
  const reviewed = witness(REVIEWED);
  const registration = (body: string) => `${REVIEWED}[[skills.config]]\n${body}\n`;
  for (const body of [
    'path = "/home/operator/.codex/skills/native/other/SKILL.md"\nenabled = true',
    'name = "vendor-skill"\nenabled = true',
    // No explicit disable: the entry may still enable its target.
    'path = "/home/operator/.codex/skills/native/other/SKILL.md"',
    'path = "/home/operator/.codex/skills/native/other/SKILL.md"\nenabled = false\nnote = "reinterpreted elsewhere"',
    'path = "/home/operator/.codex/skills/native/other/SKILL.md"\nname = "ambiguous"\nenabled = false',
    'enabled = false',
    'path = "/home/operator/skill"\nname = false\nenabled = false',
    'name = ""\nenabled = false',
  ]) expect(witness(registration(body))).not.toBe(reviewed);
  // Flipping the reviewed copy back on is a discovery change.
  expect(witness(REVIEWED.replace('path = "/home/operator/.codex/skills/native/gardener/SKILL.md"\nenabled = false', 'path = "/home/operator/.codex/skills/native/gardener/SKILL.md"\nenabled = true'))).not.toBe(reviewed);
  // So is reseeding bundled skills.
  expect(witness(REVIEWED.replace("enabled = false\n[[skills.config]]", "enabled = true\n[[skills.config]]"))).not.toBe(reviewed);
});

test("provider routing, project trust, environment and unknown sections stay bound", () => {
  const reviewed = witness(REVIEWED);
  for (const tail of [
    'model_provider = "custom"\n',
    '[model_providers.custom]\nbase_url = "https://unreviewed.invalid"\n',
    '[projects."/home/operator/repo"]\ntrust_level = "trusted"\n',
    '[mcp_servers.extra]\ncommand = "/bin/unreviewed"\n',
    '[shell_environment_policy]\ninclude_only = ["PATH"]\n',
    '[features]\nunreviewed_feature = true\n',
    '[unknown_surface]\nenabled = true\n',
    // A profile may select inference, nothing else.
    '[profiles.fast]\nsandbox_mode = "danger-full-access"\n',
    '[profiles.fast]\nmodel_provider = "custom"\n',
  ]) expect(witness(REVIEWED + tail)).not.toBe(reviewed);
});

test("number spelling stays bound while the numeric-token order does not", () => {
  const reviewed = witness(REVIEWED);
  // The parser would otherwise collapse these spellings into one value.
  expect(witness(REVIEWED.replace("scroll_rate = 4.0", "scroll_rate = 4.00"))).not.toBe(reviewed);
  expect(witness(REVIEWED + "unrelated = 1\n")).not.toBe(witness(REVIEWED + "unrelated = 1.0\n"));
  // Re-serialization moves tokens between tables without changing any value.
  expect(witness('[tui]\nscroll_rate = 4\n[other]\nlimit = 5\n')).toBe(witness('[other]\nlimit = 5\n[tui]\nscroll_rate = 4\n'));
  // A swapped value is still a changed configuration, not a reordering.
  expect(witness('[tui]\nscroll_rate = 4\n[other]\nlimit = 5\n')).not.toBe(witness('[tui]\nscroll_rate = 5\n[other]\nlimit = 4\n'));
});

test("malformed or oversized inference selections and input refuse", () => {
  for (const text of [
    'model = "../instructions"\n',
    'model = ""\n',
    'model_reasoning_effort = "malformed"\n',
    'model_verbosity = "shout"\n',
    '[profiles.fast]\nmodel_reasoning_effort = "malformed"\n',
    `[${"a.".repeat(40)}z]\nx = 1\n`,
    "not toml",
  ]) expect(() => witness(text)).toThrow();
  expect(() => witness(`# ${"x".repeat(1024 * 1024)}\n`)).toThrow();
});
