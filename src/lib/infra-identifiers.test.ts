import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scanInfraIdentifiers,
  scanRepositoryInfraIdentifiers,
  formatInfraFindings,
  isGitWorkTree,
  listTrackedFiles,
  readTrackedFiles,
  SELF_EXCLUDED_PATHS,
  type InfraRuleId,
} from "./infra-identifiers.js";

const repoRoot = process.cwd();

function ruleIds(content: string, path = ".github/workflows/deploy.yml"): InfraRuleId[] {
  return scanInfraIdentifiers([{ path, content }]).map((finding) => finding.ruleId);
}

describe("R4: vendor infra identifiers live behind one indirection", () => {
  // -------------------------------------------------------------------------
  // The live property. This is the check that actually protects the repository.
  // -------------------------------------------------------------------------
  test("the repository's tracked files contain no literal infra identifier", () => {
    const result = scanRepositoryInfraIdentifiers(repoRoot);

    // Non-emptiness: a guard that scanned nothing passed vacuously.
    expect(result.scannedFileCount).toBeGreaterThan(100);

    if (result.findings.length > 0) {
      throw new Error(`R4 violations in tracked files:\n${formatInfraFindings(result.findings)}`);
    }
    expect(result.findings).toEqual([]);
  });

  test("the scan covers the deploy pipeline itself, not just incidental files", () => {
    const tracked = listTrackedFiles(repoRoot);
    expect(tracked).toContain(".github/workflows/deploy.yml");
  });

  // -------------------------------------------------------------------------
  // Adversarial review of PR #47 found three ways past this guard. One test per
  // hole, each reproducing the exact reported bypass.
  // -------------------------------------------------------------------------

  test("the detector's own fixtures use only documented-fake account IDs", () => {
    // Review finding 1: this file shipped the org's REAL AWS account ID as a
    // fixture, and SELF_EXCLUDED_PATHS made the detector blind to it -- a PR
    // whose purpose was removing infra identifiers put one back.
    // Every 12-digit literal in the exempt files must be an obviously-fake or
    // non-account value, so the exemption can never again hide a real one.
    const allowed = new Set([
      "123456789012", // RFC-style documentation account
      "175357440000", // epoch test vector for the anchoring tests
      "000000000000", // UUID node field in the UUID false-positive test
    ]);
    for (const path of SELF_EXCLUDED_PATHS) {
      const content = readFileSync(join(repoRoot, path), "utf8");
      for (const token of content.match(/[0-9]{12}/g) ?? []) {
        expect(`${path}:${token}`).toBe(`${path}:${allowed.has(token) ? token : "DISALLOWED-LITERAL"}`);
      }
    }
  });

  test("a NUL byte cannot remove a file from the scan", () => {
    // Review finding 2: readTrackedFiles did `if (buffer.includes(0)) continue`,
    // silently dropping any NUL-bearing file. src/lib/content-scan.ts (NUL at
    // byte 8373) was already being dropped on a clean tree, and appending one
    // NUL to a comment hid an arbitrary leak.
    const nulFile = "src/lib/content-scan.ts";
    expect(readFileSync(join(repoRoot, nulFile)).includes(0)).toBe(true);

    const { files, skipped } = readTrackedFiles(repoRoot, [nulFile]);
    expect(files.map((f) => f.path)).toEqual([nulFile]);
    expect(skipped).toEqual([]);

    // And a leak inside NUL-bearing content is still found.
    const withNul = `const sep = "\0";\nconst account = "123456789012";\n`;
    expect(ruleIds(withNul, "src/lib/x.ts")).toContain("aws-account-id");
  });

  test("every tracked file is scanned, skipped with a reason, or self-excluded", () => {
    // The accounting that makes finding 2 structurally impossible to repeat.
    const result = scanRepositoryInfraIdentifiers(repoRoot);
    const tracked = listTrackedFiles(repoRoot);

    expect(result.trackedFileCount).toBe(tracked.length);
    expect(result.scannedFileCount + result.skippedFiles.length + SELF_EXCLUDED_PATHS.length).toBe(tracked.length);

    // Nothing is skipped today; if that changes, the reason must be stated.
    for (const skippedFile of result.skippedFiles) {
      expect(["binary-extension", "not-a-regular-file", "unreadable"]).toContain(skippedFile.reason);
    }
  });

  test("deploy.yml is asserted against the SCANNED set, not merely the tracked list", () => {
    // scannedFileCount > 100 and "a workflow exists" were both satisfiable while
    // deploy.yml itself went unread.
    const result = scanRepositoryInfraIdentifiers(repoRoot);
    expect(result.scannedFileCount).toBeGreaterThan(100);

    const { files } = readTrackedFiles(
      repoRoot,
      listTrackedFiles(repoRoot).filter((p) => !SELF_EXCLUDED_PATHS.includes(p)),
    );
    expect(files.map((f) => f.path)).toContain(".github/workflows/deploy.yml");
  });

  test("a trailing YAML comment cannot satisfy the substitution requirement", () => {
    // Review finding 3: HAS_SUBSTITUTION was tested against the whole rest of
    // the line, so a substitution mentioned only in a comment passed while the
    // effective value stayed a bare literal.
    const bypass = "          WORKER_CONTAINER: skills-worker # TODO switch to ${{ steps.m.outputs.worker_container }}\n";
    expect(ruleIds(bypass)).toContain("unparameterized-workflow-infra");

    // Same shape, other infra keys.
    expect(ruleIds("  CLUSTER: my-things # later: ${{ steps.m.outputs.cluster }}\n")).toContain(
      "unparameterized-workflow-infra",
    );

    // A real substitution with a trailing comment is still compliant.
    expect(ruleIds("  CLUSTER: ${{ steps.m.outputs.cluster }} # from the manifest\n")).toEqual([]);
  });

  test("the release guard's not-a-git-work-tree skip can never apply to this repo", () => {
    // release-guard.ts skips R4 outside a work tree so its synthetic package
    // fixtures do not fail. That escape must never cover the real repository.
    expect(isGitWorkTree(repoRoot)).toBe(true);
    expect(isGitWorkTree("/")).toBe(false);
  });

  test("only the detector's own two files are exempt from the scan", () => {
    // The exemption exists because this test file must contain literal account
    // IDs and ARNs as vectors. It must never grow into a place to hide a real
    // leak, so the set is pinned exactly.
    expect([...SELF_EXCLUDED_PATHS].sort()).toEqual([
      "src/lib/infra-identifiers.test.ts",
      "src/lib/infra-identifiers.ts",
    ]);
  });

  test("node_modules is excluded explicitly, not by grep's ambient behaviour", () => {
    // Two vendored node_modules trees exist under skills/. CI's GNU grep does
    // not skip them the way an interactive shell wrapper does.
    const tracked = listTrackedFiles(repoRoot);
    expect(tracked.filter((path) => path.includes("node_modules"))).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Each rule detects its violation...
  // -------------------------------------------------------------------------
  test("detects a literal 12-digit AWS account ID", () => {
    expect(ruleIds("          AWS_ACCOUNT: 123456789012\n")).toContain("aws-account-id");
  });

  test("detects a literal account ID in a non-workflow tracked file", () => {
    expect(ruleIds("const account = '123456789012';\n", "src/lib/whatever.ts")).toContain("aws-account-id");
  });

  test("detects an ARN carrying a literal account", () => {
    const line = "          role-to-assume: arn:aws:iam::123456789012:role/deployer\n";
    expect(ruleIds(line)).toContain("aws-arn");
  });

  test("detects an <app>-<env> infrastructure resource name", () => {
    expect(ruleIds("          WORKER_SERVICE: skills-prod-worker\n")).toContain("infra-resource-name");
    expect(ruleIds("cluster = 'widgets-staging-api'\n", "infra/main.tf")).toContain("infra-resource-name");
  });

  test("detects a literal assigned to an infrastructure-named workflow variable", () => {
    // The rule that catches names following no convention at all.
    expect(ruleIds("          WORKER_CONTAINER: skills-worker\n")).toContain("unparameterized-workflow-infra");
    expect(ruleIds("          CLUSTER: my-things\n")).toContain("unparameterized-workflow-infra");
  });

  test("detects a literal deploy or health host in a workflow", () => {
    const line = "          curl -fsS https://skills.hasna.xyz/health\n";
    expect(ruleIds(line)).toContain("workflow-vendor-host");
  });

  test("detects a second tracked line naming the deploy-manifest location", () => {
    const findings = scanInfraIdentifiers([
      { path: ".github/workflows/deploy.yml", content: "  M: ${{ format('/hasna/deploy/{0}', env.APP) }}\n" },
      { path: "docs/ops.md", content: "the manifest is at '/hasna/deploy/skills'\n" },
    ]);
    expect(findings.map((f) => f.ruleId)).toContain("manifest-location-not-unique");
  });

  // -------------------------------------------------------------------------
  // ...and, just as importantly, does not fire on the compliant form.
  // -------------------------------------------------------------------------
  test("accepts an ARN whose account comes from a secret", () => {
    const line =
      "          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/${{ env.APP }}-prod-gha-deploy\n";
    expect(ruleIds(line)).toEqual([]);
  });

  test("accepts infra values read from the deploy manifest", () => {
    const content = [
      "          WORKER_SERVICE: ${{ steps.m.outputs.worker_service }}",
      "          WORKER_FAMILY: ${{ steps.m.outputs.worker_family }}",
      "          WORKER_CONTAINER: ${{ steps.m.outputs.worker_container }}",
      "          CLUSTER: ${{ steps.m.outputs.cluster }}",
      '          curl -fsS "$HEALTH_URL" | jq -e \'.ok == true\'',
      "",
    ].join("\n");
    expect(ruleIds(content)).toEqual([]);
  });

  test("does not fire inside a UUID", () => {
    // `\b[0-9]{12}\b` matches the last group of every UUID. This repo has one
    // at agent-skills/merge-pr/SKILL.md, so the naive pattern is not usable.
    const line = '  --task-id "00000000-0000-4000-8000-000000000000" \\\n';
    expect(ruleIds(line, "agent-skills/merge-pr/SKILL.md")).toEqual([]);
  });

  test("does not fire inside a millisecond epoch timestamp", () => {
    expect(ruleIds("const t = 1753574400000;\n", "src/lib/x.ts")).toEqual([]);
    expect(ruleIds("const t = 175357440000;\n", "src/lib/x.ts")).toContain("aws-account-id");
  });

  test("does not fire on ordinary English containing '-stage' or 'deploy-production'", () => {
    expect(ruleIds("// generate a multi-stage Dockerfile\n", "src/lib/x.ts")).toEqual([]);
    expect(ruleIds("  group: deploy-production\n")).toEqual([]);
  });

  test("does not treat well-known CI hosts as deploy targets", () => {
    const content = [
      "      - uses: actions/checkout@v6",
      "        run: curl -fsSL https://bun.sh/install | bash",
      "        run: gh api https://api.github.com/repos/o/r",
      "",
    ].join("\n");
    expect(ruleIds(content)).toEqual([]);
  });

  test("an allow marker suppresses exactly one named rule and nothing else", () => {
    const suppressed = "  CLUSTER: my-things # r4-allow: unparameterized-workflow-infra -- doc example\n";
    expect(ruleIds(suppressed)).toEqual([]);

    // A marker for a different rule does not suppress this one.
    const wrongRule = "  CLUSTER: my-things # r4-allow: aws-account-id\n";
    expect(ruleIds(wrongRule)).toContain("unparameterized-workflow-infra");
  });

  // -------------------------------------------------------------------------
  // Semantic inversion: the specific regressions this PR removed must stay gone.
  // -------------------------------------------------------------------------
  test("deploy.yml resolves worker identifiers and the health URL indirectly", () => {
    const deploy = readFileSync(join(repoRoot, ".github/workflows/deploy.yml"), "utf8");

    for (const key of ["WORKER_SERVICE", "WORKER_FAMILY", "WORKER_CONTAINER", "HEALTH_URL"]) {
      const assignments = [...deploy.matchAll(new RegExp(`^\\s*${key}:\\s*(.+)$`, "gm"))].map((m) => m[1] ?? "");
      expect(assignments.length).toBeGreaterThan(0);
      for (const value of assignments) {
        expect(value).toMatch(/\$\{\{/);
      }
    }
  });

  test("the health smoke test asserts only the stable /health field", () => {
    const deploy = readFileSync(join(repoRoot, ".github/workflows/deploy.yml"), "utf8");
    // `service` is churning with the product rename and `mode` is being removed
    // outright; asserting either couples the pipeline to a moving payload.
    expect(deploy).not.toMatch(/jq -e[^\n]*\.service\s*==/);
    expect(deploy).not.toMatch(/jq -e[^\n]*\.mode\s*==/);
    expect(deploy).toMatch(/curl -fsS "\$HEALTH_URL"/);
  });

  test("exactly one tracked line names the deploy-manifest location", () => {
    const findings = scanRepositoryInfraIdentifiers(repoRoot).findings;
    expect(findings.filter((f) => f.ruleId === "manifest-location-not-unique")).toEqual([]);
  });
});
