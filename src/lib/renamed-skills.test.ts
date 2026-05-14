import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_ALIASES } from "./skill-aliases.js";

describe("renamed skills documentation", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/renamed-skills.md"),
    "utf8",
  );

  test("documents every alias mapping", () => {
    for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
      expect(content).toContain(`\`${alias}\``);
      expect(content).toContain(`\`${canonical}\``);
    }
  });

  test("documents exact-match and canonical runtime behavior", () => {
    expect(content).toContain("Exact canonical slugs win");
    expect(content).toContain("If no exact skill exists, lookup falls back to the alias table");
    expect(content).toContain("Project pins, runs, usage records, billing records, and artifacts use the");
    expect(content).toContain("New aliases must not shadow an existing registered skill");
  });

  test("documents SaaS migration fields and removal policy", () => {
    expect(content).toContain("requestedSlug");
    expect(content).toContain("canonicalSlug");
    expect(content).toContain("Do not delete aliases silently");
  });
});
