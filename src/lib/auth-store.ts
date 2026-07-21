import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadConfig } from "./config.js";
import { DEFAULT_CLOUD_API_URL, DEFAULT_SELF_HOSTED_API_URL } from "../server/config.js";

const AUTH_DIR = join(homedir(), ".hasna", "skills");
const AUTH_FILE = join(AUTH_DIR, "auth.json");
const LEGACY_AUTH_FILE = join(homedir(), ".skills", "auth.json");

export interface AuthConfig {
  apiKey: string;
  email: string;
  orgId: string;
  orgSlug: string;
  userId: string;
  /** Service origin this credential was issued by. Added in 0.2.0. */
  serviceUrl?: string;
  /** Deployment mode active when the credential was saved. */
  mode?: "local" | "self-hosted" | "cloud";
}

let cachedConfig: AuthConfig | null | undefined;

export function getAuthConfig(): AuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const raw = readFileSync(existsSync(AUTH_FILE) ? AUTH_FILE : LEGACY_AUTH_FILE, "utf-8");
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
  const boundConfig: AuthConfig = {
    ...config,
    serviceUrl: getApiUrl(),
    ...(loadConfig().mode ? { mode: loadConfig().mode } : {}),
  };
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(boundConfig, null, 2) + "\n", { mode: 0o600 });
  cachedConfig = boundConfig;
}

export function clearAuthConfig(): void {
  try { unlinkSync(AUTH_FILE); } catch {}
  try { unlinkSync(LEGACY_AUTH_FILE); } catch {}
  cachedConfig = null;
}

export function getApiKey(): string | null {
  if (process.env.SKILLS_API_KEY) return process.env.SKILLS_API_KEY;
  if (process.env.SKILL_API_KEY) return process.env.SKILL_API_KEY;
  return getAuthConfigForCurrentService()?.apiKey || null;
}

/**
 * Return stored credentials only for the service that issued them.
 * Legacy unbound credentials remain valid for self-hosted compatibility, but
 * must be refreshed before cloud use so they can never leak across origins.
 */
export function getAuthConfigForCurrentService(): AuthConfig | null {
  const config = getAuthConfig();
  if (!config) return null;
  const currentUrl = getApiUrl();
  if (config.serviceUrl) {
    try {
      return normalizeSkillsApiOrigin(config.serviceUrl) === currentUrl ? config : null;
    } catch {
      return null;
    }
  }
  const currentMode = loadConfig().mode;
  if (currentMode === "cloud" || currentUrl === normalizeSkillsApiOrigin(DEFAULT_CLOUD_API_URL)) return null;
  return config;
}

export function normalizeSkillsApiOrigin(apiUrl: string): string {
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
  const config = loadConfig();
  const defaultUrl = config.mode === "cloud" ? DEFAULT_CLOUD_API_URL : DEFAULT_SELF_HOSTED_API_URL;
  return normalizeSkillsApiOrigin(process.env.SKILLS_API_URL || config.apiUrl || defaultUrl);
}
