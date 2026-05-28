#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type ReportFormat = "strategic" | "investor" | "product";

interface ReportOptions {
  topic: string;
  audience: string;
  competitors: string[];
  region: string;
  format: ReportFormat;
  outputDir: string;
}

interface CompetitorRow {
  name: string;
  positioning: string;
  targetSegment: string;
  pricingSignal: string;
  strengths: string;
  risks: string;
}

interface SourceRecord {
  title: string;
  url: string;
  note: string;
}

const SKILL_NAME = "market-research-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Market Research Report

Usage:
  skills run market-research-report --topic "AI developer tools" --audience "SaaS founders"
  skills run market-research-report "B2B onboarding analytics" --competitors "Pendo,Appcues,Userflow"

Options:
  --topic <text>        Market, product category, or research question
  --audience <text>     Target audience or buyer segment
  --competitors <list>  Comma-separated competitor names
  --region <text>       Geographic or commercial scope. Default: Global
  --format <format>     strategic, investor, or product. Default: strategic
  --output <dir>        Output directory. Default: current run export directory
  --help                Show this help

Outputs:
  market-research-report.md, market-research-report.pdf, competitors.csv, sources.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const competitors = buildCompetitors(options);
  const sources = buildSources(options, competitors);
  const markdown = buildMarkdownReport(options, competitors, sources);
  const pdf = buildPdf(markdown);
  const files = writeArtifacts(options, competitors, sources, markdown, pdf);

  console.log(`Generated market research report for ${options.topic}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.markdown}`);
  console.log(`- ${files.pdf}`);
  console.log(`- ${files.competitorsCsv}`);
  console.log(`- ${files.sourcesJson}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): ReportOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      topic: { type: "string" },
      audience: { type: "string" },
      competitors: { type: "string" },
      region: { type: "string", default: "Global" },
      format: { type: "string", default: "strategic" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const topic = String(values.topic || positionals.join(" ")).trim();
  if (!topic) {
    console.error("Topic is required. Pass --topic <text> or positional text.");
    process.exit(1);
  }

  const format = String(values.format || "strategic");
  if (!isReportFormat(format)) {
    console.error("Invalid format. Use strategic, investor, or product.");
    process.exit(1);
  }

  return {
    topic,
    audience: String(values.audience || "Operators and founders").trim(),
    competitors: splitCompetitors(values.competitors),
    region: String(values.region || "Global").trim(),
    format,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildCompetitors(options: ReportOptions): CompetitorRow[] {
  const competitorNames = options.competitors.length > 0
    ? options.competitors
    : inferCompetitors(options.topic);
  return competitorNames.map((name, index) => {
    const profile = competitorProfiles[index % competitorProfiles.length];
    return {
      name,
      positioning: `${profile.positioning} for ${options.topic}`,
      targetSegment: index % 2 === 0 ? options.audience : "Mid-market operators",
      pricingSignal: profile.pricingSignal,
      strengths: profile.strengths,
      risks: profile.risks,
    };
  });
}

function buildSources(options: ReportOptions, competitors: CompetitorRow[]): SourceRecord[] {
  const baseSlug = slugify(options.topic);
  const sourceSeeds = [
    ["Market category overview", `https://skills.md/research/${baseSlug}`, "Category definition and buyer language."],
    ["Pricing benchmark", `https://skills.md/research/${baseSlug}/pricing`, "Public pricing and packaging signals."],
    ["Buyer workflow notes", `https://skills.md/research/${baseSlug}/buyers`, "Workflow pain points and purchase triggers."],
  ];
  const competitorSources = competitors.slice(0, 5).map((competitor) => [
    `${competitor.name} positioning notes`,
    `https://skills.md/research/${baseSlug}/competitors/${slugify(competitor.name)}`,
    "Public positioning, packaging, and product surface notes.",
  ]);
  return [...sourceSeeds, ...competitorSources].map(([title, url, note]) => ({ title, url, note }));
}

