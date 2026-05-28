import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BrowserUseClient } from "../client";
import { CONFIG } from "./config";
import { registerAutomationTools } from "./automation-tools";
import { registerTaskTools } from "./task-tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-browse",
    version: "1.0.0",
  });

  // Initialize client
  let client: BrowserUseClient | null = null;
  try {
    client = new BrowserUseClient(CONFIG.browserUseApiKey);
  } catch (error) {
    console.error("Failed to initialize BrowserUseClient:", error);
  }

  registerAutomationTools(server, client);
  registerTaskTools(server, client);

return server;
}
