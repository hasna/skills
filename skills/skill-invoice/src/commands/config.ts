import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { getConfigPath, ensureDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { checkApiHealth } from "../lib/api.js";

interface Config {
  defaultCurrency: string;
  defaultVatRate: number;
  defaultPaymentTerms: number;
  apiBaseUrl: string;
}

function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {
      defaultCurrency: "EUR",
      defaultVatRate: 19,
      defaultPaymentTerms: 30,
      apiBaseUrl: "http://localhost:8007/api/v1",
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
    .action(async (options) => {
      const cfg = loadConfig();

      if (options.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }

      logger.header("Configuration");
      logger.label("Config file", getConfigPath());
      console.log();

      logger.label("Default Currency", cfg.defaultCurrency);
      logger.label("Default VAT Rate", `${cfg.defaultVatRate}%`);
      logger.label("Default Payment Terms", `${cfg.defaultPaymentTerms} days`);
      logger.label("API Base URL", cfg.apiBaseUrl);

      console.log();
      console.log(chalk.bold("API Status:"));
      const apiHealthy = await checkApiHealth();
      logger.label(
        "  Connection",
        apiHealthy ? chalk.green("Connected") : chalk.red("Not available")
      );
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key, value) => {
      const cfg = loadConfig();
      const validKeys = [
        "defaultCurrency",
        "defaultVatRate",
        "defaultPaymentTerms",
        "apiBaseUrl",
      ];

      if (!validKeys.includes(key)) {
        logger.error(`Invalid config key: ${key}`);
        logger.info(`Valid keys: ${validKeys.join(", ")}`);
        process.exit(1);
      }

      if (key === "defaultVatRate" || key === "defaultPaymentTerms") {
        (cfg as unknown as Record<string, number>)[key] = parseFloat(value);
      } else {
        (cfg as unknown as Record<string, string>)[key] = value;
      }

      saveConfig(cfg);
      logger.success(`Set ${key} = ${value}`);
    });

  config
    .command("reset")
    .description("Reset configuration to defaults")
    .action(() => {
      const defaultConfig: Config = {
        defaultCurrency: "EUR",
        defaultVatRate: 19,
        defaultPaymentTerms: 30,
        apiBaseUrl: "http://localhost:8007/api/v1",
      };

      saveConfig(defaultConfig);
      logger.success("Configuration reset to defaults");
    });

  config
    .command("test")
    .description("Test API connection")
    .action(async () => {
      logger.info("Testing API connection...");

      const healthy = await checkApiHealth();

      if (healthy) {
        logger.success("API connection successful");
      } else {
        logger.error("API connection failed");
        logger.info("Make sure the API service is running:");
        logger.info("  docker-compose up -d");
      }
    });
}
