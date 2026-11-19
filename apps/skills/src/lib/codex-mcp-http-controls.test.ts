import { expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { isCodexHttpMcpServer, isCodexLocalStdioMcpServer } from "./codex-local-mcp-controls.js";
import { projectRegularCodexMcp } from "./codex-mcp-discovery-projection.js";

test("the HTTP contract admits a url row and refuses every unknown shape", () => {
  expect(isCodexHttpMcpServer("upwork", { url: "https://mcp.invalid/mcp" })).toBe(true);
  expect(isCodexHttpMcpServer("upwork", { url: "http://127.0.0.1:8765/mcp" })).toBe(true);
  expect(isCodexHttpMcpServer("upwork", { url: "https://mcp.invalid/mcp", bearer_token_env_var: "UPWORK_TOKEN" })).toBe(true);
  expect(isCodexHttpMcpServer("upwork", {
    url: "https://mcp.invalid/mcp", http_headers: { "X-Org": "hasna" }, env_http_headers: { "X-Token": "UPWORK_TOKEN" },
    enabled: true, startup_timeout_sec: 30, tool_timeout_sec: 60, tools: { search: { approval_mode: "approve", output_token_limit: 4096 } },
  })).toBe(true);
  for (const row of [
    null, "url", [], { url: "mcp.invalid/mcp" }, { url: " " }, { url: 42 }, { url: "https://user:pass@mcp.invalid/mcp" },
    { url: "https://mcp.invalid/mcp", auth: "oauth" }, { url: "https://mcp.invalid/mcp", command: "server" },
    { url: "https://mcp.invalid/mcp", http_headers: { X: 1 } }, { url: "https://mcp.invalid/mcp", env_http_headers: { X: "not a name" } },
    { url: "https://mcp.invalid/mcp", tools: { t: "unsupported" } }, { url: "https://mcp.invalid/mcp", bearer_token_env_var: "bad name" },
  ]) expect(isCodexHttpMcpServer("upwork", row)).toBe(false);
  expect(isCodexHttpMcpServer("codex_apps", { url: "https://mcp.invalid/mcp" })).toBe(false);
  expect(isCodexHttpMcpServer("_codex_apps", { url: "https://mcp.invalid/mcp" })).toBe(false);
  expect(isCodexHttpMcpServer("bad name", { url: "https://mcp.invalid/mcp" })).toBe(false);
  // The transports stay separate: an HTTP row is not a local stdio row, and a
  // stdio row is not an HTTP row.
  expect(isCodexLocalStdioMcpServer("upwork", { url: "https://mcp.invalid/mcp" })).toBe(false);
  expect(isCodexHttpMcpServer("trash", { command: "/usr/bin/env" })).toBe(false);
});

test("the projection omits admitted HTTP rows with their exact lexical span", () => {
  const source = [
    "[mcp_servers.trash]", 'command = "/usr/bin/env"', 'args = ["-i"]', "",
    "[mcp_servers.upwork]", 'url = "https://mcp.invalid/mcp"', "",
  ].join("\n");
  const parsed = Bun.TOML.parse(source) as Record<string, any>;
  const projected = projectRegularCodexMcp(parsed, source);
  expect(projected.config.mcp_servers).toBeUndefined();
  expect(Bun.TOML.parse(projected.numericSource)).toEqual({});
});

test("a genuinely unknown row stays bound and the projection is unchanged", () => {
  const source = '[mcp_servers.remote]\nurl = "https://mcp.invalid/mcp"\nauth = "oauth"\n';
  const parsed = Bun.TOML.parse(source) as Record<string, any>;
  const projected = projectRegularCodexMcp(parsed, source);
  expect(projected.numericSource).toBe(source);
  expect(isDeepStrictEqual(Bun.TOML.parse(projected.numericSource), Bun.TOML.parse(source))).toBe(true);
});

test("an admitted HTTP row is omitted while an unknown row beside it stays bound", () => {
  const source = [
    "[mcp_servers.upwork]", 'url = "https://mcp.invalid/mcp"', "",
    "[mcp_servers.remote]", 'url = "https://mcp.invalid/mcp"', 'auth = "oauth"', "",
  ].join("\n");
  const parsed = Bun.TOML.parse(source) as Record<string, any>;
  const projected = projectRegularCodexMcp(parsed, source);
  const result = Bun.TOML.parse(projected.numericSource) as Record<string, any>;
  expect(result.mcp_servers?.upwork).toBeUndefined();
  expect(result.mcp_servers?.remote).toBeDefined();
});
