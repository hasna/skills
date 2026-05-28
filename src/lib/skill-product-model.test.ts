import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("skill product model", () => {
  const doc = readFileSync(join(process.cwd(), "docs/architecture/skill-product-model.md"), "utf8");

  test("defines skill identity, visibility, execution, and source policy", () => {
    for (const section of [
      "## Core Identity",
      "## Visibility",
      "## Execution Mode",
      "## Source Policy",
    ]) {
      expect(doc).toContain(section);
    }
    expect(doc).toContain("open `hasna/skills` package remains the upstream registry source");
    expect(doc).toContain("server executes source");
  });

  test("covers pricing, moderation, versioning, and schemas", () => {
    for (const phrase of [
      "`pricing_type`",
      "`moderation_status`",
      "`content_hash`",
      "`input_schema`",
      "`mcp_input_schema`",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("separates pin records from execution records", () => {
    expect(doc).toContain("## Pin Record");
    expect(doc).toContain("## Execution Record");
    expect(doc).toContain("without copying skill definitions into agent folders");
    expect(doc).toContain("Execution state is the source of truth for CLI, MCP, API, and web UI");
  });

  test("protects paid and hosted skill source", () => {
    expect(doc).toContain("Paid or untrusted hosted skills should default to `remote`");
    expect(doc).toMatch(/not\s+protected source code/);
    expect(doc).toContain("Billing checks happen server-side");
  });
});
