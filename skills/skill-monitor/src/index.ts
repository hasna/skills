#!/usr/bin/env bun

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`skill-monitor - Instruction-set skill

DESCRIPTION:
  Guides an agent through common open-monitor MCP workflows:
    - machine health and doctor checks
    - process inspection and safe termination
    - cron job inspection and execution
    - cache cleanup and operational summaries

USAGE:
  skills docs monitor
  skills install monitor --for claude
`);
}

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  printHelp();
  process.exit(0);
}

console.log("This is an instruction-set skill. Install it for an agent with:");
console.log("  skills install monitor --for claude");
