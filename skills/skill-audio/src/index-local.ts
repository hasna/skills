#!/usr/bin/env bun

/**
 * Audio Generation CLI
 * Unified interface for ElevenLabs, OpenAI TTS, and Google Text-to-Speech
 */
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-audio',
  description: 'Audio generation skill for Claude Code using ElevenLabs, OpenAI TTS, and Google Text-to-Speech',
  version: '1.0.0',
  commands: `Use: skill-audio --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { ElevenLabsProvider } from './providers/elevenlabs';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';
import type { AudioProvider, Provider } from './types';

// Parse command line arguments
function parseArgs(): {
  command: string;
  provider?: Provider;
  text?: string;
  voice?: string;
  model?: string;
  output?: string;
  language?: string;
  speed?: number;
} {
  const args = process.argv.slice(2);
  const parsed: any = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    parsed[key] = value;
  }

  // Convert speed to number if present
  if (parsed.speed) {
    parsed.speed = parseFloat(parsed.speed);
  }

  return parsed;
}

// Get provider instance
function getProvider(providerName: Provider): AudioProvider {
  switch (providerName) {
    case 'elevenlabs':
      return new ElevenLabsProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'google':
      return new GoogleProvider();
    default:
      throw new Error(
        `Unknown provider: ${providerName}. Use: elevenlabs, openai, or google`
      );
  }
}

// Display help information
function showHelp(): void {
  console.log(`
Audio Generation CLI - Generate high-quality audio using AI

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  generate    Generate audio from text
  voices      List available voices for a provider
  help        Show this help message

GENERATE OPTIONS:
  --provider <name>     Provider to use: elevenlabs, openai, google (required)
  --text <text>         Text to convert to speech (required)
  --voice <voice>       Voice to use (optional, provider-specific)
  --model <model>       Model to use (optional, provider-specific)
  --output <path>       Output file path (required, e.g., ./output.mp3)
  --language <code>     Language code (optional, for Google TTS, e.g., en-US)
  --speed <number>      Speaking speed (optional, 0.25-4.0, default: 1.0)

VOICES OPTIONS:
  --provider <name>     Provider to list voices from (required)

EXAMPLES:
  # Generate audio with ElevenLabs
  bun run src/index.ts generate --provider elevenlabs --text "Hello world" --voice rachel --output ./output.mp3

  # Generate audio with OpenAI TTS
  bun run src/index.ts generate --provider openai --text "Hello world" --voice nova --output ./output.mp3

  # Generate audio with Google TTS
  bun run src/index.ts generate --provider google --text "Hello world" --language en-US --output ./output.mp3

  # List available voices
  bun run src/index.ts voices --provider elevenlabs
  bun run src/index.ts voices --provider openai
  bun run src/index.ts voices --provider google

ENVIRONMENT VARIABLES:
  ELEVENLABS_API_KEY    API key for ElevenLabs
  OPENAI_API_KEY        API key for OpenAI
  GOOGLE_API_KEY        API key for Google Cloud TTS
`);
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'generate': {
        if (!args.provider) {
          console.error('Error: --provider is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }
        if (!args.text) {
          console.error('Error: --text is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }
        if (!args.output) {
          console.error('Error: --output is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        const provider = getProvider(args.provider as Provider);
        console.log(`Generating audio with ${provider.name}...`);

        await provider.generate({
          text: args.text,
          voice: args.voice,
          model: args.model,
          output: args.output,
          language: args.language,
          speed: args.speed,
        });
        break;
      }

      case 'voices': {
        if (!args.provider) {
          console.error('Error: --provider is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        const provider = getProvider(args.provider as Provider);
        console.log(`Fetching voices from ${provider.name}...\n`);

        const voices = await provider.listVoices();

        if (voices.length === 0) {
          console.log('No voices available');
          break;
        }

        console.log(`Found ${voices.length} voices:\n`);
        voices.forEach((voice) => {
          console.log(`  ${voice.name} (${voice.id})`);
          if (voice.description) {
            console.log(`    ${voice.description}`);
          }
          if (voice.category) {
            console.log(`    Category: ${voice.category}`);
          }
          console.log('');
        });
        break;
      }

      case 'help':
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Use: bun run src/index.ts help');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI
main();
