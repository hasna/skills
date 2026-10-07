/** Explicit settings witness: typed display and recognized model selections may vary. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const CLAUDE_SETTINGS_WITNESS_LIMITS = Object.freeze({ bytes: 1024 * 1024, rows: 1024, depth: 32, nodes: 65536, stringCharacters: 16384, pathCharacters: 4096 });
export interface ClaudeSettingsWitnessBudget { remaining: number }
function need(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Claude settings witness ${reason}`);
}
function absolutePath(value: unknown): asserts value is string {
  need(typeof value === "string" && value.length > 0 && value.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.pathCharacters && !/[\x00-\x1f\x7f]/.test(value) && isAbsolute(value) && resolve(value) === value, "requires a normalized absolute path");
}
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function parents(path: string): Array<[string, BigIntStats]> {
  const result: Array<[string, BigIntStats]> = [];
  for (let at = dirname(path); ; at = dirname(at)) {
    const stat = lstatSync(at, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink(), "path traverses a symlink or non-directory");
    result.push([at, stat]);
    if (at === dirname(at)) return result;
  }
}
export function readNativeSettingsWitnessFile(path: string, budget: ClaudeSettingsWitnessBudget, filename: "settings.json" | "config.toml" | "sumi.json" = "settings.json"): string {
  absolutePath(path); need(basename(path) === filename, `requires ${filename}`);
  need(Number.isSafeInteger(budget.remaining) && budget.remaining >= 0, "has an invalid byte budget");
  const ancestors = parents(path), initial = lstatSync(path, { bigint: true });
  need(initial.isFile() && !initial.isSymbolicLink() && initial.size <= BigInt(CLAUDE_SETTINGS_WITNESS_LIMITS.bytes), "is not a bounded regular file");
  need(initial.size <= BigInt(budget.remaining), "exceeds its aggregate byte limit");
  // Nonblocking open also refuses a FIFO substituted after lstat without hanging.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    need(opened.isFile() && sameFile(initial, opened), "changed during open");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    need(current.isFile() && sameFile(opened, after) && sameFile(after, current) && BigInt(length) === opened.size, "changed during read");
    for (const [ancestor, before] of ancestors) {
      const now = lstatSync(ancestor, { bigint: true });
      need(now.isDirectory() && before.dev === now.dev && before.ino === now.ino && before.mode === now.mode, "parent changed during read");
    }
    budget.remaining -= length;
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error("Claude settings witness is not strict UTF-8"); }
  } finally { closeSync(fd); }
}

// A small tagged syntax tree rejects duplicate decoded keys and retains unknown
// numbers without rounding (including large integers and negative zero).
// Number spelling stays bound; object keys are canonicalized after parsing.
type ObjectValue = { kind: "object"; entries: Array<[string, Value]> };
type Value = ObjectValue | { kind: "array"; items: Value[] } | { kind: "string"; value: string } | { kind: "number"; value: string } | { kind: "literal"; value: "true" | "false" | "null" };
function parse(text: string): ObjectValue {
  let at = 0, nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  function string(): string {
    need(text[at] === '"', "contains invalid JSON");
    const start = at++;
    while (at < text.length) {
      const character = text[at++]!;
      if (character === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, at)); } catch { throw new Error("Claude settings witness contains invalid JSON string"); }
        need(value.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.stringCharacters, "exceeds its string limit");
        return value;
      }
      if (character === "\\") at++;
    }
    throw new Error("Claude settings witness contains an unterminated JSON string");
  }
  function value(depth: number): Value {
    need(depth <= CLAUDE_SETTINGS_WITNESS_LIMITS.depth && ++nodes <= CLAUDE_SETTINGS_WITNESS_LIMITS.nodes, "exceeds its nesting or node limit");
    space();
    const character = text[at];
    if (character === '"') return { kind: "string", value: string() };
    if (character === "{" || character === "[") {
      at++; space();
      const object = character === "{", end = object ? "}" : "]", entries: ObjectValue["entries"] = [], items: Value[] = [], keys = new Set<string>();
      if (text[at] !== end) while (true) {
        if (object) {
          space(); const key = string();
          need(!keys.has(key), "contains a duplicate JSON key"); keys.add(key);
          space(); need(text[at++] === ":", "contains invalid JSON");
          entries.push([key, value(depth + 1)]);
        } else items.push(value(depth + 1));
        space(); if (text[at] === end) break;
        need(text[at++] === ",", "contains invalid JSON");
      }
      at++;
      return object ? { kind: "object", entries } : { kind: "array", items };
    }
    for (const literal of ["true", "false", "null"] as const) if (text.startsWith(literal, at)) { at += literal.length; return { kind: "literal", value: literal }; }
    numberPattern.lastIndex = at;
    const number = numberPattern.exec(text);
    need(number, "contains invalid JSON"); at += number[0].length;
    return { kind: "number", value: number[0] };
  }
  const root = value(0); space();
  need(at === text.length && root.kind === "object", "requires a JSON object without trailing content");
  need(root.entries.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.rows, "exceeds its settings field limit");
  return root;
}

// Everything not explicitly listed remains bound, including unknown fields,
// language, outputStyle, theme (v4 alone omits a built-in theme, see below),
// command-bearing UI and provider mappings.
const BOOLEAN_PREFERENCES = new Set([
  "autoScrollEnabled", "axScreenReader", "emojiCompletionEnabled", "prefersReducedMotion",
  "showTurnDuration", "spinnerTipsEnabled", "syntaxHighlightingDisabled", "terminalProgressBarEnabled",
  "terminalTitleFromRename", "verbose", "wheelScrollAccelerationEnabled",
]);
const ENUM_PREFERENCES: Record<string, readonly string[]> = Object.freeze({
  editorMode: ["normal", "vim"], tui: ["default", "fullscreen"], viewMode: ["default", "verbose", "focus"],
});
// Fixed v1 model-selection values from the official model-config and models
// overview references. These select inference, not files or discovery roots.
// Provider mappings, modelOverrides/modelPicker, environment and switch hooks
// remain bound. Never expand this to a prefix/path/custom-provider wildcard.
const BUILTIN_MODEL_SELECTIONS = new Set([
  "default", "best", "fable", "fable[1m]", "sonnet", "sonnet[1m]", "opus", "opus[1m]", "haiku", "opusplan",
  "claude-fable-5-1", "claude-fable-5", "claude-fable-5[1m]", "claude-opus-5", "claude-sonnet-5",
  "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929",
  "claude-opus-4-8", "claude-opus-4-8[1m]", "claude-opus-4-7", "claude-sonnet-4-6",
  "claude-opus-4-5-20251101", "claude-opus-4-5", "claude-haiku-4-5",
  "claude-fable-5-1[1m]", "claude-opus-5[1m]", "claude-opus-4-7[1m]", "claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]",
]);
// v4 only: the fixed built-in values of the top-level `theme` setting, read on
// 2026-10-07 from https://code.claude.com/docs/en/settings-reference#theme
// (the same six presets are the custom-theme `base` values, plus the auto
// option, in https://code.claude.com/docs/en/terminal-config#match-the-color-theme).
// They select a colour palette and load nothing. `custom:<slug>` and
// `custom:<plugin-name>:<slug>` load theme files from ~/.claude/themes/ or a
// plugin, so they stay bound, as does every other value, type or spelling.
// Exact, case-sensitive membership only: never a prefix, pattern or fold.
export const CLAUDE_BUILTIN_THEMES = Object.freeze(["auto", "dark", "light", "dark-daltonized", "light-daltonized", "dark-ansi", "light-ansi"] as const);
const BUILTIN_THEMES: ReadonlySet<string> = new Set(CLAUDE_BUILTIN_THEMES);
function canonical(value: Value): Value {
  if (value.kind === "object") return { kind: "object", entries: value.entries.map(([key, child]): [string, Value] => [key, canonical(child)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
  if (value.kind === "array") return { kind: "array", items: value.items.map(canonical) };
  return value;
}

/** Cooperating installers may replace only their explicitly selected event. Compare the strict syntax
 * trees, not JSON.parse values or the preference-tolerant witness digest: all
 * other hooks, discovery settings, unknown values and number spellings remain
 * identical. Whitespace and object-key order have no configuration meaning.
 */
