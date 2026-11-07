import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fstatSync } from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./server.js";

export const MCP_HTTP_DEFAULT_PORT = 8836;
export const MCP_HTTP_SERVICE_NAME = "skills";

export function isMcpHttpMode(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--http") || process.env.MCP_HTTP === "1";
}

/** Whether standard input is a pipe or socket, which is how an agent host
 * (Claude Code, Codex) connects a stdio MCP server. A terminal, /dev/null under
 * a service manager, or a regular file is none of these. */
export function stdinIsPipeOrSocket(): boolean {
  try { const stat = fstatSync(0); return stat.isFIFO() || stat.isSocket(); } catch { return false; }
}

/** The transport to serve. An explicit choice keeps its meaning: `--stdio` or
 * MCP_STDIO=1 serves stdio, and `--http`, `--port` or MCP_HTTP=1 serves HTTP.
 * With none of them, an agent host's pipe gets stdio, because a host entry
 * registered as plain `skills-mcp` would otherwise wait forever for a reply
 * from an HTTP server; anything else keeps the shared HTTP default. */
export function selectMcpTransport(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env, stdinIsPipe: boolean = stdinIsPipeOrSocket()): "stdio" | "http" {
  if (argv.includes("--stdio") || env.MCP_STDIO === "1") return "stdio";
  if (argv.includes("--http") || argv.includes("--port") || env.MCP_HTTP === "1") return "http";
  return stdinIsPipe ? "stdio" : "http";
}

export function isMcpStdioMode(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--stdio") || process.env.MCP_STDIO === "1";
}

export function parseMcpHttpPort(argv: string[], defaultPort = MCP_HTTP_DEFAULT_PORT): number {
  const portIdx = argv.indexOf("--port");
  if (portIdx >= 0) {
    const parsed = Number.parseInt(argv[portIdx + 1] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fromEnv = process.env.MCP_HTTP_PORT;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return defaultPort;
}

async function connectMcpForNode(): Promise<{
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return { server, transport };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}

export async function handleMcpHttpNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: MCP_HTTP_SERVICE_NAME }));
    return true;
  }

  if (url.pathname !== "/mcp") {
    return false;
  }

  const { server, transport } = await connectMcpForNode();
  const body = req.method === "POST" ? await readBody(req) : undefined;
  await transport.handleRequest(req, res, body);
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  return true;
}

export async function startSkillsMcpHttpServer(options: {
  port?: number;
  hostname?: string;
} = {}): Promise<ReturnType<typeof createServer>> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? parseMcpHttpPort(process.argv.slice(2));

  const httpServer = createServer(async (req, res) => {
    try {
      const handled = await handleMcpHttpNodeRequest(req, res);
      if (!handled) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, hostname, () => resolve());
  });

  const address = httpServer.address();
  const listenPort = typeof address === "object" && address ? address.port : port;
  console.error(`skills-mcp HTTP listening on http://${hostname}:${listenPort}/mcp`);
  return httpServer;
}
