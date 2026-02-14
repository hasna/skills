import type { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, getConfigPath } from "../lib/storage.js";
import * as logger from "../utils/logger.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command("config").description("View and edit configuration");

  configCmd
    .command("view")
    .option("--json", "Output as JSON")
    .action((options) => {
      const config = loadConfig();
      const hasOpenAI = !!process.env.OPENAI_API_KEY;
      const hasElevenLabs = !!(config.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY);

      if (options.json) {
        console.log(JSON.stringify({ ...config, hasOpenAI, hasElevenLabs }, null, 2));
        return;
      }

      logger.heading("Configuration");
      logger.table([
        ["Output directory", config.outputDir],
        ["Default provider", config.defaultProvider],
        ["Default voice", config.defaultVoice],
        ["OpenAI API key", hasOpenAI ? chalk.green("configured") : chalk.red("not set")],
        ["ElevenLabs API key", hasElevenLabs ? chalk.green("configured") : chalk.red("not set")],
      ]);
    });

  configCmd
    .command("set <key> <value>")
    .action((key: string, value: string) => {
      saveConfig({ [key]: value });
      logger.success(`Set ${key} = ${key.includes("Key") ? "***" : value}`);
    });
}
