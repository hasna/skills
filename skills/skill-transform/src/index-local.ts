#!/usr/bin/env bun

/**
 * Content Transformation CLI
 * Transform, convert, and reformat content using AI
 */
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-transform',
  description: 'Content transformation skill - convert, reformat, and transform text, data, and documents using AI',
  version: '1.0.0',
  commands: `Use: skill-transform --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { readFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { basename, extname, dirname, join } from 'path';
import { transformContent } from './transformers/ai-transformer';
import { detectFormat, getFormatDescription } from './transformers/format-detector';
import type {
  TransformType,
  InputFormat,
  OutputFormat,
  WritingStyle
} from './types';

// Parse command line arguments
function parseArgs(): {
  command: string;
  input?: string;
  output?: string;
  type?: TransformType;
  inputFormat?: InputFormat;
  outputFormat?: OutputFormat;
  style?: WritingStyle;
  language?: string;
  prompt?: string;
  preserveStructure?: boolean;
  text?: string;
} {
  const args = process.argv.slice(2);
  const parsed: any = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '').replace(/-/g, '');

      if (key === 'preservestructure' || key === 'preserve') {
        parsed.preserveStructure = true;
      } else {
        parsed[key] = args[++i];
      }
    }
  }

  // Handle key mappings
  if (parsed.from) {
    parsed.inputFormat = parsed.from;
    delete parsed.from;
  }
  if (parsed.to) {
    parsed.outputFormat = parsed.to;
    delete parsed.to;
  }

  return parsed;
}

// Get file extension for output format
function getOutputExtension(format: OutputFormat): string {
  const extensions: Record<OutputFormat, string> = {
    text: '.txt',
    markdown: '.md',
    html: '.html',
    json: '.json',
    yaml: '.yaml',
    csv: '.csv',
    xml: '.xml',
    code: '.txt'
  };
  return extensions[format] || '.txt';
}

// Display help information
function showHelp(): void {
  console.log(`
Content Transformation CLI - Transform content using AI

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  transform     Transform content from input file or text
  formats       Show supported formats
  types         Show transformation types
  help          Show this help message

TRANSFORM OPTIONS:
  --input <path>         Input file path
  --text <content>       Direct text input (alternative to --input)
  --output <path>        Output file path (optional)
  --type <type>          Transformation type (required)
  --from <format>        Input format (auto-detected if not specified)
  --to <format>          Output format (default: same as input)
  --style <style>        Writing style (for rewrite type)
  --language <lang>      Target language (for translate type)
  --prompt <text>        Custom prompt (for custom type)
  --preserve-structure   Preserve original document structure

TRANSFORMATION TYPES:
  format       Improve formatting and readability
  convert      Convert between formats (JSON, YAML, Markdown, etc.)
  summarize    Create a concise summary
  expand       Elaborate with more detail
  rewrite      Rewrite in a different style
  extract      Extract key information
  translate    Translate to another language
  structure    Add/improve document structure
  custom       Use custom transformation prompt

WRITING STYLES (for rewrite):
  formal, casual, technical, academic, business, creative, journalistic, conversational

FORMATS:
  text, markdown, html, json, yaml, csv, xml, code

EXAMPLES:
  # Convert JSON to YAML
  bun run src/index.ts transform \\
    --input data.json \\
    --type convert \\
    --to yaml \\
    --output data.yaml

  # Summarize a document
  bun run src/index.ts transform \\
    --input report.md \\
    --type summarize \\
    --output summary.md

  # Rewrite in formal style
  bun run src/index.ts transform \\
    --input draft.txt \\
    --type rewrite \\
    --style formal \\
    --output polished.txt

  # Translate to Spanish
  bun run src/index.ts transform \\
    --input article.md \\
    --type translate \\
    --language Spanish \\
    --output article-es.md

  # Extract key points
  bun run src/index.ts transform \\
    --input meeting-notes.txt \\
    --type extract \\
    --to json \\
    --output action-items.json

  # Custom transformation
  bun run src/index.ts transform \\
    --input code.ts \\
    --type custom \\
    --prompt "Add detailed JSDoc comments to all functions" \\
    --output code-documented.ts

  # Transform direct text
  bun run src/index.ts transform \\
    --text "Some content to transform" \\
    --type format \\
    --to markdown

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY    API key for Claude (required)
`);
}

function showFormats(): void {
  console.log(`
