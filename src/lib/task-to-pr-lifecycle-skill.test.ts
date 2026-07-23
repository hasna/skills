import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skillPath = join(
  process.cwd(),
  "agent-skills",
  "task-to-pr-lifecycle",
  "SKILL.md",
);

const invariantIds = [
  "deterministic-binding",
  "identifier-lifetimes",
  "route-admission",
  "fenced-ownership",
  "completion-events",
  "finite-repair",
  "identity-separation",
  "coordinator-state",
  "failure-preservation",
  "exact-head-merge",
  "cleanup-gate",
] as const;

type InvariantId = (typeof invariantIds)[number];

type InvariantRecord = {
  polarity: "fail_closed";
  authoritative_fields: string[];
  allowed: Record<string, unknown>;
  denied: Record<string, unknown>;
  relationships: Record<string, unknown>;
};

type FieldContract = {
  invariants: InvariantId[];
  sections: string[];
};

type InvariantManifest = {
  version: 1;
  authoritative: true;
  proof_boundary: "typed_records_and_authoritative_text_fields";
  field_contracts: Record<string, FieldContract>;
  invariants: Record<InvariantId, InvariantRecord>;
};

type FieldOccurrence = {
  field: string;
  value: string;
  section: string;
};

type ExpectedPath = {
  path: string;
  value: unknown;
};

type RiskFixture = {
  id: InvariantId;
  field: string;
  manifestFrom: string;
  manifestTo: string;
  unsafeFieldValue: string;
  safeNearMiss: string;
};

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
  if (markerIndex < 0) {
    throw new Error(`missing section: ${heading}`);
  }
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

function parseManifest(content: string): InvariantManifest {
  const matches = [
    ...content.matchAll(
      /```yaml task-to-pr-invariants\r?\n([\s\S]*?)\r?\n```/g,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(`expected one invariant manifest, found ${matches.length}`);
  }
  return Bun.YAML.parse(matches[0]?.[1] ?? "") as InvariantManifest;
}

function sectionAt(content: string, offset: number): string {
  const prefix = content.slice(0, offset);
  const headings = [...prefix.matchAll(/^## ([^\n]+)$/gm)];
  return headings.at(-1)?.[1]?.trim() ?? "<before-first-section>";
}

function parseTextFields(content: string): FieldOccurrence[] {
  const occurrences: FieldOccurrence[] = [];
  for (const match of content.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)) {
    const body = match[1] ?? "";
    const containingSection = sectionAt(content, match.index ?? 0);
    for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
      const field = line.match(/^([a-z][a-z0-9_]*):\s*(.+)$/);
      if (field) {
        occurrences.push({
          field: field[1] ?? "",
          value: field[2]?.trim() ?? "",
          section: containingSection,
        });
      }
    }
  }
  return occurrences;
}

function valueAtPath(record: InvariantRecord, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    );
}

function equalValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function policyReference(contract: FieldContract): string {
  return `<policy=${contract.invariants.join(
    "+",
  )}; authoritative=task-to-pr-invariants-v1>`;
}

