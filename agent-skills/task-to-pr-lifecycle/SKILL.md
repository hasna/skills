---
name: task-to-pr-lifecycle
description: "Use when an interactive coordinator routes one bounded repository change from an owning task through a fenced worker, deterministic PR group, validation, finite repair, exact-head review, merge handoff, and evidence-backed cleanup."
user_invocable: true
---

# Task-to-PR Lifecycle

Use this workflow when an interactive coordinator delegates repository-mutating
work. One coherent repository change produces exactly one PR. The lifecycle is
owned by stable task lineage, a deterministic PR-group binding, and a single
token-fenced writer at a time.

## Invariants

- Exactly one Todos root owns the outcome. Materially multi-step owner work
  creates or reuses exactly one runtime-native root or goal plan and links it
  to that Todos root with stable IDs.
- Workers inherit the root, plan, node, and assigned task IDs. They do not
  create competing roots, plans, or duplicate tasks unless the assignment
  explicitly transfers orchestration ownership.
- Use one task-owned worktree under `$HOME/.hasna/repos/worktrees`, one
  non-protected branch, one active writer in one active lease generation, and
  one deterministic active PR group. Never mutate a shared checkout.
- A writer generation and its fencing token are non-reusable ownership
  boundaries. A writer may act only while both values and its owner identity
  match authoritative current state.
- Existing authorization covers ordinary reversible execution within the
  frozen scope. Escalate only a genuinely new destructive, secret-bearing,
  public, spend, ownership, or user-only decision.

When instructions conflict, follow the applicable authority order and the more
specific in-scope instruction. Never downgrade an active safety control.
Preserve sole-writer, immutable binding, finite repair, identity separation,
and expected-head guards; record an unresolved conflict as a blocker.

## Dispatch Input Contract

Do not dispatch until the coordinator provides or authoritatively resolves:

```text
root_task_id: <stable Todos root ID>
runtime_root_or_plan_id: <stable runtime-native root or goal-plan ID|none>
plan_node_id: <stable node ID|none>
task_id: <stable assigned task ID>
canonical_repo_identity: <canonical owner/name plus normalized immutable remote identity>
base_ref: <fully qualified or provider-canonical base ref>
frozen_scope_acceptance_hash: <sha256:64-lowercase-hex>
pr_group_binding: <deterministic immutable ID derived from root_task_id + task_id + canonical_repo_identity + base_ref + frozen_scope_acceptance_hash>
scope_and_acceptance: <bounded mutation, exclusions, and done criteria matching the frozen hash>
worktree_and_branch: <task-owned absolute path and one non-protected branch>
worker_identity_and_run_id: <worker identity plus unique run ID>
writer_generation: <fresh generation ID, current owner, and active state>
fencing_token: <fresh non-reusable token bound to task, owner, generation, and PR group>
pinned_provider_profile_alias: <admitted alias, never an email or credential>
resolved_provider_profile_route: <immutable route identity and admission receipt>
reviewer_identities_and_run_ids: <one entry per required independent reviewer>
merge_operator_identity_and_run_id: <the only operator authorized to merge>
repair_cycle: <0|1|2 and durable cumulative history>
dependencies: <stable IDs and current readiness>
admitted_capabilities: <checkout, subprocess, network, Git metadata, push, and PR>
completion_event: <durable worker/task/generation/attempt_nonce contract>
validation_and_cleanup_owner: <required gates and responsible roles>
```

Reject ambiguous ownership, an unfrozen acceptance contract, overlapping write
scope, stale generations or tokens, shared-checkout paths, missing stable IDs,
non-distinct execution identities, or a conflicting PR-group record.

## Deterministic PR-Group Binding

Canonicalize and hash the exact ordered tuple of `root_task_id`, `task_id`,
`canonical_repo_identity`, `base_ref`, and `frozen_scope_acceptance_hash`.
Canonicalization must be deterministic, versioned, and recorded with the
resulting `pr_group_binding`; do not accept caller-chosen labels as the binding.

