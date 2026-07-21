import { loadConfig, type SkillsConfig } from "./config.js";

export type DeploymentMode = "local" | "self-hosted" | "cloud";

export class DeploymentModeResolutionError extends Error {
  readonly code = "DEPLOYMENT_MODE_REQUIRED";

  constructor() {
    super("Legacy remote configuration is ambiguous. Select an explicit mode with skills setup --mode local, skills setup --mode self-hosted, or skills setup --mode cloud.");
    this.name = "DeploymentModeResolutionError";
  }
}

export function resolveDeploymentMode(
  config: SkillsConfig,
  env: Record<string, string | undefined> = process.env,
): DeploymentMode {
  if (config.mode) return config.mode;
  const envMode = env.SKILLS_MODE?.trim().toLowerCase();
  if (envMode) {
    if (envMode === "local" || envMode === "self-hosted" || envMode === "cloud") return envMode;
    throw new DeploymentModeResolutionError();
  }
  if (config.apiUrl || env.SKILLS_API_URL || env.SKILLS_API_KEY || env.SKILL_API_KEY) {
    throw new DeploymentModeResolutionError();
  }
  return "local";
}

export function resolveCurrentDeploymentMode(): DeploymentMode {
  return resolveDeploymentMode(loadConfig(), process.env);
}
