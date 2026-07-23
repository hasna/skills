---
name: task-to-pr-lifecycle
description: "Use when an interactive coordinator routes repository-mutating work from one owning task through dispatch, a task-owned worktree and branch, validation, review, one pull request, merge handoff, and safe cleanup."
user_invocable: true
---

# Task-to-PR Lifecycle

Use this workflow for repository-mutating work routed by an interactive
coordinator. A coherent single-repository source change ends in one PR. Omit
the PR only when the assignment is explicitly non-mutating and produces no
source change.

## Invariants

- Exactly one Todos root owns the outcome. For materially multi-step work at the
  owning layer, create or reuse exactly one runtime-native root/goal plan and
  link it to the Todos root with stable IDs.
- Workers inherit the root, plan, node, and task IDs. They do not create
  competing roots, plans, or duplicate tasks unless orchestration ownership is
  explicitly part of the assignment.
- Use one task-owned worktree under `$HOME/.hasna/repos/worktrees`, one branch,
  one active writer within one active lease generation, and one PR group for
  each coherent single-repository change. Never mutate a shared checkout.
- A writer generation and its fencing token are non-reusable ownership
  boundaries. Do not overlap writers or reuse a stale worker after ownership
  advances.
- Existing user authorization covers ordinary in-scope execution. Escalate only
  a genuinely new destructive, secret-bearing, public, spend, ownership, or
  user-only decision.

When instructions conflict, follow the applicable authority order and the more
specific in-scope instruction; never downgrade an active safety control.
Preserve the single-owner and sole-writer invariants, and record an unresolved
conflict as a blocker.

## Dispatch Input Contract

Do not dispatch until the coordinator provides or resolves:

```text
root_task_id: <stable Todos root ID>
runtime_root_or_plan_id: <stable runtime-native root/goal-plan ID or none>
plan_node_id: <stable ID or none>
task_id: <stable assigned task ID>
scope_and_acceptance: <bounded mutation and done criteria>
repo_and_base: <repository identity, remote, and base branch>
worktree_and_branch: <task-owned absolute path and one non-protected branch>
writer_generation: <fresh non-reusable fencing token/generation ID and owner>
pr_group: <one coherent single-repository change identifier>
dependencies: <stable IDs and current readiness>
pinned_provider_profile_alias: <admitted provider/profile alias, never an email or credential>
resolved_provider_profile_route: <immutable resolved route identity and admission receipt>
admitted_capabilities: <checkout, subprocess, network, Git metadata, push, PR>
completion_event: <durable event contract with worker/task/generation/attempt_nonce>
validation_and_cleanup_owner: <required gates and responsible role>
```

Reject ambiguous ownership, overlapping write scope, stale writer generations,
shared-checkout paths, or missing stable IDs before implementation begins.

## Route Admission

Prove the route before dispatch. It must be subscription-backed and headless,
with the task's checkout, subprocess, network, Git metadata, push, and PR
capabilities admitted and tested sufficiently for the assignment.

Pin the admitted provider/profile alias in the worker input. Resolve it during
admission and bind it in authoritative evidence to an immutable resolved route
identity and admission receipt for the task and writer generation. Silent
provider or profile substitution is prohibited. At each lifecycle
checkpoint—claim, before mutation, before commit, before push,
and handoff—re-resolve the alias with the same authority, validate the original
receipt, and require the same immutable identity. The worker must reject alias
remapping or a stale/invalid receipt and stop.

Every ownership transfer issues a fresh, non-reusable fencing token and
writer generation; neither may be rebound or reused. Record the prior and next
owners in authoritative evidence. Before successor admission, prove the prior
worker is stopped and the prior lease is revoked or released. Only then rerun
route admission for the successor. Missing revocation evidence blocks transfer.

Infinity is eligible only when that exact capability set is admitted. A direct,
durable Codewith route is the controlled fallback when another route cannot
prove it. Never use tmux prompt paste. Identify routes with provider and profile
aliases only; never expose account emails, tokens, or credentials.

Automated background routing is admitted only when the dispatch/runtime owner
emits a durable completion/failure event tied to the worker ID, task ID, and
writer generation, plus a fresh `attempt_nonce` minted for that dispatch
attempt. Validate the event against the authoritative current terminal state
and require the same worker, task, generation, attempt nonce, and terminal
outcome before consuming it once. Reject stale, replayed, duplicate,
non-terminal, or superseded-attempt events. If that event contract is
unavailable, classify the lane as `controlled/manual` and use only bounded
dependency checks; never repetitive polling.

Detect supported surfaces before invoking the owning Todos, worktree, dispatch,
secret-scan, PR, review, or merge skill/CLI. Do not copy commands from a stale
surface or weaken a gate because a preferred adapter is absent.

## Coordinator Loop

Interactive coordinators delegate implementation and do not write product
code. After dispatch, immediately advance every safe, ready, non-overlapping
task. Do not idle-watch workers or repeatedly poll them.

