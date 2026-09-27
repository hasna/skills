#!/usr/bin/env bun
// Thin adapter: the server is built and started through the SDK surface.
import pkg from "../../package.json" with { type: "json" };
import { resolveServerConfig, startSkillsServer } from "../sdk/server.js";
import { resolveDatabaseTarget } from "../sdk/storage.js";

// Binds-before-version class (todos row 7e5f8f3d): --version/--help must
// answer BEFORE resolveServerConfig()/startSkillsServer() binds. They
// previously fell through and bound :8787 with no output.
const EARLY_ARGV = process.argv.slice(2);
if (EARLY_ARGV.includes("--version") || EARLY_ARGV.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}
if (EARLY_ARGV.includes("--help") || EARLY_ARGV.includes("-h")) {
  console.log(`Usage: skills-server [options]

Runs the @hasna/skills HTTP API.

Options:
  -V, --version  output the version number
  -h, --help     display help for command

Environment:
  SKILLS_PORT  Listen port (default: 8787)`);
  process.exit(0);
}

const config = resolveServerConfig();
const server = await startSkillsServer({ config });

console.log(`skills API listening on http://${config.host}:${server.port}`);
// Name the backend and, for SQLite, the file. An operator should never have to guess
// where their runs are being written - and if this line ever says "memory", it now took
// an explicit opt-in to get there rather than a forgotten environment variable.
console.log(`storage: ${resolveDatabaseTarget(config.databaseUrl).label}`);
