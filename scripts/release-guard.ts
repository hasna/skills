#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { applyAllowlist, scanFiles, toRedactedJson, type ScanAllowlistEntry } from "../src/lib/content-scan.js";
import { getPackedFiles } from "../src/lib/packlist.js";
import { findPrivatePacklistLeaks, listPrivateSkillSlugs } from "../src/lib/public-boundary.js";

type Finding = {
  file: string;
  marker: string;
  kind: "retired-cloud" | "secret-pattern";
};

type PatternCheck = {
  label: string;
  pattern: RegExp;
};

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

function isText(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

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
  if (!isText(buffer)) continue;
  const content = buffer.toString("utf8");
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
    console.error(`  ${finding.kind}: ${finding.file}: ${finding.marker}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// S1 + S2: derive the REAL package file list and enforce the public/private
// boundary and body content scan against exactly what would be published.
// ---------------------------------------------------------------------------
let packedFiles: string[];
try {
  packedFiles = getPackedFiles(repoRoot);
} catch (error) {
  console.error("Release guard failed: could not compute the package file list.");
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// S1 — public/private boundary: no private/PII skill may enter the package.
const privateSlugs = listPrivateSkillSlugs(join(repoRoot, "skills"));
const boundaryLeaks = findPrivatePacklistLeaks(packedFiles, privateSlugs);
if (boundaryLeaks.length > 0) {
  console.error("Release guard failed: private skills leaked into the published package file list:");
  for (const leaked of boundaryLeaks) {
    console.error(`  private-boundary: ${leaked}`);
  }
  console.error(
    "  Private skills (visibility team|private|internal, `skills.publish:false`, or a `.private` marker)",
  );
  console.error("  must be excluded from the `files` list in package.json.");
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
  console.error(toRedactedJson(scanFindings));
  process.exit(1);
}

console.log(
  `Release guard passed: ${packedFiles.length} package-visible files are free of retired cloud markers, ` +
    "secrets, PII, private context, and private-skill leaks.",
);
