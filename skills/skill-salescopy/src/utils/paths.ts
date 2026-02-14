import { homedir } from "os";
import { join } from "path";

export function getDataDir(): string {
  return join(process.cwd(), "data");
}

export function getSessionsDir(): string {
  return join(getDataDir(), "sessions");
}

export function getTemplatesDir(): string {
  return join(getDataDir(), "templates");
}

export function getConfigPath(): string {
  return join(homedir(), ".config", "service-salescopygenerate", "config.json");
}

export function ensureDir(dir: string): void {
  const fs = require("fs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
