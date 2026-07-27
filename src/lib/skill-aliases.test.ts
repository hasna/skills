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
    expect(normalizeSkillSlug("create-blog-article")).toBe("create-blog-article");
    expect(resolveSkillAlias("read-document")).toBe("doc-read");
    expect(resolveSkillAlias("generate-pdf")).toBe("pdf-generate");
    expect(resolveSkillAlias("create-blog-article")).toBe("blog-article");
    expect(resolveSkillAlias("skill-diff")).toBe("diff-viewer");
  });

  test("aliases target existing skills and do not shadow exact skills", () => {
    const names = new Set(SKILLS.map((skill) => skill.name));
    for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
      expect(names.has(canonical)).toBe(true);
      expect(names.has(alias)).toBe(false);
    }
  });

  test("getSkill resolves legacy aliases to canonical skills", () => {
    expect(getSkill("read-document")?.name).toBe("doc-read");
    expect(getSkill("generate-pdf")?.name).toBe("pdf-generate");
    expect(getSkill("create-blog-article")?.name).toBe("blog-article");
    expect(getSkill("skill-diff")?.name).toBe("diff-viewer");
    // exact match wins over an alias of the same shape
    expect(getSkill("doc-read")?.name).toBe("doc-read");
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
