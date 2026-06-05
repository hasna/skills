import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("@hasna/skills product brief", () => {
  const brief = readFileSync(join(process.cwd(), "docs/product/product-brief.md"), "utf8");

  test("defines target users, use cases, v1 scope, and non-goals", () => {
    for (const section of [
      "## Target Users",
      "## Core Use Cases",
      "## V1 Scope",
      "## Non-Goals",
    ]) {
      expect(brief).toContain(section);
    }
  });

  test("defines pricing principles and trust model", () => {
    expect(brief).toContain("## Pricing Principles");
    expect(brief).toContain("## Trust Model");
    expect(brief).toContain("Billing, payment methods, credits");
    expect(brief).toContain("Hosted skills expose public docs");
    expect(brief).toContain("Local skills should remain runnable");
  });

  test("keeps agent-native surfaces ahead of future dashboards", () => {
    expect(brief).toContain("CLI and MCP");
    expect(brief).toContain("Future hosted dashboards");
    expect(brief).toContain("same API contracts used by CLI and\nMCP");
    expect(brief).toContain("without making the agent workflow dependent on a browser");
  });

  test("anchors product to public package and optional hosted API", () => {
    expect(brief).toContain("hasna/skills");
    expect(brief).toContain("@hasna/skills");
    expect(brief).toContain("skills.md");
    expect(brief).toContain("local-only");
    expect(brief).not.toContain("@hasna/cloud");
  });
});
