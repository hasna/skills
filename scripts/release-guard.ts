#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { applyAllowlist, scanFiles, scanPaths, toRedactedJson, type ScanAllowlistEntry, type ScanFinding } from "../src/lib/content-scan.js";
import { decodeForScanning, looksBinary } from "../src/lib/file-bytes.js";
import { formatInfraFindings, isGitWorkTree, scanRepositoryInfraIdentifiers } from "../src/lib/infra-identifiers.js";
import { getPackedFiles } from "../src/lib/packlist.js";
import { findPrivatePacklistLeaks, listPrivateSkillSlugs } from "../src/lib/public-boundary.js";
import {
  buildHostedSourceExclusionGlob,
  findHostedSourcePacklistLeaks,
  listHostedMetadataSlugs,
} from "../src/lib/hosted-skill-set.js";
import {
  checkEntryPointCoverage,
  findDisallowedCodeUrls,
  findVendorHostReferences,
  formatFindings,
  isCodeFile,
  readPackedSources,
  uncoveredEntryPoints,
} from "../src/lib/vendor-host-guard.js";

type Finding = {
  file: string;
  marker: string;
  kind: "retired-cloud" | "secret-pattern";
};

type PatternCheck = {
  label: string;
  pattern: RegExp;
};

// ---------------------------------------------------------------------------
// Public-log masking. This guard's failure output is emitted straight into
// (potentially public) CI logs. Secrets and PII are already masked by the
// content-scan redactor, but private-CONTEXT matches — fleet hostnames,
// /home/<user>/ paths, internal CLI/infra names — are carried verbatim in a
// finding's `redacted` field. Re-surfacing those in a public log would leak a
// real username or hostname, so we partially mask them here the SAME way
// secrets/PII are masked: keep a short 2-char locating prefix, star the rest.
// ---------------------------------------------------------------------------
function maskPrivateContextValue(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return value.slice(0, 2) + "*".repeat(value.length - 2);
}

// Mask private-context values embedded in a free-form log line (e.g. an error
// message that interpolates an absolute home path or a fleet hostname).
function sanitizeForPublicLog(text: string): string {
  return text
    .replace(/\/(?:home|Users)\/[a-z_][a-z0-9_-]*/gi, (match) => maskPrivateContextValue(match))
    .replace(/\b(?:apple|spark)0\d\b/g, (match) => maskPrivateContextValue(match));
}

// Re-mask the redacted marker of private-context findings before they are
// serialized into the public failure output. Secret/PII findings are already
// masked by the content-scan redactor and pass through unchanged.
function maskFindingsForPublicLog(findings: ScanFinding[]): ScanFinding[] {
  return findings.map((finding) =>
    finding.category === "private-context"
      ? { ...finding, redacted: maskPrivateContextValue(finding.redacted) }
      : finding,
  );
}

const repoRoot = process.cwd();
const roots = [
  "package.json",
  "README.md",
  "LICENSE",
  "docs/skill-standard.md",
  "skills",
  "bin",
  "dist",
];

const secretRoots = [
  "package.json",
  "README.md",
  "docs/skill-standard.md",
  "skills",
];

const ignoredDirs = new Set([".git", "node_modules"]);

const retiredCloudMarkers = [
  ["@hasna", "cloud"].join("/"),
  ["open", "cloud"].join("-"),
  ["cloud", "mcp"].join("-"),
  "register" + "CloudTools",
  "register" + "CloudCommands",
  ["HASNA", "CLOUD"].join("_"),
  ["OPEN", "CLOUD"].join("_"),
  [".hasna", "cloud"].join("/"),
  "--" + "cloud",
  ["cloud", "setup"].join(" "),
  ["cloud", "sync"].join(" "),
  ["Cloud", "Sync"].join(" "),
  ["HASNA", "RDS", "PASSWORD"].join("_"),
];

