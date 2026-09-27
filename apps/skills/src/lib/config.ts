/**
 * Config file support for Hasna Skills
 *
 * Loads configuration from:
 *   1. Project-local: ./skills.config.json (highest priority)
 *   2. Global: ~/.hasna/skills/config.json (JSON format, lowest priority)
 *
 * Values from the project config override global config.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { RETIRED_CONFIG_KEYS, assertNoRetiredConfigKeys } from "./retired-settings.js";
import { getDataRoot } from "./app-home.js";

/**
 * Environment variable that relocates the skills data directory.
 *
 * Owned by the @hasna/paths-based app-home resolver (app-home.ts), re-exported
 * here so every existing reader keeps agreeing on the name.
 */
export { DATA_DIR_ENV } from "./app-home.js";

/**
 * There is no deployment "mode" key, and no service address here either.
 *
 * Skills has one deployment story: you run it. Whether this CLI talks to a
 * server is not a product variant, it is one fact — whether a fleet credential
 * resolves. Nothing may be derived from a declared label, because a label can
 * disagree with the configuration it claims to describe.
 *
 * `apiUrl` used to live here as a sixth URL tier of this package's own. It is
 * retired (owner ruling 2026-09-04, hasna/apps#1720): the authority ladder is
 * `HASNA_SKILLS_API_URL` → the Keychain `api-url` item →
 * `~/.hasna/skills/config/credentials` → the fleet gateway, and it belongs to
 * @hasna/contracts so every Hasna CLI resolves it identically.
 * `skills setup --api-url <origin>` still writes it — into the credentials file.
 *
 * Configs written by older versions may still carry a "mode" or "apiUrl" key on
 * disk. Those are refused rather than ignored — see lib/retired-settings.ts for
 * why silence is the worse of the two failures — and `skills config unset <key>`
 * removes them.
 */
export interface SkillsConfig {
  defaultAgent?: "claude" | "codex" | "gemini" | "pi" | "opencode" | "all";
  defaultScope?: "global" | "project";
  format?: "compact" | "json" | "csv";
  extensionsDir?: string;
}

const ENUM_KEYS: Partial<Record<keyof SkillsConfig, string[]>> = {
  defaultAgent: ["claude", "codex", "gemini", "pi", "opencode", "all"],
  defaultScope: ["global", "project"],
  format: ["compact", "json", "csv"],
};

const STRING_KEYS = ["extensionsDir"] as const satisfies readonly (keyof SkillsConfig)[];

function validKeys(): string[] {
  return [...Object.keys(ENUM_KEYS), ...STRING_KEYS];
}

function allowedValues(key: keyof SkillsConfig): readonly string[] | undefined {
  return ENUM_KEYS[key];
}

function normalizeConfigValue(key: keyof SkillsConfig, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const allowed = allowedValues(key);
  if (allowed) return allowed.includes(value) ? value : undefined;

  if (key === "extensionsDir") return value.trim() ? value : undefined;

  return undefined;
}

export type ConfigScope = "global" | "project";

/**
 * Subfolder of the data directory holding the installed skill corpus.
 *
 * ~/.hasna/skills is the skills *app* folder, matching every sibling Hasna app:
 * mementos keeps agents/ beside config.json and mementos.db, accounts keeps
 * profiles/ beside accounts.json, knowledge keeps artifacts/ and cache/ beside
 * auth.json. Each puts app data at the app root and content in a named subfolder.
 *
 * Skills used to be the exception, writing one folder per skill straight into the
 * app root next to config.json and skills.db. That is the only reason a denylist
 * of "entries that look like skills but aren't" ever had to exist; no sibling app
 * needs one. With the corpus under installed/, a skill may be named `config` or
 * `custom` without colliding with anything.
 */
export const INSTALLED_SKILLS_DIRNAME = "installed";

/**
 * Subfolder of the data directory holding the migrated corpus cache — the
 * owner-layout replacement for installed/ after `skills storage migrate`
 * (~/.hasna/skills/{skills,logs,outputs}).
 *
 * The marker file inside it (LAYOUT_MIGRATION_RECORD) is the authority: a
 * skills/ directory someone created by hand is not the corpus and never will
 * be treated as one (see isOwnerLayoutMigrated).
 */
export const SKILLS_CACHE_DIRNAME = "skills";

/**
 * Marker file inside the corpus cache proving the owner-layout migration ran;
 * also its record (see migrateOwnerLayout in home-migration.ts).
 */
