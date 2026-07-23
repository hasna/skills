import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = process.cwd();
const skillPath = join(
  repositoryRoot,
  "agent-skills",
  "fleet-skill-normalization",
  "SKILL.md",
);
const readmePath = join(repositoryRoot, "agent-skills", "README.md");
const skill = readFileSync(skillPath, "utf8");

function section(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = skill.match(
    new RegExp(`^## ${escapedName}\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
  );
  expect(match, `missing section: ${name}`).not.toBeNull();
  return match?.[1] ?? "";
}

function fencedText(content: string): string {
  const match = content.match(/```text\r?\n([\s\S]*?)\r?\n```/);
  expect(match, "section must contain a text contract block").not.toBeNull();
  return match?.[1] ?? "";
}

function fieldNames(contract: string): string[] {
  return contract
    .split(/\r?\n/)
    .filter((line) => line.includes(":"))
    .map((line) => line.slice(0, line.indexOf(":")).trim());
}

function expectOrdered(content: string, terms: string[]): void {
  const normalizedContent = content.replace(/\s+/g, " ");
  let cursor = -1;
  for (const term of terms) {
    const normalizedTerm = term.replace(/\s+/g, " ");
    const next = normalizedContent.indexOf(normalizedTerm, cursor + 1);
    expect(next, `expected ordered contract term after offset ${cursor}: ${term}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

const contradictionFixtures = [
  {
    sentence: "Symlink components are permitted.",
    pattern: /\bsymlink components are permitted\b/i,
  },
  {
    sentence: "The resolved root may contain symlink components.",
    pattern: /\bresolved root may contain symlink components\b/i,
  },
  {
    sentence: "Hard-linked targets may be replaced after validation.",
    pattern: /\bhard-linked targets may be replaced after validation\b/i,
  },
  {
    sentence: "Wildcards are permitted.",
    pattern: /\bwildcards are permitted\b/i,
  },
  {
    sentence: "Pre-existing receipt files are reusable after validation.",
    pattern: /\bpre-existing receipt files are reusable after validation\b/i,
  },
  {
    sentence: "Previously used temporary paths are safe.",
    pattern: /\bpreviously used temporary paths are safe\b/i,
  },
  {
    sentence: "Recursive deletion is acceptable after verification.",
    pattern: /\brecursive deletion is acceptable after verification\b/i,
  },
  {
    sentence: "Unconditional restore is permitted.",
    pattern: /\bunconditional restore is permitted\b/i,
  },
  {
    sentence:
      "A child mutation may proceed through the retained root handle after the lexical root entry is displaced.",
    pattern:
      /\bchild mutation may proceed through the retained root handle after the lexical root entry is displaced\b/i,
  },
  {
    sentence:
      "Child operations may continue through a retained pre-existing selected-directory handle after the lexical directory entry is displaced.",
    pattern:
      /\bchild operations may continue through a retained pre-existing selected-directory handle after the lexical directory entry is displaced\b/i,
  },
] as const;

const requiredStructures = [
  {
    section: "Deterministic Adaptation",
    label: "canonical scalar encoder",
    pattern:
      /`codewith-json-yaml-scalar-v1`[\s\S]*lowercase `\\u00xx`[\s\S]*solidus `\/` literally[\s\S]*shortest well-formed UTF-8 byte sequence/,
  },
  {
    section: "Deterministic Adaptation",
    label: "exact emitted key bytes",
    pattern:
      /---\\n[\s\S]*name: <codewith-json-yaml-scalar-v1\(name\)>\\n[\s\S]*description: <codewith-json-yaml-scalar-v1\(description\)>\\n[\s\S]*one and only one rendered byte sequence/,
  },
  {
    section: "Canonical Path Admission",
    label: "root lexical canonical binding",
    pattern:
      /Open the final lexical root anchor first[\s\S]*canonical path from that retained handle[\s\S]*exact lexical\/canonical path agreement[\s\S]*latest expected-state ledger[\s\S]*Reject every other drift/,
  },
  {
    section: "Canonical Path Admission",
    label: "atomic root and directory operation binding",
    pattern:
      /Every child operation[\s\S]*one fail-closed guarded operation[\s\S]*admission and execution are one indivisible atomic transaction[\s\S]*exact normalized lexical root entry[\s\S]*retained no-follow root handle[\s\S]*device, inode, mount ID,[\s\S]*exact normalized selected-directory lexical entry[\s\S]*retained no-follow selected-directory handle[\s\S]*same guarded operation that performs the child mutation[\s\S]*fail closed before mutation[\s\S]*closure is insufficient/,
  },
  {
    section: "Canonical Path Admission",
    label: "pre-existing and run-created directory rebinding",
    pattern:
      /every selected skill directory, whether pre-existing or run-created[\s\S]*Before every child operation and at closure[\s\S]*exact selected-directory lexical entry names its retained handle[\s\S]*canonical path, inode, device, mount ID, and directory type[\s\S]*rename, replacement, or mount substitution[\s\S]*fail before any child read, write, removal, rollback, or receipt operation/,
  },
  {
    section: "Canonical Path Admission",
    label: "repeated retained-handle single-link checks",
    pattern:
      /Immediately after creation, before and after[\s\S]*each read, write, hash, exchange, install, restore, or removal use[\s\S]*same regular file with link count one[\s\S]*hard-link race cannot alias a write/,
  },
  {
    section: "Canonical Path Admission",
    label: "absent-parent canonical child admission",
    pattern:
      /If the selected directory exists[\s\S]*If it is absent, canonicalize the existing root[\s\S]*exact child candidate[\s\S]*require exact agreement with its admitted lexical\/canonical pair/,
  },
  {
    section: "Inventory and Exact-Path Allowlist",
    label: "directory allowlist and touched ledger",
    pattern:
      /exact selected skill directory creation[\s\S]*lexical path and canonical path[\s\S]*Record a directory touch[\s\S]*subset of the exact canonical allowlist/,
  },
  {
    section: "Guarded Forward Mutation",
    label: "missing directory create",
    pattern:
      /guarded no-follow[\s\S]*atomic create-directory-if-absent[\s\S]*device, inode, mount ID,[\s\S]*Append its actual canonical path to the touched-path ledger/,
  },
  {
    section: "Guarded Rollback",
    label: "atomic absent-target rollback",
    pattern:
      /one fail-closed atomic compare-and-remove[\s\S]*exact run-installed device, inode, mount ID, metadata,[\s\S]*compare-then-unlink sequence is forbidden/,
  },
  {
    section: "Guarded Rollback",
    label: "missing directory rollback",
    pattern:
      /selected skill directory also had an absent pre-state[\s\S]*run-created directory's retained handle[\s\S]*atomic compare-and-remove-empty-directory[\s\S]*preserve the directory and report[\s\S]*rollback conflict/,
  },
] as const;

function contractViolations(document: string): string[] {
  const violations: string[] = [];

  for (const fixture of contradictionFixtures) {
    if (fixture.pattern.test(document)) {
      violations.push(`unsafe contradiction: ${fixture.sentence}`);
    }
  }

  for (const requirement of requiredStructures) {
    const escapedName = requirement.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.match(
      new RegExp(`^## ${escapedName}\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
    );
    const normalizedSection = (match?.[1] ?? "").replace(/\s+/g, " ");
    if (!match || !requirement.pattern.test(normalizedSection)) {
      violations.push(`missing structure: ${requirement.label}`);
    }
  }

  return violations;
}

describe("fleet-skill-normalization tracked contract", () => {
  test("uses exact repository frontmatter and balanced structural sections", () => {
    const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    expect(match).not.toBeNull();
    const parsed = Bun.YAML.parse(match?.[1] ?? "") as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual(["name", "description", "user_invocable"]);
    expect(parsed.name).toBe("fleet-skill-normalization");
    expect(parsed.description).toBeTypeOf("string");
    expect(parsed.user_invocable).toBe(true);
    expect(skill.match(/^## /gm)?.length).toBe(10);
    expect((skill.match(/^\s*```.*$/gm) ?? []).length % 2).toBe(0);
  });

  test("binds immutable source provenance to complete output provenance", () => {
    const inputFields = fieldNames(fencedText(section("Input Contract")));
    const outputFields = fieldNames(fencedText(section("Output Contract")));
    const provenanceFields = [
      "source_repository_or_package",
      "source_package_version_and_integrity",
      "source_commit",
      "source_path",
      "source_hash",
    ];

    expect(inputFields).toEqual([
      "run_id",
      ...provenanceFields,
      "target_machine_ids",
      "worker_provider_profile_alias",
    ]);
    for (const field of provenanceFields) {
      expect(outputFields, `output omits provenance field: ${field}`).toContain(field);
    }
    expect(section("Input Contract")).toMatch(
      /exact\s+commit, tracked path, and byte hash are all proven[\s\S]*package version and integrity/,
    );
    expect(section("Output Contract")).toMatch(
      /reported source repository or[\s\S]*commit, path, source hash[\s\S]*package version and[\s\S]*integrity match the immutable input/,
    );
  });

  test("defines one deterministic two-key Codewith rendering", () => {
    const adaptation = section("Deterministic Adaptation");

    expect(adaptation).toMatch(
      /`codewith-json-yaml-scalar-v1` encoder[\s\S]*sequence of Unicode scalar values[\s\S]*reject an unpaired[\s\S]*surrogate/,
    );
    expect(adaptation).toMatch(
      /escapes `"` as `\\"` and `\\` as[\s\S]*uses exactly `\\b`, `\\t`, `\\n`, `\\f`, and `\\r`/,
    );
    expectOrdered(adaptation, [
      "solidus `/` literally and never as `\\/`",
      "shortest well-formed UTF-8 byte sequence",
      "name: <codewith-json-yaml-scalar-v1(name)>\\n",
      "description: <codewith-json-yaml-scalar-v1(description)>\\n",
      "every `\\n` denotes exactly one byte `0x0a`",
      "source body",
      "one and only one rendered byte sequence",
    ]);
    expect(adaptation).toMatch(
      /non-printing secret scan over the[\s\S]*source and rendered bytes[\s\S]*finding blocks that skill/,
    );
    expect(adaptation).toMatch(
      /rendered bytes and their hash are the canonical desired state[\s\S]*Do not add[\s\S]*machine-specific content/,
    );
    expect(adaptation).not.toMatch(/(?:timestamp|hostname|machine ID).*(?:frontmatter|rendered bytes)/i);
  });

  test("rejects traversal and proves lexical plus canonical containment", () => {
    const admission = section("Canonical Path Admission");

    expectOrdered(admission, [
      "absolute lexical path without dereferencing it",
      "normalized lexical spelling byte for byte",
      "Open the final lexical root anchor first",
      "canonical path from that retained handle",
      "exact lexical/canonical path agreement",
      "admission and execution are one indivisible atomic",
      "exact normalized lexical root entry",
      "exact normalized selected-directory lexical entry",
      "same guarded operation",
      "fail closed before mutation",
      "latest expected-state ledger",
      "Reject every other",
      "drift",
    ]);
    expect(admission).toMatch(
      /Record both the absolute normalized lexical path and its canonical path[\s\S]*If the selected directory exists[\s\S]*If it is absent, canonicalize the existing root/,
    );
    expect(admission).toMatch(
      /Never invoke a symlink-following realpath operation on an[\s\S]*absent or final component[\s\S]*require exact[\s\S]*agreement with its admitted lexical\/canonical pair/,
    );
    expect(admission).toMatch(
      /Reject `\.\.`, `\.`, empty segments, repeated separators, alternate[\s\S]*A selected skill name must be one basename, never a path/,
    );
    expect(admission).toMatch(
      /any canonical path not strictly inside the exact canonical[\s\S]*root and its exact selected skill directory/,
    );
    expect(admission).toMatch(
      /Resolving a lexical symlink and then opening its[\s\S]*canonical destination is forbidden/,
    );
  });

  test("rejects symlink components, hard links, special files, and no-follow uncertainty", () => {
    const admission = section("Canonical Path Admission");

    expect(admission).toMatch(
      /Walk every existing component from the retained root handle with no-follow semantics[\s\S]*Reject symlinked or magic-link components[\s\S]*cross-mount components/,
    );
    expect(admission).toMatch(
      /openat2[\s\S]*RESOLVE_BENEATH\|RESOLVE_NO_SYMLINKS\|RESOLVE_NO_MAGICLINKS\|RESOLVE_NO_XDEV/,
    );
    expect(admission).toMatch(
      /If canonical containment or[\s\S]*no-follow operation cannot be proven, fail closed without mutation/,
    );
    expect(admission).toMatch(
      /Existing targets must be single-link regular files[\s\S]*Reject directories,[\s\S]*hard-linked files[\s\S]*special file/,
    );
    expect(admission).toMatch(
      /same regular file with link count one[\s\S]*bind the single-link\/type[\s\S]*hard-link race cannot alias a write/,
    );
    expect(admission).toMatch(
      /Apply the complete repeated lexical-entry and retained-handle identity proof to[\s\S]*every selected skill directory, whether pre-existing or run-created/,
    );
    expect(admission).toMatch(
      /Only a guarded[\s\S]*creation or removal of an exact allowlisted child may atomically return and[\s\S]*advance that snapshot/,
    );
  });

  test("atomically binds root and selected-directory identity to every child operation", () => {
    const admission = section("Canonical Path Admission");

    expectOrdered(admission, [
      "Every child operation",
      "one fail-closed guarded operation",
      "admission and execution are one indivisible atomic",
      "exact normalized lexical root entry",
      "retained no-follow root",
      "exact normalized selected-directory lexical entry",
      "retained no-follow selected-directory",
      "same guarded operation that performs the child mutation",
      "pre-check or re-stat followed by mutation",
      "fail closed before mutation",
      "Detecting displacement at closure is insufficient",
    ]);
    expect(admission).toMatch(
      /whether pre-existing or run-created[\s\S]*Before[\s\S]*every child operation and at closure[\s\S]*must[\s\S]*fail before any child[\s\S]*receipt[\s\S]*operation/,
    );
  });

  test("rejects every pre-existing run-owned path and requires exclusive creation", () => {
    const admission = section("Canonical Path Admission");

    expectOrdered(admission, [
      "temporary, preimage, and receipt path must be",
      "absent at admission",
      "remain absent until its owning operation",
      "exclusive create",
      "guarded forward replacement creates and returns the",
      "preimage",
      "Do not pre-create a",
      "preimage or receipt",
      "pre-existing, raced, symlinked, or previously used",
      "rejects the run",
    ]);
    expect(admission).toContain("O_CREAT|O_EXCL|O_NOFOLLOW");
    expect(admission).toMatch(/never reuse, truncate, or overwrite it/);
    expect(admission).toMatch(
      /pre-existing, raced, symlinked, or previously used[\s\S]*rejects the run; never reuse, truncate, or overwrite/,
    );
    expect(admission).toMatch(
      /directory is absent, its proven absence proves every admitted[\s\S]*child candidate absent[\s\S]*re-prove each[\s\S]*child absent[\s\S]*immediately before its exclusive[\s\S]*create/,
    );
  });

  test("makes the authoritative canonical touched ledger an exact allowlist subset", () => {
    const allowlist = section("Inventory and Exact-Path Allowlist");

    expect(allowlist).toMatch(
      /allowlist records both the normalized lexical path and canonical[\s\S]*path for every entry[\s\S]*Directory-prefix, recursive, glob, or wildcard admission is[\s\S]*forbidden/,
    );
    expectOrdered(allowlist, [
      "authoritative touched-path ledger",
      "actual canonical path",
      "not a caller-supplied string",
      "subset of the exact canonical allowlist",
      "lexical/canonical pair still agrees",
    ]);
    expect(allowlist).toMatch(
      /touch to any unselected or remote-only path fails closure[\s\S]*stop further writes/,
    );
    expect(allowlist).toMatch(
      /directory entry authorizes only guarded creation or[\s\S]*guarded rollback removal[\s\S]*never authorizes[\s\S]*prefix writes/,
    );
  });

  test("requires guarded replacement to return the exact inventoried preimage", () => {
    const inventory = section("Inventory and Exact-Path Allowlist");
    const forward = section("Guarded Forward Mutation");

    expectOrdered(inventory, [
      "capture its exact inventoried",
      "bytes, inode identity, metadata, and hash",
      "atomically return the exact",
      "displaced preimage",
    ]);
    expectOrdered(forward, [
      "one fail-closed atomic",
      "binds the expected existing inode/metadata",
      "installs the verified temporary bytes",
      "atomically returns the displaced target",
      "exactly matches the",
      "inventoried bytes",
    ]);
    expect(forward).toMatch(
      /A separate[\s\S]*compare-then-rename sequence, an unconditional rename[\s\S]*is forbidden/,
    );
    expect(forward).toMatch(
      /missing target uses one atomic create-if-absent[\s\S]*fail if either lexical entry was displaced or any object appeared[\s\S]*after inventory/,
    );
    expect(forward).toMatch(
      /guarded no-follow[\s\S]*atomic create-directory-if-absent[\s\S]*run-created selected directory/,
    );
  });

  test("rolls back only after comparing exact run-installed state and preserves conflicts", () => {
    const rollback = section("Guarded Rollback");

    expectOrdered(rollback, [
      "compare the current no-follow target",
      "exact installed inode/metadata and target hash",
      "restore the admitted preimage only on an exact",
      "match",
      "preserve the displaced failed target",
    ]);
    expect(rollback).toMatch(
      /If either lexical entry or[\s\S]*the current target drifted, preserve it and report a rollback conflict/,
    );
    expect(rollback).toMatch(
      /absent target pre-state[\s\S]*one fail-closed atomic compare-and-remove[\s\S]*compare-then-unlink sequence is forbidden/,
    );
    expect(rollback).toMatch(
      /selected skill directory also had an absent pre-state[\s\S]*empty[\s\S]*atomic[\s\S]*compare-and-remove-empty-directory/,
    );
  });

  test("satisfies every consolidated structural safety requirement", () => {
    expect(contractViolations(skill)).toEqual([]);
  });

  test("rejects each explicit unsafe contradiction fixture", () => {
    for (const fixture of contradictionFixtures) {
      const candidate = `${skill}\n${fixture.sentence}\n`;
      expect(
        contractViolations(candidate),
        `validator accepted unsafe contradiction: ${fixture.sentence}`,
      ).toContain(`unsafe contradiction: ${fixture.sentence}`);
    }
  });

  test("rejects nearby pre-check wording without indivisible operation binding", () => {
    const candidate = skill.replace(
      "admission and execution are one indivisible atomic\ntransaction",
      "admission is a separate pre-check before the later\ntransaction",
    );

    expect(candidate).not.toBe(skill);
    expect(contractViolations(candidate)).toContain(
      "missing structure: atomic root and directory operation binding",
    );
  });

  test("output proves canonical scope and forbids out-of-tree or coordinator mutation", () => {
    const roles = section("Scope and Roles");
    const outputFields = fieldNames(fencedText(section("Output Contract")));

    expect(roles).toMatch(/coordinator[\s\S]*does not edit live skill files/);
    expect(roles).toMatch(
      /may mutate only exact admitted paths inside the resolved[\s\S]*Codewith skills tree/,
    );
    expect(roles).toMatch(/Do not mutate[\s\S]*any path outside each target's[\s\S]*Codewith skills tree/);
    expect(outputFields).toEqual([
      "result",
      "worker_id",
      "run_id",
      "source_repository_or_package",
      "source_package_version_and_integrity",
      "source_commit",
      "source_path",
      "source_hash",
      "machines",
      "root_admission",
      "selected_target_inventory",
      "changed_skills",
      "missing_skills",
      "conflicting_skills",
      "target_hashes",
      "validation",
      "secret_scan",
      "rollback_receipts",
      "rollback_state",
      "exact_path_allowlist",
      "touched_path_ledger",
      "guarded_operations",
      "scope_proof",
      "blockers",
    ]);
    expect(section("Output Contract")).toMatch(
      /no path outside an exact selected Codewith skill directory changed/,
    );
    expect(section("Output Contract")).toMatch(
      /actual\s+canonical touched-path set is a subset of the exact canonical allowlist/,
    );
  });

  test("README limits distribution to tracked post-merge Codewith workflow", () => {
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toMatch(
      /Codewith is a supported distribution target\. After a change merges, use the[\s\S]*`agent-skills\/fleet-skill-normalization\/SKILL\.md` workflow/,
    );
    expect(readme).toMatch(/only explicitly scoped Codewith skill directories from the exact merged[\s\S]*commit/);
    expect(readme).toContain(
      "Other tool adaptation and distribution is separate unless explicitly scoped.",
    );
    expect(readme).not.toContain("skill-sync");
    expect(readme).not.toMatch(/all five machines|~\/\.(?:claude|codex)/);
  });
});
