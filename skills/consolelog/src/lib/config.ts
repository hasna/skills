import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Config } from "./types";

const CONFIG_FILE = join(homedir(), ".consolelog.json");

const DEFAULT_CONFIG: Config = {
  databasePath: "./data/service_consolelog.db",
  headless: true,
  defaultTimeout: 30000,
  watchInterval: 300000, // 5 minutes
  logLevel: "info",
};

export function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(content);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error("Failed to load config file, using defaults");
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...config };

  try {
    const dir = dirname(CONFIG_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error("Failed to save config file:", error);
    throw error;
  }

  return updated;
}

export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue<K extends keyof Config>(
  key: K,
  value: Config[K]
): Config {
  return saveConfig({ [key]: value });
}

export function resetConfig(): Config {
  return saveConfig(DEFAULT_CONFIG);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

// Environment-aware config getters
export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || loadConfig().databasePath;
}

export function isHeadless(): boolean {
  if (process.env.HEADLESS !== undefined) {
    return process.env.HEADLESS === "true";
  }
  return loadConfig().headless;
}

export function getDefaultTimeout(): number {
  if (process.env.DEFAULT_TIMEOUT !== undefined) {
    return parseInt(process.env.DEFAULT_TIMEOUT, 10);
  }
  return loadConfig().defaultTimeout;
}

export function getWatchInterval(): number {
  if (process.env.WATCH_INTERVAL !== undefined) {
    return parseInt(process.env.WATCH_INTERVAL, 10);
  }
  return loadConfig().watchInterval;
}

export function getLogLevel(): Config["logLevel"] {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && ["debug", "info", "warn", "error"].includes(envLevel)) {
    return envLevel as Config["logLevel"];
  }
  return loadConfig().logLevel;
}

export function getServerPort(): number {
  if (process.env.PORT !== undefined) {
    return parseInt(process.env.PORT, 10);
  }
  return 3100;
}
