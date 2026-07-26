/**
 * hosted-skill-set.ts — the single authoritative derivation of the
 * "hosted metadata skill" set.
 *
 * A hosted metadata skill ships its `package.json` and docs but NOT its `src/`.
 * That set is expressed in three places that can silently drift apart:
 *
 *   1. Each skill's own `package.json` -> `skills.runtime` / `skills.source`.
 *   2. The negated `!skills/{...}/src` glob(s) in the root `package.json` `files`.
  *
 * (1) is AUTHORITATIVE. It lives next to the thing it describes, so it cannot be
 * forgotten when a directory is added, removed, or converted. (2) and (3) are
 * projections of it and are guarded against drift in `hosted-skill-set.test.ts`.
 *
 * Two accessors, deliberately different:
 *
 * THIS REPO now has ZERO hosted skills: every catalog entry ships bundled source
 * or is instruction prose. The guard-facing `requireHostedMetadataSlugs`
 * accessor, and the five guards derived from it, were retired in the change that
 * emptied the set — which is precisely what its own emptiness error demanded.
 * `catalog-runnable.test.ts` now asserts the set stays empty, so re-introducing
 * a hosted skill fails loudly rather than silently.
 *
 * The parsing helpers below remain: `release-guard.ts` still applies them to
 * ARBITRARY packages, where a non-empty hosted set is a legitimate answer, and
 * `release-guard.integration.test.ts` exercises them against synthetic fixtures.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Shape of the only part of a skill `package.json` this module reads. */
export interface HostedSkillPackageMarkers {
  skills?: {
    runtime?: unknown;
    source?: unknown;
  };
}

const HOSTED_RUNTIMES = new Set(["hosted"]);
const HOSTED_SOURCES = new Set(["remote", "private-hosted"]);