const expectedFieldContracts: Record<string, FieldContract> = {
  pr_group_binding: {
    invariants: ["deterministic-binding"],
    sections: ["Dispatch Input Contract", "Evidence and Output Contract"],
  },
  writer_generation: {
    invariants: ["identifier-lifetimes", "fenced-ownership"],
    sections: ["Dispatch Input Contract"],
  },
  fencing_token: {
    invariants: ["fenced-ownership", "identifier-lifetimes"],
    sections: ["Dispatch Input Contract"],
  },
  resolved_provider_profile_route: {
    invariants: ["route-admission"],
    sections: ["Dispatch Input Contract"],
  },
  completion_event: {
    invariants: ["completion-events"],
    sections: ["Dispatch Input Contract"],
  },
  repair_cycle: {
    invariants: ["finite-repair"],
    sections: ["Dispatch Input Contract", "Evidence and Output Contract"],
  },
  worker_identity_and_run_id: {
    invariants: ["identity-separation"],
    sections: [
      "Dispatch Input Contract",
      "Identity Separation",
      "Evidence and Output Contract",
    ],
  },
  reviewer_identities_and_run_ids: {
    invariants: ["identity-separation"],
    sections: [
      "Dispatch Input Contract",
      "Identity Separation",
      "Evidence and Output Contract",
    ],
  },
  merge_operator_identity_and_run_id: {
    invariants: ["identity-separation"],
    sections: [
      "Dispatch Input Contract",
      "Identity Separation",
      "Evidence and Output Contract",
    ],
  },
  dependencies: {
    invariants: ["coordinator-state"],
    sections: ["Dispatch Input Contract"],
  },
  worktree_and_branch: {
    invariants: ["failure-preservation", "cleanup-gate"],
    sections: ["Dispatch Input Contract"],
  },
  task_status: {
    invariants: ["coordinator-state", "failure-preservation"],
    sections: ["Evidence and Output Contract"],
  },
  writer_generation_and_fencing_token: {
    invariants: ["identifier-lifetimes", "fenced-ownership"],
    sections: ["Evidence and Output Contract"],
  },
  provider_profile_route: {
    invariants: ["route-admission"],
    sections: ["Evidence and Output Contract"],
  },
  completion_event_and_attempt_nonce: {
    invariants: ["completion-events", "identifier-lifetimes"],
    sections: ["Evidence and Output Contract"],
  },
  merge_guard: {
    invariants: ["exact-head-merge"],
    sections: ["Evidence and Output Contract"],
  },
  cleanup_state: {
    invariants: ["cleanup-gate"],
    sections: ["Evidence and Output Contract"],
  },
};

