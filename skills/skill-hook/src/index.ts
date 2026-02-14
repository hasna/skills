#!/usr/bin/env bun

/**
 * skill-hook - Claude Code hook scaffold generator
 *
 * Creates a complete hook template in the current directory.
 * Running `skill-hook` without arguments creates the scaffold interactively.
 */

import { createHook } from './commands/create';
import { listEvents } from './commands/events';
import { validateHook } from './commands/validate';

function printHelp() {
  console.log(`skill-hook - Claude Code hook scaffold generator

USAGE:
  skill-hook [name]           Create a hook scaffold (interactive if no name)
  skill-hook [options]

COMMANDS:
  events              List available hook events
  validate <path>     Validate a hook structure
  help                Show this help message

EXAMPLES:
  skill-hook                  Interactive hook creation
  skill-hook my-hook          Create hook-my-hook scaffold
  skill-hook --event Stop     Create with Stop event
  skill-hook events           List hook events

OPTIONS:
  --name <name>       Hook name (prompted if not provided)
  --event <event>     Hook event: PreToolUse, PostToolUse, Stop (default: PreToolUse)
  --matcher <match>   Tool matcher: Bash, Write, Edit, *, etc. (default: *)
  --output <dir>      Output directory (default: current directory)
  --help              Show help
`);
}

async function promptForName(): Promise<string> {
  process.stdout.write('Hook name (without hook- prefix): ');

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const input = new TextDecoder().decode(value).trim();

  if (!input) {
    console.error('Error: Hook name is required');
    process.exit(1);
  }

  return input;
}

async function main() {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }

  // Events command
  if (args[0] === 'events') {
    listEvents();
    process.exit(0);
  }

  // Validate command
  if (args[0] === 'validate') {
    const path = args[1];
    if (!path) {
      console.error('Error: Path required');
      console.error('Usage: skill-hook validate <path>');
      process.exit(1);
    }
    await validateHook(path);
    process.exit(0);
  }

  // Parse options
  const options: Record<string, string> = {};
  let name: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (arg === '--event' && args[i + 1]) {
      options.event = args[++i];
    } else if (arg === '--matcher' && args[i + 1]) {
      options.matcher = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (!arg.startsWith('--') && !name) {
      // First non-option argument is the name
      name = arg;
    }
  }

  // If no name provided, prompt for it
  if (!name) {
    name = await promptForName();
  }

  // Create the hook
  await createHook(name, options);
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