export const CLAUDE_COORDINATED_HOOK_EVENTS = ["PreToolUse", "PostToolUse", "Stop", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart"] as const;
export type ClaudeCoordinatedHookEvent = typeof CLAUDE_COORDINATED_HOOK_EVENTS[number];
export function assertClaudeHookEventsReplacement(before: string | null, replacement: string, events: readonly ClaudeCoordinatedHookEvent[]): void {
  need(Array.isArray(events) && events.length > 0 && events.length <= CLAUDE_COORDINATED_HOOK_EVENTS.length
    && new Set(events).size === events.length && events.every(event => CLAUDE_COORDINATED_HOOK_EVENTS.includes(event)), "requires explicit supported hook events");
  const label = events.join(",");
  function bounded(text: string): ObjectValue {
    need(typeof text === "string" && Buffer.byteLength(text) <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes, `${label} update exceeds its byte limit`);
    return parse(text);
  }
  const original = bounded(before ?? "{}"), next = bounded(replacement);
  const hadHooks = original.entries.some(([key]) => key === "hooks");
  function withoutOwnedEvents(value: ObjectValue): Value {
    const hooks = value.entries.find(([key]) => key === "hooks")?.[1];
    if (hooks !== undefined) {
      need(hooks.kind === "object", `${label} update requires an object of hooks`);
      for (const event of events) {
        const selected = hooks.entries.find(([key]) => key === event)?.[1];
        need(selected === undefined || selected.kind === "array", `${event} update requires a ${event} array`);
      }
      hooks.entries = hooks.entries.filter(([key]) => !events.includes(key as ClaudeCoordinatedHookEvent));
      // Only selected events may create the previously absent hooks container.
      if (!hadHooks && hooks.entries.length === 0) value.entries = value.entries.filter(([key]) => key !== "hooks");
    }
    return canonical(value);
  }
  need(JSON.stringify(withoutOwnedEvents(original)) === JSON.stringify(withoutOwnedEvents(next)), `${label} update changed settings outside hooks.${label}`);
}
export function assertClaudeStopHookReplacement(before: string | null, replacement: string): void {
  assertClaudeHookEventsReplacement(before, replacement, ["Stop"]);
}
export function assertClaudePreToolUseHookReplacement(before: string | null, replacement: string): void {
  assertClaudeHookEventsReplacement(before, replacement, ["PreToolUse"]);
}

const PERSISTED_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh"]);
function inferencePreference(key: string, child: Value, version: 2 | 3): boolean {
  if (key === "skipDangerousModePermissionPrompt") {
    // Claude also uses this acceptance when deciding bypass mode and pending
    // project MCP approval. It is authority-bearing, not a display preference.
    need(child.kind === "literal" && (child.value === "true" || child.value === "false"), "contains an invalid dialog acknowledgment");
    return false;
  }
  if (key === "effortLevel") {
    need(child.kind === "string" && PERSISTED_EFFORT_LEVELS.has(child.value), "contains an invalid persisted effort level");
    return true;
  }
  if (key !== "modelSettings") return false;
  need(child.kind === "object", "requires an object of model preferences");
  child.entries = child.entries.filter(([model, preferences]) => {
    // v2 keeps its original model inventory. v3 recognizes the persisted
    // effort-only shape: the key selects a model's preference, never a provider
    // mapping or executable. New model names must not invalidate discovery.
    // Every additional property (including maxEffortLevel) stays fully bound.
    if ((version === 2 && !BUILTIN_MODEL_SELECTIONS.has(model)) || preferences.kind !== "object"
      || preferences.entries.length !== 1 || preferences.entries[0]![0] !== "effortLevel") return true;
    const effort = preferences.entries[0]![1];
    need(effort.kind === "string" && PERSISTED_EFFORT_LEVELS.has(effort.value), "contains an invalid persisted model effort level");
    return false;
  });
  return child.entries.length === 0;
}

function settingsDigest(text: string, version: 1 | 2 | 3 | 4 = 1): string {
  const value = parse(text);
  value.entries = value.entries.filter(([key, child]) => {
    // v4 is v3 plus one omission: a top-level built-in theme. Any other theme
    // value or type falls through and stays bound exactly as in v3; nested
    // `theme` keys are never inspected here.
    if (version === 4 && key === "theme" && child.kind === "string" && BUILTIN_THEMES.has(child.value)) return false;
    if (version !== 1 && inferencePreference(key, child, version === 4 ? 3 : version)) return false;
    if (key === "model") {
      need(child.kind === "string", "contains an invalid model selection");
      return !BUILTIN_MODEL_SELECTIONS.has(child.value);
    }
    if (BOOLEAN_PREFERENCES.has(key)) {
      need(child.kind === "literal" && (child.value === "true" || child.value === "false"), "contains an invalid display preference");
      return false;
    }
    if (Object.hasOwn(ENUM_PREFERENCES, key)) {
      need(child.kind === "string" && ENUM_PREFERENCES[key]!.includes(child.value), "contains an invalid display preference");
      return false;
    }
    return true;
  });
  return createHash("sha256").update(`hasna.skills.claude-settings.v${version}\0`).update(JSON.stringify(canonical(value))).digest("hex");
}
/** Hash only reviewed installer-rendered settings after the disk preimage has been verified. */
export function hashClaudeSettingsReplacement(text: string, budget: ClaudeSettingsWitnessBudget): string {
  need(typeof text === "string", "requires settings text");
  const bytes = Buffer.byteLength(text);
  need(bytes <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes && Number.isSafeInteger(budget.remaining) && budget.remaining >= bytes, "exceeds its byte limit");
  budget.remaining -= bytes;
  return settingsDigest(text);
}
/** Explicit capture never converts a stored legacy raw witness or changes settings. */
export function captureClaudeSettings(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-settings-v1"; sha256: string } {
  return { path, hashMode: "claude-settings-v1", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget)) };
}

