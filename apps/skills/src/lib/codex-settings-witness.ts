/** Explicit semantic witness for Codex inference preferences and native-owned state.
 *
 * The V2 reviewed witness binds the complete `config.toml` apart from four
 * documented classes that are not discovery inputs, and that Codex or the
 * installer rewrites on their own:
 *
 *   1. `hooks.state` — the native hook-trust ledger (`enabled`, `trusted_hash`
 *      per hook key). Codex writes it whenever it (re)trusts a hook, and
 *      `skills hook trust` writes it too. Every hook *declaration* stays bound:
 *      `hooks` keys other than `state`, project `.codex/config.toml` layers and
 *      the managed `hooks.json` inventory are witnessed separately, so a new or
 *      changed hook command still refuses.
 *   2. Table/block order and other serialization-only differences — TOML table
 *      order carries no meaning, so the projection is canonicalized and the
 *      numeric-token binding is order-insensitive.
 *   3. `[[skills.config]]` registrations that only disable a skill. An explicit
 *      `enabled = false` entry cannot add a discovery input, and the installer
 *      writes those entries itself for every native copy it retires. Any entry
 *      that can enable something — `enabled = true`, a missing or non-boolean
 *      `enabled`, an unknown key, or an entry without an unambiguous selector —
 *      stays bound.
 *   4. Inference selections (`model`, `model_reasoning_effort`,
 *      `model_verbosity`) at the document root and inside `[profiles.*]`. They
 *      select a model, never a file, root, hook or provider route. Unknown or
 *      malformed values still refuse, and every other key — including
 *      `model_provider`, `[model_providers.*]`, `plugins`, `marketplaces`,
 *      `skills.bundled`, `[projects.*]` trust, `[mcp_servers.*]`, environment and
 *      unknown fields — stays fully bound.
 *
 * V3 is explicitly selected and preserves V1/V2 digest meanings. It adds
 * service-tier, native personality and model-advertised plan/reasoning effort selections plus the
 * schema-validated ordinary local stdio MCP projection. Reserved Apps, remote,
 * auth, HTTP, unknown and unsupported MCP contracts remain fully bound.
 */
import { hashCodexSettingsReplacement as hashCodexSettingsReplacementV1 } from "./codex-settings-witness-v1.js";
export { captureCodexSettings, hashCodexSettingsReplacement } from "./codex-settings-witness-v1.js";
import { projectRegularCodexMcp } from "./codex-mcp-discovery-projection.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readNativeSettingsWitnessFile, type ClaudeSettingsWitnessBudget } from "./claude-settings-witness.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const EFFORT = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const VERBOSITY = new Set(["low", "medium", "high"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
/** The Codex discovery fields the automatic TOML projection witnesses. A typed
 * `codex-settings-v2` witness binds strictly more of the same file, so it
 * supersedes this projection instead of coexisting with it. */
export const CODEX_DISCOVERY_PROJECTION_FIELDS = ["plugins", "marketplaces", "skills"] as const;
const INFERENCE = ["model", "model_reasoning_effort", "model_verbosity"] as const;
function need(value: unknown): asserts value { if (!value) throw new Error("Invalid Codex settings witness"); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isDate(value: unknown): value is Date { return value instanceof Date; }
// Preserve unknown number/date spelling as well as parsed values. TOML parsers
// can otherwise collapse integer/float or large-number representations. The
// tokens are compared as an order-insensitive multiset: the canonical structure
// already binds each value to its key, so re-serialization cannot make an
// unchanged file look changed.
function numericTokens(text: string): string[] {
  const result: string[] = [];
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (char === "#") { while (at < text.length && text[at] !== "\n") at++; continue; }
    if (char === '"' || char === "'") {
      const quote = char, triple = text.slice(at, at + 3) === quote.repeat(3); at += triple ? 3 : 1;
      while (at < text.length) {
        if (quote === '"' && text[at] === "\\") { at += 2; continue; }
        if (text.slice(at, at + (triple ? 3 : 1)) === quote.repeat(triple ? 3 : 1)) { at += triple ? 3 : 1; break; }
        at++;
      }
      continue;
    }
    if (/[0-9+-]/.test(char)) {
      const start = at;
      while (at < text.length && !/[\s,\]{}#=]/.test(text[at]!)) at++;
      if (at > start) { result.push(text.slice(start, at)); continue; }
    }
    at++;
  }
  return result.sort();
}
function canonical(value: unknown, depth = 0, budget = { remaining: 65536 }): unknown {
  need(depth <= 32 && --budget.remaining >= 0);
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") { need(Number.isFinite(value)); return ["number", String(value)]; }
  if (isDate(value)) { need(Number.isFinite(value.getTime())); return ["date", value.toISOString()]; }
  if (Array.isArray(value)) return ["array", value.map(child => canonical(child, depth + 1, budget))];
  need(isRecord(value));
  return ["object", Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child, depth + 1, budget)])];
}
/** Remove only the documented non-discovery classes. Malformed values for an
 * otherwise-normalized key refuse instead of being adopted silently. */
