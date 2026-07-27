/**
 * Tests for search module — editDistance, searchSkills, findSimilarSkills
 */

import { describe, test, expect } from "bun:test";
import { editDistance, searchSkills, findSimilarSkills } from "./search.js";
import type { SkillMeta } from "./registry.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

function makeSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    name: "test-skill",
    displayName: "Test Skill",
    description: "A test skill for testing",
    category: "Development Tools",
    tags: ["test", "example"],
    ...overrides,
  };
}

const DEFAULT_REGISTRY: SkillMeta[] = [
  makeSkill({ name: "image", displayName: "Image Generation", description: "Generate images using AI", tags: ["image", "generation", "ai"] }),
  makeSkill({ name: "video", displayName: "Video Creator", description: "Create videos with AI", tags: ["video", "creation", "ai"] }),
  makeSkill({ name: "deploy", displayName: "Deploy Tool", description: "Deploy applications", tags: ["deployment", "ci-cd"] }),
  makeSkill({ name: "email-campaign", displayName: "Email Campaign Manager", description: "Design email campaigns", tags: ["email", "marketing"] }),
  makeSkill({ name: "market-research-report", displayName: "Market Research Report", description: "Competitor and audience research", tags: ["research", "market"] }),
];

// ── editDistance ──────────────────────────────────────────────────

describe("editDistance", () => {
  test("same strings return 0", () => {
    expect(editDistance("hello", "hello")).toBe(0);
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("a", "a")).toBe(0);
  });

  test("empty string returns length of other", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("", "")).toBe(0);
  });

  test("single insertion", () => {
    expect(editDistance("ab", "abc")).toBe(1);
  });

  test("single deletion", () => {
    expect(editDistance("abc", "ab")).toBe(1);
  });

  test("single substitution", () => {
    expect(editDistance("abc", "abd")).toBe(1);
  });

  test("classic 'kitten' to 'sitting' = 3", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  test("case sensitivity — editDistance preserves case", () => {
    expect(editDistance("Hello", "hello")).toBe(1);
  });

  test("completely different strings", () => {
    expect(editDistance("abc", "xyz")).toBe(3);
  });

  test("two deletions", () => {
    expect(editDistance("abc", "a")).toBe(2);
  });

  test("two insertions", () => {
    expect(editDistance("a", "abc")).toBe(2);
  });

  test("transposition counted as 2 (no transposition support)", () => {
    // Levenshtein doesn't have transposition; "ab" -> "ba" = 2 edits
    expect(editDistance("ab", "ba")).toBe(2);
  });
});

// ── findSimilarSkills ──────────────────────────────────────────────────

describe("findSimilarSkills", () => {
  test("finds similar skills for a close misspelling", () => {
    const results = findSimilarSkills("imge", 3, DEFAULT_REGISTRY);
    expect(results).toContain("image");
  });

  test("returns exact match first (distance 0)", () => {
    const results = findSimilarSkills("image", 5, DEFAULT_REGISTRY);
    expect(results[0]).toBe("image");
  });

  test("respects maxResults", () => {
    const results = findSimilarSkills("x", 2, DEFAULT_REGISTRY);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for completely different query", () => {
    // "zzzzq" has high distance from all registry names
    const results = findSimilarSkills("zzzzq", 3, DEFAULT_REGISTRY);
    // All distances should exceed the threshold
    expect(results.length).toBe(0);
  });

  test("finds similar skill within threshold", () => {
    const results = findSimilarSkills("deplo", 3, DEFAULT_REGISTRY);
    expect(results).toContain("deploy");
  });

  test("uses registry parameter when provided", () => {
    const custom: SkillMeta[] = [
      makeSkill({ name: "alpha" }),
      makeSkill({ name: "alpine" }),
    ];
    const results = findSimilarSkills("alpa", 3, custom);
    expect(results).toContain("alpha");
  });

  test("sorted by edit distance (closest first)", () => {
    const custom: SkillMeta[] = [
      makeSkill({ name: "abcdef" }),
      makeSkill({ name: "abc" }),
      makeSkill({ name: "abcd" }),
    ];
    // "abce" dist to "abc"=1 (del 'e'), "abcd"=1 (sub e→d), "abcdef"=2 (del e, ins d,f)
    const results = findSimilarSkills("abce", 3, custom);
    expect(results).toEqual(["abc", "abcd", "abcdef"]);
  });
});

// ── searchSkills (extended coverage beyond registry.test.ts) ─────

describe("searchSkills", () => {
  test("returns empty for empty query", () => {
    expect(searchSkills("", DEFAULT_REGISTRY)).toHaveLength(0);
  });

  test("returns empty for whitespace-only query", () => {
    expect(searchSkills("   ", DEFAULT_REGISTRY)).toHaveLength(0);
  });

  test("exact name match ranks first", () => {
    const results = searchSkills("image", DEFAULT_REGISTRY);
    expect(results[0].name).toBe("image");
  });

  test("prefix match finds results", () => {
    const results = searchSkills("dep", DEFAULT_REGISTRY);
    expect(results.some((s) => s.name === "deploy")).toBe(true);
  });

  test("multi-word query matches across fields", () => {
    const registry: SkillMeta[] = [
      makeSkill({ name: "email-campaign", displayName: "Email Campaign", description: "Design email marketing campaigns", tags: ["email", "campaign", "marketing"] }),
      makeSkill({ name: "image", displayName: "Image Generation", description: "Generate images", tags: ["image", "ai"] }),
    ];
    // "email design" should match email-campaign (email in name + design in description)
    const results = searchSkills("email design", registry);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("email-campaign");
  });

  test("results sorted by relevance score", () => {
    const registry: SkillMeta[] = [
      makeSkill({ name: "dep", displayName: "Dep Tool", description: "Something unrelated", tags: ["dep"] }),
      makeSkill({ name: "deploy", displayName: "Deploy Tool", description: "Deploy stuff", tags: ["deployment"] }),
    ];
    const results = searchSkills("deploy", registry);
    // "deploy" has exact name match
    expect(results[0].name).toBe("deploy");
  });

  test("tag matching scores below name matching", () => {
    // "ai" only matches as a tag — it should still return results
    const results = searchSkills("AI", DEFAULT_REGISTRY);
    expect(results.length).toBeGreaterThan(0);
  });

  test("fuzzy edit-distance match for words >= 3 chars", () => {
    const results = searchSkills("deployy", DEFAULT_REGISTRY);
    expect(results.some((s) => s.name === "deploy")).toBe(true);
  });

  test("no match for short word fuzzy when distance > 1", () => {
    // "zz" has no match in any field
    const results = searchSkills("zz", DEFAULT_REGISTRY);
    expect(results).toHaveLength(0);
  });
});
