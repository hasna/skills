#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, extname, resolve } from "path";

const VERSION = "0.1.0";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const DEFAULT_PROMPT =
  "Describe this image in detail. Extract any visible text, call out objects, layout, branding, and anything notable.";
const API_URL = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";

interface CliOptions {
  input?: string;
  prompt: string;
  model: string;
  maxTokens: number;
  output?: string;
  text: boolean;
}

interface ImageAnalysisResult {
  input: string;
  sourceType: "file" | "url";
  model: string;
  prompt: string;
  analysis: string;
  stopReason: string | null;
  usage: unknown;
}

function printHelp(): void {
  console.log(`skill-read-image v${VERSION}

USAGE:
  skill-read-image --input <path-or-url> [options]

OPTIONS:
  -i, --input <path-or-url>  Local image path or remote URL
  -p, --prompt <text>        Extraction or analysis prompt
  -m, --model <name>         Anthropic model to call
      --max-tokens <n>       Maximum response tokens
  -o, --output <path>        Save result to a file
      --text                 Print only Claude's text response
      --help                 Show this help message
      --version              Show the current version
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    maxTokens: 1200,
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
      case "--prompt":
      case "-p":
        options.prompt = argv[++i] ?? DEFAULT_PROMPT;
        break;
      case "--model":
      case "-m":
        options.model = argv[++i] ?? DEFAULT_MODEL;
        break;
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

function getImageMediaType(value: string): string {
  const extension = extname(value).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`Unsupported image format: ${extension || value}`);
  }
}

async function buildImageBlock(input: string): Promise<{ block: Record<string, unknown>; sourceType: "file" | "url"; resolvedInput: string }> {
  if (isUrl(input)) {
    return {
      block: {
        type: "image",
        source: {
          type: "url",
          url: input,
        },
      },
      sourceType: "url",
      resolvedInput: input,
    };
  }

  const resolvedInput = resolve(input);
  const mediaType = getImageMediaType(resolvedInput);
  const bytes = await readFile(resolvedInput);
  return {
    block: {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: Buffer.from(bytes).toString("base64"),
      },
    },
    sourceType: "file",
    resolvedInput,
  };
}

async function callAnthropic(
  model: string,
  maxTokens: number,
  prompt: string,
  imageBlock: Record<string, unknown>,
): Promise<{ analysis: string; usage: unknown; stopReason: string | null }> {
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
            imageBlock,
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
    usage?: unknown;
    stop_reason?: string | null;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Anthropic request failed with status ${response.status}`);
  }

  const analysis = (payload.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n\n");

  return {
    analysis,
    usage: payload.usage ?? null,
    stopReason: payload.stop_reason ?? null,
  };
}

async function writeOutput(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { block, sourceType, resolvedInput } = await buildImageBlock(options.input!);
  const response = await callAnthropic(options.model, options.maxTokens, options.prompt, block);

  const result: ImageAnalysisResult = {
    input: resolvedInput,
    sourceType,
    model: options.model,
    prompt: options.prompt,
    analysis: response.analysis,
    stopReason: response.stopReason,
    usage: response.usage,
  };

  const output = options.text ? `${response.analysis}\n` : `${JSON.stringify(result, null, 2)}\n`;

  if (options.output) {
    await writeOutput(resolve(options.output), output);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skill-read-image: ${message}\n`);
  process.exit(1);
});
