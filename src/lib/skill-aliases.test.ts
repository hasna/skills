import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, removeSkill, skillExists } from "./installer.js";
import { getSkill, SKILLS } from "./registry.js";
import { SKILL_ALIASES, normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";

describe("skill aliases", () => {
  test("normalizes skill aliases without skill prefix", () => {
    expect(normalizeSkillSlug("transcribe")).toBe("transcribe");
    expect(resolveSkillAlias("transcribe")).toBe("transcript");
    expect(resolveSkillAlias("generate-pdf")).toBe("pdf-generate");
    expect(resolveSkillAlias("create-blog-article")).toBe("blog-article");
  });

  test("aliases target existing skills and do not shadow exact skills", () => {
    const names = new Set(SKILLS.map((skill) => skill.name));
    for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
      expect(names.has(canonical)).toBe(true);
      expect(names.has(alias)).toBe(false);
    }
  });

  test("getSkill resolves legacy aliases to canonical skills", () => {
    expect(getSkill("transcribe")?.name).toBe("transcript");
    expect(getSkill("generate-pdf")?.name).toBe("pdf-generate");
    expect(getSkill("create-blog-article")?.name).toBe("blog-article");
    expect(getSkill("pdf-read")?.name).toBe("pdf-read");
  });

  test("pin and unpin accept aliases but use canonical project pins", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-alias-install-"));
    try {
      const result = installSkill("transcribe", { targetDir: dir });
      expect(result.success).toBe(true);
      expect(result.skill).toBe("transcript");
      const config = JSON.parse(readFileSync(join(dir, ".skills", "project.json"), "utf8"));
      expect(config.pinnedSkills).toContain("transcript");
      expect(config.pinnedSkills).not.toContain("transcribe");
      expect(existsSync(join(dir, ".skills", "skills"))).toBe(false);
      expect(skillExists("transcribe")).toBe(true);
      expect(removeSkill("transcribe", dir)).toBe(true);
      const nextConfig = JSON.parse(readFileSync(join(dir, ".skills", "project.json"), "utf8"));
      expect(nextConfig.pinnedSkills).not.toContain("transcript");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
