import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skillPath = join(
  process.cwd(),
  "agent-skills",
  "task-to-pr-lifecycle",
  "SKILL.md",
);

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function normalize(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function section(content: string, heading: string): string {
  const source = content.replace(/\r\n/g, "\n");
  const marker = `## ${heading}\n`;
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `missing section: ${heading}`).toBeGreaterThanOrEqual(0);
  const bodyStart = markerIndex + marker.length;
  const nextHeading = source.indexOf("\n## ", bodyStart);
  return source.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading);
}

function expectInOrder(content: string, values: string[]): void {
  let cursor = -1;
  for (const value of values) {
    const next = content.indexOf(value, cursor + 1);
    expect(next, `missing or out-of-order contract field: ${value}`).toBeGreaterThan(
      cursor,
    );
    cursor = next;
  }
}

describe("task-to-PR lifecycle skill", () => {
  test("has the repository instruction-skill frontmatter and a balanced body", () => {
    const content = readSkill();
    const frontmatter = content.match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
    );

    expect(frontmatter).not.toBeNull();
    const parsed = Bun.YAML.parse(frontmatter?.[1] ?? "") as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual([
      "description",
      "name",
      "user_invocable",
    ]);
    expect(parsed.name).toBe("task-to-pr-lifecycle");
    expect(parsed.description).toBeTypeOf("string");
    expect(parsed.user_invocable).toBe(true);
    expect((content.match(/^\s*```.*$/gm)?.length ?? 0) % 2).toBe(0);
  });

  test("binds one immutable PR group to the complete deterministic tuple", () => {
    const dispatch = section(readSkill(), "Dispatch Input Contract");

    expectInOrder(dispatch, [
      "root_task_id:",
      "task_id:",
      "canonical_repo_identity:",
      "base_ref:",
      "frozen_scope_acceptance_hash:",
      "pr_group_binding:",
    ]);
    expect(normalize(dispatch)).toContain(
      "pr_group_binding: <deterministic immutable ID derived from root_task_id + task_id + canonical_repo_identity + base_ref + frozen_scope_acceptance_hash>",
    );
    expect(dispatch).toContain(
      "frozen_scope_acceptance_hash: <sha256:64-lowercase-hex>",
    );

    const binding = normalize(
      section(readSkill(), "Deterministic PR-Group Binding"),
    );
    expect(binding).toContain(
      "Canonicalize and hash the exact ordered tuple",
    );
    expect(binding).toContain(
      "`root_task_id`, `task_id`, `canonical_repo_identity`, `base_ref`, and `frozen_scope_acceptance_hash`",
    );
    expect(binding).toContain(
      "Reject regrouping and reject a second active PR group for the same binding",
    );
    expect(binding).toContain(
      "Retries, repairs, head changes, and provider or worker handoffs keep the same binding",
    );
  });

  test("separates stable lineage IDs from fresh ownership and attempt IDs", () => {
    const lifetimes = section(readSkill(), "Identifier Lifetimes");
    const normalized = normalize(lifetimes);

    expectInOrder(lifetimes, [
      "### Stable lineage IDs",
      "`root_task_id`",
      "`runtime_root_or_plan_id`",
      "`plan_node_id`",
      "`task_id`",
      "`pr_group_binding`",
      "### Fresh per-handoff and per-attempt IDs",
      "`writer_generation`",
      "`fencing_token`",
      "`attempt_nonce`",
    ]);
    expect(normalized).toContain(
      "Every provider or worker handoff first proves the prior worker stopped and the prior lease and token were revoked",
    );
    expect(normalized).toContain(
      "then issues both a fresh writer generation and a fresh fencing token",
    );
    expect(normalized).toContain(
      "Every retry or dispatch attempt mints a fresh attempt nonce",
    );
    expect(normalized).toContain(
      "Stable lineage IDs never become fresh attempt IDs, and fresh IDs are never preserved across the boundary that invalidates them",
    );
  });

  test("requires authoritative token-fenced ownership at every write checkpoint", () => {
    const checkpoints = normalize(section(readSkill(), "Fenced Checkpoints"));

    for (const checkpoint of [
      "at claim",
      "before each mutation",
      "before commit",
      "before push",
      "at handoff",
    ]) {
      expect(checkpoints, `missing checkpoint: ${checkpoint}`).toContain(
        checkpoint,
      );
    }
    expect(checkpoints).toContain(
      "authoritatively re-resolve the pinned provider/profile route and revalidate the current owner, writer generation, and fencing token",
    );
    expect(checkpoints).toContain(
      "Every mutation must use a token-fenced compare-and-write or equivalent fail-closed primitive",
    );
    expect(checkpoints).toContain(
      "A revoked, released, expired, or superseded writer cannot mutate, commit, push, or hand off",
    );
  });

  test("caps elevated repair at two cumulative cycles without head-reset loopholes", () => {
    const repair = normalize(section(readSkill(), "Finite Repair Lifecycle"));

    expect(repair).toContain(
      "Elevated work receives at most two cumulative repair and re-review cycles",
    );
    expect(repair).toContain(
      "Head changes invalidate all exact-head review and CI artifacts but never reset or decrement the cumulative repair count",
    );
    expect(repair).toContain(
      "Cycle 2 is terminal: no third repair or re-review cycle is permitted",
    );
    expect(repair).toContain(
      "residual-safe landing may proceed only when the frozen acceptance contract passes",
    );
    expect(repair).toContain(
      "Otherwise simplify, revert, split into a new bounded task and binding, close, or defer",
    );
    expect(repair).toContain(
      "without granting another cycle to the exhausted binding",
    );
  });

  test("enforces pairwise-distinct worker, reviewers, and merge operator", () => {
    const identities = section(readSkill(), "Identity Separation");
    const normalized = normalize(identities);

    expectInOrder(identities, [
      "worker_identity_and_run_id:",
      "reviewer_identities_and_run_ids:",
      "merge_operator_identity_and_run_id:",
    ]);
    expect(normalized).toContain(
      "The worker, every reviewer, and the merge operator must be pairwise distinct in both identity and run ID",
    );
    expect(normalized).toContain(
      "Reviewer entries must also be mutually distinct",
    );
    expect(normalized).toContain(
      "Only the recorded merge operator may invoke merge",
    );
  });

  test("keeps exact-head review and merge fail-closed", () => {
    const review = normalize(section(readSkill(), "Review and Merge"));

    expect(review).toContain(
      "Reviewers and CI validate the exact remote PR head",
    );
    expect(review).toContain(
      "Any head change invalidates every prior exact-head review, approval, and CI artifact",
    );
    expect(review).toContain(
      "Merge must atomically compare the provider-authoritative current head with the recorded reviewed head",
    );
    expect(review).toContain(
      "Head drift or a missing expected-head guard prevents merge",
    );
  });

  test("records binding, freshness, fencing, repair, identity, and cleanup evidence", () => {
    const output = section(readSkill(), "Evidence and Output Contract");

    expectInOrder(output, [
      "result:",
      "task_status:",
      "root_task_id:",
      "task_id:",
      "pr_group_binding:",
      "pr_group_binding_inputs:",
      "worker_identity_and_run_id:",
      "writer_generation_and_fencing_token:",
      "provider_profile_route:",
      "completion_event_and_attempt_nonce:",
      "repair_cycle:",
      "reviewer_identities_and_run_ids:",
      "merge_operator_identity_and_run_id:",
      "commit_and_exact_heads:",
      "pr:",
      "validation:",
      "secret_scan:",
      "merge_guard:",
      "cleanup_state:",
    ]);
  });

  test("retains read-only exemptions and one coherent change per PR", () => {
    const content = normalize(readSkill());

    expect(content).toContain(
      "One coherent repository change produces exactly one PR",
    );
    expect(content).toContain(
      "Research, diagnosis, planning, status checks, and one-step read-only work are exempt",
    );
  });

  test("rejects contradictory unsafe lifecycle wording", () => {
    const content = readSkill();
    const contradictions = [
      /regroup on retry/i,
      /a third cycle is allowed/i,
      /head changes reset/i,
      /reuse the attempt nonce/i,
      /revoked writer may continue/i,
      /reviewer may merge/i,
      /any operator may merge/i,
      /worker and merge operator may be the same/i,
      /best-effort expected head/i,
      /multiple active PR groups are allowed/i,
      /at (?:least|most) three cumulative repair/i,
      /repair count (?:may|can|does) reset/i,
      /attempt nonce (?:may|can) be reused/i,
      /revoked writer (?:may|can) (?:continue|write|push)/i,
      /merge operator (?:may|can) be (?:the )?(?:worker|reviewer)/i,
      /reviewer identities?.*need not be distinct/i,
      /expected-head (?:check|guard) is optional/i,
      /second active PR group.*(?:allow|permit)/i,
    ];

    for (const contradiction of contradictions) {
      expect(content, `unsafe contradiction: ${contradiction}`).not.toMatch(
        contradiction,
      );
    }
  });
});
