/**
 * Config command - view and edit configuration
 */

import type { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, getConfigPath } from "../lib/storage.js";
import { checkYtDlp } from "../lib/downloader.js";
import * as logger from "../utils/logger.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("View and edit configuration");

  // View config
  configCmd
    .command("view")
    .description("View current configuration")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = loadConfig();
      const hasYtDlp = await checkYtDlp();

      if (options.json) {
        console.log(JSON.stringify({ ...config, ytDlpInstalled: hasYtDlp }, null, 2));
        return;
      }

      logger.heading("Configuration");
      console.log(`  ${chalk.dim("Config file:")} ${getConfigPath()}`);
      console.log();

      logger.table([
        ["Output directory", config.outputDir],
        ["Default format", config.defaultFormat],
        ["Default quality", config.defaultQuality],
        ["yt-dlp path", config.ytDlpPath],
        ["yt-dlp installed", hasYtDlp ? chalk.green("yes") : chalk.red("no")],
      ]);
    });

  // Set config value
  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const validKeys = ["outputDir", "defaultFormat", "defaultQuality", "ytDlpPath"];

      if (!validKeys.includes(key)) {
        logger.error(`Invalid config key: ${key}`);
        logger.info(`Valid keys: ${validKeys.join(", ")}`);
        process.exit(1);
      }

      saveConfig({ [key]: value });
      logger.success(`Set ${key} = ${value}`);
    });

  // Reset config
  configCmd
    .command("reset")
    .description("Reset configuration to defaults")
    .action(() => {
      saveConfig({
        outputDir: undefined,
        defaultFormat: undefined,
        defaultQuality: undefined,
        ytDlpPath: undefined,
      } as any);
      logger.success("Configuration reset to defaults");
    });

  // Get single config value
  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action((key: string) => {
      const config = loadConfig();
      const value = (config as any)[key];

      if (value === undefined) {
        logger.error(`Unknown config key: ${key}`);
        process.exit(1);
      }

      console.log(value);
    });
}
