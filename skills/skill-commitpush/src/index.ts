#!/usr/bin/env bun

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`skill-commitpush - Instruction-set skill

DESCRIPTION:
  Guides an agent through:
    - scanning repo changes
    - grouping them into logical commits
    - writing conventional commit messages
    - pushing directly to origin/main

USAGE:
  skills docs commitpush
  skills install commitpush --for claude
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
console.log("  skills install commitpush --for claude");
