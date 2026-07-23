---
name: fleet-skill-normalization
description: "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, canonical containment, guarded mutation, and rollback evidence."
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

## Canonical Path Admission

Resolve the Codewith skills root separately on every selected machine. The root
must be an absolute, normalized directory path whose canonical realpath is
proven before admission. Open that canonical root as a directory without
following symlinks and retain its directory handle as the containment anchor.

Derive each selected skill directory, target `SKILL.md`, run-owned temporary
file, preimage, and rollback receipt from the admitted root and a single
validated skill-name path segment. For every one of those paths:

1. Record both the absolute normalized lexical path and its canonical path.
   Canonicalize each existing directory through its retained no-follow handle.
   For every final file component, whether existing or absent, canonicalize the
   existing parent first and append only the validated basename; never invoke a
   symlink-following realpath operation on the final component.
2. Reject `..`, `.`, empty segments, repeated separators, alternate
   non-normalized aliases, absolute child inputs, and any lexical/canonical
   disagreement. A selected skill name must be one basename, never a path.
3. Walk every component from the retained root handle with no-follow semantics.
   Reject symlinked or magic-link components, cross-mount components, mount or
   path escapes, and any canonical path not strictly inside the exact canonical
   root and its exact selected skill directory.
4. Require an OS primitive such as `openat2` with
   `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV`,
   or a proven equivalent component-by-component directory-handle walk using
   `O_NOFOLLOW` plus mount identity checks. If canonical containment or
   no-follow operation cannot be proven, fail closed without mutation.
5. Existing targets must be single-link regular files. Reject directories,
   devices, sockets, FIFOs, hard-linked files, and every other special file.
   An absent target must be proven absent with a no-follow lookup.

Every explicitly named run-owned temporary, preimage, and receipt path must be
absent at admission and remain absent until its owning operation. Create each
one exactly once with exclusive create semantics (`O_CREAT|O_EXCL|O_NOFOLLOW`
or a stronger equivalent) beneath the retained directory handle: preparation
creates the temporary, guarded forward replacement creates and returns the
preimage, and guarded rollback creates its receipt. Do not pre-create a
preimage or receipt. A pre-existing, raced, symlinked, or previously used
run-owned path rejects the run; never reuse, truncate, or overwrite it.

## Inventory and Exact-Path Allowlist

For every connected machine ID, inventory the selected canonical target paths
and record source and target hashes, frontmatter validity, file type/link count,
and whether each skill is missing, identical, or conflicting.

Route admission enumerates each exact selected target `SKILL.md` and each
explicitly named run-owned temporary, preimage, and rollback receipt. The
allowlist records both the normalized lexical path and canonical path for every
entry. Directory-prefix, recursive, glob, or wildcard admission is forbidden.

Capture an authoritative touched-path ledger from the mutation boundary. Each
ledger entry records the actual canonical path reached through its retained
directory handle, not a caller-supplied string. Before another write and at
closure, prove the set of actual canonical touched paths is a subset of the
exact canonical allowlist and that each lexical/canonical pair still agrees. A
touch to any unselected or remote-only path fails closure: stop further writes,
preserve and report the unauthorized path, and guard rollback of only selected
targets with valid receipts. If exact-path enforcement or authoritative touched
path auditing is unavailable, do not admit a mutating worker.

Preserve remote-only skills: never delete, move, or rewrite a target skill that
is outside the selected canonical input. For each selected skill:

- identical hash: leave it unchanged;
- missing target: classify it under `missing_skills`;
- different valid or invalid hash: classify it under `conflicting_skills`;
- changed inode, bytes, metadata, or hash after inventory: fail closed and do
  not overwrite it.

Before replacing or creating a selected target, record `pre_state` as
`existing` or `absent`. For an existing target, capture its exact inventoried
bytes, inode identity, metadata, and hash. The guarded replacement must
atomically return the exact displaced preimage into the admitted exclusive
preimage path; verify that returned preimage against the inventory before
accepting the write. For an absent target, record the absent pre-state.

