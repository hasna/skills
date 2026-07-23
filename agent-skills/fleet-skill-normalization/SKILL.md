---
name: fleet-skill-normalization
description: "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, identity, hash, validation, and rollback evidence."
user_invocable: true
---

# Fleet Skill Normalization

Normalize Codewith skill directories only from an immutable canonical source.
The workflow is bounded to the selected skills and machines, deterministic for
the same inputs, and reversible from recorded preimages.

## Scope and Roles

The interactive coordinator resolves scope, delegates all mutation to a fresh
native Codewith worker, and verifies the returned evidence. The coordinator
does not edit live skill files.

The worker may read the canonical repository or package source and authoritative
Machines data. It may mutate only exact admitted paths inside the resolved
Codewith skills tree:

```text
${CODEWITH_HOME:-$HOME/.codewith}/skills
```

Do not use tmux, sudo, service restarts, package installs, credentials, or
unrelated configuration mutation. Do not mutate auth profiles, sessions,
caches, logs, repositories, package state, or any path outside each target's
Codewith skills tree. Never print secret values.

## Input Contract

Use one immutable source record per selected skill:

```text
run_id: <stable idempotency key>
source_repository_or_package: <canonical identity>
source_package_version_and_integrity: <version and integrity|not-packaged>
source_commit: <exact immutable commit>
source_path: <tracked relative SKILL.md path>
source_hash: <sha256:lowercase-hex of the exact source bytes>
target_machine_ids: <explicit authoritative Machines IDs>
worker_provider_profile_alias: <fresh native Codewith worker route alias>
```

A repository-tracked or package-owned source is eligible only when its exact
commit, tracked path, and byte hash are all proven. A packaged source also
records its package version and integrity. Reject a moving branch, untracked
file, path/hash mismatch, or inferred source copy.

Use `sha256:<lowercase-hex>` for every source, rendered target, observed
preimage, backup, and final target hash. An unlabeled hash is invalid evidence.

## Machine Resolution

Resolve the target set through the current authoritative Machines CLI or SDK
after detecting its supported surface. Record authoritative Machines IDs and
aliases, then prove live connectivity for each exact ID. Deduplicate and compare
machines by stable ID, never by raw hostname strings or a hardcoded machine
list. Alias resemblance is not identity evidence.

Include the current machine when it is in scope. Before skipping a route because
the target appears local, prove that the runtime's exact current machine ID is
the resolved target ID. An unresolved ID, ambiguous alias, or failed
connectivity proof blocks that target without widening the set.

## Deterministic Adaptation

For each canonical source:

1. Verify the source commit, tracked path, and source hash from the immutable
   repository or package object.
2. Parse the tracked frontmatter under this repository's contract.
3. Render the Codewith copy with frontmatter containing exactly `name` and
   `description`, in that order. Encode both values as deterministic,
   JSON-compatible double-quoted YAML scalars. Emit LF-only delimiters, the
   ordered key lines, the closing delimiter plus LF, then the source body that
   begins immediately after the source frontmatter's closing-delimiter newline;
   normalize only its line endings to LF.
4. Compute the rendered target hash and run a non-printing secret scan over the
   source and rendered bytes. Any finding blocks that skill.

The rendered bytes and their hash are the canonical desired state. Do not add
machine-specific content or infer a winner from a live copy.

## Inventory and Reconciliation

For every connected machine ID, inventory the selected target paths and record
source and target hashes, frontmatter validity, and whether each skill is
missing, identical, or conflicting.

Route admission enumerates the exact selected target `SKILL.md` paths and the
explicitly named run-owned temporary and rollback receipt paths, including any
preimage file. The worker runtime write allowlist contains only those exact
paths; directory prefixes and wildcards are insufficient. Capture an
authoritative touched-path ledger for the run, and require that it must be a
subset of that exact allowlist. A touch to any unselected or remote-only path,
even inside a Codewith skills tree, fails closure: stop further writes, preserve
and report the unauthorized path, and guard rollback of only selected targets
with valid receipts. If either enforcement or authoritative audit is
unavailable, do not admit a mutating worker.

Preserve remote-only skills: never delete, move, or rewrite a target skill that
is outside the selected canonical input. For each selected skill:

- identical hash: leave it unchanged;
- missing target: classify it under `missing_skills`;
- different valid or invalid hash: classify it under `conflicting_skills`;
- changed preimage after inventory: fail closed and do not overwrite it.

Before replacing or creating a selected target, record `pre_state` as
`existing` or `absent`. For an existing target, capture its exact bytes/hash and
a rollback receipt inside the same Codewith skills tree. For an absent target,
record the absent pre-state and exact run-owned path.

Forward writes require a fail-closed compare-and-replace operation. An existing
target is replaced only when the same atomic operation asserts that its current
bytes/hash equal the inventoried preimage. A missing target uses an atomic
create-if-absent operation. An equivalent immediately coupled preimage/hash
guard is acceptable only when it makes concurrent drift impossible to
overwrite; a separate check followed by an unconditional rename is not
sufficient. If neither primitive is available, stop without writing. Use only
the named temporary path, verify its hash, perform the guarded operation, then
reparse frontmatter, rerun the non-printing secret scan, and verify the final
target hash.

On any write or verification failure, stop further writes and restore every
target already changed in this run. Before restoring an existing target, prove
the current target still has this run's exact target hash, then use guarded
compare-and-replace to restore its recorded in-tree preimage and verify the
preimage hash. If the current hash drifted, preserve it and report a rollback
conflict. For an absent pre-state, remove only the exact run-created target
after proving it still has this run's target hash, then verify the target is
absent. If either check fails, preserve the conflict and report rollback
failure. Never delete remote-only skills as cleanup.

## Output Contract

The fresh native Codewith worker returns:

```text
result: <complete|partial|failed>
worker_id: <native worker ID>
run_id: <idempotency key>
source_repository_or_package: <canonical identity per skill>
source_package_version_and_integrity: <version and integrity per packaged skill|not-packaged>
source_commit: <exact commit per skill>
source_path: <tracked path per skill>
source_hash: <verified sha256:lowercase-hex per skill>
machines: <exact machine IDs, authoritative aliases, current/local proof, connectivity>
changed_skills: <skill, machine ID, before hash, target hash>
missing_skills: <skill and machine ID>
conflicting_skills: <skill, machine ID, observed hash, reason>
target_hashes: <verified sha256:lowercase-hex per selected skill and machine ID>
validation: <frontmatter, scope, connectivity, and hash results>
secret_scan: <non-printing source/target result>
rollback_receipts: <machine ID, path, pre_state, preimage/backup hash, target hash>
rollback_state: <not-needed|available|restored|failed>
scope_proof: <exact-path allowlist and subset ledger proving no paths outside each Codewith skills tree changed>
blockers: <none or bounded evidence>
```

The coordinator accepts completion only when the reported source repository or
package, commit, path, source hash, and—when packaged—package version and
integrity match the immutable input; every in-scope machine is accounted for;
every changed target matches the deterministic hash; validation and secret
scans pass; rollback receipts are complete; and the touched-path ledger is a
subset of the exact-path allowlist with no unselected or remote-only change.

## Stop Conditions

Stop without mutation for ambiguous source provenance, unresolved machine
identity, missing live connectivity, a source or preimage hash mismatch,
secret-scan findings, concurrent target drift, unavailable in-tree rollback, or
any requested action outside this workflow's scope.