function normalize(config: Record<string, any>, version: 2 | 3 | 4 = 2): void {
  if (isRecord(config.hooks)) {
    delete config.hooks.state;
    // An empty `[hooks]` table means the same as no hooks configuration at all.
    if (!Object.keys(config.hooks).length) delete config.hooks;
  }
  if (isRecord(config.skills) && Array.isArray(config.skills.config)) {
    const skills = config.skills;
    const retained = skills.config.filter((entry: unknown) => !disablesOneSkill(entry));
    if (retained.length !== skills.config.length) {
      if (retained.length) skills.config = retained;
      else delete skills.config;
    }
    if (!Object.keys(skills).length) delete config.skills;
  }
  inference(config, version);
  if (isRecord(config.profiles)) for (const profile of Object.values(config.profiles)) if (isRecord(profile)) inference(profile, version);
}
/** A registration that cannot enable anything: one unambiguous selector and an
 * explicit `enabled = false`, with no other key to reinterpret. */
function disablesOneSkill(entry: unknown): boolean {
  if (!isRecord(entry) || entry.enabled !== false) return false;
  const keys = Object.keys(entry);
  if (!keys.every(key => key === "path" || key === "name" || key === "enabled")) return false;
  const selector = (["path", "name"] as const).filter(key => Object.hasOwn(entry, key));
  return selector.length === 1 && typeof entry[selector[0]!] === "string" && entry[selector[0]!].length > 0;
}
function inference(target: Record<string, any>, version: 2 | 3 | 4): void {
  const keys = version >= 3 ? [...INFERENCE, "service_tier", "plan_mode_reasoning_effort", "personality"] : INFERENCE;
  for (const key of keys) if (Object.hasOwn(target, key)) {
    const value = target[key];
    if (key === "model") need(typeof value === "string" && MODEL.test(value));
    // Codex 0.160's deprecated native enum only selects/removes model-catalog
    // styling. It cannot name an external instruction file or discovery root.
    else if (key === "personality") need(typeof value === "string" && ["none", "friendly", "pragmatic"].includes(value));
    else if (version >= 3 && key !== "model_verbosity") {
      // Codex 0.160: request ids are strings; effort is model-advertised, not a
      // fixed enum. Bound scalar text, never routes, instructions or paths.
      need(typeof value === "string" && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value));
      if (key !== "service_tier") need(value.length > 0);
    } else need(typeof value === "string" && (key === "model_reasoning_effort" ? EFFORT.has(value) : VERBOSITY.has(value)));
    delete target[key];
  }
}
/** Codex 0.160.1 owns this startup-tooltip count map (HashMap<string, u32>).
 * Only a proved source span is omitted: parse the remainder and compare the
 * entire object with the exact single-field deletion. Ambiguous layouts and
 * malformed/native-schema-incompatible values retain their full witness.
 */
