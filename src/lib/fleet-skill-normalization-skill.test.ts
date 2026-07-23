import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
const skillPath = join(
  repositoryRoot,
  "agent-skills/fleet-skill-normalization/SKILL.md",
);
const readmePath = join(repositoryRoot, "agent-skills/README.md");
const skill = readFileSync(skillPath, "utf8");

const invariantIds = [
  "SFN-SOURCE-PROVENANCE-v1",
  "SFN-DETERMINISTIC-RENDERING-v1",
  "SFN-ROOT-CONTAINMENT-v1",
  "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  "SFN-CHILD-IDENTITY-v1",
  "SFN-RUN-PATH-EXCLUSIVITY-v1",
  "SFN-TOUCHED-LEDGER-v1",
  "SFN-ROLLBACK-v1",
  "SFN-SECRET-SCAN-v1",
  "SFN-COORDINATOR-SEPARATION-v1",
] as const;

type InvariantId = (typeof invariantIds)[number];

type SafetyInvariant = {
  id: string;
  require: string[];
  deny: string[];
};

type SafetyContract = {
  version: string;
  invariants: SafetyInvariant[];
};

type InvariantSpec = {
  sections: string[];
  requireKeys: string[];
  denyKeys: string[];
  proseRequirements: Array<{ label: string; pattern: RegExp }>;
  unsafe: (statement: string) => boolean;
};

const permissiveModal =
  /\b(?:permitted|allowed|may|can|optional|advisory|best[- ]effort|sufficient|reuse|reused|reusable|skip|skipped)\b/i;
