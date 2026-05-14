#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type Severity = "critical" | "high" | "medium" | "low";

interface AuditOptions {
  target: string;
  scope: string[];
  framework: string;
  outputDir: string;
}

interface Finding {
  id: string;
  severity: Severity;
  area: string;
  file: string;
  line: number;
  title: string;
  evidence: string;
  recommendation: string;
}

const SKILL_NAME = "security-audit-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_SCOPE = ["auth", "secrets", "headers", "webhooks", "rls", "permissions", "dependencies"];

const HELP = `Security Audit Report

Usage:
  skills run security-audit-report --target ./app --scope "auth,secrets,headers,webhooks,rls"
  skills run security-audit-report --target ./src --framework "Next.js"

Options:
  --target <path>     Directory to inspect. Default: current directory
  --scope <list>      Comma-separated focus areas
  --framework <name>  App stack context. Default: generic web app
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  security-audit-report.md, security-audit-report.pdf, findings.json, findings.csv, remediation-plan.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const files = collectFiles(options.target);
  const findings = files.flatMap((file) => inspectFile(options.target, file, options.scope));
  const enrichedFindings = findings.length > 0 ? findings : baselineFindings(options);
  const report = buildReport(options, files.length, enrichedFindings);
  const remediation = buildRemediationPlan(enrichedFindings);
  const pdf = buildPdf(report);
  const filesWritten = writeArtifacts(options, files.length, enrichedFindings, report, remediation, pdf);

  console.log(`Generated security audit report for ${options.target}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${filesWritten.report}`);
  console.log(`- ${filesWritten.pdf}`);
  console.log(`- ${filesWritten.findingsJson}`);
  console.log(`- ${filesWritten.findingsCsv}`);
  console.log(`- ${filesWritten.remediation}`);
  console.log(`- ${filesWritten.manifest}`);
}

function parseCliOptions(): AuditOptions {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      target: { type: "string", default: "." },
      scope: { type: "string" },
      framework: { type: "string", default: "generic web app" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const target = String(values.target || ".").trim();
  if (!existsSync(target)) {
    console.error(`Target not found: ${target}`);
    process.exit(1);
  }
  if (!statSync(target).isDirectory()) {
    console.error(`Target must be a directory: ${target}`);
    process.exit(1);
  }

  return {
    target,
    scope: splitScope(values.scope),
    framework: String(values.framework || "generic web app").trim(),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function collectFiles(target: string): string[] {
  const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,json,md,env,yml,yaml,sh}");
  const files: string[] = [];
  for (const file of glob.scanSync({ cwd: target, onlyFiles: true })) {
    if (isIgnored(file)) continue;
    files.push(file);
    if (files.length >= 500) break;
  }
  return files.sort();
}

function inspectFile(root: string, file: string, scope: string[]): Finding[] {
  const path = join(root, file);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const findings: Finding[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (scope.includes("secrets")) {
      if (/AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----|(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{16,}["']/i.test(line)) {
        findings.push(finding("critical", "secrets", file, lineNumber, "Secret-like value in source", redact(line), "Move secrets to the managed secret store and rotate any exposed credential."));
      }
    }
    if (scope.includes("auth") && /\b(password|otp|session|jwt)\b/i.test(line) && /TODO|FIXME|temporary|bypass|skip/i.test(line)) {
      findings.push(finding("high", "auth", file, lineNumber, "Authentication control needs review", redact(line), "Replace temporary auth behavior with enforced server-side checks and regression tests."));
    }
    if (scope.includes("headers") && /Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*/i.test(line)) {
      findings.push(finding("medium", "headers", file, lineNumber, "Wildcard CORS header", redact(line), "Restrict CORS origins by environment and cover preflight behavior with tests."));
    }
    if (scope.includes("webhooks") && /\bwebhook\b/i.test(file + line) && /signature|verify|hmac/i.test(line) === false && /TODO|skip|disabled/i.test(line)) {
      findings.push(finding("high", "webhooks", file, lineNumber, "Webhook verification gap", redact(line), "Verify webhook signatures before accepting events and reject replayed delivery ids."));
    }
    if (scope.includes("rls") && /\bdisable row level security\b|alter table .* no force row level security/i.test(line)) {
      findings.push(finding("critical", "rls", file, lineNumber, "RLS weakening statement", redact(line), "Keep row-level security forced on tenant-scoped tables and verify database roles in migration tests."));
    }
    if (scope.includes("permissions") && /\bchmod\s+777\b|public-read|allowAll|admin:\s*true/i.test(line)) {
      findings.push(finding("medium", "permissions", file, lineNumber, "Over-broad permission", redact(line), "Use least-privilege permissions and add a negative access test."));
    }
    if (scope.includes("dependencies") && /ignore-scripts|ignore-release-age|legacy-peer-deps|force\s*[:=]\s*true/i.test(line)) {
      findings.push(finding("low", "dependencies", file, lineNumber, "Dependency safety bypass", redact(line), "Remove package safety bypasses and document any exception with an expiry."));
    }
  }

  return findings;
}

function baselineFindings(options: AuditOptions): Finding[] {
  return [
    finding("medium", "auth", "audit-baseline", 0, "Auth regression coverage review", "No direct issue detected in sampled files.", `Confirm ${options.framework} protected routes reject anonymous requests and expired sessions.`),
    finding("medium", "headers", "audit-baseline", 0, "Security headers review", "No direct issue detected in sampled files.", "Verify CSP, frame, content-type, referrer, and HSTS headers in production responses."),
    finding("low", "dependencies", "audit-baseline", 0, "Dependency risk review", "No direct issue detected in sampled files.", "Keep lockfile review, package age policy, and release gates active."),
  ];
}

function buildReport(options: AuditOptions, fileCount: number, findings: Finding[]): string {
  const counts = severityCounts(findings);
  return `# Security Audit Report