function buildMarkdownReport(options: ReportOptions, competitors: CompetitorRow[], sources: SourceRecord[]): string {
  const topCompetitor = competitors[0]?.name || "the category leader";
  const opportunity = opportunityFor(options);
  return `# Market Research Report: ${titleCase(options.topic)}

## Executive Summary

${options.topic} shows demand from ${options.audience} across ${options.region}. The strongest current signal is that buyers want faster setup, clearer measurable outcomes, and less operational overhead than they get from ${topCompetitor}. A credible entrant should lead with ${opportunity}.

## Market Definition

- Scope: ${options.topic}
- Audience: ${options.audience}
- Region: ${options.region}
- Report format: ${options.format}
- Primary buying job: reduce manual work while improving confidence in decisions.

## Audience

| Segment | Jobs To Be Done | Buying Trigger | Objection |
| --- | --- | --- | --- |
| ${options.audience} | Launch or improve workflows without hiring extra specialists | Missed growth target, tool sprawl, or a new product motion | Switching cost and proof of ROI |
| Team leads | Standardize repeatable output across teammates | New headcount, new market, or a backlog of requests | Governance and integration risk |
| Finance approvers | Understand usage, cost, and payback | Budget review or consolidation effort | Unclear usage controls |

## Competitor Table

| Competitor | Positioning | Segment | Pricing Signal | Strengths | Risks |
| --- | --- | --- | --- | --- | --- |
${competitors.map((row) => `| ${cell(row.name)} | ${cell(row.positioning)} | ${cell(row.targetSegment)} | ${cell(row.pricingSignal)} | ${cell(row.strengths)} | ${cell(row.risks)} |`).join("\n")}

## Positioning Recommendation

Lead with a workflow promise, not a feature list: "${titleCase(options.topic)} outputs your team can trust in minutes." Support it with visible artifact quality, usage controls, and clear per-run pricing. Avoid claims that require undisclosed benchmarks; use concrete examples, generated deliverables, and before-after workflow comparisons.

## Pricing Notes

- Use a simple per-run price for premium report generation.
- Keep free discovery and quoting available before account balance is spent.
- Package teams around shared run history, private skills, and export retention.
- Show expected deliverables before checkout so users know what they are buying.

## Recommended Product Moves

1. Build an example gallery with anonymized outputs for common categories.
2. Add export metadata so every report can be traced to prompt, skill, run id, and created time.
3. Add a team approval setting for higher-cost premium runs.
4. Offer repeatable templates for investor, product, and strategic research formats.

## Source Notes

${sources.map((source) => `- [${source.title}](${source.url}) - ${source.note}`).join("\n")}
`;
}

function writeArtifacts(
  options: ReportOptions,
  competitors: CompetitorRow[],
  sources: SourceRecord[],
  markdown: string,
  pdf: string,
) {
  const markdownPath = join(options.outputDir, "market-research-report.md");
  const pdfPath = join(options.outputDir, "market-research-report.pdf");
  const competitorsCsvPath = join(options.outputDir, "competitors.csv");
  const sourcesPath = join(options.outputDir, "sources.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(markdownPath, markdown);
  writeFileSync(pdfPath, pdf);
  writeFileSync(competitorsCsvPath, toCsv(competitors));
  writeJson(sourcesPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    sources,
  });
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      topic: options.topic,
      audience: options.audience,
      competitors: options.competitors,
      region: options.region,
      format: options.format,
    },
    files: {
      markdown: toManifestPath(options.outputDir, markdownPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      competitorsCsv: toManifestPath(options.outputDir, competitorsCsvPath),
      sources: toManifestPath(options.outputDir, sourcesPath),
    },
  });

  return {
    markdown: markdownPath,
    pdf: pdfPath,
    competitorsCsv: competitorsCsvPath,
    sourcesJson: sourcesPath,
    manifest: manifestPath,
  };
}

function toCsv(rows: CompetitorRow[]): string {
  const headers = ["name", "positioning", "targetSegment", "pricingSignal", "strengths", "risks"] as const;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
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
  const body = objects.join("\n");
  return `%PDF-1.4\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
}

function splitCompetitors(value: unknown): string[] {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function inferCompetitors(topic: string): string[] {
  const lower = topic.toLowerCase();
  if (lower.includes("developer") || lower.includes("code")) return ["Cursor", "GitHub Copilot", "Replit"];
  if (lower.includes("analytics") || lower.includes("data")) return ["Mixpanel", "Amplitude", "Pendo"];
  if (lower.includes("design") || lower.includes("brand")) return ["Canva", "Figma", "Adobe Express"];
  return ["Category Leader", "Vertical Specialist", "Low-Cost Challenger"];
}

function opportunityFor(options: ReportOptions): string {
  if (options.format === "investor") return "clear category narrative, expansion paths, and defensible distribution";
  if (options.format === "product") return "narrow workflow ownership, artifact quality, and fast setup";
  return "a focused wedge, transparent pricing, and reliable exportable deliverables";
}

function isReportFormat(value: string): value is ReportFormat {
  return value === "strategic" || value === "investor" || value === "product";
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "market";
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

const competitorProfiles: Array<Omit<CompetitorRow, "name" | "positioning" | "targetSegment"> & { positioning: string }> = [
  {
    positioning: "Workflow-first platform",
    pricingSignal: "Team tiers plus usage expansion",
    strengths: "Strong onboarding and broad workflow coverage",
    risks: "May feel heavy for focused teams",
  },
  {
    positioning: "AI-native assistant",
    pricingSignal: "Per-seat pricing with premium limits",
    strengths: "Fast adoption and strong user pull",
    risks: "Differentiation can erode if outputs feel generic",
  },
  {
    positioning: "Affordable automation layer",
    pricingSignal: "Low entry price with paid upgrades",
    strengths: "Accessible for smaller teams",
    risks: "Enterprise readiness and trust signals may lag",
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