SUPPORTED FORMATS:

Input Formats (auto-detected or specified with --from):
  text       Plain text files
  markdown   Markdown documents (.md)
  html       HTML documents
  json       JSON data
  yaml       YAML configuration
  csv        Comma-separated values
  xml        XML documents
  code       Source code (various languages)
  auto       Auto-detect format (default)

Output Formats (specified with --to):
  text       Plain text
  markdown   Markdown
  html       HTML
  json       JSON
  yaml       YAML
  csv        CSV
  xml        XML
  code       Code format
`);
}

function showTypes(): void {
  console.log(`
TRANSFORMATION TYPES:

format
  Improve formatting, readability, and structure
  Example: Clean up messy text, improve paragraph breaks

convert
  Convert between different formats
  Example: JSON to YAML, Markdown to HTML, CSV to JSON
  Options: --from <format> --to <format>

summarize
  Create a concise summary of the content
  Example: Summarize a long article or document

expand
  Elaborate with more detail and examples
  Example: Expand bullet points into full paragraphs

rewrite
  Rewrite content in a different style
  Example: Make casual text more formal
  Options: --style <formal|casual|technical|academic|business|creative|journalistic|conversational>

extract
  Extract key information, facts, and data
  Example: Extract action items from meeting notes

translate
  Translate to another language
  Example: Translate English to Spanish
  Options: --language <target language>

structure
  Add or improve document structure
  Example: Add headings and sections to unstructured text

custom
  Apply a custom transformation using your prompt
  Example: Add comments to code, convert to specific API format
  Options: --prompt "your custom instruction"
`);
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY && !['help', 'formats', 'types'].includes(args.command)) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    switch (args.command) {
      case 'transform': {
        // Get input content
        let content: string;
        let filename: string | undefined;

        if (args.text) {
          content = args.text;
        } else if (args.input) {
          filename = args.input;
          content = await readFile(args.input, 'utf-8');
        } else {
          console.error('Error: --input or --text is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        if (!args.type) {
          console.error('Error: --type is required');
          console.error('Available types: format, convert, summarize, expand, rewrite, extract, translate, structure, custom');
          process.exit(1);
        }

        // Detect or use specified input format
        const inputFormat = (args.inputFormat as InputFormat) || detectFormat(content, filename);
        const outputFormat = (args.outputFormat as OutputFormat) || inputFormat;

        console.log(`\nTransforming content...`);
        console.log(`Type: ${args.type}`);
        console.log(`Input format: ${getFormatDescription(inputFormat)}`);
        console.log(`Output format: ${getFormatDescription(outputFormat)}`);
        if (args.style) console.log(`Style: ${args.style}`);
        if (args.language) console.log(`Language: ${args.language}`);
        console.log('');

        const result = await transformContent({
          content,
          type: args.type as TransformType,
          inputFormat,
          outputFormat,
          style: args.style as WritingStyle,
          language: args.language,
          customPrompt: args.prompt,
          preserveStructure: args.preserveStructure
        });

        // Determine output path
        if (args.output) {
          const outputDir = dirname(args.output);
          await mkdir(outputDir, { recursive: true });
          await Bun.write(args.output, result.content);
          console.log(`\nOutput saved to: ${args.output}`);
        } else if (filename) {
          const inputDir = dirname(filename);
          const inputName = basename(filename, extname(filename));
          const outputPath = join(inputDir, `${inputName}-transformed${getOutputExtension(outputFormat)}`);
          await Bun.write(outputPath, result.content);
          console.log(`\nOutput saved to: ${outputPath}`);
        } else {
          console.log(`\n--- OUTPUT ---\n`);
          console.log(result.content);
          console.log(`\n--- END ---`);
        }

        // Show stats
        console.log(`\nStats:`);
        console.log(`  Input:  ${result.stats.inputWords.toLocaleString()} words (${result.stats.inputLength.toLocaleString()} chars)`);
        console.log(`  Output: ${result.stats.outputWords.toLocaleString()} words (${result.stats.outputLength.toLocaleString()} chars)`);
        break;
      }

      case 'formats':
        showFormats();
        break;

      case 'types':
        showTypes();
        break;

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