Before branch mutation or PR creation, query authoritative lifecycle evidence
by the complete tuple and binding. Reject regrouping and reject a second active
PR group for the same binding. Also reject a supplied binding that resolves to
different tuple inputs. Retries, repairs, head changes, and provider or worker
handoffs keep the same binding. A deliberately changed repository, base, root
or assigned task, or frozen acceptance contract is new work and needs a new
bounded task plus a newly derived binding; it cannot rewrite the old record.

One binding may reference successive exact heads of its one branch and PR, but
never concurrent active PRs. Close or terminally disposition the original
binding before separately scoped follow-up work begins.

## Identifier Lifetimes

### Stable lineage IDs

The following survive retries, repair cycles, provider handoffs, worker
handoffs, exact-head changes, and merge handoff:

- `root_task_id`
- `runtime_root_or_plan_id`
- `plan_node_id`
- `task_id`
- `pr_group_binding`

The canonical repository identity, base ref, and frozen scope acceptance hash
are immutable inputs to that stable lineage.

### Fresh per-handoff and per-attempt IDs

The following are deliberately short-lived:

- `writer_generation`
- `fencing_token`
- `attempt_nonce`

Every provider or worker handoff first proves the prior worker stopped and the
prior lease and token were revoked, then issues both a fresh writer generation
and a fresh fencing token. Record prior and next owners, generations, token
states, and revocation evidence atomically with the transfer. Missing stop or
revocation evidence blocks successor admission.

Every retry or dispatch attempt mints a fresh attempt nonce and binds it to the
current worker, task, generation, and expected terminal outcome. Stable lineage
IDs never become fresh attempt IDs, and fresh IDs are never preserved across
the boundary that invalidates them.

## Route Admission

Prove the execution route before dispatch. It must be subscription-backed and
headless, with the assigned checkout, subprocess, network, Git metadata, push,
and PR capabilities admitted sufficiently for the work.

Pin the admitted provider/profile alias in worker input. Resolve it through the
authoritative account surface and bind the result to an immutable resolved
route identity, admission receipt, task ID, writer generation, and fencing
token. Silent provider or profile substitution is prohibited. Re-resolution
must return the same immutable identity and validate the original receipt.
Reject alias remapping, a stale receipt, or an unavailable admitted capability.

Infinity is eligible only when the exact capability set is admitted. A direct,
durable Codewith route is the controlled fallback when another route cannot
prove it. Never use tmux prompt paste. Identify provider routes with aliases
and non-secret IDs only; never expose emails, tokens, or credentials.

Detect supported surfaces before invoking the owning Todos, worktree,
dispatch, secret-scan, PR, review, or merge CLI. A missing adapter does not
permit a weaker gate.

## Fenced Checkpoints

At all five checkpoints—at claim, before each mutation, before commit, before
push, and at handoff—authoritatively re-resolve the pinned provider/profile
route and revalidate the current owner, writer generation, and fencing token.
The evidence source must bind the same task, immutable PR group, worktree,
branch, route receipt, owner, generation, and token state.

Every mutation must use a token-fenced compare-and-write or equivalent
fail-closed primitive. Its precondition includes the expected current owner,
generation, and fencing token, so a concurrent transfer or revocation causes
the operation to fail without writing. Git commit, push, PR mutation, and
handoff evidence are mutations for this purpose even when the source tree does
not change.

A revoked, released, expired, or superseded writer cannot mutate, commit, push,
or hand off. Stop immediately on any mismatch, preserve reachable unique work,
and report the last authoritative generation and token state. Never repair
ownership by rebinding an old generation or token.

## Completion Events

Automated background routing is admitted only when the dispatch/runtime owner
emits a durable completion or failure event tied to the worker identity and run
ID, task ID, writer generation, and a fresh `attempt_nonce` for that exact
attempt.

Before consuming the event, query authoritative current terminal state and
require the same worker, run, task, generation, attempt nonce, and terminal
outcome. Consume it once with an atomic replay marker. Reject stale, replayed,
duplicate, non-terminal, mismatched, or superseded-attempt events.

