#!/usr/bin/env bun

/**
 * Extraction CLI
 * Extract text and structured data from images and PDFs using OpenAI Vision
 */
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-extract',
  description: 'Extract text and structured data from images and PDFs using OpenAI Vision',
  version: '1.0.0',
  commands: `Use: skill-extract --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { extractFromImage, isImageFile, getSupportedImageExtensions } from './extractors/image';
import { extractFromPDF, isPDFFile } from './extractors/pdf';
import type { ExtractOptions, OutputFormat } from './types';
import { basename, extname, dirname, join } from 'path';

// Parse command line arguments
function parseArgs(): {
  command: string;
  input?: string;
  output?: string;
  format?: OutputFormat;
  prompt?: string;
  model?: string;
  detail?: 'low' | 'high' | 'auto';
} {
  const args = process.argv.slice(2);
  const parsed: any = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      parsed[key] = args[++i];
    } else if (arg.startsWith('-')) {
      const key = arg.replace(/^-/, '');
      // Short flags
      switch (key) {
        case 'i':
          parsed['input'] = args[++i];
          break;
        case 'o':
          parsed['output'] = args[++i];
          break;
        case 'f':
          parsed['format'] = args[++i];
          break;
        case 'p':
          parsed['prompt'] = args[++i];
          break;
        case 'm':
          parsed['model'] = args[++i];
          break;
        case 'd':
          parsed['detail'] = args[++i];
          break;
        case 'h':
          parsed['command'] = 'help';
          break;
      }
    }
  }

  return parsed;
}

// Display help information
function showHelp(): void {
  const imageExts = getSupportedImageExtensions().join(', ');

  console.log(`
Extraction CLI - Extract text and data from images and PDFs

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  extract       Extract text/data from an image or PDF
  help          Show this help message

EXTRACT OPTIONS:
  --input, -i <path>      Input file path (image or PDF) [required]
  --output, -o <path>     Output file path (optional, defaults to input name + format extension)
  --format, -f <type>     Output format: text, markdown, json (default: text)
  --prompt, -p <text>     Custom extraction prompt (optional)
  --model, -m <model>     OpenAI model to use (default: gpt-4o)
  --detail, -d <level>    Image detail level: low, high, auto (default: auto, images only)

SUPPORTED INPUT FORMATS:
  Images: ${imageExts}
  Documents: .pdf

EXAMPLES:
  # Extract text from an image
  bun run src/index.ts extract --input ./receipt.png --output ./receipt.txt

  # Extract as Markdown from a PDF
  bun run src/index.ts extract -i ./document.pdf -o ./document.md -f markdown

  # Extract with custom prompt
  bun run src/index.ts extract \\
    --input ./invoice.png \\
    --format json \\
    --prompt "Extract invoice number, date, total amount, and line items"

  # High-detail extraction for small text
  bun run src/index.ts extract \\
    --input ./handwriting.jpg \\
    --detail high \\
    --format text

OUTPUT FORMATS:
  text      - Clean, readable plain text
  markdown  - Structured Markdown with headings, lists, and tables
  json      - Structured JSON object with sections, tables, and metadata

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY          API key for OpenAI Vision API (required)

NOTES:
  - Image extraction uses OpenAI GPT-4 Vision for accurate OCR
  - PDF extraction uses native text parsing, with optional OpenAI cleanup
  - Use --detail high for images with small text or fine details
  - Use --detail low for faster processing of simple images
`);
}

// Get output extension based on format
function getOutputExtension(format: OutputFormat): string {
  switch (format) {
    case 'markdown':
      return '.md';
    case 'json':
      return '.json';
    case 'text':
    default:
      return '.txt';
  }
}

// Detect input type
function detectInputType(filePath: string): 'image' | 'pdf' | 'unknown' {
  if (isImageFile(filePath)) return 'image';
  if (isPDFFile(filePath)) return 'pdf';
  return 'unknown';
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'extract': {
        if (!args.input) {
          console.error('Error: --input is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        const inputType = detectInputType(args.input);

        if (inputType === 'unknown') {
          console.error(`Error: Unsupported file type: ${extname(args.input)}`);
          console.error('Supported: images (.png, .jpg, .jpeg, .gif, .webp) and PDFs (.pdf)');
          process.exit(1);
        }

        const format = (args.format as OutputFormat) || 'text';

        console.log('\n=== Extraction ===\n');
        console.log(`Input: ${args.input}`);
        console.log(`Type: ${inputType}`);
        console.log(`Format: ${format}`);
        if (args.prompt) {
          console.log(`Prompt: ${args.prompt}`);
        }
        console.log('');

        const options: ExtractOptions = {
          input: args.input,
          output: args.output,
          format,
          prompt: args.prompt,
          model: args.model,
          detail: args.detail as 'low' | 'high' | 'auto',
        };

        let result;

        if (inputType === 'image') {
          result = await extractFromImage(options);
        } else {
          result = await extractFromPDF(options);
        }

        // Determine output path
        let outputPath = args.output;
        if (!outputPath) {
          const inputDir = dirname(args.input);
          const inputName = basename(args.input, extname(args.input));
          outputPath = join(inputDir, `${inputName}${getOutputExtension(format)}`);
        }

        // Write output
        await Bun.write(outputPath, result.text);

        console.log(`\nExtraction complete!`);
        console.log(`Output: ${outputPath}`);
        console.log(`Format: ${result.format}`);

        if (result.metadata?.pages) {
          console.log(`Pages: ${result.metadata.pages}`);
        }
        if (result.metadata?.model) {
          console.log(`Model: ${result.metadata.model}`);
        }
        if (result.metadata?.tokens) {
          console.log(`Tokens used: ${result.metadata.tokens}`);
        }

        // Show content stats
        const wordCount = result.text.split(/\s+/).filter(Boolean).length;
        const charCount = result.text.length;
        console.log(`Characters: ${charCount.toLocaleString()}`);
        console.log(`Words: ${wordCount.toLocaleString()}`);
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
    console.error('\nError:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI
main();
