import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
const skillPath = join(
  repositoryRoot,
  "agent-skills/fleet-skill-normalization/SKILL.md",
);
const readmePath = join(repositoryRoot, "agent-skills/README.md");
const skill = readFileSync(skillPath, "utf8");

const expectedFrontmatterLines = [
  "name: fleet-skill-normalization",
  'description: "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, canonical containment, finite transactions, and rollback evidence."',
  "user_invocable: true",
] as const;

const expectedFrontmatter = {
  name: "fleet-skill-normalization",
  description:
    "Use when distributing repository-tracked instruction skills into Codewith skill directories across an explicitly scoped machine set with exact provenance, canonical containment, finite transactions, and rollback evidence.",
  user_invocable: true,
};

const invariantIds = [
  "SFN-SOURCE-PROVENANCE-v1",
  "SFN-DETERMINISTIC-RENDERING-v1",
  "SFN-DESTINATION-UNIQUENESS-v1",
  "SFN-ROOT-CONTAINMENT-v1",
  "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  "SFN-CHILD-IDENTITY-v1",
  "SFN-RUN-PATH-EXCLUSIVITY-v1",
  "SFN-TOUCHED-LEDGER-v1",
  "SFN-RECEIPT-FINITENESS-v1",
  "SFN-ARTIFACT-SCHEMAS-v1",
  "SFN-RUN-STATE-MACHINE-v1",
  "SFN-ROLLBACK-v1",
  "SFN-SECRET-SCAN-v1",
  "SFN-COORDINATOR-SEPARATION-v1",
] as const;

type InvariantId = (typeof invariantIds)[number];
type Effect = "require" | "deny";

type Clause = {
  key: string;
  effect: Effect;
  text: string;
};

type SafetyInvariant = {
  id: string;
  require: string[];
  deny: string[];
  clauses: Clause[];
};

type ArtifactSchema = {
  name: string;
  version: string;
  required_fields: string[];
};

type WorkflowStep = {
  id: string;
  text: string;
};

type SafetyContract = {
  version: string;
  normative_language: Record<string, unknown>;
  identity: Record<string, unknown>;
  state_root: Record<string, unknown>;
  artifact_encoding: Record<string, unknown>;
  artifacts: ArtifactSchema[];
  run_state_machine: Record<string, unknown>;
  target_state_machine: Record<string, unknown>;
  recovery: Record<string, unknown>;
  workflow: { version: string; steps: WorkflowStep[] };
  invariants: SafetyInvariant[];
};

type InvariantSpec = {
  require: string[];
  deny: string[];
  clauses: Record<string, string>;
};

const invariantSpecs: Record<InvariantId, InvariantSpec> = {
  "SFN-SOURCE-PROVENANCE-v1": {
    require: [
      "immutable_source_commit",
      "tracked_source_path",
      "exact_source_bytes_sha256",
      "read_only_source_repository",
    ],
    deny: [
      "moving_or_inferred_source",
      "best_effort_provenance",
      "source_repository_or_worktree_mutation",
    ],
    clauses: {
      exact_provenance:
        "791a767cbe30aaa6ff54da44813ba93f122a4feb57d3ab30bfded9bdb9905e4a",
      source_repository_read_only:
        "0975a9dfb253f501f990040bb153424a5b8650ad9cc8c05db5f9f9d3ff3c18c9",
      moving_source:
        "885fc130389b0eb103351ee9b01499693889f5f51aa864e806a5e71a6f41e2ec",
    },
  },
  "SFN-DETERMINISTIC-RENDERING-v1": {
    require: [
      "codewith_json_yaml_scalar_v1",
      "byte_exact_frontmatter",
      "deterministic_body_line_endings",
      "one_rendered_hash",
    ],
    deny: ["machine_specific_rendering", "best_effort_byte_rendering"],
    clauses: {
      scalar_encoder:
        "aeebd355627ef23eadf31c9ff31b723522c66160663b4a63332fa680aa70a250",
      frontmatter_bytes:
        "78bffd71407753e4f827cda1d71119fab0fb97b81cf0143a98b9a20f14a39124",
      body_bytes:
        "b9e847d8f0eb2c2f65897d19b9b71fbfc9922c5f30d8573577937a81e59c207c",
      deterministic_hash:
        "cb6e1afb8c298fd4e662f9a9573e0ff10a67de7026c26da8da2fc1ab94418eec",
      rendering_weakening:
        "696b5dd39c9a630592427687dc1ef56f4e39242362dd97ecf62393e60ff7c536",
    },
  },
  "SFN-DESTINATION-UNIQUENESS-v1": {
    require: [
      "canonical_skill_identity",
      "destination_basename_from_identity",
      "entire_selected_set_collision_check",
    ],
    deny: [
      "duplicate_normalized_identity",
      "duplicate_destination_path",
      "first_wins_collision_handling",
    ],
    clauses: {
      identity_format:
        "22170c06ebe0a28485214dae50992c69e8db9d8ec29a12ff9660007011ba3293",
      selected_set_uniqueness:
        "5ae884ce1e5de435e7472de3599ed1465ccb853e885d95c6d47861702c6990db",
      collision_resolution:
        "69c0a47ba4d455b7bf960252f44587524bab7238d80c9db9899239b826ddf0e6",
    },
  },
  "SFN-ROOT-CONTAINMENT-v1": {
    require: [
      "exact_lexical_and_canonical_root",
      "no_follow_component_walk",
      "retained_root_identity",
    ],
    deny: ["traversal_or_symlink_components", "displaced_root_use"],
    clauses: {
      root_resolution:
        "b0afc72357710bd6e620a32fd12f479392086494c6328b053c4f737890a79cb5",
      root_identity:
        "a58f5ffd023b83daf28b8a9f585b9e66b03029e5a161a30b0bf5084130a5125b",
      root_escape:
        "a32442e36dcd57a9176129b70fb28a1e90cbd822d5c037ac357ff13d4ce407ee",
    },
  },
  "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1": {
    require: [
      "indivisible_root_directory_child_binding",
      "exact_selected_directory_identity",
      "operation_bound_touched_ledger_and_receipt",
      "repeated_existing_directory_identity",
      "repeated_run_created_directory_identity",
    ],
    deny: ["check_then_mutate", "displaced_directory_redirection"],
    clauses: {
      indivisible_destination_transaction:
        "684082eac28f78e1bf512f89eabf905b5d958f1ed0900e8405c0cf6df1909b21",
      directory_identity:
        "3592626aa510818157321b9b9a10de93ff42e8e0c3ddfb0f243691cb470f73f9",
      selected_directory_identity:
        "e964211dd91ad5bc38f834febc7913650febabc10767989ac57bcace3d9a7cfe",
      no_redirect:
        "7083620002af6ed774386a67d819ea78fe365b435df45c4cf80c1a30afd08054",
      no_precheck_gap:
        "628de65ba5da061c8288293dd5434aa0e0e5eba4980e3e3ca00c4eb7bd107843",
      primitive_availability:
        "06facdb6654b875353b839edbcd69b71dfc464da36dbdddad5b9fe68833c549c",
    },
  },
  "SFN-CHILD-IDENTITY-v1": {
    require: [
      "exact_child_entry_type_link_inode_hash",
      "single_link_regular_files",
      "operation_bound_revalidation",
    ],
    deny: ["special_or_hard_link_targets", "advisory_child_revalidation"],
    clauses: {
      child_identity:
        "dfcb351160e6d6af8c4f96dfda7846e9585cd2d484128abd6cf2c9bb99e726a1",
      child_type:
        "5f8afba7a3e671887dc334379fa592344276d54daee9483116524e072bbda8b7",
      invalid_child:
        "a2ba2797943dd00a6761f76fc79168e25d1c24b00b5e61152e5ba96eb536fb0e",
      child_revalidation:
        "576ae9f78467a64f7e6dabe72999ace5342bb5b0a9f22c15017637a7fd614564",
    },
  },
  "SFN-RUN-PATH-EXCLUSIVITY-v1": {
    require: [
      "external_authoritative_state_root",
      "absent_until_owner_operation",
      "exclusive_create_no_follow",
      "single_link_regular_state_files",
      "explicit_retention_and_cleanup",
    ],
    deny: [
      "state_under_live_skill_directories",
      "preexisting_run_path_reuse",
      "overwrite_or_truncate_run_path",
    ],
    clauses: {
      external_state:
        "cccc10a980cbba31be176a9b671a87b057b67d095a76ee3d3a92f50b701a02fc",
      exclusive_state_paths:
        "ff8f1592a319976fc4d6297e40c9b8fb2fdf3036d791b6f89cdee442da8a589d",
      state_file_identity:
        "cff8eb3e5943ce0dbe52912b2a26f9c09b2ae38f0354081834647b37679e754c",
      state_path_reuse:
        "3017d44045aaa60862808386f40dd8d6954a9ea7eb90c92f8442df1ec4d38228",
      retention_cleanup:
        "029a14ca2d92f41812197d048f8e6368a976e3385b481a88293cba82b27cbb29",
      live_shadow_store:
        "5bf44f2b11ff7d431806c7061559c6eb4e616887c7053d69e2223ca0794b00f4",
    },
  },
  "SFN-TOUCHED-LEDGER-v1": {
    require: [
      "exact_lexical_and_canonical_allowlist",
      "authoritative_actual_canonical_mutation_touches",
      "mutation_touched_subset_proof",
    ],
    deny: ["prefix_glob_or_wildcard_admission", "out_of_allowlist_touch"],
    clauses: {
      exact_allowlist:
        "372a95cfe89bd8f8e347cd7ed4f53d33deee6adbd4c3511bd5b3e3e7eb1f3832",
      actual_touch:
        "0b7afd08fc61681c89e1fbfd36d2827ee0101b81ea2c9534edd5c482ebbf3d82",
      subset_proof:
        "c9151de8f2ccdf9b9912d4953fc577a0810fa719a1edfa00d35bdbc0aa0247ef",
      outside_touch:
        "e6a9b11e109e270846506f893c8090413cd2529c90819dfbde35ae50e2de6af9",
    },
  },
  "SFN-RECEIPT-FINITENESS-v1": {
    require: [
      "destination_mutation_receipt",
      "external_append_only_hash_chain",
      "finite_persistence_base_case",
    ],
    deny: ["recursive_receipt_requirement", "unbound_or_overwritable_receipt"],
    clauses: {
      mutation_receipt:
        "2b11a443bd0221b85a5896e33c93cf909e146adb1abeefa4ba6de80e29a4cf95",
      finite_base_case:
        "a97ea086a2319b38ce40cb1f3b904f4264559ebcd45a79416ba77ec29720bc52",
      receipt_chain:
        "30d82b30696547659dee4dde65babb80718db8a821fd465f8753963e98faef41",
      recursive_receipt:
        "a21ef6e8acc2950cddf393856487695e17b218cca759243654b3abeaa5756a35",
    },
  },
  "SFN-ARTIFACT-SCHEMAS-v1": {
    require: [
      "versioned_plan_source_destination_schemas",
      "versioned_apply_rollback_failure_terminal_schemas",
      "run_plan_identity_binding",
      "canonical_non_self_referential_artifact_hashing",
    ],
    deny: ["unversioned_artifact", "free_form_identity_or_transition"],
    clauses: {
      artifact_versions:
        "a62c094d4f82636a117cff77f373e4e70c2e567f31bada72c47a34cd4e4e0667",
      artifact_encoding:
        "8103e494a68260cc2a430f23849fde128f26778199d60b582bc48d80ca5d20ac",
      identity_binding:
        "0ab069a0011cbb115eaeb7fc536530f6c1825b69c1ffec57b0e9b2095e89027e",
      schema_drift:
        "12bd1fb87a2126ad641cb76e67162912c22fd96ad5c98cc9f0a8742aeab7fe0f",
    },
  },
  "SFN-RUN-STATE-MACHINE-v1": {
    require: [
      "finite_run_and_target_states",
      "interruption_and_partition_recovery",
      "mixed_outcome_reconciliation",
      "terminal_state_receipt",
    ],
    deny: [
      "forward_mutation_during_recovery",
      "terminal_unknown_machine_state",
      "second_lifecycle_authority",
    ],
    clauses: {
      finite_transitions:
        "6bb4caa3ea06e6e2ec918ed5da0c41ece085b83adf8d867a7505eee21afeaa31",
      interruption:
        "617f80b6f25ffeb4bd67a7db40df2f2f2785a19c82908d3ce51816033b51999d",
      mixed_outcome:
        "ddf90bb46e3033f7e3ee5cb4491d982aa4e1ced96b85d9f9fb0f8c9072d4e6d4",
      partition:
        "34b25b52a79d4d1de0ca0edf65cdc30277deef6138d344ab5aa82e2394aa1710",
      terminal_rules:
        "a96b13d3f3f5fb03cc853d8a362817f7d8aae4bb8bde5477a3325787831a72f3",
      lifecycle_authority:
        "e31d9d6df85ff2a1801cc36d3f1a553ba4edb9a750f27d158193085971ebaea7",
    },
  },
  "SFN-ROLLBACK-v1": {
    require: [
      "atomic_compare_before_rollback",
      "exact_run_owned_state",
      "rollback_receipt",
      "run_level_rollback",
    ],
    deny: ["unconditional_restore_or_remove", "changed_or_nonowned_state_removal"],
    clauses: {
      rollback_scope:
        "55a7535beb04e6eefa758a628c7e237c8abccd8d97007994408ce145322c8366",
      rollback_compare:
        "8788a6bc25f227415bab592be2f3cff41cfa48e3fedba98050c02ebb15145b5d",
      rollback_drift:
        "371f8ba8cd06ccd0aa6e4c1437f35d008889c3f6f8a67ded33b8d4322235c5be",
      rollback_receipt:
        "ec6f2a103bba5cecc98467f63cb028efaa5517e8d5f283008cb5f72191ea42a5",
      directory_rollback:
        "9701d933b740a8291648731587b7919324ec674845c929d3ae075929c14432e6",
    },
  },
  "SFN-SECRET-SCAN-v1": {
    require: [
      "non_printing_source_rendered_target_scan",
      "finding_blocks_mutation",
      "filename_or_count_only_evidence",
    ],
    deny: ["printed_secret_match", "skipped_secret_scan"],
    clauses: {
      scan_surfaces:
        "b21d133b80ca8b0efd9aaf1010a7628fab56bcc4be2f3baf0005c8906de27405",
      scan_output:
        "ecf3857561570a385e0d029b4a967cda711756b69262ed4f4fc407ae9eb63596",
      scan_gate:
        "ebd9e987288be597428f9cbc29b8211e98db1a2b94f544316d3ef52f2fb6bba6",
    },
  },
  "SFN-COORDINATOR-SEPARATION-v1": {
    require: [
      "coordinator_scopes_and_delegates",
      "distribution_worker_mutates_only_destinations_and_state",
      "coordinator_verifies_evidence",
    ],
    deny: [
      "coordinator_repository_mutation",
      "coordinator_live_skill_mutation",
      "distribution_worker_source_mutation",
    ],
    clauses: {
      coordinator_role:
        "8c6df61866a5b56d702bdf9001b5f2fd157af0c385f9760195c559b609227fac",
      worker_role:
        "fda269e5f5431a8a956ff4bc31454024f544f902d3fe66c65510c70129411351",
      prohibited_roles:
        "22d01ab4fe1cd0f284f6ef14fa5d5c93ed3d3a9f322856bac04ec313d47fb27c",
    },
  },
};