const invariantExpectations: Record<InvariantId, ExpectedPath[]> = {
  "deterministic-binding": [
    { path: "authoritative_fields", value: ["pr_group_binding"] },
    { path: "allowed.derivation", value: "canonical_ordered_tuple" },
    { path: "allowed.active_pr_groups_max", value: 1 },
    { path: "allowed.retry_binding", value: "preserve" },
    { path: "denied.regrouping", value: true },
    { path: "denied.second_active_group", value: true },
    {
      path: "relationships.binding_inputs",
      value: [
        "root_task_id",
        "task_id",
        "canonical_repo_identity",
        "base_ref",
        "frozen_scope_acceptance_hash",
      ],
    },
  ],
  "identifier-lifetimes": [
    {
      path: "authoritative_fields",
      value: [
        "writer_generation",
        "fencing_token",
        "writer_generation_and_fencing_token",
        "completion_event_and_attempt_nonce",
      ],
    },
    {
      path: "allowed.stable",
      value: [
        "root_task_id",
        "runtime_root_or_plan_id",
        "plan_node_id",
        "task_id",
        "pr_group_binding",
      ],
    },
    {
      path: "allowed.fresh_per_handoff",
      value: ["writer_generation", "fencing_token"],
    },
    { path: "allowed.fresh_per_attempt", value: ["attempt_nonce"] },
    { path: "denied.reuse_generation_or_token", value: true },
    { path: "denied.reuse_attempt_nonce", value: true },
    {
      path: "relationships.handoff_requires",
      value: ["prior_worker_stopped", "lease_revoked", "token_revoked"],
    },
  ],
  "route-admission": [
    {
      path: "authoritative_fields",
      value: ["resolved_provider_profile_route", "provider_profile_route"],
    },
    { path: "allowed.route_identity", value: "immutable_receipt_bound" },
    { path: "allowed.reresolution", value: "same_identity_and_receipt" },
    { path: "denied.silent_substitution", value: true },
    { path: "denied.receipt_bypass", value: true },
    {
      path: "relationships.receipt_binds",
      value: [
        "task_id",
        "pr_group_binding",
        "writer_generation",
        "fencing_token",
      ],
    },
  ],
  "fenced-ownership": [
    {
      path: "authoritative_fields",
      value: [
        "writer_generation",
        "fencing_token",
        "writer_generation_and_fencing_token",
      ],
    },
    {
      path: "allowed.checkpoints",
      value: [
        "claim",
        "before_each_mutation",
        "before_commit",
        "before_push",
        "handoff",
      ],
    },
    {
      path: "allowed.mutation_primitive",
      value: "token_fenced_compare_and_write",
    },
    { path: "denied.revoked_writer_continues", value: true },
    { path: "denied.superseded_writer_continues", value: true },
    {
      path: "relationships.revalidate",
      value: [
        "owner",
        "writer_generation",
        "fencing_token",
        "route_receipt",
      ],
    },
  ],
  "completion-events": [
    {
      path: "authoritative_fields",
      value: ["completion_event", "completion_event_and_attempt_nonce"],
    },
    { path: "allowed.terminal_validation", value: "authoritative" },
    { path: "allowed.consume_count", value: 1 },
    { path: "allowed.nonce_per_attempt", value: "fresh" },
    { path: "denied.replay", value: true },
    { path: "denied.duplicate_consumption", value: true },
    {
      path: "relationships.event_matches",
      value: [
        "worker_identity",
        "run_id",
        "task_id",
        "writer_generation",
        "attempt_nonce",
        "terminal_outcome",
      ],
    },
  ],
  "finite-repair": [
    { path: "authoritative_fields", value: ["repair_cycle"] },
    { path: "allowed.max_cumulative_cycles", value: 2 },
    { path: "allowed.head_change_resets_count", value: false },
    {
      path: "allowed.residual_safe_landing",
      value: "requires_frozen_acceptance_pass",
    },
    { path: "denied.third_cycle", value: true },
    { path: "denied.count_decrement", value: true },
    {
      path: "relationships.exhaustion_actions",
      value: ["simplify", "revert", "split", "close", "defer"],
    },
  ],
  "identity-separation": [
    {
      path: "authoritative_fields",
      value: [
        "worker_identity_and_run_id",
        "reviewer_identities_and_run_ids",
        "merge_operator_identity_and_run_id",
      ],
    },
    { path: "allowed.pairwise_distinct_identities", value: true },
    { path: "allowed.pairwise_distinct_run_ids", value: true },
    { path: "allowed.merge_authority", value: "merge_operator_only" },
    { path: "denied.role_overlap", value: true },
    { path: "denied.reviewer_or_worker_merges", value: true },
    {
      path: "relationships.roles",
      value: ["worker", "every_reviewer", "merge_operator"],
    },
  ],
  "coordinator-state": [
    {
      path: "authoritative_fields",
      value: ["dependencies", "task_status"],
    },
    { path: "allowed.ready_work", value: "advance_nonoverlapping" },
    { path: "allowed.blocked_work", value: "yield_for_durable_signal" },
    { path: "denied.idle_with_ready_work", value: true },
    { path: "denied.repetitive_polling", value: true },
    {
      path: "relationships.statuses",
      value: ["pending", "in_progress", "completed", "failed", "cancelled"],
    },
  ],
  "failure-preservation": [
    {
      path: "authoritative_fields",
      value: ["worktree_and_branch", "task_status"],
    },
    { path: "allowed.unique_work", value: "preserve_reachable" },
    { path: "allowed.failure_state", value: "record_terminal_and_recovery" },
    { path: "denied.worker_exit_implies_completion", value: true },
    { path: "denied.discard_unique_work", value: true },
    {
      path: "relationships.preserve",
      value: ["worktree", "branch", "commits", "owner_and_token_evidence"],
    },
  ],
  "exact-head-merge": [
    { path: "authoritative_fields", value: ["merge_guard"] },
    { path: "allowed.review_target", value: "exact_remote_pr_head" },
    {
      path: "allowed.merge_guard",
      value: "provider_atomic_expected_head",
    },
    { path: "allowed.head_change_invalidates_artifacts", value: true },
    { path: "denied.advisory_only_guard", value: true },
    { path: "denied.head_drift_merge", value: true },
    {
      path: "relationships.required_artifacts",
      value: ["reviews", "approvals", "ci"],
    },
  ],
  "cleanup-gate": [
    {
      path: "authoritative_fields",
      value: ["worktree_and_branch", "cleanup_state"],
    },
    { path: "allowed.unknown_condition", value: "preserve_and_block" },
    { path: "allowed.unique_state", value: "preserve" },
    { path: "denied.early_cleanup", value: true },
    { path: "denied.uncertain_state_deletion", value: true },
    {
      path: "relationships.requires",
      value: [
        "no_active_writer",
        "clean_or_preserved_state",
        "durable_remote_reachability",
        "recorded_outcome",
        "dependencies_consumed",
      ],
    },
  ],
};