/** A new explicit review is required; v1 witnesses retain their old meaning. */
export function captureClaudeSettingsV2(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-settings-v2"; sha256: string } {
  return { path, hashMode: "claude-settings-v2", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget), 2) };
}
export function hashClaudeSettingsReplacementV2(text: string, budget: ClaudeSettingsWitnessBudget): string {
  need(typeof text === "string", "requires settings text");
  const bytes = Buffer.byteLength(text);
  need(bytes <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes && Number.isSafeInteger(budget.remaining) && budget.remaining >= bytes, "exceeds its byte limit");
  budget.remaining -= bytes;
  return settingsDigest(text, 2);
}

/** Explicit review of model-independent effort preferences; v1/v2 stay exact. */
export function captureClaudeSettingsV3(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-settings-v3"; sha256: string } {
  return { path, hashMode: "claude-settings-v3", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget), 3) };
}
export function hashClaudeSettingsReplacementV3(text: string, budget: ClaudeSettingsWitnessBudget): string {
  need(typeof text === "string", "requires settings text");
  const bytes = Buffer.byteLength(text);
  need(bytes <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes && Number.isSafeInteger(budget.remaining) && budget.remaining >= bytes, "exceeds its byte limit");
  budget.remaining -= bytes;
  return settingsDigest(text, 3);
}

