/**
 * public-boundary.ts — the public/private boundary for the published corpus.
 *
 * Some skills are PUBLIC (they ship in the open-source `@hasna/skills` package).
 * Others are PRIVATE/TEAM (fleet-operational, PII-bearing, internal) and must
 * NEVER enter the published npm files-list. This module lets a skill declare its
 * visibility and provides enforcement that detects any private skill leaking into
 * the real package file list.
 *
 * A skill is treated as PRIVATE (fully excluded from publish) when ANY of:
 *   - `package.json` -> `skills.visibility` is one of team|private|internal
 *   - `package.json` -> `skills.publish` is `false`
 *   - a marker file `.private` exists in the skill directory
 *   - `SKILL.md` frontmatter declares `visibility: team|private|internal`
 *
 * Note: `hosted` / `remote` / `private-hosted` skills are a DIFFERENT concept —
 * they ship metadata (package.json) with their `src/` stripped. Those are premium
 * hosted skills and are handled by the existing hosted-metadata boundary, not here.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type SkillVisibility = "public" | "team" | "private" | "internal";

const PRIVATE_VISIBILITIES = new Set<SkillVisibility>(["team", "private", "internal"]);

export function isPrivateVisibility(value: string | undefined): value is SkillVisibility {
  return value !== undefined && PRIVATE_VISIBILITIES.has(value.trim().toLowerCase() as SkillVisibility);
}

function readPackageVisibility(skillDir: string): { visibility?: string; publish?: unknown } {
  const pkgPath = join(skillDir, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      skills?: { visibility?: unknown; publish?: unknown };
    };
    const skills = pkg.skills ?? {};
    return {
      visibility: typeof skills.visibility === "string" ? skills.visibility : undefined,
      publish: skills.publish,
    };
  } catch {
    return {};
  }
}

function readFrontmatterVisibility(skillDir: string): string | undefined {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) return undefined;
  const content = readFileSync(skillMd, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() === "visibility") {
      return line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

/** Determine whether a skill directory is private (must never be published). */
export function isPrivateSkillDir(skillDir: string): boolean {
  if (existsSync(join(skillDir, ".private"))) return true;
  const pkg = readPackageVisibility(skillDir);
  if (isPrivateVisibility(pkg.visibility)) return true;
  if (pkg.publish === false) return true;
  if (isPrivateVisibility(readFrontmatterVisibility(skillDir))) return true;
  return false;
}

/** List the slugs of every private skill under a `skills/` root, sorted. */
export function listPrivateSkillSlugs(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  const slugs: string[] = [];
  for (const entry of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (isPrivateSkillDir(dir)) slugs.push(entry);
  }
  return slugs.sort();
}

/**
 * Given the real package file list and the set of private slugs, return every
 * packed path that belongs to a private skill. A non-empty result means a private
 * skill leaked into the publishable package.
 */
export function findPrivatePacklistLeaks(packedPaths: string[], privateSlugs: Iterable<string>): string[] {
  const prefixes = [...privateSlugs].map((slug) => `skills/${slug}/`);
  const exact = new Set([...privateSlugs].map((slug) => `skills/${slug}`));
  return packedPaths
    .filter((path) => exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix)))
    .sort();
}
