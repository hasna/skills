---
name: merge-pr
description: Merge a GitHub pull request, merge when green, use a merge queue, or decide whether a pull request is mergeable. Use only for explicit merge intent, not ordinary review.
---

# Merge PR

Keep merge authority tied to fresh exact-head evidence. Read
[merge-safety.md](references/merge-safety.md) before an actual merge.

## Modes

- `preflight`: read-only advice; never fetch, checkout, push, comment, label,
  approve, close, enqueue, or merge.
- `immediate-merge`: merge now after every gate passes.
- `auto-merge`: use only when the user explicitly requested delayed merge.
- `merge-queue`: follow the repository queue; it is not a merge strategy.

## Required contract

For an actual merge:

1. Reuse the owning native goal/plan and exact Todo. Freeze one nonblank
   `acceptance_scope`; record the cumulative repair-cycle count.
2. Declare `routine` or `elevated`. Unknown is elevated and cannot authorize a
   merge. Routine requires one independent exact-head artifact and permits one
   repair cycle; elevated requires two and permits two. A head change
   invalidates artifacts without resetting the cap.
3. Keep worker, reviewers, and executor distinct. Every artifact must name the
   repository, PR, exact head SHA, frozen scope, reviewer identity or run ID,
   timestamp, verdict, checked risks, and blocking findings.
4. Immediately before execution, re-read the PR, exact head, checks, reviews,
   draft/conflict state, base/protection policy, and queue behavior. Do not use
   stale preflight as merge authority.
5. Generate the command with
   `scripts/merge_pr_guard.py build --preflight <fresh.json> ...`. Never hand
   compose a squash command.
6. Execute the returned argv exactly once. It always includes
   `--match-head-commit`; it never includes admin, force, direct-main push, or
   branch deletion. Use auto mode only with explicit delayed intent.
7. Run `scripts/merge_pr_guard.py postverify` against the provider result and
   save its required receipt. Do not report clean until it exits zero.

## Squash message rule

Every squash command must carry an explicit one-line subject and explicit body.
An omitted body becomes the empty string. Custom bodies retain their text after
line-ending normalization. Subject or body input containing a
`Co-Authored-By` trailer, with any case or whitespace variation, fails before
merge; never strip and continue.

```bash
python3 agent-skills/merge-pr/scripts/merge_pr_guard.py build \
  --preflight /path/to/fresh-preflight.json \
  --strategy squash \
  --subject "fix: preserve merge provenance" \
  --body ""
```

## Postverify

Postverify must query the actual provider merge commit, not source commits or a
locally predicted message. It writes a durable `clean` or `failed` receipt,
including message digest and forbidden-trailer line numbers without echoing the
message. A synthesized trailer is a failed result.

Never rewrite protected-main history, revert, force push, or delete the branch
in response. Record the failure and escalate through the owning task.