/** Upgrade only with an exact semantic preimage of the prior review. This
 * proves every non-preference setting is unchanged; it never refreshes drift.
 * Both files are bounded regular settings.json files, read without symlinks.
 */
export function upgradeClaudeSettingsWitness(previous: { path: string; hashMode?: "bytes" | "claude-settings-v1" | "claude-settings-v2"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureClaudeSettingsV3> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key))
    && (previous.hashMode === undefined || previous.hashMode === "bytes" || previous.hashMode === "claude-settings-v1" || previous.hashMode === "claude-settings-v2")
    && typeof previous.sha256 === "string" && /^[a-f0-9]{64}$/.test(previous.sha256), "requires an exact legacy settings witness");
  const budget = { remaining: 2 * CLAUDE_SETTINGS_WITNESS_LIMITS.bytes };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget), current = readNativeSettingsWitnessFile(previous.path, budget);
  const beforeDigest = previous.hashMode === undefined || previous.hashMode === "bytes" ? createHash("sha256").update(before).digest("hex") : settingsDigest(before, previous.hashMode === "claude-settings-v1" ? 1 : 2);
  need(beforeDigest === previous.sha256, "reviewed preimage does not match the legacy witness");
  const sha256 = settingsDigest(current, 3);
  need(settingsDigest(before, 3) === sha256, "non-preference settings changed; explicit discovery review required");
  return { path: previous.path, hashMode: "claude-settings-v3", sha256 };
}

