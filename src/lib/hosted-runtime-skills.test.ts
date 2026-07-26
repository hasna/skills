import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { HOSTED_RUNTIME_SLUGS, isHostedRuntimeSkill } from "./hosted-runtime-skills.js";
import { diffSlugSets, listHostedMetadataSlugs } from "./hosted-skill-set.js";

const skillsRoot = join(process.cwd(), "skills");

describe("hosted runtime classifier", () => {
  // The whole reason the classifier may be a literal list rather than a
  // filesystem scan. If this fails, the list is stale: regenerate it from
  // `listHostedMetadataSlugs("skills")` rather than editing it by hand.
  test("is exactly the filesystem-derived hosted metadata set", () => {
    const derived = listHostedMetadataSlugs(skillsRoot);

    // Anti-vacuity. Two empty sets are trivially equal, so an accidental
    // deletion of every hosted skill directory would otherwise turn this
    // drift guard green while proving nothing.
    expect(derived.length).toBeGreaterThan(0);

    const { missing, unexpected } = diffSlugSets(derived, [...HOSTED_RUNTIME_SLUGS]);
    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
  });

  test("is sorted and free of duplicates so drift diffs stay readable", () => {
    expect([...HOSTED_RUNTIME_SLUGS]).toEqual([...new Set(HOSTED_RUNTIME_SLUGS)].sort());
  });

  test("classifies a hosted slug, and does not classify a bundled one", () => {
    expect(isHostedRuntimeSkill("logo-design")).toBe(true);
    // `commit` ships real src/ in this package; it must never be hosted.
    expect(isHostedRuntimeSkill("commit")).toBe(false);
    expect(isHostedRuntimeSkill("definitely-not-a-skill")).toBe(false);
  });


  // The classifier carries deployment facts only. Cost, tier, currency and
  // plan vocabulary belong to a billing layer, not to "where does this run".
  test("exposes no billing vocabulary", () => {
    const source = Bun.file(join(import.meta.dir, "hosted-runtime-skills.ts"));
    return source.text().then((text) => {
      const code = text.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const banned of ["costCents", "costMicros", "tier", "premium", "billing", "price"]) {
        expect(code.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    });
  });
});
