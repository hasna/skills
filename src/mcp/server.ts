import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../package.json" with { type: "json" };

import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerOperationTools } from "./operation-tools.js";
import { registerResourceMetaTools } from "./resource-meta-tools.js";
import { registerScheduleTools } from "./schedule-tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "skills",
    version: pkg.version,
  });

  registerDiscoveryTools(server);
  registerOperationTools(server);
  registerScheduleTools(server);
  registerResourceMetaTools(server);

  return server;
}

/** @deprecated Use buildServer() — kept for internal imports during migration */
export const server = buildServer();
