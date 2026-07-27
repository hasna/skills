import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, removeSkill, skillExists } from "./installer.js";
import { getSkill, SKILLS } from "./registry.js";
import { SKILL_ALIASES, normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("skill aliases", () => {
  test("normalizes skill aliases without skill prefix", () => {
    // Declarative-only catalog: aliases pointing at archived executable skills were
    // removed; create-blog-article -> blog-article is the surviving alias.
    expect(normalizeSkillSlug("create-blog-article")).toBe("create-blog-article");
    expect(resolveSkillAlias("create-blog-article")).toBe("blog-article");
    // An unknown/removed alias resolves to itself (identity), never to a dead target.
    expect(resolveSkillAlias("generate-pdf")).toBe("generate-pdf");
  });

  test("aliases target existing skills and do not shadow exact skills", () => {
    const names = new Set(SKILLS.map((skill) => skill.name));
    for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
      expect(names.has(canonical)).toBe(true);
      expect(names.has(alias)).toBe(false);
    }
  });

  test("getSkill resolves legacy aliases to canonical skills", () => {
    expect(getSkill("create-blog-article")?.name).toBe("blog-article");
    // exact match wins over an alias of the same shape
    expect(getSkill("blog-article")?.name).toBe("blog-article");
    // a removed alias target does not resolve to a phantom skill
    expect(getSkill("generate-pdf")).toBeUndefined();
  });

  test("pin and unpin accept aliases but use canonical project pins", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-alias-install-"));
    try {
      const result = installSkill("create-blog-article", { targetDir: dir });
      expect(result.success).toBe(true);
      expect(result.skill).toBe("blog-article");
      const config = JSON.parse(readFileSync(join(dir, ".skills", "project.json"), "utf8"));
      expect(config.pinnedSkills).toContain("blog-article");
      expect(config.pinnedSkills).not.toContain("create-blog-article");
      expect(existsSync(join(dir, ".skills", "skills"))).toBe(false);
      expect(skillExists("create-blog-article")).toBe(true);
      expect(removeSkill("create-blog-article", dir)).toBe(true);
      const nextConfig = JSON.parse(readFileSync(join(dir, ".skills", "project.json"), "utf8"));
      expect(nextConfig.pinnedSkills).not.toContain("blog-article");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
