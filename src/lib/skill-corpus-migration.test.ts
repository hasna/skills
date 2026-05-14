import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("skill corpus migration policy", () => {
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/skill-corpus-migration.md"),
    "utf8",
  );

  test("documents current duplicate/conflict audit result", () => {
    expect(content).toContain("local-only skill directories");
    expect(content).toContain("upstream-only skill directories");
    expect(content).toContain("no duplicated");
    expect(content).toContain("conflicting second skill corpus");
  });

  test("documents the reusable corpus guard command", () => {
    expect(content).toContain("scripts/check_skill_corpus_drift.sh --base upstream/main");
    expect(content).toContain("scripts/check_skill_corpus_drift.sh --base HEAD");
    expect(content).toContain("Registry entries without directories");
    expect(content).toContain("Directories without registry entries");
  });

  test("defines conflict and rename migration policy", () => {
    for (const phrase of [
      "Duplicate registry name",
      "Directory without registry entry",
      "Registry without directory",
      "Local-only skill",
      "Upstream-only skill",
      "Rename Migration Path",
      "legacy alias",
      "Do not silently delete",
    ]) {
      expect(content).toContain(phrase);
    }
  });

  test("separates private hosted skills from upstream skills", () => {
    expect(content).toContain("Private hosted skills should not be placed in upstream");
    expect(content).toContain("private-hosted");
    expect(content).toContain("they must not be copied into the public package");
  });

  test("skill corpus drift script passes a self-check against HEAD", async () => {
    const proc = Bun.spawn([
      "bash",
      "scripts/check_skill_corpus_drift.sh",
      "--base",
      "HEAD",
    ], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("No duplicate, missing, or orphaned skill definitions found.");
  });
});
