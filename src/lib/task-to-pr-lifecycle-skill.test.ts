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

type InvariantId =
  | "deterministic-binding"
  | "identifier-lifetimes"
  | "route-admission"
  | "fenced-ownership"
  | "completion-events"
  | "finite-repair"
  | "identity-separation"
  | "coordinator-state"
  | "failure-preservation"
  | "exact-head-merge"
  | "cleanup-gate";

type SemanticClause = {
  label: string;
  concepts: string[][];
};

type StructuralExpectation = {
  section: string;
  fields?: string[];
  subheadings?: string[];
  terms?: string[];
};

type ContractRule = {
  id: InvariantId;
  section: string;
  structures: StructuralExpectation[];
  required: SemanticClause[];
  unsafe: SemanticClause[];
};

type ParsedSection = {
  heading: string;
  body: string;
  fields: string[];
  subheadings: string[];
  statements: string[];
};

type ParsedContract = {
  sections: Map<string, ParsedSection>;
  statements: string[];
};

function semanticText(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${normalized} `;
}

function containsSemanticAlternative(
  statement: string,
  alternatives: string[],
): boolean {
  const normalizedStatement = semanticText(statement);
  return alternatives.some((alternative) =>
    normalizedStatement.includes(semanticText(alternative)),
  );
}

function matchesSemanticClause(
  statement: string,
  clause: SemanticClause,
): boolean {
  return clause.concepts.every((alternatives) =>
    containsSemanticAlternative(statement, alternatives),
  );
}

function parseStatements(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join(" "));
      current = [];
    }
  };

  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence || line.startsWith("### ")) {
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      flush();
      current.push(line.replace(/^(?:[-*]|\d+\.)\s+/, ""));
      continue;
    }
    current.push(line);
  }
  flush();

  return blocks.flatMap((block) =>
    block
      .split(/(?<=[.!?])\s+(?=[A-Z`])/)
      .map((statement) => statement.trim())
      .filter(Boolean),
  );
}