function projectModelAvailabilityNux(config: Record<string, any>, text: string): { config: Record<string, any>; numericSource: string } {
  const tui = config.tui, counts = isRecord(tui) ? tui.model_availability_nux : undefined;
  // Empty native TUI tables carry no field: the first count must not alter V4.
  if (isRecord(tui) && !Object.keys(tui).length) { delete config.tui; return { config, numericSource: text }; }
  if (!isRecord(counts) || Object.keys(counts).length > 256 || !Object.values(counts).every(value => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) return { config, numericSource: text };
  const expected = structuredClone(config);
  delete expected.tui.model_availability_nux;
  const stripEmptyTui = (value: Record<string, any>): void => { if (isRecord(value.tui) && !Object.keys(value.tui).length) delete value.tui; };
  stripEmptyTui(expected);
  const headers: Array<{ start: number; end: number }> = [];
  const spans: Array<{ start: number; end: number }> = [];
  const integer = /^(?:\+?(?:0|[1-9](?:_?\d)*)|0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/;
  const counterIntegers = (span: string): boolean => {
    let values = 0;
    for (let at = 0; at < span.length;) {
      const char = span[at]!;
      if (char === "#") { while (at < span.length && span[at] !== "\n") at++; continue; }
      if (char === '\"' || char === "'") {
        const quote = char; at++;
        while (at < span.length) {
          if (quote === '\"' && span[at] === "\\") { at += 2; continue; }
          if (span[at++] === quote) break;
        }
        continue;
      }
      if (char !== "=") { at++; continue; }
      at++; while (at < span.length && /\s/.test(span[at]!)) at++;
      if (span[at] === "{") { at++; continue; }
      const start = at;
      while (at < span.length && !/[\s,\]{}#]/.test(span[at]!)) at++;
      if (!integer.test(span.slice(start, at))) return false;
      values++;
    }
    return values === Object.keys(counts).length;
  };
  // A successful prefix parse distinguishes real headers/assignments from
  // lookalikes inside multiline strings. Bound parser work independently.
  let attempts = 0;
  const realPrefix = (end: number): boolean => {
    if (++attempts > 256) return false;
    try { Bun.TOML.parse(text.slice(0, end)); return true; } catch { return false; }
  };
  for (const match of text.matchAll(/^[ \t]*\[[^\r\n]+\][ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm)) {
    const start = match.index!, end = start + match[0].length;
    if (realPrefix(end)) headers.push({ start, end });
  }
  for (let at = 0; at < headers.length; at++) {
    const header = headers[at]!;
    let parsed: any;
    try { parsed = Bun.TOML.parse(text.slice(header.start, header.end)); } catch { continue; }
    if (isRecord(parsed.tui) && isRecord(parsed.tui.model_availability_nux) && !Object.keys(parsed.tui.model_availability_nux).length && Object.keys(parsed).length === 1 && Object.keys(parsed.tui).length === 1) spans.push({ start: header.start, end: headers[at + 1]?.start ?? text.length });
  }
  // Codex can also serialize the map inline. No nested TUI object or other
  // same-line control is removable: full-object equality below proves that.
  for (const match of text.matchAll(/^[ \t]*(?:(?:tui|"tui"|'tui')[ \t]*\.[ \t]*)?(?:model_availability_nux|"model_availability_nux"|'model_availability_nux')[ \t]*=[ \t]*\{[^\r\n]*(?:\r?\n|$)/gm)) {
    const start = match.index!, end = start + match[0].length;
    if (realPrefix(end)) spans.push({ start, end });
  }
  for (const { start, end } of spans) {
    // Bun parses 3.0 as number 3; inspect only value literals, never the
    // digits/hyphens in bare model keys such as gpt-5 and o4-mini.
    if (!counterIntegers(text.slice(start, end))) continue;
    const remaining = text.slice(0, start) + text.slice(end);
    let parsed: any;
    try { parsed = Bun.TOML.parse(remaining); } catch { continue; }
    stripEmptyTui(parsed);
    if (isDeepStrictEqual(parsed, expected)) return { config: expected, numericSource: remaining };
  }
  return { config, numericSource: text };
}
function settingsDigest(text: string, version: 2 | 3 | 4 = 2): string {
  let config: any;
  try { config = Bun.TOML.parse(text); } catch { throw new Error("Invalid Codex settings witness"); }
  need(isRecord(config));
  const mcp = version >= 3 ? projectRegularCodexMcp(config, text) : { config, numericSource: text };
  const projected = version === 4 ? projectModelAvailabilityNux(mcp.config, mcp.numericSource) : mcp;
  normalize(projected.config, version);
  return sha(`hasna.skills.codex-settings.v${version}\0${JSON.stringify([canonical(projected.config), numericTokens(projected.numericSource)])}`);
}
export function hashCodexSettingsReplacementV2(text: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): string {
  need(Buffer.byteLength(text) <= 1024 * 1024 && budget.remaining >= Buffer.byteLength(text)); budget.remaining -= Buffer.byteLength(text);
  return settingsDigest(text);
}
export function captureCodexSettingsV2(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "codex-settings-v2"; sha256: string } {
  const text = readNativeSettingsWitnessFile(path, budget, "config.toml");
  return { path, hashMode: "codex-settings-v2", sha256: settingsDigest(text) };
}
/** Read one preserved review preimage under the exact witness file rules, so a
 * caller can prove additional legacy witnesses against the same bytes. */
export function readCodexSettingsPreimage(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 2 * 1024 * 1024 }): string {
  return readNativeSettingsWitnessFile(path, budget, "config.toml");
}
export function upgradeCodexSettingsWitness(previous: { path: string; hashMode?: "bytes" | "codex-settings-v1"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureCodexSettingsV2> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key)) && (previous.hashMode === undefined || previous.hashMode === "bytes" || previous.hashMode === "codex-settings-v1") && /^[a-f0-9]{64}$/.test(previous.sha256));
  const budget = { remaining: 2 * 1024 * 1024 };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget, "config.toml"), current = readNativeSettingsWitnessFile(previous.path, budget, "config.toml");
  need((previous.hashMode === "codex-settings-v1" ? hashCodexSettingsReplacementV1(before) : sha(before)) === previous.sha256);
  const sha256 = settingsDigest(current);
  if (settingsDigest(before) !== sha256) throw new Error("Codex non-preference settings changed; explicit discovery review required");
  return { path: previous.path, hashMode: "codex-settings-v2", sha256 };
}

/** Opt-in v3 adds service-tier, plan-mode effort and typed ordinary local MCP selections. V2 retains its
 * exact digest meaning. Provider/native/auth/cloud/reserved/unknown controls remain bound. */
export function hashCodexSettingsReplacementV3(text: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): string {
  need(Buffer.byteLength(text) <= 1024 * 1024 && budget.remaining >= Buffer.byteLength(text)); budget.remaining -= Buffer.byteLength(text);
  return settingsDigest(text, 3);
}
export function captureCodexSettingsV3(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "codex-settings-v3"; sha256: string } {
  return { path, hashMode: "codex-settings-v3", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget, "config.toml"), 3) };
}
/** Preserve the original mode's meaning and prove its preimage before explicitly
 * changing the review contract. Never use v3 to verify an existing v2 digest. */
