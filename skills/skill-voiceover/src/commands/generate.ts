import type { Command } from "commander";
import { generateVoiceover } from "../lib/generator.js";
import * as logger from "../utils/logger.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate <text>")
    .alias("g")
    .description("Generate voiceover from text")
    .option("-p, --provider <provider>", "Provider: openai, elevenlabs", "openai")
    .option("-v, --voice <voice>", "Voice ID or name", "alloy")
    .option("-s, --speed <speed>", "Speed (OpenAI only, 0.25-4.0)", "1.0")
    .option("--stability <value>", "Stability (ElevenLabs, 0-1)", "0.5")
    .option("--similarity <value>", "Similarity boost (ElevenLabs, 0-1)", "0.75")
    .action(async (text: string, options) => {
      try {
        const result = await generateVoiceover(text, {
          provider: options.provider,
          voice: options.voice,
          speed: parseFloat(options.speed),
          stability: parseFloat(options.stability),
          similarityBoost: parseFloat(options.similarity),
        });

        logger.heading("Voiceover Generated");
        logger.table([
          ["File", result.filepath],
          ["Provider", result.provider],
          ["Voice", result.voice],
          ["Format", result.format],
        ]);
      } catch (err) {
        logger.error(`Generation failed: ${err}`);
        process.exit(1);
      }
    });
}