function validateContract(content: string): string[] {
  const violations: string[] = [];
  let manifest: InvariantManifest;

  try {
    manifest = parseManifest(content);
  } catch (error) {
    return [`manifest:parse:${String(error)}`];
  }

  if (manifest.version !== 1) {
    violations.push("manifest:version");
  }
  if (manifest.authoritative !== true) {
    violations.push("manifest:authority");
  }
  if (manifest.proof_boundary !== "typed_records_and_authoritative_text_fields") {
    violations.push("manifest:proof-boundary");
  }

  const actualIds = Object.keys(manifest.invariants).sort();
  if (!equalValue(actualIds, [...invariantIds].sort())) {
    violations.push("manifest:invariant-set");
  }

  for (const id of invariantIds) {
    const record = manifest.invariants[id];
    if (!record) {
      violations.push(`${id}:manifest:missing`);
      continue;
    }
    if (record.polarity !== "fail_closed") {
      violations.push(`${id}:manifest:polarity`);
    }
    if (
      !Array.isArray(record.authoritative_fields) ||
      record.authoritative_fields.length === 0
    ) {
      violations.push(`${id}:manifest:authoritative-fields`);
    }
    for (const expected of invariantExpectations[id]) {
      if (!equalValue(valueAtPath(record, expected.path), expected.value)) {
        violations.push(`${id}:manifest:${expected.path}`);
      }
    }
  }

  if (
    !equalValue(
      Object.keys(manifest.field_contracts).sort(),
      Object.keys(expectedFieldContracts).sort(),
    )
  ) {
    violations.push("manifest:field-contract-set");
  }

  const occurrences = parseTextFields(content);
  for (const [field, contract] of Object.entries(expectedFieldContracts)) {
    const prefixes =
      contract.invariants.length > 0 ? contract.invariants : ["manifest"];
    const addViolation = (suffix: string): void => {
      for (const prefix of prefixes) {
        violations.push(`${prefix}:field:${field}:${suffix}`);
      }
    };
    const recordedContract = manifest.field_contracts[field];
    if (!equalValue(recordedContract, contract)) {
      addViolation("manifest-contract");
    }
    if (
      !Array.isArray(contract.invariants) ||
      contract.invariants.length === 0 ||
      contract.invariants.some((id) => !invariantIds.includes(id))
    ) {
      addViolation("invariants");
      continue;
    }
    if (!Array.isArray(contract.sections) || contract.sections.length === 0) {
      addViolation("sections");
      continue;
    }
    const fieldOccurrences = occurrences.filter((entry) => entry.field === field);
    const expectedValue = policyReference(contract);

    for (const expectedSection of contract.sections) {
      const inSection = fieldOccurrences.filter(
        (entry) => entry.section === expectedSection,
      );
      if (inSection.length !== 1) {
        addViolation(`${expectedSection}:count`);
      }
    }
    for (const occurrence of fieldOccurrences) {
      if (!contract.sections.includes(occurrence.section)) {
        addViolation(`${occurrence.section}:unexpected`);
      }
      if (occurrence.value !== expectedValue) {
        addViolation(`${occurrence.section}:value`);
      }
    }
  }

  for (const id of invariantIds) {
    const record = manifest.invariants[id];
    for (const field of record?.authoritative_fields ?? []) {
      const contract = manifest.field_contracts[field];
      if (!contract || !contract.invariants.includes(id)) {
        violations.push(`${id}:manifest:unbound-field:${field}`);
      }
    }
  }

  return violations;
}

