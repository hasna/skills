/** Shared Codex MCP metadata contracts, separate from native skill discovery.
 * Two transports are modelled: a local stdio server (`command`, `args`, `env`)
 * and an HTTP server (`url`). Neither can name a skill root. Extracted from
 * the native plugin reviewer without broadening its admitted capabilities:
 * callers decide whether a declaration stays fully fingerprinted or is
 * nondiscovery. Unknown keys, malformed values, a mixed command/url row and a
 * reserved name are refused. */

const identifier = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const object = (v: any): boolean => Boolean(v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date));
const textField = (v: any, empty = false): boolean => typeof v === "string" && (empty || Boolean(v.trim()))
  && Buffer.byteLength(v) <= 16384 && !/[\x00-\x1f\x7f]/.test(v);
const envName = (v: any): boolean => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(v);
const optional = (v: any, valid: (v: any) => boolean): boolean => v === undefined || v === null || valid(v);
const stringList = (v: any): boolean => Array.isArray(v) && v.length <= 256 && v.every((item: any) => textField(item));
const approval = (v: any): boolean => ["auto", "prompt", "writes", "approve"].includes(v);
const duration = (v: any): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
const positiveInteger = (v: any): boolean => Number.isSafeInteger(v) && v > 0;
/** Shared non-discovery fields both transports use, validated identically. */
const sharedFields = (server: any): boolean =>
  ["enabled", "required", "supports_parallel_tool_calls"].every(key => optional(server[key], v => typeof v === "boolean"))
  && optional(server.startup_readiness, v => ["connection", "catalog"].includes(v))
  && optional(server.tool_input_schema_max_bytes, positiveInteger)
  && ["startup_timeout_sec", "tool_timeout_sec"].every(key => optional(server[key], duration))
  && optional(server.startup_timeout_ms, v => Number.isSafeInteger(v) && v >= 0)
  && optional(server.default_tools_approval_mode, approval)
  && ["enabled_tools", "disabled_tools"].every(key => optional(server[key], stringList))
  && optional(server.omit_tools_from, v => Array.isArray(v) && v.length <= 256 && v.every((item: any) => ["code_mode", "deferred", "direct"].includes(item)))
  && optional(server.name, textField);
/** Tool policy tables name tools, never files. Same bounded shape for both
 * transports: a tool maps to an object carrying at most the two reviewed keys. */
const validTools = (tools: any): boolean => {
  if (tools === undefined || tools === null) return true;
  if (!object(tools) || Object.keys(tools).length > 256) return false;
  for (const [tool, config] of Object.entries(tools) as [string, any][]) {
    if (!textField(tool) || !object(config) || !Object.keys(config).every(key => ["approval_mode", "output_token_limit"].includes(key))
      || !optional(config.approval_mode, approval) || !optional(config.output_token_limit, positiveInteger)) return false;
  }
  return true;
};
const reserved = (name: string): boolean => name === "codex_apps" || name === "_codex_apps";

const stdioFields = ["command", "args", "cwd", "env", "env_vars", "enabled", "required", "environment_id", "startup_readiness",
  "supports_parallel_tool_calls", "tool_input_schema_max_bytes", "startup_timeout_sec", "startup_timeout_ms", "tool_timeout_sec",
  "default_tools_approval_mode", "enabled_tools", "disabled_tools", "omit_tools_from", "tools", "name"];

/** Codex 0.160 local stdio MCP metadata contract. */
export function isCodexLocalStdioMcpServer(name: string, server: any): boolean {
  const refuse = (): never => { throw new Error("Unsupported Codex local stdio MCP controls"); };
  try {
    if (!identifier(name) || !object(server) || !Object.keys(server).every(key => stdioFields.includes(key))
      || !textField(server.command)
      || !optional(server.args, v => Array.isArray(v) && v.length <= 256 && v.every((arg: any) => textField(arg, true)))
      || !optional(server.cwd, textField)
      || !optional(server.env, v => object(v) && Object.keys(v).length <= 256 && Object.entries(v).every(([key, value]) => envName(key) && textField(value, true)))
      || !optional(server.environment_id, v => v === "local")
      || !sharedFields(server)) refuse();
    if (server.env_vars !== undefined && server.env_vars !== null) {
      if (!Array.isArray(server.env_vars) || server.env_vars.length > 256) refuse();
      const names = server.env_vars.map((entry: any) => {
        if (envName(entry)) return entry;
        if (!object(entry) || !Object.keys(entry).every(key => ["name", "source"].includes(key)) || !envName(entry.name)
          || !optional(entry.source, v => v === "local")) refuse();
        return entry.name;
      });
      if (new Set(names).size !== names.length) refuse();
    }
    if (!validTools(server.tools)) refuse();
    return true;
  } catch { return false; }
}

const httpFields = ["url", "bearer_token_env_var", "http_headers", "env_http_headers", "enabled", "required", "startup_readiness",
  "supports_parallel_tool_calls", "tool_input_schema_max_bytes", "startup_timeout_sec", "startup_timeout_ms", "tool_timeout_sec",
  "default_tools_approval_mode", "enabled_tools", "disabled_tools", "omit_tools_from", "tools", "name"];

/** A URL a discovery check never dereferences. It cannot name a skill root, so
 * a syntactically valid absolute http(s) URL without userinfo is admitted; a
 * relative, scheme-less, credential-bearing or malformed URL is refused. */
function mcpUrl(value: any): boolean {
  if (!textField(value) || /\s/.test(value)) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
}

/** Codex 0.160 streamable HTTP MCP metadata contract. */
export function isCodexHttpMcpServer(name: string, server: any): boolean {
  const refuse = (): never => { throw new Error("Unsupported Codex HTTP MCP controls"); };
  try {
    if (!identifier(name) || reserved(name) || !object(server) || !Object.keys(server).every(key => httpFields.includes(key))
      || !mcpUrl(server.url)
      || !optional(server.bearer_token_env_var, envName)
      || !optional(server.http_headers, v => object(v) && Object.keys(v).length <= 256
        && Object.entries(v).every(([key, value]) => textField(key) && textField(value, true)))
      || !optional(server.env_http_headers, v => object(v) && Object.keys(v).length <= 256
        && Object.entries(v).every(([key, value]) => textField(key) && envName(value)))
      || !sharedFields(server)) refuse();
    if (!validTools(server.tools)) refuse();
    return true;
  } catch { return false; }
}
