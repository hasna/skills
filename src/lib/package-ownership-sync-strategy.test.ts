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
    expect(content).toContain("package dependency plus generated registry sync");
    expect(content).toContain("Released npm package pinned by lockfile");
    expect(content).toContain("Generated Registry Sync");
  });

  test("assigns ownership between upstream and private SaaS", () => {
    for (const phrase of [
      "`hasna/skills`, npm `@hasna/skills`",
      "Agent CLI",
      "MCP server",
      "Bundled skill corpus",
      "SaaS API",
      "SaaS workers",
      "SaaS web app",
      "SaaS infrastructure",
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

  test("documents bootstrap transition out of public package identity", () => {
    expect(content).toContain("Bootstrap State");
    expect(content).toContain("repository now presents itself as the private");
    expect(content).toContain("@hasnatools/platform-skills");
    expect(content).toContain("Keep `@hasna/skills` as an external dependency");
  });

  test("keeps private SaaS concerns out of upstream", () => {
    for (const phrase of [
      "No private SaaS module should publish as `@hasna/skills`",
      "No upstream module should require PostgreSQL",
      "Stripe",
      "AWS",
      "tenants",
      "No hosted or paid skill should download private source code",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("defines remote-only premium boundary while preserving local user-key skills", () => {
    for (const phrase of [
      "Premium Remote-Only Boundary",
      "premium skills must submit to the skills.md API",
      "must not fall back to bundled local execution",
      "OSS package may expose public contracts for premium skills",
      "must not expose private provider routing",
      "`SKILLS_API_KEY` authenticates the user to skills.md",
      "provider keys such as `OPENAI_API_KEY`",
      "Free or explicitly local OSS skills may still read user-provided",
      "must exclude `skills/<premium>/src` implementation",
    ]) {
      expect(content).toContain(phrase);
    }
  });
});
