#!/usr/bin/env bun

/**
 * File Format Conversion CLI
 * Convert between images, PDFs, documents, and data formats with AI-powered extraction
 */
import { handleInstallCommand } from '../../_common';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-convert',
  description: 'File format conversion CLI - convert between images, PDFs, documents, and data formats with AI-powered extraction',
  version: '1.0.0',
  commands: `Use: skill-convert --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { stat, readdir, mkdir } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import type {
  FileFormat,
  ImageFormat,
  ImageQuality,
  AIModel,
  ConvertOptions,
  ConvertResult,
} from './types';
import {
  FORMAT_EXTENSIONS,
  FORMAT_CATEGORIES,
  QUALITY_SETTINGS,
  requiresAI,
  getFormatCategory,
} from './types';
import {
  convertImage,
  convertDocument,
  convertData,
  convertWithAI,
  pdfToText,
  imagesToPdf,
  getPdfMetadata,
  getImageMetadata,
} from './converters';

// Parse command line arguments
function parseArgs(): {
  command: string;
  input?: string;
  inputs?: string[];
  output?: string;
  format?: FileFormat;
  quality?: ImageQuality;
  qualityValue?: number;
  clean?: boolean;
  model?: AIModel;
  chunkSize?: number;
  dpi?: number;
  width?: number;
  height?: number;
  pages?: string;
  verbose?: boolean;
  recursive?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, unknown> = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const nextArg = args[i + 1];

      // Boolean flags
      if (key === 'clean' || key === 'c') {
        parsed.clean = true;
      } else if (key === 'verbose' || key === 'v') {
        parsed.verbose = true;
      } else if (key === 'recursive' || key === 'r') {
        parsed.recursive = true;
      }
      // Numeric values
      else if (key === 'quality-value' || key === 'qv') {
        parsed.qualityValue = parseInt(nextArg, 10);
        i++;
      } else if (key === 'chunk-size') {
        parsed.chunkSize = parseInt(nextArg, 10) * 1024 * 1024; // MB to bytes
        i++;
      } else if (key === 'dpi') {
        parsed.dpi = parseInt(nextArg, 10);
        i++;
      } else if (key === 'width' || key === 'w') {
        parsed.width = parseInt(nextArg, 10);
        i++;
      } else if (key === 'height' || key === 'h') {
        parsed.height = parseInt(nextArg, 10);
        i++;
      }
      // String values
      else if (nextArg && !nextArg.startsWith('--')) {
        const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        parsed[camelKey] = nextArg;
        i++;
      }
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      // Additional inputs for batch operations
      if (!parsed.inputs) {
        parsed.inputs = [parsed.input as string];
      }
      (parsed.inputs as string[]).push(arg);
    }
  }

  return parsed as ReturnType<typeof parseArgs>;
}

// Display help information
function showHelp(): void {
  console.log(`
File Format Conversion CLI - Convert files with AI-powered extraction

USAGE:
  bun run src/index.ts <command> <input> [options]

COMMANDS:
  convert     Convert file to another format
  batch       Convert multiple files
  info        Show file information
  formats     List supported formats
  help        Show this help message

CONVERT OPTIONS:
  --format <fmt>      Target format (required)
  --output <path>     Output file path
  --quality <preset>  Image quality: lossless, high, medium, low, web
  --quality-value <n> Custom quality (0-100)
  --clean             Clean/sanitize output with AI
  --model <model>     AI model: claude, gpt-4o, gpt-4o-mini (default: claude)
  --chunk-size <mb>   Chunk size for large files in MB (default: 5)
  --dpi <n>           DPI for PDF to image (default: 150)
  --width <n>         Resize width for images
  --height <n>        Resize height for images
  --pages <spec>      Pages to convert: "1-5" or "1,3,5"
  --verbose           Show detailed output

BATCH OPTIONS:
  --format <fmt>      Target format (required)
  --output <dir>      Output directory (required)
  --recursive         Process directories recursively
  --quality <preset>  Image quality preset
  --clean             Clean/sanitize with AI

IMAGE CONVERSIONS:
  PNG, JPG, JPEG, WebP, GIF, AVIF, TIFF, BMP

  Quality presets:
    lossless  - 100% quality, no compression
    high      - 90% quality (default)
    medium    - 75% quality
    low       - 50% quality
    web       - 60% quality, optimized for web

DOCUMENT CONVERSIONS:
  PDF, DOCX, TXT, HTML, Markdown

DATA CONVERSIONS:
  CSV, Excel (XLSX), JSON, YAML, TSV

AI-POWERED CONVERSIONS:
  These conversions use AI for intelligent extraction:
  - Image to Markdown/Text (OCR)
  - Image to JSON (structured data)
  - PDF to Markdown (with --clean)
  - DOCX to Markdown (with --clean)

