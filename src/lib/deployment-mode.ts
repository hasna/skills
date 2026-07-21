import { loadConfig, type SkillsConfig } from "./config.js";
import {
  normalizeCloudApiOrigin,
  normalizeSkillsApiOrigin,
} from "./service-origin.js";

export type DeploymentMode = "local" | "self-hosted" | "cloud";

export class DeploymentModeResolutionError extends Error {
  readonly code = "DEPLOYMENT_MODE_REQUIRED";

  constructor(message = "Legacy remote configuration is ambiguous. Select an explicit mode with skills setup --mode local, skills setup --mode self-hosted --api-url <origin>, or skills setup --mode cloud.") {
    super(message);
    this.name = "DeploymentModeResolutionError";
  }
}

export interface DeploymentTarget {
  mode: DeploymentMode;
  apiUrl?: string;
  source: "default" | "config" | "environment";
}

export function getDeploymentSetupCommand(mode: DeploymentMode): string {
  if (mode === "cloud") return "skills setup --mode cloud";
  if (mode === "self-hosted") {
    return "skills setup --mode self-hosted --api-url https://operator.example";
  }
  return "skills setup --mode local";
}

const REMOTE_CREDENTIAL_SIGNALS = [
  "SKILLS_API_KEY",
  "SKILL_API_KEY",
  "SKILLS_TEST_API_KEY",
  "SKILLS_SELF_HOSTED_API_KEY",
  "SKILLS_SELF_HOSTED_API_URL",
] as const;

function parseMode(value: string | undefined): DeploymentMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "local" || normalized === "self-hosted" || normalized === "cloud") return normalized;
  throw new DeploymentModeResolutionError(`Invalid SKILLS_MODE '${value}'. Use local, self-hosted, or cloud.`);
}

function targetFor(
  mode: DeploymentMode,
  apiUrl: string | undefined,
  source: DeploymentTarget["source"],
  env: Record<string, string | undefined>,
): DeploymentTarget {
  if (mode === "local") {
    if (apiUrl?.trim()) {
      throw new DeploymentModeResolutionError("Local mode cannot be combined with a remote Skills API origin.");
    }
    return { mode, source };
  }
  if (mode === "cloud") {
    return { mode, apiUrl: normalizeCloudApiOrigin(apiUrl, env), source };
  }
  if (!apiUrl?.trim()) {
    throw new DeploymentModeResolutionError(
      "Self-hosted mode requires an explicit API origin. Run skills setup --mode self-hosted --api-url <origin>.",
    );
  }
  return { mode, apiUrl: normalizeSkillsApiOrigin(apiUrl, env), source };
}

function sameTarget(left: DeploymentTarget, right: DeploymentTarget): boolean {
  return left.mode === right.mode && left.apiUrl === right.apiUrl;
}

export function resolveDeploymentTarget(
  config: SkillsConfig,
  env: Record<string, string | undefined> = process.env,
): DeploymentTarget {
  const configHasSelection = Boolean(config.mode || config.apiUrl);
  if (!config.mode && config.apiUrl) {
    throw new DeploymentModeResolutionError("A saved API origin without a saved deployment mode is ambiguous.");
  }
  const configTarget = config.mode
    ? targetFor(config.mode, config.apiUrl, "config", env)
    : undefined;

  const envMode = parseMode(env.SKILLS_MODE);
  const envApiUrl = env.SKILLS_API_URL?.trim() || undefined;
  const envHasSelection = Boolean(envMode || envApiUrl);
  if (envHasSelection && !envMode) {
    throw new DeploymentModeResolutionError("SKILLS_API_URL requires an explicit SKILLS_MODE.");
  }
  const envTarget = envMode
    ? targetFor(envMode, envApiUrl, "environment", env)
    : undefined;

  if (configTarget && envTarget && !sameTarget(configTarget, envTarget)) {
    throw new DeploymentModeResolutionError(
      "Environment and saved deployment selections conflict. Set one complete mode and origin tuple, or make both selections identical.",
    );
  }
  if (envTarget) return envTarget;
  if (configTarget) return configTarget;

  if (configHasSelection || REMOTE_CREDENTIAL_SIGNALS.some((name) => Boolean(env[name]?.trim()))) {
    throw new DeploymentModeResolutionError();
  }
  return { mode: "local", source: "default" };
}

export function resolveDeploymentMode(
  config: SkillsConfig,
  env: Record<string, string | undefined> = process.env,
): DeploymentMode {
  return resolveDeploymentTarget(config, env).mode;
}

export function resolveCurrentDeploymentMode(): DeploymentMode {
  return resolveDeploymentMode(loadConfig(), process.env);
}

export function resolveCurrentDeploymentTarget(): DeploymentTarget {
  return resolveDeploymentTarget(loadConfig(), process.env);
}
