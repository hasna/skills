import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("upstream boundary documentation", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/upstream-boundary.md"),
    "utf8",
  );

  test("keeps hasna/skills as upstream and platform-skills as origin", () => {
    expect(content).toContain("origin");
    expect(content).toContain("hasnatools/platform-skills");
    expect(content).toContain("upstream");
    expect(content).toContain("hasna/skills");
  });

  test("separates generic engine changes from private SaaS changes", () => {
    expect(content).toContain("Upstream-Compatible Changes");
    expect(content).toContain("Private SaaS Changes");
    expect(content).toContain("SKILLS_API_URL");
    expect(content).toContain("Stripe billing");
    expect(content).toContain("AWS infrastructure");
  });

  test("preserves local-first upstream behavior", () => {
    expect(content).toContain("Preserve local-first behavior");
    expect(content).toContain("Remote mode is additive");
  });
});
