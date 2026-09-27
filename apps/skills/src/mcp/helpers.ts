import { getMcpToolDescriptions } from "../lib/mcp-contracts.js";
import { isSkillsFleetCredentialError } from "../lib/fleet-credentials.js";

/** The shape every tool handler returns; kept structural so registrars need no SDK type import. */
type McpToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * Run a DATA tool behind the fleet ladder's refusal.
 *
 * The body is expected to go through `requireSkillsReadAccess()` /
 * `getBrowseRegistry()` (lib/read-access.ts) before it reads the bundled
 * catalog or the on-machine corpus. When the ladder refuses — no credential, no
 * authority, no `HASNA_SKILLS_LOCAL=1` opt-in; an authority with no key; a
 * deliberate selection that cannot be honoured — the refusal comes back as the
 * same `AUTH_REQUIRED` result `get_run_status` already gives, never as the
 * local answer. Any other failure propagates unchanged (the SDK reports it as
 * a tool error with its message).
 */
export async function readSurface(body: () => Promise<McpToolResult>): Promise<McpToolResult> {
  try {
    return await body();
  } catch (error) {
    if (isSkillsFleetCredentialError(error)) return mcpError("AUTH_REQUIRED", error.message, ["skills login"]);
    throw error;
  }
}

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