const expectedNormativeLanguage = {
  version: "sfn-normative-layout-v2",
  operative_scope:
    "exact_uncommented_section_layout_outside_structured_contract",
  html_comments: "stripped_as_non_operative",
  tagged_clause_format: "[invariant-id/effect/key]",
  registered_clause_policy:
    "exact_section_list_indent_order_single_occurrence",
  frontmatter_policy: "exact_supported_key_order_ascii_identity_and_values",
  yaml_mapping_policy:
    "reject_duplicate_keys_before_parse_at_every_mapping_level",
  unknown_tagged_clause: "deny",
  unknown_untagged_behavioral_content: "deny",
  safe_near_miss_policy: "exact_registered_examples_only",
};

const expectedIdentity = {
  version: "sfn-skill-identity-v1",
  source_identity_field: "frontmatter_name",
  normalized_identity_pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  normalization: "input_must_already_equal_normalized_identity",
  destination_basename: "normalized_identity",
  destination_collision_key:
    "machine_id|skills_root_identity|destination_basename",
  selected_set_admission:
    "reject_duplicate_source_identities_and_expanded_destination_collisions_before_apply",
};

const expectedStateRoot = {
  version: "sfn-run-state-root-v1",
  authority: "configured_codewith_transaction_state_store",
  run_path: "fleet-skill-normalization/<run_id>",
  relation_to_live_skills: "neither_ancestor_nor_descendant",
  relation_to_source_repository: "outside_source_repository_and_worktree",
  create: "exclusive_absent_no_follow",
  persistence_base_case:
    "state_artifact_persistence_is_not_a_destination_child_mutation",
  receipt_persistence_requires_receipt: false,
  lifecycle_authority: "operational_evidence_only_todos_remains_canonical",
  retention:
    "retain_hash_chain_receipts_failures_and_preimages_until_plan_retention_expiry",
  cleanup:
    "terminal_state_and_exported_terminal_hash_required_before_state_store_garbage_collection",
};

const expectedArtifactEncoding = {
  version: "sfn-canonical-artifact-json-v2",
  bytes: "rfc8785_canonical_json_utf8_without_bom",
  digest: "sha256:<lowercase-hex>",
  plan_digest_rule:
    "hash_complete_plan_artifact_then_bind_digest_only_in_downstream_artifacts",
  receipt_digest_rule:
    "hash_complete_receipt_artifact_then_bind_digest_only_in_the_next_receipt",
  transition_receipt_rule:
    "every_enumerated_run_and_target_edge_has_exactly_one_matching_transition_receipt",
  mutation_receipt_rule:
    "apply_and_rollback_receipts_are_immediately_followed_and_bound_by_the_corresponding_target_transition_receipt",
  unknown_fields: "deny",
};

