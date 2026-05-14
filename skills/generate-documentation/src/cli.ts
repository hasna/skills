import { parseArgs } from "util";
import { log } from "./runtime";
import type { ApiProvider, DocFormat, GenerateOptions, OutputMode } from "./types";

export function parseGenerateOptions(): GenerateOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      format: { type: "string", default: "auto" },
      output: { type: "string", default: "inline" },
      "include-examples": { type: "boolean", default: false },
      update: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "api-provider": { type: "string", default: "anthropic" },
      model: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Generate Documentation - AI-powered code documentation generator

Usage:
  skills run generate-documentation -- <file-or-directory> [options]

Options:
  --format <format>           Documentation format (jsdoc, tsdoc, python, auto) [default: auto]
  --output <mode>             Output mode: "inline" or file path for markdown [default: inline]
  --include-examples          Generate usage examples [default: false]
  --update                    Update existing documentation [default: false]
  --verbose                   Show detailed analysis [default: false]
  --api-provider <provider>   AI provider (anthropic, openai) [default: anthropic]
  --model <model>             AI model to use [default: provider default]
  --help, -h                  Show this help

Examples:
  # Single file with inline documentation
  skills run generate-documentation -- ./src/utils.ts

  # Directory with examples
  skills run generate-documentation -- ./src --include-examples

  # Generate markdown output
  skills run generate-documentation -- ./lib --output ./docs/api.md

  # Python with specific provider
  skills run generate-documentation -- ./app.py --format python --api-provider openai
`);
    process.exit(0);
  }

  const targetPath = positionals[0];

  if (!targetPath) {
    log("Please provide a file or directory path", "error");
    process.exit(1);
  }

  return {
    path: targetPath,
    format: values.format as DocFormat,
    output: values.output as OutputMode,
    includeExamples: values["include-examples"] as boolean,
    update: values.update as boolean,
    verbose: values.verbose as boolean,
    apiProvider: values["api-provider"] as ApiProvider,
    model: values.model as string | undefined,
  };
}
