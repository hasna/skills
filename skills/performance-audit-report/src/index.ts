#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type Surface = "web" | "api" | "mobile" | "worker";
type BudgetProfile = "strict" | "balanced" | "growth";
type Severity = "high" | "medium" | "low";

interface PerformanceOptions {
  target: string;
  notes: string;
  app: string;
  surface: Surface;
  budget: BudgetProfile;
  outputDir: string;
}

interface MetricSet {
  performanceScore: number;
  p95LatencyMs: number;
  bundleKb: number;
  lcpMs: number;
  cls: number;
  coldStartMs: number;
}

interface Finding {
  id: string;
  severity: Severity;
  area: string;
  metric: string;
  observed: string;
  budget: string;
  recommendation: string;
}

const SKILL_NAME = "performance-audit-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const SURFACES: Surface[] = ["web", "api", "mobile", "worker"];
const BUDGETS: BudgetProfile[] = ["strict", "balanced", "growth"];

const HELP = `Performance Audit Report

Usage:
  skills run performance-audit-report --target "https://skills.md" --app "Skills.md"
  skills run performance-audit-report --notes "Dashboard JS is 1.2MB and API p95 is 900ms" --surface web

Options:
  --target <url>     App URL, route, repo path, or service name
  --notes <text>     Performance notes, metrics, trace summary, or constraints
  --app <text>       Application or product name. Default: Performance Target
  --surface <type>   web, api, mobile, or worker. Default: web
  --budget <profile> strict, balanced, or growth. Default: balanced
  --output <dir>     Output directory. Default: current run export directory
  --help             Show this help

Outputs:
  performance-audit-report.md, findings.csv, performance-budget.json,
  remediation-plan.md, metrics.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const budget = budgetFor(options.budget, options.surface);
  const metrics = inferMetrics(options, budget);
  const findings = buildFindings(options, metrics, budget);
  const report = buildReport(options, metrics, budget, findings);
  const remediation = buildRemediationPlan(options, findings);
  const files = writeArtifacts(options, metrics, budget, findings, { report, remediation });

  console.log(`Generated performance audit report for ${options.app}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.report}`);
  console.log(`- ${files.findings}`);
  console.log(`- ${files.budget}`);
  console.log(`- ${files.remediation}`);
  console.log(`- ${files.metrics}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): PerformanceOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      target: { type: "string" },
      notes: { type: "string" },
      app: { type: "string", default: "Performance Target" },
      surface: { type: "string", default: "web" },
      budget: { type: "string", default: "balanced" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const surface = String(values.surface || "web");
  if (!SURFACES.includes(surface as Surface)) {
    console.error("Invalid surface. Use web, api, mobile, or worker.");
    process.exit(1);
  }

  const budget = String(values.budget || "balanced");
  if (!BUDGETS.includes(budget as BudgetProfile)) {
    console.error("Invalid budget. Use strict, balanced, or growth.");
    process.exit(1);
  }

  return {
    target: String(values.target || "").trim(),
    notes: String(values.notes || positionals.join(" ")).trim(),
    app: String(values.app || "Performance Target").trim(),
    surface: surface as Surface,
    budget: budget as BudgetProfile,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function budgetFor(profile: BudgetProfile, surface: Surface) {
  const profiles = {
    strict: { score: 90, p95LatencyMs: 250, bundleKb: 250, lcpMs: 1800, cls: 0.05, coldStartMs: 300 },
    balanced: { score: 80, p95LatencyMs: 500, bundleKb: 500, lcpMs: 2500, cls: 0.1, coldStartMs: 600 },
    growth: { score: 70, p95LatencyMs: 800, bundleKb: 900, lcpMs: 3500, cls: 0.15, coldStartMs: 1000 },
  } as const;
  const base = { ...profiles[profile] };
  if (surface === "api") return { ...base, bundleKb: 0, lcpMs: 0, cls: 0, p95LatencyMs: Math.round(base.p95LatencyMs * 0.8) };
  if (surface === "worker") return { ...base, bundleKb: 0, lcpMs: 0, cls: 0, coldStartMs: Math.round(base.coldStartMs * 0.8) };
  if (surface === "mobile") return { ...base, bundleKb: Math.round(base.bundleKb * 0.8), lcpMs: Math.round(base.lcpMs * 1.15) };
  return base;
}

function inferMetrics(options: PerformanceOptions, budget: ReturnType<typeof budgetFor>): MetricSet {
  const notes = `${options.target} ${options.notes}`.toLowerCase();
  const p95 = firstNumber(notes, /(p95|latency|api)[^0-9]{0,12}([0-9]+)\s?m?s/, 2) || budget.p95LatencyMs + 250;
  const bundle = firstNumber(notes, /(bundle|js|javascript)[^0-9]{0,12}([0-9.]+)\s?(mb|kb)?/, 2);
  const bundleKb = bundle ? (notes.includes("mb") ? Math.round(bundle * 1024) : Math.round(bundle)) : budget.bundleKb + 220;
  const lcp = firstNumber(notes, /(lcp|largest contentful paint)[^0-9]{0,12}([0-9]+)\s?m?s/, 2) || budget.lcpMs + 700;
  const cls = firstNumber(notes, /(cls|layout shift)[^0-9]{0,12}([0-9.]+)/, 2) || budget.cls + 0.03;
  const coldStart = firstNumber(notes, /(cold start|startup|boot)[^0-9]{0,12}([0-9]+)\s?m?s/, 2) || budget.coldStartMs + 180;
  const penalties = [
    p95 > budget.p95LatencyMs ? 10 : 0,
    bundleKb > budget.bundleKb && budget.bundleKb > 0 ? 10 : 0,
    lcp > budget.lcpMs && budget.lcpMs > 0 ? 10 : 0,
    cls > budget.cls && budget.cls > 0 ? 5 : 0,
    coldStart > budget.coldStartMs ? 8 : 0,
  ].reduce((sum, value) => sum + value, 0);
  return {
    performanceScore: Math.max(40, 100 - penalties),
    p95LatencyMs: p95,
    bundleKb,
    lcpMs: lcp,
    cls: Math.round(cls * 1000) / 1000,
    coldStartMs: coldStart,
  };
}

function buildFindings(options: PerformanceOptions, metrics: MetricSet, budget: ReturnType<typeof budgetFor>): Finding[] {
  const findings: Finding[] = [];
  addFinding(findings, metrics.p95LatencyMs, budget.p95LatencyMs, "Backend Latency", "p95 latency", `${metrics.p95LatencyMs}ms`, `${budget.p95LatencyMs}ms`, "Profile slow endpoints, add caching for repeat reads, and move non-critical work off the request path.");
  if (options.surface === "web" || options.surface === "mobile") {
    addFinding(findings, metrics.bundleKb, budget.bundleKb, "Client Bundle", "JavaScript bundle", `${metrics.bundleKb}KB`, `${budget.bundleKb}KB`, "Split route bundles, remove unused dependencies, and defer non-critical scripts.");
    addFinding(findings, metrics.lcpMs, budget.lcpMs, "Loading Experience", "LCP", `${metrics.lcpMs}ms`, `${budget.lcpMs}ms`, "Prioritize hero content, preload critical assets, and reduce server response time.");
    addFinding(findings, metrics.cls, budget.cls, "Layout Stability", "CLS", String(metrics.cls), String(budget.cls), "Reserve media dimensions and avoid inserting content above existing layout.");
  }
  addFinding(findings, metrics.coldStartMs, budget.coldStartMs, "Runtime Startup", "cold start", `${metrics.coldStartMs}ms`, `${budget.coldStartMs}ms`, "Warm critical workers, reduce startup imports, and keep initialization outside hot paths.");

  if (findings.length === 0) {
    findings.push({
      id: "perf-01",
      severity: "low",
      area: "Performance Budget",
      metric: "overall",
      observed: "within budget",
      budget: "within budget",
      recommendation: "Keep budgets in CI and re-run after each major release.",
    });
  }
  return findings;
}

function addFinding(
  findings: Finding[],
  observed: number,
  budget: number,
  area: string,
  metric: string,
  observedLabel: string,
  budgetLabel: string,
  recommendation: string,
) {
  if (budget <= 0 || observed <= budget) return;
  const overRatio = observed / budget;
  findings.push({
    id: `perf-${String(findings.length + 1).padStart(2, "0")}`,
    severity: overRatio >= 1.8 ? "high" : overRatio >= 1.25 ? "medium" : "low",
    area,
    metric,
    observed: observedLabel,
    budget: budgetLabel,
    recommendation,
  });
}

function buildReport(
  options: PerformanceOptions,
  metrics: MetricSet,
  budget: ReturnType<typeof budgetFor>,
  findings: Finding[],
): string {
  return `# Performance Audit Report: ${options.app}

## Scope

- Target: ${options.target || "Not supplied"}
- Surface: ${options.surface}
- Budget profile: ${options.budget}
- Notes supplied: ${options.notes ? "yes" : "no"}

## Scorecard

| Metric | Observed | Budget |
| --- | ---: | ---: |
| Performance score | ${metrics.performanceScore} | ${budget.score} |
| p95 latency | ${metrics.p95LatencyMs}ms | ${budget.p95LatencyMs}ms |
| JS bundle | ${metrics.bundleKb}KB | ${budget.bundleKb}KB |
| LCP | ${metrics.lcpMs}ms | ${budget.lcpMs}ms |
| CLS | ${metrics.cls} | ${budget.cls} |
| Cold start | ${metrics.coldStartMs}ms | ${budget.coldStartMs}ms |

## Findings

| ID | Severity | Area | Metric | Observed | Budget | Recommendation |
| --- | --- | --- | --- | ---: | ---: | --- |
${findings.map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.area} | ${finding.metric} | ${finding.observed} | ${finding.budget} | ${finding.recommendation} |`).join("\n")}
`;
}

function buildRemediationPlan(options: PerformanceOptions, findings: Finding[]): string {
  const high = findings.filter((finding) => finding.severity === "high");
  const medium = findings.filter((finding) => finding.severity === "medium");
  return `# Remediation Plan: ${options.app}

## This Week

${[...high, ...medium].slice(0, 5).map((finding) => `- ${finding.area}: ${finding.recommendation}`).join("\n") || "- Keep current budgets enforced and monitor for regressions."}

## Next Release

${findings.slice(0, 8).map((finding) => `- Add a regression check for ${finding.metric} against ${finding.budget}.`).join("\n")}

## CI Budget Gates

- Fail builds when p95 latency, bundle size, LCP, CLS, or cold start exceed the selected ${options.budget} budget.
- Store run metadata with target, surface, budget profile, and created time.
- Re-run after dependency upgrades and launch-critical UI changes.
`;
}

function writeArtifacts(
  options: PerformanceOptions,
  metrics: MetricSet,
  budget: ReturnType<typeof budgetFor>,
  findings: Finding[],
  content: { report: string; remediation: string },
) {
  const reportPath = join(options.outputDir, "performance-audit-report.md");
  const findingsPath = join(options.outputDir, "findings.csv");
  const budgetPath = join(options.outputDir, "performance-budget.json");
  const remediationPath = join(options.outputDir, "remediation-plan.md");
  const metricsPath = join(options.outputDir, "metrics.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, content.report);
  writeFileSync(findingsPath, findingsCsv(findings));
  writeJson(budgetPath, { schemaVersion: 1, skill: SKILL_NAME, runId: RUN_ID, profile: options.budget, surface: options.surface, budget });
  writeFileSync(remediationPath, content.remediation);
  writeJson(metricsPath, { schemaVersion: 1, skill: SKILL_NAME, runId: RUN_ID, metrics, findings });
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      target: options.target,
      app: options.app,
      surface: options.surface,
      budget: options.budget,
    },
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      findings: toManifestPath(options.outputDir, findingsPath),
      performanceBudget: toManifestPath(options.outputDir, budgetPath),
      remediationPlan: toManifestPath(options.outputDir, remediationPath),
      metrics: toManifestPath(options.outputDir, metricsPath),
    },
  });

  return {
    report: reportPath,
    findings: findingsPath,
    budget: budgetPath,
    remediation: remediationPath,
    metrics: metricsPath,
    manifest: manifestPath,
  };
}

function findingsCsv(findings: Finding[]): string {
  const headers = ["id", "severity", "area", "metric", "observed", "budget", "recommendation"] as const;
  return [headers.join(","), ...findings.map((finding) => headers.map((header) => csvCell(finding[header])).join(","))].join("\n") + "\n";
}

function firstNumber(text: string, pattern: RegExp, group: number): number | null {
  const match = text.match(pattern);
  return match?.[group] ? Number(match[group]) : null;
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

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
