import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("package ownership and sync strategy", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/package-ownership-sync-strategy.md"),
    "utf8",
  );

  test("chooses package dependency plus generated registry sync", () => {
    expect(content).toContain("canonical upstream package");
    expect(content).toContain("released package APIs plus generated registry sync");
    expect(content).toContain("Released npm package pinned by lockfile");
    expect(content).toContain("Generated Registry Sync");
  });

  test("assigns ownership between upstream and hosted wrappers", () => {
    for (const phrase of [
      "`hasna/skills`, npm `@hasna/skills`",
      "Agent CLI",
      "MCP server",
      "Bundled skill corpus",
      "Hosted API",
      "Hosted workers",
      "Hosted web app",
      "Hosted infrastructure",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("rejects source-copy integration strategies", () => {
    for (const phrase of [
      "Permanent Fork",
      "Git Subtree Or Submodule",
      "Generated Source Copy",
      "Monorepo Package Ownership Transfer",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("keeps hosted wrappers as package consumers", () => {
    expect(content).toContain("Hosted wrappers should consume `@hasna/skills`");
    expect(content).toContain("Released npm package pinned by lockfile");
    expect(content).toContain("public-boundary preflight");
    expect(content).not.toContain("@hasnatools/platform-skills");
    expect(content).not.toContain("src/platform");
  });

  test("keeps hosted wrapper concerns out of upstream", () => {
    for (const phrase of [
      "No private or hosted wrapper module should publish as `@hasna/skills`",
      "No upstream module should require hosted account state",
      "billing",
      "tenants",
      "No hosted or paid skill should download protected source code",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("defines remote-only premium boundary while preserving local user-key skills", () => {
    for (const phrase of [
      "Premium Remote-Only Boundary",
      "hosted premium skills must submit to a compatible hosted API",
      "must not fall back to bundled local execution",
      "OSS package may expose public contracts for hosted skills",
      "must not expose private provider routing",
      "`SKILLS_API_KEY` authenticates the user to a hosted skills API",
      "provider keys such as",
      "`OPENAI_API_KEY`",
      "skill-specific local credentials",
      "protected hosted implementation source",
    ]) {
      expect(content).toContain(phrase);
    }
  });
});
