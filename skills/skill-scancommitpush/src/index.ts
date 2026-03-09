#!/usr/bin/env bun

/**
 * skill-scancommitpush - Instruction-set skill
 *
 * This skill is an instruction set (SKILL.md is the primary artifact).
 * It instructs Claude Code agents to scan, group, commit, and push changes.
 *
 * Install to Claude Code:
 *   skills install scancommitpush --for claude
 */

function printHelp(): void {
  console.log(`skill-scancommitpush - Scan, Commit & Push

DESCRIPTION:
  Instruction-set skill for Claude Code agents.
  When loaded, instructs the agent to:
    1. Scan the entire repo for changes
    2. Group changes into logical commits
    3. Write clear, conventional commit messages
    4. Push to GitHub

  This skill does NOT create a pull request.

USAGE:
  This skill is designed to be used as a Claude Code skill (SKILL.md).
  Install it with:

    skills install scancommitpush --for claude

  The CLI itself has no runtime functionality.
`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  printHelp();
  process.exit(0);
}

console.log("This is an instruction-set skill. Install it to Claude Code with:");
console.log("  skills install scancommitpush --for claude");