function parseContract(content: string): ParsedContract {
  const source = content.replace(/\r\n/g, "\n");
  const matches = [...source.matchAll(/^## ([^\n]+)\n/gm)];
  const sections = new Map<string, ParsedSection>();

  for (const [index, match] of matches.entries()) {
    const heading = match[1]?.trim() ?? "";
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? source.length;
    const body = source.slice(bodyStart, bodyEnd);
    sections.set(heading, {
      heading,
      body,
      fields: [...body.matchAll(/^([a-z][a-z0-9_]*):/gm)].map(
        (field) => field[1] ?? "",
      ),
      subheadings: [...body.matchAll(/^### ([^\n]+)$/gm)].map(
        (subheading) => subheading[1]?.trim() ?? "",
      ),
      statements: parseStatements(body),
    });
  }

  return {
    sections,
    statements: [...sections.values()].flatMap((entry) => entry.statements),
  };
}

const contractRules: ContractRule[] = [
  {
    id: "deterministic-binding",
    section: "Deterministic PR-Group Binding",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: [
          "root_task_id",
          "task_id",
          "canonical_repo_identity",
          "base_ref",
          "frozen_scope_acceptance_hash",
          "pr_group_binding",
        ],
      },
      {
        section: "Evidence and Output Contract",
        fields: ["pr_group_binding", "pr_group_binding_inputs", "pr"],
      },
    ],
    required: [
      {
        label: "ordered tuple is canonicalized and hashed",
        concepts: [
          ["canonicalize"],
          ["hash"],
          ["ordered tuple"],
          ["root_task_id"],
          ["task_id"],
          ["canonical_repo_identity"],
          ["base_ref"],
          ["frozen_scope_acceptance_hash"],
        ],
      },
      {
        label: "second active group is rejected",
        concepts: [
          ["reject"],
          ["second active"],
          ["pr group"],
          ["binding"],
        ],
      },
      {
        label: "retry and handoff retain the binding",
        concepts: [
          ["retries"],
          ["handoffs"],
          ["keep the same binding"],
        ],
      },
    ],
    unsafe: [
      {
        label: "retry creates a replacement active group",
        concepts: [
          ["retry", "repair"],
          ["second", "replacement", "additional"],
          ["active"],
          ["pr group"],
          ["create", "open", "start", "allow", "permit"],
        ],
      },
    ],
  },
  {
    id: "identifier-lifetimes",
    section: "Identifier Lifetimes",
    structures: [
      {
        section: "Identifier Lifetimes",
        subheadings: [
          "Stable lineage IDs",
          "Fresh per-handoff and per-attempt IDs",
        ],
        terms: [
          "root_task_id",
          "runtime_root_or_plan_id",
          "plan_node_id",
          "task_id",
          "pr_group_binding",
          "writer_generation",
          "fencing_token",
          "attempt_nonce",
        ],
      },
      {
        section: "Evidence and Output Contract",
        fields: [
          "root_task_id",
          "runtime_root_or_plan_id",
          "plan_node_id",
          "task_id",
          "writer_generation_and_fencing_token",
          "completion_event_and_attempt_nonce",
        ],
      },
    ],
    required: [
      {
        label: "handoff revokes old ownership before fresh fencing",
        concepts: [
          ["handoff"],
          ["revoked"],
          ["fresh writer generation"],
          ["fresh fencing token"],
        ],
      },
      {
        label: "every retry mints a fresh attempt nonce",
        concepts: [
          ["every retry", "every dispatch attempt"],
          ["fresh attempt nonce"],
          ["current worker"],
          ["generation"],
        ],
      },
    ],
    unsafe: [
      {
        label: "attempt nonce is reusable across attempts",
        concepts: [
          ["attempt nonce"],
          ["reuse", "reusable", "recycle", "recycled"],
          ["retry", "attempt"],
        ],
      },
    ],
  },
  {
    id: "route-admission",
    section: "Route Admission",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: [
          "pinned_provider_profile_alias",
          "resolved_provider_profile_route",
          "admitted_capabilities",
        ],
      },
      {
        section: "Evidence and Output Contract",
        fields: ["provider_profile_route"],
      },
    ],
    required: [
      {
        label: "provider profile alias is pinned",
        concepts: [
          ["pin"],
          ["provider profile alias"],
          ["worker input"],
        ],
      },
      {
        label: "resolved route and receipt are immutable",
        concepts: [
          ["immutable resolved route identity"],
          ["admission receipt"],
          ["writer generation"],
          ["fencing token"],
        ],
      },
      {
        label: "silent route substitution is prohibited",
        concepts: [
          ["provider or profile substitution"],
          ["prohibited"],
        ],
      },
    ],
    unsafe: [
      {
        label: "route changes bypass the immutable receipt",
        concepts: [
          ["provider profile route", "provider or profile route"],
          ["change", "substitute", "remap"],
          ["without", "bypass", "skip"],
          ["admission receipt", "original receipt"],
        ],
      },
    ],
  },
  {
    id: "fenced-ownership",
    section: "Fenced Checkpoints",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: ["writer_generation", "fencing_token"],
      },
      {
        section: "Evidence and Output Contract",
        fields: ["writer_generation_and_fencing_token"],
      },
    ],
    required: [
      {
        label: "all five checkpoints are mandatory",
        concepts: [
          ["at claim"],
          ["before each mutation"],
          ["before commit"],
          ["before push"],
          ["at handoff"],
          ["revalidate"],
        ],
      },
      {
        label: "mutations use fail-closed fenced writes",
        concepts: [
          ["every mutation"],
          ["token fenced compare and write"],
          ["fail closed"],
        ],
      },
      {
        label: "inactive writer cannot act",
        concepts: [
          ["revoked"],
          ["superseded"],
          ["writer"],
          ["cannot mutate"],
          ["push"],
          ["hand off"],
        ],
      },
    ],
    unsafe: [
      {
        label: "inactive writer continues writing",
        concepts: [
          ["writer", "writers"],
          ["revoked", "retiring", "superseded"],
          ["mutate", "push", "publish", "write", "commit"],
          ["continue", "remain authorized", "allowed", "permitted", "may", "can"],
        ],
      },
    ],
  },
  {
    id: "completion-events",
    section: "Completion Events",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: ["completion_event"],
      },
      {
        section: "Evidence and Output Contract",
        fields: ["completion_event_and_attempt_nonce"],
      },
    ],
    required: [
      {
        label: "event binds the exact attempt identity",
        concepts: [
          ["durable completion or failure event"],
          ["worker identity"],
          ["task id"],
          ["writer generation"],
          ["fresh attempt_nonce"],
        ],
      },
      {
        label: "event is validated against terminal state",
        concepts: [
          ["before consuming"],
          ["authoritative current terminal state"],
          ["attempt nonce"],
          ["terminal outcome"],
        ],
      },
      {
        label: "event is consumed once with a replay marker",
        concepts: [
          ["consume it once"],
          ["atomic replay marker"],
        ],
      },
      {
        label: "stale and replayed events are rejected",
        concepts: [
          ["reject"],
          ["replayed"],
        ],
      },
    ],
    unsafe: [
      {
        label: "completion accepted without terminal validation",
        concepts: [
          ["completion event", "completion message", "completion signal"],
          ["accept", "consume", "trust"],
          ["before", "without", "skip"],
          ["authoritative terminal validation", "authoritative terminal state"],
        ],
      },
      {
        label: "completion replay is accepted",
        concepts: [
          ["completion event", "completion message"],
          ["consume", "process", "processed", "accept"],
          ["again", "replay", "repeatedly"],
          ["allow", "permitted", "may", "can"],
        ],
      },
    ],
  },
  {
    id: "finite-repair",
    section: "Finite Repair Lifecycle",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: ["repair_cycle"],
      },
      {
        section: "Evidence and Output Contract",
        fields: ["repair_cycle"],
      },
    ],
    required: [
      {
        label: "repair is capped at two cumulative cycles",
        concepts: [
          ["at most two"],
          ["cumulative repair"],
          ["one deterministic binding"],
        ],
      },
      {
        label: "head and force updates preserve repair count",
        concepts: [
          ["head changes"],
          ["never reset"],
          ["cumulative repair count"],
        ],
      },
      {
        label: "cycle two is terminal",
        concepts: [
          ["cycle 2 is terminal"],
          ["no third repair"],
          ["permitted"],
        ],
      },
    ],
    unsafe: [
      {
        label: "head update restarts repair history",
        concepts: [
          ["head update", "force update", "force push"],
          ["repair history", "repair count", "repair cycle"],
          [
            "restart",
            "restarts",
            "resets",
            "begin again",
            "start over",
            "back to zero",
            "at zero",
          ],
        ],
      },
    ],
  },
  {
    id: "identity-separation",
    section: "Identity Separation",
    structures: [
      {
        section: "Dispatch Input Contract",
        fields: [
          "worker_identity_and_run_id",
          "reviewer_identities_and_run_ids",
          "merge_operator_identity_and_run_id",
        ],
      },
      {
        section: "Evidence and Output Contract",
        fields: [
          "worker_identity_and_run_id",
          "reviewer_identities_and_run_ids",
          "merge_operator_identity_and_run_id",
        ],
      },
    ],
    required: [
      {
        label: "execution identities and runs are pairwise distinct",
        concepts: [
          ["worker"],
          ["every reviewer"],
          ["merge operator"],
          ["pairwise distinct"],
          ["identity"],
          ["run id"],
        ],
      },
      {
        label: "only merge operator may merge",
        concepts: [
          ["only the recorded merge operator"],
          ["invoke merge"],
        ],
      },
    ],
    unsafe: [
      {
        label: "review role is allowed to merge",
        concepts: [
          ["reviewer", "replacement reviewer"],
          ["merge", "land"],
          ["allowed", "permitted", "authorized", "may", "can"],
        ],
      },
      {
        label: "execution identities overlap",
        concepts: [
          ["worker"],
          ["reviewer", "merge operator"],
          ["share", "same", "overlap"],
          ["identity", "run id"],
        ],
      },
    ],
  },
  {
    id: "coordinator-state",
    section: "Coordinator Loop and Task State",
    structures: [
      {
        section: "Evidence and Output Contract",
        fields: ["result", "task_status", "blockers"],
      },
    ],
    required: [
      {
        label: "coordinator advances ready work instead of idling",
        concepts: [
          ["after dispatch"],
          ["immediately advance"],
          ["safe"],
          ["ready"],
          ["non overlapping task"],
        ],
      },
      {
        label: "task statuses are closed and supported",
        concepts: [
          ["pending"],
          ["in_progress"],
          ["completed"],
          ["failed"],
          ["cancelled"],
          ["only task statuses"],
        ],
      },
      {
        label: "failed worker never reports completion",
        concepts: [
          ["failed or cancelled worker"],
          ["terminal status"],
          ["never reports false completion"],
        ],
      },
    ],
    unsafe: [
      {
        label: "coordinator idles while worker runs",
        concepts: [
          ["coordinator"],
          ["idle", "wait"],
          ["worker", "implementation"],
          ["runs", "active", "in progress"],
          ["may", "can", "allowed", "permitted"],
        ],
      },
    ],
  },
  {
    id: "failure-preservation",
    section: "Failure Preservation",
    structures: [
      {
        section: "Evidence and Output Contract",
        fields: ["result", "task_status", "cleanup_state", "blockers"],
      },
    ],
    required: [
      {
        label: "unique failed worktree and branch are preserved",
        concepts: [
          ["unique changes"],
          ["failed"],
          ["preserve the worktree and branch"],
        ],
      },
      {
        label: "partial evidence cannot complete owning task",
        concepts: [
          ["never discard unique work"],
          ["stale writer"],
          ["mark the owning task complete"],
          ["partial evidence"],
        ],
      },
    ],
    unsafe: [
      {
        label: "success overwrites failed task outcome",
        concepts: [
          ["success", "successful worker exit"],
          ["failed task", "cancelled task", "failed or cancelled task"],
          ["completed", "complete"],
          ["overwrite", "change", "replace", "mark"],
        ],
      },
      {
        label: "unique failed work is discarded",
        concepts: [
          ["failed", "cancelled"],
          ["unique work", "unique changes"],
          ["discard", "discarded", "delete", "remove"],
          ["allow", "permitted", "may", "can"],
        ],
      },
    ],
  },
  {
    id: "exact-head-merge",
    section: "Review and Merge",
    structures: [
      {
        section: "Evidence and Output Contract",
        fields: [
          "reviewer_identities_and_run_ids",
          "merge_operator_identity_and_run_id",
          "commit_and_exact_heads",
          "merge_guard",
        ],
      },
    ],
    required: [
      {
        label: "review and CI validate exact head",
        concepts: [
          ["reviewers and ci"],
          ["validate"],
          ["exact remote pr head"],
        ],
      },
      {
        label: "head change invalidates exact-head evidence",
        concepts: [
          ["any head change"],
          ["invalidates"],
          ["review"],
          ["ci artifact"],
        ],
      },
      {
        label: "merge atomically compares provider head",
        concepts: [
          ["merge must atomically compare"],
          ["provider authoritative current head"],
          ["recorded reviewed head"],
        ],
      },
      {
        label: "missing expected-head guard prevents merge",
        concepts: [
          ["missing expected head guard"],
          ["prevents merge"],
        ],
      },
    ],
    unsafe: [
      {
        label: "expected-head protection is weakened",
        concepts: [
          ["expected head guard", "expected head comparison"],
          ["optional", "advisory", "best effort"],
        ],
      },
    ],
  },
  {
    id: "cleanup-gate",
    section: "Cleanup Gate",
    structures: [
      {
        section: "Evidence and Output Contract",
        fields: ["cleanup_state", "blockers"],
      },
    ],
    required: [
      {
        label: "cleanup requires inactive ownership",
        concepts: [
          ["no active owner"],
          ["writer"],
          ["lease"],
          ["worker process"],
        ],
      },
      {
        label: "cleanup requires clean or preserved worktree",
        concepts: [
          ["worktree is clean"],
          ["unique remaining state"],
          ["preserved"],
        ],
      },
      {
        label: "cleanup requires durable reachable commits",
        concepts: [
          ["required commit"],
          ["reachable"],
          ["durable remote ref"],
        ],
      },
      {
        label: "cleanup requires authoritative lifecycle evidence",
        concepts: [
          ["pr"],
          ["exact head"],
          ["merge outcome"],
          ["recorded"],
          ["stable lineage ids"],
        ],
      },
      {
        label: "cleanup requires dependency readiness",
        concepts: [
          ["dependents consumed"],
          ["no longer depend"],
          ["worktree"],
        ],
      },
      {
        label: "unknown cleanup evidence blocks deletion",
        concepts: [
          ["condition is unknown"],
          ["preserve the worktree"],
          ["cleanup_state blocked"],
        ],
      },
    ],
    unsafe: [
      {
        label: "cleanup precedes authoritative readiness",
        concepts: [
          ["cleanup", "delete the worktree", "remove the worktree"],
          ["before", "without"],
          [
            "authoritative merge",
            "merge outcome",
            "evidence readiness",
            "dependency readiness",
            "dependents are ready",
          ],
        ],
      },
    ],
  },
];

