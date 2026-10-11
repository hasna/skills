import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../package.json" with { type: "json" };

import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerOperationTools } from "./operation-tools.js";
import { registerResourceMetaTools } from "./resource-meta-tools.js";
import { registerScheduleTools } from "./schedule-tools.js";
import { registerStorageTools } from "./storage-tools.js";
import { registerRemoteCustomerTools } from "./remote-customer-tools.js";
import { servePackageZodToolList } from "./package-tool-list.js";

/** Register every Skills tool and resource on `server`. */
export function registerSkillsTools(server: McpServer): void {
  registerDiscoveryTools(server);
  registerOperationTools(server);
  registerScheduleTools(server);
  registerStorageTools(server);
  registerResourceMetaTools(server);
  registerRemoteCustomerTools(server);
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "skills",
    version: pkg.version,
  });
  // tools/list must convert schemas with this package's zod, not the SDK's.
  servePackageZodToolList(server);
  registerSkillsTools(server);
  return server;
}

/** @deprecated Use buildServer() — kept for internal imports during migration */
export const server = buildServer();
