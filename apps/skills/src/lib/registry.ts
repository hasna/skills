/**
 * Skill registry - metadata about all available skills
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getDataDirReadOnly, loadConfig } from "./config.js";
import { listPortableSkillMetas } from "./portable-skills.js";
import { isHostedMetadataSkillDir } from "./hosted-skill-set.js";
import { mergeSkillRegistryLists } from "./registry-merge.js";
import { normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";
import { SKILLS } from "./registry-data/index.js";
import {
  BASIC_SKILL_NAMES,
  CATEGORIES,
  type Category,
  type SkillMeta,
  type SkillRegistryProfile,
  type SkillSource,
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
    else if (key === "kind") {
      if (value === "executable" || value === "instruction") result.kind = value;
    }
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
function discoverSkillsInDir(dir: string, source: SkillSource = "custom"): SkillMeta[] {
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
        ...(fm.kind ? { kind: fm.kind } : {}),
        // Server-owned is a property of the published contract (package.json
        // skills.runtime/skills.source), derived from the skill directory.
        ...(isHostedMetadataSkillDir(join(dir, entry.name)) ? { serverOwned: true } : {}),
        source,
      });
    }
  } catch {}
  return result;
}

export function findExtensionSkillPath(name: string): string | null {
  const config = loadConfig();
  if (!config.extensionsDir || !existsSync(config.extensionsDir)) return null;

  try {
    const entries = readdirSync(config.extensionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(config.extensionsDir, entry.name);
      const skillMdPath = join(skillDir, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      let content: string;
      try { content = readFileSync(skillMdPath, "utf-8"); } catch { continue; }
      const fm = parseSkillMdFrontmatter(content);
      if (fm?.name === name) return skillDir;
    }
  } catch {}

  return null;
}

let registryCache: SkillMeta[] | null = null;
let registryCacheTime = 0;
let registryCacheKey: string | null = null;
const REGISTRY_CACHE_TTL = 5000;

/** Bind the cache to the effective app home and project without adopting or migrating either. */
function registryRootKey(): string {
  return JSON.stringify([getDataDirReadOnly(), process.cwd()]);
}

/** Discover the Skills-owned cache and explicitly configured authoring sources. */
export function loadRegistry(cwd?: string): SkillMeta[] {
  const now = Date.now();
  // Key the cache on where the data dir resolves from, not just elapsed time: a
  // caller that repoints $HASNA_SKILLS_DIR (or $HOME) must not be served entries
  // discovered under the previous root. Without this the 5s TTL leaks skills
  // across isolation boundaries.
  const rootKey = registryRootKey();
  if (registryCache && registryCacheKey === rootKey && now - registryCacheTime < REGISTRY_CACHE_TTL) {
    return registryCache;
  }

  const config = loadConfig();
  const extensions = config.extensionsDir
    ? discoverSkillsInDir(config.extensionsDir, "extension")
    : [];
  const owned = listPortableSkillMetas();
  registryCache = mergeSkillRegistryLists(extensions, owned);
  registryCacheTime = now;
  registryCacheKey = rootKey;
  return registryCache;
}

/** Compatibility name for the caller's own catalog; no baked-in default selection. */
export function loadBasicRegistry(cwd?: string): SkillMeta[] {
  return loadRegistry(cwd);
}

export function loadRegistryProfile(profile: SkillRegistryProfile = "basic", cwd?: string): SkillMeta[] {
  return profile === "all" ? loadRegistry(cwd) : loadBasicRegistry(cwd);
}

/** Invalidate the registry cache (e.g. after installing a custom skill). */
export function clearRegistryCache(): void {
  registryCache = null;
  registryCacheTime = 0;
  registryCacheKey = null;
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
