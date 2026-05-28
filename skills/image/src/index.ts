#!/usr/bin/env bun

/**
 * Skill Image (HTTP Client)
 * Calls the remote skill API server 
 */

import { executeAndSave, executeSkill, handleInstallCommand } from '../../_common';

// Skill metadata for install command
const SKILL_META = {
  name: 'image',
  description: 'Generate images using provider-cost AI backends',
  version: '1.0.0',
  commands: `image <command> [options]`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

// Handle install/uninstall commands
if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

// Parse command line arguments
function parseArgs(): Record<string, string | boolean> {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      } else {
        parsed[key] = true;
      }
    } else if (!parsed.command) {
      parsed.command = args[i];
    }
  }

  return parsed;
}

// Main logic
async function main() {
  const args = parseArgs();
  const command = (args.command as string) || 'help';

  if (command === 'help' || args.help) {
    console.log(`Skill Image CLI

USAGE:
  image <command> [options]

COMMANDS:
  Call with any command and it will be forwarded to the remote API server

EXAMPLES:
  image generate --provider <provider> --prompt <prompt> [options]

PROVIDERS:
  openai    gpt-image-1.5, dall-e-3
  minimax   image-01
  gemini    imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001, gemini-2.5-flash-image

OPTIONS:
  --model <model>    Provider model override
  --prompt <prompt>  Text prompt
  --size <size>      Provider-specific size or aspect ratio
  --count <count>    Number of images
  --output <path>    Save generated image

EXAMPLES:
  image generate --provider openai --prompt "a cat" --output ./output.png
  image generate --provider minimax --prompt "a dog" --output ./output.png
  image generate --provider gemini --model imagen-4.0-fast-generate-001 --prompt "a bird" --output ./output.png`);
    return;
  }

  // Extract all parameters
  const { command: cmd, ...params } = args;

  // Check if output file is expected (for file-generating skills)
  const fileSkills = ['audio', 'image', 'video', 'emoji'];
  const isFileSkill = fileSkills.includes('image');

  if (isFileSkill && params.output) {
    // Skill that generates files
    const success = await executeAndSave({
      skill: 'image',
      command: cmd,
      ...params,
    });
    process.exit(success ? 0 : 1);
  } else {
    // Skill that returns JSON/text
    const result = await executeSkill({
      skill: 'image',
      command: cmd,
      ...params,
    });

    if (result instanceof Blob) {
      console.error('❌ Unexpected binary response');
      process.exit(1);
    }

    if (result.success && result.output) {
      console.log(result.output);
    } else {
      console.error(`❌ Error: ${result.error}`);
      if (result.details) {
        console.error(`   ${result.details}`);
      }
      process.exit(1);
    }
  }
}

// Run main
main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
