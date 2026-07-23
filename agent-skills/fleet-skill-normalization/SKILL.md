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
3. Render the Codewith copy with the canonical
   `codewith-json-yaml-scalar-v1` encoder. Treat each parsed `name` and
   `description` as a sequence of Unicode scalar values; reject an unpaired
   surrogate and do not apply Unicode normalization. The encoder emits an
   opening and closing ASCII double quote, escapes `"` as `\"` and `\` as
   `\\`, uses exactly `\b`, `\t`, `\n`, `\f`, and `\r` for U+0008, U+0009,
   U+000A, U+000C, and U+000D, uses lowercase `\u00xx` for every other
   U+0000–U+001F control, emits solidus `/` literally and never as `\/`, and
   emits every other scalar—including U+2028 and U+2029—literally as its
   shortest well-formed UTF-8 byte sequence. It emits no BOM.
4. Emit the frontmatter as exactly these ASCII prefixes, encoded scalar bytes,
   and LF bytes:

   ```text
   ---\n
   name: <codewith-json-yaml-scalar-v1(name)>\n
   description: <codewith-json-yaml-scalar-v1(description)>\n
   ---\n
   ```

   In this formula, every `\n` denotes exactly one byte `0x0a`, never the two
   bytes backslash and `n`; angle-bracket terms denote the encoder's exact
   bytes and are not emitted. Append the source body that begins immediately
   after the tracked
   frontmatter's closing-delimiter newline, normalizing only CRLF or CR line
   endings to LF. No other byte may change. The same immutable source bytes
   therefore produce one and only one rendered byte sequence and target hash.
5. Compute the rendered target hash and run a non-printing secret scan over the
   source and rendered bytes. Any finding blocks that skill.

The rendered bytes and their hash are the canonical desired state. Do not add
machine-specific content or infer a winner from a live copy.

## Canonical Path Admission

Resolve the Codewith skills root separately on every selected machine. Expand
the configured root to one absolute lexical path without dereferencing it, then
require its input spelling to equal its normalized lexical spelling byte for
byte. Starting from the filesystem root, open every lexical component with
no-follow directory-handle operations. Reject the root if any component is a
symlink, magic link, non-directory, cross-mount escape, or otherwise
non-canonical.

Open the final lexical root anchor first with no-follow semantics, then derive
its canonical path from that retained handle. Record the root's lexical path,
canonical path, device, inode, mount ID, type, and link count. Admission
requires exact lexical/canonical path agreement.

Every child operation—read, write, hash, exclusive create, exchange, install,
restore, removal, or receipt creation—uses one fail-closed guarded operation.
For a child mutation, admission and execution are one indivisible atomic
transaction. In that same primitive or transaction, before altering state, it
must bind all of these facts together:

1. the exact normalized lexical root entry, resolved with no-follow semantics
   from its retained parent anchor, still names the retained no-follow root
   handle and its admitted canonical path, device, inode, mount ID, and
   directory type;
2. the exact normalized selected-directory lexical entry beneath that root
   still names the retained no-follow selected-directory handle and its admitted
   canonical path, device, inode, mount ID, and directory type; and
3. the exact allowlisted child lexical/canonical entry and its latest expected
   file identity, metadata, type, link count, and hash or admitted absence are
   the object on which the operation executes.

The transaction must resolve both lexical entries from their no-follow parent
anchors and validate both retained handles inside the same guarded operation
that performs the child mutation. A pre-check or re-stat followed by mutation
through a retained or displaced handle is forbidden. If the platform cannot
provide one primitive or transaction with this complete root-and-directory
binding, fail closed before mutation. Detecting displacement at closure is
insufficient and does not authorize a mutation.

As additional closure evidence, re-stat the root handle and lexical root with
no-follow semantics and require its path, inode, device, mount, and directory
type to remain fixed. Metadata and link count must equal the latest
expected-state ledger snapshot; only a guarded creation or removal of an exact
allowlisted selected directory may atomically return and advance that snapshot.
Reject every other drift. Resolving a lexical symlink and then opening its
canonical destination is forbidden.

Derive each selected skill directory, target `SKILL.md`, run-owned temporary
file, preimage, and rollback receipt from the admitted root and a single
validated skill-name path segment. A selected skill directory may be existing
or absent. For every one of those paths:

1. Record both the absolute normalized lexical path and its canonical path.
   Canonicalize each existing directory through its retained no-follow handle.
   If the selected directory exists, append each validated final file basename
   to that canonical directory. If it is absent, canonicalize the existing root
   first, append the one validated directory basename to form its canonical
   candidate, then append each validated final file basename to form the exact
   child candidate. Never invoke a symlink-following realpath operation on an
   absent or final component. After guarded directory creation, resolve every
   child candidate through the retained directory handle and require exact
   agreement with its admitted lexical/canonical pair before creating it.
2. Reject `..`, `.`, empty segments, repeated separators, alternate
   non-normalized aliases, absolute child inputs, and any lexical/canonical
   disagreement. A selected skill name must be one basename, never a path.
3. Walk every existing component from the retained root handle with no-follow semantics.
   Reject symlinked or magic-link components, cross-mount components, mount or
   path escapes, and any canonical path not strictly inside the exact canonical
   root and its exact selected skill directory.
4. Require an OS primitive such as `openat2` with
   `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV`,
   or a proven equivalent component-by-component directory-handle walk using
   `O_NOFOLLOW` plus mount identity checks. If canonical containment or
   no-follow operation cannot be proven, fail closed without mutation.
5. An existing selected skill directory must be a directory whose retained
   handle, device, inode, mount ID, metadata, type, and link count are recorded.
   For an absent directory, record an exact canonical candidate as the
   canonical root plus the validated basename and prove absence through the
   retained root handle.
6. Existing targets must be single-link regular files. Reject directories,
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
When the selected directory is absent, its proven absence proves every admitted
child candidate absent at inventory; after directory creation, re-prove each
child absent through the retained handle immediately before its exclusive
create.

Retain a no-follow handle and initial device, inode, mount ID, metadata, file
type, and link count for every created temporary, returned preimage, rollback
receipt, and installed target. Immediately after creation, before and after
each read, write, hash, exchange, install, restore, or removal use, and at
closure, the complete atomic root-and-directory operation binding above must
also prove that the file handle and exact lexical/canonical path still identify
that same regular file with link count one. A before/after path check alone is
insufficient. The primitive must bind the single-link/type check to the
operation so a same-filesystem hard-link race cannot alias a write outside the
allowlist. Metadata and content must match the latest expected-state ledger
snapshot; an allowlisted guarded write may atomically return and advance that
snapshot. If that binding is unavailable or any identity, type, link, metadata,
or content invariant drifts, stop without another mutation and preserve the
object.

Apply the complete repeated lexical-entry and retained-handle identity proof to
every selected skill directory, whether pre-existing or run-created. Before
every child operation and at closure, the same guarded operation must prove that
the exact selected-directory lexical entry names its retained handle and fixed
canonical path, inode, device, mount ID, and directory type; its metadata and
link count must equal the latest expected-state ledger snapshot. Only a guarded
creation or removal of an exact allowlisted child may atomically return and
advance that snapshot. A rename, replacement, or mount substitution after
admission must fail before any child read, write, removal, rollback, or receipt
operation and must never redirect that operation through the displaced handle.

## Inventory and Exact-Path Allowlist

For every connected machine ID, inventory the selected canonical target paths
and record source and target hashes, frontmatter validity, file type/link count,
and whether each skill is missing, identical, or conflicting.

Route admission enumerates each exact selected skill directory creation, target
`SKILL.md`, and explicitly named run-owned temporary, preimage, and rollback
receipt. The allowlist records both the normalized lexical path and canonical
path for every entry. A directory entry authorizes only guarded creation or
guarded rollback removal of that one selected directory; it never authorizes
prefix writes. Directory-prefix, recursive, glob, or wildcard admission is
forbidden.

Capture an authoritative touched-path ledger from the mutation boundary. Each
ledger entry records the actual canonical path reached through its retained
directory handle, not a caller-supplied string. Record a directory touch when
the run creates or removes the exact selected skill directory. Before another
write and at closure, prove the set of actual canonical touched paths is a
subset of the exact canonical allowlist and that each lexical/canonical pair
still agrees. A
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

Before replacing or creating a selected target, record the directory
`pre_state` and target `pre_state` independently as `existing` or `absent`. For
an existing target, capture its exact inventoried bytes, inode identity,
metadata, and hash. The guarded replacement must atomically return the exact
displaced preimage into the admitted exclusive preimage path; verify that
returned preimage against the inventory before accepting the write. For an
absent target or directory, record the absent pre-state.

## Guarded Forward Mutation

Use only the admitted exclusive temporary path, write the deterministic bytes
through its retained no-follow handle inside the complete atomic
root-and-directory operation binding, fsync as required by the runtime, and
verify its target hash before installation.

When the selected skill directory is absent, first use one guarded no-follow
atomic create-directory-if-absent transaction. In one indivisible operation it
must apply the root lexical-entry/retained-handle binding, prove the exact
admitted selected-directory lexical/canonical entry absent, create only that
directory, and return its retained no-follow handle plus exact canonical path,
device, inode, mount ID, metadata, directory type, and link count. It must fail
if the root was displaced or any object appeared after inventory. Append its
actual canonical path to the touched-path ledger and admit no child operation
until the returned identity is installed in the complete atomic binding above.
Never create or alter an unselected or remote-only directory.

An existing target may be replaced only by one fail-closed atomic
compare-and-replace primitive inside the complete root-and-directory operation
binding that:

1. binds the expected existing inode/metadata and
   `sha256:<inventoried-preimage-hash>`;
2. installs the verified temporary bytes at the exact target; and
3. atomically returns the displaced target at the exact admitted preimage path.

Reject the operation unless the returned preimage exactly matches the
inventoried bytes, inode identity, metadata, and hash. A separate
compare-then-rename sequence, an unconditional rename, or a primitive that
cannot prove and return the exact displaced preimage is forbidden.

A missing target uses one atomic create-if-absent primitive inside the complete
root-and-directory operation binding and bound to the exact admitted canonical
path. It must fail if either lexical entry was displaced or any object appeared
after inventory.
After either operation, reparse frontmatter, rerun the non-printing secret scan,
verify the final target hash plus regular single-link identity through the
retained no-follow handle, and append the actual canonical target to the
authoritative touched-path ledger. Recheck every run-owned path and every
pre-existing or run-created selected directory under the complete repeated
identity rules before closure.

## Guarded Rollback

On any write or verification failure, stop further forward writes and consider
only targets already changed by this run.

Restore an existing target only with one atomic compare-and-replace inside the
complete root-and-directory operation binding. Its indivisible admission must
compare the current no-follow target against this run's exact installed
inode/metadata and target hash, restore the admitted preimage only on an exact
match, and preserve the displaced failed target in a distinct admitted receipt
path. Verify the restored bytes and preimage hash. If either lexical entry or
the current target drifted, preserve it and report a rollback conflict.

For an absent target pre-state, use one fail-closed atomic compare-and-remove
operation inside the complete root-and-directory operation binding. That single
primitive must bind the exact run-installed device, inode, mount ID, metadata,
regular-file type, link count one, and target hash to removal of that exact
path. A compare-then-unlink sequence is forbidden. If the primitive is
unavailable or either lexical entry or the object drifted, preserve it and
report a rollback conflict. After success, verify absence with a no-follow
lookup.

If the selected skill directory also had an absent pre-state, consider it only
after the selected target was safely removed. It must be empty and must still
match the run-created directory's retained handle, device, inode, mount ID,
metadata, directory type, and recorded link count. Use one guarded atomic
compare-and-remove-empty-directory transaction that binds the exact root lexical
entry and retained root identity plus the selected-directory lexical entry and
retained directory identity to removal of that exact empty directory. Append
the actual canonical directory path to the touched ledger, then verify absence.
If it is unavailable, non-empty, displaced, or drifted, preserve the directory
and report a rollback conflict. Never use recursive deletion, an unconditional
restore/remove, or cleanup of an unrelated or remote-only directory.

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
root_admission: <machine ID, lexical/canonical root agreement, retained device/inode/mount/type/link proof>
selected_target_inventory: <machine ID, lexical/canonical directory and target, inode/metadata/mount/link/type, before hash>
changed_skills: <skill, machine ID, before hash, target hash>
missing_skills: <skill and machine ID>
conflicting_skills: <skill, machine ID, observed hash, reason>
target_hashes: <verified sha256:lowercase-hex per selected skill and machine ID>
validation: <frontmatter, canonical containment, no-follow, file-type, connectivity, and hash results>
secret_scan: <non-printing source/target result>
rollback_receipts: <machine ID, lexical/canonical directory/file paths, directory/target pre_state, preimage hash, target hash>
rollback_state: <not-needed|available|restored|failed>
exact_path_allowlist: <lexical/canonical pair for every admitted directory/target/temp/preimage/receipt>
touched_path_ledger: <actual canonical paths and subset proof against exact_path_allowlist>
guarded_operations: <atomic root-and-selected-directory lexical-entry/retained-handle bindings, exclusive-create, create-directory-if-absent, compare-and-replace/create-if-absent, atomic compare-and-remove, returned-preimage evidence>
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
audit, unavailable indivisible root-and-selected-directory operation binding,
unavailable in-tree rollback, or any requested action outside this workflow's
scope.