const prohibitiveModal =
  /\b(?:no|not|never|cannot|must not|forbid(?:den|s)?|deny|denied|reject(?:ed|s)?|block(?:ed|s)?|fail(?:s|ed)? closed)\b/i;

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function section(document: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.match(
    new RegExp(`^## ${escaped}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"),
  );
  if (!match) {
    throw new Error(`missing section: ${name}`);
  }
  return match[1];
}

function parseSafetyContract(document: string): SafetyContract {
  const block = section(document, "Safety Contract").match(
    /```yaml\r?\n([\s\S]*?)\r?\n```/,
  );
  if (!block) {
    throw new Error("missing safety contract YAML block");
  }
  return Bun.YAML.parse(block[1]) as SafetyContract;
}

function appendToSection(
  document: string,
  sectionName: string,
  statement: string,
): string {
  const heading = `## ${sectionName}`;
  const headingIndex = document.indexOf(heading);
  if (headingIndex < 0) {
    throw new Error(`missing section for fixture: ${sectionName}`);
  }
  const nextHeading = document.indexOf("\n## ", headingIndex + heading.length);
  const insertionIndex = nextHeading < 0 ? document.length : nextHeading;
  return `${document.slice(0, insertionIndex).trimEnd()}\n\n${statement}\n${document.slice(insertionIndex)}`;
}

function proseStatements(document: string, names: string[]): string[] {
  return names.flatMap((name) =>
    section(document, name)
      .replace(/```[\s\S]*?```/g, " ")
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map(normalized)
      .filter(Boolean),
  );
}

function isUnsafePermission(statement: string): boolean {
  return permissiveModal.test(statement) && !prohibitiveModal.test(statement);
}

function hasUnsafeClause(
  statement: string,
  concepts: (clause: string) => boolean,
): boolean {
  return statement
    .split(/\s+(?:but|however|while|whereas)\s+|[;](?:\s+|$)/i)
    .some((clause) => concepts(clause) && isUnsafePermission(clause));
}

const specs: Record<InvariantId, InvariantSpec> = {
  "SFN-SOURCE-PROVENANCE-v1": {
    sections: ["Input Contract", "Output Contract", "Stop Conditions"],
    requireKeys: [
      "immutable_source_commit",
      "tracked_source_path",
      "exact_source_bytes_sha256",
    ],
    denyKeys: ["moving_or_inferred_source", "best_effort_provenance"],
    proseRequirements: [
      {
        label: "immutable commit and tracked path",
        pattern: /exact immutable source commit.*tracked source path/i,
      },
      {
        label: "exact source bytes and sha256",
        pattern: /exact source bytes.*sha256:<lowercase-hex>/i,
      },
      {
        label: "moving and inferred sources rejected",
        pattern: /reject a moving branch.*inferred copy/i,
      },
      {
        label: "output repeats provenance",
        pattern: /source_commit: <exact immutable commit.*source_hash: <verified sha256/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bsource\b/i.test(clause) &&
          /\b(?:commit|hash|provenance)\b/i.test(clause) &&
          /\bbest[- ]effort\b/i.test(clause),
      ),
  },
  "SFN-DETERMINISTIC-RENDERING-v1": {
    sections: ["Deterministic Rendering", "Stop Conditions"],
    requireKeys: [
      "codewith_json_yaml_scalar_v1",
      "byte_exact_frontmatter",
      "deterministic_body_line_endings",
    ],
    denyKeys: ["machine_specific_rendering", "best_effort_byte_rendering"],
    proseRequirements: [
      {
        label: "canonical scalar encoder",
        pattern:
          /codewith-json-yaml-scalar-v1.*Unicode scalar values.*no Unicode normalization/i,
      },
      {
        label: "exact emitted frontmatter",
        pattern:
          /Emit exactly these ASCII prefixes.*name: <codewith-json-yaml-scalar-v1\(name\)>.*description: <codewith-json-yaml-scalar-v1\(description\)>/i,
      },
      {
        label: "bounded body normalization",
        pattern: /Normalize only CRLF or CR body line endings to LF.*No other byte may change/i,
      },
      {
        label: "one rendered byte sequence",
        pattern: /same immutable source bytes must produce exactly one rendered byte sequence/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\b(?:rendering|rendered|byte-exact|bytes?)\b/i.test(clause) &&
          /\bbest[- ]effort\b/i.test(clause),
      ),
  },
  "SFN-ROOT-CONTAINMENT-v1": {
    sections: ["Machine Resolution", "Canonical Path Admission", "Stop Conditions"],
    requireKeys: [
      "exact_lexical_and_canonical_root",
      "no_follow_component_walk",
      "retained_root_identity",
    ],
    denyKeys: ["traversal_or_symlink_components", "displaced_root_use"],
    proseRequirements: [
      {
        label: "machine-specific root resolution",
        pattern: /Resolve the configured skills root independently on every admitted machine/i,
      },
      {
        label: "absolute normalized lexical root",
        pattern: /absolute lexical path without dereferencing.*normalized lexical spelling/i,
      },
      {
        label: "retained canonical root identity",
        pattern: /retain the final root using no-follow semantics.*exact lexical\/canonical root agreement/i,
      },
      {
        label: "traversal and link rejection",
        pattern: /Reject `\.`, `\.\.`.*symlinks.*magic links.*mount crossings/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bdisplaced\b/i.test(clause) &&
          /\broot\b/i.test(clause) &&
          /\b(?:use|mutation|operation|write|continue)\b/i.test(clause),
      ),
  },
  "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1": {
    sections: ["Canonical Path Admission", "Guarded Forward Mutation", "Guarded Rollback"],
    requireKeys: [
      "indivisible_root_directory_child_binding",
      "operation_bound_touched_ledger_and_receipt",
      "repeated_existing_directory_identity",
      "repeated_run_created_directory_identity",
    ],
    denyKeys: ["check_then_mutate", "displaced_directory_redirection"],
    proseRequirements: [
      {
        label: "one indivisible guarded operation",
        pattern: /Every child operation.*one indivisible fail-closed guarded operation/i,
      },
      {
        label: "root directory and child bound together",
        pattern:
          /same primitive or transaction.*lexical root entry.*selected-directory lexical entry.*allowlisted child/i,
      },
      {
        label: "ledger mutation and receipt committed together",
        pattern:
          /same indivisible transaction.*actual canonical child touch.*authoritative touched ledger.*perform the mutation.*operation receipt.*atomically commit the ledger admission, mutation, and receipt.*fail before mutation/i,
      },
      {
        label: "check then mutate rejected",
        pattern: /pre-check.*followed by later mutation.*insufficient and forbidden/i,
      },
      {
        label: "existing and created directories repeatedly proven",
        pattern:
          /before every child operation and at closure for both pre-existing and run-created selected directories/i,
      },
      {
        label: "unavailable primitive fails before mutation",
        pattern: /lacks one equivalent primitive or transaction.*fail before mutation/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(statement, (clause) => {
        const redirectedDirectory =
          /\b(?:displaced|replaced|renamed)\b/i.test(clause) &&
          /\bselected director(?:y|ies)\b/i.test(clause) &&
          /\b(?:redirect|mutation|operate|continue)\b/i.test(clause);
        const separatedPrecheck =
          /\bpre-check\b/i.test(clause) &&
          /\b(?:later|subsequent)\b/i.test(clause) &&
          /\bmutation\b/i.test(clause) &&
          /\b(?:sufficient|can|may|allowed|permitted)\b/i.test(clause);
        return redirectedDirectory || separatedPrecheck;
      }),
  },
  "SFN-CHILD-IDENTITY-v1": {
    sections: [
      "Canonical Path Admission",
      "Guarded Forward Mutation",
      "Guarded Rollback",
    ],
    requireKeys: [
      "exact_child_entry_type_link_inode_hash",
      "single_link_regular_files",
      "operation_bound_revalidation",
    ],
    denyKeys: ["special_or_hard_link_targets", "advisory_child_revalidation"],
    proseRequirements: [
      {
        label: "single-link regular targets",
        pattern: /Existing targets and run-owned files must be regular files with link count one/i,
      },
      {
        label: "special and hard link rejection",
        pattern: /Reject symlinks.*devices.*sockets.*FIFOs.*hard-linked files/i,
      },
      {
        label: "complete child identity",
        pattern: /exact entry, type, device, inode, mount ID, metadata, link count, and hash checks/i,
      },
      {
        label: "operation-bound revalidation",
        pattern: /immediately after creation, before and after each use, and at closure/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bchild\b/i.test(clause) &&
          /\b(?:identity|link|type|hash)\b/i.test(clause) &&
          /\brevalidation\b/i.test(clause),
      ),
  },
  "SFN-RUN-PATH-EXCLUSIVITY-v1": {
    sections: ["Canonical Path Admission", "Guarded Rollback"],
    requireKeys: [
      "absent_until_owner_operation",
      "exclusive_create_no_follow",
      "single_use_temp_preimage_receipt",
    ],
    denyKeys: ["preexisting_run_path_reuse", "overwrite_or_truncate_run_path"],
    proseRequirements: [
      {
        label: "run paths absent until owner operation",
        pattern:
          /run-owned temporary, preimage, and receipt path must be absent at admission and remain absent until its owning operation/i,
      },
      {
        label: "exclusive no-follow creation",
        pattern: /O_CREAT\|O_EXCL\|O_NOFOLLOW.*stronger exclusive primitive/i,
      },
      {
        label: "pre-existing run path rejection",
        pattern: /pre-existing, raced, symlinked, or previously used run-owned path rejects the run/i,
      },
      {
        label: "no reuse overwrite or precreate",
        pattern: /Never reuse, truncate, overwrite, or pre-create a temporary, preimage, or receipt/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bpre-existing\b/i.test(clause) &&
          /\brun-owned\b/i.test(clause) &&
          /\b(?:temporary|temp|preimage|receipt)\b/i.test(clause) &&
          /\breus(?:e|ed|able)\b/i.test(clause),
      ),
  },
  "SFN-TOUCHED-LEDGER-v1": {
    sections: ["Exact Allowlist and Touched Ledger", "Secret Scanning and Closure"],
    requireKeys: [
      "exact_lexical_and_canonical_allowlist",
      "authoritative_actual_canonical_touches",
      "touched_subset_proof",
    ],
    denyKeys: ["prefix_glob_or_wildcard_admission", "out_of_allowlist_touch"],
    proseRequirements: [
      {
        label: "exact lexical and canonical allowlist",
        pattern: /normalized lexical and exact canonical paths for every admitted/i,
      },
      {
        label: "prefix and wildcard rejection",
        pattern: /Directory-prefix, recursive, glob, and wildcard admission are forbidden/i,
      },
      {
        label: "actual canonical touched ledger",
        pattern: /authoritative touched-path ledger.*actual canonical path reached through the retained handles/i,
      },
      {
        label: "subset proof",
        pattern: /actual canonical touched set is a subset of the exact canonical allowlist/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\boutside\b/i.test(clause) &&
          /\ballowlist\b/i.test(clause) &&
          /\b(?:touch|touched|write|mutate)\b/i.test(clause),
      ),
  },
  "SFN-ROLLBACK-v1": {
    sections: ["Guarded Rollback", "Output Contract", "Stop Conditions"],
    requireKeys: [
      "atomic_compare_before_rollback",
      "exact_run_owned_state",
      "rollback_receipt",
    ],
    denyKeys: ["unconditional_restore_or_remove", "changed_or_nonowned_state_removal"],
    proseRequirements: [
      {
        label: "rollback exact run state only",
        pattern: /consider only exact state installed by this run/i,
      },
      {
        label: "atomic compare before restore",
        pattern:
          /Restore an existing target only with one atomic compare-and-replace.*exact installed identity/i,
      },
      {
        label: "drift preservation",
        pattern: /Drift preserves the target and reports a rollback conflict/i,
      },
      {
        label: "exclusive rollback receipt",
        pattern: /Every attempted rollback creates an exclusive rollback receipt/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\brollback\b/i.test(clause) &&
          /\b(?:remove|restore|replace)\b/i.test(clause) &&
          /\b(?:changed|drifted|non-owned|unowned)\b/i.test(clause),
      ),
  },
  "SFN-SECRET-SCAN-v1": {
    sections: [
      "Deterministic Rendering",
      "Guarded Forward Mutation",
      "Secret Scanning and Closure",
    ],
    requireKeys: [
      "non_printing_source_rendered_target_scan",
      "finding_blocks_mutation",
      "filename_or_count_only_evidence",
    ],
    denyKeys: ["printed_secret_match", "skipped_secret_scan"],
    proseRequirements: [
      {
        label: "all relevant bytes scanned",
        pattern:
          /non-printing secret scans over immutable source bytes, deterministic rendered bytes, every observed preimage, every installed target/i,
      },
      {
        label: "non-printing evidence",
        pattern: /must not print matched secret material/i,
      },
      {
        label: "scan cannot be skipped",
        pattern: /Secret scanning must never be skipped/i,
      },
      {
        label: "finding blocks progress",
        pattern: /Any finding blocks the next mutation, commit, or handoff/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bsecret scann?ing\b/i.test(clause) &&
          /\b(?:print|matches|skip|skipped)\b/i.test(clause),
      ),
  },
  "SFN-COORDINATOR-SEPARATION-v1": {
    sections: ["Scope and Roles", "Output Contract", "Stop Conditions"],
    requireKeys: [
      "coordinator_scopes_and_delegates",
      "worker_performs_mutation",
      "coordinator_verifies_evidence",
    ],
    denyKeys: [
      "coordinator_repository_mutation",
      "coordinator_live_skill_mutation",
    ],
    proseRequirements: [
      {
        label: "coordinator delegates",
        pattern: /coordinator resolves scope, delegates all repository and live skill mutation/i,
      },
      {
        label: "coordinator does not mutate",
        pattern: /coordinator must not perform the worker's repository mutation or edit live skill files/i,
      },
      {
        label: "worker mutation is bounded",
        pattern: /worker may read.*It may mutate only exact admitted paths/i,
      },
      {
        label: "coordinator verifies",
        pattern: /coordinator verifies evidence but performs no worker mutation/i,
      },
    ],
    unsafe: (statement) =>
      hasUnsafeClause(
        statement,
        (clause) =>
          /\bcoordinator\b/i.test(clause) &&
          /\b(?:mutation|mutate|write|edit)\b/i.test(clause) &&
          /\b(?:worker|repository|live skill)\b/i.test(clause),
      ),
  },
};

function validateContract(document: string): string[] {
  const violations: string[] = [];
  let contract: SafetyContract;

  try {
    contract = parseSafetyContract(document);
  } catch (error) {
    return [`SAFETY-CONTRACT: ${String(error)}`];
  }

  if (contract.version !== "skills-fleet-normalization-semantic-v2") {
    violations.push("SAFETY-CONTRACT: wrong version");
  }

  const actualIds = contract.invariants?.map((invariant) => invariant.id) ?? [];
  if (
    actualIds.length !== invariantIds.length ||
    new Set(actualIds).size !== invariantIds.length ||
    invariantIds.some((id) => !actualIds.includes(id))
  ) {
    violations.push("SAFETY-CONTRACT: invariant ID set mismatch");
  }

  const byId = new Map(
    (contract.invariants ?? []).map((invariant) => [invariant.id, invariant]),
  );

  for (const id of invariantIds) {
    const spec = specs[id];
    const invariant = byId.get(id);
    if (!invariant) {
      violations.push(`${id}: missing structured invariant`);
      continue;
    }

    for (const key of spec.requireKeys) {
      if (!Array.isArray(invariant.require) || !invariant.require.includes(key)) {
        violations.push(`${id}: missing require key ${key}`);
      }
    }
    for (const key of spec.denyKeys) {
      if (!Array.isArray(invariant.deny) || !invariant.deny.includes(key)) {
        violations.push(`${id}: missing deny key ${key}`);
      }
    }

    let prose: string;
    try {
      prose = normalized(
        spec.sections.map((name) => section(document, name)).join("\n"),
      );
    } catch (error) {
      violations.push(`${id}: ${String(error)}`);
      continue;
    }

    for (const requirement of spec.proseRequirements) {
      if (!requirement.pattern.test(prose)) {
        violations.push(`${id}: missing prose semantics ${requirement.label}`);
      }
    }

    if (
      proseStatements(document, spec.sections).some((statement) =>
        spec.unsafe(statement),
      )
    ) {
      violations.push(`${id}: unsafe permissive semantics`);
    }
  }

  return violations;
}

type SemanticFixture = {
  label: string;
  section: string;
  statement: string;
  expected: InvariantId;
};

const unsafeFixtures: SemanticFixture[] = [
  {
    label: "predecessor displaced root permitted synonym",
    section: "Canonical Path Admission",
    statement:
      "Use of a displaced root for child mutation after admission is permitted.",
    expected: "SFN-ROOT-CONTAINMENT-v1",
  },
  {
    label: "unrelated negation cannot mask displaced root permission",
    section: "Canonical Path Admission",
    statement:
      "Use of a displaced root for child mutation is permitted, but audit logging is not optional.",
    expected: "SFN-ROOT-CONTAINMENT-v1",
  },
  {
    label: "predecessor existing selected directory may redirect",
    section: "Canonical Path Admission",
    statement:
      "A displaced existing selected directory may redirect child mutation.",
    expected: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  },
  {
    label: "run-created selected directory allowed redirect",
    section: "Canonical Path Admission",
    statement:
      "A replaced run-created selected directory is allowed to redirect child mutation.",
    expected: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  },
  {
    label: "nearby pre-check can be sufficient",
    section: "Canonical Path Admission",
    statement:
      "A pre-check followed by later mutation can be sufficient.",
    expected: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  },
  {
    label: "child identity advisory",
    section: "Canonical Path Admission",
    statement:
      "Child identity, link, type, and hash revalidation is optional or advisory.",
    expected: "SFN-CHILD-IDENTITY-v1",
  },
  {
    label: "outside allowlist may be touched",
    section: "Exact Allowlist and Touched Ledger",
    statement: "Paths outside the exact allowlist may be touched.",
    expected: "SFN-TOUCHED-LEDGER-v1",
  },
  {
    label: "run paths may be reused",
    section: "Canonical Path Admission",
    statement:
      "Pre-existing run-owned temporary, preimage, and receipt paths may be reused.",
    expected: "SFN-RUN-PATH-EXCLUSIVITY-v1",
  },
  {
    label: "rollback changed state",
    section: "Guarded Rollback",
    statement: "Rollback may remove changed or non-owned state.",
    expected: "SFN-ROLLBACK-v1",
  },
  {
    label: "source proof best effort",
    section: "Input Contract",
    statement: "Source commit and hash provenance may be best-effort.",
    expected: "SFN-SOURCE-PROVENANCE-v1",
  },
  {
    label: "byte rendering best effort",
    section: "Deterministic Rendering",
    statement: "Byte-exact rendering is allowed to be best-effort.",
    expected: "SFN-DETERMINISTIC-RENDERING-v1",
  },
  {
    label: "secret scan may print",
    section: "Secret Scanning and Closure",
    statement: "Secret scanning may print matches.",
    expected: "SFN-SECRET-SCAN-v1",
  },
  {
    label: "secret scan can be skipped",
    section: "Secret Scanning and Closure",
    statement: "Secret scanning can be skipped.",
    expected: "SFN-SECRET-SCAN-v1",
  },
  {
    label: "coordinator repository mutation",
    section: "Scope and Roles",
    statement: "The coordinator may perform the worker's repository mutation.",
    expected: "SFN-COORDINATOR-SEPARATION-v1",
  },
];

const safeNearMisses: SemanticFixture[] = [
  {
    label: "source modal is explicitly denied",
    section: "Input Contract",
    statement: "Source commit and hash provenance may not be best-effort.",
    expected: "SFN-SOURCE-PROVENANCE-v1",
  },
  {
    label: "rendering modal is explicitly denied",
    section: "Deterministic Rendering",
    statement: "Best-effort byte-exact rendering is not allowed.",
    expected: "SFN-DETERMINISTIC-RENDERING-v1",
  },
  {
    label: "displaced root permission is negated",
    section: "Canonical Path Admission",
    statement:
      "Use of a displaced root for child mutation after admission is not permitted.",
    expected: "SFN-ROOT-CONTAINMENT-v1",
  },
  {
    label: "safe root denial coexists with unrelated permission",
    section: "Canonical Path Admission",
    statement:
      "No use of a displaced root for child mutation is permitted; evidence reporting may continue.",
    expected: "SFN-ROOT-CONTAINMENT-v1",
  },
  {
    label: "directory redirection and precheck are negated",
    section: "Canonical Path Admission",
    statement:
      "A displaced selected directory may never redirect mutation, and a pre-check before later mutation is not sufficient.",
    expected: "SFN-ATOMIC-ROOT-DIRECTORY-BINDING-v1",
  },
  {
    label: "child advice is negated",
    section: "Canonical Path Admission",
    statement: "Child identity revalidation is not advisory or optional.",
    expected: "SFN-CHILD-IDENTITY-v1",
  },
  {
    label: "run path reuse is negated",
    section: "Canonical Path Admission",
    statement:
      "Pre-existing run-owned temporary, preimage, and receipt paths may not be reused.",
    expected: "SFN-RUN-PATH-EXCLUSIVITY-v1",
  },
  {
    label: "outside touch is negated",
    section: "Exact Allowlist and Touched Ledger",
    statement: "No path outside the exact allowlist may be touched.",
    expected: "SFN-TOUCHED-LEDGER-v1",
  },
  {
    label: "rollback drift removal is negated",
    section: "Guarded Rollback",
    statement: "Rollback may not remove changed or non-owned state.",
    expected: "SFN-ROLLBACK-v1",
  },
  {
    label: "secret scan exceptions are negated",
    section: "Secret Scanning and Closure",
    statement:
      "Secret scanning may not print matches and can never be skipped.",
    expected: "SFN-SECRET-SCAN-v1",
  },
  {
    label: "coordinator mutation is negated",
    section: "Scope and Roles",
    statement:
      "The coordinator may not perform the worker's repository mutation.",
    expected: "SFN-COORDINATOR-SEPARATION-v1",
  },
];

const controlledUnsafeDocument =
  process.env.FLEET_CONTRACT_CONTROLLED_UNSAFE === "1"
    ? appendToSection(
        skill,
        unsafeFixtures[0].section,
        unsafeFixtures[0].statement,
      )
    : skill;

describe("fleet-skill-normalization semantic safety contract", () => {
  test("uses exact tracked frontmatter", () => {
    const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    expect(match).not.toBeNull();
    const frontmatter = Bun.YAML.parse(match?.[1] ?? "") as Record<
      string,
      unknown
    >;

    expect(Object.keys(frontmatter)).toEqual([
      "name",
      "description",
      "user_invocable",
    ]);
    expect(frontmatter.name).toBe("fleet-skill-normalization");
    expect(frontmatter.description).toBeTypeOf("string");
    expect(frontmatter.user_invocable).toBe(true);
  });

  test("parses one versioned structured contract with explicit require and deny semantics", () => {
    const contract = parseSafetyContract(skill);
    expect(contract.version).toBe("skills-fleet-normalization-semantic-v2");
    expect(contract.invariants.map((invariant) => invariant.id)).toEqual(
      [...invariantIds],
    );
    for (const invariant of contract.invariants) {
      expect(invariant.id).toMatch(/^SFN-[A-Z-]+-v1$/);
      expect(invariant.require.length).toBeGreaterThan(0);
      expect(invariant.deny.length).toBeGreaterThan(0);
      expect(invariant.require.every((value) => /^[a-z0-9_]+$/.test(value))).toBe(
        true,
      );
      expect(invariant.deny.every((value) => /^[a-z0-9_]+$/.test(value))).toBe(
        true,
      );
    }
  });

  test("the unmodified prose and structured contract produce zero violations", () => {
    expect(validateContract(controlledUnsafeDocument)).toEqual([]);
  });

  test("each semantic mutation fails only its intended invariant", () => {
    for (const fixture of unsafeFixtures) {
      const candidate = appendToSection(
        skill,
        fixture.section,
        fixture.statement,
      );
      expect(
        validateContract(candidate),
        `validator accepted or misclassified: ${fixture.label}`,
      ).toEqual([`${fixture.expected}: unsafe permissive semantics`]);
    }
  });

  test("negated near-miss wording remains valid for every major invariant", () => {
    for (const fixture of safeNearMisses) {
      const candidate = appendToSection(
        skill,
        fixture.section,
        fixture.statement,
      );
      expect(
        validateContract(candidate),
        `validator overrejected: ${fixture.label}`,
      ).toEqual([]);
    }
  });

  test("structured semantics and prose are independently required", () => {
    const missingStructuredKey = skill.replace(
      "      - exact_source_bytes_sha256\n",
      "",
    );
    expect(validateContract(missingStructuredKey)).toContain(
      "SFN-SOURCE-PROVENANCE-v1: missing require key exact_source_bytes_sha256",
    );

    const weakenedProse = skill.replace(
      "The same immutable source bytes must produce exactly one rendered byte sequence",
      "The source may produce an implementation-selected rendering",
    );
    expect(validateContract(weakenedProse)).toContain(
      "SFN-DETERMINISTIC-RENDERING-v1: missing prose semantics one rendered byte sequence",
    );
  });

  test("README registers the bounded Codewith workflow without live distribution", () => {
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
