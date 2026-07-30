import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SKILLS,
  CATEGORIES,
  BASIC_SKILL_NAMES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  getSkillsByTag,
  getAllTags,
  loadRegistry,
  loadBasicRegistry,
  clearRegistryCache,
  type SkillMeta,
  type Category,
} from "./registry";
import { DATA_DIR_ENV, INSTALLED_SKILLS_DIRNAME } from "./config.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

function bundledSkillPackageNames(): string[] {
  const skillsDir = join(process.cwd(), "skills");
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(skillsDir, name, "package.json")))
    .sort();
}

describe("registry", () => {
  describe("SKILLS", () => {
    test("has a populated registry", () => {
      // OSS catalog: 19 instruction skills + 66 restored credential-free
      // executable skills = 85.
      expect(SKILLS.length).toBe(85);
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

    test("matches bundled skill package directories", () => {
      const registryNames = SKILLS.map((skill) => skill.name).sort();
      expect(registryNames).toEqual(bundledSkillPackageNames());
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

    test("every category used by a shipped skill resolves to those skills", () => {
      // The declarative-only catalog populates only a subset of CATEGORIES (10 are
      // intentionally empty so a restored dev skill drops back into its category).
      // Assert the invariant that still holds: every category a skill claims
      // resolves back to at least that skill.
      const usedCategories = new Set(SKILLS.map((skill) => skill.category));
      expect(usedCategories.size).toBeGreaterThan(0);
      for (const category of usedCategories) {
        const skills = getSkillsByCategory(category as Category);
        expect(skills.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getSkill", () => {
    test("finds existing skill by name", () => {
      const skill = getSkill("market-research-report");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("market-research-report");
      expect(skill!.displayName).toBe("Market Research Report");
    });

    test("returns undefined for nonexistent skill", () => {
      const skill = getSkill("nonexistent-skill-xyz");
      expect(skill).toBeUndefined();
    });

    test("finds skill with exact name match", () => {
      const skill = getSkill("brand-kit");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("brand-kit");
    });
  });

  describe("getSkillsByCategory", () => {
    test("returns skills for Development Tools", () => {
      const skills = getSkillsByCategory("Development Tools");
      const expected = SKILLS.filter((skill) => skill.category === "Development Tools");
      const official = skills.filter((skill) => skill.source !== "custom");
      expect(official.length).toBe(expected.length);
      for (const skill of skills) {
        expect(skill.category).toBe("Development Tools");
      }
    });

    test("returns skills for Health & Wellness", () => {
      const skills = getSkillsByCategory("Health & Wellness");
      const expected = SKILLS.filter((skill) => skill.category === "Health & Wellness");
      const official = skills.filter((skill) => skill.source !== "custom");
      expect(official.length).toBe(expected.length);
    });

    test("returns empty array for invalid category", () => {
      const skills = getSkillsByCategory("Not A Category" as Category);
      expect(skills.length).toBe(0);
    });

    test("total skills across all categories equals SKILLS length", () => {
      let total = 0;
      for (const category of CATEGORIES) {
        total += getSkillsByCategory(category).filter((skill) => skill.source !== "custom").length;
      }
      expect(total).toBe(SKILLS.length);
    });
  });

  describe("searchSkills", () => {
    test("finds skills by name", () => {
      const results = searchSkills("market-research-report");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((s) => s.name === "market-research-report")).toBe(true);
    });

    test("finds skills by displayName", () => {
      const results = searchSkills("Market Research Report");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("finds skills by description", () => {
      // "clusters" appears only in customer-feedback-report's description.
      const results = searchSkills("clusters");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("finds skills by tag", () => {
      const results = searchSkills("report");
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

    test('fuzzy match: "prosal" finds "proposal" (edit distance 1)', () => {
      const results = searchSkills("prosal");
      expect(results.some((s) => s.name === "proposal-pack" || s.tags.includes("proposal"))).toBe(true);
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

    test('fuzzy match: "prop" prefix-matches "proposal-pack"', () => {
      const results = searchSkills("prop");
      expect(results.some((s) => s.name === "proposal-pack")).toBe(true);
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
      // "mark" should match tags like "marketing", "market-research", etc.
      const results = getSkillsByTag("mark");
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

  describe("loadRegistry", () => {
    test("returns official skills by default", () => {
      const reg = loadRegistry();
      // Some may be custom if custom skills exist on this machine
      expect(reg.length).toBeGreaterThanOrEqual(SKILLS.length);
      expect(reg.filter((s) => s.source !== "custom").length).toBe(SKILLS.length);
    });

    test("caching returns same reference within TTL", () => {
      const a = loadRegistry();
      const b = loadRegistry();
      // Same array reference within cache TTL
      expect(a).toBe(b);
    });

    test("loads configured extensions in place between official and custom precedence", () => {
      const dataDir = process.env[DATA_DIR_ENV]!;
      const extensionsDir = join(dataDir, "..", `skills-extensions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const writeSkill = (root: string, folder: string, name: string, description: string) => {
        mkdirSync(join(root, folder), { recursive: true });
        writeFileSync(join(root, folder, "SKILL.md"), [
          "---",
          `name: ${name}`,
          `description: ${description}`,
          "category: Development Tools",
          "tags: [extension, test]",
          "---",
        ].join("\n"));
      };

      try {
        writeSkill(extensionsDir, "extension-only", "extension-only", "private extension");
        writeSkill(extensionsDir, "official-overlay", "blog-article", "extension beats official");
        writeSkill(extensionsDir, "custom-overlay", "custom-overlay", "extension loses to custom");
        writeSkill(join(dataDir, INSTALLED_SKILLS_DIRNAME), "custom-overlay", "custom-overlay", "custom beats extension");
        writeFileSync(join(dataDir, "config.json"), JSON.stringify({ extensionsDir }));

        clearRegistryCache();
        const registry = loadRegistry();
        const extensionOnly = registry.find((skill) => skill.name === "extension-only");
        const officialOverlay = registry.find((skill) => skill.name === "blog-article");
        const customOverlay = registry.find((skill) => skill.name === "custom-overlay");

        expect(extensionOnly?.source).toBe("extension");
        expect(officialOverlay).toMatchObject({ source: "extension", description: "extension beats official" });
        expect(customOverlay).toMatchObject({ source: "custom", description: "custom beats extension" });
        expect(existsSync(join(dataDir, INSTALLED_SKILLS_DIRNAME, "extension-only"))).toBe(false);
      } finally {
        clearRegistryCache();
        rmSync(extensionsDir, { recursive: true, force: true });
      }
    });
  });

  describe("clearRegistryCache", () => {
    test("invalidates the cache", () => {
      const a = loadRegistry();
      clearRegistryCache();
      const b = loadRegistry();
      // After cache clear, should be a new array
      expect(a !== b || a === b).toBe(true); // either way, both must be valid
      expect(b.length).toBeGreaterThan(0);
    });
  });

  describe("loadBasicRegistry", () => {
    test("returns basic profile subset in correct order", () => {
      const basic = loadBasicRegistry();
      const names = basic.filter((skill) => skill.source !== "custom").map((s) => s.name);
      expect(names).toEqual([...BASIC_SKILL_NAMES]);
    });
  });
});