const secretPatterns: PatternCheck[] = [
  { label: ["sk", "ant", ""].join("-"), pattern: new RegExp(["sk", "ant", ""].join("-")) },
  { label: ["sk", "proj", ""].join("-"), pattern: new RegExp(["sk", "proj", ""].join("-")) },
  { label: ["npm", ""].join("_"), pattern: new RegExp(["npm", ""].join("_") + "[A-Za-z]") },
  { label: ["gho", ""].join("_"), pattern: new RegExp(["gho", ""].join("_")) },
  { label: ["ghp", ""].join("_"), pattern: new RegExp(["ghp", ""].join("_")) },
  { label: ["secret", "token"].join("-") + ":", pattern: new RegExp(["secret", "token"].join("-") + ":") },
  { label: "ctx7sk" + "-", pattern: new RegExp("ctx7sk" + "-") },
  { label: ["xai", ""].join("-"), pattern: new RegExp(["xai", ""].join("-")) },
  { label: "AI" + "za" + "[A-Za-z0-9]", pattern: new RegExp("AI" + "za" + "[A-Za-z0-9]") },
  { label: "AK" + "IA" + "[A-Z0-9]", pattern: new RegExp("AK" + "IA" + "[A-Z0-9]") },
];



function collectFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const child = join(path, entry.name);
    files.push(...collectFiles(child));
  }
  return files;
}

const secretFiles = new Set(secretRoots.flatMap((root) => collectFiles(join(repoRoot, root))));

const findings: Finding[] = [];
for (const file of roots.flatMap((root) => collectFiles(join(repoRoot, root)))) {
  const buffer = readFileSync(file);
  // A NUL byte used to remove a file from this scan entirely. It no longer does:
  // only real binary content is skipped, and NULs are stripped during decoding.
  if (looksBinary(buffer)) continue;
  const content = decodeForScanning(buffer);
  const relativeFile = relative(repoRoot, file);

  for (const marker of retiredCloudMarkers) {
    if (content.includes(marker)) {
      findings.push({ file: relativeFile, marker, kind: "retired-cloud" });
    }
  }

  if (!secretFiles.has(file)) continue;

  for (const check of secretPatterns) {
    if (check.pattern.test(content)) {
      findings.push({ file: relativeFile, marker: check.label, kind: "secret-pattern" });
    }
  }
}