function validateContract(content: string): string[] {
  const parsed = parseContract(content);
  const violations: string[] = [];

  for (const rule of contractRules) {
    for (const structure of rule.structures) {
      const parsedSection = parsed.sections.get(structure.section);
      if (!parsedSection) {
        violations.push(`${rule.id}:missing-section:${structure.section}`);
        continue;
      }
      for (const field of structure.fields ?? []) {
        if (!parsedSection.fields.includes(field)) {
          violations.push(`${rule.id}:missing-field:${field}`);
        }
      }
      for (const subheading of structure.subheadings ?? []) {
        if (!parsedSection.subheadings.includes(subheading)) {
          violations.push(`${rule.id}:missing-subheading:${subheading}`);
        }
      }
      for (const term of structure.terms ?? []) {
        if (!semanticText(parsedSection.body).includes(semanticText(term))) {
          violations.push(`${rule.id}:missing-term:${term}`);
        }
      }
    }

    const semanticSection = parsed.sections.get(rule.section);
    if (!semanticSection) {
      violations.push(`${rule.id}:missing-section:${rule.section}`);
      continue;
    }
    for (const requirement of rule.required) {
      if (
        !semanticSection.statements.some((statement) =>
          matchesSemanticClause(statement, requirement),
        )
      ) {
        violations.push(`${rule.id}:missing-required:${requirement.label}`);
      }
    }
    for (const unsafe of rule.unsafe) {
      if (
        parsed.statements.some((statement) =>
          matchesSemanticClause(statement, unsafe),
        )
      ) {
        violations.push(`${rule.id}:unsafe:${unsafe.label}`);
      }
    }
  }

  return [...new Set(violations)];
}

