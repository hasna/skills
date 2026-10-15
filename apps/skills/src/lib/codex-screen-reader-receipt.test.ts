import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCodexSettingsReplacement, hashCodexSettingsReplacementV2, hashCodexSettingsReplacementV3, hashCodexSettingsReplacementV4, hashCodexSettingsReplacementV5, codexSettingsToleratesScreenReaderReceipt, codexSettingsWitnessMatch, type CodexReceiptSettingsMode } from "./codex-settings-witness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sandbox = (prefix = "skills-receipt-") => { const root = realpathSync(mkdtempSync(join(tmpdir(), prefix))); roots.push(root); return root; };

const MODES: Array<[CodexReceiptSettingsMode, (text: string) => string]> = [
  ["codex-settings-v1", hashCodexSettingsReplacement],
  ["codex-settings-v2", hashCodexSettingsReplacementV2],
  ["codex-settings-v3", hashCodexSettingsReplacementV3],
  ["codex-settings-v4", hashCodexSettingsReplacementV4],
  ["codex-settings-v5", hashCodexSettingsReplacementV5],
];
const BASE = `model = "gpt-5"\n\n[skills.bundled]\nenabled = false\n\n[[skills.config]]\npath = "/synthetic/home/.codex/skills/x/SKILL.md"\nenabled = false\n\n[tui]\nalternate_screen = "never"\n\n[projects."/synthetic/work/repo"]\ntrust_level = "trusted"\n\n[mcp_servers.local]\ncommand = "/usr/bin/true"\nstartup_timeout_ms = 2000\n`;
const MINIMAL = `[skills.bundled]\nenabled = false\n`;
/** Codex 0.162.1 inserts the receipt into the existing `[tui]` table (toml_edit). */
const withReceipt = (text: string, value: unknown = true) => text.replace(`[tui]\nalternate_screen = "never"\n`, `[tui]\nalternate_screen = "never"\nscreen_reader_detection_done = ${value}\n`);
/** ... or creates `[tui]` at the end when the document has none. */
const newTuiReceipt = (text: string, value: unknown = true) => `${text}\n[tui]\nscreen_reader_detection_done = ${value}\n`;
/** Codex appends one `[projects."<dir>"]` table when a folder is trusted. */
const trusted = (text: string, dir: string, level = "trusted") => `${text}\n[projects.${JSON.stringify(dir)}]\ntrust_level = ${JSON.stringify(level)}\n`;

test("stored V1-V5 digests keep their exact values (computed on 0.10.72)", () => {
  const golden: Record<string, Record<string, string>> = {
    base: { v1: "57123e5f06cfe89434805e12baf0863d1bd7f3d7d3a90b2e24ca8cf4b8ac58dc", v2: "4947e7a2cde230143de695ab45223f1b79e51127edad8f05cccf52d537a70fc0", v3: "4382832d46360a14252cc978ef6cf6d79038d155ff2706e1c758ade9e15c7352", v4: "9331b37006190764506516428105842188fb7f83d5f08d66312b1dc4d374bd21", v5: "a30002f3e98fd915bb8796161110fb5c7738e6a5aed7d48ee759fd119035d8ec" },
    minimal: { v1: "053a9271420d84a52b701c0dc175e251821c4286a859c943da12b053ffaf3db1", v2: "70f9dc96e399dddd23da262f749131501ef220d24ca75a7cd0cc95268ab9be11", v3: "0959d9c505fe219fe16072ff6e284f87b89de239b16bd61b8473e5abfbf966d0", v4: "e59150362d7ba0fdaace7197ad63620507d67250440a13cbd9e0cded80f2e1e3", v5: "4b2db39fe6358f0de2dc9a2d1bd11ad51afab538009244325b619f0e2de0d9a8" },
  };
  for (const [name, text] of [["base", BASE], ["minimal", MINIMAL]] as const)
    for (const [mode, hash] of MODES) expect(hash(text)).toBe(golden[name]![mode.slice("codex-settings-".length)]!);
});

