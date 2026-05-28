import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getSkillPath,
  skillExists,
  installSkill,
  installSkillSource,
  installSkillManifest,
  createLocalSkillManifest,
  installSkills,
  getInstalledSkills,
  getInstallMeta,
  removeSkill,
  getAgentSkillsDir,
  getAgentSkillPath,
  installSkillForAgent,
  removeSkillForAgent,
  disableSkill,
  enableSkill,
  getDisabledSkills,
  getInstallMeta,
  AGENT_TARGETS,
  resolveAgents,
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
      const path = getSkillPath("deepresearch");
      expect(path).toContain("deepresearch");
    });

    test("does not rewrite legacy skill-prefixed names", () => {
      const path = getSkillPath("skill-deepresearch");
      expect(path).toContain("skill-deepresearch");
    });
  });

  describe("skillExists", () => {
    test("returns true for existing skill", () => {
      expect(skillExists("deepresearch")).toBe(true);
    });

    test("returns false with legacy skill- prefix", () => {
      expect(skillExists("skill-deepresearch")).toBe(false);
    });

    test("returns false for nonexistent skill", () => {
      expect(skillExists("nonexistent-skill-xyz")).toBe(false);
    });
  });

  describe("installSkill", () => {
    test("pins a skill to project.json without copying source", () => {
      const result = installSkill("deepresearch", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(result.skill).toBe("deepresearch");
      expect(result.mode).toBe("pin");
      expect(result.path).toBeDefined();
      expect(existsSync(join(testDir, ".skills", "project.json"))).toBe(true);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
      const config = JSON.parse(readFileSync(join(testDir, ".skills", "project.json"), "utf-8"));
      expect(config.pinnedSkills).toContain("deepresearch");
    });

    test("creates .skills directory if it does not exist", () => {
      expect(existsSync(join(testDir, ".skills"))).toBe(false);
      installSkill("deepresearch", { targetDir: testDir });
      expect(existsSync(join(testDir, ".skills"))).toBe(true);
    });

    test("does not create index.ts or source exports for pins", () => {
      installSkill("deepresearch", { targetDir: testDir });
      const indexPath = join(testDir, ".skills", "index.ts");
      expect(existsSync(indexPath)).toBe(false);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });

    test("fails for nonexistent skill", () => {
      const result = installSkill("nonexistent-xyz", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("fails if already installed without overwrite", () => {
      installSkill("deepresearch", { targetDir: testDir });
      const result = installSkill("deepresearch", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Already pinned");
    });

    test("succeeds with overwrite flag", () => {
      installSkill("deepresearch", { targetDir: testDir });
      const result = installSkill("deepresearch", { targetDir: testDir, overwrite: true });
      expect(result.success).toBe(true);
    });

    test("does not copy .git directory", () => {
      installSkill("deepresearch", { targetDir: testDir });
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });

    test("rejects legacy skill- prefix in name", () => {
      const result = installSkill("skill-deepresearch", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });
  });

  describe("manifest installs", () => {
    test("creates a local manifest from a bundled skill", () => {
      const manifest = createLocalSkillManifest("image");
      expect(manifest).not.toBeNull();
      expect(manifest?.name).toBe("image");
      expect(manifest?.source).toBe("local");
      expect(manifest?.skillMd).toContain("Image Generation");
      expect(manifest?.metadata?.category).toBe("Content Generation");
    });

    test("rejects remote manifest installs without writing docs or source files", () => {
      const result = installSkillManifest({
        name: "remote-transcribe",
        version: "1.2.3",
        source: "remote",
        skillMd: "---\nname: remote-transcribe\n---\n\n# Remote Transcribe\n",
        metadata: { category: "Remote Tools", tags: ["remote", "audio"] },
      }, { targetDir: testDir });

      expect(result.success).toBe(false);
      expect(result.mode).toBe("manifest");
      expect(result.error).toContain("Manifest installs are disabled");
      expect(existsSync(join(testDir, ".skills"))).toBe(false);
    });

    test("source installs are disabled", () => {
      const result = installSkillSource("image", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Source installs are disabled");
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });

    test("manifest install remains disabled even with overwrite", () => {
      const first = installSkillManifest({ name: "remote-demo", skillMd: "# Remote Demo\n" }, { targetDir: testDir });
      const second = installSkillManifest({ name: "remote-demo", skillMd: "# Remote Demo\n" }, { targetDir: testDir });
      const third = installSkillManifest({ name: "remote-demo", skillMd: "# Remote Demo Updated\n" }, { targetDir: testDir, overwrite: true });

      expect(first.success).toBe(false);
      expect(second.success).toBe(false);
      expect(third.success).toBe(false);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });
  });

  describe("installSkill dependency warnings", () => {
    test("warns when a dependency is not installed", () => {
      // scancommitpr depends on scancommitpush — install only scancommitpr
      const warnSpy: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnSpy.push(msg);
      try {
        const result = installSkill("scancommitpr", { targetDir: testDir });
        expect(result.success).toBe(true);
        expect(warnSpy.some((m) => m.includes("scancommitpush") && m.includes("not pinned"))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    test("does not warn when dependency is already installed", () => {
      // Install the dependency first, then the dependent skill
      installSkill("scancommitpush", { targetDir: testDir });
      const warnSpy: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnSpy.push(msg);
      try {
        const result = installSkill("scancommitpr", { targetDir: testDir });
        expect(result.success).toBe(true);
        expect(warnSpy.some((m) => m.includes("scancommitpush") && m.includes("not pinned"))).toBe(false);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("installSkills", () => {
    test("installs multiple skills", () => {
      const results = installSkills(["deepresearch", "image"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    test("returns mixed results for valid and invalid skills", () => {
      const results = installSkills(["deepresearch", "nonexistent-xyz"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    test("does not create source index for pinned skills", () => {
      installSkills(["deepresearch", "image"], { targetDir: testDir });
      expect(existsSync(join(testDir, ".skills", "index.ts"))).toBe(false);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });
  });

  describe("getInstalledSkills", () => {
    test("returns empty array when no skills are pinned", () => {
      const installed = getInstalledSkills(testDir);
      expect(installed).toEqual([]);
    });

    test("returns empty array when .skills directory does not exist", () => {
      const noDir = join(testDir, "nonexistent");
      const installed = getInstalledSkills(noDir);
      expect(installed).toEqual([]);
    });

    test("returns pinned skill names without prefix", () => {
      installSkill("deepresearch", { targetDir: testDir });
      installSkill("image", { targetDir: testDir });
      const installed = getInstalledSkills(testDir);
      expect(installed).toContain("deepresearch");
      expect(installed).toContain("image");
      expect(installed.length).toBe(2);
    });

    test("does not include non-skill files", () => {
      installSkill("deepresearch", { targetDir: testDir });
      // Create a non-skill file
      writeFileSync(join(testDir, ".skills", "random.txt"), "test");
      const installed = getInstalledSkills(testDir);
      expect(installed.length).toBe(1);
    });
  });

  describe("removeSkill", () => {
    test("unpins a pinned skill", () => {
      installSkill("deepresearch", { targetDir: testDir });
      expect(getInstalledSkills(testDir)).toContain("deepresearch");
      const result = removeSkill("deepresearch", testDir);
      expect(result).toBe(true);
      expect(getInstalledSkills(testDir)).not.toContain("deepresearch");
    });

    test("returns false for non-pinned skill", () => {
      const result = removeSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });

    test("updates project pins after removal", () => {
      installSkills(["deepresearch", "image"], { targetDir: testDir });
      removeSkill("deepresearch", testDir);
      expect(getInstalledSkills(testDir)).not.toContain("deepresearch");
      expect(getInstalledSkills(testDir)).toContain("image");
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });

    test("does not remove when called with legacy skill- prefix", () => {
      installSkill("deepresearch", { targetDir: testDir });
      const result = removeSkill("skill-deepresearch", testDir);
      expect(result).toBe(false);
      expect(getInstalledSkills(testDir)).toContain("deepresearch");
    });
  });

  describe("agent install", () => {
    test("AGENT_TARGETS contains all supported agents", () => {
      expect(AGENT_TARGETS).toContain("claude");
      expect(AGENT_TARGETS).toContain("codex");
      expect(AGENT_TARGETS).toContain("gemini");
      expect(AGENT_TARGETS).toContain("pi");
      expect(AGENT_TARGETS).toContain("opencode");
      expect(AGENT_TARGETS.length).toBe(7);
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

      test("returns current global path for opencode", () => {
        const dir = getAgentSkillsDir("opencode", "global");
        expect(dir).toContain(".config/opencode/skills");
      });
    });

    describe("getAgentSkillPath", () => {
      test("returns correct path with bare skill name", () => {
        const path = getAgentSkillPath("image", "claude", "project", testDir);
        expect(path).toBe(join(testDir, ".claude", "skills", "image"));
      });

      test("does not rewrite legacy skill-prefixed names", () => {
        const path = getAgentSkillPath("skill-image", "claude", "project", testDir);
        expect(path).toBe(join(testDir, ".claude", "skills", "skill-image"));
      });
    });

    describe("installSkillForAgent", () => {
      test("does not copy SKILL.md into agent skill folders", () => {
        const result = installSkillForAgent("image", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("skills mcp --register claude");
        expect(existsSync(join(testDir, ".claude", "skills", "image", "SKILL.md"))).toBe(false);
      });

      test("does not generate agent skill files", () => {
        const result = installSkillForAgent("deepresearch", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        }, (name) => `---\nname: ${name}\ndescription: test\n---\n\n# Test\n`);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Direct agent skill-folder installs are disabled");
        expect(existsSync(join(testDir, ".claude", "skills", "deepresearch", "SKILL.md"))).toBe(false);
      });

      test("still rejects nonexistent skills", () => {
        const result = installSkillForAgent("nonexistent-xyz", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      });

      test("never writes to any supported agent directory", () => {
        for (const agent of AGENT_TARGETS) {
          const result = installSkillForAgent("image", {
            agent,
            scope: "project",
            projectDir: testDir,
          });
          const expected = join(testDir, `.${agent}`, "skills", "image", "SKILL.md");
          expect(result.success).toBe(false);
          expect(existsSync(expected)).toBe(false);
        }
      });
    });

    describe("removeSkillForAgent", () => {
      test("is disabled because agent skill folders are unmanaged", () => {
        const result = removeSkillForAgent("image", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result).toBe(false);
        const skillDir = join(testDir, ".claude", "skills", "image");
        expect(existsSync(skillDir)).toBe(false);
      });

      test("returns false for non-pinned skill", () => {
        const result = removeSkillForAgent("nonexistent-xyz", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result).toBe(false);
      });
    });
  });

  describe("install/use/remove lifecycle", () => {
    test("full lifecycle: install → verify → list → remove → verify cleanup", () => {
      // 1. Install a skill to a temp directory
      const result = installSkill("image", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      // 2. Verify no skill files were copied
      const skillDir = join(testDir, ".skills", "skills", "image");
      expect(existsSync(skillDir)).toBe(false);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);

      // 3. Check getInstalledSkills() returns it
      const installed = getInstalledSkills(testDir);
      expect(installed).toContain("image");

      // Also verify index.ts was not generated.
      const indexPath = join(testDir, ".skills", "index.ts");
      expect(existsSync(indexPath)).toBe(false);

      // 4. Remove the skill
      const removed = removeSkill("image", testDir);
      expect(removed).toBe(true);

      // 5. Verify no source directory exists
      expect(existsSync(skillDir)).toBe(false);

      // 6. Verify getInstalledSkills() no longer returns it
      const installedAfter = getInstalledSkills(testDir);
      expect(installedAfter).not.toContain("image");

      expect(existsSync(indexPath)).toBe(false);
    });

    test("lifecycle with multiple skills: install two, remove one, verify state", () => {
      // Install two skills
      const r1 = installSkill("image", { targetDir: testDir });
      const r2 = installSkill("deepresearch", { targetDir: testDir });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      // Both should be listed
      let installed = getInstalledSkills(testDir);
      expect(installed).toContain("image");
      expect(installed).toContain("deepresearch");
      expect(installed.length).toBe(2);

      // Remove one
      const removed = removeSkill("image", testDir);
      expect(removed).toBe(true);

      // Only the other should remain
      installed = getInstalledSkills(testDir);
      expect(installed).not.toContain("image");
      expect(installed).toContain("deepresearch");
      expect(installed.length).toBe(1);

      // Remove the second
      const removed2 = removeSkill("deepresearch", testDir);
      expect(removed2).toBe(true);

      installed = getInstalledSkills(testDir);
      expect(installed.length).toBe(0);
    });
  });

  describe("resolveAgents", () => {
    test("returns all agents for 'all'", () => {
      const agents = resolveAgents("all");
      expect(agents).toEqual(["claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf"]);
    });

    test("returns single agent for valid name", () => {
      expect(resolveAgents("claude")).toEqual(["claude"]);
      expect(resolveAgents("codex")).toEqual(["codex"]);
      expect(resolveAgents("gemini")).toEqual(["gemini"]);
    });

    test("throws for unknown agent", () => {
      expect(() => resolveAgents("invalid-agent")).toThrow("Unknown agent");
    });
  });

  describe("disableSkill / enableSkill / getDisabledSkills", () => {
    test("getDisabledSkills returns empty array initially", () => {
      installSkill("image", { targetDir: testDir });
      const disabled = getDisabledSkills(testDir);
      expect(disabled).toEqual([]);
    });

    test("disableSkill excludes skill from index.ts", () => {
      installSkills(["image", "deepresearch"], { targetDir: testDir });
      const result = disableSkill("image", testDir);
      expect(result).toBe(true);

      // Check index.ts no longer references image but still has deepresearch
      const content = readFileSync(join(testDir, ".skills", "index.ts"), "utf-8");
      expect(content).not.toContain("skill-image");
      expect(content).toContain("skill-deepresearch");

      // Check getDisabledSkills returns it
      expect(getDisabledSkills(testDir)).toContain("image");
    });

    test("disableSkill returns false for already disabled skill", () => {
      installSkill("image", { targetDir: testDir });
      disableSkill("image", testDir);
      const result = disableSkill("image", testDir);
      expect(result).toBe(false);
    });

    test("disableSkill returns false for non-installed skill", () => {
      const result = disableSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });

    test("enableSkill re-adds skill to index.ts", () => {
      installSkills(["image", "deepresearch"], { targetDir: testDir });
      disableSkill("image", testDir);
      const result = enableSkill("image", testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, ".skills", "index.ts"), "utf-8");
      expect(content).toContain("skill-image");
      expect(content).toContain("skill-deepresearch");
      expect(getDisabledSkills(testDir)).not.toContain("image");
    });

    test("enableSkill returns false for non-disabled skill", () => {
      installSkill("image", { targetDir: testDir });
      const result = enableSkill("image", testDir);
      expect(result).toBe(false);
    });

    test("enableSkill returns false for non-installed skill", () => {
      const result = enableSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });
  });

  describe("getInstallMeta", () => {
    test("returns empty skills object initially", () => {
      installSkill("image", { targetDir: testDir });
      const meta = getInstallMeta(testDir);
      expect(meta).toHaveProperty("skills");
      expect(meta.skills).toHaveProperty("image");
      expect(meta.skills.image).toHaveProperty("installedAt");
      expect(typeof meta.skills.image.installedAt).toBe("string");
    });

    test("meta tracks installedAt timestamp", () => {
      const before = new Date().toISOString();
      installSkill("deepresearch", { targetDir: testDir });
      const meta = getInstallMeta(testDir);
      expect(meta.skills.deepresearch.installedAt).toBeDefined();
      expect(meta.skills.deepresearch.installedAt >= before).toBe(true);
    });

    test("meta no longer contains removed skill", () => {
      installSkill("image", { targetDir: testDir });
      removeSkill("image", testDir);
      const meta = getInstallMeta(testDir);
      expect(meta.skills.image).toBeUndefined();
    });
  });
});