EXAMPLES:
  # Convert image format
  bun run src/index.ts convert photo.png --format jpg --quality web

  # Optimize image
  bun run src/index.ts convert large.png --format webp --quality medium

  # Image to PDF
  bun run src/index.ts convert image.jpg --format pdf

  # Multiple images to PDF
  bun run src/index.ts convert img1.jpg img2.jpg img3.jpg --format pdf --output combined.pdf

  # PDF to text
  bun run src/index.ts convert document.pdf --format txt

  # PDF to Markdown with AI cleanup
  bun run src/index.ts convert document.pdf --format md --clean

  # Image to Markdown (OCR)
  bun run src/index.ts convert screenshot.png --format md

  # CSV to Excel
  bun run src/index.ts convert data.csv --format xlsx

  # JSON to YAML
  bun run src/index.ts convert config.json --format yaml

  # DOCX to Markdown
  bun run src/index.ts convert report.docx --format md --clean

  # Batch convert directory
  bun run src/index.ts batch ./images --format webp --output ./converted --quality web

  # File info
  bun run src/index.ts info document.pdf

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY   API key for Claude (for AI-powered conversions)
  OPENAI_API_KEY      API key for OpenAI GPT-4o (alternative AI)
`);
}

// Show supported formats
function showFormats(): void {
  console.log(`
SUPPORTED FORMATS:

IMAGE FORMATS:
  png       PNG image
  jpg/jpeg  JPEG image
  webp      WebP image
  gif       GIF image (first frame extracted for conversions)
  avif      AVIF image
  tiff      TIFF image
  bmp       BMP image

DOCUMENT FORMATS:
  pdf       PDF document
  docx      Microsoft Word
  txt       Plain text
  html      HTML document
  md        Markdown

DATA FORMATS:
  csv       Comma-separated values
  xlsx      Microsoft Excel
  json      JSON data
  yaml      YAML data
  tsv       Tab-separated values

CONVERSION MATRIX:
  From \\ To    | Image | PDF | Markdown | Text | JSON | CSV | Excel
  -------------|-------|-----|----------|------|------|-----|------
  Image        |   ✓   |  ✓  |  AI ✓    | AI ✓ | AI ✓ |     |
  PDF          |       |     |  AI ✓    |  ✓   |      |     |
  DOCX         |       |     |  AI ✓    |  ✓   |      |     |
  HTML         |       |     |    ✓     |  ✓   |      |     |
  Markdown     |       |     |          |  ✓   |      |     |
  CSV          |       |     |          |      |  ✓   |     |   ✓
  JSON         |       |     |          |      |      |  ✓  |
  YAML         |       |     |          |      |  ✓   |  ✓  |
  Excel        |       |     |          |      |  ✓   |  ✓  |

  AI ✓ = Requires AI (Claude/GPT-4o)
