import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "node:child_process";
import { SKILLS } from "./registry";
import { parseSkillFrontmatter } from "./skill-validation";

const ROOT = process.cwd();
const AGENT_SKILLS_DIR = join(ROOT, "agent-skills");

function filesBelow(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    const relative = join(prefix, entry);
    return statSync(absolute).isDirectory() ? filesBelow(absolute, relative) : [relative];
  });
}

describe("repository-managed agent workflow skills", () => {
  test("all agent skills have matching valid frontmatter", () => {
    const failures: string[] = [];
    for (const folder of readdirSync(AGENT_SKILLS_DIR)) {
      const directory = join(AGENT_SKILLS_DIR, folder);
      if (!statSync(directory).isDirectory()) continue;
      const skillPath = join(directory, "SKILL.md");
      if (!existsSync(skillPath)) {
        failures.push(`${folder}: missing SKILL.md`);
        continue;
      }
      const frontmatter = parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
      if (!frontmatter || frontmatter.name !== folder || !frontmatter.description) {
        failures.push(`${folder}: invalid or mismatched frontmatter`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("merge-pr remains outside the customer skill catalog and public corpus", () => {
    expect(SKILLS.some((skill) => skill.name === "merge-pr")).toBe(false);
    expect(existsSync(join(ROOT, "skills", "merge-pr"))).toBe(false);
    expect(existsSync(join(ROOT, "skills", "skill-merge-pr"))).toBe(false);
  });

  test("merge-pr contains only the canonical workflow and required resources", () => {
    expect(filesBelow(join(AGENT_SKILLS_DIR, "merge-pr")).sort()).toEqual([
      "SKILL.md",
      "references/merge-safety.md",
      "scripts/merge_pr_guard.py",
      "scripts/test_merge_pr_guard.py",
      "tests/fixtures/multi-commit-synthesized.json",
      "tests/fixtures/trailer-free-provider.json",
    ]);
  });

  test("merge-pr guard passes its raw-fixture behavior suite", () => {
    const result = spawnSync(
      "python3",
      ["-m", "unittest", "agent-skills/merge-pr/scripts/test_merge_pr_guard.py"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
