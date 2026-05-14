#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type RiskLevel = "high" | "medium" | "low";

interface ContractOptions {
  contract: string;
  party: string;
  counterparty: string;
  jurisdiction: string;
  focus: string[];
  outputDir: string;
}

interface ClauseRule {
  area: string;
  keywords: string[];
  risk: RiskLevel;
  issue: string;
  recommendation: string;
}

interface ClauseFinding {
  id: string;
  area: string;
  risk: RiskLevel;
  issue: string;
  recommendation: string;
  evidence: string;
}

const SKILL_NAME = "contract-review-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_FOCUS = ["liability", "payment", "termination", "privacy"];

const HELP = `Contract Review Report

Usage:
  skills run contract-review-report --source ./msa.txt --party "Acme" --counterparty "VendorCo"
  skills run contract-review-report --contract "Termination requires 90 days notice..." --focus "privacy,liability,payment"

Options:
  --contract <text>      Contract text
  --source <path>        Read contract text from a file
  --party <text>         Your company or client name. Default: Our company
  --counterparty <text>  Other party name. Default: Counterparty
  --jurisdiction <text>  Governing context for notes
  --focus <list>         Comma-separated focus areas
  --output <dir>         Output directory. Default: current run export directory
  --help                 Show this help

Outputs:
  contract-review-report.md, risk-register.csv, clause-summary.json,
  redline-suggestions.md, negotiation-email.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const sections = parseSections(options.contract);
  const findings = buildFindings(options, sections);
  const clauseSummary = buildClauseSummary(options, sections, findings);
  const report = buildReport(options, clauseSummary, findings);
  const redlines = buildRedlines(options, findings);
  const email = buildNegotiationEmail(options, findings);
  const files = writeArtifacts(options, clauseSummary, findings, { report, redlines, email });

  console.log(`Generated contract review report for ${options.party} and ${options.counterparty}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.report}`);
  console.log(`- ${files.riskRegister}`);
  console.log(`- ${files.clauseSummary}`);
  console.log(`- ${files.redlines}`);
  console.log(`- ${files.email}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): ContractOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      contract: { type: "string" },
      source: { type: "string" },
      party: { type: "string", default: "Our company" },
      counterparty: { type: "string", default: "Counterparty" },
      jurisdiction: { type: "string", default: "Not specified" },
      focus: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const sourcePath = String(values.source || "").trim();
  const sourceContract = sourcePath ? readSource(sourcePath) : "";
  const contract = String(values.contract || sourceContract || positionals.join(" ")).trim();
  if (!contract) {
    console.error("Contract text is required. Pass --contract <text>, --source <path>, or positional text.");
    process.exit(1);
  }

  return {
    contract,
    party: String(values.party || "Our company").trim(),
    counterparty: String(values.counterparty || "Counterparty").trim(),
    jurisdiction: String(values.jurisdiction || "Not specified").trim(),
    focus: parseFocus(values.focus),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSource(path: string): string {
  if (!existsSync(path)) {
    console.error(`Source not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

function parseSections(contract: string): string[] {
  const sections = contract
    .split(/\n{2,}|\r?\n(?=\d+\.|[A-Z][A-Z\s]{4,}:)|(?<=\.)\s+(?=[A-Z][a-z]+ (?:shall|must|may|will)\b)/)
    .map((section) => section.trim())
    .filter((section) => section.length > 20);
  return (sections.length > 0 ? sections : [contract]).slice(0, 120);
}

function buildFindings(options: ContractOptions, sections: string[]): ClauseFinding[] {
  const focusSet = new Set(options.focus.map((item) => item.toLowerCase()));
  const matched: ClauseFinding[] = [];

  for (const section of sections) {
    const lower = section.toLowerCase();
    for (const rule of clauseRules) {
      if (!focusSet.has(rule.area.toLowerCase()) && options.focus.length > 0) continue;
      if (!rule.keywords.some((keyword) => lower.includes(keyword))) continue;
      matched.push({
        id: `risk-${String(matched.length + 1).padStart(2, "0")}`,
        area: rule.area,
        risk: escalateRisk(rule.risk, section),
        issue: rule.issue,
        recommendation: rule.recommendation,
        evidence: truncate(section, 320),
      });
      break;
    }
  }

  if (matched.length === 0) {
    matched.push({
      id: "risk-01",
      area: "general",
      risk: "medium",
      issue: "No focus-area clauses were detected from the supplied text.",
      recommendation: "Run a manual counsel review against the complete agreement and confirm missing clauses are intentional.",
      evidence: truncate(sections[0] || options.contract, 320),
    });
  }

  return matched.slice(0, 20);
}

function buildClauseSummary(options: ContractOptions, sections: string[], findings: ClauseFinding[]) {
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    party: options.party,
    counterparty: options.counterparty,
    jurisdiction: options.jurisdiction,
    focus: options.focus,
    sectionCount: sections.length,
    riskCounts: {
      high: findings.filter((finding) => finding.risk === "high").length,
      medium: findings.filter((finding) => finding.risk === "medium").length,
      low: findings.filter((finding) => finding.risk === "low").length,
    },
    areas: Array.from(new Set(findings.map((finding) => finding.area))),
    findings,
  };
}

function buildReport(options: ContractOptions, summary: ReturnType<typeof buildClauseSummary>, findings: ClauseFinding[]): string {
  const topRisks = findings.filter((finding) => finding.risk === "high").slice(0, 5);
  return `# Contract Review Report: ${options.party} <> ${options.counterparty}

## Review Context

- Party: ${options.party}
- Counterparty: ${options.counterparty}
- Jurisdiction/context: ${options.jurisdiction}
- Focus areas: ${options.focus.join(", ")}
- Sections analyzed: ${summary.sectionCount}

## Executive Summary

Found ${findings.length} review point${findings.length === 1 ? "" : "s"} across ${summary.areas.length} area${summary.areas.length === 1 ? "" : "s"}. High risk count: ${summary.riskCounts.high}. This report is a negotiation aid and should be reviewed with qualified counsel before signature.

## Top Risks

${topRisks.length > 0 ? topRisks.map((finding) => `- **${finding.area}**: ${finding.issue} Recommendation: ${finding.recommendation}`).join("\n") : "- No high-risk issue detected from supplied text."}

## Risk Register

| ID | Area | Risk | Issue | Recommendation |
| --- | --- | --- | --- | --- |
${findings.map((finding) => `| ${finding.id} | ${cell(finding.area)} | ${finding.risk} | ${cell(finding.issue)} | ${cell(finding.recommendation)} |`).join("\n")}

## Evidence Notes

${findings.map((finding) => `### ${finding.id}: ${finding.area}

${finding.evidence}
`).join("\n")}
`;
}

function buildRedlines(options: ContractOptions, findings: ClauseFinding[]): string {
  return `# Redline Suggestions: ${options.party} <> ${options.counterparty}

${findings.map((finding) => `## ${finding.id}: ${finding.area}

- Current concern: ${finding.issue}
- Suggested revision: ${suggestRevision(finding)}
- Negotiation fallback: ${fallbackFor(finding)}
`).join("\n")}
`;
}

function buildNegotiationEmail(options: ContractOptions, findings: ClauseFinding[]): string {
  const high = findings.filter((finding) => finding.risk === "high");
  return `Subject: ${options.party} contract review points

Hi ${options.counterparty} team,

Thanks for sending the draft. We reviewed it and have a few points to resolve before signature.

Priority items:
${(high.length > 0 ? high : findings.slice(0, 4)).map((finding) => `- ${finding.area}: ${finding.recommendation}`).join("\n")}

Could you confirm whether these updates are acceptable or suggest alternative language?

Best,
${options.party}
`;
}

function writeArtifacts(
  options: ContractOptions,
  clauseSummary: ReturnType<typeof buildClauseSummary>,
  findings: ClauseFinding[],
  content: { report: string; redlines: string; email: string },
) {
  const reportPath = join(options.outputDir, "contract-review-report.md");
  const riskPath = join(options.outputDir, "risk-register.csv");
  const summaryPath = join(options.outputDir, "clause-summary.json");
  const redlinesPath = join(options.outputDir, "redline-suggestions.md");
  const emailPath = join(options.outputDir, "negotiation-email.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, content.report);
  writeFileSync(riskPath, riskCsv(findings));
  writeJson(summaryPath, clauseSummary);
  writeFileSync(redlinesPath, content.redlines);
  writeFileSync(emailPath, content.email);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      party: options.party,
      counterparty: options.counterparty,
      jurisdiction: options.jurisdiction,
      focus: options.focus,
      findingCount: findings.length,
    },
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      riskRegister: toManifestPath(options.outputDir, riskPath),
      clauseSummary: toManifestPath(options.outputDir, summaryPath),
      redlines: toManifestPath(options.outputDir, redlinesPath),
      negotiationEmail: toManifestPath(options.outputDir, emailPath),
    },
  });

  return {
    report: reportPath,
    riskRegister: riskPath,
    clauseSummary: summaryPath,
    redlines: redlinesPath,
    email: emailPath,
    manifest: manifestPath,
  };
}

function riskCsv(findings: ClauseFinding[]): string {
  const headers = ["id", "area", "risk", "issue", "recommendation", "evidence"] as const;
  return [headers.join(","), ...findings.map((finding) => headers.map((header) => csvCell(finding[header])).join(","))].join("\n") + "\n";
}

function parseFocus(value: unknown): string[] {
  const focus = String(value || DEFAULT_FOCUS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return focus.length > 0 ? focus : DEFAULT_FOCUS;
}

function escalateRisk(base: RiskLevel, section: string): RiskLevel {
  const lower = section.toLowerCase();
  if (/\b(unlimited|sole discretion|without notice|non-refundable|perpetual|irrevocable)\b/.test(lower)) return "high";
  return base;
}

function suggestRevision(finding: ClauseFinding): string {
  if (finding.area === "liability") return "Cap liability at fees paid in the previous 12 months, with only narrow exclusions for confidentiality and intentional misconduct.";
  if (finding.area === "payment") return "Add clear invoice timing, dispute window, taxes, and suspension rights tied to uncured non-payment.";
  if (finding.area === "termination") return "Add mutual termination rights, cure periods, transition assistance, and refund or wind-down language where appropriate.";
  if (finding.area === "privacy") return "Reference the data processing terms, breach notice window, subprocessors, and deletion/return obligations.";
  if (finding.area === "ip") return "Confirm ownership of pre-existing IP, deliverables, licenses, and feedback rights.";
  return "Replace broad or ambiguous language with specific obligations, timelines, and remedies.";
}

function fallbackFor(finding: ClauseFinding): string {
  if (finding.risk === "high") return "Escalate to counsel and avoid signature until narrowed.";
  if (finding.risk === "medium") return "Accept only with a written clarification or commercial concession.";
  return "Track as a cleanup item if timing is tight.";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

const clauseRules: ClauseRule[] = [
  {
    area: "liability",
    keywords: ["liability", "damages", "indemnify", "indemnification", "cap", "limitation"],
    risk: "high",
    issue: "Liability or indemnity language may create uncapped or one-sided exposure.",
    recommendation: "Narrow indemnity triggers and add an appropriate liability cap with explicit exclusions.",
  },
  {
    area: "payment",
    keywords: ["payment", "invoice", "fees", "taxes", "refund", "late", "non-refundable"],
    risk: "medium",
    issue: "Payment terms may not define timing, dispute process, or refund treatment clearly enough.",
    recommendation: "Clarify invoice cadence, payment deadline, dispute process, taxes, and credits/refunds.",
  },
  {
    area: "termination",
    keywords: ["termination", "terminate", "cure", "notice", "renewal", "suspension"],
    risk: "medium",
    issue: "Termination rights may be too broad, one-sided, or missing cure/transition mechanics.",
    recommendation: "Add mutual rights, notice periods, cure windows, and transition obligations.",
  },
  {
    area: "privacy",
    keywords: ["privacy", "personal data", "data protection", "breach", "subprocessor", "security"],
    risk: "high",
    issue: "Data protection language may be incomplete for regulated or customer data workflows.",
    recommendation: "Attach data processing terms and define breach notice, subprocessors, deletion, and audit rights.",
  },
  {
    area: "ip",
    keywords: ["intellectual property", "ip", "ownership", "license", "work product", "feedback"],
    risk: "medium",
    issue: "Ownership and license rights may be ambiguous or too broad.",
    recommendation: "Separate background IP, deliverables, feedback, and license scope with survival terms.",
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
