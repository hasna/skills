/**
 * Config command
 */

import type { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, getConfigPath } from "../lib/storage.js";
import * as logger from "../utils/logger.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("View and edit configuration");

  configCmd
    .command("view")
    .description("View current configuration")
    .option("--json", "Output as JSON")
    .action((options) => {
      const config = loadConfig();
      const hasApiKey = !!process.env.OPENAI_API_KEY;

      if (options.json) {
        console.log(JSON.stringify({ ...config, apiKeyConfigured: hasApiKey }, null, 2));
        return;
      }

      logger.heading("Configuration");
      console.log(`  ${chalk.dim("Config file:")} ${getConfigPath()}`);
      console.log();

      logger.table([
        ["Output directory", config.outputDir],
        ["Default format", config.defaultFormat],
        ["OpenAI API key", hasApiKey ? chalk.green("configured") : chalk.red("not set")],
      ]);
    });

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const validKeys = ["outputDir", "defaultFormat"];

      if (!validKeys.includes(key)) {
        logger.error(`Invalid key: ${key}`);
        process.exit(1);
      }

      saveConfig({ [key]: value });
      logger.success(`Set ${key} = ${value}`);
    });
}
