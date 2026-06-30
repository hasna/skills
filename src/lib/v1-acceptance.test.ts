import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("v1 acceptance criteria", () => {
  const doc = readFileSync(join(process.cwd(), "docs/release/v1-acceptance.md"), "utf8");

  test("anchors product, package, and hosted-wrapper strategy", () => {
    expect(doc).toContain("`hasna/skills` is the canonical open repository");
    expect(doc).toContain("`@hasna/skills` is the public npm package");
    expect(doc).toContain("Local-only setup works without API credentials");
    expect(doc).toContain("Private worker, billing, tenant, database, and deployment state");
  });

  test("covers CLI, MCP, package, security, and wrapper acceptance", () => {
    for (const section of [
      "## CLI Acceptance",
      "## MCP Acceptance",
      "## Primitive Tool Acceptance",
      "## Package Acceptance",
      "## Security Acceptance",
      "## Hosted Wrapper Acceptance",
    ]) {
      expect(doc).toContain(section);
    }
  });

  test("covers public package gates", () => {
    for (const phrase of [
      "package.json",
      "Built entrypoints",
      "Packed output",
      "Package-boundary tests",
      "Hosted wrappers consume public package APIs",
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  test("requires local verification commands", () => {
    expect(doc).toContain("bun install --frozen-lockfile");
    expect(doc).toContain("bun run typecheck");
    expect(doc).toContain("bun test");
    expect(doc).toContain("tools validate --json");
    expect(doc).toContain("bun run build");
    expect(doc).toContain("npm pack --dry-run --json --ignore-scripts");
    expect(doc).toContain("systemd-run --user --scope");
  });
});