function replaceOnce(content: string, from: string, to: string): string {
  const index = content.indexOf(from);
  if (index < 0) {
    throw new Error(`fixture source not found: ${from}`);
  }
  return `${content.slice(0, index)}${to}${content.slice(index + from.length)}`;
}

function replaceFirstField(
  content: string,
  field: string,
  value: string,
): string {
  const expression = new RegExp(`^${field}: .+$`, "m");
  if (!expression.test(content)) {
    throw new Error(`field not found: ${field}`);
  }
  return content.replace(expression, `${field}: ${value}`);
}

function appendToSection(
  content: string,
  heading: string,
  addition: string,
): string {
  const body = section(content, heading);
  return replaceOnce(content, body, `${body.trimEnd()}\n\n${addition}\n`);
}

const riskFixtures: RiskFixture[] = [
  {
    id: "deterministic-binding",
    field: "pr_group_binding",
    manifestFrom: "active_pr_groups_max: 1",
    manifestTo: "active_pr_groups_max: 4",
    unsafeFieldValue: "<make room for a companion change request>",
    safeNearMiss:
      "A coordinator may not create another active PR group for the binding.",
  },
  {
    id: "identifier-lifetimes",
    field: "writer_generation",
    manifestFrom: "fresh_per_attempt: [attempt_nonce]",
    manifestTo: "fresh_per_attempt: [carry_forward_marker]",
    unsafeFieldValue: "<keep the same ownership epoch>",
    safeNearMiss: "An attempt nonce is not reusable.",
  },
  {
    id: "route-admission",
    field: "resolved_provider_profile_route",
    manifestFrom: "route_identity: immutable_receipt_bound",
    manifestTo: "route_identity: whichever_account_answers",
    unsafeFieldValue: "<whichever account resolves today>",
    safeNearMiss: "The route receipt must not be skipped.",
  },
  {
    id: "fenced-ownership",
    field: "fencing_token",
    manifestFrom: "mutation_primitive: token_fenced_compare_and_write",
    manifestTo: "mutation_primitive: ordinary_unchecked_write",
    unsafeFieldValue: "<accept an earlier lease credential>",
    safeNearMiss: "A superseded writer may not continue.",
  },
  {
    id: "completion-events",
    field: "completion_event",
    manifestFrom: "consume_count: 1",
    manifestTo: "consume_count: 2",
    unsafeFieldValue: "<trust the callback without checking durable state>",
    safeNearMiss: "A replayed completion event is not acceptable.",
  },
  {
    id: "finite-repair",
    field: "repair_cycle",
    manifestFrom: "max_cumulative_cycles: 2",
    manifestTo: "max_cumulative_cycles: 3",
    unsafeFieldValue: "<start the counter over after rebasing>",
    safeNearMiss:
      "The repair count must not return to zero after a head change.",
  },
  {
    id: "identity-separation",
    field: "reviewer_identities_and_run_ids",
    manifestFrom: "merge_authority: merge_operator_only",
    manifestTo: "merge_authority: any_participant",
    unsafeFieldValue: "<same person and execution may cover every role>",
    safeNearMiss: "A reviewer may not merge.",
  },
  {
    id: "coordinator-state",
    field: "dependencies",
    manifestFrom: "ready_work: advance_nonoverlapping",
    manifestTo: "ready_work: hold_until_worker_returns",
    unsafeFieldValue: "<pause despite unrelated ready items>",
    safeNearMiss:
      "The coordinator is not allowed to idle while ready work remains.",
  },
  {
    id: "failure-preservation",
    field: "worktree_and_branch",
    manifestFrom: "unique_work: preserve_reachable",
    manifestTo: "unique_work: remove_after_exit",
    unsafeFieldValue: "<remove the only local copy when the worker exits>",
    safeNearMiss: "Unique failed work must not be discarded.",
  },
  {
    id: "exact-head-merge",
    field: "merge_guard",
    manifestFrom: "merge_guard: provider_atomic_expected_head",
    manifestTo: "merge_guard: best_effort_observation",
    unsafeFieldValue: "<compare eventually after integration>",
    safeNearMiss: "The expected-head guard is not optional.",
  },
  {
    id: "cleanup-gate",
    field: "cleanup_state",
    manifestFrom: "unknown_condition: preserve_and_block",
    manifestTo: "unknown_condition: delete_immediately",
    unsafeFieldValue: "<tear down before reachability is known>",
    safeNearMiss: "Cleanup must not precede dependency readiness.",
  },
];

