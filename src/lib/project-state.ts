/**
 * Project-local Skills state.
 *
 * `.skills/` is runtime/output state plus optional project preferences. It is
 * not a skill source directory and must never contain copied skill definitions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeSkillName } from "./utils.js";

export const SKILLS_PROJECT_DIR = ".skills";
export const PROJECT_CONFIG_FILE = "project.json";
export const DEFAULT_EXPORT_DIR = ".skills/exports";

export interface ProjectSkillPin {
  name: string;
  pinnedAt: string;
  version: string;
  source: "official" | "custom" | "remote" | "local";
}

export interface SkillsProjectConfig {
  version: 1;
  defaultExportDir: string;
  pinnedSkills: string[];
  pins: Record<string, ProjectSkillPin>;
  disabledSkills?: string[];
  createdAt: string;
  updatedAt: string;
}

export function getProjectStateDir(targetDir: string = process.cwd()): string {
  return join(targetDir, SKILLS_PROJECT_DIR);
}

export function getProjectConfigPath(targetDir: string = process.cwd()): string {
  return join(getProjectStateDir(targetDir), PROJECT_CONFIG_FILE);
}

export function loadProjectConfig(targetDir: string = process.cwd()): SkillsProjectConfig | null {
  const path = getProjectConfigPath(targetDir);
  if (!existsSync(path)) return null;
  try {
    return normalizeProjectConfig(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

export function ensureProjectConfig(targetDir: string = process.cwd()): SkillsProjectConfig {
  const existing = loadProjectConfig(targetDir);
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    version: 1,
    defaultExportDir: DEFAULT_EXPORT_DIR,
    pinnedSkills: [],
    pins: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function saveProjectConfig(config: SkillsProjectConfig, targetDir: string = process.cwd()): void {
  const dir = getProjectStateDir(targetDir);
  mkdirSync(dir, { recursive: true });
  const normalized = normalizeProjectConfig({ ...config, updatedAt: new Date().toISOString() });
  writeFileSync(getProjectConfigPath(targetDir), JSON.stringify(normalized, null, 2) + "\n");
}

export function pinProjectSkill(
  name: string,
  details: { version?: string; source?: ProjectSkillPin["source"] } = {},
  targetDir: string = process.cwd(),
): { pinned: boolean; config: SkillsProjectConfig } {
  const skillName = normalizeSkillName(name);
  const config = ensureProjectConfig(targetDir);
  const alreadyPinned = config.pinnedSkills.includes(skillName);
  if (!alreadyPinned) config.pinnedSkills.push(skillName);
  config.pinnedSkills = [...new Set(config.pinnedSkills)].sort();
  config.pins[skillName] = config.pins[skillName] ?? {
    name: skillName,
    pinnedAt: new Date().toISOString(),
    version: details.version ?? "unknown",
    source: details.source ?? "official",
  };
  config.pins[skillName] = {
    ...config.pins[skillName],
    version: details.version ?? config.pins[skillName].version ?? "unknown",
    source: details.source ?? config.pins[skillName].source ?? "official",
  };
  saveProjectConfig(config, targetDir);
  return { pinned: !alreadyPinned, config };
}

export function unpinProjectSkill(
  name: string,
  targetDir: string = process.cwd(),
): { unpinned: boolean; config: SkillsProjectConfig | null } {
  const skillName = normalizeSkillName(name);
  const config = loadProjectConfig(targetDir);
  if (!config) return { unpinned: false, config: null };
  const before = config.pinnedSkills.length;
  config.pinnedSkills = config.pinnedSkills.filter((skill) => skill !== skillName);
  delete config.pins[skillName];
  if (config.disabledSkills) {
    config.disabledSkills = config.disabledSkills.filter((skill) => skill !== skillName);
  }
  const unpinned = config.pinnedSkills.length !== before;
  if (unpinned) saveProjectConfig(config, targetDir);
  return { unpinned, config };
}

export function listPinnedSkills(targetDir: string = process.cwd()): string[] {
  return loadProjectConfig(targetDir)?.pinnedSkills ?? [];
}

export function setSkillDisabled(name: string, disabled: boolean, targetDir: string = process.cwd()): boolean {
  const skillName = normalizeSkillName(name);
  const config = loadProjectConfig(targetDir);
  if (!config?.pinnedSkills.includes(skillName)) return false;
  const disabledSet = new Set(config.disabledSkills ?? []);
  const changed = disabled ? !disabledSet.has(skillName) : disabledSet.has(skillName);
  if (disabled) disabledSet.add(skillName);
  else disabledSet.delete(skillName);
  config.disabledSkills = [...disabledSet].sort();
  if (changed) saveProjectConfig(config, targetDir);
  return changed;
}

export function getDisabledProjectSkills(targetDir: string = process.cwd()): string[] {
  return loadProjectConfig(targetDir)?.disabledSkills ?? [];
}

function normalizeProjectConfig(raw: Partial<SkillsProjectConfig>): SkillsProjectConfig {
  const now = new Date().toISOString();
  const pinnedSkills = Array.isArray(raw.pinnedSkills)
    ? [...new Set(raw.pinnedSkills.map((name) => normalizeSkillName(String(name))))].sort()
    : [];
  const pins: Record<string, ProjectSkillPin> = {};
  const rawPins = raw.pins && typeof raw.pins === "object" ? raw.pins : {};
  for (const name of pinnedSkills) {
    const pin = rawPins[name] as Partial<ProjectSkillPin> | undefined;
    pins[name] = {
      name,
      pinnedAt: typeof pin?.pinnedAt === "string" ? pin.pinnedAt : now,
      version: typeof pin?.version === "string" ? pin.version : "unknown",
      source: isPinSource(pin?.source) ? pin.source : "official",
    };
  }
  return {
    version: 1,
    defaultExportDir: typeof raw.defaultExportDir === "string" ? raw.defaultExportDir : DEFAULT_EXPORT_DIR,
    pinnedSkills,
    pins,
    disabledSkills: Array.isArray(raw.disabledSkills)
      ? [...new Set(raw.disabledSkills.map((name) => normalizeSkillName(String(name))))].sort()
      : [],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

function isPinSource(value: unknown): value is ProjectSkillPin["source"] {
  return value === "official" || value === "custom" || value === "remote" || value === "local";
}
