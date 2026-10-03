/** Codex 0.160 local stdio MCP contract, separate from native skill discovery.
 * Source: openai/codex rust-v0.160.0 core/config.schema.json RawMcpServerConfig,
 * core/src/config/types.rs, codex-mcp/src/mcp/mod.rs. HTTP/OAuth/cloud/auth and
 * unknown contracts remain fully witnessed. This never verifies MCP responses. */
import { isCodexLocalStdioMcpServer } from "./codex-local-mcp-controls.js";
import { isDeepStrictEqual } from "node:util";
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
function localStdio(name: string, row: unknown): boolean {
  // codex_apps is upstream's actual reserved name; keep its legacy spelling too.
  return name !== "codex_apps" && name !== "_codex_apps" && isCodexLocalStdioMcpServer(name, row);
}
function stripEmptyParent(config: Record<string, any>): Record<string, any> {
  if (record(config.mcp_servers) && !Object.keys(config.mcp_servers).length) delete config.mcp_servers;
  return config;
}

/** Omit only schema-validated rows with a proved ordinary-table lexical span.
 * The same exact omission feeds structural AND numeric-spelling witnesses.
 * Inline/dotted/ambiguous layouts remain bound rather than guessing. */
export function projectRegularCodexMcp(config: Record<string, any>, source: string): { config: Record<string, any>; numericSource: string } {
  const unchanged = { config, numericSource: source };
  if (!record(config.mcp_servers)) return unchanged;
  const candidates = Object.entries(config.mcp_servers).filter(([name, row]) => localStdio(name, row)).map(([name]) => name);
  if (!candidates.length) return unchanged;
  const headers: Array<{ start: number; path: string[] }> = [];
  let attempts = 0;
  for (const match of source.matchAll(/^[ \t]*\[{1,2}[^\r\n]*\]{1,2}[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm)) {
    if (++attempts > 256) return unchanged;
    // Header lookalikes in multiline strings have an incomplete prefix.
    try { Bun.TOML.parse(source.slice(0, match.index)); } catch { continue; }
    let header: unknown;
    try { header = Bun.TOML.parse(match[0]); } catch { return unchanged; }
    const path: string[] = [];
    while (record(header) && Object.keys(header).length === 1) {
      const key = Object.keys(header)[0]!; path.push(key); header = header[key];
    }
    headers.push({ start: match.index!, path });
  }
  const names = candidates.filter(name => headers.filter(header => header.path.length === 2 && header.path[0] === "mcp_servers" && header.path[1] === name).length === 1);
  if (!names.length) return unchanged;
  const selected = headers.map((header, index) => ({ ...header, end: headers[index + 1]?.start ?? source.length }))
    .filter(header => header.path[0] === "mcp_servers" && names.includes(header.path[1]!));
  let numericSource = source;
  for (const range of selected.reverse()) numericSource = numericSource.slice(0, range.start) + numericSource.slice(range.end);
  const expected = structuredClone(config);
  for (const name of names) delete expected.mcp_servers[name];
  stripEmptyParent(expected);
  try {
    if (!isDeepStrictEqual(stripEmptyParent(Bun.TOML.parse(numericSource)), expected)) return unchanged;
  } catch { return unchanged; }
  return { config: expected, numericSource };
}
