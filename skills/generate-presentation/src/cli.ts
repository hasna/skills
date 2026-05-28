import { parseArgs } from "util";
import { join } from "path";
import { envConfig } from "./runtime";
import type { SkillOptions } from "./types";

// Argument Parsing
// ============================================================================

function showHelp(): void {
  console.log(`
generate-presentation - Create professional slide deck presentations using AI

Usage:
  skills run generate-presentation -- "<topic or content>" [options]
  skills run generate-presentation -- ./content.md [options]

Options:
  -h, --help                 Show this help message
  --slides <number>          Number of slides (5-30, default: 10)
  --style <type>             Presentation style:
                             business | educational | pitch-deck | technical | minimal
  --format <type>            Output format: markdown | html | pdf (default: markdown)
  --include-notes            Include speaker notes
  --template <type>          Theme: default | modern | dark | minimal | corporate
  --ai-provider <type>       AI provider: openai | anthropic (default: openai)
  --language <code>          Language code (e.g., en, es, fr)
  --output <path>            Output directory

Examples:
  skills run generate-presentation -- "Introduction to Machine Learning"
  skills run generate-presentation -- "Company Q4 Review" --style business --slides 15
  skills run generate-presentation -- ./outline.md --format pdf --template dark

Requirements:
  Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable.
`);
}

export function parseArguments(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      slides: { type: "string", default: "10" },
      style: { type: "string", default: "business" },
      format: { type: "string", default: "markdown" },
      "include-notes": { type: "string", default: "false" },
      template: { type: "string", default: "default" },
      "ai-provider": { type: "string", default: "openai" },
      output: { type: "string", default: join(envConfig.SKILLS_OUTPUT_DIR, "exports", "generate-presentation") },
      language: { type: "string", default: "en" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const input = positionals[0];
  if (!input) {
    throw new Error("Input is required. Usage: skills run generate-presentation -- \"Your Topic\" or ./file.md");
  }

  // Check if input is a file path
  let isFile = false;
  try {
    // Simple heuristic: if it has a path separator or file extension, treat as file
    isFile = input.includes("/") || input.includes("\\") || input.includes(".");
  } catch (error) {
    isFile = false;
  }

  const slides = parseInt(values.slides as string, 10);
  if (isNaN(slides) || slides < 5 || slides > 30) {
    throw new Error("Slides must be between 5 and 30");
  }

  const style = values.style as string;
  if (!["business", "educational", "pitch-deck", "technical", "minimal"].includes(style)) {
    throw new Error("Style must be: business, educational, pitch-deck, technical, or minimal");
  }

  const format = values.format as string;
  if (!["markdown", "html", "pdf"].includes(format)) {
    throw new Error("Format must be: markdown, html, or pdf");
  }

  const template = values.template as string;
  if (!["default", "modern", "dark", "minimal", "corporate"].includes(template)) {
    throw new Error("Template must be: default, modern, dark, minimal, or corporate");
  }

  const aiProvider = values["ai-provider"] as string;
  if (!["openai", "anthropic"].includes(aiProvider)) {
    throw new Error("AI provider must be: openai or anthropic");
  }

  return {
    input,
    isFile,
    slides,
    style: style as any,
    format: format as any,
    includeNotes: values["include-notes"] === "true",
    template: template as any,
    aiProvider: aiProvider as any,
    output: values.output as string,
    language: values.language as string,
  };
}

// ============================================================================
// Validation
// ============================================================================

export function validateEnvironment(options: SkillOptions): void {
  if (options.aiProvider === "openai" && !envConfig.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI provider");
  }

  if (options.aiProvider === "anthropic" && !envConfig.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required for Anthropic provider");
  }
}
