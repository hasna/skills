#!/usr/bin/env bun

import { resolve } from 'path';
import type { GenerateOptions, EmojiPrompt, EmojiResult, ImageProvider } from './types';
import { PromptGenerator } from './prompt-generator';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { ImageProcessor } from './image-processor';

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

  const options: Partial<GenerateOptions> = {
    count: 5,
    provider: 'openai',
    size: 128,
    style: 'flat',
    format: 'directory',
    concurrency: 3,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--theme':
      case '-t':
        options.theme = args[++i];
        break;
      case '--count':
      case '-c':
        options.count = parseInt(args[++i], 10);
        break;
      case '--provider':
      case '-p':
        options.provider = args[++i] as 'openai' | 'gemini';
        break;
      case '--size':
      case '-s':
        options.size = parseInt(args[++i], 10);
        break;
      case '--style':
        options.style = args[++i] as GenerateOptions['style'];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--format':
      case '-f':
        options.format = args[++i] as 'zip' | 'directory';
        break;
      case '--concurrency':
        options.concurrency = parseInt(args[++i], 10);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  // Validate required options
  if (!options.theme) {
    console.error('Error: --theme is required');
    process.exit(1);
  }

  if (!options.output) {
    // Default output based on format
    options.output = options.format === 'zip'
      ? `./emoji-${options.theme.toLowerCase().replace(/\s+/g, '-')}.zip`
      : `./emoji-${options.theme.toLowerCase().replace(/\s+/g, '-')}`;
  }

  // Validate provider
  if (!['openai', 'gemini'].includes(options.provider!)) {
    console.error('Error: Invalid provider. Choose from: openai, gemini');
    process.exit(1);
  }

  // Validate style
  if (!['flat', '3d', 'outline', 'gradient'].includes(options.style!)) {
    console.error('Error: Invalid style. Choose from: flat, 3d, outline, gradient');
    process.exit(1);
  }

  // Validate count
  if (options.count! < 1 || options.count! > 50) {
    console.error('Error: Count must be between 1 and 50');
    process.exit(1);
  }

  return options as GenerateOptions;
}

function printHelp(): void {
  console.log(`
Emoji Pack Generator Skill

Generate emoji packs using AI-powered prompt generation and image creation.

USAGE:
  bun run src/index.ts generate [OPTIONS]

OPTIONS:
  --theme, -t <theme>        Theme for emoji pack (e.g., "Christmas", "Food") [required]
  --count, -c <number>       Number of emojis to generate (1-50, default: 5)
  --provider, -p <provider>  Image provider: openai, gemini (default: openai)
  --size, -s <pixels>        Output size in pixels (default: 128)
  --style <style>            Emoji style: flat, 3d, outline, gradient (default: flat)
  --output, -o <path>        Output path (directory or zip file)
  --format, -f <format>      Output format: directory, zip (default: directory)
  --concurrency <number>     Concurrent image generations (default: 3)

EXAMPLES:
  # Generate 10 Christmas emojis
  bun run src/index.ts generate --theme "Christmas" --count 10

  # Generate food emojis as a zip file
  bun run src/index.ts generate -t "Food and Drinks" -c 15 -f zip -o ./food-emojis.zip

  # Generate 3D style emojis with Gemini
  bun run src/index.ts generate -t "Animals" -c 8 -p gemini --style 3d

  # Generate high-res emojis (256px)
  bun run src/index.ts generate -t "Weather" -c 6 -s 256

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY            API key for OpenAI (required for openai provider)
  GEMINI_API_KEY            API key for Google Gemini (required for gemini provider)
  GOOGLE_PROJECT_ID         Google Cloud project ID (required for Gemini image generation)

WORKFLOW:
  1. AI generates creative prompts based on your theme
  2. Images are generated asynchronously using the selected provider
  3. Images are resized to the specified size
  4. Output is saved as a directory or zip file with manifest

OUTPUT:
  - Individual PNG files for each emoji
  - manifest.json with metadata and prompts
`);
}

function getImageProvider(provider: string): ImageProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'gemini':
      return new GeminiProvider();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function generateWithConcurrency(
  prompts: EmojiPrompt[],
  provider: ImageProvider,
  concurrency: number,
  onProgress: (current: number, total: number, name: string) => void
): Promise<EmojiResult[]> {
  const results: EmojiResult[] = [];
  const queue = [...prompts];
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const prompt = queue.shift();
      if (!prompt) break;

      try {
        const buffer = await provider.generate(prompt.prompt);
        results.push({
          name: prompt.name,
          prompt: prompt.prompt,
          buffer,
        });
        completed++;
        onProgress(completed, prompts.length, prompt.name);
      } catch (error) {
        console.error(`  Failed to generate "${prompt.name}": ${error}`);
        // Continue with other emojis
      }
    }
  };

  // Start concurrent workers
  const workers = Array(Math.min(concurrency, prompts.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);

  return results;
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options) {
    return;
  }

  try {
    console.log('\n=== Emoji Pack Generator ===\n');
    console.log(`Theme: ${options.theme}`);
    console.log(`Count: ${options.count}`);
    console.log(`Provider: ${options.provider}`);
    console.log(`Style: ${options.style}`);
    console.log(`Size: ${options.size}px`);
    console.log(`Format: ${options.format}`);
    console.log('');

    // Step 1: Generate prompts using AI
    console.log('Step 1/4: Generating emoji prompts...');
    const promptGenerator = new PromptGenerator(options.provider, options.style);
    const prompts = await promptGenerator.generate(options.theme, options.count);
    console.log(`  Generated ${prompts.length} prompts\n`);

    // Display generated prompts
    console.log('Generated emojis:');
    prompts.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}: ${p.description}`);
    });
    console.log('');

    // Step 2: Generate images
    console.log('Step 2/4: Generating images...');
    const imageProvider = getImageProvider(options.provider);
    const results = await generateWithConcurrency(
      prompts,
      imageProvider,
      options.concurrency,
      (current, total, name) => {
        console.log(`  [${current}/${total}] Generated: ${name}`);
      }
    );
    console.log(`  Generated ${results.length} images\n`);

    // Step 3: Resize images
    console.log('Step 3/4: Resizing images...');
    const processor = new ImageProcessor(options.size);
    for (const result of results) {
      result.buffer = await processor.resize(result.buffer, result.name);
    }
    console.log(`  Resized to ${options.size}x${options.size}px\n`);

    // Step 4: Save output
    console.log('Step 4/4: Saving output...');
    const outputPath = resolve(options.output);

    if (options.format === 'zip') {
      await processor.createZip(results, outputPath);
      console.log(`  Created zip: ${outputPath}`);
    } else {
      await processor.saveToDirectory(results, outputPath);
      await processor.createManifest(results, options.theme, resolve(outputPath, 'manifest.json'));
      console.log(`  Saved to directory: ${outputPath}`);
    }

    console.log('\n=== Done! ===\n');
    console.log(`Generated ${results.length} emojis for theme "${options.theme}"`);
    console.log(`Output: ${outputPath}`);
    console.log('');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
