import { homedir } from "os";
import { join } from "path";

export function getDataDir(): string {
  return process.env.DATA_DIR || join(homedir(), ".service", "service-webcrawling");
}

export function getSessionsDir(): string {
  return join(getDataDir(), "sessions");
}

export function getConfigPath(): string {
  return join(getDataDir(), "config.json");
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function generateSessionId(): string {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 8);
  return `${date}_${random}`;
}
