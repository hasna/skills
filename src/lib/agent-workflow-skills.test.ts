import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const agentSkillsRoot = join(process.cwd(), "agent-skills");

function readAgentSkill(name: string): string {
  return readFileSync(join(agentSkillsRoot, name, "SKILL.md"), "utf8");
}

function parseFrontmatter(path: string, content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  expect(match, `${path}: frontmatter must have balanced delimiters`).not.toBeNull();
  if (!match) throw new Error(`${path}: missing frontmatter`);

  const parsed = Bun.YAML.parse(match[1]);
  expect(parsed, `${path}: frontmatter must be a YAML object`).toBeTypeOf("object");
  expect(Array.isArray(parsed), `${path}: frontmatter must not be an array`).toBe(false);
  return parsed as Record<string, unknown>;
}

function expectPhrases(content: string, phrases: string[]): void {
  const normalizedContent = content.replace(/\s+/g, " ");
  for (const phrase of phrases) {
    expect(normalizedContent, `missing invariant: ${phrase}`).toContain(phrase.replace(/\s+/g, " "));
  }
}

describe("agent workflow skills", () => {
  test("all committed SKILL.md artifacts use the repository frontmatter contract", () => {
    const skillDirectories = readdirSync(agentSkillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(skillDirectories.length).toBeGreaterThan(0);

    for (const directory of skillDirectories) {
      const relativePath = `agent-skills/${directory}/SKILL.md`;
      const content = readAgentSkill(directory);
      const frontmatter = parseFrontmatter(relativePath, content);

      expect(Object.keys(frontmatter).sort(), `${relativePath}: allowed frontmatter keys`).toEqual([
        "description",
        "name",
        "user_invocable",
      ]);
      expect(frontmatter.name, `${relativePath}: name must match its folder`).toBe(directory);
      expect(frontmatter.description, `${relativePath}: description must be a string`).toBeTypeOf("string");
      expect(frontmatter.user_invocable, `${relativePath}: user_invocable must be boolean`).toBeTypeOf("boolean");

      const fences = content.match(/^\s*```.*$/gm) ?? [];
      expect(fences.length % 2, `${relativePath}: code fences must be balanced`).toBe(0);
    }
  });

  test("task-to-PR lifecycle pins routes, statuses, events, and atomic merge protection", () => {
    const content = readAgentSkill("task-to-pr-lifecycle");

    expectPhrases(content, [
      "pinned_provider_profile_alias",
      "Silent provider or profile substitution is prohibited",
      "authoritative evidence",
      "increment or rebind the writer generation",
      "rerun route admission",
      "durable completion/failure event",
      "worker ID, task ID, and writer generation",
      "`controlled/manual`",
      "bounded dependency checks",
      "never repetitive polling",
      "fail closed atomically",
      "provider-authoritative expected-head compare-and-swap",
      "merge queue with equivalent expected-head protection",
      "immediately coupled final assertion",
      "Head drift invalidates",
      "`pending`, `in_progress`, `completed`, `failed`, and `cancelled`",
      "Dependency blocking is derived state",
      "`recovery-required` is a classification",
      "never a task status",
    ]);
  });

  test("fleet normalization is canonical, Codewith-only, identity-safe, and reversible", () => {
    const content = readAgentSkill("fleet-skill-normalization");

    expectPhrases(content, [
      "Codewith skill directories only",
      "source_commit",
      "source_path",
      "source_hash",
      "`sha256:<lowercase-hex>`",
      "exactly `name` and `description`",
      "in that order",
      "JSON-compatible double-quoted YAML scalars",
      "source and target hashes",
      "remote-only skills",
      "rollback receipts",
      "authoritative Machines IDs and aliases",
      "live connectivity",
      "current machine",
      "fresh native Codewith worker",
      "changed_skills",
      "missing_skills",
      "conflicting_skills",
      "target_hashes",
      "no paths outside each Codewith skills tree changed",
      "Do not use tmux, sudo, service restarts, package installs, credentials",
      "record `pre_state` as `existing` or `absent`",
      "remove only the exact run-created target",
      "verify the target is absent",
      "write allowlist enforced by the worker runtime",
      "touched-path ledger",
    ]);
    expect(content).not.toContain("ssh ");
    expect(content).not.toMatch(/\b(?:station|spark)\d+\b/);
  });

  test("README routes post-merge Codewith distribution through the tracked workflow", () => {
    const content = readFileSync(join(agentSkillsRoot, "README.md"), "utf8");

    expectPhrases(content, [
      "Codewith is a supported distribution target",
      "`agent-skills/fleet-skill-normalization/SKILL.md`",
      "Other tool adaptation and distribution is separate unless explicitly scoped",
    ]);
    expect(content).not.toContain("skill-sync");
  });
});