test("every typed V1-V5 mode accepts the boolean screen-reader receipt alone, in either direction", () => {
  for (const [mode, hash] of MODES) {
    for (const [reviewed, current] of [
      [BASE, withReceipt(BASE)], [BASE, withReceipt(BASE, false)],
      [MINIMAL, newTuiReceipt(MINIMAL)], [MINIMAL, newTuiReceipt(MINIMAL, false)],
      // The reviewed document already held it and the current one does not, or holds the other value.
      [withReceipt(BASE), BASE], [newTuiReceipt(MINIMAL), MINIMAL], [withReceipt(BASE), withReceipt(BASE, false)],
      // V4 count state and V5 status-line display state beside the receipt keep their own tolerances.
      [`${MINIMAL}\n[tui.model_availability_nux]\n"gpt-5" = 1\n`, `${MINIMAL}\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-5" = 2\n`],
    ]) {
      const expected = hash(reviewed!);
      if (mode !== "codex-settings-v4" && mode !== "codex-settings-v5" && reviewed!.includes("model_availability_nux")) continue;
      expect(hash(current!)).not.toBe(expected);
      expect(codexSettingsToleratesScreenReaderReceipt(current!, mode, expected)).toBe(true);
    }
  }
});

test("a non-boolean receipt, another TUI key or any other change still drifts", () => {
  for (const [mode, hash] of MODES) {
    const expected = hash(BASE), minimal = hash(MINIMAL);
    for (const value of ['"true"', "1", "[]", "{}", "{ done = true }"]) {
      expect(codexSettingsToleratesScreenReaderReceipt(withReceipt(BASE, value), mode, expected)).toBe(false);
      expect(codexSettingsToleratesScreenReaderReceipt(newTuiReceipt(MINIMAL, value), mode, minimal)).toBe(false);
    }
    // Codex also seeds `animations = false` when it detects a reader: still bound.
    expect(codexSettingsToleratesScreenReaderReceipt(withReceipt(BASE).replace("screen_reader_detection_done", "animations = false\nscreen_reader_detection_done"), mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(BASE.replace('alternate_screen = "never"', 'alternate_screen = "always"'), mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(BASE.replace('alternate_screen = "never"\n', ""), mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(withReceipt(BASE).replace('alternate_screen = "never"', 'alternate_screen = "always"'), mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(`${withReceipt(BASE)}\n[plugins."x@local"]\nenabled = true\n`, mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(withReceipt(BASE).replace('model = "gpt-5"', 'model = "gpt-5"\nsandbox_mode = "danger-full-access"'), mode, expected)).toBe(false);
    // The receipt elsewhere than the root `[tui]` table is not the native receipt.
    expect(codexSettingsToleratesScreenReaderReceipt(`${BASE}\n[profiles.p.tui]\nscreen_reader_detection_done = true\n`, mode, expected)).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(`screen_reader_detection_done = true\n${BASE}`, mode, expected)).toBe(false);
    // A numeric spelling change is never absorbed.
    const numeric = `${BASE}\n[extra]\nvalue = 10\n`;
    expect(codexSettingsToleratesScreenReaderReceipt(withReceipt(numeric).replace("value = 10", "value = 0xA"), mode, hash(numeric))).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt("not = [valid", mode, expected)).toBe(false);
  }
});

test("project trust entries are not tolerated: an appended trusted folder still drifts, alone or beside the receipt", () => {
  const dir = join(sandbox(), "project"); mkdirSync(dir);
  for (const [mode, hash] of MODES) {
    for (const reviewed of [BASE, MINIMAL]) {
      expect(codexSettingsToleratesScreenReaderReceipt(trusted(reviewed, dir), mode, hash(reviewed))).toBe(false);
      expect(codexSettingsToleratesScreenReaderReceipt(trusted(newTuiReceipt(reviewed.replace(`[tui]\nalternate_screen = "never"\n`, "")), dir), mode, hash(reviewed.replace(`[tui]\nalternate_screen = "never"\n`, "")))).toBe(false);
    }
    expect(codexSettingsToleratesScreenReaderReceipt(trusted(withReceipt(BASE), dir), mode, hash(BASE))).toBe(false);
    expect(codexSettingsToleratesScreenReaderReceipt(trusted(withReceipt(BASE), dir, "untrusted"), mode, hash(BASE))).toBe(false);
  }
});

test("a witness file is classified as exact, receipt-only or drift", () => {
  const config = join(sandbox(), "config.toml");
  for (const [mode, hash] of MODES) {
    const expected = hash(BASE);
    writeFileSync(config, BASE);
    expect(codexSettingsWitnessMatch(config, mode, expected)).toBe("exact");
    writeFileSync(config, withReceipt(BASE));
    expect(codexSettingsWitnessMatch(config, mode, expected)).toBe("screen-reader-receipt");
    writeFileSync(config, withReceipt(BASE).replace("screen_reader_detection_done", "animations = false\nscreen_reader_detection_done"));
    expect(codexSettingsWitnessMatch(config, mode, expected)).toBeNull();
    writeFileSync(config, trusted(withReceipt(BASE), "/synthetic/other"));
    expect(codexSettingsWitnessMatch(config, mode, expected)).toBeNull();
  }
});
