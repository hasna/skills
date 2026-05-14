import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as publicAPI from "../index";

describe("hasna/skills module audit", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/hasna-skills-module-audit.md"),
    "utf8",
  );

  test("documents direct upstream reuse surfaces", () => {
    for (const phrase of [
      "src/index.ts",
      "src/lib/registry.ts",
      "src/lib/remote-registry.ts",
      "src/lib/installer.ts",
      "src/lib/skillinfo.ts",
      "src/lib/skill-validation.ts",
      "src/cli/index.tsx",
      "src/mcp/index.ts",
      "skills/*",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("ties audited modules to public package APIs", () => {
    for (const api of [
      "loadRegistry",
      "loadRemoteRegistry",
      "installSkillManifest",
      "installSkillSource",
      "getSkillDocs",
      "runSkill",
      "validateSkillDirectory",
      "validateRegistryConsistency",
      "loadConfig",
      "addSchedule",
    ]) {
      expect(typeof publicAPI[api as keyof typeof publicAPI]).toBe("function");
    }
  });

  test("lists upstream modifications separately from private SaaS work", () => {
    for (const phrase of [
      "Upstream Modules To Modify",
      "Remote registry support",
      "Project pinning",
      "CLI JSON output",
      "MCP JSON contracts",
      "SaaS-Only Modules To Build",
      "PostgreSQL tenant schema",
      "Billing service",
      "AWS deployment",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("documents hosted execution and web interface caveats", () => {
    expect(content).toContain("must not become the hosted execution");
    expect(content).toContain("server-controlled sandbox");
    expect(content).toContain("The local scheduler is file/config oriented");
    expect(content).toContain("future web interface");
    expect(content).toContain("first-class API client");
  });

  test("keeps private concerns out of upstream and requires verification", () => {
    expect(content).toContain("Do not add `skills.md`");
    expect(content).toContain("Do not install paid or hosted skill source code");
    expect(content).toContain("bun run typecheck");
    expect(content).toContain("bun test");
    expect(content).toContain("bun run build");
    expect(content).toContain("Stripe sandbox work");
  });
});