`);
}

// Get file info
async function showInfo(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const ext = extname(filePath).slice(1).toLowerCase();
  const format = FORMAT_EXTENSIONS[`.${ext}`] || 'unknown';
  const category = getFormatCategory(format as FileFormat);

  console.log(`\nFile: ${basename(filePath)}`);
  console.log(`Path: ${filePath}`);
  console.log(`Format: ${format} (${category})`);
  console.log(`Size: ${formatBytes(fileStat.size)}`);
  console.log(`Modified: ${fileStat.mtime.toISOString()}`);

  // Format-specific info
  if (category === 'image') {
    try {
      const metadata = await getImageMetadata(filePath);
      console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
      console.log(`Channels: ${metadata.channels}`);
    } catch {
      // Ignore if can't get metadata
    }
  } else if (format === 'pdf') {
    try {
      const metadata = await getPdfMetadata(filePath);
      console.log(`Pages: ${metadata.pageCount}`);
      if (metadata.title) console.log(`Title: ${metadata.title}`);
      if (metadata.author) console.log(`Author: ${metadata.author}`);
    } catch {
      // Ignore if can't get metadata
    }
  }
}

// Format bytes for display
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Perform conversion
async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const inputExt = extname(options.input).slice(1).toLowerCase();
  const inputFormat = FORMAT_EXTENSIONS[`.${inputExt}`] || inputExt;
  const outputFormat = options.format;
  const inputCategory = getFormatCategory(inputFormat as FileFormat);
  const outputCategory = getFormatCategory(outputFormat);

  // Check if AI is required
  if (requiresAI(inputFormat, outputFormat) || options.clean) {
    // Check for API keys
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return {
        success: false,
        input: options.input,
        output: options.output || '',
        inputFormat,
        outputFormat,
        inputSize: 0,
        outputSize: 0,
        error: 'AI conversion requires ANTHROPIC_API_KEY or OPENAI_API_KEY',
        duration: 0,
      };
    }
    return convertWithAI(options);
  }

  // Image to image
  if (inputCategory === 'image' && outputCategory === 'image') {
    return convertImage(options);
  }

  // Image(s) to PDF
  if (inputCategory === 'image' && outputFormat === 'pdf') {
    const { imagesToPdf } = await import('./converters/pdf');
    return imagesToPdf([options.input], options.output || options.input.replace(/\.[^.]+$/, '.pdf'));
  }

  // PDF to text
  if (inputFormat === 'pdf' && outputFormat === 'txt') {
    return pdfToText(options);
  }

  // Document conversions
  if (inputCategory === 'document' || outputCategory === 'document') {
    return convertDocument(options);
  }

  // Data conversions
  if (inputCategory === 'data' || outputCategory === 'data') {
    return convertData(options);
  }

  // Markup conversions
  if (inputCategory === 'markup' || outputCategory === 'markup') {
    return convertDocument(options);
  }

  return {
    success: false,
    input: options.input,
    output: options.output || '',
    inputFormat,
    outputFormat,
    inputSize: 0,
    outputSize: 0,
    error: `Conversion from ${inputFormat} to ${outputFormat} not supported`,
    duration: 0,
  };
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'convert': {
        if (!args.input) {
          console.error('Error: input file is required');
          process.exit(1);
        }
        if (!args.format) {
          console.error('Error: --format is required');
          process.exit(1);
        }

        // Check if multiple inputs for PDF creation
        if (args.inputs && args.inputs.length > 1 && args.format === 'pdf') {
          console.log(`\nCombining ${args.inputs.length} images into PDF...`);
          const result = await imagesToPdf(
            args.inputs,
            args.output || 'combined.pdf'
          );
          if (result.success) {
            console.log(`\nSuccess: ${result.output}`);
            console.log(`Pages: ${result.pagesProcessed}`);
            console.log(`Size: ${formatBytes(result.outputSize)}`);
          } else {
            console.error(`\nFailed: ${result.error}`);
            process.exit(1);
          }
          break;
        }

        const inputStat = await stat(args.input);
        if (!inputStat.isFile()) {
          console.error('Error: input must be a file');
          process.exit(1);
        }

        console.log(`\nConverting: ${args.input}`);
        console.log(`Format: ${args.format}`);
        if (args.quality) console.log(`Quality: ${args.quality}`);
        if (args.clean) console.log(`Clean: yes (AI-powered)`);

        const result = await convert({
          input: args.input,
          output: args.output,
          format: args.format,
          quality: args.quality,
          qualityValue: args.qualityValue,
          clean: args.clean,
          model: args.model,
          chunkSize: args.chunkSize,
          dpi: args.dpi,
          resize: args.width || args.height ? {
            width: args.width,
            height: args.height,
          } : undefined,
          pages: args.pages,
          verbose: args.verbose,
        });

        if (result.success) {
          console.log(`\nSuccess: ${result.output}`);
          console.log(`Input: ${formatBytes(result.inputSize)}`);
          console.log(`Output: ${formatBytes(result.outputSize)}`);
          if (result.compressionRatio) {
            console.log(`Compression: ${result.compressionRatio.toFixed(2)}x`);
          }
          if (result.chunksProcessed && result.chunksProcessed > 1) {
            console.log(`Chunks processed: ${result.chunksProcessed}`);
          }
          if (result.aiProcessed) {
            console.log(`AI processed: yes`);
          }
          console.log(`Duration: ${result.duration}ms`);
        } else {
          console.error(`\nFailed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'batch': {
        if (!args.input) {
          console.error('Error: input directory is required');
          process.exit(1);
        }
        if (!args.format) {
          console.error('Error: --format is required');
          process.exit(1);
        }
        if (!args.output) {
          console.error('Error: --output directory is required');
          process.exit(1);
        }

        const inputStat = await stat(args.input);
        if (!inputStat.isDirectory()) {
          console.error('Error: input must be a directory for batch conversion');
          process.exit(1);
        }

        // Create output directory
        await mkdir(args.output, { recursive: true });

        // Collect files
        const files = await readdir(args.input);
        const results: ConvertResult[] = [];
        let success = 0;
        let failed = 0;

        console.log(`\nBatch converting ${files.length} files...`);

        for (const file of files) {
          const inputPath = join(args.input, file);
          const fileStat = await stat(inputPath);

          if (!fileStat.isFile()) continue;

          const outputPath = join(
            args.output,
            `${basename(file, extname(file))}.${args.format}`
          );

          const result = await convert({
            input: inputPath,
            output: outputPath,
            format: args.format,
            quality: args.quality,
            clean: args.clean,
            model: args.model,
          });

          results.push(result);
          if (result.success) {
            success++;
            if (args.verbose) {
              console.log(`  ✓ ${file} -> ${basename(outputPath)}`);
            }
          } else {
            failed++;
            console.log(`  ✗ ${file}: ${result.error}`);
          }
        }

        console.log(`\n--- Summary ---`);
        console.log(`Total: ${results.length}`);
        console.log(`Success: ${success}`);
        console.log(`Failed: ${failed}`);

        if (failed > 0) process.exit(1);
        break;
      }

      case 'info': {
        if (!args.input) {
          console.error('Error: file path is required');
          process.exit(1);
        }
        await showInfo(args.input);
        break;
      }

      case 'formats':
        showFormats();
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

// Run CLI
main();
