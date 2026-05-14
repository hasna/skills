import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as publicAPI from "../index";

describe("reusable skills engine contract", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/reusable-skills-engine.md"),
    "utf8",
  );

  test("documents the reusable upstream engine surfaces", () => {
    for (const phrase of [
      "Local Registry",
      "Remote Registry",
      "Project Pinning And Runtime State",
      "CLI JSON Contracts",
      "Validation",
      "MCP And Agent Surfaces",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("documents public APIs that private SaaS code can wrap", () => {
    for (const api of [
      "loadRemoteRegistry",
      "installSkillSource",
      "installSkillManifest",
      "installSkill",
      "createLocalSkillManifest",
      "validateSkillDirectory",
      "validateRegistryConsistency",
      "parseSkillFrontmatter",
    ]) {
      expect(content).toContain(api);
      expect(typeof publicAPI[api as keyof typeof publicAPI]).toBe("function");
    }
  });

  test("documents verification gates for upstream changes", () => {
    expect(content).toContain("bun run typecheck");
    expect(content).toContain("bun test");
    expect(content).toContain("bun run build");
    expect(content).toContain("systemd-run --user --scope");
  });

  test("documents hardened validation coverage", () => {
    for (const phrase of [
      "package name consistency",
      "bin command and\ntarget safety",
      "provenance source\nfields",
      "reserved or unsafe package files",
      "sorted by code and\nmessage",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("documents machine-readable MCP contracts", () => {
    for (const phrase of [
      "createMcpContractManifest",
      "createSkillMcpMetadata",
      "install/run schemas",
      "MCP resource contracts",
      "without SaaS-specific assumptions",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("keeps private SaaS concerns out of the reusable engine", () => {
    expect(content).toContain("Do not add private SaaS concepts");
    expect(content).toContain("PostgreSQL");
    expect(content).toContain("Stripe");
    expect(content).toContain("AWS infrastructure");
    expect(content).toContain("There is no\n`.skills/skills` directory");
  });

  test("keeps bundled per-skill install surfaces MCP-only", () => {
    const files = [
      "skills/_common/installer.ts",
      "skills/_common/skill-install.ts",
      "skills/_common/install.sh",
      "skills/deepresearch/src/index.ts",
      "skills/deepresearch/README.md",
      "skills/npmpublish/src/index.ts",
      "skills/npmpublish/README.md",
      "skills/npmpublish/CLAUDE.md",
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).toContain("skills mcp --register");
      expect(source, file).not.toMatch(/\.claude\/skills|\.codex\/skills|\.gemini\/skills/);
      expect(source, file).not.toMatch(/writeFile(?:Sync)?\([^)]*SKILL\.md/);
      expect(source, file).not.toMatch(/mkdir(?:Sync)?\([^)]*skillDir/);
    }
  });
});
