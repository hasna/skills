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
      "resolved_provider_profile_route",
      "immutable resolved route identity",
      "admission receipt",
      "Silent provider or profile substitution is prohibited",
      "re-resolve the alias",
      "reject alias remapping",
      "fresh, non-reusable fencing token and writer generation",
      "prior worker is stopped",
      "prior lease is revoked or released",
      "durable completion/failure event",
      "attempt_nonce",
      "authoritative current terminal state",
      "Reject stale, replayed",
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
    expect(content).toMatch(
      /pinned_provider_profile_alias:.*\nresolved_provider_profile_route: <immutable resolved route identity and admission receipt>/,
    );
    expect(content).toMatch(
      /At each lifecycle\s+checkpoint—claim, before mutation, before commit, before push,\s+and handoff—re-resolve the alias/,
    );
    expect(content).toMatch(
      /Every ownership transfer issues a fresh, non-reusable fencing token and\nwriter generation/,
    );
    expect(content).toMatch(
      /Validate the event against the authoritative current terminal state[\s\S]*Reject stale, replayed/,
    );
    expect(content).toMatch(
      /emits a durable completion\/failure event tied to the worker ID, task ID, and\s+writer generation, plus a fresh `attempt_nonce`[\s\S]*authoritative current terminal state[\s\S]*Reject stale, replayed/,
    );
    expect(content).toMatch(
      /writer_generation: <fresh non-reusable generation ID, fencing token, owner, active\|released\|superseded>\npinned_provider_profile_alias:.*\nresolved_provider_profile_route: <immutable identity; admission receipt; task\/generation binding>/,
    );
    expect(content).not.toContain("increment or rebind the writer generation");
    expect(content).not.toContain("rebind the writer generation");
  });

  test("fleet normalization is canonical, Codewith-only, identity-safe, and reversible", () => {
    const content = readAgentSkill("fleet-skill-normalization");

    expectPhrases(content, [
      "Codewith skill directories only",
      "source_commit",
      "source_path",
      "source_hash",
      "source_package_version_and_integrity",
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
      "exact selected target `SKILL.md` paths",
      "explicitly named run-owned temporary and rollback receipt paths",
      "touched-path ledger",
      "must be a subset of that exact allowlist",
      "unselected or remote-only path",
      "fail-closed compare-and-replace",
      "create-if-absent",
      "current target still has this run's exact target hash",
      "source_repository_or_package",
    ]);
    expect(content).toMatch(
      /source_repository_or_package: <canonical identity>\nsource_package_version_and_integrity: <version and integrity\|not-packaged>/,
    );
    expect(content).toMatch(
      /Forward writes require a fail-closed compare-and-replace operation[\s\S]*If neither primitive is available, stop without writing/,
    );
    expect(content).toMatch(
      /Before restoring an existing target, prove\s+the current target still has\s+this run's exact target hash/,
    );
    expect(content).toMatch(
      /write allowlist contains only those exact\s+paths[\s\S]*touched-path ledger[\s\S]*subset of that exact allowlist[\s\S]*unselected or remote-only path[\s\S]*fails closure/,
    );
    expect(content).toMatch(
      /The fresh native Codewith worker returns:[\s\S]*source_repository_or_package: <canonical identity per skill>\nsource_package_version_and_integrity: <version and integrity per packaged skill\|not-packaged>\nsource_commit: <exact commit per skill>\nsource_path: <tracked path per skill>\nsource_hash: <verified sha256:lowercase-hex per skill>/,
    );
    expect(content).toMatch(
      /The coordinator accepts completion only when[\s\S]*source repository or\s+package[\s\S]*package version and\s+integrity/,
    );
    expect(content).not.toContain(
      "write allowlist enforced by the worker runtime for the resolved Codewith skills trees",
    );
    expect(content).not.toContain("then atomically rename it into the exact target");
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
