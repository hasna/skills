/**
 * Config file support for Open Skills
 *
 * Loads configuration from:
 *   1. Project-local: ./skills.config.json (highest priority)
 *   2. Global: ~/.hasna/skills/config.json (JSON format, lowest priority)
 *      (backward compat: also checks ~/.skillsrc)
 *
 * Values from the project config override global config.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { normalizeCloudApiOrigin, normalizeSkillsApiOrigin } from "./service-origin.js";

export interface SkillsConfig {
  mode?: "local" | "self-hosted" | "cloud";
  defaultAgent?: "claude" | "codex" | "gemini" | "pi" | "opencode" | "cursor" | "windsurf" | "all";
  defaultScope?: "global" | "project";
  format?: "compact" | "json" | "csv";
  apiUrl?: string;
}

const ENUM_KEYS: Partial<Record<keyof SkillsConfig, string[]>> = {
  defaultAgent: ["claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf", "all"],
  defaultScope: ["global", "project"],
  format: ["compact", "json", "csv"],
};

const STRING_KEYS = ["apiUrl"] as const satisfies readonly (keyof SkillsConfig)[];
const MODE_VALUES = ["local", "self-hosted", "cloud"] as const;
const MODE_ALIASES: Record<string, (typeof MODE_VALUES)[number]> = {
  local: "local",
  "self-hosted": "self-hosted",
  cloud: "cloud",
};

export class SkillsConfigMigrationError extends Error {
  readonly code = "SKILLS_CONFIG_MODE_MIGRATION_REQUIRED";

  constructor() {
    super("Configured Skills mode is not canonical. Run skills setup --mode local, skills setup --mode self-hosted --api-url <origin>, or skills setup --mode cloud.");
    this.name = "SkillsConfigMigrationError";
  }
}

function validKeys(): string[] {
  return ["mode", ...Object.keys(ENUM_KEYS), ...STRING_KEYS];
}

function allowedValues(key: keyof SkillsConfig): readonly string[] | undefined {
  if (key === "mode") return MODE_VALUES;
  return ENUM_KEYS[key];
}

function mergeDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) return;

  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);

    try {
      const sourceStat = statSync(sourcePath);
      if (sourceStat.isDirectory()) {
        mergeDirectoryContents(sourcePath, targetPath);
        continue;
      }
      if (!existsSync(targetPath)) copyFileSync(sourcePath, targetPath);
    } catch {
      // Skip entries that can't be inspected or copied.
    }
  }
}

function normalizeConfigValue(key: keyof SkillsConfig, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  if (key === "mode") return MODE_ALIASES[value.trim().toLowerCase()];

  const allowed = allowedValues(key);
  if (allowed) return allowed.includes(value) ? value : undefined;

  if (key === "apiUrl") {
    try {
      return normalizeSkillsApiOrigin(value, process.env);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export type ConfigScope = "global" | "project";

/**
 * Get the data directory for skills global config/data.
 * New default: ~/.hasna/skills/
 * Auto-migrates from ~/.skills/ and ~/.skillsrc without deleting legacy data.
 */
export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "skills");
  const oldDir = join(home, ".skills");
  const oldConfigFile = join(home, ".skillsrc");

  mkdirSync(newDir, { recursive: true });

  try {
    mergeDirectoryContents(oldDir, newDir);
  } catch {
    // If we can't copy legacy files, keep using the new path.
  }

  // Auto-migrate: if old config exists and new dir doesn't have config.json, copy it
  if (existsSync(oldConfigFile) && !existsSync(join(newDir, "config.json"))) {
    try {
      copyFileSync(oldConfigFile, join(newDir, "config.json"));
    } catch {
      // If we can't copy, just continue with the new path
    }
  }

  return newDir;
}

/**
 * Get the config file path for a given scope
 */
export function getConfigPath(scope: ConfigScope): string {
  if (scope === "global") {
    return join(getDataDir(), "config.json");
  }
  return join(process.cwd(), "skills.config.json");
}