function normalizeMarker(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * The authoritative predicate: does this parsed skill `package.json` declare
 * itself as hosted metadata (implementation lives off-repo)?
 */
export function isHostedMetadataPackage(pkg: unknown): boolean {
  const skills = (pkg as HostedSkillPackageMarkers | null | undefined)?.skills;
  if (!skills || typeof skills !== "object") return false;
  return (
    HOSTED_RUNTIMES.has(normalizeMarker(skills.runtime)) ||
    HOSTED_SOURCES.has(normalizeMarker(skills.source))
  );
}

/** Read a skill directory's `package.json` and apply the authoritative predicate. */
export function isHostedMetadataSkillDir(skillDir: string): boolean {
  const pkgPath = join(skillDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    return isHostedMetadataPackage(JSON.parse(readFileSync(pkgPath, "utf8")));
  } catch {
    return false;
  }
}

/**
 * Enumerate the hosted metadata slugs under a `skills/` root, sorted.
 * Returns `[]` for this repo, and may legitimately be non-empty for another.
 */
export function listHostedMetadataSlugs(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  const slugs: string[] = [];
  for (const entry of readdirSync(skillsRoot)) {
    // Dot-directories are not skills anywhere else in the repo (see
    // validateRegistryConsistency), and `files` globs do not match a leading
    // dot by default, so a dot-directory could never be excluded by the entry
    // this module renders. Skipping keeps the derivation and the renderer in
    // agreement about what a slug can be.
    if (entry.startsWith(".")) continue;
    const dir = join(skillsRoot, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (isHostedMetadataSkillDir(dir)) slugs.push(entry);
  }
  return slugs.sort();
}

export const HOSTED_METADATA_SET_EMPTY_ERROR = [
  "The hosted metadata skill set is empty, but the packaging guards that depend on it",
  "only mean anything while it is non-empty: an empty set makes every one of them pass",
  "vacuously and silently removes the protection that keeps hosted implementation source",
  "out of the published package.",
  "",
  "If emptying the set is intentional (every hosted skill was deleted or converted to a",
  "runnable in-repo skill), retire the derived guards in the SAME change — do not let them",
  "stay green and empty.",
].join("\n");

// ---------------------------------------------------------------------------
// Projection 2: the root package.json `files` source-exclusion globs.
// ---------------------------------------------------------------------------

// Anchored. Two spellings are recognised: one brace glob listing the slugs, or
// one bare entry per slug. Anything else parses to nothing and therefore fails
// the drift guard loudly rather than being assumed to work.
//
// The brace form deliberately requires at least TWO comma-separated slugs.
// `npm pack` does not brace-expand a single-element `{slug}` — it treats the
// braces literally and the entry excludes NOTHING, while `bun pm pack` does
// expand it. Accepting a one-element brace here would mean reporting a slug as
// excluded when npm, the authoritative packer for publishing, still ships its
// source. The only single-slug form that works in both packers is the bare one.
//
// The slug character class is `[^,{}/]` rather than `[a-z0-9-]` so that every
// slug `buildHostedSourceExclusionGlob` can emit also parses back. A narrower
// class here would let the guard print a "fix" that does not satisfy it.
const SLUG = "[^,{}/]+";
const BRACE_SOURCE_EXCLUSION = new RegExp(`^!skills/\\{(${SLUG}(?:,${SLUG})+)\\}/src$`);
const SINGLE_SOURCE_EXCLUSION = new RegExp(`^!skills/(${SLUG})/src$`);

/**
 * A non-negated `files` entry that re-includes paths under `skills/`.
 *
 * `files` is ORDER-SENSITIVE: an entry appearing after a negation undoes it. A
 * set-based reading would happily report every slug as excluded while npm packs
 * all of their sources. Conservative by construction — anything that might
 * re-include counts as re-inclusion, so an unrecognised pattern fails the guard
 * rather than silently satisfying it.
 */
function reincludesSkillSources(entry: string): boolean {
  if (entry.startsWith("!")) return false;
  const normalized = entry.replace(/^\.\//, "");
  return normalized === "*" || normalized === "**" || normalized.startsWith("skills");
}

/**
 * Extract the set of slugs whose `src/` the root `files` array genuinely
 * excludes from the published package, sorted and de-duplicated.
 *
 * Only negations that survive to the end of the array count: a later entry that
 * re-includes `skills/` discards every exclusion before it, exactly as npm
 * resolves them.
 */
export function parseHostedSourceExclusionSlugs(files: readonly string[]): string[] {
  let slugs = new Set<string>();
  for (const entry of files) {
    if (reincludesSkillSources(entry)) {
      slugs = new Set();
      continue;
    }
    const brace = BRACE_SOURCE_EXCLUSION.exec(entry);
    if (brace) {
      for (const slug of brace[1].split(",")) slugs.add(slug);
      continue;
    }
    const single = SINGLE_SOURCE_EXCLUSION.exec(entry);
    if (single) slugs.add(single[1]);
  }
  return [...slugs].sort();
}

/**
 * Render the canonical `files` exclusion entry for a slug set, so a drift
 * failure can print the exact line to paste. Emits the bare form for a single
 * slug because the one-element brace form is inert under `npm pack`.
 */
export function buildHostedSourceExclusionGlob(slugs: readonly string[]): string {
  const sorted = [...new Set(slugs)].sort();
  if (sorted.length === 0) {
    throw new Error("Cannot build a source-exclusion glob for an empty slug set.");
  }
  if (sorted.length === 1) return `!skills/${sorted[0]}/src`;
  return `!skills/{${sorted.join(",")}}/src`;
}

/** Paths in a packed file list that would ship a hosted skill's implementation source. */
export function findHostedSourcePacklistLeaks(
  packedPaths: readonly string[],
  hostedSlugs: Iterable<string>,
): string[] {
  const prefixes = [...hostedSlugs].map((slug) => `skills/${slug}/src/`);
  return packedPaths.filter((path) => prefixes.some((prefix) => path.startsWith(prefix))).sort();
}

/** Symmetric difference between two slug sets, for readable drift failures. */
export function diffSlugSets(
  expected: readonly string[],
  actual: readonly string[],
): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: [...expectedSet].filter((slug) => !actualSet.has(slug)).sort(),
    unexpected: [...actualSet].filter((slug) => !expectedSet.has(slug)).sort(),
  };
}
