---
name: fleet-skill-normalization
description: "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, canonical containment, finite transactions, and rollback evidence."
user_invocable: true
---

# Fleet Skill Normalization

This workflow distributes immutable repository-tracked skill bytes to explicitly selected Codewith destinations. It does not publish packages, mutate source repositories, or widen machine or skill scope.

## Contract Interpretation

The structured contract and every live tagged clause are jointly normative. HTML comments and fenced examples other than the structured contract are non-operative. Unknown, duplicate, missing, or altered live behavioral content fails closed.

## Safety Contract

```yaml
version: skills-fleet-normalization-semantic-v2
normative_language:
  version: sfn-normative-lines-v1
  operative_scope: all_uncommented_markdown_outside_structured_contract
  html_comments: stripped_as_non_operative
  tagged_clause_format: "[invariant-id/effect/key]"
  registered_clause_policy: exact_single_live_bijection
  unknown_tagged_clause: deny
  unknown_untagged_behavioral_content: deny
  safe_near_miss_policy: exact_registered_examples_only
identity:
  version: sfn-skill-identity-v1
  source_identity_field: frontmatter_name
  normalized_identity_pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
  normalization: input_must_already_equal_normalized_identity
  destination_basename: normalized_identity
  destination_collision_key: "machine_id|skills_root_identity|destination_basename"
  selected_set_admission: reject_duplicate_source_identities_and_expanded_destination_collisions_before_apply
state_root:
  version: sfn-run-state-root-v1
  authority: configured_codewith_transaction_state_store
  run_path: "fleet-skill-normalization/<run_id>"
  relation_to_live_skills: neither_ancestor_nor_descendant
  relation_to_source_repository: outside_source_repository_and_worktree
  create: exclusive_absent_no_follow
  persistence_base_case: state_artifact_persistence_is_not_a_destination_child_mutation
  receipt_persistence_requires_receipt: false
  lifecycle_authority: operational_evidence_only_todos_remains_canonical
  retention: retain_hash_chain_receipts_failures_and_preimages_until_plan_retention_expiry
  cleanup: terminal_state_and_exported_terminal_hash_required_before_state_store_garbage_collection
artifact_encoding:
  version: sfn-canonical-artifact-json-v1
  bytes: rfc8785_canonical_json_utf8_without_bom
  digest: "sha256:<lowercase-hex>"
  plan_digest_rule: hash_complete_plan_artifact_then_bind_digest_only_in_downstream_artifacts
  receipt_digest_rule: hash_complete_receipt_artifact_then_bind_digest_only_in_the_next_receipt
  unknown_fields: deny
artifacts:
  - name: plan
    version: sfn-plan-v1
    required_fields:
      - schema_version
      - contract_version
      - run_id
      - plan_id
      - coordinator_id
      - worker_id
      - worker_route_alias
      - source_records_hash
      - selected_machine_ids
      - selected_skill_identities
      - destination_collision_keys
      - skills_root_records_hash
      - exact_allowlist_hash
      - state_root_identity
      - retention_policy_hash
  - name: source_record
    version: sfn-source-record-v1
    required_fields:
      - schema_version
      - contract_version
      - run_id
      - plan_id
      - source_record_id
      - source_repository_identity
      - source_commit
      - tracked_source_path
      - source_bytes_sha256
      - parsed_frontmatter_name
      - normalized_skill_identity
      - destination_basename
      - package_version_and_integrity
  - name: destination_record
    version: sfn-destination-record-v1
    required_fields:
      - schema_version
      - run_id
      - plan_id
      - plan_artifact_sha256
      - worker_id
      - machine_id
      - source_record_hash
      - skills_root_lexical_path
      - skills_root_canonical_path
      - skills_root_identity
      - selected_directory_lexical_entry
      - selected_directory_canonical_path
      - selected_directory_identity
      - selected_directory_prestate
      - child_lexical_entry
      - child_canonical_path
      - child_identity
      - child_prestate_sha256
      - rendered_target_sha256
  - name: apply_receipt
    version: sfn-apply-receipt-v1
    required_fields:
      - schema_version
      - run_id
      - plan_id
      - plan_artifact_sha256
      - worker_id
      - receipt_sequence
      - previous_receipt_sha256
      - operation_id
      - machine_id
      - destination_record_hash
      - source_record_hash
      - prestate_identity_hash
      - poststate_identity_hash
      - touched_ledger_entry_hash
      - run_state_from
      - run_state_to
  - name: rollback_receipt
    version: sfn-rollback-receipt-v1
    required_fields:
      - schema_version
      - run_id
      - plan_id
      - plan_artifact_sha256
      - worker_id
      - receipt_sequence
      - previous_receipt_sha256
      - operation_id
      - machine_id
      - destination_record_hash
      - installed_state_comparison
      - rollback_result
      - final_identity_hash
      - touched_ledger_entry_hash
      - target_state_from
      - target_state_to
  - name: failure_evidence
    version: sfn-failure-evidence-v1
    required_fields:
      - schema_version
      - run_id
      - plan_id
      - plan_artifact_sha256
      - worker_id
      - current_run_state
      - machine_target_states_hash
      - unresolved_machine_ids
      - immutable_reason_codes
      - last_receipt_sha256
      - recovery_requirement
  - name: terminal_receipt
    version: sfn-terminal-receipt-v1
    required_fields:
      - schema_version
      - run_id
      - plan_id
      - plan_artifact_sha256
      - worker_id
      - result
      - terminal_run_state
      - receipt_chain_sha256
      - machine_target_states_hash
      - exact_allowlist_hash
      - touched_ledger_hash
      - source_render_target_hashes
      - non_printing_secret_scan_summary
      - rollback_summary
      - retention_until
      - cleanup_eligibility
run_state_machine:
  version: sfn-run-state-machine-v1
  initial_state: planned
  terminal_states:
    - terminal_succeeded
    - terminal_rolled_back
    - terminal_blocked
  transitions:
    planned:
      - applying
      - terminal_blocked
    applying:
      - verifying
      - apply_interrupted
      - mixed_outcome
      - rollback_pending
      - terminal_blocked
    verifying:
      - terminal_succeeded
      - apply_interrupted
      - mixed_outcome
      - rollback_pending
    apply_interrupted:
      - recovery_pending
    mixed_outcome:
      - recovery_pending
      - rollback_pending
    recovery_pending:
      - rollback_pending
      - terminal_blocked
    rollback_pending:
      - rolling_back
    rolling_back:
      - terminal_rolled_back
      - recovery_pending
      - terminal_blocked
    terminal_succeeded: []
    terminal_rolled_back: []
    terminal_blocked: []
  aggregation:
    terminal_succeeded: every_selected_target_verified
    no_mutation_failure: terminal_blocked_with_failure_evidence
    any_mutation_plus_failure: mixed_outcome_then_reconcile_then_rollback
    interruption_after_mutation: apply_interrupted_then_recovery_pending
    unreachable_machine_after_mutation: mixed_outcome_then_recovery_pending
    recovery_pending: nonterminal_until_every_unknown_target_is_reconciled
    forward_mutation_during_mixed_recovery_or_rollback: forbidden
    terminal_rolled_back: every_run_mutated_target_rolled_back_and_all_machine_states_reconciled
    terminal_blocked_after_mutation: only_after_all_machine_states_reconciled_and_every_rollback_conflict_recorded
target_state_machine:
  version: sfn-target-state-machine-v1
  initial_state: planned
  transitions:
    planned:
      - applying
    applying:
      - applied
      - unchanged_failed
      - unreachable_unknown
    applied:
      - verifying
      - rollback_pending
    verifying:
      - verified
      - rollback_pending
      - unreachable_unknown
    verified:
      - rollback_pending
    unchanged_failed: []
    unreachable_unknown:
      - recovery_pending
    recovery_pending:
      - applied
      - verified
      - rollback_pending
      - rollback_conflict
    rollback_pending:
      - rolling_back
    rolling_back:
      - rolled_back
      - rollback_conflict
      - unreachable_unknown
    rolled_back: []
    rollback_conflict: []
recovery:
  version: sfn-recovery-v1
  replay_identity:
    - run_id
    - plan_id
    - plan_artifact_sha256
    - state_root_identity
    - contiguous_receipt_hash_chain
  stale_run_policy: exact_identity_mismatch_fails_closed
  machine_partition_policy: remain_recovery_pending_without_new_forward_mutation
  reconciliation: revalidate_live_destination_against_last_receipted_identity_before_transition
  mixed_outcome_policy: reconcile_every_selected_machine_then_rollback_every_run_mutation
  duplicate_replay_policy: idempotent_receipt_sequence_and_operation_id
workflow:
  version: sfn-workflow-v1
  steps:
    - id: plan
      text: Resolve exact source records, authoritative machine IDs, per-machine skills roots, external run state, retention, and the complete destination allowlist.
    - id: collide
      text: Reject duplicate identities in the selected source-record set and reject duplicate collision keys or paths in the expanded machine-destination set before any apply transition.
    - id: admit
      text: Persist the versioned plan and destination records, prove all roots and children, and enter applying only after the exclusive run state and receipt chain exist.
    - id: apply
      text: Execute each destination change through the indivisible guarded transaction and append its apply receipt to the external state journal.
    - id: verify
      text: Revalidate every destination and secret-scan result, aggregate all machine target states, and emit terminal success only when every selected target is verified.
    - id: recover
      text: On interruption, partition, or mixed outcome stop forward mutation, replay only the exact run journal, reconcile every target, and drive the finite rollback path.
    - id: close
      text: Emit one versioned terminal receipt, export its hash as Todos evidence, retain operational evidence through the planned interval, and permit only policy-owned state-store garbage collection.
invariants:
  - id: SFN-SOURCE-PROVENANCE-v1
    require:
      - immutable_source_commit
      - tracked_source_path
      - exact_source_bytes_sha256
      - read_only_source_repository
    deny:
      - moving_or_inferred_source
      - best_effort_provenance
      - source_repository_or_worktree_mutation
    clauses:
      - key: exact_provenance
        effect: require
        text: The worker binds each source record to one immutable commit, one tracked relative path, the byte-exact source, and its labeled sha256 digest before planning.
      - key: source_repository_read_only
        effect: require
        text: The distribution worker may read the repository-tracked source but never mutates the source repository or any source worktree; no assigned-worktree exemption exists.
      - key: moving_source
        effect: deny
        text: A branch tip, inferred copy, untracked file, mutable package, or best-effort commit, path, byte, hash, version, or integrity value rejects the run before destination mutation.
  - id: SFN-DETERMINISTIC-RENDERING-v1
    require:
      - codewith_json_yaml_scalar_v1
      - byte_exact_frontmatter
      - deterministic_body_line_endings
      - one_rendered_hash
    deny:
      - machine_specific_rendering
      - best_effort_byte_rendering
    clauses:
      - key: scalar_encoder
        effect: require
        text: The codewith-json-yaml-scalar-v1 encoder rejects unpaired surrogates, performs no Unicode normalization, emits ASCII double-quoted YAML scalars, escapes quote and backslash, uses \b, \t, \n, \f, and \r for their exact controls, uses lowercase \u00xx for every other U+0000 through U+001F control, emits slash literally, and emits every other scalar including U+2028 and U+2029 as shortest well-formed UTF-8 without a BOM.
      - key: frontmatter_bytes
        effect: require
        text: Rendering emits exactly delimiter LF, name colon space encoded-name LF, description colon space encoded-description LF, delimiter LF, then the tracked body after its closing-delimiter newline.
      - key: body_bytes
        effect: require
        text: Rendering changes only CRLF or CR body line endings to LF and changes no other body byte.
      - key: deterministic_hash
        effect: require
        text: The same immutable source bytes produce exactly one rendered byte sequence and labeled sha256 digest on every machine.
      - key: rendering_weakening
        effect: deny
        text: Machine-specific fields, timestamps, implementation-selected bytes, and best-effort byte rendering are forbidden.
  - id: SFN-DESTINATION-UNIQUENESS-v1
    require:
      - canonical_skill_identity
      - destination_basename_from_identity
      - entire_selected_set_collision_check
    deny:
      - duplicate_normalized_identity
      - duplicate_destination_path
      - first_wins_collision_handling
    clauses:
      - key: identity_format
        effect: require
        text: A parsed frontmatter name is admitted only when it already equals the ASCII lowercase-hyphen normalized identity and the destination basename equals that identity byte for byte.
      - key: selected_set_uniqueness
        effect: require
        text: Before any apply transition, the worker rejects duplicate source identity, normalized identity, or destination basename in the selected source-record set and rejects duplicate machine-root collision key, lexical path, or canonical path in the expanded destination set.
      - key: collision_resolution
        effect: deny
        text: First-wins, last-wins, overwrite, merge, alias, and deferred per-machine collision resolution are forbidden.
  - id: SFN-ROOT-CONTAINMENT-v1
    require:
      - exact_lexical_and_canonical_root
      - no_follow_component_walk
      - retained_root_identity
    deny:
      - traversal_or_symlink_components
      - displaced_root_use
    clauses:
      - key: root_resolution
        effect: require
        text: Each authoritative machine independently resolves its configured Codewith skills root to one byte-normal lexical path and one equal canonical path through a no-follow component walk.
      - key: root_identity
        effect: require
        text: The worker retains the root handle and binds its parent anchor, lexical entry, canonical path, device, inode, mount ID, directory type, metadata, and link count at admission, every operation, and closure.
      - key: root_escape
        effect: deny
        text: Dot segments, repeated separators, traversal, symlink or magic-link components, mount crossings, canonical escape, root replacement, and displaced-root use reject the operation before any read or mutation.
  - id: SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1
    require:
      - indivisible_root_directory_child_binding
      - exact_selected_directory_identity
      - operation_bound_touched_ledger_and_receipt
      - repeated_existing_directory_identity
      - repeated_run_created_directory_identity
    deny:
      - check_then_mutate
      - displaced_directory_redirection
    clauses:
      - key: indivisible_destination_transaction
        effect: require
        text: Every destination child mutation is one indivisible fail-closed transaction that binds the live root lexical entry and retained identity, the live selected-directory lexical entry and retained identity, the exact child precondition, touched-ledger admission, mutation, and external journal receipt append.
      - key: directory_identity
        effect: require
        text: The complete root and selected-directory proof repeats before every child operation and at closure for both pre-existing and run-created selected directories.
      - key: selected_directory_identity
        effect: require
        text: The selected-directory proof binds its lexical entry through the retained root, retained no-follow handle, canonical path, device, inode, mount ID, directory type, metadata, and link count, or binds exact absence until one guarded creation returns that complete identity.
      - key: no_redirect
        effect: deny
        text: Rename, replacement, mount, link, metadata drift, or path displacement after admission never redirects a read, write, removal, rollback, or receipt-bound operation.
      - key: no_precheck_gap
        effect: deny
        text: A nearby pre-check followed by later mutation, including mutation through a retained but displaced handle, is insufficient and forbidden.
      - key: primitive_availability
        effect: require
        text: If no platform primitive or transaction provides the complete atomic binding, the worker fails before mutation.
  - id: SFN-CHILD-IDENTITY-v1
    require:
      - exact_child_entry_type_link_inode_hash
      - single_link_regular_files
      - operation_bound_revalidation
    deny:
      - special_or_hard_link_targets
      - advisory_child_revalidation
    clauses:
      - key: child_identity
        effect: require
        text: Each child operation binds the exact lexical and canonical entry, type, device, inode, mount ID, metadata, link count, and labeled sha256 precondition or admitted absence to the operation result.
      - key: child_type
        effect: require
        text: Every existing or created file target is a retained no-follow regular-file handle with link count one.
      - key: invalid_child
        effect: deny
        text: Symlinks, directories, devices, sockets, FIFOs, special files, hard-linked files, and optional or advisory identity, link, type, or hash revalidation reject the operation.
      - key: child_revalidation
        effect: require
        text: Child identity, link, type, and hash are revalidated inside the guarded operation immediately after creation, before and after each use, and at closure.
  - id: SFN-RUN-PATH-EXCLUSIVITY-v1
    require:
      - external_authoritative_state_root
      - absent_until_owner_operation
      - exclusive_create_no_follow
      - single_link_regular_state_files
      - explicit_retention_and_cleanup
    deny:
      - state_under_live_skill_directories
      - preexisting_run_path_reuse
      - overwrite_or_truncate_run_path
    clauses:
      - key: external_state
        effect: require
        text: Temporary bytes, preimages, receipts, failures, and recovery state exist only beneath the exclusive configured Codewith transaction state root, which is outside every live skills directory and outside the source repository or worktree.
      - key: exclusive_state_paths
        effect: require
        text: Every run-owned state path is absent until its owning state-store operation and is created exactly once with no-follow exclusive-create semantics.
      - key: state_file_identity
        effect: require
        text: Every state artifact is a retained no-follow regular-file handle with link count one and exact entry, device, inode, mount ID, metadata, and labeled sha256 checks before and after each use.
      - key: state_path_reuse
        effect: deny
        text: A pre-existing, raced, symlinked, previously used, overwritten, truncated, or reused run state path rejects the run.
      - key: retention_cleanup
        effect: require
        text: The plan fixes retention before apply; immutable hash-chain receipts, failures, and preimages remain until expiry, and garbage collection is eligible only after a verified terminal receipt hash is exported to canonical Todos evidence.
      - key: live_shadow_store
        effect: deny
        text: Live skill directories never contain normalization temporaries, preimages, receipts, journals, recovery files, tombstones, or cleanup metadata.
  - id: SFN-TOUCHED-LEDGER-v1
    require:
      - exact_lexical_and_canonical_allowlist
      - authoritative_actual_canonical_touches
      - touched_subset_proof
    deny:
      - prefix_glob_or_wildcard_admission
      - out_of_allowlist_touch
    clauses:
      - key: exact_allowlist
        effect: require
        text: The immutable plan enumerates every exact lexical and canonical destination entry and every exact external run-state entry; directory prefixes, recursive admission, globs, and wildcards authorize nothing.
      - key: actual_touch
        effect: require
        text: The guarded transaction records the actual canonical entry reached through retained handles, not a caller-supplied path string, in the authoritative append-only touched ledger.
      - key: subset_proof
        effect: require
        text: Before every further mutation and at closure, the actual touched set must be an exact subset of the planned lexical and canonical allowlist with every pair still equal.
      - key: outside_touch
        effect: deny
        text: Any read, write, create, removal, restoration, or receipt-state touch outside the exact allowlist fails closed.
  - id: SFN-RECEIPT-FINITENESS-v1
    require:
      - destination_mutation_receipt
      - external_append_only_hash_chain
      - finite_persistence_base_case
    deny:
      - recursive_receipt_requirement
      - unbound_or_overwritable_receipt
    clauses:
      - key: mutation_receipt
        effect: require
        text: Every destination mutation and rollback atomically appends one versioned operation receipt that binds run ID, plan ID, plan artifact digest, worker, machine, source, destination, prestate, poststate, touch, transition, sequence, and previous-receipt digest.
      - key: finite_base_case
        effect: require
        text: Receipt persistence is an external state-store journal operation rather than a destination child mutation, and it does not require another receipt.
      - key: receipt_chain
        effect: require
        text: The exclusive append-only receipt sequence and previous-hash chain make duplicate replay idempotent and any gap, fork, overwrite, or truncation fail closed.
      - key: recursive_receipt
        effect: deny
        text: A receipt for receipt persistence, a receipt stored under live skill content, or an unbound mutable receipt is forbidden.
  - id: SFN-ARTIFACT-SCHEMAS-v1
    require:
      - versioned_plan_source_destination_schemas
      - versioned_apply_rollback_failure_terminal_schemas
      - run_plan_identity_binding
      - canonical_non_self_referential_artifact_hashing
    deny:
      - unversioned_artifact
      - free_form_identity_or_transition
    clauses:
      - key: artifact_versions
        effect: require
        text: Plan, source, destination, apply, rollback, failure, and terminal artifacts use only the exact versioned schemas and required fields in this contract.
      - key: artifact_encoding
        effect: require
        text: Artifacts use RFC 8785 canonical JSON UTF-8 bytes without a BOM and labeled sha256 digests; a complete plan digest appears only in downstream artifacts and a complete receipt digest appears only in the next receipt, so neither artifact hashes itself.
      - key: identity_binding
        effect: require
        text: Every operational artifact binds schema version, run ID, plan ID, and its declared plan digest, worker, source, destination, machine, state-transition, hash-chain, or terminal identities.
      - key: schema_drift
        effect: deny
        text: Missing fields, unknown fields, unversioned maps, free-form state names, inferred identities, and schema-version fallback reject admission, replay, and handoff.
  - id: SFN-RUN-STATE-MACHINE-v1
    require:
      - finite_run_and_target_states
      - interruption_and_partition_recovery
      - mixed_outcome_reconciliation
      - terminal_state_receipt
    deny:
      - forward_mutation_during_recovery
      - terminal_unknown_machine_state
      - second_lifecycle_authority
    clauses:
      - key: finite_transitions
        effect: require
        text: Run and target state changes use only the enumerated transition tables, persist the transition in the receipt chain, and reject every unknown state or edge.
      - key: interruption
        effect: require
        text: An interrupted apply enters apply-interrupted then recovery-pending, replays the exact journal identity, reconciles live destinations, and performs no new forward mutation.
      - key: mixed_outcome
        effect: require
        text: Any mutation combined with a failure or unreachable machine enters mixed-outcome, reconciles every selected machine, then rolls back every run mutation through the finite rollback path.
      - key: partition
        effect: require
        text: A partitioned machine remains unreachable-unknown and keeps the run recovery-pending and nonterminal until exact live state is reconciled.
      - key: terminal_rules
        effect: require
        text: Terminal-succeeded requires every selected target verified; terminal-rolled-back requires every run-mutated target rolled back; terminal-blocked after mutation requires all machine states reconciled and every rollback conflict receipted.
      - key: lifecycle_authority
        effect: deny
        text: The operational journal never creates a second task lifecycle authority; canonical coordination status remains in Todos.
  - id: SFN-ROLLBACK-v1
    require:
      - atomic_compare_before_rollback
      - exact_run_owned_state
      - rollback_receipt
      - run_level_rollback
    deny:
      - unconditional_restore_or_remove
      - changed_or_nonowned_state_removal
    clauses:
      - key: rollback_scope
        effect: require
        text: Rollback stops forward writes and considers every and only destination state installed by the exact run and plan across all selected machines.
      - key: rollback_compare
        effect: require
        text: Restore, remove, or remove-empty-directory is one guarded atomic compare operation against the exact run-installed identity, type, link count, metadata, and hash.
      - key: rollback_drift
        effect: deny
        text: Changed, drifted, unselected, unresolved, non-owned, or non-matching state is preserved and recorded as a rollback conflict rather than removed, replaced, or restored.
      - key: rollback_receipt
        effect: require
        text: Every rollback attempt appends a versioned rollback receipt with comparison, outcome, final identity or conflict, touched entry, and target transition.
      - key: directory_rollback
        effect: require
        text: A run-created selected directory is removed only after safe child rollback when it is empty and its live retained identity exactly equals the run-created identity; recursive deletion is forbidden.
  - id: SFN-SECRET-SCAN-v1
    require:
      - non_printing_source_rendered_target_scan
      - finding_blocks_mutation
      - filename_or_count_only_evidence
    deny:
      - printed_secret_match
      - skipped_secret_scan
    clauses:
      - key: scan_surfaces
        effect: require
        text: Non-printing secret scans cover immutable source bytes, rendered bytes, observed preimages, installed targets, and staged, repair-commit, and cumulative repository ranges.
      - key: scan_output
        effect: require
        text: Secret-scan evidence contains only status, counts, or filenames and never prints matched secret material.
      - key: scan_gate
        effect: deny
        text: A secret finding blocks the next mutation, commit, push, or handoff, and secret scanning is never optional, advisory, best-effort, printable, or skippable.
  - id: SFN-COORDINATOR-SEPARATION-v1
    require:
      - coordinator_scopes_and_delegates
      - distribution_worker_mutates_only_destinations_and_state
      - coordinator_verifies_evidence
    deny:
      - coordinator_repository_mutation
      - coordinator_live_skill_mutation
      - distribution_worker_source_mutation
    clauses:
      - key: coordinator_role
        effect: require
        text: The coordinator selects immutable merged source, machines, skills, retention, and worker route, delegates one bounded distribution run, and verifies returned evidence.
      - key: worker_role
        effect: require
        text: The distribution worker reads source and authoritative machine data but mutates only admitted destination skill directories and the exclusive external transaction state root.
      - key: prohibited_roles
        effect: deny
        text: The coordinator never performs repository or live-skill mutation, and the distribution worker never mutates a source repository, source worktree, package, auth profile, session, cache, log, unrelated configuration, or unselected destination.
```

