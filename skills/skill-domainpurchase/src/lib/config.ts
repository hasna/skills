import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  apiKey?: string;
  apiSecret?: string;
  customerId?: string;
  shopperId?: string;
  apiUrl: string;
  // Remote server configuration
  useRemoteServer?: boolean;
  remoteServerUrl: string;
  remoteApiKey?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "service-domainpurchase");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const AWS_SECRET_NAME = process.env.AWS_SECRET_NAME || "your-org/tool/brandsight/api/live";

const DEFAULT_CONFIG: Config = {
  apiUrl: "https://api.godaddy.com",
  remoteServerUrl: process.env.DOMAIN_REMOTE_SERVER_URL || "https://service.example.com/domainpurchase",
  useRemoteServer: false,
};

// Cache for AWS secrets to avoid repeated API calls
let awsSecretsCache: Partial<Config> | null = null;

async function loadAwsSecrets(): Promise<Partial<Config>> {
  if (awsSecretsCache) {
    return awsSecretsCache;
  }

  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({ region: "us-east-1" });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: AWS_SECRET_NAME })
    );

    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      awsSecretsCache = {
        apiKey: secret.api_key,
        apiSecret: secret.api_secret,
        customerId: secret.customer_id,
        shopperId: secret.shopper_id,
      };
      return awsSecretsCache;
    }
  } catch {
    // AWS secrets not available, fall back to other sources
  }

  return {};
}

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

export async function loadConfigAsync(): Promise<Config> {
  // Load AWS secrets first (lowest priority)
  const awsConfig = await loadAwsSecrets();

  // Then check environment variables
  const envConfig: Partial<Config> = {
    apiKey: process.env.DOMAIN_API_KEY,
    apiSecret: process.env.DOMAIN_API_SECRET,
    customerId: process.env.DOMAIN_CUSTOMER_ID,
    apiUrl: process.env.DOMAIN_API_URL,
    useRemoteServer: process.env.DOMAIN_USE_REMOTE_SERVER === "true",
    remoteServerUrl: process.env.DOMAIN_REMOTE_SERVER_URL,
    remoteApiKey: process.env.DOMAIN_REMOTE_API_KEY,
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

  // Merge: AWS -> file -> env (env takes highest priority)
  return {
    ...DEFAULT_CONFIG,
    ...awsConfig,
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

// Async versions that can load from AWS Secrets Manager
export async function getApiKeyAsync(): Promise<string | undefined> {
  return (await loadConfigAsync()).apiKey;
}

export async function getApiSecretAsync(): Promise<string | undefined> {
  return (await loadConfigAsync()).apiSecret;
}

export async function getCustomerIdAsync(): Promise<string | undefined> {
  return (await loadConfigAsync()).customerId;
}

export async function getShopperIdAsync(): Promise<string | undefined> {
  return (await loadConfigAsync()).shopperId;
}

export async function getApiUrlAsync(): Promise<string> {
  return (await loadConfigAsync()).apiUrl;
}

// Remote server configuration getters
export function useRemoteServer(): boolean {
  return loadConfig().useRemoteServer || false;
}

export function getRemoteServerUrl(): string {
  return loadConfig().remoteServerUrl;
}

export function getRemoteApiKey(): string | undefined {
  return loadConfig().remoteApiKey;
}

export async function getRemoteApiKeyAsync(): Promise<string | undefined> {
  const config = await loadConfigAsync();
  if (config.remoteApiKey) {
    return config.remoteApiKey;
  }
  // Try to load from AWS Secrets Manager
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({ region: "us-east-1" });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: process.env.DOMAIN_API_KEY_SECRET_ID || "your-org/prod/service/domainpurchase/api-key" })
    );
    return response.SecretString;
  } catch {
    return undefined;
  }
}

// Initialize config from AWS on first run
export async function initConfig(): Promise<void> {
  await loadConfigAsync();
}
