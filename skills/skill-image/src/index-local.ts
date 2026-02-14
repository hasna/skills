#!/usr/bin/env bun

import { writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import type { GenerateOptions, ImageProvider } from './types';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';
import { XAIProvider } from './providers/xai';
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-image',
  description: 'Generate images using AI providers (OpenAI, Google Gemini 3.0, xAI Aurora)',
  version: '1.0.0',
  commands: `Use: skill-image --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

function parseArgs(): GenerateOptions | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return null;
  }

  if (args[0] !== 'generate') {
    console.error(`Unknown command: ${args[0]}`);
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  const options: Partial<GenerateOptions> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--provider':
      case '-p':
        options.provider = args[++i] as GenerateOptions['provider'];
        break;
      case '--prompt':
        options.prompt = args[++i];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--model':
      case '-m':
        options.model = args[++i];
        break;
      case '--size':
      case '-s':
        options.size = args[++i];
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  // Validate required options
  if (!options.provider) {
    console.error('Error: --provider is required');
    process.exit(1);
  }

  if (!options.prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  if (!options.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  // Validate provider
  const validProviders = ['openai', 'google', 'xai'];
  if (!validProviders.includes(options.provider)) {
    console.error(
      `Error: Invalid provider. Choose from: ${validProviders.join(', ')}`
    );
    process.exit(1);
  }

  return options as GenerateOptions;
}

function printHelp() {
  console.log(`
Image Generation Skill

Generate images using AI providers (OpenAI, Google Imagen, xAI Aurora)

USAGE:
  bun run src/index.ts generate [OPTIONS]

OPTIONS:
  --provider, -p <provider>   Provider to use (openai, google, xai) [required]
  --prompt <text>             Text prompt for image generation [required]
  --output, -o <path>         Output file path [required]
  --model, -m <model>         Specific model to use (optional)
  --size, -s <size>           Image size (provider-specific, optional)

EXAMPLES:
  # OpenAI DALL-E 3
  bun run src/index.ts generate --provider openai --prompt "a cat" --output ./cat.png

  # OpenAI with custom size
  bun run src/index.ts generate -p openai --prompt "a landscape" -o ./landscape.png --size 1792x1024

  # Google Imagen 3
  bun run src/index.ts generate --provider google --prompt "a dog" --output ./dog.png

  # xAI Aurora
  bun run src/index.ts generate --provider xai --prompt "a bird" --output ./bird.png

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY              API key for OpenAI
  GEMINI_API_KEY              API key for Google Gemini
  GOOGLE_PROJECT_ID           Google Cloud project ID
  XAI_API_KEY                 API key for xAI

PROVIDER-SPECIFIC OPTIONS:

  OpenAI:
    Models: dall-e-3 (default), gpt-image-1
    Sizes: 1024x1024 (default), 1792x1024, 1024x1792

  Google Imagen 3:
    Models: imagen-3.0-generate-001 (default)
    Sizes: 1:1 (default), 3:4, 4:3, 9:16, 16:9

  xAI Grok-2 Image:
    Models: grok-2-image-1212 (default)
    Sizes: Provider-specific
`);
}

function getProvider(provider: string): ImageProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'google':
      return new GoogleProvider();
    case 'xai':
      return new XAIProvider();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function ensureDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

async function main() {
  const options = parseArgs();

  if (!options) {
    return;
  }

  try {
    console.log('\n=== Image Generation ===\n');

    const provider = getProvider(options.provider);

    const imageBuffer = await provider.generate(options.prompt, {
      model: options.model,
      size: options.size,
    });

    // Ensure output directory exists
    const outputPath = resolve(options.output);
    await ensureDirectory(outputPath);

    // Write image to file
    await writeFile(outputPath, imageBuffer);

    console.log(`\nImage saved to: ${outputPath}`);
    console.log('\nDone!\n');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
