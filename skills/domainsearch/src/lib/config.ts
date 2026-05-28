import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  apiKey?: string;
  apiSecret?: string;
  customerId?: string;
  apiUrl: string;
}

const CONFIG_DIR = join(homedir(), ".config", "service-domainsearch");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  apiUrl: "https://api.godaddy.com",
};

export function loadConfig(): Config {
  // First check environment variables
  const envConfig: Partial<Config> = {
    apiKey: process.env.DOMAIN_API_KEY,
    apiSecret: process.env.DOMAIN_API_SECRET,
    customerId: process.env.DOMAIN_CUSTOMER_ID,
    apiUrl: process.env.DOMAIN_API_URL,
  };

  // Then load from config file
  let fileConfig: Partial<Config> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      // Ignore parse errors
    }
  }

  // Merge with defaults (env vars take priority)
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([_, v]) => v !== undefined)
    ),
  };
}

export function saveConfig(config: Partial<Config>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function getApiKey(): string | undefined {
  return loadConfig().apiKey;
}

export function getApiSecret(): string | undefined {
  return loadConfig().apiSecret;
}

export function getCustomerId(): string | undefined {
  return loadConfig().customerId;
}

export function getApiUrl(): string {
  return loadConfig().apiUrl;
}
