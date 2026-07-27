import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { requireApiUrl } from "./api-url.js";

const AUTH_DIR = join(homedir(), ".hasna", "skills");
const AUTH_FILE = join(AUTH_DIR, "auth.json");
const LEGACY_AUTH_FILE = join(homedir(), ".skills", "auth.json");

/**
 * Stored credentials for a Skills API instance.
 *
 * `apiKey` is the only credential. The identity fields are display metadata
 * echoed back from the instance's `whoami`, so they are optional: an instance
 * that does not return them leaves them unset. They are never invented locally
 * — a placeholder written here is indistinguishable from a value the server
 * actually returned once it is read back out of `auth.json`.
 */
export interface AuthConfig {
  apiKey: string;
  email?: string;
  orgId?: string;
  orgSlug?: string;
  userId?: string;
}

let cachedConfig: AuthConfig | null | undefined;

export function getAuthConfig(): AuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const raw = readFileSync(existsSync(AUTH_FILE) ? AUTH_FILE : LEGACY_AUTH_FILE, "utf-8");
    const config = JSON.parse(raw) as AuthConfig;
    if (!config.apiKey) {
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
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  cachedConfig = config;
}

export function clearAuthConfig(): void {
  try { unlinkSync(AUTH_FILE); } catch {}
  try { unlinkSync(LEGACY_AUTH_FILE); } catch {}
  cachedConfig = null;
}

export function getApiKey(): string | null {
  if (process.env.SKILLS_API_KEY) return process.env.SKILLS_API_KEY;
  if (process.env.SKILL_API_KEY) return process.env.SKILL_API_KEY;
  return getAuthConfig()?.apiKey || null;
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

/**
 * Origin every credential-bearing request is sent to.
 *
 * Throws `MissingApiUrlError` when the install has not been pointed at an
 * instance. There is no fallback endpoint: an unconfigured CLI must not decide
 * on the user's behalf where their email address, login code, or API key goes.
 */
export function getApiUrl(action?: string): string {
  return normalizeSkillsApiOrigin(requireApiUrl(action));
}
