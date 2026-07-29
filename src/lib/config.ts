/**
 * Config file support for Hasna Skills
 *
 * Loads configuration from:
 *   1. Project-local: ./skills.config.json (highest priority)
 *   2. Global: ~/.hasna/skills/config.json (JSON format, lowest priority)
 *      (backward compat: also checks ~/.skillsrc)
 *
 * Values from the project config override global config.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { RETIRED_CONFIG_KEYS, assertNoRetiredConfigKeys } from "./retired-settings.js";

/**
 * There is no deployment "mode" key.
 *
 * Skills has one deployment story: you run it. Whether this CLI talks to a
 * server is not a product variant, it is one fact — whether an API origin is
 * configured (apiUrl here, or $SKILLS_API_URL). Nothing else may be derived
 * from a declared label, because a label can disagree with the configuration
 * it claims to describe.
 *
 * One caveat, true at the time of writing and tracked separately: getApiUrl()
 * in auth-store.ts still falls back to a built-in origin when neither is set,
 * so "no origin configured" is not yet the same as "sends nothing anywhere" on
 * the auth path. Removing that fallback belongs to the no-vendor-defaults work,
 * not here; remote-registry.ts already fails closed and is the model.
 *
 * Configs written by older versions may still carry a "mode" key on disk. That is
 * refused rather than ignored - see lib/retired-settings.ts for why silence is
 * the worse of the two failures - and `skills config unset mode` removes it.
 */
export interface SkillsConfig {
  defaultAgent?: "claude" | "codex" | "gemini" | "pi" | "opencode" | "all";
  defaultScope?: "global" | "project";
  format?: "compact" | "json" | "csv";
  apiUrl?: string;
  /** Checked-out extension corpus, read in place without copying into installed/. */
  extensionsDir?: string;
}

const ENUM_KEYS: Partial<Record<keyof SkillsConfig, string[]>> = {
  defaultAgent: ["claude", "codex", "gemini", "pi", "opencode", "all"],
  defaultScope: ["global", "project"],
  format: ["compact", "json", "csv"],
};

const STRING_KEYS = ["apiUrl", "extensionsDir"] as const satisfies readonly (keyof SkillsConfig)[];

function validKeys(): string[] {
  return [...Object.keys(ENUM_KEYS), ...STRING_KEYS];
}

function allowedValues(key: keyof SkillsConfig): readonly string[] | undefined {
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

  if (key === "extensionsDir") return value.trim() ? value : undefined;

  return undefined;
}

export type ConfigScope = "global" | "project";

/**
 * Environment variable that relocates the skills data directory.
 *
 * Exported so that every reader agrees on the name: previously the literal was
 * duplicated in portable-skills.ts and honoured there but *not* in getDataDir(),
 * which is what made the override only half work (see getDataDir below).
 */
export const DATA_DIR_ENV = "HASNA_SKILLS_DIR";

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
 * Get the data directory for skills global config/data.
 * Default: ~/.hasna/skills/, overridable with $HASNA_SKILLS_DIR.
 * Auto-migrates from ~/.skills/ and ~/.skillsrc without deleting legacy data.
 */
export function getDataDir(): string {
  // $HASNA_SKILLS_DIR outranks $HOME. Both are ambient, and the more specific one
  // wins; an explicit argument passed by a caller outranks both, which is why
  // getPortableSkillsRoot() resolves options.rootDir/options.homeDir before it
  // ever reaches this function.
  //
  // This branch is a bug fix, not just test scaffolding. getPortableSkillsRoot()
  // has always honoured $HASNA_SKILLS_DIR while getDataDir() ignored it, so with
  // the variable set, `skills new`/`port` wrote into the override while `skills
  // list` and the config file kept reading $HOME. Those two now agree.
  //
  // Not yet routed through here, and therefore still $HOME-rooted regardless of
  // the override: auth-store.ts (paths frozen as import-time constants) and
  // create-sync-config.ts. Both are tracked as follow-ups.
  //
  // NOTE: this also relocates the global config file, since getConfigPath()
  // derives from getDataDir(). See the PR description - it is intentional and
  // user-visible.
  //
  // Legacy ~/.skills migration is deliberately skipped for an overridden dir: it
  // is a $HOME concern, and copying a stray legacy tree into an operator-chosen
  // (often temporary) directory would be a surprising write.
  const override = process.env[DATA_DIR_ENV];
  if (override) {
    // Best-effort, like the migration below. Read paths (`skills list`, `search`,
    // `info`) must not throw because the override names a read-only parent or an
    // existing file; callers that actually write surface their own error, and
    // readers already treat a missing root as "no custom skills".
    try {
      mkdirSync(override, { recursive: true });
    } catch {
      // Keep returning the override; the caller decides whether it needs to exist.
    }
    return override;
  }

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
        : key === "apiUrl"
          ? `Invalid value '${value}' for ${key}. Expected an http(s) URL`
          : `Invalid value '${value}' for ${key}. Expected a non-empty directory path`
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
 * This is the counterpart that makes "no deployment mode" workable. Running on
 * this machine is the absence of a configured apiUrl, so there has to be a way
 * to get back to that state; previously the only way to express the intent was
 * to set mode=local, and that key is gone.
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
