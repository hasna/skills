import { createHash } from "node:crypto";

export const CLAUDE_PLUGIN_MANIFEST_LIMITS = Object.freeze({ bytes: 1024 * 1024, depth: 32, nodes: 65536, stringCharacters: 16384 });

type JsonValue = { kind: "object"; entries: Array<[string, JsonValue]> }
  | { kind: "array"; items: JsonValue[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "literal"; value: "true" | "false" | "null" };

function requireValue(value: unknown, reason: string): asserts value {
  if (!value) throw new Error("Claude plugin manifest " + reason);
}

function parse(text: string): Extract<JsonValue, { kind: "object" }> {
  requireValue(Buffer.byteLength(text, "utf8") <= CLAUDE_PLUGIN_MANIFEST_LIMITS.bytes, "exceeds its byte limit");
  let at = 0, nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  function string(): string {
    requireValue(text[at] === '"', "contains invalid JSON");
    const start = at++;
    while (at < text.length) {
      const character = text[at++]!;
      if (character === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, at)); } catch { throw new Error("Claude plugin manifest contains invalid JSON string"); }
        requireValue(value.length <= CLAUDE_PLUGIN_MANIFEST_LIMITS.stringCharacters, "exceeds its string limit");
        return value;
      }
      if (character === "\\") at++;
    }
    throw new Error("Claude plugin manifest contains an unterminated JSON string");
  }
  function value(depth: number): JsonValue {
    requireValue(depth <= CLAUDE_PLUGIN_MANIFEST_LIMITS.depth && ++nodes <= CLAUDE_PLUGIN_MANIFEST_LIMITS.nodes, "exceeds its nesting or node limit");
    space();
    const character = text[at];
    if (character === '"') return { kind: "string", value: string() };
    if (character === "{" || character === "[") {
      at++; space();
      const object = character === "{", end = object ? "}" : "]", entries: Array<[string, JsonValue]> = [], items: JsonValue[] = [], keys = new Set<string>();
      if (text[at] !== end) while (true) {
        if (object) {
          space(); const key = string();
          requireValue(!keys.has(key), "contains a duplicate JSON key"); keys.add(key);
          space(); requireValue(text[at++] === ":", "contains invalid JSON");
          entries.push([key, value(depth + 1)]);
        } else items.push(value(depth + 1));
        space(); if (text[at] === end) break;
        requireValue(text[at++] === ",", "contains invalid JSON");
      }
      at++;
      return object ? { kind: "object", entries } : { kind: "array", items };
    }
    for (const literal of ["true", "false", "null"] as const) if (text.startsWith(literal, at)) { at += literal.length; return { kind: "literal", value: literal }; }
    numberPattern.lastIndex = at;
    const number = numberPattern.exec(text);
    requireValue(number, "contains invalid JSON"); at += number[0].length;
    return { kind: "number", value: number[0] };
  }
  const root = value(0); space();
  requireValue(at === text.length && root.kind === "object", "requires a JSON object without trailing content");
  return root;
}

function canonical(value: JsonValue): string {
  if (value.kind === "string") return JSON.stringify(value.value);
  if (value.kind === "number") return value.value;
  if (value.kind === "literal") return value.value;
  if (value.kind === "array") return "[" + value.items.map(canonical).join(",") + "]";
  // Preserve object order: future or executable fields may be order-sensitive
  // to a consumer we do not understand. Whitespace and string escaping are
  // normalized, but unrecognized/control structure remains order-bound.
  return "{" + value.entries.map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
}

// Ignore only documented descriptive fields. Keep plugin identity, paths,
// unknown fields, and every executable or prompt-affecting field in the hash.
const DESCRIPTIVE_FIELDS = new Set(["description", "version", "author", "homepage", "repository", "license", "keywords"]);

function validateText(value: JsonValue | undefined, field: string): void {
  requireValue(value?.kind === "string" && value.value.length <= CLAUDE_PLUGIN_MANIFEST_LIMITS.stringCharacters, "has an invalid " + field + " field");
}

function validateDescriptiveFields(manifest: Extract<JsonValue, { kind: "object" }>): void {
  const values = new Map(manifest.entries);
  for (const field of ["description", "version", "homepage", "license"]) {
    const value = values.get(field);
    if (value !== undefined) validateText(value, field);
  }
  const author = values.get("author");
  if (author !== undefined) {
    if (author.kind === "string") validateText(author, "author");
    else {
      requireValue(author.kind === "object" && author.entries.every(([key, value]) => ["name", "email", "url"].includes(key) && value.kind === "string" && value.value.length <= CLAUDE_PLUGIN_MANIFEST_LIMITS.stringCharacters), "has an invalid author field");
    }
  }
  const repository = values.get("repository");
  if (repository !== undefined) {
    if (repository.kind === "string") validateText(repository, "repository");
    else requireValue(repository.kind === "object" && repository.entries.every(([key, value]) => ["type", "url", "directory"].includes(key) && value.kind === "string" && value.value.length <= CLAUDE_PLUGIN_MANIFEST_LIMITS.stringCharacters), "has an invalid repository field");
  }
  const keywords = values.get("keywords");
  if (keywords !== undefined) requireValue(keywords.kind === "array" && keywords.items.every(value => value.kind === "string" && value.value.length <= CLAUDE_PLUGIN_MANIFEST_LIMITS.stringCharacters), "has an invalid keywords field");
}

export function hashClaudePluginManifest(text: string): string {
  const manifest = parse(text);
  validateDescriptiveFields(manifest);
  const discovery = { kind: "object" as const, entries: manifest.entries.filter(([key]) => !DESCRIPTIVE_FIELDS.has(key)) };
  return createHash("sha256").update(canonical(discovery)).digest("hex");
}

/** Project only the exact raw manifest bytes that the explicit review attested. */
export function projectReviewedClaudePluginManifest(text: string, reviewedSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(reviewedSha256) || createHash("sha256").update(text).digest("hex") !== reviewedSha256) {
    throw new Error("Reviewed Claude plugin manifest changed before semantic projection");
  }
  return hashClaudePluginManifest(text);
}
