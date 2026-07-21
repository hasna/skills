import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pkg from "../../package.json" with { type: "json" };

describe("upstream sync workflow", () => {
  const cloudPackage = "@hasna" + "/cloud";
  const doc = readFileSync(join(process.cwd(), "docs/architecture/upstream-sync.md"), "utf8");
  const boundaryDoc = readFileSync(join(process.cwd(), "docs/architecture/upstream-boundary.md"), "utf8");
  const scriptPath = join(process.cwd(), "scripts/check_upstream_sync.sh");
  const script = readFileSync(scriptPath, "utf8");

  test("documents a task-worktree branch and cherry-pick workflow", () => {
    expect(doc).toContain("task-specific worktree");
    expect(doc).toContain("Never switch or edit the shared checkout");
    expect(doc).toContain('git worktree add "$HOME/.hasna/repos/worktrees/open-skills/<topic>"');
    expect(doc).toContain("git cherry-pick <generic-commit-sha>");
    expect(doc).not.toContain("git switch -c public/<topic>");
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
    expect(script).toContain("does not create worktrees, switch branches, or modify files");
    expect(script).toContain("cloud_package=");
    expect(script).toContain("${cloud_package}");
    expect(script).not.toContain(cloudPackage);
    expect(script).toContain("scripts/check_upstream_sync.sh|*.test.*|*.spec.*");
    expect(script).toContain("src/platform");
    expect((statSync(scriptPath).mode & 0o111) > 0).toBe(true);
  });

  test("preflight help reports the implemented default range", () => {
    const result = spawnSync("bash", [scriptPath, "--help"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Default: main..HEAD");
    expect(result.stdout).not.toContain("upstream/main..HEAD");
  });
});

describe("strict upstream marker regression", () => {
  const sourceScript = join(process.cwd(), "scripts/check_upstream_sync.sh");

  function makeRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "upstream-sync-"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "docs", "architecture"), { recursive: true });
    copyFileSync(sourceScript, join(root, "scripts", "check_upstream_sync.sh"));
    chmodSync(join(root, "scripts", "check_upstream_sync.sh"), 0o755);
    writeFileSync(join(root, "README.md"), "# Public package\n");
    run(root, "git", ["init", "-q"]);
    run(root, "git", ["config", "user.email", "test@example.invalid"]);
    run(root, "git", ["config", "user.name", "Boundary Test"]);
    run(root, "git", ["remote", "add", "origin", "https://github.com/hasna/skills.git"]);
    run(root, "git", ["add", "."]);
    run(root, "git", ["commit", "-qm", "baseline"]);
    return root;
  }

  function check(root: string) {
    return spawnSync(
      "bash",
      ["scripts/check_upstream_sync.sh", "--strict-private-markers", "HEAD"],
      { cwd: root, encoding: "utf8" },
    );
  }

  test("allows canonical architecture and policy documentation to name boundary terms", () => {
    const root = makeRepo();
    try {
      writeFileSync(
        join(root, "docs", "architecture", "canonical-policy.md"),
        "# Policy\nGeneric tenant isolation, billing hooks, private configuration, and production deploy boundaries.\n",
      );
      run(root, "git", ["add", "docs/architecture/canonical-policy.md"]);
      const result = check(root);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Upstream sync preflight passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects private implementation dependencies and configuration markers", () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "config"), { recursive: true });
      const privatePackage = ["@hasna", "cloud"].join("/");
      writeFileSync(join(root, "src", "private-runtime.ts"), `import "${privatePackage}";\n`);
      writeFileSync(join(root, "config", "production.json"), '{"STRIPE_SECRET_KEY":"env"}\n');
      run(root, "git", ["add", "src/private-runtime.ts", "config/production.json"]);
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Private marker strings found");
      expect(result.stderr).toContain("src/private-runtime.ts");
      expect(result.stderr).toContain("config/production.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects private product paths before content classification", () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      writeFileSync(join(root, ".github", "workflows", "production.yml"), "name: private deploy\n");
      run(root, "git", ["add", ".github/workflows/production.yml"]);
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Private product paths must not be included");
      expect(result.stderr).toContain(".github/workflows/production.yml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function run(root: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
}