## Canonical Normative Clauses

- [SFN-SOURCE-PROVENANCE-v1/require/exact_provenance] The worker binds each source record to one immutable commit, one tracked relative path, the byte-exact source, and its labeled sha256 digest before planning.
- [SFN-SOURCE-PROVENANCE-v1/require/source_repository_read_only] The distribution worker may read the repository-tracked source but never mutates the source repository or any source worktree; no assigned-worktree exemption exists.
- [SFN-SOURCE-PROVENANCE-v1/deny/moving_source] A branch tip, inferred copy, untracked file, mutable package, or best-effort commit, path, byte, hash, version, or integrity value rejects the run before destination mutation.
- [SFN-DETERMINISTIC-RENDERING-v1/require/scalar_encoder] The codewith-json-yaml-scalar-v1 encoder rejects unpaired surrogates, performs no Unicode normalization, emits ASCII double-quoted YAML scalars, escapes quote and backslash, uses \b, \t, \n, \f, and \r for their exact controls, uses lowercase \u00xx for every other U+0000 through U+001F control, emits slash literally, and emits every other scalar including U+2028 and U+2029 as shortest well-formed UTF-8 without a BOM.
- [SFN-DETERMINISTIC-RENDERING-v1/require/frontmatter_bytes] Rendering emits exactly delimiter LF, name colon space encoded-name LF, description colon space encoded-description LF, delimiter LF, then the tracked body after its closing-delimiter newline.
- [SFN-DETERMINISTIC-RENDERING-v1/require/body_bytes] Rendering changes only CRLF or CR body line endings to LF and changes no other body byte.
- [SFN-DETERMINISTIC-RENDERING-v1/require/deterministic_hash] The same immutable source bytes produce exactly one rendered byte sequence and labeled sha256 digest on every machine.
- [SFN-DETERMINISTIC-RENDERING-v1/deny/rendering_weakening] Machine-specific fields, timestamps, implementation-selected bytes, and best-effort byte rendering are forbidden.
- [SFN-DESTINATION-UNIQUENESS-v1/require/identity_format] A parsed frontmatter name is admitted only when it already equals the ASCII lowercase-hyphen normalized identity and the destination basename equals that identity byte for byte.
- [SFN-DESTINATION-UNIQUENESS-v1/require/selected_set_uniqueness] Before any apply transition, the worker rejects duplicate source identity, normalized identity, or destination basename in the selected source-record set and rejects duplicate machine-root collision key, lexical path, or canonical path in the expanded destination set.
- [SFN-DESTINATION-UNIQUENESS-v1/deny/collision_resolution] First-wins, last-wins, overwrite, merge, alias, and deferred per-machine collision resolution are forbidden.
- [SFN-ROOT-CONTAINMENT-v1/require/root_resolution] Each authoritative machine independently resolves its configured Codewith skills root to one byte-normal lexical path and one equal canonical path through a no-follow component walk.
- [SFN-ROOT-CONTAINMENT-v1/require/root_identity] The worker retains the root handle and binds its parent anchor, lexical entry, canonical path, device, inode, mount ID, directory type, metadata, and link count at admission, every operation, and closure.
- [SFN-ROOT-CONTAINMENT-v1/deny/root_escape] Dot segments, repeated separators, traversal, symlink or magic-link components, mount crossings, canonical escape, root replacement, and displaced-root use reject the operation before any read or mutation.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/require/indivisible_destination_transaction] Every destination child mutation is one indivisible fail-closed transaction that binds the live root lexical entry and retained identity, the live selected-directory lexical entry and retained identity, the exact child precondition, touched-ledger admission, mutation, and external journal receipt append.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/require/directory_identity] The complete root and selected-directory proof repeats before every child operation and at closure for both pre-existing and run-created selected directories.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/require/selected_directory_identity] The selected-directory proof binds its lexical entry through the retained root, retained no-follow handle, canonical path, device, inode, mount ID, directory type, metadata, and link count, or binds exact absence until one guarded creation returns that complete identity.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/deny/no_redirect] Rename, replacement, mount, link, metadata drift, or path displacement after admission never redirects a read, write, removal, rollback, or receipt-bound operation.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/deny/no_precheck_gap] A nearby pre-check followed by later mutation, including mutation through a retained but displaced handle, is insufficient and forbidden.
- [SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/require/primitive_availability] If no platform primitive or transaction provides the complete atomic binding, the worker fails before mutation.
- [SFN-CHILD-IDENTITY-v1/require/child_identity] Each child operation binds the exact lexical and canonical entry, type, device, inode, mount ID, metadata, link count, and labeled sha256 precondition or admitted absence to the operation result.
- [SFN-CHILD-IDENTITY-v1/require/child_type] Every existing or created file target is a retained no-follow regular-file handle with link count one.
- [SFN-CHILD-IDENTITY-v1/deny/invalid_child] Symlinks, directories, devices, sockets, FIFOs, special files, hard-linked files, and optional or advisory identity, link, type, or hash revalidation reject the operation.
- [SFN-CHILD-IDENTITY-v1/require/child_revalidation] Child identity, link, type, and hash are revalidated inside the guarded operation immediately after creation, before and after each use, and at closure.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/require/external_state] Temporary bytes, preimages, receipts, failures, and recovery state exist only beneath the exclusive configured Codewith transaction state root, which is outside every live skills directory and outside the source repository or worktree.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/require/exclusive_state_paths] Every run-owned state path is absent until its owning state-store operation and is created exactly once with no-follow exclusive-create semantics.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/require/state_file_identity] Every state artifact is a retained no-follow regular-file handle with link count one and exact entry, device, inode, mount ID, metadata, and labeled sha256 checks before and after each use.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/deny/state_path_reuse] A pre-existing, raced, symlinked, previously used, overwritten, truncated, or reused run state path rejects the run.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/require/retention_cleanup] The plan fixes retention before apply; immutable hash-chain receipts, failures, and preimages remain until expiry, and garbage collection is eligible only after a verified terminal receipt hash is exported to canonical Todos evidence.
- [SFN-RUN-PATH-EXCLUSIVITY-v1/deny/live_shadow_store] Live skill directories never contain normalization temporaries, preimages, receipts, journals, recovery files, tombstones, or cleanup metadata.
- [SFN-TOUCHED-LEDGER-v1/require/exact_allowlist] The immutable plan enumerates every exact lexical and canonical destination entry and every exact external run-state entry; directory prefixes, recursive admission, globs, and wildcards authorize nothing.
- [SFN-TOUCHED-LEDGER-v1/require/actual_touch] The guarded transaction records the actual canonical entry reached through retained handles, not a caller-supplied path string, in the authoritative append-only touched ledger.
- [SFN-TOUCHED-LEDGER-v1/require/subset_proof] Before every further mutation and at closure, the actual touched set must be an exact subset of the planned lexical and canonical allowlist with every pair still equal.
- [SFN-TOUCHED-LEDGER-v1/deny/outside_touch] Any read, write, create, removal, restoration, or receipt-state touch outside the exact allowlist fails closed.
- [SFN-RECEIPT-FINITENESS-v1/require/mutation_receipt] Every destination mutation and rollback atomically appends one versioned operation receipt that binds run ID, plan ID, plan artifact digest, worker, machine, source, destination, prestate, poststate, touch, transition, sequence, and previous-receipt digest.
- [SFN-RECEIPT-FINITENESS-v1/require/finite_base_case] Receipt persistence is an external state-store journal operation rather than a destination child mutation, and it does not require another receipt.
- [SFN-RECEIPT-FINITENESS-v1/require/receipt_chain] The exclusive append-only receipt sequence and previous-hash chain make duplicate replay idempotent and any gap, fork, overwrite, or truncation fail closed.
- [SFN-RECEIPT-FINITENESS-v1/deny/recursive_receipt] A receipt for receipt persistence, a receipt stored under live skill content, or an unbound mutable receipt is forbidden.
- [SFN-ARTIFACT-SCHEMAS-v1/require/artifact_versions] Plan, source, destination, apply, rollback, failure, and terminal artifacts use only the exact versioned schemas and required fields in this contract.
- [SFN-ARTIFACT-SCHEMAS-v1/require/artifact_encoding] Artifacts use RFC 8785 canonical JSON UTF-8 bytes without a BOM and labeled sha256 digests; a complete plan digest appears only in downstream artifacts and a complete receipt digest appears only in the next receipt, so neither artifact hashes itself.
- [SFN-ARTIFACT-SCHEMAS-v1/require/identity_binding] Every operational artifact binds schema version, run ID, plan ID, and its declared plan digest, worker, source, destination, machine, state-transition, hash-chain, or terminal identities.
- [SFN-ARTIFACT-SCHEMAS-v1/deny/schema_drift] Missing fields, unknown fields, unversioned maps, free-form state names, inferred identities, and schema-version fallback reject admission, replay, and handoff.
- [SFN-RUN-STATE-MACHINE-v1/require/finite_transitions] Run and target state changes use only the enumerated transition tables, persist the transition in the receipt chain, and reject every unknown state or edge.
- [SFN-RUN-STATE-MACHINE-v1/require/interruption] An interrupted apply enters apply-interrupted then recovery-pending, replays the exact journal identity, reconciles live destinations, and performs no new forward mutation.
- [SFN-RUN-STATE-MACHINE-v1/require/mixed_outcome] Any mutation combined with a failure or unreachable machine enters mixed-outcome, reconciles every selected machine, then rolls back every run mutation through the finite rollback path.
- [SFN-RUN-STATE-MACHINE-v1/require/partition] A partitioned machine remains unreachable-unknown and keeps the run recovery-pending and nonterminal until exact live state is reconciled.
- [SFN-RUN-STATE-MACHINE-v1/require/terminal_rules] Terminal-succeeded requires every selected target verified; terminal-rolled-back requires every run-mutated target rolled back; terminal-blocked after mutation requires all machine states reconciled and every rollback conflict receipted.
- [SFN-RUN-STATE-MACHINE-v1/deny/lifecycle_authority] The operational journal never creates a second task lifecycle authority; canonical coordination status remains in Todos.
- [SFN-ROLLBACK-v1/require/rollback_scope] Rollback stops forward writes and considers every and only destination state installed by the exact run and plan across all selected machines.
- [SFN-ROLLBACK-v1/require/rollback_compare] Restore, remove, or remove-empty-directory is one guarded atomic compare operation against the exact run-installed identity, type, link count, metadata, and hash.
- [SFN-ROLLBACK-v1/deny/rollback_drift] Changed, drifted, unselected, unresolved, non-owned, or non-matching state is preserved and recorded as a rollback conflict rather than removed, replaced, or restored.
- [SFN-ROLLBACK-v1/require/rollback_receipt] Every rollback attempt appends a versioned rollback receipt with comparison, outcome, final identity or conflict, touched entry, and target transition.
- [SFN-ROLLBACK-v1/require/directory_rollback] A run-created selected directory is removed only after safe child rollback when it is empty and its live retained identity exactly equals the run-created identity; recursive deletion is forbidden.
- [SFN-SECRET-SCAN-v1/require/scan_surfaces] Non-printing secret scans cover immutable source bytes, rendered bytes, observed preimages, installed targets, and staged, repair-commit, and cumulative repository ranges.
- [SFN-SECRET-SCAN-v1/require/scan_output] Secret-scan evidence contains only status, counts, or filenames and never prints matched secret material.
- [SFN-SECRET-SCAN-v1/deny/scan_gate] A secret finding blocks the next mutation, commit, push, or handoff, and secret scanning is never optional, advisory, best-effort, printable, or skippable.
- [SFN-COORDINATOR-SEPARATION-v1/require/coordinator_role] The coordinator selects immutable merged source, machines, skills, retention, and worker route, delegates one bounded distribution run, and verifies returned evidence.
- [SFN-COORDINATOR-SEPARATION-v1/require/worker_role] The distribution worker reads source and authoritative machine data but mutates only admitted destination skill directories and the exclusive external transaction state root.
- [SFN-COORDINATOR-SEPARATION-v1/deny/prohibited_roles] The coordinator never performs repository or live-skill mutation, and the distribution worker never mutates a source repository, source worktree, package, auth profile, session, cache, log, unrelated configuration, or unselected destination.

