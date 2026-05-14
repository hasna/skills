import { existsSync, readdirSync } from "fs";
import { extname, join, resolve } from "path";
import { parseArgs } from "util";
import { SUPPORTED_EXTENSIONS } from "./file-utils";
import type { Options } from "./types";

export function parseArguments(): Options {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: { type: "string", default: "json" },
      confidence: { type: "boolean", default: false },
      currency: { type: "string" },
      language: { type: "string" },
      pages: { type: "string" },
      batch: { type: "boolean", default: false },
      output: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const files: string[] = [];
  for (const arg of positionals) {
    if (arg.includes("*")) {
      files.push(...expandGlob(arg));
    } else {
      files.push(resolve(process.cwd(), arg));
    }
  }

  return {
    files,
    format: values.format as Options["format"],
    confidence: values.confidence as boolean,
    currency: values.currency as string,
    language: values.language as string,
    pages: values.pages as string,
    batch: values.batch as boolean,
    output: values.output as string,
    verbose: values.verbose as boolean,
  };
}

function expandGlob(pattern: string): string[] {
  const dir = pattern.includes("/") ? pattern.substring(0, pattern.lastIndexOf("/")) : ".";
  const filePattern = pattern.includes("/") ? pattern.substring(pattern.lastIndexOf("/") + 1) : pattern;
  const regex = new RegExp("^" + filePattern.replace(/\*/g, ".*") + "$");

  const resolvedDir = resolve(process.cwd(), dir);
  if (!existsSync(resolvedDir)) {
    return [];
  }

  return readdirSync(resolvedDir)
    .filter((file) => regex.test(file))
    .map((file) => join(resolvedDir, file))
    .filter((file) => SUPPORTED_EXTENSIONS.includes(extname(file).toLowerCase()));
}

function printHelp(): void {
  console.log(`
Extract Invoice - AI-powered invoice data extraction

Usage:
  skills run extract-invoice -- <file(s)> [options]

Arguments:
  file(s)               Invoice file(s) to process (PDF, PNG, JPG, etc.)

Options:
  --format <format>     Output format: json, csv, excel, markdown (default: json)
  --confidence          Include confidence scores for extracted fields
  --currency <code>     Convert totals to specified currency (e.g., USD, EUR)
  --language <lang>     Document language hint (e.g., en, es, fr)
  --pages <range>       Pages to process (e.g., "1-3,5")
  --batch               Process multiple files and combine output
  --output <file>       Output file path
  --verbose             Show detailed progress
  --help, -h            Show this help

Examples:
  skills run extract-invoice -- invoice.pdf
  skills run extract-invoice -- receipt.jpg --format csv
  skills run extract-invoice -- ./invoices/*.pdf --batch
  skills run extract-invoice -- invoice.pdf --confidence --verbose

Supported file types:
  PDF, PNG, JPG, JPEG, TIFF, HEIC, WebP
`);
}
