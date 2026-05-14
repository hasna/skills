import { getMcpToolDescriptions } from "../lib/mcp-contracts.js";

export function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) =>
      v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
    )
  );
}

/** Simple LRU cache for search results */
const searchCache = new Map<string, unknown>();
const CACHE_MAX = 100;
export function cacheGet(key: string): unknown | undefined { return searchCache.get(key); }
export function cacheSet(key: string, value: unknown): void {
  if (searchCache.size >= CACHE_MAX) {
    const first = searchCache.keys().next().value;
    if (first !== undefined) searchCache.delete(first);
  }
  searchCache.set(key, value);
}
export function cacheClear(): void { searchCache.clear(); }

/** Structured MCP error response */
export function mcpError(code: string, message: string, suggestions?: string[]) {
  const obj: { code: string; message: string; suggestions?: string[] } = { code, message };
  if (suggestions && suggestions.length > 0) obj.suggestions = suggestions;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
    isError: true,
  };
}

export function mcpJson(payload: unknown, pretty = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, pretty ? 2 : 0) }],
  };
}

export function remoteRunNextActions(runId: string | undefined): { poll: string; download: string } | undefined {
  if (!runId) return undefined;
  return {
    poll: `skills runs status ${runId}`,
    download: `skills exports download ${runId}`,
  };
}

export const TOOL_DESCRIPTIONS: Record<string, { description: string; params: string[] }> = getMcpToolDescriptions();

// ---- Tools ----
