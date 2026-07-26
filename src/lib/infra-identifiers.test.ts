import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scanInfraIdentifiers,
  scanRepositoryInfraIdentifiers,
  formatInfraFindings,
  isGitWorkTree,
  listTrackedFiles,
  readTrackedFiles,
  PINNED_SKIPS,
  SELF_EXCLUDED_PATHS,
  type InfraRuleId,
} from "./infra-identifiers.js";
import { decodeForScanning, looksBinary } from "./file-bytes.js";
import { scanText } from "./content-scan.js";

const repoRoot = process.cwd();

const WORKFLOW = ".github/workflows/deploy.yml";

/**
 * Line-based rules (account IDs, ARNs, resource names) apply to every tracked
 * file, so they are exercised against an ordinary source path. Workflow-only
 * rules get the helpers below, which build a REAL document — the env rule is
 * evaluated by parsing YAML, so a bare fragment is not a valid fixture.
 */
function ruleIds(content: string, path = "src/lib/sample.ts"): InfraRuleId[] {
  return scanInfraIdentifiers([{ path, content }]).map((finding) => finding.ruleId);
}

/** Wrap step-level `env:` lines (already indented 10 spaces) into a valid workflow. */
function workflowWithEnv(envLines: string): string {
  return `name: deploy\non:\n  push: {}\njobs:\n  deploy:\n    steps:\n      - name: step\n        env:\n${envLines}`;
}

/** Wrap a shell line into a valid workflow `run:` block. */
function workflowWithRun(runLine: string): string {
  return `name: deploy\non:\n  push: {}\njobs:\n  deploy:\n    steps:\n      - name: step\n        run: |\n          ${runLine}\n`;
}