/** Explicit review that additionally permits a built-in top-level theme.
 * v1/v2/v3 witnesses keep their meaning; nothing selects v4 implicitly. */
export function captureClaudeSettingsV4(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-settings-v4"; sha256: string } {
  return { path, hashMode: "claude-settings-v4", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget), 4) };
}
export function hashClaudeSettingsReplacementV4(text: string, budget: ClaudeSettingsWitnessBudget): string {
  need(typeof text === "string", "requires settings text");
  const bytes = Buffer.byteLength(text);
  need(bytes <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes && Number.isSafeInteger(budget.remaining) && budget.remaining >= bytes, "exceeds its byte limit");
  budget.remaining -= bytes;
  return settingsDigest(text, 4);
}

/** Explicit opt-in upgrade to v4 with an exact preserved preimage of the prior
 * review (raw bytes, v1, v2 or v3). It proves that every setting v4 binds is
 * unchanged; any other drift, including skipDangerousModePermissionPrompt,
 * refuses. A stored witness is never rewritten without this call.
 */
export function upgradeClaudeSettingsWitnessV4(previous: { path: string; hashMode?: "bytes" | "claude-settings-v1" | "claude-settings-v2" | "claude-settings-v3"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureClaudeSettingsV4> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key))
    && (previous.hashMode === undefined || previous.hashMode === "bytes" || previous.hashMode === "claude-settings-v1" || previous.hashMode === "claude-settings-v2" || previous.hashMode === "claude-settings-v3")
    && typeof previous.sha256 === "string" && /^[a-f0-9]{64}$/.test(previous.sha256), "requires an exact prior settings witness");
  const budget = { remaining: 2 * CLAUDE_SETTINGS_WITNESS_LIMITS.bytes };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget), current = readNativeSettingsWitnessFile(previous.path, budget);
  const beforeDigest = previous.hashMode === undefined || previous.hashMode === "bytes" ? createHash("sha256").update(before).digest("hex")
    : settingsDigest(before, previous.hashMode === "claude-settings-v1" ? 1 : previous.hashMode === "claude-settings-v2" ? 2 : 3);
  need(beforeDigest === previous.sha256, "reviewed preimage does not match the prior witness");
  const sha256 = settingsDigest(current, 4);
  need(settingsDigest(before, 4) === sha256, "non-preference settings changed; explicit discovery review required");
  return { path: previous.path, hashMode: "claude-settings-v4", sha256 };
}

/** Strict bounded JSON control witness; metadata exclusion must be explicit. */
export function hashNativeJsonControls(text: string, excludedMetadata?: "version"): string {
  need(Buffer.byteLength(text) <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes, "exceeds its byte limit");
  const value = parse(text);
  value.entries = value.entries.filter(([key, child]) => {
    if (key !== excludedMetadata) return true;
    need(child.kind === "string" && child.value.length <= 128, "has invalid version metadata");
    return false;
  });
  return createHash("sha256").update("hasna.skills.native-json-controls.v1\0").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Sumi's versioned review uses the same strict JSON parser and bounded syntax
 * tree. Unknown fields, permissions, routing and executable inputs stay bound.
 * Only schema/display strings and two presentation-only booleans may vary. */
export function hashSumiNativeJsonControls(text: string): string {
  need(Buffer.byteLength(text) <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes, "exceeds its byte limit");
  const value = parse(text);
  value.entries = value.entries.filter(([key, child]) => {
    if (key === "$schema" || key === "username") {
      need(child.kind === "string", "has invalid Sumi display metadata");
      return false;
    }
    if (key !== "experimental") return true;
    need(child.kind === "object", "requires Sumi experimental controls to be an object");
    child.entries = child.entries.filter(([name, option]) => {
      if (name !== "statusline" && name !== "compact_tools") return true;
      need(option.kind === "literal" && (option.value === "true" || option.value === "false"), "has invalid Sumi display preference");
      return false;
    });
    return child.entries.length > 0;
  });
  // Sumi normalizes legacy permission maps with Object.entries: their order is
  // authority, not formatting. Retain all control-key and array ordering.
  return createHash("sha256").update("hasna.skills.sumi-settings.v1\0").update(JSON.stringify(value)).digest("hex");
}
