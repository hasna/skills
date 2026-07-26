import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHostedSourceExclusionGlob,
  diffSlugSets,
  findHostedSourcePacklistLeaks,
  isHostedMetadataPackage,
  listHostedMetadataSlugs,
  parseHostedSourceExclusionSlugs,
  requireHostedMetadataSlugs,
} from "./hosted-skill-set";
import { getPackedFiles } from "./packlist";
import { getAllPremiumSlugs } from "./pricing";

const REPO_ROOT = process.cwd();
const SKILLS_ROOT = join(REPO_ROOT, "skills");

function rootPackageFiles(): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { files?: string[] };
  return pkg.files ?? [];
}

describe("hosted skill set — the authoritative derivation", () => {
  test("the predicate reads the declaration, not the directory name", () => {
    expect(isHostedMetadataPackage({ skills: { runtime: "hosted" } })).toBe(true);
    expect(isHostedMetadataPackage({ skills: { source: "remote" } })).toBe(true);
    expect(isHostedMetadataPackage({ skills: { source: "private-hosted" } })).toBe(true);
    expect(isHostedMetadataPackage({ skills: { runtime: "  HOSTED " } })).toBe(true);

    expect(isHostedMetadataPackage({ skills: { runtime: "local" } })).toBe(false);
    expect(isHostedMetadataPackage({ skills: { source: "official" } })).toBe(false);
    expect(isHostedMetadataPackage({ skills: {} })).toBe(false);
    expect(isHostedMetadataPackage({})).toBe(false);
    expect(isHostedMetadataPackage(null)).toBe(false);
  });

  // The anti-vacuity gate, stated once. Every guard below and in
  // public-package-boundary.test.ts derives its set through
  // `requireHostedMetadataSlugs`, so deleting or converting the hosted
  // directories en masse turns this whole family RED rather than green.
  test("the hosted metadata set is non-empty, so the derived guards are not vacuous", () => {
    const slugs = requireHostedMetadataSlugs(SKILLS_ROOT);
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("the guard accessor refuses an empty set instead of returning one", () => {
    // Proves the anti-vacuity property mechanically: point the derivation at a
    // root with no hosted skills and it throws rather than handing back [].
    const emptyRoot = join(REPO_ROOT, "src");
    expect(listHostedMetadataSlugs(emptyRoot)).toEqual([]);
    expect(() => requireHostedMetadataSlugs(emptyRoot)).toThrow(/hosted metadata skill set is empty/);
  });
});

describe("hosted skill set — projections cannot drift from the authoritative set", () => {
  // Projection 2 — the `files` source-exclusion globs.
  //
  // This is the EARLY-WARNING layer. It fires the moment the declaration and the
  // glob disagree, which is strictly before the packed output can differ: a slug
  // missing from the glob is invisible until that directory gains a `src/`, and
  // then its implementation silently ships.
  test("every hosted metadata skill has its src/ excluded by the packlist globs", () => {
    const hosted = requireHostedMetadataSlugs(SKILLS_ROOT);
    const excluded = parseHostedSourceExclusionSlugs(rootPackageFiles());
    const { missing, unexpected } = diffSlugSets(hosted, excluded);

    expect(
      { missing, unexpected },
      [
        "package.json `files` source exclusions have drifted from the hosted metadata declarations.",
        `  declared hosted but not excluded: ${missing.join(", ") || "(none)"}`,
        `  excluded but not declared hosted: ${unexpected.join(", ") || "(none)"}`,
        "Canonical replacement for the exclusion entry:",
        `  ${JSON.stringify(buildHostedSourceExclusionGlob(hosted))}`,
      ].join("\n"),
    ).toEqual({ missing: [], unexpected: [] });
  });

  // Projection 3 — the premium catalog in pricing.ts.
  test("the premium catalog and the hosted metadata declarations describe the same set", () => {
    const hosted = requireHostedMetadataSlugs(SKILLS_ROOT);
    const priced = getAllPremiumSlugs();
    const { missing, unexpected } = diffSlugSets(hosted, priced);

    expect(
      { missing, unexpected },
      [
        "pricing.ts has drifted from the hosted metadata declarations.",
        `  declared hosted but unpriced: ${missing.join(", ") || "(none)"}`,
        `  priced but not declared hosted: ${unexpected.join(", ") || "(none)"}`,
      ].join("\n"),
    ).toEqual({ missing: [], unexpected: [] });
  });

  // The OUTCOME layer, asserted against the serialized surface (`npm pack`),
  // not against the source text of the `files` array.
  test("no hosted metadata skill ships implementation source in the packed package", () => {
    const hosted = requireHostedMetadataSlugs(SKILLS_ROOT);
    const packed = getPackedFiles(REPO_ROOT);
    expect(packed.length).toBeGreaterThan(0);
    expect(findHostedSourcePacklistLeaks(packed, hosted)).toEqual([]);
  });
});

describe("hosted skill set — glob parsing", () => {
  test("reads both the brace form and the one-entry-per-slug form", () => {
    expect(parseHostedSourceExclusionSlugs(["!skills/{alpha,beta}/src"])).toEqual(["alpha", "beta"]);
    expect(parseHostedSourceExclusionSlugs(["!skills/alpha/src", "!skills/beta/src"])).toEqual([
      "alpha",
      "beta",
    ]);
    expect(
      parseHostedSourceExclusionSlugs(["!skills/{beta,gamma}/src", "!skills/alpha/src"]),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  test("ignores unrelated files entries and non-src exclusions", () => {
    expect(
      parseHostedSourceExclusionSlugs([
        "dist/",
        "skills/",
        "!skills/**/node_modules",
        "!skills/scaffold-project/my-app",
        "!skills/alpha/src/lib",
        "README.md",
      ]),
    ).toEqual([]);
  });

  test("round-trips through the canonical rendering", () => {
    const slugs = ["gamma", "alpha", "beta"];
    expect(parseHostedSourceExclusionSlugs([buildHostedSourceExclusionGlob(slugs)])).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  // Regression: `npm pack` does not brace-expand a one-element `{slug}`; the
  // entry excludes nothing while `bun pm pack` does expand it. Treating that
  // form as a real exclusion would report a slug as protected while npm — the
  // packer that actually publishes — still ships its source.
  test("rejects the one-element brace form and emits the bare form instead", () => {
    expect(parseHostedSourceExclusionSlugs(["!skills/{alpha}/src"])).toEqual([]);
    expect(buildHostedSourceExclusionGlob(["alpha"])).toBe("!skills/alpha/src");
    expect(buildHostedSourceExclusionGlob(["beta", "alpha"])).toBe("!skills/{alpha,beta}/src");
    expect(() => buildHostedSourceExclusionGlob([])).toThrow(/empty slug set/);
  });

  // Regression: `files` is ORDER-SENSITIVE. A `skills/` entry after the
  // negation re-includes everything the negation removed. Measured with npm:
  //   ["skills/", "!skills/{one,two}/src"] -> packs neither src
  //   ["!skills/{one,two}/src", "skills/"] -> packs BOTH srcs
  // A set-based reading would report both slugs excluded in the second case.
  test("a later entry that re-includes skills/ discards the exclusions before it", () => {
    expect(parseHostedSourceExclusionSlugs(["skills/", "!skills/{alpha,beta}/src"])).toEqual([
      "alpha",
      "beta",
    ]);
    expect(parseHostedSourceExclusionSlugs(["!skills/{alpha,beta}/src", "skills/"])).toEqual([]);
    expect(parseHostedSourceExclusionSlugs(["!skills/alpha/src", "skills/**"])).toEqual([]);
    expect(parseHostedSourceExclusionSlugs(["!skills/alpha/src", "**"])).toEqual([]);
    // Re-inclusion of an unrelated tree leaves the exclusion standing.
    expect(parseHostedSourceExclusionSlugs(["!skills/alpha/src", "dist/", "README.md"])).toEqual([
      "alpha",
    ]);
  });

  // Every slug the renderer can emit must parse back, or the guard would print
  // a "fix" that does not satisfy it.
  test("build and parse round-trip for every slug shape the derivation can yield", () => {
    for (const slugs of [["_common", "beta"], ["Alpha", "beta"], ["x_y", "beta"], ["solo"]]) {
      const glob = buildHostedSourceExclusionGlob(slugs);
      expect(parseHostedSourceExclusionSlugs([glob]), `round-trip failed for ${glob}`).toEqual(
        [...slugs].sort(),
      );
    }
  });

  test("the derivation never yields a dot-directory, which no files glob could exclude", () => {
    expect(listHostedMetadataSlugs(SKILLS_ROOT).filter((slug) => slug.startsWith("."))).toEqual([]);
  });

  test("finds packed paths that would ship hosted implementation source", () => {
    const packed = [
      "skills/alpha/package.json",
      "skills/alpha/src/index.ts",
      "skills/alpha/SKILL.md",
      "skills/beta/src/index.ts",
    ];
    expect(findHostedSourcePacklistLeaks(packed, ["alpha"])).toEqual(["skills/alpha/src/index.ts"]);
    expect(findHostedSourcePacklistLeaks(packed, [])).toEqual([]);
  });
});