Consume the admitted durable event to check a worker. For a controlled/manual
lane, check only when a dependency needs its result or for a bounded
intervention prompted by evidence. If all remaining work is genuinely
dependency-blocked, yield and wait for a useful signal; do not duplicate active
work or manufacture busywork.

## Task State

`pending`, `in_progress`, `completed`, `failed`, and `cancelled` are the only
task statuses. Dependency blocking is derived state from the recorded
dependency graph, not a task status. `recovery-required` is a classification,
comment, or evidence field, never a task status.

Keep a dependency-blocked task in the supported status that reflects its actual
lifecycle. A failed or cancelled worker that has unique changes records the
accurate `failed` or `cancelled` status plus the recovery classification,
preserves its worktree and branch, and never falsely completes the task.

## Worker Lifecycle

1. Verify the input contract, route admission and receipt, repository identity,
   clean task worktree, branch, dependency readiness, pinned alias and resolved
   route identity, completion-event attempt nonce, and current writer
   generation/fencing token.
2. Claim only the assigned writer generation and mutate only the declared
   worktree, branch, repository, and scope.
3. Keep owner evidence current as work changes state. Preserve stable IDs across
   provider handoffs and retries.
4. Run targeted validation before commit and push. Stage only intended files,
   run a non-printing staged secret scan, and remove any finding. Do not add
   `Co-Authored-By` trailers.
5. Commit only the assigned branch, run a non-printing secret scan over the
   exact committed range, then push and create or update the one PR group.
   Verify the remote head matches the expected commit.
6. Before merge, obtain independent adversarial review of the exact remote PR
   head, required CI/checks, and expected-head/state verification. Reconcile all
   blocking findings. Any head change invalidates the prior review and check
   evidence and requires exact-head re-verification.
7. Hand the verified PR to the repository's merge operator. Only that operator
   performs the merge, and the operation must fail closed atomically on the
   reviewed expected head. Use a provider-authoritative expected-head
   compare-and-swap, a merge queue with equivalent expected-head protection, or
   an immediately coupled final assertion supported by the provider. Head drift
   invalidates every review/check artifact and prevents merge until the new
   exact head is reviewed and verified. If no such guard is available, do not
   merge.

When unique changes survive a failed or cancelled worker, preserve its worktree
and branch, record the last known writer generation and reachable commits, and
transfer ownership only through the explicit admission flow. Never discard
unique work or mark the task complete.

## Cleanup Gate

Cleanup is safe only when all of these are proven:

- no active owner, writer, lease, or process remains;
- the worktree is clean or its remaining state is explicitly preserved;
- every required commit is reachable from the recorded durable remote ref;
- the PR and task outcome are recorded against the stable root/task IDs; and
- dependent tasks have consumed the result or no longer depend on the worktree.

If any condition is unknown, preserve the worktree and report
`cleanup_state: blocked` with the missing evidence.

## Evidence and Output Contract

Every completion, handoff, failure, and recovery report includes:

```text
result: <complete|handoff|failed|cancelled>
task_status: <pending|in_progress|completed|failed|cancelled>
dependency_state: <ready|derived dependency evidence>
recovery_classification: <none|recovery-required>
root_task_id: <ID>
runtime_root_or_plan_id: <ID|none>
plan_node_id: <ID|none>
task_id: <ID>
repo: <identity and remote>
worktree: <absolute task-owned path>
branch: <name>
writer_generation: <fresh non-reusable generation ID, fencing token, owner, active|released|superseded>
pinned_provider_profile_alias: <alias; re-resolution checkpoint results>
resolved_provider_profile_route: <immutable identity; admission receipt; task/generation binding>
completion_event: <event ID/type, worker/task/generation/attempt_nonce, authoritative terminal validation, or controlled/manual evidence>
validation: <commands or gates and outcomes>
secret_scan: <staged and committed-range modes; pass|fail>
commit_and_head: <local commit and exact remote head>
pr: <number/URL, group, base, state>
review: <reviewer, exact reviewed head, findings, reconciliation>
merge_guard: <expected head and atomic provider mechanism>
blockers: <none or evidence-backed list>
cleanup_state: <not-ready|preserved|eligible|complete with evidence>
```

Completion requires the owner records and runtime-native plan, when present, to
agree on IDs and outcome; targeted validation and secret scans to pass; the
remote PR head to be independently reviewed; required checks to pass; and the
merge or prepared handoff to be recorded. Do not infer completion from a worker
exit code alone.

## Non-Goals and Exceptions

- Research, diagnosis, planning, status checks, and one-step read-only work do
  not create worktrees, branches, plans, or PRs unless source mutation begins.
- A small read-only task may use the existing owning Todos root without a
  runtime-native plan.
- This workflow does not create releases, deployments, package versions,
  identities, or public communications unless the assignment explicitly
  includes them.
- Cleanup is lifecycle work, not permission to delete uncertain or uniquely
  modified state.
