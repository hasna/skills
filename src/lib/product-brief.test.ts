import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("@hasna/skills product brief", () => {
  const brief = readFileSync(join(process.cwd(), "docs/product/product-brief.md"), "utf8");
  const cloudPackage = "@hasna" + "/cloud";

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

  test("defines credit principles and trust model", () => {
    expect(brief).toContain("## Credit Principles");
    expect(brief).toContain("## Trust Model");
    expect(brief).toContain("Billing, payment methods, credits");
    expect(brief).toContain("Remote skills expose public docs");
    expect(brief).toContain("Local skills should remain runnable");
  });

  test("keeps agent-native surfaces ahead of future dashboards", () => {
    expect(brief).toContain("CLI and MCP");
    expect(brief).toContain("Future operator dashboards");
    expect(brief).toContain("same API contracts used by CLI and\nMCP");
    expect(brief).toContain("without making the agent workflow dependent on a browser");
  });

  test("anchors product to the public package and three modes", () => {
    expect(brief).toContain("hasna/skills");
    expect(brief).toContain("@hasna/skills");
    expect(brief).toContain("https://skills.md");
    expect(brief).toContain("cloud");
    expect(brief).toContain("self-hosted");
    expect(brief).toContain("local-only");
    expect(brief).not.toContain(cloudPackage);
  });
});
