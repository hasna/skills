import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("upstream boundary documentation", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/upstream-boundary.md"),
    "utf8",
  );

  test("keeps hasna/skills as the public origin", () => {
    expect(content).toContain("origin");
    expect(content).toContain("hasna/skills");
    expect(content).toContain("canonical open core");
    expect(content).not.toContain("@hasna/cloud");
  });

  test("separates open-core changes from hosted-wrapper changes", () => {
    expect(content).toContain("Open-Core Changes");
    expect(content).toContain("Hosted-Wrapper Changes");
    expect(content).toContain("optional compatible API endpoints");
    expect(content).toContain("Billing, credits, ledgers");
    expect(content).toContain("Deployment infrastructure");
  });

  test("preserves local-first upstream behavior", () => {
    expect(content).toContain("Preserve local-first behavior");
    expect(content).toContain("remote mode additive");
  });
});
