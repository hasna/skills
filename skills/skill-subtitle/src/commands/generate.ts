/**
 * Generate command
 */

import type { Command } from "commander";
import { existsSync } from "fs";
import { generateAndSave } from "../lib/generator.js";
import * as logger from "../utils/logger.js";
import { formatDuration } from "../utils/paths.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate <file>")
    .alias("g")
    .description("Generate subtitles from audio/video file")
    .option("-f, --format <format>", "Output format: srt, vtt, ass, json", "srt")
    .option("-l, --language <code>", "Language code (en, es, fr, etc.)")
    .option("--font <name>", "Font name for ASS format", "Arial")
    .option("--font-size <size>", "Font size for ASS format", "20")
    .option("--color <hex>", "Primary color (ASS format)")
    .option("--outline <size>", "Outline size (ASS format)", "2")
    .option("--shadow <size>", "Shadow size (ASS format)", "1")
    .action(async (file: string, options) => {
      try {
        if (!existsSync(file)) {
          logger.error(`File not found: ${file}`);
          process.exit(1);
        }

        if (!process.env.OPENAI_API_KEY) {
          logger.error("OPENAI_API_KEY not set");
          process.exit(1);
        }

        const style = options.format === "ass" ? {
          fontName: options.font,
          fontSize: parseInt(options.fontSize),
          outline: parseInt(options.outline),
          shadow: parseInt(options.shadow),
        } : undefined;

        const { result, outputPath } = await generateAndSave(file, {
          format: options.format,
          language: options.language,
          style,
        });

        logger.heading("Subtitles Generated");
        logger.table([
          ["Output", outputPath],
          ["Format", options.format.toUpperCase()],
          ["Segments", result.segments.length.toString()],
          ["Duration", formatDuration(result.duration)],
          ["Language", result.language || "auto"],
        ]);
      } catch (err) {
        logger.error(`Generation failed: ${err}`);
        process.exit(1);
      }
    });
}