If the durable event contract is unavailable, classify the lane as
`controlled/manual`. Use only bounded dependency checks at decision points;
never repetitive polling or idle monitoring.

## Coordinator Loop and Task State

Interactive coordinators delegate implementation and do not write product
code. After dispatch, they immediately advance every safe, ready,
non-overlapping task. They do not idle-watch workers, duplicate active scope,
or repeatedly poll. When all remaining work is genuinely dependency-blocked,
yield for a useful durable signal.

`pending`, `in_progress`, `completed`, `failed`, and `cancelled` are the only
task statuses. Dependency blocking is derived state from the recorded graph,
not another task status. `recovery-required` is a classification or evidence
field, never a task status.

Keep the task in the supported status that reflects reality. A failed or
cancelled worker with unique changes records that terminal status plus the
recovery classification; it never reports false completion.

## Worker Lifecycle

1. Verify every dispatch field, deterministic binding input and result,
   identity-separation record, route receipt, repository identity, dependency,
   worktree, branch, frozen scope, repair count, completion-event nonce, owner,
   writer generation, and fencing token.
2. Pass the claim checkpoint and admit only the assigned generation. Mutate
   only the declared repository, worktree, branch, and file scope.
3. Pass the fenced checkpoint before each mutation. Keep durable owner, task,
   binding, repair, and head evidence current as state changes.
4. Run focused validation before commit and push. Stage only intended files,
   pass the pre-commit fenced checkpoint, run a non-printing staged secret
   scan, and remove any finding. Do not add `Co-Authored-By` trailers.
5. Commit only the assigned branch. Run a non-printing secret scan over the
   exact committed range, pass the pre-push fenced checkpoint, and push only
   that branch. Create or update the single PR for the deterministic binding
   and verify local, remote, and provider PR heads are equal.
6. Record exact validation, secret-scan, repair-cycle, identity, commit, PR,
   route, generation, and token evidence. Pass the handoff checkpoint before
   emitting the durable handoff event.

No exit code, worker narrative, branch existence, or PR URL proves completion
without authoritative state and exact-head evidence.

## Finite Repair Lifecycle

Elevated work receives at most two cumulative repair and re-review cycles for
one deterministic binding. The durable record starts at cycle 0, increments
once when a blocking exact-head review result is accepted for repair, and is
updated atomically before repair mutation begins.

Head changes invalidate all exact-head review and CI artifacts but never reset
or decrement the cumulative repair count. Provider changes, worker handoffs,
new generations, rebases, force-updates, and reopened PRs also preserve the
count. A cycle covers the repair plus all required re-review of its resulting
exact head.

Cycle 2 is terminal: no third repair or re-review cycle is permitted. On
exhaustion, residual-safe landing may proceed only when the frozen acceptance
contract passes and the remaining findings are explicitly documented as
non-blocking within that same contract. Otherwise simplify, revert, split into
a new bounded task and binding, close, or defer, without granting another cycle
to the exhausted binding.

The terminal disposition records the final head, acceptance result, remaining
findings, chosen action, and the identities that decided and executed it.

## Identity Separation

Record the execution identities in dispatch input, every review artifact, merge
evidence, and final output:

```text
worker_identity_and_run_id: <identity; unique run ID>
reviewer_identities_and_run_ids: <ordered identity/run entries; exact reviewed head per entry>
merge_operator_identity_and_run_id: <identity; unique run ID>
```

The worker, every reviewer, and the merge operator must be pairwise distinct in
both identity and run ID. Reviewer entries must also be mutually distinct.
Reject absent identities, duplicate run IDs, self-review presented as
independent review, or identity changes without new recorded artifacts.

Only the recorded merge operator may invoke merge. Workers and reviewers may
prepare evidence and handoff, but their credentials and runs cannot perform
the merge action.

## Review and Merge

Reviewers and CI validate the exact remote PR head. Each independent reviewer
records its distinct identity and run ID, the exact commit, findings, and
reconciliation. Required CI records provider check IDs and their terminal
conclusions for that same commit.

