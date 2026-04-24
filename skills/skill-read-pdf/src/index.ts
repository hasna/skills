#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

const VERSION = "0.1.0";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const DEFAULT_PROMPT =
  "Extract the text, tables, and structured content from this PDF. Preserve headings, bullets, and table structure.";
const API_URL = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
const MAX_CHUNK_SIZE = 20;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
type PdfLib = typeof import("pdf-lib");
type LoadedPdfDocument = Awaited<ReturnType<PdfLib["PDFDocument"]["load"]>>;

type OutputFormat = "json" | "markdown" | "text";

interface CliOptions {
  input?: string;
  pages?: string;
  prompt: string;
  format: OutputFormat;
  model: string;
  chunkSize: number;
  maxTokens: number;
  output?: string;
  text: boolean;
}

interface PdfChunkResult {
  chunk: number;
  pages: number[];
  response: unknown;
}

interface PdfResult {
  input: string;
  model: string;
  prompt: string;
  format: OutputFormat;
  totalPages: number;
  requestedPages: number[];
  chunkSize: number;
  chunks: PdfChunkResult[];
  mergedText: string;
}

function printHelp(): void {
  console.log(`skill-read-pdf v${VERSION}

USAGE:
  skill-read-pdf --input <path-or-url> [options]

OPTIONS:
  -i, --input <path-or-url>  PDF file path or remote URL
      --pages <ranges>       Page ranges like 1-3,5,8-10
  -p, --prompt <text>        Extraction prompt
  -f, --format <value>       json | markdown | text
  -m, --model <name>         Anthropic model to call
      --chunk-size <n>       Pages per request (max 20)
      --max-tokens <n>       Maximum response tokens per chunk
  -o, --output <path>        Save result to a file
      --text                 Print only merged chunk text
      --help                 Show this help message
      --version              Show the current version
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: DEFAULT_PROMPT,
    format: "markdown",
    model: DEFAULT_MODEL,
    chunkSize: MAX_CHUNK_SIZE,
    maxTokens: 1600,
    text: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--input":
      case "-i":
        options.input = argv[++i];
        break;
      case "--pages":
        options.pages = argv[++i];
        break;
      case "--prompt":
      case "-p":
        options.prompt = argv[++i] ?? DEFAULT_PROMPT;
        break;
      case "--format":
      case "-f": {
        const value = (argv[++i] ?? "markdown").toLowerCase();
        if (value !== "json" && value !== "markdown" && value !== "text") {
          throw new Error(`Invalid --format value: ${value}`);
        }
        options.format = value;
        break;
      }
      case "--model":
      case "-m":
        options.model = argv[++i] ?? DEFAULT_MODEL;
        break;
      case "--chunk-size": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value <= 0 || value > MAX_CHUNK_SIZE) {
          throw new Error(`--chunk-size must be between 1 and ${MAX_CHUNK_SIZE}`);
        }
        options.chunkSize = value;
        break;
      }
      case "--max-tokens": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --max-tokens value: ${argv[i]}`);
        }
        options.maxTokens = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i];
        break;
      case "--text":
        options.text = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.input) {
          options.input = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.input) {
    throw new Error("Missing required --input <path-or-url> argument");
  }

  return options;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadPdfBytes(input: string): Promise<{ input: string; bytes: Uint8Array }> {
  if (isUrl(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }
    return {
      input,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  const resolvedInput = resolve(input);
  return {
    input: resolvedInput,
    bytes: await readFile(resolvedInput),
  };
}

async function loadPdfLib(): Promise<PdfLib> {
  try {
    return await import("pdf-lib");
  } catch {
    throw new Error("Missing dependency 'pdf-lib'. Run bun install in this skill directory.");
  }
}

function parsePageRanges(spec: string | undefined, totalPages: number): number[] {
  if (!spec) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [startText, endText] = trimmed.split("-");
      const start = Number.parseInt(startText ?? "", 10);
      const end = Number.parseInt(endText ?? "", 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) {
        throw new Error(`Invalid page range: ${trimmed}`);
      }
      for (let page = start; page <= end; page += 1) {
        if (page > totalPages) {
          throw new Error(`Requested page ${page} exceeds total pages (${totalPages})`);
        }
        pages.add(page);
      }
      continue;
    }

    const page = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(page) || page <= 0 || page > totalPages) {
      throw new Error(`Invalid page number: ${trimmed}`);
    }
    pages.add(page);
  }

  return Array.from(pages).sort((a, b) => a - b);
}

function chunkPages(pages: number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    chunks.push(pages.slice(index, index + size));
  }
  return chunks;
}

async function buildChunkPdf(pdfLib: PdfLib, sourcePdf: LoadedPdfDocument, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = pdfLib;
  const output = await PDFDocument.create();
  const copiedPages = await output.copyPages(sourcePdf, pages.map((page) => page - 1));
  for (const page of copiedPages) {
    output.addPage(page);
  }
  return output.save();
}

function formatInstruction(format: OutputFormat): string {
  switch (format) {
    case "json":
      return "Return valid JSON with keys summary, text, tables, and structure.";
    case "text":
      return "Return plain text only. Keep the important structure readable.";
    case "markdown":
    default:
      return "Return markdown. Preserve headings, lists, and tables when possible.";
  }
}

async function callAnthropicPdf(
  pdfBytes: Uint8Array,
  model: string,
  maxTokens: number,
  prompt: string,
): Promise<{ raw: unknown; text: string }> {
  if (pdfBytes.byteLength > MAX_REQUEST_BYTES) {
    throw new Error(`Chunk exceeds 32MB request limit (${pdfBytes.byteLength} bytes)`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from(pdfBytes).toString("base64"),
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Anthropic request failed with status ${response.status}`);
  }

  const text = (payload.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n\n");

  return { raw: payload, text };
}

async function writeOutput(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pdfLib = await loadPdfLib();
  const { PDFDocument } = pdfLib;
  const { input, bytes } = await loadPdfBytes(options.input!);
  const sourcePdf = await PDFDocument.load(bytes);
  const totalPages = sourcePdf.getPageCount();
  const requestedPages = parsePageRanges(options.pages, totalPages);
  const pageChunks = chunkPages(requestedPages, options.chunkSize);
  const chunkResults: PdfChunkResult[] = [];
  const mergedParts: string[] = [];

  for (let index = 0; index < pageChunks.length; index += 1) {
    const pages = pageChunks[index];
    const chunkPdf = await buildChunkPdf(pdfLib, sourcePdf, pages);
    const prompt = [
      options.prompt,
      formatInstruction(options.format),
      `This chunk covers pages ${pages.join(", ")}.`,
      `Chunk ${index + 1} of ${pageChunks.length}.`,
    ].join("\n\n");
    const response = await callAnthropicPdf(chunkPdf, options.model, options.maxTokens, prompt);
    chunkResults.push({
      chunk: index + 1,
      pages,
      response: options.format === "json" ? tryParseJson(response.text) : response.text,
    });
    mergedParts.push(response.text);
  }

  const result: PdfResult = {
    input,
    model: options.model,
    prompt: options.prompt,
    format: options.format,
    totalPages,
    requestedPages,
    chunkSize: options.chunkSize,
    chunks: chunkResults,
    mergedText: mergedParts.join("\n\n"),
  };

  const output = options.text ? `${result.mergedText}\n` : `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    await writeOutput(resolve(options.output), output);
  } else {
    process.stdout.write(output);
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skill-read-pdf: ${message}\n`);
  process.exit(1);
});
