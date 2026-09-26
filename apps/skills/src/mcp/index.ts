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
import pkg from "../../package.json" with { type: "json" };

import { isSkillsFleetCredentialError, resolveSkillsFleet } from "../lib/fleet-credentials.js";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`Usage: skills-mcp [options]

MCP server for ${pkg.name}

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --invitation-recovery --stdio  expose only anonymous invitation recovery tools
  --stdio        run newline-delimited JSON-RPC for agent hosts
  --http         run Streamable HTTP transport on 127.0.0.1 (default; port 8836)
  --port <n>     HTTP port (--http or MCP_HTTP=1)`);
}

if (!args.some(value => value.startsWith("--invitation-recovery")) && (args.includes("--help") || args.includes("-h"))) {
  printHelp();
  process.exit(0);
}

if (!args.some(value => value.startsWith("--invitation-recovery")) && (args.includes("--version") || args.includes("-V"))) {
  console.log(pkg.version);
  process.exit(0);
}

/**
 * FAIL CLOSED AT STARTUP (owner ruling 2026-09-04, hasna/apps#1720; #1720
 * validation, round 1): the MCP process resolves the fleet ladder BEFORE it
 * connects any transport. With no credential, no authority and no
 * `HASNA_SKILLS_LOCAL=1` opt-in it exits 1 with the ladder's one line on
 * stderr — before `initialize` is answered, before an HTTP port is bound —
 * mirroring the CLI, which exits 1 on the same machine. Serving the bundled
 * catalog to an agent host that registered `skills-mcp` on a station without
 * its credential is the false green the ruling removed. The explicit local
 * opt-in starts the server and announces local mode once on stderr; a
 * credential (or a vault pointer the tools complete per call) starts it hosted.
 *
 * Every data tool still runs the same gate per call (lib/read-access.ts), so a
 * credential that disappears mid-process is refused by the next call too.
 */
export function assertSkillsMcpConfigured(env: Record<string, string | undefined> = process.env): void {
  try {
    resolveSkillsFleet(env);
  } catch (error) {
    if (!isSkillsFleetCredentialError(error)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Start the Skills MCP server on stdio (newline-delimited JSON-RPC).
 *
 * Exported so the `skills mcp` CLI subcommand can start the server directly:
 * a bare dynamic import of this module is inert, because `import.meta.main`
 * is false when the module is not the process entry point — which made
 * `skills mcp` exit rc=0 with zero bytes instead of starting the documented
 * stdio server (BUG e3997558).
 */
export async function startMcpStdio(): Promise<void> {
  assertSkillsMcpConfigured();
  const { buildServer } = await import("./server.js");
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

async function main() {
  if (args.some(value => value.startsWith("--invitation-recovery"))) {
    try { const { startInvitationRecoveryMcp } = await import("./invitation-recovery.js"); await startInvitationRecoveryMcp(args); }
    catch { console.error("Invitation recovery requires only --invitation-recovery --stdio and an explicit Skills API URL, without incompatible modes. No session was initialized."); process.exitCode = 1; }
    return;
  }
  const { isMcpStdioMode, parseMcpHttpPort, startSkillsMcpHttpServer } = await import("./http.js");
  if (isMcpStdioMode(args)) {
    await startMcpStdio();
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  assertSkillsMcpConfigured();
  const port = parseMcpHttpPort(args);
  await startSkillsMcpHttpServer({ port, hostname: "127.0.0.1" });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}

// Ordinary server construction remains in server.ts; recovery must not import it.
