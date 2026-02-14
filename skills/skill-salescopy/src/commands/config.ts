import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { getConfigPath, ensureDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

interface Config {
  defaultModel: string;
  defaultTone: string;
  defaultLength: string;
  defaultCopyType: string;
}

function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {
      defaultModel: "gpt-4o",
      defaultTone: "professional",
      defaultLength: "medium",
      defaultCopyType: "sales-letter",
    };
  }

  const content = readFileSync(configPath, "utf-8");
  return JSON.parse(content) as Config;
}

function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  ensureDir(dirname(configPath));
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View and edit configuration");

  config
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output as JSON")
    .action((options) => {
      const cfg = loadConfig();

      if (options.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }

      logger.header("Configuration");
      logger.label("Config file", getConfigPath());
      console.log();

      logger.label("Default Model", cfg.defaultModel);
      logger.label("Default Tone", cfg.defaultTone);
      logger.label("Default Length", cfg.defaultLength);
      logger.label("Default Copy Type", cfg.defaultCopyType);

      console.log();
      console.log(chalk.bold("Environment:"));
      logger.label(
        "OPENAI_API_KEY",
        process.env.OPENAI_API_KEY ? chalk.green("Set") : chalk.red("Not set")
      );
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key, value) => {
      const cfg = loadConfig();
      const validKeys = [
        "defaultModel",
        "defaultTone",
        "defaultLength",
        "defaultCopyType",
      ];

      if (!validKeys.includes(key)) {
        logger.error(`Invalid config key: ${key}`);
        logger.info(`Valid keys: ${validKeys.join(", ")}`);
        process.exit(1);
      }

      (cfg as unknown as Record<string, string>)[key] = value;
      saveConfig(cfg);
      logger.success(`Set ${key} = ${value}`);
    });

  config
    .command("reset")
    .description("Reset configuration to defaults")
    .action(() => {
      const defaultConfig: Config = {
        defaultModel: "gpt-4o",
        defaultTone: "professional",
        defaultLength: "medium",
        defaultCopyType: "sales-letter",
      };

      saveConfig(defaultConfig);
      logger.success("Configuration reset to defaults");
    });

  config
    .command("path")
    .description("Show configuration file path")
    .action(() => {
      console.log(getConfigPath());
    });
}
