/**
 * Local storage for configuration
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir, getConfigPath, getOutputDir } from "../utils/paths.js";
import type { Config, SubtitleStyle } from "../types/index.js";
import { DEFAULT_STYLE } from "../types/index.js";

const DEFAULT_CONFIG: Config = {
  outputDir: getOutputDir(),
  defaultFormat: "srt",
  defaultStyle: DEFAULT_STYLE,
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
      const data = readFileSync(configPath, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: Partial<Config>): void {
  ensureDataDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2));
}

export { getConfigPath };

export function ensureOutputDir(): string {
  const config = loadConfig();
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }
  return config.outputDir;
}

export function saveSubtitle(filename: string, content: string): string {
  const outputDir = ensureOutputDir();
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, content);
  return outputPath;
}
