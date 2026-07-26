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
      const path = getSkillPath("market-research-report");
      expect(path).toContain("market-research-report");
    });

    test("does not rewrite legacy skill-prefixed names", () => {
      const path = getSkillPath("skill-deepresearch");
      expect(path).toContain("skill-deepresearch");
    });
  });

  describe("skillExists", () => {
    test("returns true for existing skill", () => {
      expect(skillExists("market-research-report")).toBe(true);
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
      const result = installSkill("market-research-report", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(result.skill).toBe("market-research-report");
      expect(result.mode).toBe("pin");
      expect(result.path).toBeDefined();
      expect(existsSync(join(testDir, ".skills", "project.json"))).toBe(true);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
      const config = JSON.parse(readFileSync(join(testDir, ".skills", "project.json"), "utf-8"));
      expect(config.pinnedSkills).toContain("market-research-report");
    });

    test("creates .skills directory if it does not exist", () => {
      expect(existsSync(join(testDir, ".skills"))).toBe(false);
      installSkill("market-research-report", { targetDir: testDir });
      expect(existsSync(join(testDir, ".skills"))).toBe(true);
    });

    test("does not create index.ts or source exports for pins", () => {
      installSkill("market-research-report", { targetDir: testDir });
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
      installSkill("market-research-report", { targetDir: testDir });
      const result = installSkill("market-research-report", { targetDir: testDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Already pinned");
    });

    test("succeeds with overwrite flag", () => {
      installSkill("market-research-report", { targetDir: testDir });
      const result = installSkill("market-research-report", { targetDir: testDir, overwrite: true });
      expect(result.success).toBe(true);
    });

    test("does not copy .git directory", () => {
      installSkill("market-research-report", { targetDir: testDir });
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
      const manifest = createLocalSkillManifest("logo-design");
      expect(manifest).not.toBeNull();
      expect(manifest?.name).toBe("logo-design");
      expect(manifest?.source).toBe("local");
      expect(manifest?.skillMd).toContain("Logo Design");
      expect(manifest?.metadata?.category).toBe("Design & Branding");
    });

    test("rejects remote manifest installs without writing docs or source files", () => {
      const result = installSkillManifest({
        name: "remote-transcribe",
        version: "1.2.3",
        source: "remote",
        skillMd: "---\nname: remote-transcribe\n---\n\n# Remote Transcribe\n",
        metadata: { category: "Remote Tools", tags: ["remote", "audio-transcript-pack"] },
      }, { targetDir: testDir });

      expect(result.success).toBe(false);
      expect(result.mode).toBe("manifest");
      expect(result.error).toContain("Manifest installs are disabled");
      expect(existsSync(join(testDir, ".skills"))).toBe(false);
    });

    test("source installs are disabled", () => {
      const result = installSkillSource("logo-design", { targetDir: testDir });
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
      const results = installSkills(["market-research-report", "logo-design"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    test("returns mixed results for valid and invalid skills", () => {
      const results = installSkills(["market-research-report", "nonexistent-xyz"], { targetDir: testDir });
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    test("does not create source index for pinned skills", () => {
      installSkills(["market-research-report", "logo-design"], { targetDir: testDir });
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
      installSkill("market-research-report", { targetDir: testDir });
      installSkill("logo-design", { targetDir: testDir });
      const installed = getInstalledSkills(testDir);
      expect(installed).toContain("market-research-report");
      expect(installed).toContain("logo-design");
      expect(installed.length).toBe(2);
    });

    test("does not include non-skill files", () => {
      installSkill("market-research-report", { targetDir: testDir });
      // Create a non-skill file
      writeFileSync(join(testDir, ".skills", "random.txt"), "test");
      const installed = getInstalledSkills(testDir);
      expect(installed.length).toBe(1);
    });
  });

  describe("removeSkill", () => {
    test("unpins a pinned skill", () => {
      installSkill("market-research-report", { targetDir: testDir });
      expect(getInstalledSkills(testDir)).toContain("market-research-report");
      const result = removeSkill("market-research-report", testDir);
      expect(result).toBe(true);
      expect(getInstalledSkills(testDir)).not.toContain("market-research-report");
    });

    test("returns false for non-pinned skill", () => {
      const result = removeSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });

    test("updates project pins after removal", () => {
      installSkills(["market-research-report", "logo-design"], { targetDir: testDir });
      removeSkill("market-research-report", testDir);
      expect(getInstalledSkills(testDir)).not.toContain("market-research-report");
      expect(getInstalledSkills(testDir)).toContain("logo-design");
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);
    });

    test("does not remove when called with legacy skill- prefix", () => {
      installSkill("market-research-report", { targetDir: testDir });
      const result = removeSkill("skill-deepresearch", testDir);
      expect(result).toBe(false);
      expect(getInstalledSkills(testDir)).toContain("market-research-report");
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
        const path = getAgentSkillPath("logo-design", "claude", "project", testDir);
        expect(path).toBe(join(testDir, ".claude", "skills", "logo-design"));
      });

      test("does not rewrite legacy skill-prefixed names", () => {
        const path = getAgentSkillPath("skill-image", "claude", "project", testDir);
        expect(path).toBe(join(testDir, ".claude", "skills", "skill-image"));
      });
    });

    describe("installSkillForAgent", () => {
      test("does not copy SKILL.md into agent skill folders", () => {
        const result = installSkillForAgent("logo-design", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("skills mcp --register claude");
        expect(existsSync(join(testDir, ".claude", "skills", "logo-design", "SKILL.md"))).toBe(false);
      });

      test("does not generate agent skill files", () => {
        const result = installSkillForAgent("market-research-report", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        }, (name) => `---\nname: ${name}\ndescription: test\n---\n\n# Test\n`);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Direct agent skill-folder installs are disabled");
        expect(existsSync(join(testDir, ".claude", "skills", "market-research-report", "SKILL.md"))).toBe(false);
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
          const result = installSkillForAgent("logo-design", {
            agent,
            scope: "project",
            projectDir: testDir,
          });
          const expected = join(testDir, `.${agent}`, "skills", "logo-design", "SKILL.md");
          expect(result.success).toBe(false);
          expect(existsSync(expected)).toBe(false);
        }
      });
    });

    describe("removeSkillForAgent", () => {
      test("is disabled because agent skill folders are unmanaged", () => {
        const result = removeSkillForAgent("logo-design", {
          agent: "claude",
          scope: "project",
          projectDir: testDir,
        });
        expect(result).toBe(false);
        const skillDir = join(testDir, ".claude", "skills", "logo-design");
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
      const result = installSkill("logo-design", { targetDir: testDir });
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      // 2. Verify no skill files were copied
      const skillDir = join(testDir, ".skills", "skills", "logo-design");
      expect(existsSync(skillDir)).toBe(false);
      expect(existsSync(join(testDir, ".skills", "skills"))).toBe(false);

      // 3. Check getInstalledSkills() returns it
      const installed = getInstalledSkills(testDir);
      expect(installed).toContain("logo-design");

      // Also verify index.ts was not generated.
      const indexPath = join(testDir, ".skills", "index.ts");
      expect(existsSync(indexPath)).toBe(false);

      // 4. Remove the skill
      const removed = removeSkill("logo-design", testDir);
      expect(removed).toBe(true);

      // 5. Verify no source directory exists
      expect(existsSync(skillDir)).toBe(false);

      // 6. Verify getInstalledSkills() no longer returns it
      const installedAfter = getInstalledSkills(testDir);
      expect(installedAfter).not.toContain("logo-design");

      expect(existsSync(indexPath)).toBe(false);
    });

    test("lifecycle with multiple skills: install two, remove one, verify state", () => {
      // Install two skills
      const r1 = installSkill("logo-design", { targetDir: testDir });
      const r2 = installSkill("market-research-report", { targetDir: testDir });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      // Both should be listed
      let installed = getInstalledSkills(testDir);
      expect(installed).toContain("logo-design");
      expect(installed).toContain("market-research-report");
      expect(installed.length).toBe(2);

      // Remove one
      const removed = removeSkill("logo-design", testDir);
      expect(removed).toBe(true);

      // Only the other should remain
      installed = getInstalledSkills(testDir);
      expect(installed).not.toContain("logo-design");
      expect(installed).toContain("market-research-report");
      expect(installed.length).toBe(1);

      // Remove the second
      const removed2 = removeSkill("market-research-report", testDir);
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
      installSkill("logo-design", { targetDir: testDir });
      const disabled = getDisabledSkills(testDir);
      expect(disabled).toEqual([]);
    });

    test("disableSkill records disabled state without generating source files", () => {
      installSkills(["logo-design", "market-research-report"], { targetDir: testDir });
      const result = disableSkill("logo-design", testDir);
      expect(result).toBe(true);

      expect(existsSync(join(testDir, ".skills", "index.ts"))).toBe(false);
      expect(getInstalledSkills(testDir)).toEqual(["logo-design", "market-research-report"]);
      expect(getDisabledSkills(testDir)).toContain("logo-design");
    });

    test("disableSkill returns false for already disabled skill", () => {
      installSkill("logo-design", { targetDir: testDir });
      disableSkill("logo-design", testDir);
      const result = disableSkill("logo-design", testDir);
      expect(result).toBe(false);
    });

    test("disableSkill returns false for non-installed skill", () => {
      const result = disableSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });

    test("enableSkill clears disabled state without generating source files", () => {
      installSkills(["logo-design", "market-research-report"], { targetDir: testDir });
      disableSkill("logo-design", testDir);
      const result = enableSkill("logo-design", testDir);
      expect(result).toBe(true);

      expect(existsSync(join(testDir, ".skills", "index.ts"))).toBe(false);
      expect(getInstalledSkills(testDir)).toEqual(["logo-design", "market-research-report"]);
      expect(getDisabledSkills(testDir)).not.toContain("logo-design");
    });

    test("enableSkill returns false for non-disabled skill", () => {
      installSkill("logo-design", { targetDir: testDir });
      const result = enableSkill("logo-design", testDir);
      expect(result).toBe(false);
    });

    test("enableSkill returns false for non-installed skill", () => {
      const result = enableSkill("nonexistent-xyz", testDir);
      expect(result).toBe(false);
    });
  });

  describe("getInstallMeta", () => {
    test("returns empty skills object initially", () => {
      installSkill("logo-design", { targetDir: testDir });
      const meta = getInstallMeta(testDir);
      expect(meta).toHaveProperty("skills");
      expect(meta.skills).toHaveProperty("logo-design");
      expect(meta.skills["logo-design"]).toHaveProperty("installedAt");
      expect(typeof meta.skills["logo-design"].installedAt).toBe("string");
    });

    test("meta tracks installedAt timestamp", () => {
      const before = new Date().toISOString();
      installSkill("market-research-report", { targetDir: testDir });
      const meta = getInstallMeta(testDir);
      expect(meta.skills["market-research-report"].installedAt).toBeDefined();
      expect(meta.skills["market-research-report"].installedAt >= before).toBe(true);
    });

    test("meta no longer contains removed skill", () => {
      installSkill("logo-design", { targetDir: testDir });
      removeSkill("logo-design", testDir);
      const meta = getInstallMeta(testDir);
      expect(meta.skills["logo-design"]).toBeUndefined();
    });
  });
});
