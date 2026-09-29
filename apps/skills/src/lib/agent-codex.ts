import { isDeepStrictEqual } from "node:util";

export const CODEX_SKILL_CONFIG_SECTIONS = /^\[\[skills\.config\]\][^\n]*(?:\n(?!\s*\[)[^\n]*)*/gm;

const codexPathConfigRefusal = () => new Error("Codex skill path controls require ordinary [[skills.config]] TOML tables or a native single-line inline array; preserve and review unsupported inline, dotted, or malformed definitions before running skills hook install");

function splitTopLevel(value: string, delimiter: string): string[] | null {
  const result: string[] = [];
  let start = 0, square = 0, curly = 0, quote: "double" | "literal" | null = null, escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote === "double") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "literal") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"') { quote = "double"; continue; }
    if (char === "'") { quote = "literal"; continue; }
    if (char === "[") square++;
    else if (char === "]") { if (--square < 0) return null; }
    else if (char === "{") curly++;
    else if (char === "}") { if (--curly < 0) return null; }
    else if (char === delimiter && square === 0 && curly === 0) {
      result.push(value.slice(start, index)); start = index + 1;
    }
  }
  if (quote !== null || square !== 0 || curly !== 0) return null;
  result.push(value.slice(start));
  return result;
}

function inlineArrayEnd(value: string): number | null {
  if (!value.startsWith("[")) return null;
  let square = 0, curly = 0, quote: "double" | "literal" | null = null, escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote === "double") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "literal") { if (char === "'") quote = null; continue; }
    if (char === '"') { quote = "double"; continue; }
    if (char === "'") { quote = "literal"; continue; }
    if (char === "[") square++;
    else if (char === "]") {
      if (--square < 0) return null;
      if (square === 0 && curly === 0) return index;
    } else if (char === "{") curly++;
    else if (char === "}") { if (--curly < 0) return null; }
  }
  return null;
}

function inlineRowsAsTables(value: string, newline: string): string | null {
  const end = inlineArrayEnd(value);
  if (end === null || value.slice(end + 1).trim() !== "" || value.includes("\n") || value.includes("\r")) return null;
  const elements = splitTopLevel(value.slice(1, end), ",");
  if (!elements) return null;
  const rows = elements.map(element => element.trim()).filter(Boolean);
  if (rows.length === 0) return "";
  const sections: string[] = [];
  for (const row of rows) {
    if (!row.startsWith("{") || !row.endsWith("}")) return null;
    const fields = splitTopLevel(row.slice(1, -1), ",");
    if (!fields) return null;
    const lines = fields.map(field => field.trim()).filter(Boolean);
    if (lines.some(line => !/^(?:path|name|enabled)\s*=/.test(line))) return null;
    const keys = lines.map(line => line.slice(0, line.indexOf("=")).trim());
    if (new Set(keys).size !== keys.length) return null;
    sections.push(`[[skills.config]]${newline}${lines.join(newline)}${newline}`);
  }
  return sections.join("");
}

/** Convert only Codex's native, single-line inline array representation into
 * equivalent array-of-table sections. The replacement is accepted only when
 * the complete parsed TOML value is deeply identical before and after. */
export function normalizeCodexInlinePathConfig(text: string): string {
  const before = Bun.TOML.parse(text) as Record<string, any>;
  if (!Array.isArray(before.skills?.config)) return text;
  // Preserve an explicit empty inline control as unsupported. Removing it
  // would conflate a configured empty list with an absent setting.
  if (before.skills.config.length === 0) throw codexPathConfigRefusal();
  const expectedWithoutConfig = structuredClone(before); delete expectedWithoutConfig.skills.config;
  try {
    if (isDeepStrictEqual(Bun.TOML.parse(text.replace(CODEX_SKILL_CONFIG_SECTIONS, "")), expectedWithoutConfig)) return text;
  } catch { /* Continue only for the exact native inline form below. */ }
  const matches: string[] = [];
  for (const assignment of text.matchAll(/^([ \t]*config[ \t]*=[ \t]*)(.*?)(\r?)$/gm)) {
    const rawValue = assignment[2]!.trimEnd();
    let quote: "double" | "literal" | null = null, escaped = false, comment = "";
    for (let index = 0; index < rawValue.length; index++) {
      const char = rawValue[index]!;
      if (quote === "double") { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quote = null; continue; }
      if (quote === "literal") { if (char === "'") quote = null; continue; }
      if (char === '"') quote = "double";
      else if (char === "'") quote = "literal";
      else if (char === "#") { comment = rawValue.slice(index); break; }
    }
    const value = comment ? rawValue.slice(0, rawValue.length - comment.length).trimEnd() : rawValue;
    const tableSections = inlineRowsAsTables(value, text.includes("\r\n") ? "\r\n" : "\n");
    if (tableSections === null) continue;
    const start = assignment.index!;
    const end = start + assignment[0].length;
    const withoutAssignment = text.slice(0, start) + (comment ? comment : "") + assignment[3]! + text.slice(end);
    const separator = withoutAssignment.endsWith("\n") ? (withoutAssignment.endsWith("\n\n") ? "" : "\n") : "\n\n";
    const candidate = withoutAssignment + (tableSections ? separator + tableSections : "");
    try {
      const after = Bun.TOML.parse(candidate);
      const expected = structuredClone(before);
      if (isDeepStrictEqual(after, expected)) matches.push(candidate);
    } catch { /* Only a complete semantic round trip can authorize replacement. */ }
  }
  if (matches.length !== 1) throw codexPathConfigRefusal();
  return matches[0]!;
}

