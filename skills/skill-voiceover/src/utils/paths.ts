import { homedir } from "os";
import { join } from "path";

export function getDataDir(): string {
  return process.env.DATA_DIR || join(homedir(), ".service", "service-voiceovergenerate");
}

export function getOutputDir(): string {
  return join(getDataDir(), "output");
}

export function getConfigPath(): string {
  return join(getDataDir(), "config.json");
}

export function sanitizeFilename(text: string): string {
  return text
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
