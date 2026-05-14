#!/usr/bin/env bun

/**
 * Generate Presentation Skill
 *
 * Creates professional slide deck presentations from topics or content using AI.
 * Generates Marp-compatible markdown with speaker notes.
 */

import { parseArguments, validateEnvironment } from "./cli";
import { Logger } from "./logger";
import { PresentationGenerator } from "./presentation-generator";

async function main() {
  const logger = new Logger();

  try {
    console.log("🎨 Generate Presentation - Starting...\n");

    const options = parseArguments();
    validateEnvironment(options);

    const generator = new PresentationGenerator(options, logger);
    await generator.generate();

    console.log("\n✅ Done!");
    process.exit(0);
  } catch (error) {
    await logger.error(error instanceof Error ? error.message : String(error));
    console.error("\nUsage: skills run generate-presentation -- \"Your Topic\" [options]");
    console.error("       skills run generate-presentation -- ./content.md [options]");
    console.error("\nOptions:");
    console.error("  --slides <number>        Number of slides (5-30, default: 10)");
    console.error("  --style <type>           Style: business, educational, pitch-deck, technical, minimal");
    console.error("  --format <type>          Format: markdown, html, pdf");
    console.error("  --include-notes          Include speaker notes");
    console.error("  --template <type>        Template: default, modern, dark, minimal, corporate");
    console.error("  --ai-provider <type>     Provider: openai, anthropic");
    console.error("  --language <code>        Language code (e.g., en, es, fr)");
    process.exit(1);
  }
}

main();