const expectedArtifacts: ArtifactSchema[] = [
  {
    name: "plan",
    version: "sfn-plan-v1",
    required_fields: [
      "schema_version",
      "contract_version",
      "run_id",
      "plan_id",
      "coordinator_id",
      "worker_id",
      "worker_route_alias",
      "source_records_hash",
      "selected_machine_ids",
      "selected_skill_identities",
      "destination_collision_keys",
      "skills_root_records_hash",
      "exact_allowlist_hash",
      "state_root_identity",
      "retention_policy_hash",
    ],
  },
  {
    name: "source_record",
    version: "sfn-source-record-v1",
    required_fields: [
      "schema_version",
      "contract_version",
      "run_id",
      "plan_id",
      "source_record_id",
      "source_repository_identity",
      "source_commit",
      "tracked_source_path",
      "source_bytes_sha256",
      "parsed_frontmatter_name",
      "normalized_skill_identity",
      "destination_basename",
      "package_version_and_integrity",
    ],
  },
  {
    name: "destination_record",
    version: "sfn-destination-record-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "machine_id",
      "source_record_hash",
      "skills_root_lexical_path",
      "skills_root_canonical_path",
      "skills_root_identity",
      "selected_directory_lexical_entry",
      "selected_directory_canonical_path",
      "selected_directory_identity",
      "selected_directory_prestate",
      "child_lexical_entry",
      "child_canonical_path",
      "child_identity",
      "child_prestate_sha256",
      "rendered_target_sha256",
    ],
  },
  {
    name: "run_transition_receipt",
    version: "sfn-run-transition-receipt-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "receipt_sequence",
      "previous_receipt_sha256",
      "operation_id",
      "run_state_from",
      "run_state_to",
      "transition_reason_hash",
      "machine_target_states_hash",
    ],
  },
  {
    name: "target_transition_receipt",
    version: "sfn-target-transition-receipt-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "receipt_sequence",
      "previous_receipt_sha256",
      "operation_id",
      "machine_id",
      "destination_record_hash",
      "target_state_from",
      "target_state_to",
      "transition_reason_hash",
      "transition_evidence_sha256",
      "live_identity_hash",
    ],
  },
  {
    name: "apply_receipt",
    version: "sfn-apply-receipt-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "receipt_sequence",
      "previous_receipt_sha256",
      "operation_id",
      "machine_id",
      "destination_record_hash",
      "source_record_hash",
      "prestate_identity_hash",
      "poststate_identity_hash",
      "touched_ledger_entry_hash",
    ],
  },
  {
    name: "rollback_receipt",
    version: "sfn-rollback-receipt-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "receipt_sequence",
      "previous_receipt_sha256",
      "operation_id",
      "machine_id",
      "destination_record_hash",
      "installed_state_comparison",
      "rollback_result",
      "final_identity_hash",
      "touched_ledger_entry_hash",
    ],
  },
  {
    name: "failure_evidence",
    version: "sfn-failure-evidence-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "current_run_state",
      "machine_target_states_hash",
      "unresolved_machine_ids",
      "immutable_reason_codes",
      "last_receipt_sha256",
      "last_run_transition_receipt_sha256",
      "last_target_transition_receipts_hash",
      "recovery_requirement",
    ],
  },
  {
    name: "terminal_receipt",
    version: "sfn-terminal-receipt-v1",
    required_fields: [
      "schema_version",
      "run_id",
      "plan_id",
      "plan_artifact_sha256",
      "worker_id",
      "receipt_sequence",
      "previous_receipt_sha256",
      "result",
      "terminal_run_state",
      "run_transition_receipt_sha256",
      "receipt_chain_sha256",
      "machine_target_states_hash",
      "exact_allowlist_hash",
      "touched_ledger_hash",
      "source_render_target_hashes",
      "non_printing_secret_scan_summary",
      "rollback_summary",
      "retention_until",
      "cleanup_eligibility",
    ],
  },
];

const expectedRunStateMachine = {
  version: "sfn-run-state-machine-v1",
  initial_state: "planned",
  terminal_states: [
    "terminal_succeeded",
    "terminal_rolled_back",
    "terminal_blocked",
  ],
  transitions: {
    planned: ["applying", "terminal_blocked"],
    applying: [
      "verifying",
      "apply_interrupted",
      "mixed_outcome",
      "rollback_pending",
      "terminal_blocked",
    ],
    verifying: [
      "terminal_succeeded",
      "apply_interrupted",
      "mixed_outcome",
      "rollback_pending",
    ],
    apply_interrupted: ["recovery_pending"],
    mixed_outcome: ["recovery_pending", "rollback_pending"],
    recovery_pending: ["rollback_pending", "terminal_blocked"],
    rollback_pending: ["rolling_back"],
    rolling_back: [
      "terminal_rolled_back",
      "recovery_pending",
      "terminal_blocked",
    ],
    terminal_succeeded: [],
    terminal_rolled_back: [],
    terminal_blocked: [],
  },
  aggregation: {
    terminal_succeeded: "every_selected_target_verified",
    no_mutation_failure: "terminal_blocked_with_failure_evidence",
    any_mutation_plus_failure:
      "mixed_outcome_then_reconcile_then_rollback",
    interruption_after_mutation:
      "apply_interrupted_then_recovery_pending",
    unreachable_machine_after_mutation:
      "mixed_outcome_then_recovery_pending",
    recovery_pending:
      "nonterminal_until_every_unknown_target_is_reconciled",
    forward_mutation_during_mixed_recovery_or_rollback: "forbidden",
    terminal_rolled_back:
      "every_run_mutated_target_rolled_back_and_all_machine_states_reconciled",
    terminal_blocked_after_mutation:
      "only_after_all_machine_states_reconciled_and_every_rollback_conflict_recorded",
  },
};

const expectedTargetStateMachine = {
  version: "sfn-target-state-machine-v1",
  initial_state: "planned",
  transitions: {
    planned: ["applying"],
    applying: ["applied", "unchanged_failed", "unreachable_unknown"],
    applied: ["verifying", "rollback_pending"],
    verifying: ["verified", "rollback_pending", "unreachable_unknown"],
    verified: ["rollback_pending"],
    unchanged_failed: [],
    unreachable_unknown: ["recovery_pending"],
    recovery_pending: [
      "applied",
      "verified",
      "rollback_pending",
      "rollback_conflict",
    ],
    rollback_pending: ["rolling_back"],
    rolling_back: ["rolled_back", "rollback_conflict", "unreachable_unknown"],
    rolled_back: [],
    rollback_conflict: [],
  },
};

const expectedRecovery = {
  version: "sfn-recovery-v1",
  replay_identity: [
    "run_id",
    "plan_id",
    "plan_artifact_sha256",
    "state_root_identity",
    "contiguous_receipt_hash_chain",
  ],
  stale_run_policy: "exact_identity_mismatch_fails_closed",
  machine_partition_policy:
    "remain_recovery_pending_without_new_forward_mutation",
  reconciliation:
    "revalidate_live_destination_against_last_receipted_identity_before_transition",
  mixed_outcome_policy:
    "reconcile_every_selected_machine_then_rollback_every_run_mutation",
  duplicate_replay_policy: "idempotent_receipt_sequence_and_operation_id",
};

const expectedWorkflow = {
  version: "sfn-workflow-v1",
  steps: [
    {
      id: "plan",
      text: "Resolve exact source records, authoritative machine IDs, per-machine skills roots, external run state, retention, and the complete destination allowlist.",
    },
    {
      id: "collide",
      text: "Reject duplicate identities in the selected source-record set and reject duplicate collision keys or paths in the expanded machine-destination set before any apply transition.",
    },
    {
      id: "admit",
      text: "Persist the versioned plan and destination records, prove all roots and children, and enter applying only after the exclusive run state, receipt chain, and matching run-transition receipt exist.",
    },
    {
      id: "apply",
      text: "Execute each destination change through the indivisible guarded transaction, append its apply or rollback receipt, then append the matching target-transition receipt whose previous digest and transition-evidence digest equal that operation-receipt digest.",
    },
    {
      id: "verify",
      text: "Revalidate every destination and secret-scan result, aggregate all machine target states, and emit terminal success only when every selected target is verified.",
    },
    {
      id: "recover",
      text: "On interruption, partition, or mixed outcome stop forward mutation, replay only the exact run journal, reconcile every target, and drive the finite rollback path.",
    },
    {
      id: "close",
      text: "Append the terminal run-transition receipt, emit one versioned terminal receipt bound to it, export the terminal hash as Todos evidence, retain operational evidence through the planned interval, and permit only policy-owned state-store garbage collection.",
    },
  ],
};

