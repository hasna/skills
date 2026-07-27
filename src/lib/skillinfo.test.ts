import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  getSkillDependencyStatus,
  generateEnvExample,
  generateSkillMd,
  detectProjectSkills,
} from "./skillinfo";
import { INSTALLED_SKILLS_DIRNAME } from "./config";
import { installSkill } from "./installer";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "skillinfo-test-"));
});

afterEach(() => {
  const { rmSync } = require("fs");
  rmSync(testDir, { recursive: true, force: true });
});

describe("skillinfo", () => {
  describe("getSkillDocs", () => {
    test("returns docs for skill with SKILL.md", () => {
      const docs = getSkillDocs("logo-design");
      expect(docs).not.toBeNull();
      expect(docs!.skillMd).toBeTruthy();
      expect(docs!.skillMd).toContain("Logo Design");
    });

    test("returns docs for skill with CLAUDE.md only", () => {
      const docs = getSkillDocs("apidocs");
      expect(docs).not.toBeNull();
      expect(docs!.claudeMd).toBeTruthy();
    });

    test("returns null for nonexistent skill", () => {
      const docs = getSkillDocs("nonexistent-xyz");
      expect(docs).toBeNull();
    });

    test("returns null fields for missing doc files", () => {
      const docs = getSkillDocs("scaffold-project");
      expect(docs).not.toBeNull();
      // At least one doc exists
      const hasAny = docs!.skillMd || docs!.readme || docs!.claudeMd;
      // scaffold-project has CLAUDE.md at minimum
      expect(docs!.claudeMd).toBeTruthy();
    });
  });

  describe("getSkillBestDoc", () => {
    test("returns SKILL.md when available", () => {
      const doc = getSkillBestDoc("logo-design");
      expect(doc).toBeTruthy();
      expect(doc).toContain("Logo Design");
    });

    test("falls back to CLAUDE.md", () => {
      const doc = getSkillBestDoc("apidocs");
      expect(doc).toBeTruthy();
    });

    test("returns null for nonexistent skill", () => {
      const doc = getSkillBestDoc("nonexistent-xyz");
      expect(doc).toBeNull();
    });
  });

  describe("getSkillRequirements", () => {
    test("surfaces the provider key a BYO-key skill actually reads", () => {
      const reqs = getSkillRequirements("audio-transcript-pack");
      expect(reqs).not.toBeNull();
      expect(reqs!.envVars).not.toContain("SKILLS_API_KEY");
      expect(reqs!.envVars).not.toContain("SKILL_API_KEY");
      expect(reqs!.envVars).toContain("OPENAI_API_KEY");
      expect(reqs!.envVars).not.toContain("GEMINI_API_KEY");
      expect(reqs!.envVars).not.toContain("XAI_API_KEY");
      expect(reqs!.envVars).not.toContain("GOOGLE_PROJECT_ID");
    });

    test("preserves provider API keys for free local skills", () => {
      const reqs = getSkillRequirements("brand-style-guide");
      expect(reqs).not.toBeNull();
      expect(reqs!.envVars).toContain("OPENAI_API_KEY");
      expect(reqs!.envVars).not.toContain("SKILLS_API_KEY");
    });

    test("extracts CLI command from package.json", () => {
      const reqs = getSkillRequirements("audio-transcript-pack");
      expect(reqs).not.toBeNull();
      expect(reqs!.cliCommand).toBe("skills run audio-transcript-pack");
    });

    test("extracts CLI command for a hosted report skill", () => {
      const reqs = getSkillRequirements("market-research-report");
      expect(reqs).not.toBeNull();
      expect(reqs!.cliCommand).toBe("skills run market-research-report");
    });

    test("returns null for nonexistent skill", () => {
      const reqs = getSkillRequirements("nonexistent-xyz");
      expect(reqs).toBeNull();
    });

    test("returns sorted env vars", () => {
      const reqs = getSkillRequirements("audio-transcript-pack");
      expect(reqs).not.toBeNull();
      const vars = reqs!.envVars;
      const sorted = [...vars].sort();
      expect(vars).toEqual(sorted);
    });

    test("extracts dependencies from package.json", () => {
      const reqs = getSkillRequirements("read-csv");
      expect(reqs).not.toBeNull();
      expect(reqs!.dependencies).toHaveProperty("csv-parse");
    });
  });

  describe("getSkillDependencyStatus", () => {
    // Regression: doctor/test previously computed readiness only from env vars
    // and system deps, never verifying that a skill's npm dependencies were
    // installed — so a runnable skill like `excel` (which needs `xlsx`) could
    // report a false-green readiness while being unable to run at all.
    let prevSkillsDir: string | undefined;
    let skillsRoot: string;

    beforeEach(() => {
      prevSkillsDir = process.env.HASNA_SKILLS_DIR;
      skillsRoot = mkdtempSync(join(tmpdir(), "skills-dep-root-"));
      process.env.HASNA_SKILLS_DIR = skillsRoot;
    });

    afterEach(() => {
      const { rmSync } = require("fs");
      if (prevSkillsDir === undefined) delete process.env.HASNA_SKILLS_DIR;
      else process.env.HASNA_SKILLS_DIR = prevSkillsDir;
      rmSync(skillsRoot, { recursive: true, force: true });
    });

    function scaffold(name: string, deps: Record<string, string>): string {
      // Written into the corpus, not the app root: placing it at the root would
      // make this test depend on the layout migration copying it - including its
      // node_modules fixture - on every resolution.
      const dir = join(skillsRoot, INSTALLED_SKILLS_DIRNAME, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, version: "0.1.0", dependencies: deps }),
      );
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}\n`);
      return dir;
    }

    function installDep(dir: string, pkgName: string): void {
      const modDir = join(dir, "node_modules", pkgName);
      mkdirSync(modDir, { recursive: true });
      writeFileSync(
        join(modDir, "package.json"),
        JSON.stringify({ name: pkgName, version: "1.3.0" }),
      );
    }

    test("flags declared npm deps as not installed when node_modules is missing", () => {
      scaffold("dep-fixture", { "left-pad": "^1.3.0" });
      const status = getSkillDependencyStatus("dep-fixture");
      expect(status).toEqual([{ name: "left-pad", version: "^1.3.0", installed: false }]);
    });

    test("reports a dep as installed once resolvable from the skill dir", () => {
      const dir = scaffold("dep-fixture-installed", { "left-pad": "^1.3.0" });
      installDep(dir, "left-pad");
      const status = getSkillDependencyStatus("dep-fixture-installed");
      expect(status).toEqual([{ name: "left-pad", version: "^1.3.0", installed: true }]);
    });

    test("resolves deps hoisted into an ancestor node_modules", () => {
      scaffold("dep-fixture-hoisted", { "left-pad": "^1.3.0" });
      installDep(skillsRoot, "left-pad");
      const status = getSkillDependencyStatus("dep-fixture-hoisted");
      expect(status.find((d) => d.name === "left-pad")?.installed).toBe(true);
    });

    test("reports mixed install status across multiple deps", () => {
      const dir = scaffold("dep-fixture-mixed", { "left-pad": "^1.3.0", "right-pad": "^2.0.0" });
      installDep(dir, "left-pad");
      const status = getSkillDependencyStatus("dep-fixture-mixed");
      const byName = Object.fromEntries(status.map((d) => [d.name, d.installed]));
      expect(byName["left-pad"]).toBe(true);
      expect(byName["right-pad"]).toBe(false);
      // Readiness must be false while any dep is missing — the core false-green fix.
      expect(status.every((d) => d.installed)).toBe(false);
    });

    test("returns an empty list for a skill with no dependencies", () => {
      scaffold("dep-fixture-none", {});
      expect(getSkillDependencyStatus("dep-fixture-none")).toEqual([]);
    });
  });

  describe("generateEnvExample", () => {
    test("returns empty string when no skills are pinned", () => {
      const result = generateEnvExample(testDir);
      expect(result).toBe("");
    });

    test("returns empty string when .skills dir does not exist", () => {
      const result = generateEnvExample(join(testDir, "nonexistent"));
      expect(result).toBe("");
    });

    test("generates env example from pinned skills", () => {
      installSkill("audio-transcript-pack", { targetDir: testDir });
      const result = generateEnvExample(testDir);
      expect(result).toContain("OPENAI_API_KEY");
      expect(result).not.toContain("SKILL_API_KEY");
      expect(result).toContain("# Used by: audio-transcript-pack");
    });

    test("includes header comments", () => {
      installSkill("audio-transcript-pack", { targetDir: testDir });
      const result = generateEnvExample(testDir);
      expect(result).toContain("# Environment variables for pinned skills");
      expect(result).toContain("# Auto-generated by: skills init");
    });

    test("groups by provider prefix", () => {
      installSkill("audio-transcript-pack", { targetDir: testDir });
      const result = generateEnvExample(testDir);
      expect(result).toContain("# OPENAI");
      expect(result).not.toContain("# GEMINI");
    });
  });

  describe("generateSkillMd", () => {
    test("generates SKILL.md for a skill without one", () => {
      const md = generateSkillMd("market-research-report");
      expect(md).not.toBeNull();
      expect(md!).toContain("---");
      expect(md!).toContain("name: market-research-report");
      expect(md!).toContain("description:");
      expect(md!).toContain("Market Research Report");
    });

    test("generates SKILL.md for a skill with existing SKILL.md source", () => {
      // logo-design has a SKILL.md, but generateSkillMd still works
      const md = generateSkillMd("logo-design");
      expect(md).not.toBeNull();
      expect(md!).toContain("name: logo-design");
    });

    test("includes category and tags", () => {
      const md = generateSkillMd("market-research-report");
      expect(md).not.toBeNull();
      expect(md!).toContain("Category: Research & Writing");
      expect(md!).toContain("Tags:");
    });

    test("includes CLI section for skills with bin entry", () => {
      const md = generateSkillMd("read-csv");
      expect(md).not.toBeNull();
      expect(md!).toContain("## CLI");
      expect(md!).toContain("skills run read-csv");
    });

    test("returns null for nonexistent skill", () => {
      const md = generateSkillMd("nonexistent-xyz");
      expect(md).toBeNull();
    });

    test("uses CLAUDE.md content when README.md is absent", () => {
      // academic-journal-matcher has CLAUDE.md but no README.md and no SKILL.md
      const md = generateSkillMd("academic-journal-matcher");
      expect(md).not.toBeNull();
      expect(md!).toContain("name: academic-journal-matcher");
      // Should include content from CLAUDE.md
      expect(md!.length).toBeGreaterThan(100);
    });

    test("has valid YAML frontmatter", () => {
      const md = generateSkillMd("market-research-report");
      expect(md).not.toBeNull();
      // Check frontmatter structure
      const parts = md!.split("---");
      expect(parts.length).toBeGreaterThanOrEqual(3);
      // Frontmatter is between first and second ---
      const frontmatter = parts[1];
      expect(frontmatter).toContain("name:");
      expect(frontmatter).toContain("description:");
    });
  });

  describe("detectProjectSkills", () => {
    test("returns always-recommended skills when no package.json", () => {
      const result = detectProjectSkills(testDir);
      expect(result.detected).toEqual([]);
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("implementation-plan");
      expect(names).toContain("write");
      expect(names).toContain("market-research-report");
    });

    test("detects react and recommends frontend skills", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.0.0", typescript: "^5.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("react");
      expect(result.detected).toContain("typescript");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("logo-design");
      expect(names).toContain("generate-favicon");
      expect(names).toContain("seo-brief-builder");
      expect(names).toContain("scaffold-project");
      expect(names).toContain("deploy");
      // Always included
      expect(names).toContain("implementation-plan");
      expect(names).toContain("write");
      expect(names).toContain("market-research-report");
    });

    test("detects express and recommends backend skills", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { express: "^4.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("express");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("api-test-suite");
      expect(names).toContain("apidocs");
    });

    test("detects anthropic SDK and recommends AI skills", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { "@anthropic-ai/sdk": "^0.20.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("@anthropic-ai/sdk");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("market-research-report");
      expect(names).toContain("seo-content-pack");
    });

    test("detects stripe and recommends invoice skill", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { stripe: "^14.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("stripe");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("invoice");
    });

    test("detects test framework and recommends api-test-suite", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^1.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("vitest");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("api-test-suite");
    });

    test("returns unique recommended skills with no duplicates", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: {
            react: "^18.0.0",
            "@anthropic-ai/sdk": "^0.20.0",
          },
          devDependencies: {
            vitest: "^1.0.0",
          },
        })
      );
      const result = detectProjectSkills(testDir);
      const names = result.recommended.map((s) => s.name);
      const uniqueNames = Array.from(new Set(names));
      expect(names).toEqual(uniqueNames);
    });

    test("recommended skills are all valid SkillMeta objects", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "^14.0.0", typescript: "^5.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      for (const skill of result.recommended) {
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("displayName");
        expect(skill).toHaveProperty("description");
        expect(skill).toHaveProperty("category");
        expect(skill).toHaveProperty("tags");
      }
    });

    test("handles invalid JSON in package.json gracefully", () => {
      writeFileSync(join(testDir, "package.json"), "{ invalid json }");
      const result = detectProjectSkills(testDir);
      expect(result.detected).toEqual([]);
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("implementation-plan");
    });
  });
});
