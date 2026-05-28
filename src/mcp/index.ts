#!/usr/bin/env bun
/**
 * MCP server for the skills library.
 * Exposes tools for listing, searching, pinning, and running skills.
 *
 * Usage:
 *   skills mcp          # Start MCP server on stdio
 *   skills-mcp          # Direct binary
 *   skills-mcp --http   # Streamable HTTP on 127.0.0.1:8836
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import pkg from "../../package.json" with { type: "json" };

import { buildServer } from "./server.js";
import { isMcpHttpMode, parseMcpHttpPort, startSkillsMcpHttpServer } from "./http.js";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`Usage: skills-mcp [options]

MCP server for ${pkg.name}

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --http         run Streamable HTTP transport on 127.0.0.1 (default port 8836)
  --port <n>     HTTP port (--http or MCP_HTTP=1)`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

async function main() {
  if (isMcpHttpMode(args)) {
    const port = parseMcpHttpPort(args);
    await startSkillsMcpHttpServer({ port, hostname: "127.0.0.1" });
    return;
  }

  const server = buildServer();
  registerCloudTools(server, "skills");
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}

export { buildServer } from "./server.js";