function appendToSection(
  content: string,
  heading: string,
  unsafeStatement: string,
): string {
  const marker = `## ${heading}\n`;
  const sectionStart = content.indexOf(marker);
  if (sectionStart === -1) {
    throw new Error(`missing mutation section: ${heading}`);
  }
  const nextSection = content.indexOf("\n## ", sectionStart + marker.length);
  const insertAt = nextSection === -1 ? content.length : nextSection;
  return `${content.slice(0, insertAt).trimEnd()}\n\n${unsafeStatement}\n${content.slice(insertAt)}`;
}

function substituteContractText(
  content: string,
  safeText: string,
  unsafeText: string,
): string {
  if (!content.includes(safeText)) {
    throw new Error(`missing mutation source: ${safeText}`);
  }
  return content.replace(safeText, unsafeText);
}

type UnsafeMutation = {
  name: string;
  invariant: InvariantId;
  kind: "append" | "substitute";
  mutate: (content: string) => string;
};

const unsafeMutations: UnsafeMutation[] = [
  {
    name: "retry creates a replacement active PR group",
    invariant: "deterministic-binding",
    kind: "substitute",
    mutate: (content) =>
      substituteContractText(
        content,
        "Reject regrouping and reject a second active\nPR group for the same binding.",
        "Following a retry, create a replacement active PR group for the same binding.",
      ),
  },
  {
    name: "retry permits a second active PR group",
    invariant: "deterministic-binding",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Deterministic PR-Group Binding",
        "After a repair retry, allow a second active PR group to open.",
      ),
  },
  {
    name: "attempt nonce becomes reusable",
    invariant: "identifier-lifetimes",
    kind: "substitute",
    mutate: (content) =>
      substituteContractText(
        content,
        "Every retry or dispatch attempt mints a fresh attempt nonce and binds it to the\ncurrent worker, task, generation, and expected terminal outcome.",
        "The attempt nonce is reusable for later retry attempts and remains bound to the current worker.",
      ),
  },
  {
    name: "provider profile route bypasses its receipt",
    invariant: "route-admission",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Route Admission",
        "The provider/profile route may change without validating the original admission receipt.",
      ),
  },
  {
    name: "revoked retiring and superseded writers keep pushing",
    invariant: "fenced-ownership",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Fenced Checkpoints",
        "Revoked, retiring, or superseded writers remain authorized to push and publish commits.",
      ),
  },
  {
    name: "completion accepted before terminal validation",
    invariant: "completion-events",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Completion Events",
        "Accept a completion message before authoritative terminal validation finishes.",
      ),
  },
  {
    name: "completion replay is processed twice",
    invariant: "completion-events",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Completion Events",
        "A completion event may be processed again when a consumer misses its local acknowledgement.",
      ),
  },
  {
    name: "repair history restarts after a head update",
    invariant: "finite-repair",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Finite Repair Lifecycle",
        "A head update restarts the repair history.",
      ),
  },
  {
    name: "repair history begins again after a force update",
    invariant: "finite-repair",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Finite Repair Lifecycle",
        "After a force update, begin the repair history again at zero.",
      ),
  },
  {
    name: "reviewer is permitted to merge",
    invariant: "identity-separation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Identity Separation",
        "A reviewer is permitted to merge after recording findings.",
      ),
  },
  {
    name: "replacement reviewer is authorized to land",
    invariant: "identity-separation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Identity Separation",
        "A replacement reviewer is authorized to land the PR.",
      ),
  },
  {
    name: "worker and reviewer share an identity",
    invariant: "identity-separation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Identity Separation",
        "The worker and reviewer may share the same identity.",
      ),
  },
  {
    name: "coordinator idles while a worker runs",
    invariant: "coordinator-state",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Coordinator Loop and Task State",
        "The coordinator may idle while the implementation worker runs.",
      ),
  },
  {
    name: "success overwrites a failed task",
    invariant: "failure-preservation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Failure Preservation",
        "A successful worker exit may change a failed task to completed.",
      ),
  },
  {
    name: "success overwrites a cancelled task",
    invariant: "failure-preservation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Failure Preservation",
        "A successful worker exit may replace a cancelled task with completed status.",
      ),
  },
  {
    name: "unique failed work may be discarded",
    invariant: "failure-preservation",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Failure Preservation",
        "Failed unique changes may be discarded after the worker exits.",
      ),
  },
  {
    name: "expected-head guard is optional",
    invariant: "exact-head-merge",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Review and Merge",
        "The expected-head guard is optional during merge.",
      ),
  },
  {
    name: "expected-head comparison is advisory",
    invariant: "exact-head-merge",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Review and Merge",
        "Expected-head comparison is advisory for protected branches.",
      ),
  },
  {
    name: "expected-head guard is best effort",
    invariant: "exact-head-merge",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Review and Merge",
        "The expected-head guard is best-effort when provider checks are green.",
      ),
  },
  {
    name: "cleanup precedes authoritative merge",
    invariant: "cleanup-gate",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Cleanup Gate",
        "Delete the worktree before authoritative merge is confirmed.",
      ),
  },
  {
    name: "cleanup precedes evidence readiness",
    invariant: "cleanup-gate",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Cleanup Gate",
        "Cleanup may run before evidence readiness.",
      ),
  },
  {
    name: "cleanup precedes dependency readiness",
    invariant: "cleanup-gate",
    kind: "append",
    mutate: (content) =>
      appendToSection(
        content,
        "Cleanup Gate",
        "Remove the worktree without dependency readiness.",
      ),
  },
];

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

  test("parses and validates every lifecycle invariant structurally", () => {
    const content = readSkill();
    const parsed = parseContract(content);

    expect([...parsed.sections.keys()]).toEqual([
      "Invariants",
      "Dispatch Input Contract",
      "Deterministic PR-Group Binding",
      "Identifier Lifetimes",
      "Route Admission",
      "Fenced Checkpoints",
      "Completion Events",
      "Coordinator Loop and Task State",
      "Worker Lifecycle",
      "Finite Repair Lifecycle",
      "Identity Separation",
      "Review and Merge",
      "Failure Preservation",
      "Cleanup Gate",
      "Evidence and Output Contract",
      "Non-Goals and Exceptions",
    ]);
    expect(
      contractRules.every(
        (rule) =>
          rule.structures.length > 0 &&
          rule.required.length > 0 &&
          rule.unsafe.length > 0,
      ),
    ).toBe(true);
    expect(validateContract(content)).toEqual([]);
  });

  test("table-driven unsafe mutations fail closed with invariant-specific violations", () => {
    const content = readSkill();
    expect(new Set(unsafeMutations.map((fixture) => fixture.invariant))).toEqual(
      new Set(contractRules.map((rule) => rule.id)),
    );
    expect(new Set(unsafeMutations.map((fixture) => fixture.kind))).toEqual(
      new Set(["append", "substitute"]),
    );

    for (const fixture of unsafeMutations) {
      const violations = validateContract(fixture.mutate(content));
      expect(
        violations.some((violation) =>
          violation.startsWith(`${fixture.invariant}:unsafe:`),
        ),
        `${fixture.name}: ${violations.join(", ")}`,
      ).toBe(true);
    }
  });
});
