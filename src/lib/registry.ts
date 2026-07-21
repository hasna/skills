/**
 * Skill registry - metadata about all available skills
 */

import { join } from "path";
import { getDataDir } from "./config.js";
import { listPortableSkillMetas } from "./portable-skills.js";
import { normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";
import { SKILLS } from "./registry-data/index.js";
import {
  BASIC_SKILL_NAMES,
  CATEGORIES,
  type Category,
  type SkillMeta,
  type SkillRegistryProfile,
} from "./registry-types.js";

export { BASIC_SKILL_NAMES, CATEGORIES, SKILLS };
export type { Category, SkillMeta, SkillRegistryProfile };

export function isBasicSkillName(name: string): boolean {
  return (BASIC_SKILL_NAMES as readonly string[]).includes(name);
}

let registryCache: SkillMeta[] | null = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL = 5000;

/**
 * Load the full registry: official skills merged with global custom skills
 * from ~/.hasna/skills/<name>/ and the legacy ~/.hasna/skills/custom/<name>/ path.
 *
 * Custom skills with the same name as official skills take precedence.
 * Results are cached for 5 seconds.
 */
export function loadRegistry(cwd?: string): SkillMeta[] {
  const now = Date.now();
  if (registryCache && now - registryCacheTime < REGISTRY_CACHE_TTL) {
    return registryCache;
  }

  const official = SKILLS.map((s) => ({ ...s, source: "official" as const }));
  const dataDir = getDataDir();
  const portableCustom = listPortableSkillMetas({ rootDir: dataDir });
  const legacyCustom = listPortableSkillMetas({ rootDir: join(dataDir, "custom") });
  const globalCustom = mergeCustomSkills([...legacyCustom, ...portableCustom]);

  const customNames = new Set(globalCustom.map((s) => s.name));
  const filtered = official.filter((s) => !customNames.has(s.name));

  registryCache = [...filtered, ...globalCustom];
  registryCacheTime = now;
  return registryCache;
}

export function loadBasicRegistry(cwd?: string): SkillMeta[] {
  const registry = loadRegistry(cwd);
  const byName = new Map(registry.map((skill) => [skill.name, skill]));
  // The basic profile is a curated, compact set. Custom/imported skills are gated
  // out of the default `list` so bulk imports (e.g. 140 skills) cannot flood it;
  // they remain discoverable via the "all" profile (`skills list --all`).
  return BASIC_SKILL_NAMES.map((name) => byName.get(name)).filter((skill): skill is SkillMeta => skill !== undefined);
}

export function loadRegistryProfile(profile: SkillRegistryProfile = "basic", cwd?: string): SkillMeta[] {
  return profile === "all" ? loadRegistry(cwd) : loadBasicRegistry(cwd);
}

/** Invalidate the registry cache (e.g. after installing a custom skill). */
export function clearRegistryCache(): void {
  registryCache = null;
  registryCacheTime = 0;
}

export function getSkillsByCategory(category: Category): SkillMeta[] {
  return loadRegistry().filter((s) => s.category === category);
}

/* ---- search, tag logic moved to separate files ---- */
export { searchSkills, findSimilarSkills } from "./search.js";

export function getSkill(name: string): SkillMeta | undefined {
  const registry = loadRegistry();
  const slug = normalizeSkillSlug(name);
  return registry.find((s) => s.name === slug)
    ?? registry.find((s) => s.name === resolveSkillAlias(slug));
}

function mergeCustomSkills(skills: SkillMeta[]): SkillMeta[] {
  const byName = new Map<string, SkillMeta>();
  for (const skill of skills) byName.set(skill.name, skill);
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkillsByTag(tag: string): SkillMeta[] {
  const needle = tag.toLowerCase();
  return loadRegistry().filter((s) => s.tags.some((t) => t.toLowerCase().includes(needle)));
}

export function getAllTags(): string[] {
  const tagSet = new Set<string>();
  for (const skill of loadRegistry()) {
    for (const tag of skill.tags) tagSet.add(tag.toLowerCase());
  }
  return Array.from(tagSet).sort();
}
