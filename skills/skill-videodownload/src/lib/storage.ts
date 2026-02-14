/**
 * Local storage for configuration and downloads
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getDataDir, getConfigPath, getDownloadsDir } from "../utils/paths.js";
import type { Config, DownloadResult } from "../types/index.js";

const DEFAULT_CONFIG: Config = {
  outputDir: getDownloadsDir(),
  defaultFormat: "best",
  defaultQuality: "best",
  ytDlpPath: "yt-dlp",
};

/**
 * Ensure data directory exists
 */
export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load configuration
 */
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

/**
 * Save configuration
 */
export function saveConfig(config: Partial<Config>): void {
  ensureDataDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2));
}

/**
 * Get config path (re-export)
 */
export { getConfigPath };

/**
 * Ensure output directory exists
 */
export function ensureOutputDir(subdir?: string): string {
  const config = loadConfig();
  const dir = subdir ? join(config.outputDir, subdir) : config.outputDir;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Save download history entry
 */
export function saveDownloadHistory(result: DownloadResult): void {
  ensureDataDir();
  const historyPath = join(getDataDir(), "history.json");

  let history: DownloadResult[] = [];
  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, "utf-8"));
    } catch {
      history = [];
    }
  }

  history.unshift({
    ...result,
    // Add timestamp
    ...({ downloadedAt: new Date().toISOString() } as any),
  });

  // Keep last 100 entries
  history = history.slice(0, 100);

  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Load download history
 */
export function loadDownloadHistory(): DownloadResult[] {
  const historyPath = join(getDataDir(), "history.json");

  if (existsSync(historyPath)) {
    try {
      return JSON.parse(readFileSync(historyPath, "utf-8"));
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * List downloaded files
 */
export function listDownloads(): { filename: string; size: number; modified: Date }[] {
  const config = loadConfig();
  const outputDir = config.outputDir;

  if (!existsSync(outputDir)) {
    return [];
  }

  const files: { filename: string; size: number; modified: Date }[] = [];

  function scanDir(dir: string, prefix = ""): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scanDir(fullPath, relativePath);
      } else if (isVideoFile(entry.name)) {
        const stats = statSync(fullPath);
        files.push({
          filename: relativePath,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }
  }

  scanDir(outputDir);

  // Sort by modified date, newest first
  files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

  return files;
}

/**
 * Check if file is a video
 */
function isVideoFile(filename: string): boolean {
  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".wmv"];
  return videoExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
}
