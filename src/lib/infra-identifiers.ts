/**
 * infra-identifiers.ts — R4 enforcement: vendor infrastructure identifiers live
 * behind ONE indirection.
 *
 * The open-source repository must never name the infrastructure of whoever
 * happens to operate it. Account IDs, ARNs, ECS cluster/service/task-family
 * names, container names and health hosts are properties of a *deployment*, not
 * of the software, so they resolve at deploy time from a deploy manifest or CI
 * variables. At most one tracked line may name where that manifest lives.
 *
 * This module expresses that as a set of PROPERTIES rather than a blocklist of
 * known-bad strings, so it survives renaming (`skills-prod-worker` ->
 * `widgets-stage-queue` is caught just the same) and catches semantic inversion
 * (re-hardcoding a value that used to be parameterized).
 *
 * The five properties:
 *
 *   1. `aws-account-id`  — a literal 12-digit AWS account ID. Anchored on
 *      non-alphanumeric/non-hyphen boundaries so it does NOT fire inside UUIDs
 *      (`...-8000-000000000000`) or 13-digit millisecond epochs.
 *   2. `aws-arn`         — an ARN whose account field is a literal.
 *   3. `infra-resource-name` — the `<app>-<env>[-<component>]` naming convention
 *      that AWS resources follow, with a LITERAL app segment. A name assembled
 *      from a substitution (`${{ env.APP }}-prod-gha-deploy`) is compliant and
 *      is not flagged.
 *   4. `unparameterized-workflow-infra` — inside a workflow, an env assignment
 *      whose key names an infrastructure resource (CLUSTER / SERVICE / FAMILY /
 *      CONTAINER / ECR / HEALTH_URL / SUBNET / SECURITY_GROUP) but whose value
 *      contains no substitution at all. This is the rule that catches a plain
 *      literal like `skills-worker` that follows no naming convention.
 *   5. `workflow-vendor-host` — a literal URL host inside a workflow that is not
 *      a well-known CI/tooling host. Deploy and health targets are deployment
 *      configuration, not source.
 *
 * Plus one cardinality property: `manifest-location-not-unique` — more than one
 * tracked line naming the deploy-manifest location.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type InfraRuleId =
  | "aws-account-id"
  | "aws-arn"
  | "infra-resource-name"
  | "unparameterized-workflow-infra"
  | "workflow-vendor-host"
  | "manifest-location-not-unique"
  | "unscannable-file";

export type InfraFinding = {
  file: string;
  line: number;
  ruleId: InfraRuleId;
  /** The offending text, trimmed to keep CI logs readable. */
  match: string;
  message: string;
};

export type ScannedFile = {
  /** Repo-relative path, POSIX separators. */
  path: string;
  content: string;
};

/**
 * A literal 12-digit AWS account ID.
 *
 * The boundary classes exclude hyphens and word characters on BOTH sides. A bare
 * `\b[0-9]{12}\b` matches the final group of a UUID (`8000-000000000000`) and
 * the tail of longer digit runs, which is exactly the false positive that makes
 * naive versions of this check get switched off.
 */
const AWS_ACCOUNT_ID = /(?<![0-9A-Za-z_-])[0-9]{12}(?![0-9A-Za-z_-])/;

/** An ARN whose account-id field is a literal rather than a substitution. */
const AWS_ARN_LITERAL_ACCOUNT = /arn:aws[a-z0-9-]*:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:/;

/**
 * The `<app>-<env>[-<component>]` infrastructure naming convention, where the
 * app segment is a literal word. `(?<![\w}$-])` rejects a name whose leading
 * segment came from a substitution such as `${{ env.APP }}-prod-...`, which is
 * the compliant form.
 *
 * The environment alternatives are deliberately conservative. A bare `-stage`
 * is excluded because it is ordinary English ("multi-stage build",
 * "company-stage roadmap") and a check that cries wolf gets switched off;
 * likewise `-production` is only flagged when a third component follows, so the
 * concurrency group `deploy-production` does not trip it. Nothing is lost in
 * the place that matters: inside a workflow, `unparameterized-workflow-infra`
 * catches ANY literal assigned to an infrastructure-named variable, whatever it
 * is called.
 */
const INFRA_RESOURCE_NAME =
  /(?<![\w}$-])[a-z][a-z0-9]{2,}-(?:(?:prod|stg|staging|preprod)\b|production-[a-z0-9])/;