Any head change invalidates every prior exact-head review, approval, and CI
artifact. Re-run the required exact-head gates for the new head without
changing the cumulative repair count except when a blocking review enters a
permitted repair cycle.

After all gates pass, hand the verified PR and reviewed expected head to the
distinct merge operator. Merge must atomically compare the
provider-authoritative current head with the recorded reviewed head. Use a
provider expected-head compare-and-swap, a merge queue with equivalent
expected-head protection, or an immediately coupled final assertion supported
by the provider. Head drift or a missing expected-head guard prevents merge.

The merge operator revalidates its identity, the open PR, base, binding, repair
state, approvals, checks, and exact head immediately before invoking merge.

## Failure Preservation

When unique changes survive a failed, cancelled, revoked, or superseded worker,
preserve the worktree and branch. Record the last known owner, writer
generation, token state, reachable commits, working-tree state, PR binding,
failure cause, and `recovery-required` classification.

Transfer ownership only through route admission and a fresh generation and
token after prior stop and revocation proof. Never discard unique work, reuse a
stale writer, or mark the owning task complete from partial evidence.

## Cleanup Gate

Cleanup is eligible only when all of the following are proven:

- no active owner, writer, lease, token, or worker process remains;
- the worktree is clean or every unique remaining state is explicitly
  preserved;
- every required commit is reachable from the recorded durable remote ref;
- the PR, deterministic binding, exact head, repair count, task outcome,
  identities, and merge outcome are recorded against stable lineage IDs; and
- dependents consumed the result or no longer depend on the worktree.

If any condition is unknown, preserve the worktree and report
`cleanup_state: blocked` with the missing evidence. Cleanup authority is not
permission to delete uncertain or uniquely modified state.

## Evidence and Output Contract

Every completion, handoff, failure, cancellation, and recovery report includes:

```text
result: <complete|handoff|failed|cancelled>
task_status: <pending|in_progress|completed|failed|cancelled>
root_task_id: <stable ID>
runtime_root_or_plan_id: <stable ID|none>
plan_node_id: <stable ID|none>
task_id: <stable assigned ID>
pr_group_binding: <deterministic immutable ID and active|terminal state>
pr_group_binding_inputs: <root task; assigned task; canonical repo; base ref; frozen scope acceptance hash; canonicalization version>
worker_identity_and_run_id: <identity and run ID>
writer_generation_and_fencing_token: <fresh IDs; active|released|revoked|superseded; checkpoint receipts>
provider_profile_route: <pinned alias; immutable resolved identity; admission receipt; checkpoint results>
completion_event_and_attempt_nonce: <event ID/type; fresh nonce; authoritative terminal validation; replay-consumption state>
repair_cycle: <0|1|2; cumulative history; exhausted|available>
reviewer_identities_and_run_ids: <pairwise-distinct entries; exact heads; findings; reconciliation>
merge_operator_identity_and_run_id: <distinct identity/run; merge-only authority>
commit_and_exact_heads: <local; remote; provider PR head; equality proof>
pr: <number; URL; binding; base; open|closed|merged>
validation: <commands; exit states; exact head>
secret_scan: <staged and committed-range non-printing modes; pass|fail>
merge_guard: <reviewed expected head; provider-atomic mechanism; result>
cleanup_state: <not-ready|preserved|blocked|eligible|complete plus evidence>
blockers: <none or evidence-backed list>
```

Completion requires task and runtime records to agree on stable IDs and
outcome, all fenced checkpoints to pass, exact-head validation and secret scans
to pass, required independent reviews and CI to pass, and merge or prepared
handoff to be durably recorded. Do not infer completion from worker exit alone.

## Non-Goals and Exceptions

Research, diagnosis, planning, status checks, and one-step read-only work are
exempt from worktree, branch, runtime-plan, and PR creation unless source
mutation begins. They may use the existing owning Todos root.

This workflow does not create releases, deployments, package versions,
identities, public communications, or live skill distribution unless the
assignment explicitly includes them. It does not authorize merging by anyone
other than the recorded merge operator or cleanup before the cleanup gate.
