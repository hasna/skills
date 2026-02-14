import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getSkillPath,
  skillExists,
  installSkill,
  installSkills,
  getInstalledSkills,
  removeSkill,
  getAgentSkillsDir,
  getAgentSkillPath,
  installSkillForAgent,
  removeSkillForAgent,
  AGENT_TARGETS,
} from "./installer";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "skills-test-"));
});

afterEach(() => {
  const { rmSync } = require("fs");
  rmSync(testDir, { recursive: true, force: true });
});

describe("installer", () => {
  describe("getSkillPath", () => {
    test("returns path for skill name without prefix", () => {
      const path = getSkillPath("deep-research");
      expect(path).toContain("skill-deep-research");
    });

    test("returns path for skill name with prefix", () => {
      const path = getSkillPath("skill-deep-research");
      expect(path).toContain("skill-deep-research");
      // Should not double-prefix
      expect(path).not.toContain("skill-skill-");
    });
  });

  describe("skillExists", () => {
    test("returns true for existing skill", () => {
      expect(skillExists("deep-research")).toBe(true);
    });

    test("returns true with skill- prefix", () => {
      expect(skillExists("skill-deep-research")).toBe(true);
    });

    test("returns false for nonexistent skill", () => {
      expect(skillExists("nonexistent-skill-xyz")).toBe(false);
    });
  });

  describe("installSkill", () => {
    test("installs a skill to target directory", () => {
      const result = installSkill("deep-research", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(result.skill).toBe("deep-research");
      expect(result.path).toBeDefined();
      expect(existsSync(join(testDir, ".skills", "skill-deep-research"))).toBe(true);
    });

    test("creates .skills directory if it does not exist", () => {
      expect(existsSync(join(testDir, ".skills"))).toBe(false);
      installSkill("deep-research", { targetDir: testDir });
      expect(existsSync(join(testDir, ".skills"))).toBe(true);
    });

    test("creates index.ts in .skills directory", () => {
      installSkill("deep-research", { targetDir: testDir });
      const indexPath = join(testDir, ".skills", "index.ts");
      expect(existsSync(indexPath)).toBe(true);
      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("deep_research");
      expect(content).toContain("skill-deep-research");
    });

    test("fails for nonexistent skill", () => {
      const result = installSkill("nonexistent-xyz", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("fails if already installed without overwrite", () => {
      installSkill("deep-research", { targetDir: testDir });
      const result = installSkill("deep-research", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Already installed");
    });

    test("succeeds with overwrite flag", () => {
      installSkill("deep-research", { targetDir: testDir });
      const result = installSkill("deep-research", { targetDir: testDir, overwrite: true });
      expect(result.success).toBe(true);
    });

    test("does not copy .git directory", () => {
      installSkill("deep-research", { targetDir: testDir });
      const gitDir = join(testDir, ".skills", "skill-deep-research", ".git");
      expect(existsSync(gitDir)).toBe(false);
    });

    test("handles skill- prefix in name", () => {
      const result = installSkill("skill-deep-research", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(existsSync(join(testDir, ".skills", "skill-deep-research"))).toBe(true);
    });
  });

  describe("installSkills", () => {
    test("installs multiple skills", () => {
      const results = installSkills(["deep-research", "image"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    test("returns mixed results for valid and invalid skills", () => {
      const results = installSkills(["deep-research", "nonexistent-xyz"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    test("index.ts contains all installed skills", () => {
      installSkills(["deep-research", "image"], { targetDir: testDir });
      const content = readFileSync(join(testDir, ".skills", "index.ts"), "utf-8");
      expect(content).toContain("deep_research");
      expect(content).toContain("image");
    });
  });

  describe("getInstalledSkills", () => {
    test("returns empty array when no skills installed", () => {
      const installed = getInstalledSkills(testDir);
      expect(installed).toEqual([]);
    });

    test("returns empty array when .skills directory does not exist", () => {
      const noDir = join(testDir, "nonexistent");
      const installed = getInstalledSkills(noDir);
      expect(installed).toEqual([]);
    });

    test("returns installed skill names without prefix", () => {
      installSkill("deep-research", { targetDir: testDir });
      installSkill("image", { targetDir: testDir });
      const installed = getInstalledSkills(testDir);
      expect(installed).toContain("deep-research");
      expect(installed).toContain("image");
      expect(installed.length).toBe(2);
    });

    test("does not include non-skill files", () => {
      installSkill("deep-research", { targetDir: testDir });
      // Create a non-skill file
      writeFileSync(join(testDir, ".skills", "random.txt"), "test");
      const installed = getInstalledSkills(testDir);
      expect(installed.length).toBe(1);
    });
  });

  describe("removeSkill", () => {
    test("removes an installed skill", () => {
      installSkill("deep-research", { targetDir: testDir });
      expect(getInstalledSkills(testDir)).toContain("deep-research");
      const result = removeSkill("deep-research", testDir);
      expect(result).toBe(true);
      expect(getInstalledSkills(testDir)).not.toContain("deep-research");
    });

    test("returns false for non-installed skill", () => {
      const result = removeSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });

    test("updates index.ts after removal", () => {
      installSkills(["deep-research", "image"], { targetDir: testDir });
      removeSkill("deep-research", testDir);
      const content = readFileSync(join(testDir, ".skills", "index.ts"), "utf-8");
      expect(content).not.toContain("deep_research");
      expect(content).toContain("image");
    });

    test("handles skill- prefix in name", () => {
      installSkill("deep-research", { targetDir: testDir });
      const result = removeSkill("skill-deep-research", testDir);
      expect(result).toBe(true);
      expect(getInstalledSkills(testDir)).not.toContain("deep-research");
    });
  });

  describe("agent install", () => {
    test("AGENT_TARGETS contains all three agents", () => {
      expect(AGENT_TARGETS).toContain("claude");
      expect(AGENT_TARGETS).toContain("codex");
      expect(AGENT_TARGETS).toContain("gemini");
      expect(AGENT_TARGETS.length).toBe(3);
    });

    describe("getAgentSkillsDir", () => {
      test("returns global path for claude", () => {
        const dir = getAgentSkillsDir("claude", "global");
        expect(dir).toContain(".claude/skills");
      });

      test("returns project path for claude", () => {
        const dir = getAgentSkillsDir("claude", "project", testDir);
        expect(dir).toBe(join(testDir, ".claude", "skills"));
      });

      test("returns global path for codex", () => {
        const dir = getAgentSkillsDir("codex", "global");
        expect(dir).toContain(".codex/skills");
      });

      test("returns global path for gemini", () => {
        const dir = getAgentSkillsDir("gemini", "global");
        expect(dir).toContain(".gemini/skills");
      });
    });

    describe("getAgentSkillPath", () => {
      test("returns correct path with skill- prefix", () => {
        const path = getAgentSkillPath("image", "claude", "project", testDir);
        expect(path).toBe(join(testDir, ".claude", "skills", "skill-image"));
      });

      test("does not double-prefix", () => {
        const path = getAgentSkillPath("skill-image", "claude", "project", testDir);
        expect(path).toContain("skill-image");
        expect(path).not.toContain("skill-skill-");
      });
    });

    describe("installSkillForAgent", () => {
      test("installs SKILL.md for a skill that has one", () => {
        const result = installSkillForAgent("image", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(true);
        expect(result.path).toBeDefined();
        const skillMdPath = join(result.path!, "SKILL.md");
        expect(existsSync(skillMdPath)).toBe(true);
        const content = readFileSync(skillMdPath, "utf-8");
        expect(content).toContain("Image Generation");
      });

      test("generates SKILL.md when skill lacks one", () => {
        const result = installSkillForAgent("deep-research", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        }, (name) => `---\nname: ${name}\ndescription: test\n---\n\n# Test\n`);
        expect(result.success).toBe(true);
        const skillMdPath = join(result.path!, "SKILL.md");
        expect(existsSync(skillMdPath)).toBe(true);
      });

      test("fails without generator when skill has no SKILL.md", () => {
        // deep-research has no SKILL.md
        const result = installSkillForAgent("deep-research", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("SKILL.md");
      });

      test("fails for nonexistent skill", () => {
        const result = installSkillForAgent("nonexistent-xyz", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      });

      test("installs to correct agent directory", () => {
        for (const agent of AGENT_TARGETS) {
          installSkillForAgent("image", {
            agent,
            scope: "project",
            projectDir: testDir,
          });
          const expected = join(testDir, `.${agent}`, "skills", "skill-image", "SKILL.md");
          expect(existsSync(expected)).toBe(true);
        }
      });
    });

    describe("removeSkillForAgent", () => {
      test("removes an installed skill", () => {
        installSkillForAgent("image", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        const result = removeSkillForAgent("image", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result).toBe(true);
        const skillDir = join(testDir, ".claude", "skills", "skill-image");
        expect(existsSync(skillDir)).toBe(false);
      });

      test("returns false for non-installed skill", () => {
        const result = removeSkillForAgent("nonexistent-xyz", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result).toBe(false);
      });
    });
  });
});
