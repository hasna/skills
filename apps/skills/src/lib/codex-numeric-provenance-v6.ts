/** V6-only lexical type attribution through the owning TOML parser. No legacy
 * digest or parser is replaced. Every accepted span must change exactly one
 * numeric/date value, with the rest of the complete parsed tree unchanged. */
import { isDeepStrictEqual } from "node:util";
type Path = Array<string | number>;
export interface CodexNumericToken { path: Path; kind: "integer" | "float" | "date"; value: string }
export class CodexNumericValue { constructor(readonly token: CodexNumericToken) {} }
const need: (value: unknown) => asserts value = value => { if (!value) throw new Error("Unsupported Codex V6 numeric provenance"); };
const key = (path: Path) => JSON.stringify(path);
const integer = /^[+-]?(?:0|[1-9](?:_?\d)*|0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/;
function exactNumber(token: string): Pick<CodexNumericToken, "kind" | "value"> {
  const clean = token.replaceAll("_", "");
  if (integer.test(token)) {
    const negative = clean.startsWith("-"), digits = clean.replace(/^[+-]/, "");
    const value = BigInt(digits) * (negative ? -1n : 1n);
    need(value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER));
    return { kind: "integer", value: value === 0n && negative ? "-0" : value.toString() };
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(clean);
  need(match && (match[3] !== undefined || match[4] !== undefined));
  let digits = (match[2]! + (match[3] ?? "")).replace(/^0+/, "") || "0";
  let exponent = BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length);
  if (digits !== "0") while (digits.endsWith("0")) { digits = digits.slice(0, -1); exponent++; }
  else exponent = 0n;
  return { kind: "float", value: `${match[1] === "-" ? "-" : ""}${digits}e${exponent}` };
}
function spans(text: string): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (char === "#") { while (at < text.length && text[at] !== "\n") at++; continue; }
    if (char === '"' || char === "'") {
      const triple = text.slice(at, at + 3) === char.repeat(3); at += triple ? 3 : 1;
      while (at < text.length) {
        if (char === '"' && text[at] === "\\") { at += 2; continue; }
        if (text.slice(at, at + (triple ? 3 : 1)) === char.repeat(triple ? 3 : 1)) { at += triple ? 3 : 1; break; }
        at++;
      }
      continue;
    }
    if (/[\s,\[\]{}=]/.test(char)) { at++; continue; }
    const start = at;
    while (at < text.length && !/[\s,\[\]{}=#'\"]/.test(text[at]!)) at++;
    if (at === start) { at++; continue; }
    if (/^[0-9+-]/.test(text.slice(start, at)) || /^(?:inf|nan)$/.test(text.slice(start, at))) result.push({ start, end: at });
    need(result.length <= 2048);
  }
  return result;
}
export function codexNumericProvenance(text: string, original: unknown): Map<string, CodexNumericToken> {
  need(Buffer.byteLength(text) <= 1024 * 1024);
  const marker = "__hasna_v6_numeric_attribution__";
  const leaves = new Map<string, unknown>(), tokens = new Map<string, CodexNumericToken>();
  let nodes = 0;
  function visit(value: any, path: Path): void {
    need(++nodes <= 65536 && path.length <= 32);
    need(value !== marker);
    if (typeof value === "number" || value instanceof Date) {
      need(value instanceof Date ? Number.isFinite(value.getTime()) : Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
      leaves.set(key(path), value);
    } else if (value && typeof value === "object") for (const [name, child] of Object.entries(value)) { need(name !== marker); visit(child, [...path, Array.isArray(value) ? Number(name) : name]); }
  }
  visit(original, []);
  // Source containment proves this parser marker cannot be a real key/value.
  need(!text.includes(marker));
  let work = 0;
  for (const { start, end } of spans(text)) {
    const literal = text.slice(start, end), nonfinite = /^[+-]?(?:inf|nan)$/.test(literal);
    const replacement = text.slice(0, start) + JSON.stringify(marker) + text.slice(end);
    work += Buffer.byteLength(replacement); need(work <= 16 * 1024 * 1024);
    let parsed: unknown;
    try { parsed = Bun.TOML.parse(replacement); } catch { continue; }
    const changed: Path[] = [];
    function compare(before: any, after: any, path: Path): boolean {
      if (after === marker && (typeof before === "number" || before instanceof Date || nonfinite && typeof before === "string")) { changed.push(path); return true; }
      if (before instanceof Date || after instanceof Date || !before || !after || typeof before !== "object" || typeof after !== "object") return isDeepStrictEqual(before, after);
      if (Array.isArray(before) !== Array.isArray(after)) return false;
      const names = Object.keys(before);
      return names.length === Object.keys(after).length && names.every(name => Object.hasOwn(after, name) && compare(before[name], after[name], [...path, Array.isArray(before) ? Number(name) : name]));
    }
    if (!compare(original, parsed, []) || changed.length !== 1) continue;
    need(!nonfinite);
    const path = changed[0]!, id = key(path); need(!tokens.has(id));
    const token = text.slice(start, end), value = leaves.get(id);
    tokens.set(id, { path, ...(value instanceof Date ? { kind: "date" as const, value: token } : exactNumber(token)) });
  }
  need(tokens.size === leaves.size && [...leaves.keys()].every(id => tokens.has(id)));
  return tokens;
}
export function codexIntegerToken(tokens: Map<string, CodexNumericToken>, path: Path): boolean { return tokens.get(key(path))?.kind === "integer"; }
export function embedCodexNumericTokens(value: any, tokens: Map<string, CodexNumericToken>, path: Path = []): any {
  if (typeof value === "number" || value instanceof Date) {
    const token = tokens.get(key(path)); need(token); return new CodexNumericValue(token);
  }
  if (Array.isArray(value)) return value.map((child, index) => embedCodexNumericTokens(child, tokens, [...path, index]));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, embedCodexNumericTokens(child, tokens, [...path, name])]));
  return value;
}