## Guarded Forward Mutation

Use only the admitted exclusive temporary path, write the deterministic bytes
through its retained no-follow handle, fsync as required by the runtime, and
verify its target hash before installation.

An existing target may be replaced only by one fail-closed atomic
compare-and-replace primitive that:

1. binds the expected existing inode/metadata and
   `sha256:<inventoried-preimage-hash>`;
2. installs the verified temporary bytes at the exact target; and
3. atomically returns the displaced target at the exact admitted preimage path.

Reject the operation unless the returned preimage exactly matches the
inventoried bytes, inode identity, metadata, and hash. A separate
compare-then-rename sequence, an unconditional rename, or a primitive that
cannot prove and return the exact displaced preimage is forbidden.

A missing target uses one atomic create-if-absent primitive bound to the exact
admitted canonical path. It must fail if any object appeared after inventory.
After either operation, reparse frontmatter, rerun the non-printing secret scan,
verify the final target hash through a no-follow handle, and append the actual
canonical target to the authoritative touched-path ledger.

## Guarded Rollback

On any write or verification failure, stop further forward writes and consider
only targets already changed by this run.

Before restoring an existing target, compare the current no-follow target
against this run's exact installed inode/metadata and target hash. Only an
exact match may use an atomic compare-and-replace that restores the admitted
preimage and preserves the displaced failed target in a distinct admitted
receipt path. Verify the restored bytes and preimage hash. If the current target
drifted, preserve it and report a rollback conflict.

For an absent pre-state, remove only the exact run-created regular single-link
target after atomically comparing its current inode/metadata and hash to this
run's installed target. Verify the target is absent with a no-follow lookup. If
either comparison fails, preserve the conflict and report rollback failure.
Never use recursive deletion, an unconditional restore/remove, or cleanup of a
remote-only skill.

## Output Contract

The fresh native Codewith worker returns complete evidence:

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
selected_target_inventory: <machine ID, lexical/canonical target, inode/metadata, link/type, before hash>
changed_skills: <skill, machine ID, before hash, target hash>
missing_skills: <skill and machine ID>
conflicting_skills: <skill, machine ID, observed hash, reason>
target_hashes: <verified sha256:lowercase-hex per selected skill and machine ID>
validation: <frontmatter, canonical containment, no-follow, file-type, connectivity, and hash results>
secret_scan: <non-printing source/target result>
rollback_receipts: <machine ID, lexical/canonical paths, pre_state, preimage hash, target hash>
rollback_state: <not-needed|available|restored|failed>
exact_path_allowlist: <lexical/canonical pair for every admitted target/temp/preimage/receipt>
touched_path_ledger: <actual canonical paths and subset proof against exact_path_allowlist>
guarded_operations: <exclusive-create, compare-and-replace/create-if-absent, returned-preimage evidence>
scope_proof: <no path outside an exact selected Codewith skill directory changed>
blockers: <none or bounded evidence>
```

The coordinator accepts completion only when the reported source repository or
package, commit, path, source hash, and—when packaged—package version and
integrity match the immutable input; every in-scope machine is accounted for;
every changed target matches the deterministic hash; canonical containment,
no-follow and file-type validation, non-printing secret scans, guarded forward
operation, and rollback receipts are complete; and the authoritative actual
canonical touched-path set is a subset of the exact canonical allowlist with no
unselected, remote-only, or out-of-tree mutation.

## Stop Conditions

Stop without mutation for ambiguous source provenance, unresolved machine
identity, missing live connectivity, a source or preimage mismatch,
secret-scan findings, traversal or non-normalized path input, symlink/hard-link
or special-file presence, canonical or mount escape, unavailable no-follow
containment, a pre-existing run-owned path, concurrent target drift,
unavailable atomic guarded replacement/create/rollback, incomplete exact-path
audit, unavailable in-tree rollback, or any requested action outside this
workflow's scope.