const exactReviewerUnsafeProbes: Array<{
  id: InvariantId;
  field: string;
  value: string;
}> = [
  {
    id: "deterministic-binding",
    field: "pr_group_binding",
    value: "<A retry may spin up another concurrent pull-request group>",
  },
  {
    id: "identifier-lifetimes",
    field: "completion_event_and_attempt_nonce",
    value: "<preserve the dispatch marker for the next attempt>",
  },
  {
    id: "route-admission",
    field: "resolved_provider_profile_route",
    value: "<allow switching without a receipt>",
  },
  {
    id: "fenced-ownership",
    field: "fencing_token",
    value: "<the retiring writer may finish its remaining writes>",
  },
  {
    id: "completion-events",
    field: "completion_event",
    value: "<allow replay before terminal validation>",
  },
  {
    id: "completion-events",
    field: "completion_event_and_attempt_nonce",
    value: "<process the duplicate completion twice>",
  },
  {
    id: "finite-repair",
    field: "repair_cycle",
    value: "<return the repair counter to zero after the head changes>",
  },
  {
    id: "identity-separation",
    field: "merge_operator_identity_and_run_id",
    value: "<give the reviewer merge authority>",
  },
  {
    id: "identity-separation",
    field: "reviewer_identities_and_run_ids",
    value: "<let identities and executions overlap across roles>",
  },
  {
    id: "coordinator-state",
    field: "dependencies",
    value: "<block all coordination while the worker runs>",
  },
  {
    id: "failure-preservation",
    field: "task_status",
    value: "<transition a failed task to completed after process exit>",
  },
  {
    id: "failure-preservation",
    field: "worktree_and_branch",
    value: "<remove the exclusive work when the failed process stops>",
  },
  {
    id: "exact-head-merge",
    field: "merge_guard",
    value: "<Treat expected-head protection as a recommendation>",
  },
  {
    id: "cleanup-gate",
    field: "cleanup_state",
    value: "<tear down the worktree before evidence and dependents settle>",
  },
];

