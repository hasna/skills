import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("skills.md product brief", () => {
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
    expect(brief).toContain("Stripe billing");
    expect(brief).toContain("approval gates");
    expect(brief).toContain("durable ledger entry");
  });

  test("keeps agent-native surfaces ahead of the future web interface", () => {
    expect(brief).toContain("CLI, MCP, and API");
    expect(brief).toContain("future web interface");
    expect(brief).toContain("same API contracts used by CLI and MCP");
    expect(brief).toContain("without making the agent workflow dependent on a browser");
  });

  test("anchors product to upstream skills and production domain", () => {
    expect(brief).toContain("hasna/skills");
    expect(brief).toContain("skills.md");
    expect(brief).toContain("PR previews");
    expect(brief).toContain("tag-gated production releases");
  });
});
