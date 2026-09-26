import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../package.json" with { type: "json" };

import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerOperationTools } from "./operation-tools.js";
import { registerResourceMetaTools } from "./resource-meta-tools.js";
import { registerScheduleTools } from "./schedule-tools.js";
import { registerStorageTools } from "./storage-tools.js";
import { registerRemoteCustomerTools } from "./remote-customer-tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "skills",
    version: pkg.version,
  });

  registerDiscoveryTools(server);
  registerOperationTools(server);
  registerScheduleTools(server);
  registerStorageTools(server);
  registerResourceMetaTools(server);
  registerRemoteCustomerTools(server);

  return server;
}

/** @deprecated Use buildServer() — kept for internal imports during migration */
export const server = buildServer();