describe("task-to-PR lifecycle skill", () => {
  test("has repository skill frontmatter and one balanced manifest", () => {
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
    expect(parsed.user_invocable).toBe(true);
    expect((content.match(/^\s*```.*$/gm)?.length ?? 0) % 2).toBe(0);
    expect(parseManifest(content).authoritative).toBe(true);
  });

  test("keeps the readable lifecycle and required output fields", () => {
    const content = readSkill();
    const output = section(content, "Evidence and Output Contract");

    expect(normalize(content)).toContain(
      "One coherent repository change produces exactly one PR",
    );
    expectInOrder(output, [
      "result:",
      "task_status:",
      "root_task_id:",
      "task_id:",
      "pr_group_binding:",
      "writer_generation_and_fencing_token:",
      "provider_profile_route:",
      "completion_event_and_attempt_nonce:",
      "repair_cycle:",
      "reviewer_identities_and_run_ids:",
      "merge_operator_identity_and_run_id:",
      "commit_and_exact_heads:",
      "validation:",
      "secret_scan:",
      "merge_guard:",
      "cleanup_state:",
      "blockers:",
    ]);
    expect(normalize(section(content, "Non-Goals and Exceptions"))).toContain(
      "Research, diagnosis, planning, status checks, and one-step read-only work are exempt",
    );
  });

  test("validates typed invariant records and all authoritative field values", () => {
    const content = readSkill();
    const manifest = parseManifest(content);

    expect(Object.keys(manifest.invariants).sort()).toEqual(
      [...invariantIds].sort(),
    );
    expect(new Set(riskFixtures.map((fixture) => fixture.id))).toEqual(
      new Set(invariantIds),
    );
    expect(new Set(exactReviewerUnsafeProbes.map((probe) => probe.id))).toEqual(
      new Set(invariantIds),
    );
    expect(validateContract(content)).toEqual([]);
  });

  test("rejects typed unsafe states with invariant-specific violations", () => {
    const content = readSkill();

    for (const fixture of riskFixtures) {
      const mutated = replaceOnce(
        content,
        fixture.manifestFrom,
        fixture.manifestTo,
      );
      const violations = validateContract(mutated);
      expect(
        violations.some((violation) =>
          violation.startsWith(`${fixture.id}:manifest:`),
        ),
        `${fixture.id}: ${violations.join(", ")}`,
      ).toBe(true);
    }
  });

  test("rejects paraphrased unsafe values in authoritative fields", () => {
    const content = readSkill();

    for (const fixture of riskFixtures) {
      const mutated = replaceFirstField(
        content,
        fixture.field,
        fixture.unsafeFieldValue,
      );
      const violations = validateContract(mutated);
      expect(
        violations.some((violation) => violation.startsWith(`${fixture.id}:`)),
        `${fixture.id}: ${violations.join(", ")}`,
      ).toBe(true);
    }
  });

  test("replays every exact rejected-head unsafe probe structurally", () => {
    const content = readSkill();

    for (const probe of exactReviewerUnsafeProbes) {
      const violations = validateContract(
        replaceFirstField(content, probe.field, probe.value),
      );
      expect(
        violations.some((violation) => violation.startsWith(`${probe.id}:`)),
        `${probe.id}: ${probe.value}: ${violations.join(", ")}`,
      ).toBe(true);
    }
  });

  test("enforces authoritative fields when repeated in another section", () => {
    const content = readSkill();

    for (const fixture of riskFixtures) {
      const mutated = appendToSection(
        content,
        "Non-Goals and Exceptions",
        [
          "```text",
          `${fixture.field}: ${fixture.unsafeFieldValue}`,
          "```",
        ].join("\n"),
      );
      const violations = validateContract(mutated);
      expect(
        violations.some((violation) => violation.startsWith(`${fixture.id}:`)),
        `${fixture.id}: ${violations.join(", ")}`,
      ).toBe(true);
    }
  });

  test("accepts strengthening negations and positive near-misses", () => {
    const content = readSkill();

    for (const fixture of riskFixtures) {
      const mutated = appendToSection(
        content,
        "Non-Goals and Exceptions",
        fixture.safeNearMiss,
      );
      expect(
        validateContract(mutated),
        `${fixture.id}: ${fixture.safeNearMiss}`,
      ).toEqual([]);
    }
  });

  test("does not claim natural-language semantic enforcement", () => {
    const contract = normalize(
      section(readSkill(), "Machine-Checkable Invariant Contract"),
    );

    expect(contract).toContain(
      "validates typed records and authoritative fenced field values",
    );
    expect(contract).toContain(
      "It does not claim to infer policy meaning from unrestricted prose",
    );
  });
});
