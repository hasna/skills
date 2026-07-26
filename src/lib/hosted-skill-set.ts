/**
 * hosted-skill-set.ts — the single authoritative derivation of the
 * "hosted metadata skill" set.
 *
 * A hosted metadata skill ships its `package.json` and docs but NOT its `src/`.
 * That set is expressed in three places that can silently drift apart:
 *
 *   1. Each skill's own `package.json` -> `skills.runtime` / `skills.source`.
 *   2. The negated `!skills/{...}/src` glob(s) in the root `package.json` `files`.
 *   3. The premium catalog in `pricing.ts`.
 *
 * (1) is AUTHORITATIVE. It lives next to the thing it describes, so it cannot be
 * forgotten when a directory is added, removed, or converted. (2) and (3) are
 * projections of it and are guarded against drift in `hosted-skill-set.test.ts`.
 *
 * Two accessors, deliberately different:
 *
 *   - `listHostedMetadataSlugs` is the library answer. Zero hosted skills is a
 *     legitimate answer for an arbitrary skills root.
 *   - `requireHostedMetadataSlugs` is the repo-guard answer. Guards that FILTER
 *     by this set pass vacuously when it is empty, so emptiness must be a loud,
 *     deliberate decision rather than a silent side effect of deleting or
 *     converting the directories. Every guard derived from the enumerated set
 *     goes through this accessor so a mass deletion fails the whole family of
 *     guards at once instead of turning them green.
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
 * May legitimately return `[]` for an arbitrary root — see
 * `requireHostedMetadataSlugs` for the guard-facing accessor.
 */
export function listHostedMetadataSlugs(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  const slugs: string[] = [];
  for (const entry of readdirSync(skillsRoot)) {
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

/**
 * Guard-facing accessor. Identical to `listHostedMetadataSlugs`, except it
 * refuses to hand back an empty set. Throwing here — rather than leaving each
 * call site to remember its own non-emptiness assertion — is the point: a new
 * guard written against this accessor inherits the anti-vacuity property for
 * free, and it cannot be forgotten.
 */
export function requireHostedMetadataSlugs(skillsRoot: string): string[] {
  const slugs = listHostedMetadataSlugs(skillsRoot);
  if (slugs.length === 0) throw new Error(HOSTED_METADATA_SET_EMPTY_ERROR);
  return slugs;
}

// ---------------------------------------------------------------------------
// Projection 2: the root package.json `files` source-exclusion globs.
// ---------------------------------------------------------------------------

// Anchored, and tolerant of BOTH shapes so the guard survives a reformat of the
// `files` array: one brace glob listing the slugs, or one entry per slug.
//
// The brace form deliberately requires at least TWO comma-separated slugs.
// `npm pack` does not brace-expand a single-element `{slug}` — it treats the
// braces literally and the entry excludes NOTHING, while `bun pm pack` does
// expand it. Accepting a one-element brace here would mean reporting a slug as
// excluded when npm, the authoritative packer for publishing, still ships its
// source. The only single-slug form that works in both packers is the bare one.
const BRACE_SOURCE_EXCLUSION = /^!skills\/\{([a-z0-9][a-z0-9-]*(?:,[a-z0-9][a-z0-9-]*)+)\}\/src$/;
const SINGLE_SOURCE_EXCLUSION = /^!skills\/([a-z0-9][a-z0-9-]*)\/src$/;

/**
 * Extract the set of slugs whose `src/` the root `files` array genuinely
 * excludes from the published package, sorted and de-duplicated.
 */
export function parseHostedSourceExclusionSlugs(files: readonly string[]): string[] {
  const slugs = new Set<string>();
  for (const entry of files) {
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
