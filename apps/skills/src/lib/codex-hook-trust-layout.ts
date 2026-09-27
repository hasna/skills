import { isDeepStrictEqual } from "node:util";

const fail = () => new Error("CODEX_HOOK_TRUST_UNSUPPORTED_LAYOUT: preserve and convert hook trust to ordinary [hooks.state.\"<key>\"] tables before enrollment");
const prune = (value: any) => { if (value.hooks?.state && !Object.keys(value.hooks.state).length) delete value.hooks.state; if (value.hooks && !Object.keys(value.hooks).length) delete value.hooks; return value; };

// Codex's native TOML writer may move complete, unrelated table blocks while
// inserting hook state. TOML table order is not semantic, so compare those
// blocks canonically while retaining every byte within each block.
const canonicalizeTableOrder = (text: string): string => {
  const headers = [...text.matchAll(/^[ \t]*(\[\[?[^\r\n]+\]\]?)[ \t]*(#[^\r\n]*)?(?:\r?\n|$)/gm)];
  if (!headers.length) return text;
  // Array-of-tables and parent/child table ordering carry parser-sensitive
  // structure. A Codex 0.154 write can move a simple unrelated table across
  // an unchanged array-of-tables run (the observed skills.bundled/skills.config
  // layout). Preserve the array run and reject every parent/child or repeated
  // table shape before admitting that narrow normalization.
  const keys = headers.map(header => header[1]!.trim());
  const repeated = keys.filter(key => !key.startsWith("[[")).filter((key, index, simple) => simple.indexOf(key) !== index);
  const arrayKeys = keys.filter(key => key.startsWith("[["));
  const plain = keys.map(key => key.replace(/^\[\[?/, "").replace(/\]\]?$/, "").trim());
  const parentChild = plain.some((key, index) => plain.some((other, otherIndex) => index !== otherIndex && (other.startsWith(`${key}.`) || key.startsWith(`${other}.`))));
  if (repeated.length || parentChild) return text;
  if (!arrayKeys.length) {
    const first = headers[0]!.index!;
    const prefix = text.slice(0, first);
    const blocks = headers.map((header, index) => ({
      key: header[1]!,
      order: index,
      text: text.slice(header.index!, headers[index + 1]?.index ?? text.length),
    }));
    blocks.sort((a, b) => a.key.localeCompare(b.key) || a.order - b.order);
    return prefix + blocks.map(block => block.text).join("");
  }
  // Keep every array-of-tables block and every simple table in its original
  // relative order. Only their interleaving may change, which covers the
  // observed native writer move without admitting a reorder among unrelated
  // tables or among array entries.
  const first = headers[0]!.index!;
  const prefix = text.slice(0, first);
  const blocks = headers.map((header, index) => ({
    key: header[1]!,
    order: index,
    text: text.slice(header.index!, headers[index + 1]?.index ?? text.length),
  }));
  const simple = blocks.filter(block => !block.key.startsWith("[["));
  const arrays = blocks.filter(block => block.key.startsWith("[["));
  return prefix + [...simple, ...arrays].map(block => block.text).join("");
};

/** Conservative admission and text witness, never a TOML writer. Native Codex
 * performs the versioned write; unrecognized inline/dotted trust shapes refuse. */
export function codexTrustTextWitness(text: string, keys: string[], canonicalize = true): string {
  const parsed: any = Bun.TOML.parse(text), wanted = new Set(keys);
  const headers = [...text.matchAll(/^[ \t]*(\[[^\r\n]+\])[ \t]*(#[^\r\n]*)?(?:\r?\n|$)/gm)];
  if (headers.length > 512) throw fail();
  let root = parsed;
  for (const header of headers) { try { root = Bun.TOML.parse(text.slice(0, header.index)); break; } catch { /* Header-like string content. */ } }
  if (root.hooks !== undefined) throw fail();
  const replacements: Array<{ start: number; end: number; comments: string }> = [];
  const stateSections: Array<{ start: number; end: number }> = [];
  for (const [index, header] of headers.entries()) {
    let shape: any; try { shape = Bun.TOML.parse(header[1]!); } catch { continue; }
    const state = shape.hooks?.state;
    if (!state || Object.keys(shape).length !== 1 || Object.keys(shape.hooks).length !== 1) continue;
    const names = Object.keys(state), start = header.index!, end = headers[index + 1]?.index ?? text.length;
    if (names.length === 0) {
      // An optional parent header may be inserted by native toml_edit.
      replacements.push({ start, end: start + header[0].length, comments: header[2] ? header[2] + "\n" : "" });
      stateSections.push({ start, end: start + header[0].length });
    } else if (names.length === 1 && !Object.keys(state[names[0]!]).length) {
      stateSections.push({ start, end });
      if (!wanted.has(names[0]!)) {
        // Native toml_edit may remove unnecessary quotes from unrelated table
        // names. Normalize only that spelling; retain all body and comment bytes.
        replacements.push({ start, end: start + header[0].length, comments: `[hooks.state.${JSON.stringify(names[0])}]${header[2] ? " " + header[2] : ""}\n` });
        continue;
      }
      const comments = header[2] ? [header[2]] : [];
      for (const line of text.slice(start + header[0].length, end).split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (/^[ \t]*#/.test(line)) { comments.push(line); continue; }
        const field = /^[ \t]*(?:enabled|trusted_hash)[ \t]*=[ \t]*(?:true|false|"(?:[^"\\]|\\.)*"|'[^']*')[ \t]*(#[^\r\n]*)?$/.exec(line);
        if (!field) throw fail();
        if (field[1]) comments.push(field[1]);
      }
      replacements.push({ start, end, comments: comments.join("\n") + "\n" });
    }
  }
  let noState = text;
  for (const span of [...stateSections].reverse()) noState = noState.slice(0, span.start) + noState.slice(span.end);
  const expected = structuredClone(parsed); if (expected.hooks) delete expected.hooks.state;
  try { if (!isDeepStrictEqual(prune(Bun.TOML.parse(noState)), prune(expected))) throw fail(); } catch { throw fail(); }
  let result = text;
  for (const span of replacements.reverse()) result = result.slice(0, span.start) + span.comments + result.slice(span.end);
  // Native Codex may insert blank lines around newly explicit parent tables.
  // Every nonblank unrelated line and every comment must survive exactly.
  return (canonicalize ? canonicalizeTableOrder(result) : result).split(/\r?\n/).filter(line => line.trim()).join("\n");
}

/** Reconciliation witness: retain table/array order while tolerating only
 * blank-line and line-ending formatting emitted by the native writer. */
export function codexTrustReconcileWitness(text: string, keys: string[]): string {
  return codexTrustTextWitness(text, keys, false).replace(/[ \t]+$/gm, "");
}

const stableSemantic = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableSemantic);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSemantic(value[key])]));
  return value;
};

/** Parsed unmanaged TOML semantics. Arrays retain order; managed trust entries
 * are excluded by exact journal key and all other keys/values remain bound. */
export function codexTrustUnmanagedSemantic(text: string, keys: string[]): string {
  const parsed: any = structuredClone(Bun.TOML.parse(text));
  for (const key of keys) if (parsed.hooks?.state?.[key] !== undefined) delete parsed.hooks.state[key];
  return JSON.stringify(stableSemantic(prune(parsed)));
}