const safeNearMisses = [
  {
    id: "SFN-SOURCE-PROVENANCE-v1",
    key: "read_only_source",
    text: "Reading an immutable source worktree is allowed; writing that source worktree is not allowed.",
  },
  {
    id: "SFN-DETERMINISTIC-RENDERING-v1",
    key: "report_hash",
    text: "Machine-specific reporting may contain a machine ID after rendering; the rendered skill bytes may not contain machine-specific data.",
  },
  {
    id: "SFN-DESTINATION-UNIQUENESS-v1",
    key: "different_roots",
    text: "The same normalized identity may target different machines only when every machine-root collision key and destination path remains unique.",
  },
  {
    id: "SFN-ROOT-CONTAINMENT-v1",
    key: "report_displacement",
    text: "Evidence reporting may continue after root displacement, but no destination read or mutation may continue.",
  },
  {
    id: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
    key: "no_precheck",
    text: "A pre-check may inform planning, but it is not sufficient for a later destination mutation.",
  },
  {
    id: "SFN-CHILD-IDENTITY-v1",
    key: "single_link",
    text: "A regular file with link count one may be admitted; a hard-linked file may not be admitted.",
  },
  {
    id: "SFN-RUN-PATH-EXCLUSIVITY-v1",
    key: "external_state",
    text: "External state-root receipts may persist through retention; no operational state may persist under live skill content.",
  },
  {
    id: "SFN-TOUCHED-LEDGER-v1",
    key: "report_outside",
    text: "A report may name an out-of-allowlist path as rejected evidence; no operation may touch that path.",
  },
  {
    id: "SFN-RECEIPT-FINITENESS-v1",
    key: "base_case",
    text: "Receipt persistence may complete without a child receipt because it is the external journal base case, not a destination child operation.",
  },
  {
    id: "SFN-ARTIFACT-SCHEMAS-v1",
    key: "human_summary",
    text: "A human summary may accompany a versioned artifact, but it may not replace or weaken any required schema field.",
  },
  {
    id: "SFN-RUN-STATE-MACHINE-v1",
    key: "nonterminal_partition",
    text: "Reporting a partition is allowed while recovery remains pending; terminal success or rollback is not allowed until reconciliation.",
  },
  {
    id: "SFN-ROLLBACK-v1",
    key: "preserve_drift",
    text: "Rollback may preserve changed or non-owned state and report a conflict; it may not remove, replace, or restore that state.",
  },
  {
    id: "SFN-SECRET-SCAN-v1",
    key: "non_printing",
    text: "Secret scanning may print filenames or counts; it may not print matches and may not be skipped.",
  },
  {
    id: "SFN-COORDINATOR-SEPARATION-v1",
    key: "verify_only",
    text: "The coordinator may verify worker receipts and update Todos; it may not perform the worker's repository or live-skill mutation.",
  },
] satisfies Array<{ id: InvariantId; key: string; text: string }>;

const expectedPreambleLines = [
  "# Fleet Skill Normalization",
  "This workflow distributes immutable repository-tracked skill bytes to explicitly selected Codewith destinations. It does not publish packages, mutate source repositories, or widen machine or skill scope.",
] as const;

const expectedSectionNames = [
  "Contract Interpretation",
  "Safety Contract",
  "Canonical Normative Clauses",
  "Finite Workflow",
  "Safe Near-Misses",
] as const;

const expectedContractInterpretationLines = [
  "The structured contract and every live tagged clause are jointly normative. HTML comments and fenced examples other than the structured contract are non-operative. Unknown, duplicate, missing, or altered live behavioral content fails closed.",
] as const;

function hashClause(clause: Clause): string {
  return createHash("sha256")
    .update(`${clause.effect}\0${clause.text}`)
    .digest("hex");
}

function same(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function stripHtmlComments(document: string): string {
  return document.replace(/<!--[\s\S]*?-->/g, "");
}

function extractFrontmatter(document: string): {
  yaml: string;
  body: string;
} {
  if (!document.startsWith("---\n")) {
    throw new Error("missing exact opening delimiter");
  }
  const end = document.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error("missing exact closing delimiter");
  }
  return {
    yaml: document.slice(4, end),
    body: document.slice(end + 5),
  };
}

function assertNoDuplicateYamlMappingKeys(
  yaml: string,
  label: string,
): void {
  type MappingFrame = { column: number; keys: Set<string> };
  const frames: MappingFrame[] = [];

  for (const [index, line] of yaml.split("\n").entries()) {
    if (line.trim() === "") continue;
    if (/^\s*#/.test(line)) {
      throw new Error(`${label} line ${index + 1}: comments are not admitted`);
    }
    const leadingWhitespace = line.match(/^[\t ]*/)?.[0] ?? "";
    if (leadingWhitespace.includes("\t")) {
      throw new Error(`${label} line ${index + 1}: tab indentation`);
    }
    const indentation = leadingWhitespace.length;
    let content = line.slice(indentation);
    const sequenceItem = content.startsWith("- ");
    if (sequenceItem) content = content.slice(2);

    const keyMatch = content.match(
      /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/,
    );
    if (!keyMatch) {
      if (!sequenceItem || content.includes(":")) {
        throw new Error(
          `${label} line ${index + 1}: unsupported YAML mapping syntax`,
        );
      }
      continue;
    }
    const inlineValue = content
      .slice(keyMatch[1].length + 1)
      .trimStart();
    if (
      inlineValue.startsWith("{") ||
      (inlineValue.startsWith("[") && inlineValue !== "[]") ||
      /^[&*!]/.test(inlineValue)
    ) {
      throw new Error(
        `${label} line ${index + 1}: unsupported flow, anchor, alias, or tag syntax`,
      );
    }

    const column = indentation + (sequenceItem ? 2 : 0);
    if (sequenceItem) {
      while (
        frames.length > 0 &&
        frames[frames.length - 1].column >= column
      ) {
        frames.pop();
      }
      frames.push({ column, keys: new Set() });
    } else {
      while (
        frames.length > 0 &&
        frames[frames.length - 1].column > column
      ) {
        frames.pop();
      }
      if (
        frames.length === 0 ||
        frames[frames.length - 1].column < column
      ) {
        frames.push({ column, keys: new Set() });
      }
    }

    const frame = frames[frames.length - 1];
    const key = keyMatch[1];
    if (frame.keys.has(key)) {
      throw new Error(
        `${label} line ${index + 1}: duplicate mapping key ${key}`,
      );
    }
    frame.keys.add(key);
  }
}

function parseAndValidateFrontmatter(document: string): string {
  const { yaml, body } = extractFrontmatter(document);
  assertNoDuplicateYamlMappingKeys(yaml, "frontmatter");
  if (!same(yaml.split("\n"), expectedFrontmatterLines)) {
    throw new Error("frontmatter line format, key order, or value mismatch");
  }
  const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
  if (
    !same(Object.keys(parsed), ["name", "description", "user_invocable"])
  ) {
    throw new Error("frontmatter schema mismatch");
  }
  if (!same(parsed, expectedFrontmatter)) {
    throw new Error("frontmatter value mismatch");
  }
  if (
    parsed.name !== "fleet-skill-normalization" ||
    !/^[\x00-\x7f]+$/.test(parsed.name)
  ) {
    throw new Error("frontmatter name is not the exact ASCII identity");
  }
  return body;
}

function section(document: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.match(
    new RegExp(
      `^## ${escaped}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
      "m",
    ),
  );
  if (!match) {
    throw new Error(`missing section: ${name}`);
  }
  return match[1];
}

function safetyContractYamlBlocks(document: string): string[] {
  const blocks: string[] = [];
  let currentSection: string | undefined;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let captured: string[] | undefined;

  for (const line of document.split("\n")) {
    if (!fence) {
      const heading = line.match(/^## ([^\n]+)$/);
      if (heading) {
        currentSection = heading[1];
        continue;
      }
      const opening = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
      if (!opening) continue;
      const run = opening[2];
      const marker = run[0] as "`" | "~";
      const info = opening[3];
      if (marker === "`" && info.includes("`")) continue;
      fence = { marker, length: run.length };
      if (
        currentSection === "Safety Contract" &&
        line === "```yaml"
      ) {
        captured = [];
      }
      continue;
    }

    const closing = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
    if (
      closing &&
      closing[2][0] === fence.marker &&
      closing[2].length >= fence.length
    ) {
      if (captured) blocks.push(captured.join("\n"));
      captured = undefined;
      fence = undefined;
    } else if (captured) {
      captured.push(line);
    }
  }
  return blocks;
}

function parseSafetyContract(document: string): SafetyContract {
  const { body } = extractFrontmatter(document);
  const liveDocument = stripHtmlComments(body);
  const blocks = safetyContractYamlBlocks(liveDocument);
  if (blocks.length !== 1) {
    throw new Error("expected exactly one live safety contract YAML block");
  }
  assertNoDuplicateYamlMappingKeys(blocks[0], "safety contract");
  return Bun.YAML.parse(blocks[0]) as SafetyContract;
}

function canonicalClauseLine(id: string, clause: Clause): string {
  return `- [${id}/${clause.effect}/${clause.key}] ${clause.text}`;
}

function safeLine(fixture: (typeof safeNearMisses)[number]): string {
  return `- [SAFE/${fixture.id}/${fixture.key}] ${fixture.text}`;
}

function workflowLine(step: WorkflowStep, index: number): string {
  return `${index + 1}. [STEP/${step.id}] ${step.text}`;
}

function violationInvariant(violation: string): string {
  return violation.split(":")[0] ?? violation;
}

