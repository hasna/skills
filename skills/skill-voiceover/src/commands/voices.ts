import type { Command } from "commander";
import chalk from "chalk";
import { listVoices } from "../lib/generator.js";
import * as logger from "../utils/logger.js";

export function registerVoicesCommand(program: Command): void {
  program
    .command("voices [provider]")
    .description("List available voices")
    .option("--json", "Output as JSON")
    .action(async (provider: string = "openai", options) => {
      try {
        const voices = await listVoices(provider as any);

        if (options.json) {
          console.log(JSON.stringify(voices, null, 2));
          return;
        }

        logger.heading(`${provider} Voices`);

        for (const voice of voices) {
          console.log(`  ${chalk.cyan(voice.id.padEnd(30))} ${voice.name}`);
        }

        console.log();
        logger.info(`${voices.length} voice(s) available`);
      } catch (err) {
        logger.error(`Failed to list voices: ${err}`);
        process.exit(1);
      }
    });
}
