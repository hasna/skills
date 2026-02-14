import { describe, test, expect } from "bun:test";
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  type SkillMeta,
  type Category,
} from "./registry";

describe("registry", () => {
  describe("SKILLS", () => {
    test("has 200 skills", () => {
      expect(SKILLS.length).toBe(200);
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
      expect(skills.length).toBe(32);
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
  });
});
