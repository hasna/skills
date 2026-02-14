#!/usr/bin/env bun

/**
 * skill-implementation - Project implementation scaffold generator
 *
 * Creates a .implementation directory structure for tracking
 * project development: plans, todos, audits, architecture, and more.
 */

import { createImplementation } from './commands/create';

function printHelp() {
  console.log(`skill-implementation - Project implementation scaffold generator

USAGE:
  skill-implementation [options]

COMMANDS:
  (no command)        Create .implementation scaffold in current directory
  help                Show this help message

OPTIONS:
  --output <dir>      Output directory (default: current directory)
  --force             Overwrite existing .implementation
  --help              Show help

EXAMPLES:
  skill-implementation              Create scaffold in current directory
  skill-implementation --force      Recreate existing scaffold
`);
}

async function main() {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }

  // Parse options
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--force') {
      options.force = true;
    }
  }

  // Create the implementation scaffold
  await createImplementation(options);
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
