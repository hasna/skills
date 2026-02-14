#!/usr/bin/env bun

/**
 * Article Writing CLI
 * Spawns parallel AI agents to research and write articles
 */
import { handleInstallCommand } from '../../_common';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-write',
  description: 'Article writing skill that spawns parallel AI agents to research and write articles with image generation',
  version: '1.0.0',
  commands: `Use: skill-write --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { generateArticle, generateArticlesBatch } from './orchestrator';

// Parse command line arguments
function parseArgs(): {
  command: string;
  topic?: string;
  topics?: string[];
  style?: 'blog' | 'technical' | 'news' | 'academic' | 'casual';
  length?: 'short' | 'medium' | 'long';
  output?: string;
  image?: boolean;
  imageProvider?: 'openai' | 'google' | 'xai';
  parallel?: number;
  filename?: string;
} {
  const args = process.argv.slice(2);
  const parsed: any = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const value = args[i + 1];

      if (key === 'image') {
        parsed.image = true;
      } else if (key === 'topics') {
        // Collect all topics until next flag
        const topicsList: string[] = [];
        i++;
        while (i < args.length && !args[i].startsWith('--')) {
          topicsList.push(args[i]);
          i++;
        }
        i--; // Adjust for the outer loop increment
        parsed.topics = topicsList;
      } else if (key === 'parallel') {
        parsed.parallel = parseInt(value, 10);
        i++;
      } else {
        parsed[key] = value;
        i++;
      }
    }
  }

  // Map 'image-provider' to 'imageProvider'
  if (parsed['image-provider']) {
    parsed.imageProvider = parsed['image-provider'];
    delete parsed['image-provider'];
  }

  return parsed;
}

// Display help information
function showHelp(): void {
  console.log(`
Article Writing CLI - Generate articles using parallel AI agents

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  write       Write a single article on a topic
  batch       Write multiple articles in parallel
  help        Show this help message

WRITE OPTIONS:
  --topic <text>            Topic to write about (required)
  --style <style>           Writing style: blog, technical, news, academic, casual (default: blog)
  --length <length>         Article length: short, medium, long (default: medium)
  --output <dir>            Output directory for the article (required)
  --filename <name>         Custom filename (without extension)
  --image                   Generate a cover image for the article
  --image-provider <name>   Image provider: openai, google, xai (default: openai)

BATCH OPTIONS:
  --topics <topic1> <topic2> ...   Topics to write about (required)
  --style <style>                   Writing style (default: blog)
  --length <length>                 Article length (default: medium)
  --output <dir>                    Output directory (required)
  --parallel <n>                    Number of parallel agents (default: 3)
  --image                           Generate cover images
  --image-provider <name>           Image provider (default: openai)

EXAMPLES:
  # Write a single article
  bun run src/index.ts write \\
    --topic "The Future of AI in Healthcare" \\
    --style technical \\
    --length long \\
    --output ./articles \\
    --image

  # Write multiple articles in parallel
  bun run src/index.ts batch \\
    --topics "Machine Learning" "Cloud Computing" "Cybersecurity" \\
    --style blog \\
    --output ./articles \\
    --parallel 5 \\
    --image

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY         API key for Claude (required)
  OPENAI_API_KEY            API key for OpenAI (for image generation)
  GOOGLE_API_KEY            API key for Google Cloud
  GOOGLE_PROJECT_ID         Google Cloud project ID
  XAI_API_KEY               API key for xAI

ARTICLE STYLES:
  blog        Conversational and engaging with personal touches
  technical   Professional with precise terminology
  news        Journalistic with inverted pyramid structure
  academic    Formal with citations and scholarly tone
  casual      Friendly and conversational

ARTICLE LENGTHS:
  short       300-600 words
  medium      800-1200 words
  long        1500-2500 words
`);
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY && args.command !== 'help') {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    switch (args.command) {
      case 'write': {
        if (!args.topic) {
          console.error('Error: --topic is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }
        if (!args.output) {
          console.error('Error: --output is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        const result = await generateArticle({
          topic: args.topic,
          style: args.style,
          length: args.length,
          includeImage: args.image,
          imageProvider: args.imageProvider,
          outputDir: args.output,
          filename: args.filename
        });

        if (result.success) {
          console.log(`\nSuccess! Article saved to: ${result.filename}`);
          console.log(`Word count: ${result.wordCount.toLocaleString()}`);
          if (result.imagePath) {
            console.log(`Cover image: ${result.imagePath}`);
          }
        } else {
          console.error(`\nFailed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'batch': {
        if (!args.topics || args.topics.length === 0) {
          console.error('Error: --topics is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }
        if (!args.output) {
          console.error('Error: --output is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        const results = await generateArticlesBatch({
          topics: args.topics,
          style: args.style,
          length: args.length,
          includeImage: args.image,
          imageProvider: args.imageProvider,
          outputDir: args.output,
          parallel: args.parallel
        });

        // Print summary table
        console.log('\n--- Results Summary ---');
        results.forEach(r => {
          const status = r.success ? '✓' : '✗';
          const words = r.success ? `${r.wordCount} words` : r.error;
          console.log(`${status} ${r.topic}: ${words}`);
        });

        const failed = results.filter(r => !r.success).length;
        if (failed > 0) {
          process.exit(1);
        }
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
