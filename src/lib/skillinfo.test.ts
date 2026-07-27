import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
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

// The OSS catalog is declarative-only (every shipped skill is kind: "instruction"
// with no bin, no src/, and no provider credentials). Tests that need an
// executable/BYO-key skill shape build an isolated fixture under a temp
// $HASNA_SKILLS_DIR/custom/<name>/ instead of leaning on a bundled skill.
let fixtureRoot: string | undefined;
let savedSkillsDir: string | undefined;

function customSkill(
  name: string,
  files: { pkg?: unknown; skillMd?: string; readme?: string; claudeMd?: string },
): void {
  if (fixtureRoot === undefined) {
    savedSkillsDir = process.env.HASNA_SKILLS_DIR;
    fixtureRoot = mkdtempSync(join(tmpdir(), "skillinfo-fixture-"));
    process.env.HASNA_SKILLS_DIR = fixtureRoot;
  }
  const dir = join(fixtureRoot, "custom", name);
  mkdirSync(dir, { recursive: true });
  if (files.pkg !== undefined) writeFileSync(join(dir, "package.json"), JSON.stringify(files.pkg, null, 2));
  if (files.skillMd !== undefined) writeFileSync(join(dir, "SKILL.md"), files.skillMd);
  if (files.readme !== undefined) writeFileSync(join(dir, "README.md"), files.readme);
  if (files.claudeMd !== undefined) writeFileSync(join(dir, "CLAUDE.md"), files.claudeMd);
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "skillinfo-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    if (savedSkillsDir === undefined) delete process.env.HASNA_SKILLS_DIR;
    else process.env.HASNA_SKILLS_DIR = savedSkillsDir;
    fixtureRoot = undefined;
    savedSkillsDir = undefined;
  }
});

