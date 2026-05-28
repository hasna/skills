/**
 * Skill registry - metadata about all available skills
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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

/**
 * Parse frontmatter from a SKILL.md file.
 * Supports: name, description, displayName/display_name, category, tags
 */
function parseSkillMdFrontmatter(content: string): Partial<SkillMeta> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Partial<SkillMeta> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key || !value) continue;
    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "displayName" || key === "display_name") result.displayName = value;
    else if (key === "category") result.category = value;
    else if (key === "tags") {
      result.tags = value.replace(/[\[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Discover skills from a directory. Each subdirectory is expected to be a skill
 * with a SKILL.md file containing frontmatter metadata.
 */
function discoverSkillsInDir(dir: string): SkillMeta[] {
  if (!existsSync(dir)) return [];
  const result: SkillMeta[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      let content: string;
      try { content = readFileSync(skillMdPath, "utf-8"); } catch { continue; }
      const fm = parseSkillMdFrontmatter(content);
      if (!fm?.name) continue;
      const name = fm.name;
      result.push({
        name,
        displayName: fm.displayName || name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: fm.description || "",
        category: fm.category || "Development Tools",
        tags: fm.tags || [],
        source: "custom",
      });
    }
  } catch {}
  return result;
}

let registryCache: SkillMeta[] | null = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL = 5000;

/**
 * Load the full registry: official skills merged with global custom skills
 * from ~/.hasna/skills/custom/.
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
  const globalCustom = discoverSkillsInDir(join(homedir(), ".hasna", "skills", "custom"));

  const customNames = new Set(globalCustom.map((s) => s.name));
  const filtered = official.filter((s) => !customNames.has(s.name));

  registryCache = [...filtered, ...globalCustom];
  registryCacheTime = now;
  return registryCache;
}

export function loadBasicRegistry(cwd?: string): SkillMeta[] {
  const registry = loadRegistry(cwd);
  const byName = new Map(registry.map((skill) => [skill.name, skill]));
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
