import { describe, test, expect } from "bun:test";
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  getSkillsByTag,
  getAllTags,
  type SkillMeta,
  type Category,
} from "./registry";

describe("registry", () => {
  describe("SKILLS", () => {
    test("has 204 skills", () => {
      expect(SKILLS.length).toBe(204);
    });

    test("all skills have required fields", () => {
      for (const skill of SKILLS) {
        expect(skill.name).toBeTruthy();
        expect(skill.displayName).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.category).toBeTruthy();
        expect(Array.isArray(skill.tags)).toBe(true);
        expect(skill.tags.length).toBeGreaterThanOrEqual(2);
      }
    });

    test("all skill names are unique", () => {
      const names = SKILLS.map((s) => s.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    test("all skills belong to a valid category", () => {
      const categorySet = new Set(CATEGORIES as readonly string[]);
      for (const skill of SKILLS) {
        expect(categorySet.has(skill.category)).toBe(true);
      }
    });
  });

  describe("CATEGORIES", () => {
    test("has 17 categories", () => {
      expect(CATEGORIES.length).toBe(17);
    });

    test("all categories are unique", () => {
      const unique = new Set(CATEGORIES);
      expect(unique.size).toBe(CATEGORIES.length);
    });

    test("every category has at least one skill", () => {
      for (const category of CATEGORIES) {
        const skills = getSkillsByCategory(category);
        expect(skills.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getSkill", () => {
    test("finds existing skill by name", () => {
      const skill = getSkill("deepresearch");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("deepresearch");
      expect(skill!.displayName).toBe("Deep Research (Agentic)");
    });

    test("returns undefined for nonexistent skill", () => {
      const skill = getSkill("nonexistent-skill-xyz");
      expect(skill).toBeUndefined();
    });

    test("finds skill with exact name match", () => {
      const skill = getSkill("image");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("image");
    });
  });

  describe("getSkillsByCategory", () => {
    test("returns skills for Development Tools", () => {
      const skills = getSkillsByCategory("Development Tools");
      expect(skills.length).toBe(34);
      for (const skill of skills) {
        expect(skill.category).toBe("Development Tools");
      }
    });

    test("returns skills for Health & Wellness", () => {
      const skills = getSkillsByCategory("Health & Wellness");
      expect(skills.length).toBe(8);
    });

    test("returns empty array for invalid category", () => {
      const skills = getSkillsByCategory("Not A Category" as Category);
      expect(skills.length).toBe(0);
    });

    test("total skills across all categories equals SKILLS length", () => {
      let total = 0;
      for (const category of CATEGORIES) {
        total += getSkillsByCategory(category).length;
      }
      expect(total).toBe(SKILLS.length);
    });
  });

  describe("searchSkills", () => {
    test("finds skills by name", () => {
      const results = searchSkills("deepresearch");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((s) => s.name === "deepresearch")).toBe(true);
    });

    test("finds skills by displayName", () => {
      const results = searchSkills("Deep Research (Agentic)");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("finds skills by description", () => {
      const results = searchSkills("invoice");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("finds skills by tag", () => {
      const results = searchSkills("pdf");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("search is case insensitive", () => {
      const lower = searchSkills("email");
      const upper = searchSkills("EMAIL");
      expect(lower.length).toBe(upper.length);
    });

    test("returns empty array for no match", () => {
      const results = searchSkills("zzzznonexistentzzzzz");
      expect(results.length).toBe(0);
    });

    test("returns multiple results for broad query", () => {
      const results = searchSkills("generate");
      expect(results.length).toBeGreaterThan(5);
    });

    test('fuzzy match: "imge" finds "image" (edit distance 1 for 4-char word)', () => {
      const results = searchSkills("imge");
      expect(results.some((s) => s.name === "image" || s.tags.includes("image"))).toBe(true);
    });

    test('fuzzy match: "emal" finds skills related to "email" (edit distance 1)', () => {
      const results = searchSkills("emal");
      expect(
        results.some(
          (s) =>
            s.tags.some((t) => t.includes("email")) ||
            s.displayName.toLowerCase().includes("email") ||
            s.description.toLowerCase().includes("email")
        )
      ).toBe(true);
    });

    test('fuzzy match: "depl" prefix-matches "deploy"', () => {
      const results = searchSkills("depl");
      expect(results.some((s) => s.name === "deploy")).toBe(true);
    });
  });

  describe("getSkillsByTag", () => {
    test("returns skills tagged with 'api'", () => {
      const results = getSkillsByTag("api");
      expect(results.length).toBeGreaterThan(0);
      for (const skill of results) {
        expect(skill.tags.some((t) => t.toLowerCase().includes("api"))).toBe(true);
      }
    });

    test("is case-insensitive (uppercased tag)", () => {
      const lower = getSkillsByTag("api");
      const upper = getSkillsByTag("API");
      expect(lower.length).toBe(upper.length);
      expect(lower.map((s) => s.name)).toEqual(upper.map((s) => s.name));
    });

    test("supports partial tag match", () => {
      // "gen" should match tags like "generation", "generate", etc.
      const results = getSkillsByTag("gen");
      expect(results.length).toBeGreaterThan(0);
    });

    test("returns empty array for a tag that doesn't exist", () => {
      const results = getSkillsByTag("zzznomatch_xyz_999");
      expect(results.length).toBe(0);
    });
  });

  describe("getAllTags", () => {
    test("returns a non-empty array", () => {
      const tags = getAllTags();
      expect(tags.length).toBeGreaterThan(0);
    });

    test("tags are sorted alphabetically", () => {
      const tags = getAllTags();
      const sorted = [...tags].sort();
      expect(tags).toEqual(sorted);
    });

    test("tags are unique", () => {
      const tags = getAllTags();
      const unique = new Set(tags);
      expect(unique.size).toBe(tags.length);
    });

    test("all tags are lowercase", () => {
      const tags = getAllTags();
      for (const tag of tags) {
        expect(tag).toBe(tag.toLowerCase());
      }
    });

    test("every skill tag appears in getAllTags()", () => {
      const allTags = new Set(getAllTags());
      for (const skill of SKILLS) {
        for (const tag of skill.tags) {
          expect(allTags.has(tag.toLowerCase())).toBe(true);
        }
      }
    });
  });
});
