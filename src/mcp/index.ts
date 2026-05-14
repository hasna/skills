#!/usr/bin/env bun
/**
 * MCP server for the skills library.
 * Exposes tools for listing, searching, pinning, and running skills.
 *
 * Usage:
 *   skills mcp          # Start MCP server on stdio
 *   skills-mcp          # Direct binary
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";

import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerOperationTools } from "./operation-tools.js";
import { registerResourceMetaTools } from "./resource-meta-tools.js";
import { registerScheduleTools } from "./schedule-tools.js";
import { server } from "./server.js";

registerDiscoveryTools(server);
registerOperationTools(server);
registerScheduleTools(server);
registerResourceMetaTools(server);

async function main() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "skills");
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