export function upgradeCodexSettingsWitnessV3(previous: { path: string; hashMode?: "bytes" | "codex-settings-v1" | "codex-settings-v2"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureCodexSettingsV3> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key)) && (previous.hashMode === undefined || ["bytes", "codex-settings-v1", "codex-settings-v2"].includes(previous.hashMode)) && /^[a-f0-9]{64}$/.test(previous.sha256));
  const budget = { remaining: 2 * 1024 * 1024 };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget, "config.toml"), current = readNativeSettingsWitnessFile(previous.path, budget, "config.toml");
  const original = previous.hashMode === "codex-settings-v2" ? settingsDigest(before) : previous.hashMode === "codex-settings-v1" ? hashCodexSettingsReplacementV1(before) : sha(before);
  need(original === previous.sha256);
  const sha256 = settingsDigest(current, 3);
  if (settingsDigest(before, 3) !== sha256) throw new Error("Codex settings outside the reviewed V3 contract changed; explicit discovery review required");
  return { path: previous.path, hashMode: "codex-settings-v3", sha256 };
}

/** Explicit V4 adds only schema-valid native model-availability UI counts. */
export function hashCodexSettingsReplacementV4(text: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): string {
  need(Buffer.byteLength(text) <= 1024 * 1024 && budget.remaining >= Buffer.byteLength(text)); budget.remaining -= Buffer.byteLength(text);
  return settingsDigest(text, 4);
}
export function captureCodexSettingsV4(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "codex-settings-v4"; sha256: string } {
  return { path, hashMode: "codex-settings-v4", sha256: settingsDigest(readNativeSettingsWitnessFile(path, budget, "config.toml"), 4) };
}
/** Prove the original V1/V2/V3/byte digest first; a V4 hash never verifies an old pin. */
export function upgradeCodexSettingsWitnessV4(previous: { path: string; hashMode?: "bytes" | "codex-settings-v1" | "codex-settings-v2" | "codex-settings-v3"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureCodexSettingsV4> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key)) && (previous.hashMode === undefined || ["bytes", "codex-settings-v1", "codex-settings-v2", "codex-settings-v3"].includes(previous.hashMode)) && /^[a-f0-9]{64}$/.test(previous.sha256));
  const budget = { remaining: 2 * 1024 * 1024 };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget, "config.toml"), current = readNativeSettingsWitnessFile(previous.path, budget, "config.toml");
  const original = previous.hashMode === "codex-settings-v3" ? settingsDigest(before, 3) : previous.hashMode === "codex-settings-v2" ? settingsDigest(before, 2) : previous.hashMode === "codex-settings-v1" ? hashCodexSettingsReplacementV1(before) : sha(before);
  need(original === previous.sha256);
  const sha256 = settingsDigest(current, 4);
  if (settingsDigest(before, 4) !== sha256) throw new Error("Codex settings outside the reviewed V4 contract changed; explicit discovery review required");
  return { path: previous.path, hashMode: "codex-settings-v4", sha256 };
}