describe("skillinfo", () => {
  describe("getSkillDocs", () => {
    test("returns docs for skill with SKILL.md", () => {
      const docs = getSkillDocs("brand-kit");
      expect(docs).not.toBeNull();
      expect(docs!.skillMd).toBeTruthy();
      expect(docs!.skillMd).toContain("Brand Kit");
    });

    test("returns docs for skill with CLAUDE.md only", () => {
      customSkill("claude-only-fixture", { claudeMd: "# Claude Only Fixture\n\nGuidance body.\n" });
      const docs = getSkillDocs("claude-only-fixture");
      expect(docs).not.toBeNull();
      expect(docs!.claudeMd).toBeTruthy();
      expect(docs!.skillMd).toBeFalsy();
    });

    test("returns null for nonexistent skill", () => {
      const docs = getSkillDocs("nonexistent-xyz");
      expect(docs).toBeNull();
    });

    test("returns null fields for missing doc files", () => {
      customSkill("skillmd-only-fixture", {
        skillMd: "---\nname: skillmd-only-fixture\ndescription: Fixture with only SKILL.md.\n---\n# Skillmd Only\n",
      });
      const docs = getSkillDocs("skillmd-only-fixture");
      expect(docs).not.toBeNull();
      expect(docs!.skillMd).toBeTruthy();
      // README.md and CLAUDE.md are absent -> null fields.
      expect(docs!.readme).toBeFalsy();
      expect(docs!.claudeMd).toBeFalsy();
    });
  });

  describe("getSkillBestDoc", () => {
    test("returns SKILL.md when available", () => {
      const doc = getSkillBestDoc("brand-kit");
      expect(doc).toBeTruthy();
      expect(doc).toContain("Brand Kit");
    });

    test("falls back to CLAUDE.md", () => {
      customSkill("claude-fallback-fixture", { claudeMd: "# Claude Fallback\n\nBody.\n" });
      const doc = getSkillBestDoc("claude-fallback-fixture");
      expect(doc).toBeTruthy();
      expect(doc).toContain("Claude Fallback");
    });

    test("returns null for nonexistent skill", () => {
      const doc = getSkillBestDoc("nonexistent-xyz");
      expect(doc).toBeNull();
    });
  });

  describe("getSkillRequirements", () => {
    test("surfaces the provider key a BYO-key skill actually reads", () => {
      customSkill("byo-key-fixture", {
        pkg: { name: "byo-key-fixture", version: "0.1.0" },
        skillMd: "---\nname: byo-key-fixture\ndescription: Reads a provider key.\n---\n# BYO\n\nSet `OPENAI_API_KEY`.\n",
      });
      const reqs = getSkillRequirements("byo-key-fixture");
      expect(reqs).not.toBeNull();
      expect(reqs!.envVars).not.toContain("SKILLS_API_KEY");
      expect(reqs!.envVars).not.toContain("SKILL_API_KEY");
      expect(reqs!.envVars).toContain("OPENAI_API_KEY");
      expect(reqs!.envVars).not.toContain("GEMINI_API_KEY");
      expect(reqs!.envVars).not.toContain("XAI_API_KEY");
      expect(reqs!.envVars).not.toContain("GOOGLE_PROJECT_ID");
    });

    test("preserves provider API keys for free local skills", () => {
      customSkill("free-local-fixture", {
        pkg: { name: "free-local-fixture", version: "0.1.0" },
        skillMd: "---\nname: free-local-fixture\ndescription: Free local skill.\n---\n# Free\n\nRequires `OPENAI_API_KEY`.\n",
      });
      const reqs = getSkillRequirements("free-local-fixture");
      expect(reqs).not.toBeNull();
      expect(reqs!.envVars).toContain("OPENAI_API_KEY");
      expect(reqs!.envVars).not.toContain("SKILLS_API_KEY");
    });

    test("extracts CLI command from the registry", () => {
      const reqs = getSkillRequirements("brand-kit");
      expect(reqs).not.toBeNull();
      expect(reqs!.cliCommand).toBe("skills run brand-kit");
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
      customSkill("sorted-env-fixture", {
        pkg: { name: "sorted-env-fixture", version: "0.1.0" },
        skillMd:
          "---\nname: sorted-env-fixture\ndescription: Reads two keys.\n---\n# Sorted\n\nSet `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.\n",
      });
      const reqs = getSkillRequirements("sorted-env-fixture");
      expect(reqs).not.toBeNull();
      const vars = reqs!.envVars;
      expect(vars.length).toBeGreaterThanOrEqual(2);
      const sorted = [...vars].sort();
      expect(vars).toEqual(sorted);
    });

    test("extracts dependencies from package.json", () => {
      customSkill("deps-fixture", {
        pkg: { name: "deps-fixture", version: "0.1.0", dependencies: { "csv-parse": "^5.0.0" } },
        skillMd: "---\nname: deps-fixture\ndescription: Declares a dependency.\n---\n# Deps\n",
      });
      const reqs = getSkillRequirements("deps-fixture");
      expect(reqs).not.toBeNull();
      expect(reqs!.dependencies).toHaveProperty("csv-parse");
    });
  });

  describe("getSkillDependencyStatus", () => {
    // Regression: doctor/test previously computed readiness only from env vars
    // and system deps, never verifying that a skill's npm dependencies were
    // installed — so a runnable skill that needs an npm package could report a
    // false-green readiness while being unable to run at all.
    let prevSkillsDir: string | undefined;
    let skillsRoot: string;

    beforeEach(() => {
      prevSkillsDir = process.env.HASNA_SKILLS_DIR;
      skillsRoot = mkdtempSync(join(tmpdir(), "skills-dep-root-"));
      process.env.HASNA_SKILLS_DIR = skillsRoot;
    });

    afterEach(() => {
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
      customSkill("env-example-fixture", {
        pkg: { name: "env-example-fixture", version: "0.1.0" },
        skillMd: "---\nname: env-example-fixture\ndescription: BYO-key fixture.\n---\n# Env\n\nSet `OPENAI_API_KEY`.\n",
      });
      installSkill("env-example-fixture", { targetDir: testDir });
      const result = generateEnvExample(testDir);
      expect(result).toContain("OPENAI_API_KEY");
      expect(result).not.toContain("SKILL_API_KEY");
      expect(result).toContain("# Used by: env-example-fixture");
    });

    test("includes header comments", () => {
      customSkill("env-header-fixture", {
        pkg: { name: "env-header-fixture", version: "0.1.0" },
        skillMd: "---\nname: env-header-fixture\ndescription: BYO-key fixture.\n---\n# Env\n\nSet `OPENAI_API_KEY`.\n",
      });
      installSkill("env-header-fixture", { targetDir: testDir });
      const result = generateEnvExample(testDir);
      expect(result).toContain("# Environment variables for pinned skills");
      expect(result).toContain("# Auto-generated by: skills init");
    });

    test("groups by provider prefix", () => {
      customSkill("env-group-fixture", {
        pkg: { name: "env-group-fixture", version: "0.1.0" },
        skillMd: "---\nname: env-group-fixture\ndescription: BYO-key fixture.\n---\n# Env\n\nSet `OPENAI_API_KEY`.\n",
      });
      installSkill("env-group-fixture", { targetDir: testDir });
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
      // brand-kit ships a SKILL.md, but generateSkillMd still works
      const md = generateSkillMd("brand-kit");
      expect(md).not.toBeNull();
      expect(md!).toContain("name: brand-kit");
    });

    test("includes category and tags", () => {
      const md = generateSkillMd("market-research-report");
      expect(md).not.toBeNull();
      expect(md!).toContain("Category: Research & Writing");
      expect(md!).toContain("Tags:");
    });

    test("omits the CLI section for an instruction skill (no bin entry)", () => {
      // Declarative catalog: shipped skills carry no bin, so generateSkillMd emits
      // no `## CLI` block. (The block is added only when package.json declares a bin.)
      const md = generateSkillMd("market-research-report");
      expect(md).not.toBeNull();
      expect(md!).not.toContain("## CLI");
    });

    test("returns null for nonexistent skill", () => {
      const md = generateSkillMd("nonexistent-xyz");
      expect(md).toBeNull();
    });

    test("builds a non-trivial document from a shipped skill's metadata and docs", () => {
      const md = generateSkillMd("blog-article");
      expect(md).not.toBeNull();
      expect(md!).toContain("name: blog-article");
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
      expect(names).toContain("market-research-report");
      expect(names).toContain("repo-onboarding-report");
      expect(names).toContain("blog-article");
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
      expect(names).toContain("landing-page-pack");
      expect(names).toContain("seo-content-pack");
      expect(names).toContain("brand-kit");
      // Always included
      expect(names).toContain("market-research-report");
      expect(names).toContain("repo-onboarding-report");
      expect(names).toContain("blog-article");
    });

    test("detects express and recommends backend skills", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { express: "^4.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("express");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("test-suite-generator");
      expect(names).toContain("security-audit-report");
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

    test("detects stripe and recommends a sales artifact skill", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { stripe: "^14.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("stripe");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("proposal-pack");
    });

    test("detects test framework and recommends a test-suite skill", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^1.0.0" } })
      );
      const result = detectProjectSkills(testDir);
      expect(result.detected).toContain("vitest");
      const names = result.recommended.map((s) => s.name);
      expect(names).toContain("test-suite-generator");
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
      expect(names).toContain("market-research-report");
    });
  });
});
