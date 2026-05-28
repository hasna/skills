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
      const hasApiKey = !!(config.firecrawlApiKey || process.env.FIRECRAWL_API_KEY);

      if (options.json) {
        console.log(JSON.stringify({ ...config, hasApiKey }, null, 2));
        return;
      }

      logger.heading("Configuration");
      logger.table([
        ["Output directory", config.outputDir],
        ["Firecrawl API key", hasApiKey ? chalk.green("configured") : chalk.red("not set")],
      ]);
    });

  configCmd
    .command("set <key> <value>")
    .action((key: string, value: string) => {
      saveConfig({ [key]: value });
      logger.success(`Set ${key} = ${key.includes("Key") ? "***" : value}`);
    });
}
