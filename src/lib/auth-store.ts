import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AUTH_DIR = join(homedir(), ".skills");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export interface AuthConfig {
  apiKey: string;
  email: string;
  orgId: string;
  orgSlug: string;
  userId: string;
}

let cachedConfig: AuthConfig | null | undefined;

export function getAuthConfig(): AuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const raw = readFileSync(AUTH_FILE, "utf-8");
    const config = JSON.parse(raw) as AuthConfig;
    if (!config.apiKey || !config.email) {
      cachedConfig = null;
      return null;
    }
    cachedConfig = config;
    return config;
  } catch {
    cachedConfig = null;
    return null;
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  cachedConfig = config;
}

export function clearAuthConfig(): void {
  try { unlinkSync(AUTH_FILE); } catch {}
  cachedConfig = null;
}

export function getApiKey(): string | null {
  if (process.env.SKILLS_API_KEY) return process.env.SKILLS_API_KEY;
  return getAuthConfig()?.apiKey || null;
}

export function normalizePlatformApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    url.pathname = "/";
  } else if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
  } else if (pathname.endsWith("/api")) {
    url.pathname = pathname.slice(0, -"/api".length) || "/";
  }
  return url.toString().replace(/\/+$/, "");
}

export function getApiUrl(): string {
  return normalizePlatformApiOrigin(process.env.SKILLS_API_URL || "https://skills.md");
}
