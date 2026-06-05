import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

describe("upstream sync workflow", () => {
  const doc = readFileSync(join(process.cwd(), "docs/architecture/upstream-sync.md"), "utf8");
  const boundaryDoc = readFileSync(join(process.cwd(), "docs/architecture/upstream-boundary.md"), "utf8");
  const scriptPath = join(process.cwd(), "scripts/check_upstream_sync.sh");
  const script = readFileSync(scriptPath, "utf8");

  test("documents a no-worktree branch and cherry-pick workflow", () => {
    expect(doc).toContain("Do not use git worktrees");
    expect(doc).toContain("git switch -c public/<topic> origin/main");
    expect(doc).toContain("git cherry-pick <generic-commit-sha>");
  });

  test("documents preflight and required package gates", () => {
    expect(doc).toContain("scripts/check_upstream_sync.sh --strict-private-markers main..HEAD");
    expect(doc).toContain("bun run typecheck");
    expect(doc).toContain("bun test");
    expect(doc).toContain("bun run build");
    expect(doc).toContain("npm pack --dry-run --json --ignore-scripts");
    expect(boundaryDoc).toContain("docs/architecture/upstream-sync.md");
  });

  test("package does not expose private upstream preflight commands", () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts["upstream:check"]).toBeUndefined();
    expect(JSON.stringify(scripts)).not.toContain("hasnatools/platform-skills");
  });

  test("preflight script verifies public origin and rejects private paths", () => {
    expect(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail")).toBe(true);
    expect(script).toContain("hasna/skills");
    expect(script).toContain("private_path_pattern");
    expect(script).toContain("strict_private_markers");
    expect(script).toContain("never uses git worktrees");
    expect(script).toContain("@hasna/cloud");
    expect(script).toContain("src/platform");
    expect((statSync(scriptPath).mode & 0o111) > 0).toBe(true);
  });
});
