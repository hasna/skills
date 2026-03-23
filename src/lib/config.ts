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

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface SkillsConfig {
  defaultAgent?: "claude" | "codex" | "gemini" | "all";
  defaultScope?: "global" | "project";
  format?: "compact" | "json" | "csv";
}

const VALID_KEYS: Record<keyof SkillsConfig, string[]> = {
  defaultAgent: ["claude", "codex", "gemini", "all"],
  defaultScope: ["global", "project"],
  format: ["compact", "json", "csv"],
};

export type ConfigScope = "global" | "project";

/**
 * Get the data directory for skills global config/data.
 * New default: ~/.hasna/skills/
 * Auto-migrates from ~/.skillsrc if the new config doesn't exist yet.
 */
export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "skills");
  const oldConfigFile = join(home, ".skillsrc");

  // Auto-migrate: if old config exists and new dir doesn't have config.json, copy it
  if (existsSync(oldConfigFile) && !existsSync(join(newDir, "config.json"))) {
    mkdirSync(newDir, { recursive: true });
    try {
      copyFileSync(oldConfigFile, join(newDir, "config.json"));
    } catch {
      // If we can't copy, just continue with the new path
    }
  }

  mkdirSync(newDir, { recursive: true });
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
function readConfigFile(path: string): Partial<SkillsConfig> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // Basic type filtering — only keep known keys with valid values
    const config: Partial<SkillsConfig> = {};
    for (const [key, allowed] of Object.entries(VALID_KEYS)) {
      const val = parsed[key];
      if (typeof val === "string" && allowed.includes(val)) {
        (config as any)[key] = val;
      }
    }
    return config;
  } catch {
    return {};
  }
}

/**
 * Load merged config: project-local overrides global
 */
export function loadConfig(): SkillsConfig {
  const globalConfig = readConfigFile(getConfigPath("global"));
  const projectConfig = readConfigFile(getConfigPath("project"));
  return { ...globalConfig, ...projectConfig };
}

/**
 * Save a single config key-value pair to the specified scope
 */
export function saveConfig(key: string, value: string, scope: ConfigScope = "project"): void {
  if (!(key in VALID_KEYS)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(VALID_KEYS).join(", ")}`);
  }
  const allowed = VALID_KEYS[key as keyof SkillsConfig];
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value '${value}' for ${key}. Allowed: ${allowed.join(", ")}`);
  }

  const filePath = getConfigPath(scope);
  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8"));
      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        existing = {};
      }
    } catch {
      existing = {};
    }
  } else {
    // Ensure parent directory exists (mainly for global path)
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  existing[key] = value;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}
