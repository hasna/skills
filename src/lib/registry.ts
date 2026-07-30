/**
 * Skill registry - metadata about all available skills
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { DATA_DIR_ENV, getDataDir, loadConfig } from "./config.js";
import { listPortableSkillMetas } from "./portable-skills.js";
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
        source,
      });
    }
  } catch {}
  return result;
}

let registryCache: SkillMeta[] | null = null;
let registryCacheTime = 0;
let registryCacheKey: string | null = null;
const REGISTRY_CACHE_TTL = 5000;

/**
 * Identifies the roots getDataDir() would resolve from, without calling it.
 *
 * Deliberately a string compare over the ambient inputs rather than the resolved
 * path: getDataDir() mkdirs, stats, and walks the legacy ~/.skills tree on every
 * call, so resolving it before the cache check would put that work on every cache
 * *hit* and defeat the cache entirely.
 *
 * Must list every variable getDataDir() reads, or the key degenerates and serves
 * entries discovered under a root the caller has already moved away from.
 *
 * JSON rather than a delimiter-joined string: no path can make it ambiguous, and
 * it keeps this file plain ASCII. An earlier revision used a raw NUL as the
 * delimiter, which made the file binary to git and therefore unreviewable.
 */
function registryRootKey(): string {
  return JSON.stringify([
    process.env[DATA_DIR_ENV] ?? "",
    process.env["HOME"] ?? "",
    process.env["USERPROFILE"] ?? "",
  ]);
}

/**
 * Load the full registry: official skills merged with a configured private
 * extension checkout and global custom skills from ~/.hasna/skills/installed/<name>/
 * (plus the legacy ~/.hasna/skills/custom/<name>/ migration safety net).
 *
 * Custom skills take precedence over extensions, which take precedence over
 * official skills. Extension skills are read in place and never copied into installed/.
 * Results are cached for 5 seconds.
 */
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

  const dataDir = getDataDir();
  const config = loadConfig();
  const official = SKILLS.map((s) => ({ ...s, source: "official" as const }));
  const extensions = config.extensionsDir
    ? discoverSkillsInDir(config.extensionsDir, "extension")
    : [];
  // No rootDir: let getPortableSkillsRoot() resolve <dataDir>/installed and run
  // the layout migration. Passing the app folder as rootDir would read app data
  // as if it were the corpus.
  const portableCustom = listPortableSkillMetas();
  // Kept as a safety net, not as a second home: migration copies custom/<name>
  // into installed/, but if it ever fails (unreadable, out of space) those skills
  // must still be discoverable. mergeCustomSkills() dedupes by name and the
  // installed/ copy is merged last, so it wins.
  const legacyCustom = discoverSkillsInDir(join(dataDir, "custom"));
  const globalCustom = mergeCustomSkills([...legacyCustom, ...portableCustom]);

  registryCache = mergeSkillRegistryLists(official, extensions, globalCustom);
  registryCacheTime = now;
  registryCacheKey = rootKey;
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
