#!/usr/bin/env bun

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`skill-commitpushpr - Instruction-set skill

DESCRIPTION:
  Guides an agent through:
    - scanning repo changes
    - grouping them into logical commits
    - pushing to a feature branch
    - creating a pull request with gh

USAGE:
  skills docs commitpushpr
  skills install commitpushpr --for claude
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
console.log("  skills install commitpushpr --for claude");
