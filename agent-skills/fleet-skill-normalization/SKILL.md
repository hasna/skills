---
name: fleet-skill-normalization
description: "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, canonical containment, guarded mutation, and rollback evidence."
user_invocable: true
---

# Fleet Skill Normalization

Normalize Codewith skill directories only from immutable canonical source
bytes. The workflow is bounded to selected skills and authoritative machine
IDs, deterministically rendered, and reversible from guarded preimages.

## Scope and Roles

The interactive coordinator resolves scope, delegates all repository and live
skill mutation to one fresh native Codewith worker, and reviews the returned
evidence. The coordinator must not perform the worker's repository mutation or
edit live skill files.

The worker may read the canonical repository or package source and
authoritative Machines data. It may mutate only exact admitted paths inside
each resolved Codewith skills root:

```text
${CODEWITH_HOME:-$HOME/.codewith}/skills
```

Do not use tmux, sudo, service restarts, package installs, credentials, or
unrelated configuration mutation. Do not mutate auth profiles, sessions,
caches, logs, repositories other than the explicitly assigned repository
worktree, package state, or any path outside each target's Codewith skills
tree. Never print secret values.

## Safety Contract

The following block is normative and machine-checkable. Every `require` entry
is mandatory and every `deny` entry is fail-closed. The prose in this document
defines the same invariants in operational detail; neither surface weakens the
other.

```yaml
version: skills-fleet-normalization-semantic-v2
invariants:
  - id: SFN-SOURCE-PROVENANCE-v1
    require:
      - immutable_source_commit
      - tracked_source_path
      - exact_source_bytes_sha256
    deny:
      - moving_or_inferred_source
      - best_effort_provenance
  - id: SFN-DETERMINISTIC-RENDERING-v1
    require:
      - codewith_json_yaml_scalar_v1
      - byte_exact_frontmatter
      - deterministic_body_line_endings
    deny:
      - machine_specific_rendering
      - best_effort_byte_rendering
  - id: SFN-ROOT-CONTAINMENT-v1
    require:
      - exact_lexical_and_canonical_root
      - no_follow_component_walk
      - retained_root_identity
    deny:
      - traversal_or_symlink_components
      - displaced_root_use
  - id: SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1
    require:
      - indivisible_root_directory_child_binding
      - operation_bound_touched_ledger_and_receipt
      - repeated_existing_directory_identity
      - repeated_run_created_directory_identity
    deny:
      - check_then_mutate
      - displaced_directory_redirection
  - id: SFN-CHILD-IDENTITY-v1
    require:
      - exact_child_entry_type_link_inode_hash
      - single_link_regular_files
      - operation_bound_revalidation
    deny:
      - special_or_hard_link_targets
      - advisory_child_revalidation
  - id: SFN-RUN-PATH-EXCLUSIVITY-v1
    require:
      - absent_until_owner_operation
      - exclusive_create_no_follow
      - single_use_temp_preimage_receipt
    deny:
      - preexisting_run_path_reuse
      - overwrite_or_truncate_run_path
  - id: SFN-TOUCHED-LEDGER-v1
    require:
      - exact_lexical_and_canonical_allowlist
      - authoritative_actual_canonical_touches
      - touched_subset_proof
    deny:
      - prefix_glob_or_wildcard_admission
      - out_of_allowlist_touch
  - id: SFN-ROLLBACK-v1
    require:
      - atomic_compare_before_rollback
      - exact_run_owned_state
      - rollback_receipt
    deny:
      - unconditional_restore_or_remove
      - changed_or_nonowned_state_removal
  - id: SFN-SECRET-SCAN-v1
    require:
      - non_printing_source_rendered_target_scan
      - finding_blocks_mutation
      - filename_or_count_only_evidence
    deny:
      - printed_secret_match
      - skipped_secret_scan
  - id: SFN-COORDINATOR-SEPARATION-v1
    require:
      - coordinator_scopes_and_delegates
      - worker_performs_mutation
      - coordinator_verifies_evidence
    deny:
      - coordinator_repository_mutation
      - coordinator_live_skill_mutation
```

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

A repository-tracked or package-owned source is eligible only when the exact
immutable source commit, tracked source path, exact source bytes, and
`sha256:<lowercase-hex>` source hash are proven together. A packaged source
also records package version and integrity. Reject a moving branch, untracked
file, inferred copy, or best-effort commit, path, byte, hash, version, or
integrity provenance.

Use a labeled `sha256:<lowercase-hex>` for source, rendered target, observed
preimage, backup, installed target, and restored target hashes. An unlabeled
hash is invalid evidence.

