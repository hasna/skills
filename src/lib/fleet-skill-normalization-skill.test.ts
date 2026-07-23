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

function expectRejects(content: string, unsafePattern: RegExp): void {
  const normalized = content.replace(/\s+/g, " ");
  const match = normalized.match(unsafePattern);
  expect(match, `missing negative case for ${unsafePattern}`).not.toBeNull();
  const offset = match?.index ?? 0;
  const context = normalized.slice(Math.max(0, offset - 160), offset + (match?.[0].length ?? 0) + 160);
  expect(
    context,
    `unsafe wording must be explicitly fail-closed near: ${match?.[0] ?? unsafePattern}`,
  ).toMatch(/\b(?:reject|forbid|forbidden|never|fail|stop|without|unavailable)\b/i);
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
      /frontmatter containing exactly `name` and[\s\S]*`description`, in that order/,
    );
    expect(adaptation).toMatch(
      /both values as deterministic,[\s\S]*JSON-compatible double-quoted YAML scalars/,
    );
    expectOrdered(adaptation, [
      "LF-only delimiters",
      "ordered key lines",
      "closing delimiter plus LF",
      "source body",
      "normalize only its line endings to LF",
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
      "absolute, normalized directory path",
      "canonical realpath",
      "without following symlinks",
      "retained root handle",
    ]);
    expect(admission).toMatch(
      /Record both the absolute normalized lexical path and its canonical path[\s\S]*canonicalize the[\s\S]*existing parent first/,
    );
    expect(admission).toMatch(
      /whether existing or absent[\s\S]*never invoke a[\s\S]*symlink-following realpath operation on the final component/,
    );
    expect(admission).toMatch(
      /Reject `\.\.`, `\.`, empty segments, repeated separators, alternate[\s\S]*A selected skill name must be one basename, never a path/,
    );
    expect(admission).toMatch(
      /any canonical path not strictly inside the exact canonical[\s\S]*root and its exact selected skill directory/,
    );
    expectRejects(admission, /\.\.|non-normalized|absolute child|path escapes?/i);
    expect(skill).not.toMatch(/\b(?:allow|accept|follow)\b[^\n]*(?:traversal|\.\.|outside the root)/i);
  });

  test("rejects symlink components, hard links, special files, and no-follow uncertainty", () => {
    const admission = section("Canonical Path Admission");

    expect(admission).toMatch(
      /Walk every component from the retained root handle with no-follow semantics[\s\S]*Reject symlinked or magic-link components[\s\S]*cross-mount components/,
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
    expectRejects(admission, /symlink|magic-link|hard-linked|special file|cannot be proven/i);
    expect(skill).not.toMatch(/\b(?:allow|accept|follow)\b[^\n]*(?:symlink|magic-link|special file)/i);
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
    expectRejects(admission, /pre-existing|previously used|reuse|overwrite/i);
    expect(skill).not.toMatch(
      /\b(?:may|can|should|must)\b[^\n]*(?:reuse|truncate|overwrite)[^\n]*(?:temp|preimage|receipt)/i,
    );
  });

  test("makes the authoritative canonical touched ledger an exact allowlist subset", () => {
    const allowlist = section("Inventory and Exact-Path Allowlist");

    expect(allowlist).toMatch(
      /allowlist records both the normalized lexical path and canonical path for every[\s\S]*Directory-prefix, recursive, glob, or wildcard admission is forbidden/,
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
    expectRejects(allowlist, /Directory-prefix|wildcard|unselected|remote-only/i);
    expect(skill).not.toMatch(
      /\b(?:allow|accept|sufficient)\b[^\n]*(?:directory-prefix|directory prefix|glob|wildcard)/i,
    );
  });

  test("requires guarded replacement to return the exact inventoried preimage", () => {
    const inventory = section("Inventory and Exact-Path Allowlist");
    const forward = section("Guarded Forward Mutation");

    expect(inventory).toMatch(
      /capture its exact inventoried[\s\S]*bytes, inode identity, metadata, and hash[\s\S]*atomically return the exact displaced preimage/,
    );
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
      /missing target uses one atomic create-if-absent[\s\S]*fail if any object appeared after inventory/,
    );
    expectRejects(forward, /compare-then-rename|unconditional rename|cannot prove/i);
  });

  test("rolls back only after comparing exact run-installed state and preserves conflicts", () => {
    const rollback = section("Guarded Rollback");

    expectOrdered(rollback, [
      "compare the current no-follow target",
      "exact installed inode/metadata and target hash",
      "Only an exact match",
      "restores the admitted preimage",
      "preserves the displaced failed target",
    ]);
    expect(rollback).toMatch(
      /If the current target[\s\S]*drifted, preserve it and report a rollback conflict/,
    );
    expect(rollback).toMatch(
      /absent pre-state[\s\S]*atomically comparing its current inode\/metadata and hash[\s\S]*Verify the target is absent with a no-follow lookup/,
    );
    expectRejects(rollback, /recursive deletion|unconditional restore|unconditional restore\/remove/i);
    expect(skill).not.toMatch(
      /^(?![^\n]*\b(?:never|reject|forbid)\b)[^\n]*\b(?:perform|use|allow)\b[^\n]*(?:unconditional restore|unconditional remove|recursive deletion)/im,
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
