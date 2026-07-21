import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadConfig, type SkillsConfig } from "./config.js";
import { resolveDeploymentTarget, type DeploymentTarget } from "./deployment-mode.js";
import {
  isExplicitInsecureLoopbackEnabled,
  isLoopbackOrigin,
  normalizeSkillsApiOrigin,
} from "./service-origin.js";

export { normalizeSkillsApiOrigin } from "./service-origin.js";

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
  /** Explicitly non-production credential classification for loopback profiles. */
  credentialKind?: "service" | "test";
}

export class SkillsEnvironmentCredentialError extends Error {
  readonly code = "SKILLS_ENV_CREDENTIAL_BINDING_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SkillsEnvironmentCredentialError";
  }
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
  const target = resolveDeploymentTarget(loadConfig(), process.env);
  if (target.mode === "local" || !target.apiUrl) {
    throw new Error("Remote authentication requires a selected cloud or self-hosted service.");
  }
  const boundConfig: AuthConfig = {
    ...config,
    serviceUrl: target.apiUrl,
    mode: target.mode,
    credentialKind: isLoopbackOrigin(target.apiUrl) ? "test" : "service",
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

function trimmed(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function resolveEnvironmentApiKey(
  target: DeploymentTarget,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const genericKey = trimmed(env.SKILLS_API_KEY) || trimmed(env.SKILL_API_KEY);
  const selfHostedKey = trimmed(env.SKILLS_SELF_HOSTED_API_KEY);
  const selfHostedUrl = trimmed(env.SKILLS_SELF_HOSTED_API_URL);
  const testKey = trimmed(env.SKILLS_TEST_API_KEY);
  const testUrl = trimmed(env.SKILLS_TEST_API_URL);

  if (target.mode === "local") {
    if (genericKey || selfHostedKey || selfHostedUrl || testKey || testUrl) {
      throw new SkillsEnvironmentCredentialError("Remote API credentials cannot be used in local mode.");
    }
    return null;
  }

  if (!target.apiUrl) return null;
  const loopback = isLoopbackOrigin(target.apiUrl);
  if (loopback) {
    if (genericKey || selfHostedKey) {
      throw new SkillsEnvironmentCredentialError(
        "Production or generic API credentials are never accepted for a loopback service.",
      );
    }
    if (!testKey && !testUrl) return null;
    if (!testKey || !testUrl || !isExplicitInsecureLoopbackEnabled(env)) {
      throw new SkillsEnvironmentCredentialError(
        "Loopback authentication requires SKILLS_TEST_API_KEY and matching SKILLS_TEST_API_URL in an explicitly enabled test or preview profile.",
      );
    }
    const boundTestUrl = normalizeSkillsApiOrigin(testUrl, env);
    if (boundTestUrl !== target.apiUrl) {
      throw new SkillsEnvironmentCredentialError("SKILLS_TEST_API_URL does not match the selected service origin.");
    }
    return testKey;
  }

  if (testKey || testUrl) {
    throw new SkillsEnvironmentCredentialError("Test credentials are accepted only for an explicitly enabled loopback profile.");
  }

  if (target.mode === "cloud") {
    if (selfHostedKey || selfHostedUrl) {
      throw new SkillsEnvironmentCredentialError("Self-hosted credentials cannot be used with Skills cloud.");
    }
    return genericKey;
  }

  if (genericKey) {
    throw new SkillsEnvironmentCredentialError(
      "SKILLS_API_KEY is a legacy cloud-only input. Self-hosted automation requires SKILLS_SELF_HOSTED_API_KEY and matching SKILLS_SELF_HOSTED_API_URL.",
    );
  }
  if (!selfHostedKey && !selfHostedUrl) return null;
  if (!selfHostedKey || !selfHostedUrl) {
    throw new SkillsEnvironmentCredentialError(
      "Self-hosted environment authentication requires both SKILLS_SELF_HOSTED_API_KEY and SKILLS_SELF_HOSTED_API_URL.",
    );
  }
  const boundUrl = normalizeSkillsApiOrigin(selfHostedUrl, env);
  if (boundUrl !== target.apiUrl) {
    throw new SkillsEnvironmentCredentialError("SKILLS_SELF_HOSTED_API_URL does not match the selected self-hosted service origin.");
  }
  return selfHostedKey;
}

export function getEnvironmentApiKey(
  env: Record<string, string | undefined> = process.env,
  config: SkillsConfig = loadConfig(),
): string | null {
  return resolveEnvironmentApiKey(resolveDeploymentTarget(config, env), env);
}

export function getApiKey(): string | null {
  const target = resolveDeploymentTarget(loadConfig(), process.env);
  return resolveEnvironmentApiKey(target, process.env) || getAuthConfigForTarget(target)?.apiKey || null;
}

/**
 * Return stored credentials only for the service that issued them.
 * Legacy unbound credentials remain readable through getAuthConfig() for local
 * metadata and migration UX, but are never returned by this network-auth
 * selector. Re-authentication verifies and binds them before remote reuse.
 */
function getAuthConfigForTarget(target: DeploymentTarget): AuthConfig | null {
  const config = getAuthConfig();
  if (!config || target.mode === "local" || !target.apiUrl) return null;
  if (config.mode && config.mode !== target.mode) return null;
  if (!config.serviceUrl) return null;
  try {
    if (normalizeSkillsApiOrigin(config.serviceUrl, process.env) !== target.apiUrl) return null;
    if (isLoopbackOrigin(target.apiUrl)) {
      return config.credentialKind === "test" && isExplicitInsecureLoopbackEnabled(process.env) ? config : null;
    }
    return config.credentialKind === "test" ? null : config;
  } catch {
    return null;
  }
}

export function getAuthConfigForCurrentService(): AuthConfig | null {
  return getAuthConfigForTarget(resolveDeploymentTarget(loadConfig(), process.env));
}

export function getApiUrl(): string {
  const target = resolveDeploymentTarget(loadConfig(), process.env);
  if (target.mode === "local" || !target.apiUrl) {
    throw new Error("No remote Skills service is selected.");
  }
  return target.apiUrl;
}