## Machine Resolution

Resolve the target set through the current authoritative Machines CLI or SDK
after detecting its supported surface. Record authoritative Machines IDs and
aliases, then prove live connectivity for every exact ID. Deduplicate and
compare machines by stable ID, never raw hostname resemblance or a hardcoded
machine list.

Include the current machine when it is in scope. Before treating a route as
local, prove that the runtime's exact current machine ID equals the resolved
target ID. An unresolved ID, ambiguous alias, or failed connectivity proof
blocks that target without widening the set.

Resolve the configured skills root independently on every admitted machine. A
route, alias, environment default, or copied path from another machine is not
authoritative root evidence.

## Deterministic Rendering

For each canonical source:

1. Read the exact tracked bytes from the immutable source commit and verify the
   tracked path and source hash.
2. Parse the tracked frontmatter under this repository's contract.
3. Render `name` and `description` with the
   `codewith-json-yaml-scalar-v1` encoder. Treat each value as Unicode scalar
   values; reject unpaired surrogates and perform no Unicode normalization.
   Emit ASCII double quotes; escape `"` as `\"` and `\` as `\\`; use exactly
   `\b`, `\t`, `\n`, `\f`, and `\r` for U+0008, U+0009, U+000A, U+000C, and
   U+000D; use lowercase `\u00xx` for every other U+0000-U+001F control; emit
   `/` literally; and emit every other scalar, including U+2028 and U+2029, as
   its shortest well-formed UTF-8 bytes. Emit no BOM.
4. Emit exactly these ASCII prefixes, encoded scalar bytes, and LF bytes:

   ```text
   ---\n
   name: <codewith-json-yaml-scalar-v1(name)>\n
   description: <codewith-json-yaml-scalar-v1(description)>\n
   ---\n
   ```

   Each displayed `\n` denotes one byte `0x0a`; angle-bracket terms denote the
   encoder output and are not emitted. Append the source body beginning
   immediately after the tracked frontmatter closing-delimiter newline.
   Normalize only CRLF or CR body line endings to LF. No other byte may change.
5. Compute the one deterministic rendered target hash and run the mandatory
   non-printing secret scan over source and rendered bytes. A finding blocks
   the skill before mutation.

The same immutable source bytes must produce exactly one rendered byte sequence
and hash. Machine-specific fields, timestamps, aliases, and best-effort
rendering are forbidden.

## Canonical Path Admission

Expand the configured skills root to one absolute lexical path without
dereferencing it and require the input spelling to equal its normalized
lexical spelling byte for byte. From the filesystem root, open every lexical
component using no-follow directory-handle operations. Reject `.`, `..`, empty
segments, repeated separators, non-normalized aliases, symlinks, magic links,
non-directories, mount crossings, and canonical escapes.

Open and retain the final root using no-follow semantics, derive its canonical
path from that retained handle, and require exact lexical/canonical root
agreement. Record the root entry, parent anchor, canonical path, device, inode,
mount ID, directory type, metadata, and link count.

Derive a selected skill directory from one validated basename, never a path.
For an existing selected directory, open and retain it without following links
and record its lexical entry, parent root handle, canonical path, device,
inode, mount ID, directory type, metadata, and link count. For an absent
selected directory, prove absence through the retained root handle and record
the exact canonical candidate as canonical root plus the one basename. Never
use symlink-following `realpath` on an absent or final component.

Every child operation, including read, write, hash, exclusive create, exchange,
install, restore, removal, and receipt creation, must be one indivisible
fail-closed guarded operation. For every child mutation, the same primitive or
transaction must atomically bind all of these preconditions to the mutation:

1. the exact normalized lexical root entry, resolved with no-follow semantics
   from its retained parent anchor, still names the retained root handle and
   the exact admitted canonical path, device, inode, mount ID, directory type,
   metadata, and link-count ledger state;
2. the exact selected-directory lexical entry, resolved without following
   links through the retained root handle, still names the retained
   selected-directory handle and the exact admitted canonical path, device,
   inode, mount ID, directory type, metadata, and link-count ledger state; and
3. the exact allowlisted child lexical/canonical entry and its latest expected
   identity, device, inode, mount ID, metadata, regular-file type, link count
   one, and hash, or its admitted absence, is the object operated on.

Within that same indivisible transaction, admit the actual canonical child
touch to the authoritative touched ledger, perform the mutation, and
exclusively create its run-owned operation receipt. The receipt must bind the
preconditions, mutation result, pre-state and post-state identity and hash, and
the exact ledger entry. A transaction that cannot atomically commit the ledger
admission, mutation, and receipt must fail before mutation.

Admission and execution are one indivisible transaction. A nearby pre-check,
re-stat, or closure check followed by later mutation through any retained or
displaced handle is insufficient and forbidden. If the platform lacks one
equivalent primitive or transaction that provides the complete binding, fail
before mutation.

Apply the repeated root and selected-directory lexical-entry/retained-handle
identity proof before every child operation and at closure for both
pre-existing and run-created selected directories. A rename, replacement,
mount, link, path displacement, or metadata drift after admission must fail
before any read, write, removal, rollback, or receipt operation and must never
redirect the operation through a displaced handle.

Walk existing child components through retained handles with no-follow
semantics. Require `openat2` with
`RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV`,
or a proven equivalent directory-handle walk using `O_NOFOLLOW` and exact
mount identity checks. If containment or the operation-bound no-follow proof
is unavailable, fail without mutation.

Existing targets and run-owned files must be regular files with link count one.
Reject symlinks, directories, devices, sockets, FIFOs, special files, and
hard-linked files. Retain a no-follow handle for every existing or created
child and bind exact entry, type, device, inode, mount ID, metadata, link count,
and hash checks immediately after creation, before and after each use, and at
closure. Child identity, link, type, and hash revalidation is mandatory and
operation-bound, never optional or advisory.

Every explicitly named run-owned temporary, preimage, and receipt path must be
absent at admission and remain absent until its owning operation. Create each
path exactly once beneath the retained selected-directory handle with
`O_CREAT|O_EXCL|O_NOFOLLOW` or a stronger exclusive primitive. A pre-existing,
raced, symlinked, or previously used run-owned path rejects the run. Never
reuse, truncate, overwrite, or pre-create a temporary, preimage, or receipt.

## Exact Allowlist and Touched Ledger

For every connected machine ID, inventory exact selected directories and
targets. Record source and target hashes, frontmatter validity, lexical and
canonical paths, retained identities, type and link count, and whether each
target is missing, identical, or conflicting.

Enumerate both normalized lexical and exact canonical paths for every admitted
selected-directory creation/removal, target `SKILL.md`, run-owned temporary,
preimage, and receipt. Directory-prefix, recursive, glob, and wildcard
admission are forbidden. A directory entry authorizes only the one guarded
directory operation named by the entry.

Capture an authoritative touched-path ledger at the mutation boundary. Each
entry is the actual canonical path reached through the retained handles, not a
caller-supplied string. Before every further write and at closure, prove the
actual canonical touched set is a subset of the exact canonical allowlist and
that every lexical/canonical pair still agrees. Paths outside the exact
allowlist must never be touched. If authoritative exact-path enforcement or
ledger evidence is unavailable, do not admit mutation.

Preserve remote-only and unselected skills. An identical target remains
unchanged. A missing target is admitted only as absent. A differing target is
conflicting and may be replaced only by the exact guarded operation below.
Any inode, metadata, type, link, or hash drift after inventory blocks mutation.

Record directory and target pre-state independently as `existing` or `absent`.
For an existing target, capture exact inventoried bytes, identity, metadata,
and hash. A guarded replacement must atomically return the displaced object at
the exact exclusive preimage path and that preimage must equal the inventory.

## Guarded Forward Mutation

Write deterministic bytes only to the admitted exclusive temporary through its
retained no-follow handle inside the complete atomic root/directory/child
binding. Fsync as required and verify the expected rendered hash before
installation.

If the selected directory was absent, one guarded no-follow atomic
create-directory-if-absent transaction must bind the exact root lexical entry
and retained root identity, prove the selected-directory entry absent, create
only that exact directory, and return the retained directory handle plus exact
canonical path, device, inode, mount ID, metadata, directory type, and link
count. Add its actual canonical path to the touched ledger and admit no child
operation until this returned identity is installed in the repeated atomic
binding.

Replace an existing target only with one fail-closed atomic
compare-and-replace inside the complete operation binding. It must bind the
exact inventoried target identity, metadata, type, link count, and hash;
install the verified temporary; and atomically return the displaced target at
the exclusive preimage path. Reject unless the returned preimage exactly
matches inventory. Separate compare-then-rename and unconditional rename are
forbidden.

Create a missing target only with one atomic create-if-absent inside the same
complete binding. It must fail if either lexical entry was displaced or any
object appeared after inventory.

After installation, reparse frontmatter, rerun the non-printing secret scan,
verify exact target hash and single-link regular-file identity, and append the
actual canonical target to the touched ledger. Revalidate every retained root,
selected directory, child, and run-owned entry using the indivisible operation
rules before any subsequent operation and at closure.

## Guarded Rollback

On failure, stop forward writes and consider only exact state installed by this
run. Rollback must never remove, replace, or restore changed, drifted,
unselected, or non-owned state.

Restore an existing target only with one atomic compare-and-replace inside the
complete root/directory/child binding. Compare the current no-follow target
against this run's exact installed identity, device, inode, mount ID, metadata,
regular-file type, link count one, and target hash. Restore the admitted
preimage only on an exact match and atomically preserve the displaced failed
target in a distinct exclusive rollback receipt. Verify restored bytes and
hash. Drift preserves the target and reports a rollback conflict.

For an absent target pre-state, use one atomic compare-and-remove inside the
same binding. Bind the exact run-installed identity, metadata, single-link
regular type, and hash to removal of that exact path. A compare-then-unlink or
unconditional remove is forbidden. Drift or unavailable atomic support
preserves state and reports a rollback conflict.

If the selected directory also had an absent pre-state, consider it only after
safe target rollback. Require it to be empty and exactly equal the run-created
retained directory identity. Use one atomic compare-and-remove-empty-directory
operation that binds the root and selected-directory lexical entries and
retained identities to the exact removal. Never recursively delete.

Every attempted rollback creates an exclusive rollback receipt describing the
comparison, result, final identity/hash or conflict, and touched-ledger entry.
The receipt path is subject to the same atomic binding, child identity, and
run-path exclusivity invariants.

## Secret Scanning and Closure

Run non-printing secret scans over immutable source bytes, deterministic
rendered bytes, every observed preimage, every installed target, and the exact
staged and committed repository ranges. Scans may emit only status, counts, or
filenames; they must not print matched secret material. Secret scanning must
never be skipped. Any finding blocks the next mutation, commit, or handoff.

At closure, repeat the complete atomic lexical-entry and retained-handle proofs
for the root, every pre-existing or run-created selected directory, and every
child. Prove the touched ledger is an exact allowlist subset, target hashes are
deterministic, rollback receipts are complete, and no out-of-scope path was
mutated.

## Output Contract

The fresh native Codewith worker returns:

```text
result: <complete|partial|failed>
worker_id: <native worker ID>
run_id: <idempotency key>
source_repository_or_package: <canonical identity per skill>
source_package_version_and_integrity: <version and integrity|not-packaged>
source_commit: <exact immutable commit per skill>
source_path: <tracked path per skill>
source_hash: <verified sha256:lowercase-hex per skill>
machines: <exact authoritative machine IDs, aliases, locality, connectivity>
root_admission: <lexical/canonical root and retained identity evidence>
selected_target_inventory: <directory/child paths, identities, types, links, hashes>
changed_skills: <skill, machine ID, before hash, target hash>
missing_skills: <skill and machine ID>
conflicting_skills: <skill, machine ID, observed hash, reason>
target_hashes: <verified sha256:lowercase-hex per target>
validation: <rendering, containment, identity, connectivity, hash results>
secret_scan: <non-printing source/rendered/preimage/target result>
rollback_receipts: <exact run-owned receipts and state comparisons>
rollback_state: <not-needed|available|restored|conflict>
exact_path_allowlist: <every admitted lexical/canonical pair>
touched_path_ledger: <actual canonical paths and subset proof>
guarded_operations: <atomic binding and compare/create/remove evidence>
scope_proof: <no mutation outside exact selected paths>
blockers: <none or bounded evidence>
```

The coordinator accepts completion only when every invariant in the structured
safety contract and prose is proven, every in-scope machine is accounted for,
source and rendered bytes have exact provenance, all touched paths are an exact
allowlist subset, rollback evidence is complete, and non-printing secret scans
pass. The coordinator verifies evidence but performs no worker mutation.

## Stop Conditions

Fail closed before mutation for ambiguous or best-effort source provenance,
non-deterministic rendering, unresolved machine or root identity, traversal,
non-normalized input, symlink or mount escape, special or hard-linked files,
pre-existing run-owned paths, out-of-allowlist admission, unavailable
authoritative touched-ledger proof, displaced root or selected directory,
check-then-mutate sequencing, unavailable indivisible operation binding,
concurrent child drift, unavailable atomic forward or rollback primitive,
secret-scan findings, incomplete rollback receipts, coordinator/worker role
collapse, or any action outside this workflow.
