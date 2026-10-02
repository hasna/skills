/** Explicit semantic witness for Codex display/inference preferences. */
import { createHash } from "node:crypto";
import { readNativeSettingsWitnessFile, type ClaudeSettingsWitnessBudget } from "./claude-settings-witness.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const EFFORT = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const VERBOSITY = new Set(["low", "medium", "high"]);
function need(value: unknown): asserts value { if (!value) throw new Error("Invalid Codex settings witness"); }
// Preserve unknown number/date spelling as well as parsed values. TOML parsers
// can otherwise collapse integer/float or large-number representations. This
// conservatively binds token order while ignoring comments and quoted strings.
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
  return result;
}
function canonical(value: unknown, depth = 0, budget = { remaining: 65536 }): unknown {
  need(depth <= 32 && --budget.remaining >= 0);
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") { need(Number.isFinite(value)); return ["number", String(value)]; }
  if (value instanceof Date) { need(Number.isFinite(value.getTime())); return ["date", value.toISOString()]; }
  if (Array.isArray(value)) return ["array", value.map(child => canonical(child, depth + 1, budget))];
  need(value && typeof value === "object");
  return ["object", Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child, depth + 1, budget)])];
}
export function hashCodexSettingsReplacement(text: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): string {
  need(Buffer.byteLength(text) <= 1024 * 1024 && budget.remaining >= Buffer.byteLength(text)); budget.remaining -= Buffer.byteLength(text);
  let config: any;
  try { config = Bun.TOML.parse(text); } catch { throw new Error("Invalid Codex settings witness"); }
  need(config && typeof config === "object" && !Array.isArray(config));
  if (Object.hasOwn(config, "model")) {
    need(typeof config.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(config.model)); delete config.model;
  }
  for (const [key, values] of [["model_reasoning_effort", EFFORT], ["model_verbosity", VERBOSITY]] as const) if (Object.hasOwn(config, key)) {
    need(typeof config[key] === "string" && values.has(config[key])); delete config[key];
  }
  // All plugin, hook, skills, provider, project trust, environment and unknown
  // fields remain bound. Legacy raw witnesses are never interpreted here.
  return sha(`hasna.skills.codex-settings.v1\0${JSON.stringify([canonical(config), numericTokens(text)])}`);
}
export function captureCodexSettings(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "codex-settings-v1"; sha256: string } {
  const text = readNativeSettingsWitnessFile(path, budget, "config.toml");
  return { path, hashMode: "codex-settings-v1", sha256: hashCodexSettingsReplacement(text) };
}
export function upgradeCodexSettingsWitness(previous: { path: string; hashMode?: "bytes"; sha256: string }, reviewedSettingsPath: string): ReturnType<typeof captureCodexSettings> {
  need(previous && Object.keys(previous).every(key => ["path", "hashMode", "sha256"].includes(key)) && (previous.hashMode === undefined || previous.hashMode === "bytes") && /^[a-f0-9]{64}$/.test(previous.sha256));
  const budget = { remaining: 2 * 1024 * 1024 };
  const before = readNativeSettingsWitnessFile(reviewedSettingsPath, budget, "config.toml"), current = readNativeSettingsWitnessFile(previous.path, budget, "config.toml");
  need(sha(before) === previous.sha256);
  const sha256 = hashCodexSettingsReplacement(current);
  if (hashCodexSettingsReplacement(before) !== sha256) throw new Error("Codex non-preference settings changed; explicit discovery review required");
  return { path: previous.path, hashMode: "codex-settings-v1", sha256 };
}
