# Merge safety contract

## Read-only preflight

Capture a fresh JSON snapshot with:

- mode, repository, PR, URL, base, head, and exact head SHA;
- explicit risk tier and frozen acceptance scope;
- cumulative repair-cycle count and cap;
- checks, reviews, draft/conflict/merge state, and branch/queue policy;
- exactly the tier-required independent reviewer artifacts;
- worker and executor identities;
- blocking reasons, warnings, verdict, and observation time.

Preflight may use read-only `gh pr view`, `gh pr checks`, and repository-rule
queries. It must not mutate local git or GitHub. `mergeable` is advisory until
the executor repeats the checks immediately before merge.

## Bounded review

- Routine: one exact-head artifact and at most one cumulative repair/re-review
  cycle.
- Elevated: two independent exact-head artifacts and at most two cumulative
  cycles.
- Worker and executor cannot review. Reviewer identities and run IDs must be
  distinct.
- Every artifact must match repository, PR, exact head, and frozen scope. A
  stale, future, malformed, blocking, duplicate, worker-authored,
  executor-authored, or scope-mismatched artifact blocks.
- A head change invalidates artifacts but never resets the repair-cycle count.
- At the cap, land only if frozen acceptance passes; otherwise simplify, split,
  close, or defer. Do not add another review layer.

## Command construction

Use the guard's argv output. For squash it always supplies `--subject`,
`--body`, and `--match-head-commit`. The guard rejects a
`Co-Authored-By` trailer rather than deleting it. It has no interface for
`--admin`, force, direct pushes, or branch deletion. Auto mode additionally
requires the explicit `--delayed-intent` acknowledgement. The executor must
pass the Todo ID, task-owned frozen scope, and cumulative repair-cycle count
separately; all must match the fresh snapshot. This guard permits squash and
policy-owned queues only. It rejects merge and rebase strategies because their
multi-commit results require a wider provenance check.

## Provider postverify

After provider mutation:

1. Recompute the preflight digest and match the saved command plan.
2. Re-read the PR and require `MERGED`.
3. Match the provider-reported source head to the reviewed head.
4. Resolve the provider merge-commit SHA.
5. Fetch that commit's actual message.
6. Scan it for forbidden trailers.
7. Bind the receipt to the task, mode, scope, cycle count, preflight digest,
   provider URL, base, source head, and merge commit.
8. Persist the receipt before interpreting success.

A forbidden trailer or provider mismatch produces a durable failed receipt and
nonzero exit. Do not claim a clean merge, rewrite protected main, revert, force
push, or delete the branch. Postverify is evidence-only and cannot reopen the
review budget.

`clean` is scoped to the forbidden-trailer policy; it is not a byte-for-byte
message assertion. `--fixture` exists only for inert tests. Fixture receipts
name their source, set `authoritative: false`, bind their target to the supplied
repository and PR, and cannot satisfy live postverify.

## Recovery and workflow rollback

On failed postverify, preserve the failed receipt, mark the owning Todo blocked,
and report the provider mismatch through the normal incident or blocker
surface. Do not retry the same mutation or automate a protected-history revert.
Correct product behavior, if needed, through a new reviewed PR that preserves
history. Before further merges, roll back a faulty workflow version through an
ordinary PR that reverts the skill change, then repeat the full exact-head
review and release gates.