function envRuleIds(envLines: string): InfraRuleId[] {
  return ruleIds(workflowWithEnv(envLines), WORKFLOW);
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

  test("the exempt files are AUDITED, not blind: every finding in them is pinned", () => {
    // Review finding 1, second round. The first fix asserted ONE property
    // (contiguous 12-digit literal) over a surface exempt from ALL rules, so a
    // vendor host, a cluster name and a manifest path all sailed through -- and
    // one really was live: the repo's only tracked `<vendor>.hasna.xyz` sat in
    // this file, the one place the scanner cannot see.
    //
    // So run the FULL scanner over the exempt files and require every finding to
    // be pinned by (file, ruleId, match). Anything new fails until a human adds
    // it here. That turns the exemption from "unscanned" into "audited".
    const pinned = new Set([
      // Fixtures that must stay literal for the detector's own tests to mean anything.
      "infra-resource-name|skills-prod", // module docstring + fixtures
      "infra-resource-name|widgets-staging",
      "aws-account-id|123456789012", // RFC-style documentation account
      "aws-account-id|175357440000", // epoch anchoring vector
      "aws-account-id|000000000000", // UUID node field
      "aws-arn|arn:aws:iam::123456789012:",
      "workflow-vendor-host|https://health.invalid", // RFC 2606 reserved TLD
      "manifest-location-not-unique|'/acme/deploy/", // deliberately not the real path
      "manifest-location-not-unique|('/acme/deploy/",
    ]);

    const { files } = readTrackedFiles(repoRoot, [...SELF_EXCLUDED_PATHS]);
    expect(files.length).toBe(SELF_EXCLUDED_PATHS.length);

    // Scan each exempt file three ways:
    //   1. as itself;
    //   2. concatenation-flattened, so an identifier split across a string `+`
    //      cannot hide here (which is why nothing in this file may write a split
    //      12-digit literal, even in a comment -- the flattener reassembles it);
    //   3. aliased to a workflow path, so the workflow-only rules
    //      (`workflow-vendor-host`) apply as well. Without this, a vendor
    //      hostname in these files is invisible to every rule -- and one really
    //      was.
    const variants = files.flatMap((file) => {
      const flattened = file.content.replace(/["']\s*\+\s*["']/g, "");
      return [
        file,
        { path: file.path, content: flattened },
        { path: `.github/workflows/${file.path.replace(/\//g, "-")}.yml`, content: flattened },
      ];
    });

    const unpinned = scanInfraIdentifiers(variants)
      // The aliased copies are not real YAML; that they do not parse is expected.
      .filter((finding) => finding.ruleId !== "unparseable-workflow")
      .map((finding) => `${finding.ruleId}|${finding.match}`)
      .filter((key) => !pinned.has(key));

    expect([...new Set(unpinned)]).toEqual([]);
  });

  test("the r4-allow opt-out is capped, per file", () => {
    // ALLOW_MARKER is an unbounded per-line opt-out usable in ANY tracked file.
    // SELF_EXCLUDED_PATHS and release-guard's scanAllowlist are both pinned by a
    // test; this one was not, so `# r4-allow: aws-account-id` appended anywhere
    // silenced the rule with nothing to notice it.
    const expected: Record<string, number> = {
      // The implementation (regex + docstring) and its tests. No production use.
      "src/lib/infra-identifiers.ts": 2,
      "src/lib/infra-identifiers.test.ts": 4,
    };

    const counts: Record<string, number> = {};
    const { files } = readTrackedFiles(repoRoot, listTrackedFiles(repoRoot));
    for (const file of files) {
      const n = (file.content.match(/r4-allow:/g) ?? []).length;
      if (n > 0) counts[file.path] = n;
    }
    expect(counts).toEqual(expected);
  });

  test("a NUL byte cannot remove a file from the scan", () => {
    // Review finding 2: readTrackedFiles did `if (buffer.includes(0)) continue`,
    // silently dropping any NUL-bearing file, so appending one NUL to a comment
    // hid an arbitrary leak.
    //
    // The fixture is WRITTEN here rather than pointing at a source file that
    // happens to contain a NUL. This test used to assert that
    // src/lib/content-scan.ts still had one, which made a production file's
    // bytes load-bearing for the suite: the moment that NUL was replaced with a
    // `\0` escape (it made grep treat the module as binary), the suite went red
    // for a reason that had nothing to do with the property under test.
    const dir = mkdtempSync(join(tmpdir(), "nul-tracked-"));
    try {
      const nulFile = "src/lib/nul-bearing.ts";
      mkdirSync(join(dir, "src/lib"), { recursive: true });
      writeFileSync(join(dir, nulFile), `const sep = "\0";\nconst kept = true;\n`);
      expect(readFileSync(join(dir, nulFile)).includes(0)).toBe(true);

      const { files, skipped } = readTrackedFiles(dir, [nulFile]);
      expect(files.map((f) => f.path)).toEqual([nulFile]);
      expect(skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // And a leak inside NUL-bearing content is still found.
    const withNul = `const sep = "\0";\nconst account = "123456789012";\n`;
    expect(ruleIds(withNul, "src/lib/x.ts")).toContain("aws-account-id");
  });

  test("encoding tricks cannot hide an identifier", () => {
    // Second-round review: NUL-at-byte-0 and friends were fixed, but three
    // vectors still passed -- NUL interleaved INTO the digits, UTF-16, and a
    // text file skipped purely because it was named *.gz.
    const account = "123456789012";
    const hidden = (buffer: Buffer) => ruleIds(decodeForScanning(buffer), "src/lib/x.ts");

    // NUL interleaved through the digits themselves (one literal, no JS concat).
    const interleaved = account.split("").join("\0");
    expect(hidden(Buffer.from(`const a = "${interleaved}";\n`))).toContain("aws-account-id");

    // UTF-16, both endiannesses, with and without a BOM.
    const le = Buffer.from(`const a = "${account}";\n`, "utf16le");
    expect(hidden(Buffer.concat([Buffer.from([0xff, 0xfe]), le]))).toContain("aws-account-id");
    expect(hidden(le)).toContain("aws-account-id");
    expect(hidden(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]))).toContain("aws-account-id");

    // Binary-ness is decided by CONTENT, not by filename.
    expect(looksBinary(Buffer.from(`arn:aws:iam::${account}:role/x`))).toBe(false);
    expect(looksBinary(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(true); // real gzip
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true); // real PNG
  });

  test("a NUL byte cannot hide a secret from the publish gate either", () => {
    // The root claim of the second review: the identical NUL drop was still live
    // in content-scan.ts, which is the actual secret/PII gate at prepack. The R4
    // scan was only ever one of three call sites.
    const phone = "+1312" + "8675309";
    expect(scanText(decodeForScanning(Buffer.from(`Call ${phone}\n`)), "x.md").length).toBeGreaterThan(0);
    expect(scanText(decodeForScanning(Buffer.from(`Call +1\x003128675309\n`)), "x.md").length).toBeGreaterThan(0);
  });

  test("every tracked file is scanned, skipped with a reason, or self-excluded", () => {
    // The accounting that makes finding 2 structurally impossible to repeat.
    const result = scanRepositoryInfraIdentifiers(repoRoot);
    const tracked = listTrackedFiles(repoRoot);

    expect(result.trackedFileCount).toBe(tracked.length);
    expect(result.scannedFileCount + result.skippedFiles.length + SELF_EXCLUDED_PATHS.length).toBe(tracked.length);

    // Nothing is skipped today, and any skip at all is now a finding unless
    // pinned -- "logged but forgiven" is how the NUL drop survived.
    expect(result.skippedFiles).toEqual([]);
    expect(PINNED_SKIPS).toEqual([]);
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
    expect(envRuleIds(bypass)).toContain("unparameterized-workflow-infra");

    // Same shape, other infra keys.
    expect(envRuleIds("          CLUSTER: my-things # later: ${{ steps.m.outputs.cluster }}\n")).toContain(
      "unparameterized-workflow-infra",
    );

    // A real substitution with a trailing comment is still compliant.
    expect(envRuleIds("          CLUSTER: ${{ steps.m.outputs.cluster }} # from the manifest\n")).toEqual([]);
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
    expect(envRuleIds("          WORKER_CONTAINER: skills-worker\n")).toContain("unparameterized-workflow-infra");
    expect(envRuleIds("          CLUSTER: my-things\n")).toContain("unparameterized-workflow-infra");
  });

  test("detects a literal deploy or health host in a workflow", () => {
    // Reserved-TLD host (RFC 2606). The vendor's real hostname must not appear
    // in a tracked file even as a fixture -- least of all in the one file the
    // scanner cannot see.
    expect(ruleIds(workflowWithRun("curl -fsS https://health.invalid/health"), WORKFLOW)).toContain(
      "workflow-vendor-host",
    );
  });

  test("detects a second tracked line naming the deploy-manifest location", () => {
    const findings = scanInfraIdentifiers([
      { path: ".github/workflows/deploy.yml", content: "  M: ${{ format('/acme/deploy/{0}', env.APP) }}\n" },
      { path: "docs/ops.md", content: "the manifest is at '/acme/deploy/thing'\n" },
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
      "",
    ].join("\n");
    expect(envRuleIds(content)).toEqual([]);
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
    expect(ruleIds(workflowWithRun("curl -fsSL https://bun.sh/install | bash"), WORKFLOW)).toEqual([]);
    expect(ruleIds(workflowWithRun("gh api https://api.github.com/repos/o/r"), WORKFLOW)).toEqual([]);
  });

  test("an allow marker suppresses exactly one named rule and nothing else", () => {
    const suppressed = "          CLUSTER: my-things # r4-allow: unparameterized-workflow-infra -- doc example\n";
    expect(envRuleIds(suppressed)).toEqual([]);

    // A marker for a different rule does not suppress this one.
    const wrongRule = "          CLUSTER: my-things # r4-allow: aws-account-id\n";
    expect(envRuleIds(wrongRule)).toContain("unparameterized-workflow-infra");
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