## Finite Workflow

1. [STEP/plan] Resolve exact source records, authoritative machine IDs, per-machine skills roots, external run state, retention, and the complete destination allowlist.
2. [STEP/collide] Reject duplicate identities in the selected source-record set and reject duplicate collision keys or paths in the expanded machine-destination set before any apply transition.
3. [STEP/admit] Persist the versioned plan and destination records, prove all roots and children, and enter applying only after the exclusive run state and receipt chain exist.
4. [STEP/apply] Execute each destination change through the indivisible guarded transaction and append its apply receipt to the external state journal.
5. [STEP/verify] Revalidate every destination and secret-scan result, aggregate all machine target states, and emit terminal success only when every selected target is verified.
6. [STEP/recover] On interruption, partition, or mixed outcome stop forward mutation, replay only the exact run journal, reconcile every target, and drive the finite rollback path.
7. [STEP/close] Emit one versioned terminal receipt, export its hash as Todos evidence, retain operational evidence through the planned interval, and permit only policy-owned state-store garbage collection.

## Safe Near-Misses

- [SAFE/SFN-SOURCE-PROVENANCE-v1/read_only_source] Reading an immutable source worktree is allowed; writing that source worktree is not allowed.
- [SAFE/SFN-DETERMINISTIC-RENDERING-v1/report_hash] Machine-specific reporting may contain a machine ID after rendering; the rendered skill bytes may not contain machine-specific data.
- [SAFE/SFN-DESTINATION-UNIQUENESS-v1/different_roots] The same normalized identity may target different machines only when every machine-root collision key and destination path remains unique.
- [SAFE/SFN-ROOT-CONTAINMENT-v1/report_displacement] Evidence reporting may continue after root displacement, but no destination read or mutation may continue.
- [SAFE/SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1/no_precheck] A pre-check may inform planning, but it is not sufficient for a later destination mutation.
- [SAFE/SFN-CHILD-IDENTITY-v1/single_link] A regular file with link count one may be admitted; a hard-linked file may not be admitted.
- [SAFE/SFN-RUN-PATH-EXCLUSIVITY-v1/external_state] External state-root receipts may persist through retention; no operational state may persist under live skill content.
- [SAFE/SFN-TOUCHED-LEDGER-v1/report_outside] A report may name an out-of-allowlist path as rejected evidence; no operation may touch that path.
- [SAFE/SFN-RECEIPT-FINITENESS-v1/base_case] Receipt persistence may complete without a child receipt because it is the external journal base case, not a destination child operation.
- [SAFE/SFN-ARTIFACT-SCHEMAS-v1/human_summary] A human summary may accompany a versioned artifact, but it may not replace or weaken any required schema field.
- [SAFE/SFN-RUN-STATE-MACHINE-v1/nonterminal_partition] Reporting a partition is allowed while recovery remains pending; terminal success or rollback is not allowed until reconciliation.
- [SAFE/SFN-ROLLBACK-v1/preserve_drift] Rollback may preserve changed or non-owned state and report a conflict; it may not remove, replace, or restore that state.
- [SAFE/SFN-SECRET-SCAN-v1/non_printing] Secret scanning may print filenames or counts; it may not print matches and may not be skipped.
- [SAFE/SFN-COORDINATOR-SEPARATION-v1/verify_only] The coordinator may verify worker receipts and update Todos; it may not perform the worker's repository or live-skill mutation.
