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
  mode?: "local" | "hosted";
  defaultAgent?: "claude" | "codex" | "gemini" | "pi" | "opencode" | "all";
  defaultScope?: "global" | "project";
  format?: "compact" | "json" | "csv";
  apiUrl?: string;
}

const ENUM_KEYS: Partial<Record<keyof SkillsConfig, string[]>> = {
  defaultAgent: ["claude", "codex", "gemini", "pi", "opencode", "all"],
  defaultScope: ["global", "project"],
  format: ["compact", "json", "csv"],
};

const STRING_KEYS = ["apiUrl"] as const satisfies readonly (keyof SkillsConfig)[];
const MODE_VALUES = ["local", "hosted"] as const;
const MODE_ALIASES: Record<string, (typeof MODE_VALUES)[number]> = {
  local: "local",
  offline: "local",
  hosted: "hosted",
  remote: "hosted",
  "skills.md": "hosted",
  skillsmd: "hosted",
};

function validKeys(): string[] {
  return ["mode", ...Object.keys(ENUM_KEYS), ...STRING_KEYS];
}

function allowedValues(key: keyof SkillsConfig): readonly string[] | undefined {
  if (key === "mode") return MODE_VALUES;
  return ENUM_KEYS[key];
}

function normalizeConfigValue(key: keyof SkillsConfig, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  if (key === "mode") return MODE_ALIASES[value.trim().toLowerCase()];

  const allowed = allowedValues(key);
  if (allowed) return allowed.includes(value) ? value : undefined;

  if (key === "apiUrl") {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
      return value.replace(/\/+$/, "");
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
    const config: Partial<SkillsConfig> = {};
    for (const key of validKeys() as (keyof SkillsConfig)[]) {
      const value = normalizeConfigValue(key, parsed[key]);
      if (value !== undefined) (config as Record<string, string>)[key] = value;
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
  if (!validKeys().includes(key)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${validKeys().join(", ")}`);
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

  existing[key] = normalized;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}