function classifyUnknownLine(line: string): string {
  const operative = line.trimStart();
  const canonical = operative.match(
    /^- \[(SFN-[A-Z-]+-v1)\/(?:require|deny)\/[a-z0-9_]+\]/,
  );
  if (canonical) {
    return `${canonical[1]}: unregistered, duplicate, or altered live clause`;
  }
  const safe = operative.match(
    /^- \[SAFE\/(SFN-[A-Z-]+-v1)\/[a-z0-9_]+\]/,
  );
  if (safe) {
    return `${safe[1]}: unregistered, duplicate, or altered safe near-miss`;
  }
  if (/^\d+\. \[STEP\//.test(operative)) {
    return "SFN-RUN-STATE-MACHINE-v1: unregistered or altered workflow step";
  }
  return "SFN-NORMATIVE-LANGUAGE-v1: unregistered live content";
}

function stripFencedBlocks(document: string): string {
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | undefined;
  for (const line of document.split("\n")) {
    if (!fence) {
      const opening = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
      if (!opening) {
        output.push(line);
        continue;
      }
      const run = opening[2];
      const marker = run[0] as "`" | "~";
      const info = opening[3];
      if (marker === "`" && info.includes("`")) {
        output.push(line);
        continue;
      }
      fence = { marker, length: run.length };
      continue;
    }

    const closing = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
    if (
      closing &&
      closing[2][0] === fence.marker &&
      closing[2].length >= fence.length
    ) {
      fence = undefined;
    }
  }
  if (fence) {
    output.push("SFN-UNTERMINATED-FENCED-CONTENT");
  }
  return output.join("\n");
}

function significantLines(lines: string[]): string[] {
  return lines.filter((line) => line.length > 0);
}

function splitLiveSections(document: string): {
  preamble: string[];
  sections: Array<{ name: string; lines: string[] }>;
} {
  const preamble: string[] = [];
  const sections: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } | undefined;
  for (const line of document.split("\n")) {
    const heading = line.match(/^## ([^\n]+)$/);
    if (heading) {
      current = { name: heading[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

function validateRegisteredSequence(
  actualInput: string[],
  expectedInput: readonly string[],
  defaultViolation: string,
): string[] {
  const violations: string[] = [];
  const actual = significantLines(actualInput);
  const expected = [...expectedInput];
  const registered = new Set(expected);

  for (const line of expected) {
    const count = actual.filter((candidate) => candidate === line).length;
    if (count !== 1) {
      const classified = classifyUnknownLine(line);
      violations.push(
        classified.startsWith("SFN-NORMATIVE-LANGUAGE-v1:")
          ? `${defaultViolation}: registered line count is ${count}`
          : classified,
      );
    }
  }

  const registeredOrder = actual.filter((line) => registered.has(line));
  if (
    registeredOrder.length === expected.length &&
    !same(registeredOrder, expected)
  ) {
    for (const [index, line] of registeredOrder.entries()) {
      if (line !== expected[index]) {
        const classified = classifyUnknownLine(line);
        violations.push(
          classified.startsWith("SFN-NORMATIVE-LANGUAGE-v1:")
            ? `${defaultViolation}: registered line order mismatch`
            : classified,
        );
      }
    }
  }

  for (const line of actual) {
    if (!registered.has(line)) {
      const classified = classifyUnknownLine(line);
      violations.push(
        classified.startsWith("SFN-NORMATIVE-LANGUAGE-v1:")
          ? `${defaultViolation}: unexpected live content`
          : classified,
      );
    }
  }
  return violations;
}

function validateLiveMarkdown(
  document: string,
  contract: SafetyContract,
): string[] {
  const violations: string[] = [];
  const { body } = extractFrontmatter(document);
  const live = stripFencedBlocks(stripHtmlComments(body));
  const layout = splitLiveSections(live);
  const canonicalLines = contract.invariants.flatMap((invariant) =>
    invariant.clauses.map((clause) =>
      canonicalClauseLine(invariant.id, clause),
    ),
  );
  const workflowLines = contract.workflow.steps.map(workflowLine);
  const safeLines = safeNearMisses.map(safeLine);

  violations.push(
    ...validateRegisteredSequence(
      layout.preamble,
      expectedPreambleLines,
      "SFN-NORMATIVE-LANGUAGE-v1",
    ),
  );

  const sectionNames = layout.sections.map(({ name }) => name);
  if (!same(sectionNames, expectedSectionNames)) {
    violations.push(
      "SFN-NORMATIVE-LANGUAGE-v1: section set or order mismatch",
    );
  }
  const uniqueSection = (name: string): string[] => {
    const matches = layout.sections.filter(
      (candidate) => candidate.name === name,
    );
    return matches.length === 1 ? matches[0].lines : [];
  };

  violations.push(
    ...validateRegisteredSequence(
      uniqueSection("Contract Interpretation"),
      expectedContractInterpretationLines,
      "SFN-NORMATIVE-LANGUAGE-v1",
    ),
    ...validateRegisteredSequence(
      uniqueSection("Safety Contract"),
      [],
      "SFN-NORMATIVE-LANGUAGE-v1",
    ),
    ...validateRegisteredSequence(
      uniqueSection("Canonical Normative Clauses"),
      canonicalLines,
      "SFN-NORMATIVE-LANGUAGE-v1",
    ),
    ...validateRegisteredSequence(
      uniqueSection("Finite Workflow"),
      workflowLines,
      "SFN-RUN-STATE-MACHINE-v1",
    ),
    ...validateRegisteredSequence(
      uniqueSection("Safe Near-Misses"),
      safeLines,
      "SFN-NORMATIVE-LANGUAGE-v1",
    ),
  );

  return violations;
}

function validateStructuredContract(contract: SafetyContract): string[] {
  const violations: string[] = [];
  if (
    !same(Object.keys(contract), [
      "version",
      "normative_language",
      "identity",
      "state_root",
      "artifact_encoding",
      "artifacts",
      "run_state_machine",
      "target_state_machine",
      "recovery",
      "workflow",
      "invariants",
    ])
  ) {
    violations.push("SAFETY-CONTRACT: top-level schema mismatch");
  }
  if (contract.version !== "skills-fleet-normalization-semantic-v2") {
    violations.push("SAFETY-CONTRACT: wrong contract version");
  }
  if (!same(contract.normative_language, expectedNormativeLanguage)) {
    violations.push(
      "SFN-NORMATIVE-LANGUAGE-v1: normative-language schema mismatch",
    );
  }
  if (!same(contract.identity, expectedIdentity)) {
    violations.push(
      "SFN-DESTINATION-UNIQUENESS-v1: identity schema mismatch",
    );
  }

  if (
    contract.state_root?.receipt_persistence_requires_receipt !==
      expectedStateRoot.receipt_persistence_requires_receipt ||
    contract.state_root?.persistence_base_case !==
      expectedStateRoot.persistence_base_case
  ) {
    violations.push(
      "SFN-RECEIPT-FINITENESS-v1: receipt persistence base case mismatch",
    );
  }
  if (
    contract.state_root?.lifecycle_authority !==
      expectedStateRoot.lifecycle_authority
  ) {
    violations.push(
      "SFN-RUN-STATE-MACHINE-v1: lifecycle authority mismatch",
    );
  }
  const stateRootWithoutBaseCase = { ...contract.state_root };
  delete stateRootWithoutBaseCase.receipt_persistence_requires_receipt;
  delete stateRootWithoutBaseCase.persistence_base_case;
  delete stateRootWithoutBaseCase.lifecycle_authority;
  const expectedStateRootWithoutBaseCase = { ...expectedStateRoot };
  delete (
    expectedStateRootWithoutBaseCase as Partial<typeof expectedStateRoot>
  ).receipt_persistence_requires_receipt;
  delete (
    expectedStateRootWithoutBaseCase as Partial<typeof expectedStateRoot>
  ).persistence_base_case;
  delete (
    expectedStateRootWithoutBaseCase as Partial<typeof expectedStateRoot>
  ).lifecycle_authority;
  if (!same(stateRootWithoutBaseCase, expectedStateRootWithoutBaseCase)) {
    violations.push(
      "SFN-RUN-PATH-EXCLUSIVITY-v1: external run-state schema mismatch",
    );
  }

  if (!same(contract.artifacts, expectedArtifacts)) {
    violations.push("SFN-ARTIFACT-SCHEMAS-v1: artifact schema mismatch");
  }
  if (!same(contract.artifact_encoding, expectedArtifactEncoding)) {
    violations.push(
      "SFN-ARTIFACT-SCHEMAS-v1: artifact encoding mismatch",
    );
  }
  if (!same(contract.run_state_machine, expectedRunStateMachine)) {
    violations.push(
      "SFN-RUN-STATE-MACHINE-v1: run transition or aggregation mismatch",
    );
  }
  if (!same(contract.target_state_machine, expectedTargetStateMachine)) {
    violations.push(
      "SFN-RUN-STATE-MACHINE-v1: target transition mismatch",
    );
  }
  if (!same(contract.recovery, expectedRecovery)) {
    violations.push("SFN-RUN-STATE-MACHINE-v1: recovery schema mismatch");
  }
  if (!same(contract.workflow, expectedWorkflow)) {
    violations.push("SFN-RUN-STATE-MACHINE-v1: workflow schema mismatch");
  }

  const actualIds = contract.invariants?.map((invariant) => invariant.id) ?? [];
  if (!same(actualIds, invariantIds)) {
    violations.push("SAFETY-CONTRACT: invariant ID/order mismatch");
  }

  const byId = new Map(
    (contract.invariants ?? []).map((invariant) => [
      invariant.id,
      invariant,
    ]),
  );
  for (const id of invariantIds) {
    const invariant = byId.get(id);
    const spec = invariantSpecs[id];
    if (!invariant) {
      violations.push(`${id}: missing structured invariant`);
      continue;
    }
    if (
      !same(Object.keys(invariant), [
        "id",
        "require",
        "deny",
        "clauses",
      ])
    ) {
      violations.push(`${id}: invariant schema mismatch`);
    }
    if (!same(invariant.require, spec.require)) {
      violations.push(`${id}: require-key set/order mismatch`);
    }
    if (!same(invariant.deny, spec.deny)) {
      violations.push(`${id}: deny-key set/order mismatch`);
    }
    const actualClauseKeys = invariant.clauses?.map((clause) => clause.key);
    if (!same(actualClauseKeys, Object.keys(spec.clauses))) {
      violations.push(`${id}: clause-key set/order mismatch`);
      continue;
    }
    for (const clause of invariant.clauses) {
      if (!same(Object.keys(clause), ["key", "effect", "text"])) {
        violations.push(`${id}: clause schema mismatch ${clause.key}`);
      }
      const expectedHash = spec.clauses[clause.key];
      if (!expectedHash || hashClause(clause) !== expectedHash) {
        violations.push(`${id}: structured clause mismatch ${clause.key}`);
      }
      if (clause.effect !== "require" && clause.effect !== "deny") {
        violations.push(`${id}: invalid clause effect ${clause.key}`);
      }
    }
  }
  return violations;
}

function validateContract(document: string): string[] {
  try {
    parseAndValidateFrontmatter(document);
  } catch (error) {
    return [`SKILL-FRONTMATTER: ${String(error)}`];
  }
  let contract: SafetyContract;
  try {
    contract = parseSafetyContract(document);
  } catch (error) {
    return [`SAFETY-CONTRACT: ${String(error)}`];
  }
  return [
    ...validateStructuredContract(contract),
    ...validateLiveMarkdown(document, contract),
  ];
}

function appendToSection(
  document: string,
  sectionName: string,
  line: string,
): string {
  const heading = `## ${sectionName}`;
  const headingIndex = document.indexOf(heading);
  if (headingIndex < 0) {
    throw new Error(`missing section for fixture: ${sectionName}`);
  }
  const nextHeading = document.indexOf("\n## ", headingIndex + heading.length);
  const insertionIndex = nextHeading < 0 ? document.length : nextHeading;
  return `${document.slice(0, insertionIndex).trimEnd()}\n${line}\n\n${document
    .slice(insertionIndex)
    .trimStart()}`;
}

function taggedUnsafe(
  id: InvariantId,
  effect: Effect,
  key: string,
  text: string,
): string {
  return `- [${id}/${effect}/${key}] ${text}`;
}

function expectOnlyInvariant(
  candidate: string,
  expected: InvariantId,
  label: string,
): void {
  const violations = validateContract(candidate);
  expect(violations.length, `validator accepted ${label}`).toBeGreaterThan(0);
  expect(
    [...new Set(violations.map(violationInvariant))],
    `validator misclassified ${label}: ${violations.join(" | ")}`,
  ).toEqual([expected]);
}

type SourceSelection = {
  sourceRecordId: string;
  parsedName: string;
  normalizedIdentity: string;
  destinationBasename: string;
};

type DestinationSelection = {
  sourceRecordId: string;
  normalizedIdentity: string;
  destinationBasename: string;
  machineId: string;
  skillsRootIdentity: string;
  lexicalDestinationPath: string;
  canonicalDestinationPath: string;
};

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function validateSelection(
  sources: SourceSelection[],
  destinations: DestinationSelection[],
): string[] {
  const violations: string[] = [];
  const identityPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  for (const source of sources) {
    if (
      !identityPattern.test(source.normalizedIdentity) ||
      source.parsedName !== source.normalizedIdentity ||
      source.destinationBasename !== source.normalizedIdentity
    ) {
      violations.push(
        "SFN-DESTINATION-UNIQUENESS-v1: noncanonical source identity",
      );
    }
  }
  for (const key of [
    sources.map((source) => source.sourceRecordId),
    sources.map((source) => source.parsedName),
    sources.map((source) => source.normalizedIdentity),
    sources.map((source) => source.destinationBasename),
  ]) {
    if (duplicateValues(key).length > 0) {
      violations.push(
        "SFN-DESTINATION-UNIQUENESS-v1: duplicate selected-source identity",
      );
    }
  }

  const knownSources = new Map(
    sources.map((source) => [source.sourceRecordId, source]),
  );
  for (const destination of destinations) {
    const source = knownSources.get(destination.sourceRecordId);
    if (
      !source ||
      destination.normalizedIdentity !== source.normalizedIdentity ||
      destination.destinationBasename !== source.destinationBasename
    ) {
      violations.push(
        "SFN-DESTINATION-UNIQUENESS-v1: destination/source identity mismatch",
      );
    }
  }
  const expandedKeys = [
    destinations.map(
      (destination) =>
        `${destination.machineId}|${destination.skillsRootIdentity}|${destination.destinationBasename}`,
    ),
    destinations.map((destination) => destination.lexicalDestinationPath),
    destinations.map((destination) => destination.canonicalDestinationPath),
  ];
  for (const key of expandedKeys) {
    if (duplicateValues(key).length > 0) {
      violations.push(
        "SFN-DESTINATION-UNIQUENESS-v1: duplicate expanded destination",
      );
    }
  }
  return violations;
}

const validSources: SourceSelection[] = [
  {
    sourceRecordId: "source-a",
    parsedName: "alpha-skill",
    normalizedIdentity: "alpha-skill",
    destinationBasename: "alpha-skill",
  },
  {
    sourceRecordId: "source-b",
    parsedName: "beta-skill",
    normalizedIdentity: "beta-skill",
    destinationBasename: "beta-skill",
  },
];

const validDestinations: DestinationSelection[] = [
  {
    sourceRecordId: "source-a",
    normalizedIdentity: "alpha-skill",
    destinationBasename: "alpha-skill",
    machineId: "machine-1",
    skillsRootIdentity: "root-1",
    lexicalDestinationPath: "/roots/one/alpha-skill",
    canonicalDestinationPath: "/roots/one/alpha-skill",
  },
  {
    sourceRecordId: "source-a",
    normalizedIdentity: "alpha-skill",
    destinationBasename: "alpha-skill",
    machineId: "machine-2",
    skillsRootIdentity: "root-2",
    lexicalDestinationPath: "/roots/two/alpha-skill",
    canonicalDestinationPath: "/roots/two/alpha-skill",
  },
  {
    sourceRecordId: "source-b",
    normalizedIdentity: "beta-skill",
    destinationBasename: "beta-skill",
    machineId: "machine-1",
    skillsRootIdentity: "root-1",
    lexicalDestinationPath: "/roots/one/beta-skill",
    canonicalDestinationPath: "/roots/one/beta-skill",
  },
];

const unsafeClauseFixtures = [
  {
    label: "displaced root permission moved outside containment section",
    section: "Finite Workflow",
    id: "SFN-ROOT-CONTAINMENT-v1",
    effect: "deny",
    key: "root_escape",
    text: "Use of a displaced root for child mutation after admission is permitted.",
  },
  {
    label: "displaced root permission masked by unrelated negation",
    section: "Canonical Normative Clauses",
    id: "SFN-ROOT-CONTAINMENT-v1",
    effect: "deny",
    key: "root_escape",
    text: "A displaced root may continue serving writes, but audit logging is not optional.",
  },
  {
    label: "existing selected directory redirect allowed",
    section: "Finite Workflow",
    id: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
    effect: "deny",
    key: "no_redirect",
    text: "A displaced existing selected directory is allowed to redirect mutation.",
  },
  {
    label: "run-created selected directory redirect may continue",
    section: "Safe Near-Misses",
    id: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
    effect: "deny",
    key: "no_redirect",
    text: "A replaced run-created selected directory may redirect mutation.",
  },
  {
    label: "nearby pre-check considered sufficient",
    section: "Contract Interpretation",
    id: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
    effect: "deny",
    key: "no_precheck_gap",
    text: "A pre-check followed by later mutation can be sufficient.",
  },
  {
    label: "hard-linked target fit for continued writes",
    section: "Finite Workflow",
    id: "SFN-CHILD-IDENTITY-v1",
    effect: "deny",
    key: "invalid_child",
    text: "A hard-linked target is fit for continued writes after admission.",
  },
  {
    label: "child identity checks advisory",
    section: "Canonical Normative Clauses",
    id: "SFN-CHILD-IDENTITY-v1",
    effect: "deny",
    key: "invalid_child",
    text: "Child identity, link, type, and hash revalidation is optional or advisory.",
  },
  {
    label: "outside allowlist touch permitted",
    section: "Finite Workflow",
    id: "SFN-TOUCHED-LEDGER-v1",
    effect: "deny",
    key: "outside_touch",
    text: "Paths outside the exact allowlist may be touched.",
  },
  {
    label: "pre-existing run state reusable",
    section: "Safe Near-Misses",
    id: "SFN-RUN-PATH-EXCLUSIVITY-v1",
    effect: "deny",
    key: "state_path_reuse",
    text: "Pre-existing run-owned temporary, preimage, and receipt paths may be reused.",
  },
  {
    label: "rollback changed state",
    section: "Finite Workflow",
    id: "SFN-ROLLBACK-v1",
    effect: "deny",
    key: "rollback_drift",
    text: "Rollback may remove changed or non-owned state.",
  },
  {
    label: "source proof best effort",
    section: "Contract Interpretation",
    id: "SFN-SOURCE-PROVENANCE-v1",
    effect: "deny",
    key: "moving_source",
    text: "Source commit and hash provenance may be best-effort.",
  },
  {
    label: "byte rendering best effort",
    section: "Finite Workflow",
    id: "SFN-DETERMINISTIC-RENDERING-v1",
    effect: "deny",
    key: "rendering_weakening",
    text: "Byte-exact rendering is allowed to be best-effort.",
  },
  {
    label: "secret scan prints matches",
    section: "Contract Interpretation",
    id: "SFN-SECRET-SCAN-v1",
    effect: "deny",
    key: "scan_gate",
    text: "Secret scanning may print matches.",
  },
  {
    label: "secret scan skipped",
    section: "Finite Workflow",
    id: "SFN-SECRET-SCAN-v1",
    effect: "deny",
    key: "scan_gate",
    text: "Secret scanning can be skipped.",
  },
  {
    label: "coordinator repository mutation",
    section: "Safe Near-Misses",
    id: "SFN-COORDINATOR-SEPARATION-v1",
    effect: "deny",
    key: "prohibited_roles",
    text: "The coordinator may perform the worker's repository mutation.",
  },
  {
    label: "source worktree mutation exemption",
    section: "Finite Workflow",
    id: "SFN-SOURCE-PROVENANCE-v1",
    effect: "deny",
    key: "source_repository_read_only",
    text: "The assigned source repository worktree is exempt and may be mutated.",
  },
] satisfies Array<{
  label: string;
  section: string;
  id: InvariantId;
  effect: Effect;
  key: string;
  text: string;
}>;

const structuredMutationFixtures = [
  {
    label: "receipt creation requires a recursive receipt",
    id: "SFN-RECEIPT-FINITENESS-v1",
    mutate: (document: string) =>
      document.replace(
        "  receipt_persistence_requires_receipt: false",
        "  receipt_persistence_requires_receipt: true",
      ),
  },
  {
    label: "operational state placed under live skill directories",
    id: "SFN-RUN-PATH-EXCLUSIVITY-v1",
    mutate: (document: string) =>
      document.replace(
        "  relation_to_live_skills: neither_ancestor_nor_descendant",
        "  relation_to_live_skills: inside_selected_live_skill_directory",
      ),
  },
  {
    label: "interrupted apply omits recovery transition",
    id: "SFN-RUN-STATE-MACHINE-v1",
    mutate: (document: string) =>
      document.replace(
        "    apply_interrupted:\n      - recovery_pending",
        "    apply_interrupted: []",
      ),
  },
  {
    label: "mixed outcome omits rollback transition",
    id: "SFN-RUN-STATE-MACHINE-v1",
    mutate: (document: string) =>
      document.replace(
        "    mixed_outcome:\n      - recovery_pending\n      - rollback_pending",
        "    mixed_outcome:\n      - recovery_pending",
      ),
  },
  {
    label: "partition recovery permits forward mutation",
    id: "SFN-RUN-STATE-MACHINE-v1",
    mutate: (document: string) =>
      document.replace(
        "  machine_partition_policy: remain_recovery_pending_without_new_forward_mutation",
        "  machine_partition_policy: resume_forward_mutation_best_effort",
      ),
  },
  {
    label: "failure artifact drops recovery identity field",
    id: "SFN-ARTIFACT-SCHEMAS-v1",
    mutate: (document: string) =>
      document.replace("      - recovery_requirement\n", ""),
  },
  {
    label: "run-transition receipt drops declared run state",
    id: "SFN-ARTIFACT-SCHEMAS-v1",
    mutate: (document: string) =>
      document.replace("      - run_state_to\n", ""),
  },
] satisfies Array<{
  label: string;
  id: InvariantId;
  mutate: (document: string) => string;
}>;

const requiredSectionLine = skill
  .split("\n")
  .find((line) =>
    line.startsWith("- [SFN-ROOT-CONTAINMENT-v1/deny/root_escape]"),
  );
if (!requiredSectionLine) {
  throw new Error("missing canonical root-containment clause");
}

const terminalRepairFixtures = [
  {
    label: "duplicate top-level YAML key with equal values",
    violation: "SAFETY-CONTRACT",
    mutate: (document: string) =>
      document.replace(
        "version: skills-fleet-normalization-semantic-v2\nnormative_language:",
        "version: skills-fleet-normalization-semantic-v2\nversion: skills-fleet-normalization-semantic-v2\nnormative_language:",
      ),
  },
  {
    label: "duplicate nested YAML key with equal values",
    violation: "SAFETY-CONTRACT",
    mutate: (document: string) =>
      document.replace(
        "  html_comments: stripped_as_non_operative\n",
        "  html_comments: stripped_as_non_operative\n  html_comments: stripped_as_non_operative\n",
      ),
  },
  {
    label: "required clause moved to Safe Near-Misses",
    violation: "SFN-ROOT-CONTAINMENT-v1",
    mutate: (document: string) =>
      appendToSection(
        document.replace(`${requiredSectionLine}\n`, ""),
        "Safe Near-Misses",
        requiredSectionLine,
      ),
  },
  {
    label: "required clause indented into a nested list",
    violation: "SFN-ROOT-CONTAINMENT-v1",
    mutate: (document: string) =>
      document.replace(
        `${requiredSectionLine}\n`,
        `  ${requiredSectionLine}\n`,
      ),
  },
  {
    label: "required clause duplicated across sections",
    violation: "SFN-ROOT-CONTAINMENT-v1",
    mutate: (document: string) =>
      appendToSection(document, "Safe Near-Misses", requiredSectionLine),
  },
  {
    label: "Unicode-confusable frontmatter name",
    violation: "SKILL-FRONTMATTER",
    mutate: (document: string) =>
      document.replace(
        "name: fleet-skill-normalization",
        "name: fleet-skіll-normalization",
      ),
  },
  {
    label: "duplicate frontmatter key with equal values",
    violation: "SKILL-FRONTMATTER",
    mutate: (document: string) =>
      document.replace(
        "name: fleet-skill-normalization\n",
        "name: fleet-skill-normalization\nname: fleet-skill-normalization\n",
      ),
  },
  {
    label: "unknown frontmatter key",
    violation: "SKILL-FRONTMATTER",
    mutate: (document: string) =>
      document.replace(
        "user_invocable: true\n",
        "user_invocable: true\nfrontmatter_extra: deny\n",
      ),
  },
  {
    label: "unknown structured field",
    violation: "SAFETY-CONTRACT",
    mutate: (document: string) =>
      document.replace(
        "version: skills-fleet-normalization-semantic-v2\n",
        "version: skills-fleet-normalization-semantic-v2\nunknown_contract_field: deny\n",
      ),
  },
] satisfies Array<{
  label: string;
  violation: string;
  mutate: (document: string) => string;
}>;

const htmlCommentMutation = (() => {
  const liveLine = skill
    .split("\n")
    .find((line) =>
      line.startsWith(
        "- [SFN-ROOT-CONTAINMENT-v1/deny/root_escape]",
      ),
    );
  if (!liveLine) throw new Error("missing root containment line");
  return skill.replace(
    liveLine,
    `<!-- ${liveLine} -->\n${taggedUnsafe(
      "SFN-ROOT-CONTAINMENT-v1",
      "deny",
      "root_escape",
      "A displaced root is acceptable for continued destination writes.",
    )}`,
  );
})();

const controlledUnsafeDocument =
  process.env.FLEET_CONTRACT_CONTROLLED_UNSAFE === "1"
    ? appendToSection(
        skill,
        "Finite Workflow",
        taggedUnsafe(
          "SFN-COORDINATOR-SEPARATION-v1",
          "deny",
          "prohibited_roles",
          "The coordinator may perform the worker's repository mutation.",
        ),
      )
    : skill;

describe("fleet-skill-normalization semantic safety contract", () => {
  test("the unmodified skill has a complete exact structured contract", () => {
    const contract = parseSafetyContract(skill);
    expect(contract.version).toBe(
      "skills-fleet-normalization-semantic-v2",
    );
    expect(contract.invariants.map((invariant) => invariant.id)).toEqual([
      ...invariantIds,
    ]);
    expect(contract.artifacts.map((artifact) => artifact.version)).toEqual(
      expectedArtifacts.map((artifact) => artifact.version),
    );
    expect(validateContract(controlledUnsafeDocument)).toEqual([]);
  });

  test("all live normative content is comment-stripped and globally registered", () => {
    const contract = parseSafetyContract(skill);
    expect(contract.normative_language).toEqual(expectedNormativeLanguage);
    expect(
      contract.invariants.flatMap((invariant) => invariant.clauses).length,
    ).toBeGreaterThan(40);
    expect(validateLiveMarkdown(skill, contract)).toEqual([]);
  });

  test("unsafe permission is rejected in every section and with every required modal variant", () => {
    for (const fixture of unsafeClauseFixtures) {
      const candidate = appendToSection(
        skill,
        fixture.section,
        taggedUnsafe(
          fixture.id,
          fixture.effect,
          fixture.key,
          fixture.text,
        ),
      );
      expectOnlyInvariant(candidate, fixture.id, fixture.label);
    }
  });

  test("HTML-comment shadowing cannot supply required behavior or hide weakening", () => {
    expectOnlyInvariant(
      htmlCommentMutation,
      "SFN-ROOT-CONTAINMENT-v1",
      "required root denial hidden in HTML comment",
    );
  });

  test("non-operative fenced examples are stripped rather than treated as live permission", () => {
    const fencedExample = appendToSection(
      skill,
      "Finite Workflow",
      "```text\nA displaced root may continue serving writes.\n```",
    );
    expect(validateContract(fencedExample)).toEqual([]);
    const tildeFencedExample = appendToSection(
      skill,
      "Finite Workflow",
      "~~~text\nA displaced root may continue serving writes.\n~~~",
    );
    expect(validateContract(tildeFencedExample)).toEqual([]);
    const headingFencedExample = appendToSection(
      skill,
      "Finite Workflow",
      "````text\n## Safety Contract\n```yaml\nversion: shadow\n```\n````",
    );
    expect(validateContract(headingFencedExample)).toEqual([]);

    const fencedRequiredOnly = appendToSection(
      skill.replace(`${requiredSectionLine}\n`, ""),
      "Canonical Normative Clauses",
      `\`\`\`text\n${requiredSectionLine}\n\`\`\``,
    );
    expectOnlyInvariant(
      fencedRequiredOnly,
      "SFN-ROOT-CONTAINMENT-v1",
      "required clause preserved only in a fenced example",
    );
  });

  test("the YAML pre-parser rejects deep duplicates and alternate mapping syntax before Bun parsing", () => {
    expect(() =>
      assertNoDuplicateYamlMappingKeys(
        "items:\n  - name: one\n    name: one",
        "deep fixture",
      ),
    ).toThrow(/duplicate mapping key name/);
    expect(() =>
      assertNoDuplicateYamlMappingKeys(
        '"name": one\n"name": one',
        "quoted-key fixture",
      ),
    ).toThrow(/unsupported YAML mapping syntax/);
    expect(() =>
      assertNoDuplicateYamlMappingKeys(
        "root: {name: one, name: one}",
        "flow fixture",
      ),
    ).toThrow(/unsupported flow/);
    expect(() =>
      assertNoDuplicateYamlMappingKeys(
        "root: &shared\n  name: one",
        "anchor fixture",
      ),
    ).toThrow(/unsupported flow/);
  });

  test("structured receipt, state-root, recovery, and artifact mutations fail their owning invariant", () => {
    for (const fixture of structuredMutationFixtures) {
      const candidate = fixture.mutate(skill);
      expect(candidate, `fixture did not mutate: ${fixture.label}`).not.toBe(
        skill,
      );
      expectOnlyInvariant(candidate, fixture.id, fixture.label);
    }
  });

  for (const fixture of terminalRepairFixtures) {
    test(`terminal repair rejects ${fixture.label}`, () => {
      const candidate = fixture.mutate(skill);
      expect(candidate, `fixture did not mutate: ${fixture.label}`).not.toBe(
        skill,
      );
      const violations = validateContract(candidate);
      expect(
        violations.length,
        `validator accepted ${fixture.label}`,
      ).toBeGreaterThan(0);
      expect(
        [...new Set(violations.map(violationInvariant))],
        `validator misclassified ${fixture.label}: ${violations.join(" | ")}`,
      ).toEqual([fixture.violation]);
    });
  }

  test("each major rule accepts its exact positive near-miss in the operative safe section", () => {
    const safeSection = section(
      stripHtmlComments(extractFrontmatter(skill).body),
      "Safe Near-Misses",
    );
    for (const fixture of safeNearMisses) {
      const line = safeLine(fixture);
      expect(safeSection.split("\n")).toContain(line);
    }
    expect(validateContract(skill)).toEqual([]);
  });

  test("source identity and destination path collisions reject the complete set before apply", () => {
    expect(validateSelection(validSources, validDestinations)).toEqual([]);

    const selectionFixtures: Array<{
      label: string;
      sources: SourceSelection[];
      destinations: DestinationSelection[];
    }> = [
      {
        label: "duplicate parsed frontmatter identity and basename",
        sources: [
          validSources[0],
          {
            sourceRecordId: "source-c",
            parsedName: "alpha-skill",
            normalizedIdentity: "alpha-skill",
            destinationBasename: "alpha-skill",
          },
        ],
        destinations: validDestinations,
      },
      {
        label: "duplicate machine-root destination collision key",
        sources: validSources,
        destinations: [
          validDestinations[0],
          {
            ...validDestinations[2],
            lexicalDestinationPath: "/roots/one/other-beta-path",
            canonicalDestinationPath: "/roots/one/other-beta-path",
            destinationBasename: "alpha-skill",
            normalizedIdentity: "alpha-skill",
            sourceRecordId: "source-a",
          },
        ],
      },
      {
        label: "duplicate canonical destination path",
        sources: validSources,
        destinations: [
          validDestinations[0],
          {
            ...validDestinations[2],
            canonicalDestinationPath:
              validDestinations[0].canonicalDestinationPath,
          },
        ],
      },
    ];

    for (const fixture of selectionFixtures) {
      const violations = validateSelection(
        fixture.sources,
        fixture.destinations,
      );
      expect(
        violations.length,
        `collision fixture accepted: ${fixture.label}`,
      ).toBeGreaterThan(0);
      expect([...new Set(violations.map(violationInvariant))]).toEqual([
        "SFN-DESTINATION-UNIQUENESS-v1",
      ]);
    }
  });

  test("finite state machines cover interrupted, partitioned, mixed, rollback, and terminal outcomes", () => {
    const contract = parseSafetyContract(skill);
    expect(contract.run_state_machine).toEqual(expectedRunStateMachine);
    expect(contract.target_state_machine).toEqual(
      expectedTargetStateMachine,
    );
    expect(contract.recovery).toEqual(expectedRecovery);
    expect(
      (
        contract.run_state_machine.transitions as Record<string, string[]>
      ).mixed_outcome,
    ).toContain("rollback_pending");
    expect(
      (
        contract.run_state_machine.transitions as Record<string, string[]>
      ).apply_interrupted,
    ).toEqual(["recovery_pending"]);
    expect(
      (
        contract.target_state_machine.transitions as Record<
          string,
          string[]
        >
      ).unreachable_unknown,
    ).toEqual(["recovery_pending"]);

    const runTransitionReceipt = contract.artifacts.find(
      ({ name }) => name === "run_transition_receipt",
    );
    const targetTransitionReceipt = contract.artifacts.find(
      ({ name }) => name === "target_transition_receipt",
    );
    expect(runTransitionReceipt?.required_fields).toContain(
      "run_state_from",
    );
    expect(runTransitionReceipt?.required_fields).toContain("run_state_to");
    expect(targetTransitionReceipt?.required_fields).toContain(
      "target_state_from",
    );
    expect(targetTransitionReceipt?.required_fields).toContain(
      "target_state_to",
    );
    expect(targetTransitionReceipt?.required_fields).toContain(
      "transition_evidence_sha256",
    );
    expect(
      contract.artifacts.find(({ name }) => name === "apply_receipt")
        ?.required_fields,
    ).not.toContain("target_transition_receipt_sha256");
    expect(
      contract.artifacts.find(({ name }) => name === "rollback_receipt")
        ?.required_fields,
    ).not.toContain("target_transition_receipt_sha256");
    const runEdges = Object.values(
      contract.run_state_machine.transitions as Record<string, string[]>,
    ).flat();
    const targetEdges = Object.values(
      contract.target_state_machine.transitions as Record<string, string[]>,
    ).flat();
    expect(runEdges.length).toBeGreaterThan(0);
    expect(targetEdges.length).toBeGreaterThan(0);
    expect(contract.artifact_encoding.transition_receipt_rule).toBe(
      "every_enumerated_run_and_target_edge_has_exactly_one_matching_transition_receipt",
    );
    expect(contract.artifact_encoding.mutation_receipt_rule).toBe(
      "apply_and_rollback_receipts_are_immediately_followed_and_bound_by_the_corresponding_target_transition_receipt",
    );
  });

  test("mutation allowlisting does not contradict provenance-bound immutable source reads", () => {
    const contract = parseSafetyContract(skill);
    const touchedLedger = contract.invariants.find(
      ({ id }) => id === "SFN-TOUCHED-LEDGER-v1",
    );
    const sourceProvenance = contract.invariants.find(
      ({ id }) => id === "SFN-SOURCE-PROVENANCE-v1",
    );
    expect(
      sourceProvenance?.clauses.find(
        ({ key }) => key === "source_repository_read_only",
      )?.text,
    ).toContain("may read the repository-tracked source");
    expect(
      touchedLedger?.clauses.find(({ key }) => key === "exact_allowlist")
        ?.text,
    ).toContain("immutable source reads are separately provenance-bound");
    expect(
      touchedLedger?.clauses.find(({ key }) => key === "outside_touch")
        ?.text,
    ).not.toMatch(/^Any read,/);
  });

  test("README registers only the bounded Codewith workflow without live distribution", () => {
    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toMatch(
      /Codewith is a supported distribution target.*agent-skills\/fleet-skill-normalization\/SKILL\.md/s,
    );
    expect(readme).toMatch(
      /only explicitly scoped Codewith skill directories from the exact merged\s+commit/,
    );
    expect(readme).toContain(
      "Other tool adaptation and distribution is separate unless explicitly scoped.",
    );
    expect(readme).not.toContain("skill-sync");
    expect(readme).not.toMatch(/all five machines|~\/\.(?:claude|codex)/);
  });
});