/** Env keys that name a piece of infrastructure. */
const INFRA_ENV_KEY =
  /^(?:[A-Z0-9_]*_)?(?:CLUSTER|SERVICE|FAMILY|CONTAINER|ECR|ECR_URL|HEALTH_URL|SUBNETS?|SECURITY_GROUPS?|TASK_DEFINITION|ROLE_ARN)$/;

/** Any form of deferred substitution: GitHub expression, shell var, or step output. */
const HAS_SUBSTITUTION = /\$\{\{|\$\{|\$[A-Za-z_]/;

/** Hosts a workflow may legitimately contact; everything else is deploy config. */
const ALLOWED_WORKFLOW_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "ghcr.io",
  "registry.npmjs.org",
  "npmjs.org",
  "bun.sh",
  "get.pnpm.io",
  "sh.rustup.rs",
  "example.com",
  "localhost",
]);

const WORKFLOW_URL = /https?:\/\/([A-Za-z0-9._-]+)/g;

/**
 * A literal SSM-style deploy-manifest path (`'/hasna/deploy/...'`). Note this
 * matches the line that NAMES the location, not the lines that dereference the
 * variable holding it — those may appear as often as the script needs.
 */
const MANIFEST_LOCATION = /["'`(]\/[a-z0-9_-]+\/deploy\//;

const WORKFLOW_PATH = /^\.github\/workflows\/.+\.ya?ml$/;

/**
 * The detector's own module and test are exempt from the repository scan.
 *
 * They exist to DEFINE and EXERCISE these patterns, so they necessarily contain
 * a literal account ID, a literal ARN and a literal resource name as test
 * vectors — a scanner that flags its own fixtures is a scanner that gets
 * disabled. The exemption is deliberately two exact paths, never a prefix or a
 * glob, and `infra-identifiers.test.ts` asserts that this set does not grow.
 * (Same shape as the audited `scanAllowlist` in scripts/release-guard.ts.)
 */
export const SELF_EXCLUDED_PATHS: readonly string[] = [
  "src/lib/infra-identifiers.ts",
  "src/lib/infra-identifiers.test.ts",
];

/**
 * A line may opt out of ONE rule with a trailing marker, e.g.
 * `# r4-allow: infra-resource-name -- reason`. Used for the rare case where the
 * literal genuinely is not infrastructure (documentation of the convention
 * itself). Never wildcards: the rule id must be named.
 */
const ALLOW_MARKER = /r4-allow:\s*([a-z-]+)/;

function isAllowed(line: string, ruleId: InfraRuleId): boolean {
  const marker = ALLOW_MARKER.exec(line);
  return marker?.[1] === ruleId;
}

function trimMatch(value: string): string {
  const collapsed = value.trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

/**
 * Scan already-loaded file contents for R4 violations. Pure — no filesystem, no
 * git — so it is trivially testable with synthetic inputs.
 */
export function scanInfraIdentifiers(files: ScannedFile[]): InfraFinding[] {
  const findings: InfraFinding[] = [];
  const manifestLocationLines: { file: string; line: number }[] = [];

  for (const file of files) {
    const isWorkflow = WORKFLOW_PATH.test(file.path);
    const lines = file.content.split("\n");

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      const lineNumber = index + 1;

      const push = (ruleId: InfraRuleId, match: string, message: string) => {
        if (isAllowed(line, ruleId)) return;
        findings.push({ file: file.path, line: lineNumber, ruleId, match: trimMatch(match), message });
      };

      const arn = AWS_ARN_LITERAL_ACCOUNT.exec(line);
      if (arn) {
        push(
          "aws-arn",
          arn[0],
          "ARN embeds a literal account ID; resolve the ARN from a secret or the deploy manifest.",
        );
      }

      const account = AWS_ACCOUNT_ID.exec(line);
      if (account) {
        push(
          "aws-account-id",
          account[0],
          "literal 12-digit AWS account ID; supply it via a CI secret (e.g. secrets.AWS_ACCOUNT_ID).",
        );
      }

      const resource = INFRA_RESOURCE_NAME.exec(line);
      if (resource) {
        push(
          "infra-resource-name",
          resource[0],
          "literal <app>-<env> infrastructure resource name; resolve it from the deploy manifest or a CI variable.",
        );
      }

      if (MANIFEST_LOCATION.test(line)) {
        manifestLocationLines.push({ file: file.path, line: lineNumber });
      }

      if (!isWorkflow) continue;

      const env = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*(\S.*?)\s*$/.exec(line);
      if (env) {
        const key = env[1] ?? "";
        // Test the EFFECTIVE value, not the rest of the line. A trailing YAML
        // comment is not part of the value, so a substitution mentioned only in
        // a comment must not satisfy the rule:
        //   WORKER_CONTAINER: skills-worker # TODO use ${{ steps.m.outputs.x }}
        // resolves to the bare literal `skills-worker`. Matching YAML's own rule,
        // a comment starts at `#` preceded by whitespace. Stripping inside a
        // quoted value can only make this check stricter, never blinder.
        const value = (env[2] ?? "").replace(/\s+#.*$/, "");
        if (INFRA_ENV_KEY.test(key) && !HAS_SUBSTITUTION.test(value)) {
          push(
            "unparameterized-workflow-infra",
            `${key}: ${value}`,
            `workflow env '${key}' names infrastructure but is assigned a literal; read it from the deploy manifest.`,
          );
        }
      }

      for (const url of line.matchAll(WORKFLOW_URL)) {
        const host = (url[1] ?? "").toLowerCase();
        if (ALLOWED_WORKFLOW_HOSTS.has(host)) continue;
        if (host.endsWith(".githubusercontent.com")) continue;
        push(
          "workflow-vendor-host",
          url[0],
          `workflow contacts literal host '${host}'; deploy and health targets are deployment configuration.`,
        );
      }
    }
  }

  if (manifestLocationLines.length > 1) {
    for (const location of manifestLocationLines.slice(1)) {
      findings.push({
        file: location.file,
        line: location.line,
        ruleId: "manifest-location-not-unique",
        match: `${location.file}:${location.line}`,
        message:
          "more than one tracked line names the deploy-manifest location; R4 permits exactly one. " +
          `First occurrence: ${manifestLocationLines[0]?.file}:${manifestLocationLines[0]?.line}.`,
      });
    }
  }

  return findings;
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".wav",
  ".lockb",
]);

function isProbablyBinary(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * List git-tracked files. `git ls-files` never descends into `node_modules`
 * unless it is tracked, which sidesteps the CI-grep-vs-interactive-grep trap:
 * GNU grep in CI does not auto-exclude `node_modules`, and two vendored trees
 * exist in this repo. The explicit filter below is belt-and-braces for the case
 * where a vendored tree IS tracked.
 */
/**
 * Whether `repoRoot` is inside a git work tree.
 *
 * R4 is a property of a *repository*: the leak it prevents lives in tracked
 * files such as `.github/workflows`. The release guard is also exercised against
 * synthetic package fixtures in a bare temp directory, where there are no
 * tracked files and the rule has nothing to say. Callers use this to tell
 * "not applicable here" apart from "the scan broke", which must stay fatal.
 *
 * This is NOT an escape hatch for the real repository: `bun test` runs the scan
 * against the repo root on every CI run regardless of what the release guard
 * decides, so the property cannot lapse by moving where the guard is invoked.
 */
export function isGitWorkTree(repoRoot: string): boolean {
  try {
    const output = execFileSync("git", ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() === "true";
  } catch {
    return false;
  }
}

export function listTrackedFiles(repoRoot: string): string[] {
  const output = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .filter((path) => !path.split("/").includes("node_modules"));
}

/**
 * Why a tracked file was not scanned. Every tracked path lands in exactly one of
 * scanned / skipped / self-excluded, and the scan asserts the three add up.
 * There is no fourth outcome and no silent drop.
 */
export type SkipReason = "binary-extension" | "not-a-regular-file" | "unreadable";

export type SkippedFile = { path: string; reason: SkipReason };

export type ReadResult = { files: ScannedFile[]; skipped: SkippedFile[] };

/**
 * Read tracked files for scanning.
 *
 * This function used to do `if (buffer.includes(0)) continue` — dropping any
 * file containing a NUL byte, with no counter and no warning. That is a bypass,
 * not a heuristic: appending one NUL to a comment removed a file from the scan
 * entirely, and `src/lib/content-scan.ts` (NUL at byte 8373, a deliberate
 * composite-key separator) was already being dropped on a clean tree.
 *
 * A NUL byte is now simply a byte. The content is decoded and scanned like any
 * other; the patterns work fine on a string that happens to contain U+0000.
 * The only remaining non-scans are the ones named in SkipReason, and each is
 * returned to the caller rather than swallowed.
 */
export function readTrackedFiles(repoRoot: string, paths: string[]): ReadResult {
  const files: ScannedFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const path of paths) {
    if (isProbablyBinary(path)) {
      skipped.push({ path, reason: "binary-extension" });
      continue;
    }
    const absolute = join(repoRoot, path);
    // Submodule gitlinks and dangling symlinks appear in `git ls-files` but are
    // not readable regular files.
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      skipped.push({ path, reason: "not-a-regular-file" });
      continue;
    }
    try {
      files.push({ path, content: readFileSync(absolute).toString("utf8") });
    } catch {
      skipped.push({ path, reason: "unreadable" });
    }
  }

  return { files, skipped };
}

export type InfraScanResult = {
  findings: InfraFinding[];
  scannedFileCount: number;
  /** Every tracked file that was not scanned, with the reason. Never empty-by-omission. */
  skippedFiles: SkippedFile[];
  trackedFileCount: number;
};

/**
 * The pipeline file whose scanning is load-bearing for this rule. Asserted
 * against the SCANNED set rather than the listed set: "git knows about it" is
 * not "we read it", and the difference between those two was a live bypass.
 */
const REQUIRED_SCANNED_FILE = ".github/workflows/deploy.yml";

/**
 * Scan the repository's tracked files.
 *
 * Throws rather than returning a clean result when the scan cannot honestly
 * claim coverage: no tracked files, an accounting shortfall, no workflow
 * scanned, or the deploy pipeline missing from the files actually read. Every
 * one of those would otherwise be a vacuous pass.
 */
export function scanRepositoryInfraIdentifiers(repoRoot: string): InfraScanResult {
  const tracked = listTrackedFiles(repoRoot);
  if (tracked.length === 0) {
    throw new Error("infra-identifier scan found no tracked files; the scan target is wrong.");
  }

  const selfExcluded = tracked.filter((path) => SELF_EXCLUDED_PATHS.includes(path));
  const scannable = tracked.filter((path) => !SELF_EXCLUDED_PATHS.includes(path));
  const { files, skipped } = readTrackedFiles(repoRoot, scannable);

  // Full accounting. Every tracked path must be scanned, skipped with a stated
  // reason, or self-excluded. If these do not add up, a file vanished through a
  // path nobody is tracking, and the result cannot be trusted.
  const accounted = files.length + skipped.length + selfExcluded.length;
  if (accounted !== tracked.length) {
    throw new Error(
      `infra-identifier scan accounting shortfall: ${tracked.length} tracked but ` +
        `${files.length} scanned + ${skipped.length} skipped + ${selfExcluded.length} self-excluded ` +
        `= ${accounted}. ${tracked.length - accounted} file(s) disappeared without a reason.`,
    );
  }

  const scannedPaths = new Set(files.map((file) => file.path));
  if (!files.some((file) => WORKFLOW_PATH.test(file.path))) {
    throw new Error(
      "infra-identifier scan read no .github/workflows/*.yml files. If the pipeline genuinely " +
        "moved out of this repository, delete this assertion deliberately rather than letting the " +
        "guard pass vacuously.",
    );
  }
  if (!scannedPaths.has(REQUIRED_SCANNED_FILE) && tracked.includes(REQUIRED_SCANNED_FILE)) {
    throw new Error(
      `infra-identifier scan did not read ${REQUIRED_SCANNED_FILE}, although git tracks it. ` +
        "Being listed is not being scanned; something removed it from the scanned set.",
    );
  }

  const findings = scanInfraIdentifiers(files);

  // An unreadable tracked file is a FINDING, not a skip. A file the guard cannot
  // read is a file the guard cannot clear.
  for (const file of skipped) {
    if (file.reason !== "unreadable") continue;
    findings.push({
      file: file.path,
      line: 0,
      ruleId: "unscannable-file",
      match: file.path,
      message: "tracked file could not be read, so it cannot be cleared of infrastructure identifiers.",
    });
  }

  return {
    findings,
    scannedFileCount: files.length,
    skippedFiles: skipped,
    trackedFileCount: tracked.length,
  };
}

export function formatInfraFindings(findings: InfraFinding[]): string {
  return findings
    .map((finding) => `  ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.match}\n      ${finding.message}`)
    .join("\n");
}
