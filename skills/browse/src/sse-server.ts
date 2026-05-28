#!/usr/bin/env bun
/**
 * MCP Browse SSE Server
 * Browser automation using Browser-Use Cloud API
 */

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";

import { CONFIG, validateApiKey } from "./sse/config";
import { createMcpServer } from "./sse/mcp-server";

// Create Express app
const app = express();
app.use(cors());
// Don't use express.json() globally - SSEServerTransport needs raw stream

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mcp-browse",
    timestamp: new Date().toISOString(),
  });
});

// Store active transports - keyed by sessionId from transport
const transports: { [sessionId: string]: SSEServerTransport } = {};

// Create MCP server factory

// SSE endpoint - Caddy rewrites /mcp/browse/sse -> /sse
app.get("/sse", validateApiKey, async (req, res) => {
  console.log("SSE connection request received");

  const transport = new SSEServerTransport("/mcp/browse/messages", res);
  transports[transport.sessionId] = transport;

  console.log("SSE session started:", transport.sessionId);

  res.on("close", () => {
    console.log("SSE session closed:", transport.sessionId);
    delete transports[transport.sessionId];
  });

  const server = createMcpServer();
  await server.connect(transport);
});

// Messages endpoint - Caddy rewrites /mcp/browse/messages -> /messages
app.post("/messages", validateApiKey, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No transport found for sessionId" });
  }
});

// Start server
app.listen(CONFIG.port, () => {
  console.log(`MCP Browse SSE server running on port ${CONFIG.port}`);
  console.log(`SSE endpoint: http://localhost:${CONFIG.port}/sse`);
  console.log(`Messages endpoint: http://localhost:${CONFIG.port}/messages`);
  console.log(`Health check: http://localhost:${CONFIG.port}/health`);
  console.log(`API Key: ${CONFIG.apiKey ? "configured" : "not configured (open access)"}`);
  if (!CONFIG.browserUseApiKey) {
    console.warn("WARNING: BROWSER_USE_API_KEY not set - client will not work");
  }
});
