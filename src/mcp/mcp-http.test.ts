import { describe, expect, it } from "bun:test";
import { createServer } from "node:http";
import { buildServer } from "./server.js";
import { handleMcpHttpNodeRequest, MCP_HTTP_SERVICE_NAME } from "./http.js";

async function startHttpServer() {
  const httpServer = createServer(async (req, res) => {
    const handled = await handleMcpHttpNodeRequest(req, res);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { httpServer, baseUrl: `http://127.0.0.1:${port}` };
}

async function mcpInitialize(baseUrl: string) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    }),
  });

  expect(response.status).toBe(200);
  return response.json() as Promise<{ result?: { protocolVersion?: string } }>;
}

describe("skills MCP HTTP transport", () => {
  it("buildServer returns a configured server", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });

  it("GET /health returns ok", async () => {
    const { httpServer, baseUrl } = await startHttpServer();
    try {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", name: MCP_HTTP_SERVICE_NAME });
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it("POST /mcp initialize + tools/list round-trip", async () => {
    const { httpServer, baseUrl } = await startHttpServer();
    try {
      const init = await mcpInitialize(baseUrl);
      expect(init.result?.protocolVersion).toBeDefined();

      const listResponse = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });

      expect(listResponse.status).toBe(200);
      const listPayload = await listResponse.json() as {
        result?: { tools?: Array<{ name: string }> };
      };
      const toolNames = (listPayload.result?.tools ?? []).map((tool) => tool.name);
      expect(toolNames.length).toBeGreaterThan(0);
      expect(toolNames).toContain("list_skills");
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it("serves multiple concurrent MCP clients from one process", async () => {
    const { httpServer, baseUrl } = await startHttpServer();
    try {
      const results = await Promise.all([
        mcpInitialize(baseUrl),
        mcpInitialize(baseUrl),
        mcpInitialize(baseUrl),
      ]);
      expect(results).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});