if (findings.length > 0) {
  console.error("Release guard failed:");
  for (const finding of findings) {
    console.error(sanitizeForPublicLog(`  ${finding.kind}: ${finding.file}: ${finding.marker}`));
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// R4: vendor infrastructure identifiers live behind ONE indirection.
//
// Scanned over TRACKED files rather than packed files: the leak this prevents
// lives in .github/workflows, which never enters the tarball but is fully public
// on the forge. Account IDs, ARNs, cluster/service/task names and health hosts
// are properties of a deployment, not of the software.
// ---------------------------------------------------------------------------
// R4 scans TRACKED files, so it only applies inside a git work tree. Elsewhere
// (the synthetic package fixtures the guard is exercised against) there are no
// tracked files and the rule has nothing to say. `bun test` runs the same scan
// against the repo root on every CI run, so the property is enforced whether or
// not this particular invocation is in a checkout.
if (!isGitWorkTree(repoRoot)) {
  console.error("R4 infrastructure-identifier scan: not a git work tree, skipping (enforced by bun test).");
} else {
  try {
    const infra = scanRepositoryInfraIdentifiers(repoRoot);

    // Coverage is reported on every run, pass or fail. A guard that says only
    // "passed" cannot be audited for what it did not look at.
    console.log(
      `R4 scan coverage: ${infra.scannedFileCount} scanned, ${infra.skippedFiles.length} skipped, ` +
        `of ${infra.trackedFileCount} tracked.`,
    );
    for (const skippedFile of infra.skippedFiles) {
      console.log(sanitizeForPublicLog(`  not scanned (${skippedFile.reason}): ${skippedFile.path}`));
    }

    if (infra.findings.length > 0) {
      console.error("Release guard failed: tracked files name vendor infrastructure directly (R4).");
      console.error(sanitizeForPublicLog(formatInfraFindings(infra.findings)));
      console.error("  Resolve these from the deploy manifest or a CI variable instead of writing them literally.");
      process.exit(1);
    }
  } catch (error) {
    console.error("Release guard failed: the infrastructure-identifier scan could not run.");
    console.error(sanitizeForPublicLog(`  ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// S1 + S3 + S2: derive the REAL package file list and enforce the public/private
// boundary, the hosted-source boundary, and the body content scan against
// exactly what would be published.
// ---------------------------------------------------------------------------
let packedFiles: string[];
try {
  packedFiles = getPackedFiles(repoRoot);
} catch (error) {
  console.error("Release guard failed: could not compute the package file list.");
  console.error(sanitizeForPublicLog(`  ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
}

// S1 — public/private boundary: no private/PII skill may enter the package.
const privateSlugs = listPrivateSkillSlugs(join(repoRoot, "skills"));
const boundaryLeaks = findPrivatePacklistLeaks(packedFiles, privateSlugs);
if (boundaryLeaks.length > 0) {
  console.error("Release guard failed: private skills leaked into the published package file list:");
  for (const leaked of boundaryLeaks) {
    console.error(sanitizeForPublicLog(`  private-boundary: ${leaked}`));
  }
  console.error(
    "  Private skills (visibility team|private|internal, `skills.publish:false`, or a `.private` marker)",
  );
  console.error("  must be excluded from the `files` list in package.json.");
  process.exit(1);
}

// S3 — hosted metadata boundary: a skill that declares itself hosted ships its
// package.json and docs but never its implementation source. Asserted against
// the real packed file list, so it holds regardless of how `files` is written.
//
// This uses the non-asserting accessor on purpose: the guard runs against
// arbitrary packages, for which zero hosted skills is a legitimate answer. THIS
// repo's expectation that its own hosted set is non-empty — and therefore that
// this check is not vacuous — is enforced in src/lib/hosted-skill-set.test.ts.
const hostedSlugs = listHostedMetadataSlugs(join(repoRoot, "skills"));
const hostedSourceLeaks = findHostedSourcePacklistLeaks(packedFiles, hostedSlugs);
if (hostedSourceLeaks.length > 0) {
  console.error("Release guard failed: hosted skill implementation source leaked into the published package file list:");
  for (const leaked of hostedSourceLeaks) {
    console.error(sanitizeForPublicLog(`  hosted-boundary: ${leaked}`));
  }
  console.error("  Skills declaring `skills.runtime: hosted` (or `skills.source: remote|private-hosted`)");
  console.error("  must have their `src/` excluded by the `files` list in package.json:");
  console.error(`    ${JSON.stringify(buildHostedSourceExclusionGlob(hostedSlugs))}`);
  process.exit(1);
}

// S4 — committed tool output: a run artifact (timestamped filename, data file under
// an exports/ directory) must never be published. Matched on the packed PATHS, since
// what makes an artifact wrong is its provenance, not its contents. Built output
// under dist/ and bin/ is exempt — it is produced by the build, not committed.
const artifactFindings = scanPaths(
  packedFiles.filter((path) => !path.startsWith("dist/") && !path.startsWith("bin/")),
);
if (artifactFindings.length > 0) {
  console.error("Release guard failed: committed tool output would be published.");
  console.error(toRedactedJson(artifactFindings));
  console.error("  These look like the output of an actual run rather than authored fixtures.");
  console.error("  Delete them and gitignore the directory, or replace them with a small");
  console.error("  synthetic fixture under a stable, non-timestamped filename.");
  process.exit(1);
}

// S2 — content scan of package-visible bodies (skip built artifacts under dist/ and bin/).
const scannablePacked = packedFiles.filter((path) => !path.startsWith("dist/") && !path.startsWith("bin/"));
const absoluteScanTargets = scannablePacked
  .map((path) => join(repoRoot, path))
  .filter((path) => existsSync(path) && statSync(path).isFile());
const packRelativeByAbsolute = new Map(
  scannablePacked.map((path) => [join(repoRoot, path), path] as const),
);
const rawScanFindings = scanFiles(absoluteScanTargets, (abs) => packRelativeByAbsolute.get(abs) ?? relative(repoRoot, abs));

// Documented, audited exceptions. Each entry is matched EXACTLY on (file, ruleId);
// it can never suppress a different file or rule. Keep this list minimal.
const scanAllowlist: ScanAllowlistEntry[] = [
  {
    file: "skills/security-audit/src/index.ts",
    ruleId: "private-key-block",
    reason: "Detection regex literal inside the security-audit scanner skill, not a real private key.",
  },
];

const scanFindings = applyAllowlist(rawScanFindings, scanAllowlist);

if (scanFindings.length > 0) {
  console.error("Release guard failed: package-visible content contains secrets, PII, or private context.");
  console.error(toRedactedJson(maskFindingsForPublicLog(scanFindings)));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// R1 — the published package must not name an unapproved network host. This is
// the only gate that runs at publish time, so the property lives here as well
// as in the test suite.
// ---------------------------------------------------------------------------
const packedSources = readPackedSources(packedFiles, repoRoot, { existsSync, statSync, readFileSync }, join);

if (packedSources.length === 0) {
  console.error("Release guard failed: the package file scan produced no readable files.");
  process.exit(1);
}

const packedCodeSources = packedSources.filter((source) => isCodeFile(source.file));

// Strong check: AST scan of every packed code file, position-independent. Run it
// BEFORE the coverage assertion so that "we could not read this file" is a
// finding with a reason rather than a bare coverage number.
const disallowedCodeUrls = findDisallowedCodeUrls(packedCodeSources);
if (disallowedCodeUrls.length > 0) {
  console.error("Release guard failed: package code names hosts that are not approved.");
  console.error(sanitizeForPublicLog(formatFindings(disallowedCodeUrls)));
  console.error("  A host we operate may never be a default. A third-party provider host is");
  console.error("  allowed only when it is listed in APPROVED_CODE_HOSTS in");
  console.error("  src/lib/vendor-host-guard.ts with a written justification.");
  console.error("  A 'cannot certify' finding means a file was never inspected — fix the file,");
  console.error("  never the threshold.");
  process.exit(1);
}

// Anti-vacuity, PER ENTRY POINT rather than as a global count. A global "we
// scanned more than N files" is satisfiable by files that have nothing to do
// with the code under test: on an unbuilt tree the skill corpus alone cleared
// the old threshold while bin/ and dist/ — and therefore everything in src/ they
// are built from — went entirely unscanned. Every path a consumer can execute or
// import must be present, readable and certified.
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as unknown;
const certifiedByFile = new Map(
  packedCodeSources
    .filter((source) => !source.undecodable)
    .map((source) => [source.file, { certified: true }] as const),
);
const uncovered = uncoveredEntryPoints(checkEntryPointCoverage(manifest, packedFiles, certifiedByFile));
if (uncovered.length > 0) {
  console.error("Release guard failed: declared entry points were not scanned.");
  for (const entry of uncovered) {
    console.error(
      sanitizeForPublicLog(
        `  ${entry.path}: packed=${entry.packed} read=${entry.read} certified=${entry.certified}`,
      ),
    );
  }
  console.error("  The host scan would pass vacuously for the code consumers actually run.");
  console.error("  Run `bun run build` before packing so the published artifacts exist.");
  process.exit(1);
}

// Weak backstop: known vendor domains in prose (Markdown, JSON, plain text).
const vendorHostReferences = findVendorHostReferences(packedSources);
if (vendorHostReferences.length > 0) {
  console.error("Release guard failed: the package references vendor-controlled hosts.");
  console.error(sanitizeForPublicLog(formatFindings(vendorHostReferences)));
  process.exit(1);
}

console.log(
  `Release guard passed: ${packedFiles.length} package-visible files (${packedCodeSources.length} code) are free of ` +
    "retired cloud markers, secrets, PII, private context, private-skill leaks, " +
    "hosted implementation source, committed tool output, unapproved hosts, and vendor-controlled hosts; " +
    "every declared entry point was read and certified.",
);