## Executive Summary

Audited ${fileCount} file${fileCount === 1 ? "" : "s"} for ${options.framework}. The highest current severity is ${highestSeverity(findings)}. Focus areas: ${options.scope.join(", ")}.

## Severity Summary

| Severity | Count |
| --- | ---: |
| Critical | ${counts.critical} |
| High | ${counts.high} |
| Medium | ${counts.medium} |
| Low | ${counts.low} |

## Findings

| ID | Severity | Area | Location | Issue | Recommendation |
| --- | --- | --- | --- | --- | --- |
${findings.map((item) => `| ${item.id} | ${item.severity.toUpperCase()} | ${cell(item.area)} | ${cell(locationFor(item))} | ${cell(item.title)} | ${cell(item.recommendation)} |`).join("\n")}

## Control Checklist

- Auth: protected routes, session expiry, API keys, and owner/admin boundaries.
- Secrets: no committed credentials, managed injection, and rotation playbook.
- Headers: CSP, HSTS, frame protection, content-type protection, and strict CORS.
- Webhooks: signature verification, idempotency, replay defense, and event logging.
- RLS: forced tenant isolation with migration and runtime verification.
- Permissions: least privilege for storage, queues, workers, and admin surfaces.
- Dependencies: lockfile review, package age policy, and release gates.
`;
}

function buildRemediationPlan(findings: Finding[]): string {
  return `# Remediation Plan

## Priority Order

${findings.map((item, index) => `${index + 1}. **${item.severity.toUpperCase()} ${item.area}** - ${item.title}: ${item.recommendation}`).join("\n")}

## Verification

- Add or update regression tests for every high or critical item.
- Run a production-like smoke check against auth, billing, webhooks, and artifact downloads.
- Record the final status in the run manifest after fixes are verified.
`;
}

function writeArtifacts(
  options: AuditOptions,
  fileCount: number,
  findings: Finding[],
  report: string,
  remediation: string,
  pdf: string,
) {
  const reportPath = join(options.outputDir, "security-audit-report.md");
  const pdfPath = join(options.outputDir, "security-audit-report.pdf");
  const findingsJsonPath = join(options.outputDir, "findings.json");
  const findingsCsvPath = join(options.outputDir, "findings.csv");
  const remediationPath = join(options.outputDir, "remediation-plan.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, report);
  writeFileSync(pdfPath, pdf);
  writeJson(findingsJsonPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    findings,
  });
  writeFileSync(findingsCsvPath, toCsv(findings));
  writeFileSync(remediationPath, remediation);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      target: options.target,
      scope: options.scope,
      framework: options.framework,
    },
    filesScanned: fileCount,
    findingCount: findings.length,
    highestSeverity: highestSeverity(findings),
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      findingsJson: toManifestPath(options.outputDir, findingsJsonPath),
      findingsCsv: toManifestPath(options.outputDir, findingsCsvPath),
      remediation: toManifestPath(options.outputDir, remediationPath),
    },
  });

  return {
    report: reportPath,
    pdf: pdfPath,
    findingsJson: findingsJsonPath,
    findingsCsv: findingsCsvPath,
    remediation: remediationPath,
    manifest: manifestPath,
  };
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 45);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    ...text.map((line, index) => `${index === 0 ? "" : "0 -14 Td"} (${escapePdf(line.slice(0, 95))}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ];
  return `%PDF-1.4\n${objects.join("\n")}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
}

function finding(
  severity: Severity,
  area: string,
  file: string,
  line: number,
  title: string,
  evidence: string,
  recommendation: string,
): Finding {
  return {
    id: `${area}-${Math.abs(hash(`${area}:${file}:${line}:${title}`)).toString(36)}`,
    severity,
    area,
    file,
    line,
    title,
    evidence,
    recommendation,
  };
}

function splitScope(value: unknown): string[] {
  if (!value) return DEFAULT_SCOPE;
  const parsed = String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_SCOPE;
}

function isIgnored(file: string): boolean {
  return file.startsWith("node_modules/")
    || file.includes("/node_modules/")
    || file.startsWith(".git/")
    || file.includes("/.git/")
    || file.startsWith("dist/")
    || file.startsWith("build/")
    || file.startsWith(".next/")
    || file.includes("/.next/");
}

function severityCounts(findings: Finding[]): Record<Severity, number> {
  return {
    critical: findings.filter((item) => item.severity === "critical").length,
    high: findings.filter((item) => item.severity === "high").length,
    medium: findings.filter((item) => item.severity === "medium").length,
    low: findings.filter((item) => item.severity === "low").length,
  };
}

function highestSeverity(findings: Finding[]): Severity {
  if (findings.some((item) => item.severity === "critical")) return "critical";
  if (findings.some((item) => item.severity === "high")) return "high";
  if (findings.some((item) => item.severity === "medium")) return "medium";
  return "low";
}

function locationFor(finding: Finding): string {
  return finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
}

function redact(value: string): string {
  return value
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[redacted]")
    .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[redacted]$2")
    .slice(0, 180)
    .trim();
}

function toCsv(findings: Finding[]): string {
  const headers = ["id", "severity", "area", "file", "line", "title", "recommendation"] as const;
  return [
    headers.join(","),
    ...findings.map((item) => headers.map((header) => csvCell(String(item[header]))).join(",")),
  ].join("\n") + "\n";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function hash(value: string): number {
  let hashValue = 0;
  for (let index = 0; index < value.length; index++) {
    hashValue = (hashValue << 5) - hashValue + value.charCodeAt(index);
    hashValue |= 0;
  }
  return hashValue;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