/** Removing supported path sections must remove exactly the parsed skill path
 * array while preserving every other TOML value. Native app-server inline
 * arrays are first normalized by a targeted, semantically verified edit. */
export function assertCodexPathConfigEditable(text: string): void {
  const before = Bun.TOML.parse(text) as Record<string, any>;
  if (before.skills?.config === undefined) return;
  const expected = structuredClone(before); delete expected.skills.config;
  try {
    const withoutSections = Bun.TOML.parse(text.replace(CODEX_SKILL_CONFIG_SECTIONS, ""));
    if (isDeepStrictEqual(withoutSections, expected)) return;
    const normalized = normalizeCodexInlinePathConfig(text);
    const withoutNormalizedSections = Bun.TOML.parse(normalized.replace(CODEX_SKILL_CONFIG_SECTIONS, ""));
    if (isDeepStrictEqual(withoutNormalizedSections, expected)) return;
  } catch { /* Refuse unsupported shapes without emitting configuration text. */ }
  throw codexPathConfigRefusal();
}

/** Preserve user TOML verbatim except for the supported bundled-skill control.
 * Bun's parser accepts some illegal table reopenings, so never append a table
 * over an existing inline/dotted skills definition. Refuse unfamiliar layouts
 * before the integration transaction writes any files. */
export function disableCodexBundledSkills(text: string): string {
  const before = Bun.TOML.parse(text) as Record<string, any>;
  const table = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
  const refuse = () => new Error("Codex bundled skills configuration requires ordinary [skills.bundled] TOML with a boolean enabled setting; preserve and convert inline or dotted definitions before running skills hook install");
  if (before.skills !== undefined && !table(before.skills)) throw refuse();
  if (before.skills?.bundled !== undefined && !table(before.skills.bundled)) throw refuse();
  if (before.skills !== undefined) {
    // Decode root keys with the parser, including escaped quoted names. A
    // header-looking line inside a multiline value has an incomplete prefix
    // and is skipped. Bound those attempts independently of config size.
    let root = before, attempts = 0;
    for (const header of text.matchAll(/^[ \t]*\[/gm)) {
      if (++attempts > 256) throw refuse();
      try { root = Bun.TOML.parse(text.slice(0, header.index)); break; } catch { /* Still inside a multiline value. */ }
    }
    // Root assignments include immutable inline parents. Refuse before the
    // already-disabled fast path: native path controls may still need writes.
    // Dotted root assignments are also outside this conservative editor.
    if (root.skills !== undefined) throw refuse();
  }
  const enabled = before.skills?.bundled?.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") throw refuse();
  if (enabled === false) return text;
  const expected = structuredClone(before);
  expected.skills ??= {}; expected.skills.bundled ??= {}; expected.skills.bundled.enabled = false;
  const candidates = new Set<string>();
  const consider = (candidate: string) => {
    try { if (isDeepStrictEqual(Bun.TOML.parse(candidate), expected)) candidates.add(candidate); } catch { /* An unsupported layout is refused below. */ }
  };
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (before.skills?.bundled !== undefined) {
    for (const section of text.matchAll(/^[ \t]*\[skills\.bundled\][ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)(?:(?![ \t]*\[)[^\n]*(?:\n|$))*/gm)) {
      const headerEnd = section[0].indexOf("\n") + 1 || section[0].length;
      const replacement = enabled === true
        ? section[0].replace(/^([ \t]*enabled[ \t]*=[ \t]*)true([ \t]*(?:#[^\r\n]*)?)(\r?)$/m, "$1false$2$3")
        : section[0].slice(0, headerEnd) + (section[0].slice(0, headerEnd).endsWith("\n") ? "" : newline) + `enabled = false${newline}` + section[0].slice(headerEnd);
      consider(text.slice(0, section.index) + replacement + text.slice(section.index + section[0].length));
    }
  } else {
    // An absent skills table or conventional [skills]/[[skills.config]] tables
    // may safely acquire a new child table; root assignments were refused above.
    consider(`${text}${text.endsWith("\n") || !text ? "" : newline}${newline}[skills.bundled]${newline}enabled = false${newline}`);
  }
  if (candidates.size !== 1) throw refuse();
  return [...candidates][0]!;
}