/**
 * Read a single config file, returning an empty object on any error
 */
interface ConfigLayer {
  config: Partial<SkillsConfig>;
  declaresDeployment: boolean;
}

function readConfigFile(path: string): ConfigLayer {
  if (!existsSync(path)) return { config: {}, declaresDeployment: false };
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { config: {}, declaresDeployment: false };
    }
    const declaresDeployment = Object.prototype.hasOwnProperty.call(parsed, "mode")
      || Object.prototype.hasOwnProperty.call(parsed, "apiUrl");
    if (Object.prototype.hasOwnProperty.call(parsed, "mode") && normalizeConfigValue("mode", parsed.mode) === undefined) {
      throw new SkillsConfigMigrationError();
    }
    const config: Partial<SkillsConfig> = {};
    for (const key of validKeys() as (keyof SkillsConfig)[]) {
      const value = normalizeConfigValue(key, parsed[key]);
      if (value !== undefined) (config as Record<string, string>)[key] = value;
    }
    return { config, declaresDeployment };
  } catch (error) {
    if (error instanceof SkillsConfigMigrationError) throw error;
    return { config: {}, declaresDeployment: false };
  }
}

/**
 * Load merged config: project-local overrides global
 */
export function loadConfig(): SkillsConfig {
  const globalLayer = readConfigFile(getConfigPath("global"));
  const projectLayer = readConfigFile(getConfigPath("project"));
  const deploymentLayer = projectLayer.declaresDeployment ? projectLayer : globalLayer;
  const globalPreferences = { ...globalLayer.config };
  const projectPreferences = { ...projectLayer.config };
  delete globalPreferences.mode;
  delete globalPreferences.apiUrl;
  delete projectPreferences.mode;
  delete projectPreferences.apiUrl;
  return {
    ...globalPreferences,
    ...projectPreferences,
    ...(deploymentLayer.config.mode ? { mode: deploymentLayer.config.mode } : {}),
    ...(deploymentLayer.config.apiUrl ? { apiUrl: deploymentLayer.config.apiUrl } : {}),
  };
}

function readRawConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfigAtomically(filePath: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

export function saveDeploymentConfig(
  mode: NonNullable<SkillsConfig["mode"]>,
  apiUrl: string | undefined,
  scope: ConfigScope = "project",
  env: Record<string, string | undefined> = process.env,
): void {
  const existing = readRawConfig(getConfigPath(scope));
  existing.mode = mode;
  if (mode === "local") {
    if (apiUrl?.trim()) throw new Error("Local mode cannot be combined with an API origin.");
    delete existing.apiUrl;
  } else if (mode === "cloud") {
    existing.apiUrl = normalizeCloudApiOrigin(apiUrl, env);
  } else {
    if (!apiUrl?.trim()) {
      throw new Error("Self-hosted mode requires --api-url <origin>.");
    }
    existing.apiUrl = normalizeSkillsApiOrigin(apiUrl, env);
  }
  writeConfigAtomically(getConfigPath(scope), existing);
}

/**
 * Save a single config key-value pair to the specified scope
 */
export function saveConfig(key: string, value: string, scope: ConfigScope = "project"): void {
  if (!validKeys().includes(key)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${validKeys().join(", ")}`);
  }
  if (key === "mode" || key === "apiUrl") {
    throw new Error("Deployment mode and API origin are one atomic selection. Use skills setup --mode <mode> [--api-url <origin>].");
  }

  const normalized = normalizeConfigValue(key as keyof SkillsConfig, value);
  if (normalized === undefined) {
    const allowed = allowedValues(key as keyof SkillsConfig);
    throw new Error(
      allowed
        ? `Invalid value '${value}' for ${key}. Allowed: ${allowed.join(", ")}`
        : `Invalid value '${value}' for ${key}. Expected an http(s) URL`
    );
  }

  const filePath = getConfigPath(scope);
  const existing = readRawConfig(filePath);
  existing[key] = normalized;
  writeConfigAtomically(filePath, existing);
}
