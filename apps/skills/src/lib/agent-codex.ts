import { isDeepStrictEqual } from "node:util";

export const CODEX_SKILL_CONFIG_SECTIONS = /^\[\[skills\.config\]\][^\n]*(?:\n(?!\s*\[)[^\n]*)*/gm;

/** The path editor supports ordinary array-of-table sections only. Removing
 * those sections must remove exactly the parsed path array, with all other
 * values unchanged. This also excludes header-like text inside user strings. */
export function assertCodexPathConfigEditable(text: string): void {
  const before = Bun.TOML.parse(text) as Record<string, any>;
  if (before.skills?.config === undefined) return;
  const expected = structuredClone(before); delete expected.skills.config;
  try {
    const withoutSections = Bun.TOML.parse(text.replace(CODEX_SKILL_CONFIG_SECTIONS, ""));
    if (isDeepStrictEqual(withoutSections, expected)) return;
  } catch { /* Refuse unsupported shapes without emitting configuration text. */ }
  throw new Error("Codex skill path controls require ordinary [[skills.config]] TOML tables; preserve and convert inline or dotted config arrays before running skills hook install");
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