export const LAYOUT_MIGRATION_RECORD = ".layout-migration.json";

/**
 * True once the owner layout has been migrated (the record is the authority).
 *
 * Lives here — rather than in home-migration.ts — because the canonical corpus
 * resolver in portable-skills.ts must consult it too, and home-migration.ts
 * depends on portable-skills.ts; this module sits below both.
 */
export function isOwnerLayoutMigrated(appDir: string): boolean {
  return existsSync(join(appDir, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD));
}

/**
 * Get the data directory for skills global config/data.
 * Default: ~/.hasna/skills/, overridable with $HASNA_SKILLS_DIR.
 * Legacy directories and configuration are never imported during resolution.
 */
export function getDataDir(): string {
  const root = getDataRoot();
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    // Writers report inaccessible storage; a read never imports another source.
  }
  return root;
}

/** Resolve the same app data root without creating directories. */
export function getDataDirReadOnly(): string {
  return getDataRoot();
}

/**
 * Get the config file path for a given scope, write-free (see getDataDirReadOnly).
 */
export function getConfigPathReadOnly(scope: ConfigScope): string {
  if (scope === "global") return join(getDataDirReadOnly(), "config.json");
  return join(process.cwd(), "skills.config.json");
}

/** Read only the canonical global and explicitly selected project configuration. */
export function loadConfigReadOnly(): SkillsConfig {
  return { ...readConfigFile(getConfigPathReadOnly("global")), ...readConfigFile(getConfigPathReadOnly("project")) };
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

  // Parsing is the only thing inside the catch. A retired deployment-mode key is
  // a configuration error and has to escape, and the original single try block
  // would have swallowed the refusal along with the unparseable-file case it
  // exists for - leaving the guard installed and doing nothing.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  assertNoRetiredConfigKeys(parsed as Record<string, unknown>, path);

  const config: Partial<SkillsConfig> = {};
  for (const key of validKeys() as (keyof SkillsConfig)[]) {
    const value = normalizeConfigValue(key, (parsed as Record<string, unknown>)[key]);
    if (value !== undefined) (config as Record<string, string>)[key] = value;
  }
  return config;
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
  // Checked before the generic unknown-key error so the operator is told what
  // replaced this key, not merely that it is not on a list. "Unknown key" is true
  // and useless: it reads as a typo when the real answer is that the concept was
  // deleted and something else carries the decision.
  assertNoRetiredConfigKeys({ [key]: value }, `config set ${key}`);

  if (!validKeys().includes(key)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${validKeys().join(", ")}`);
  }

  const normalized = normalizeConfigValue(key as keyof SkillsConfig, value);
  if (normalized === undefined) {
    const allowed = allowedValues(key as keyof SkillsConfig);
    throw new Error(
      allowed
        ? `Invalid value '${value}' for ${key}. Allowed: ${allowed.join(", ")}`
        : `Invalid value '${value}' for ${key}. Expected a non-empty path`
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

  // A file loadConfig() refuses is not a file to write into. Without this, `skills
  // config set format json` exits 0 on a config carrying a retired key and every
  // read afterwards fails - a command that reports success while leaving the
  // install unusable. Refuse here and name the same fix, which unsetConfig() below
  // deliberately still allows.
  assertNoRetiredConfigKeys(existing, filePath);

  existing[key] = normalized;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}

/**
 * Remove a single config key from the specified scope.
 *
 * This is also how a retired key written by an older version is removed: a file
 * carrying one is refused by every read, so refusing to unset it would leave an
 * operator with a config every command rejects and no supported repair.
 *
 * Returns whether the key was actually present, so callers can distinguish
 * "removed" from "there was nothing to remove" instead of guessing.
 */
export function unsetConfig(key: string, scope: ConfigScope = "project"): boolean {
  // A retired key is removable even though it is not settable, and that asymmetry
  // is deliberate. loadConfig() now refuses a file carrying one, so refusing to
  // unset it as well would leave an operator with a config file every command
  // rejects and no supported way to repair it - the error names this command as
  // the fix, so the fix has to work.
  if (!validKeys().includes(key) && !(key in RETIRED_CONFIG_KEYS)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${validKeys().join(", ")}`);
  }

  const filePath = getConfigPath(scope);
  if (!existsSync(filePath)) return false;

  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    existing = parsed;
  } catch {
    return false;
  }

  if (!(key in existing)) return false;
  delete existing[key];
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
  return true;
}
