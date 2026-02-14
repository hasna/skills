import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir, getConfigPath, getOutputDir } from "../utils/paths.js";
import type { Config } from "../types/index.js";

const DEFAULT_CONFIG: Config = {
  outputDir: getOutputDir(),
  defaultProvider: "openai",
  defaultVoice: "alloy",
};

export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureDataDir();
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, "utf-8")) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: Partial<Config>): void {
  ensureDataDir();
  const current = loadConfig();
  writeFileSync(getConfigPath(), JSON.stringify({ ...current, ...config }, null, 2));
}

export { getConfigPath };

export function ensureOutputDir(): string {
  const config = loadConfig();
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }
  return config.outputDir;
}

export function saveAudio(filename: string, data: Buffer | Uint8Array): string {
  const outputDir = ensureOutputDir();
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, data);
  return outputPath;
}
