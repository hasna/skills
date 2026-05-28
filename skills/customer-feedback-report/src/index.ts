#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type FeedbackChannel = "reviews" | "tickets" | "calls" | "surveys" | "mixed";
type ReportFormat = "product" | "support" | "executive";
type Sentiment = "positive" | "negative" | "mixed";
type Impact = "high" | "medium" | "low";

interface FeedbackOptions {
  feedback: string;
  product: string;
  segment: string;
  channel: FeedbackChannel;
  format: ReportFormat;
  outputDir: string;
}

interface FeedbackItem {
  id: string;
  text: string;
  sentiment: Sentiment;
  themes: string[];
}

interface ThemeDefinition {
  name: string;
  keywords: string[];
  rootCause: string;
  recommendation: string;
}

interface Cluster {
  theme: string;
  count: number;
  share: number;
  sentiment: Sentiment;
  impact: Impact;
  rootCause: string;
  recommendation: string;
  examples: string[];
}

const SKILL_NAME = "customer-feedback-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const CHANNELS: FeedbackChannel[] = ["reviews", "tickets", "calls", "surveys", "mixed"];
const FORMATS: ReportFormat[] = ["product", "support", "executive"];

const HELP = `Customer Feedback Report

Usage:
  skills run customer-feedback-report --feedback "Users love onboarding but struggle with invoices" --product "Skills.md"
  skills run customer-feedback-report ./feedback.txt --channel tickets --format product

Options:
  --feedback <text>  Raw feedback text
  --source <path>    Read feedback text from a file
  --product <text>   Product, service, or workflow name. Default: Product
  --segment <text>   Customer segment. Default: All customers
  --channel <type>   reviews, tickets, calls, surveys, or mixed. Default: mixed
  --format <type>    product, support, or executive. Default: product
  --output <dir>     Output directory. Default: current run export directory
  --help             Show this help

Outputs:
  customer-feedback-report.md, customer-feedback-report.pdf, feedback-clusters.csv,
  roadmap-suggestions.md, sentiment-summary.json, evidence.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const items = parseFeedbackItems(options.feedback);
  const clusters = buildClusters(items);
  const sentimentSummary = buildSentimentSummary(items);
  const roadmap = buildRoadmap(options, clusters);
  const report = buildMarkdownReport(options, items, clusters, sentimentSummary, roadmap);
  const files = writeArtifacts(options, items, clusters, sentimentSummary, roadmap, report);

  console.log(`Generated customer feedback report for ${options.product}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.report}`);
  console.log(`- ${files.pdf}`);
  console.log(`- ${files.clustersCsv}`);
  console.log(`- ${files.roadmap}`);
  console.log(`- ${files.sentimentJson}`);
  console.log(`- ${files.evidenceJson}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): FeedbackOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      feedback: { type: "string" },
      source: { type: "string" },
      product: { type: "string", default: "Product" },
      segment: { type: "string", default: "All customers" },
      channel: { type: "string", default: "mixed" },
      format: { type: "string", default: "product" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const channel = String(values.channel || "mixed");
  if (!isFeedbackChannel(channel)) {
    console.error("Invalid channel. Use reviews, tickets, calls, surveys, or mixed.");
    process.exit(1);
  }

  const format = String(values.format || "product");
  if (!isReportFormat(format)) {
    console.error("Invalid format. Use product, support, or executive.");
    process.exit(1);
  }

  const sourcePath = String(values.source || "").trim();
  const sourceFeedback = sourcePath ? readSource(sourcePath) : "";
  const feedback = String(values.feedback || sourceFeedback || positionals.join(" ")).trim();
  if (!feedback) {
    console.error("Feedback is required. Pass --feedback <text>, --source <path>, or positional text.");
    process.exit(1);
  }

  return {
    feedback,
    product: String(values.product || "Product").trim(),
    segment: String(values.segment || "All customers").trim(),
    channel,
    format,
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

function parseFeedbackItems(feedback: string): FeedbackItem[] {
  const rawItems = feedback
    .split(/\n{2,}|\r?\n[-*]\s+|\r?\n\d+\.\s+|\r?\n/)
    .map((item) => item.replace(/^[-*\d.\s]+/, "").trim())
    .filter((item) => item.length > 8);
  const items = rawItems.length > 0 ? rawItems : [feedback.trim()];

  return items.slice(0, 150).map((text, index) => {
    const themes = findThemes(text);
    return {
      id: `feedback-${String(index + 1).padStart(3, "0")}`,
      text,
      sentiment: scoreSentiment(text),
      themes: themes.length > 0 ? themes : ["General Experience"],
    };
  });
}

function buildClusters(items: FeedbackItem[]): Cluster[] {
  const themeMap = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    for (const theme of item.themes) {
      const current = themeMap.get(theme) || [];
      current.push(item);
      themeMap.set(theme, current);
    }
  }

  return Array.from(themeMap.entries())
    .map(([theme, themeItems]) => {
      const definition = themeDefinitions.find((candidate) => candidate.name === theme) || fallbackTheme(theme);
      const count = themeItems.length;
      const sentiment = dominantSentiment(themeItems);
      return {
        theme,
        count,
        share: Math.round((count / Math.max(items.length, 1)) * 100),
        sentiment,
        impact: impactFor(count, items.length, sentiment),
        rootCause: definition.rootCause,
        recommendation: definition.recommendation,
        examples: themeItems.slice(0, 3).map((item) => item.text),
      };
    })
    .sort((a, b) => b.count - a.count || impactRank(a.impact) - impactRank(b.impact) || a.theme.localeCompare(b.theme))
    .slice(0, 12);
}

function buildSentimentSummary(items: FeedbackItem[]) {
  const counts = {
    positive: items.filter((item) => item.sentiment === "positive").length,
    negative: items.filter((item) => item.sentiment === "negative").length,
    mixed: items.filter((item) => item.sentiment === "mixed").length,
  };
  const total = Math.max(items.length, 1);
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    totalFeedbackItems: items.length,
    counts,
    percentages: {
      positive: Math.round((counts.positive / total) * 100),
      negative: Math.round((counts.negative / total) * 100),
      mixed: Math.round((counts.mixed / total) * 100),
    },
  };
}

function buildRoadmap(options: FeedbackOptions, clusters: Cluster[]): string {
  const topClusters = clusters.slice(0, 5);
  return `# Roadmap Suggestions: ${options.product}

## Prioritized Moves

${topClusters.map((cluster, index) => `${index + 1}. **${cluster.theme}** (${cluster.impact} impact): ${cluster.recommendation}`).join("\n")}

## Product Bets

${topClusters.map((cluster) => `- Build a measurable improvement around ${cluster.theme.toLowerCase()}: ${cluster.rootCause}`).join("\n")}

## Support and Success Plays

${clusters.slice(0, 4).map((cluster) => `- Create a response macro or help asset for ${cluster.theme.toLowerCase()} feedback.`).join("\n")}

## Follow-Up Research

- Run a focused interview set with ${options.segment} customers who mentioned the top two themes.
- Track whether the next release reduces repeated ${topClusters[0]?.theme.toLowerCase() || "customer"} feedback.
- Re-run this report after product changes to compare cluster share and sentiment movement.
`;
}

function buildMarkdownReport(
  options: FeedbackOptions,
  items: FeedbackItem[],
  clusters: Cluster[],
  sentimentSummary: ReturnType<typeof buildSentimentSummary>,
  roadmap: string,
): string {
  const topCluster = clusters[0];
  const headline = topCluster
    ? `${topCluster.theme} is the clearest action area, representing ${topCluster.share}% of analyzed feedback.`
    : "Feedback volume is limited; collect more responses before making large roadmap calls.";

  return `# Customer Feedback Report: ${options.product}

## Executive Summary

Analyzed ${items.length} ${options.channel} feedback item${items.length === 1 ? "" : "s"} from ${options.segment}. ${headline} The report is formatted for ${options.format} planning and turns raw feedback into product, support, and roadmap actions.

## Sentiment Snapshot

| Sentiment | Count | Share |
| --- | ---: | ---: |
| Positive | ${sentimentSummary.counts.positive} | ${sentimentSummary.percentages.positive}% |
| Negative | ${sentimentSummary.counts.negative} | ${sentimentSummary.percentages.negative}% |
| Mixed | ${sentimentSummary.counts.mixed} | ${sentimentSummary.percentages.mixed}% |

## Feedback Clusters

| Theme | Count | Share | Sentiment | Impact | Root Cause |
| --- | ---: | ---: | --- | --- | --- |
${clusters.map((cluster) => `| ${cell(cluster.theme)} | ${cluster.count} | ${cluster.share}% | ${cluster.sentiment} | ${cluster.impact} | ${cell(cluster.rootCause)} |`).join("\n")}

## Root Cause Notes

${clusters.slice(0, 6).map((cluster) => `### ${cluster.theme}

- **What customers are signaling:** ${cluster.examples[0] || "Not enough examples yet."}
- **Likely root cause:** ${cluster.rootCause}
- **Recommended response:** ${cluster.recommendation}
`).join("\n")}

## Evidence Examples

${clusters.slice(0, 5).map((cluster) => `### ${cluster.theme}
${cluster.examples.map((example) => `- "${truncate(example, 220)}"`).join("\n")}
`).join("\n")}

## Roadmap Summary

${roadmap.replace(/^# .+\n+/, "").trim()}
`;
}

function writeArtifacts(
  options: FeedbackOptions,
  items: FeedbackItem[],
  clusters: Cluster[],
  sentimentSummary: ReturnType<typeof buildSentimentSummary>,
  roadmap: string,
  report: string,
) {
  const reportPath = join(options.outputDir, "customer-feedback-report.md");
  const pdfPath = join(options.outputDir, "customer-feedback-report.pdf");
  const clustersCsvPath = join(options.outputDir, "feedback-clusters.csv");
  const roadmapPath = join(options.outputDir, "roadmap-suggestions.md");
  const sentimentPath = join(options.outputDir, "sentiment-summary.json");
  const evidencePath = join(options.outputDir, "evidence.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, report);
  writeFileSync(pdfPath, buildPdf(report));
  writeFileSync(clustersCsvPath, clustersToCsv(clusters));
  writeFileSync(roadmapPath, roadmap);
  writeJson(sentimentPath, sentimentSummary);
  writeJson(evidencePath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    feedbackItems: items.map((item) => ({
      id: item.id,
      sentiment: item.sentiment,
      themes: item.themes,
      excerpt: truncate(item.text, 320),
    })),
    clusters: clusters.map((cluster) => ({
      theme: cluster.theme,
      examples: cluster.examples.map((example) => truncate(example, 320)),
    })),
  });
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      product: options.product,
      segment: options.segment,
      channel: options.channel,
      format: options.format,
      feedbackItemCount: items.length,
    },
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      clustersCsv: toManifestPath(options.outputDir, clustersCsvPath),
      roadmap: toManifestPath(options.outputDir, roadmapPath),
      sentimentSummary: toManifestPath(options.outputDir, sentimentPath),
      evidence: toManifestPath(options.outputDir, evidencePath),
    },
  });

  return {
    report: reportPath,
    pdf: pdfPath,
    clustersCsv: clustersCsvPath,
    roadmap: roadmapPath,
    sentimentJson: sentimentPath,
    evidenceJson: evidencePath,
    manifest: manifestPath,
  };
}

function findThemes(text: string): string[] {
  const lower = text.toLowerCase();
  return themeDefinitions
    .filter((theme) => theme.keywords.some((keyword) => lower.includes(keyword)))
    .map((theme) => theme.name);
}

function scoreSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();
  const positives = ["love", "great", "easy", "fast", "helpful", "clear", "delight", "excellent", "smooth", "valuable"];
  const negatives = ["hate", "slow", "broken", "confusing", "hard", "expensive", "missing", "bug", "issue", "frustrating", "poor", "fail"];
  const positive = positives.filter((word) => lower.includes(word)).length;
  const negative = negatives.filter((word) => lower.includes(word)).length;
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "mixed";
}

function dominantSentiment(items: FeedbackItem[]): Sentiment {
  const counts = { positive: 0, negative: 0, mixed: 0 };
  for (const item of items) counts[item.sentiment] += 1;
  if (counts.negative >= counts.positive && counts.negative >= counts.mixed) return "negative";
  if (counts.positive >= counts.mixed) return "positive";
  return "mixed";
}

function impactFor(count: number, total: number, sentiment: Sentiment): Impact {
  const share = count / Math.max(total, 1);
  if (share >= 0.35 || (sentiment === "negative" && share >= 0.2)) return "high";
  if (share >= 0.15 || sentiment === "negative") return "medium";
  return "low";
}

function impactRank(impact: Impact): number {
  return impact === "high" ? 0 : impact === "medium" ? 1 : 2;
}

function clustersToCsv(clusters: Cluster[]): string {
  const headers = ["theme", "count", "share", "sentiment", "impact", "rootCause", "recommendation"] as const;
  return [
    headers.join(","),
    ...clusters.map((cluster) => headers.map((header) => csvCell(String(cluster[header]))).join(",")),
  ].join("\n") + "\n";
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 48);
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

function fallbackTheme(theme: string): ThemeDefinition {
  return {
    name: theme,
    keywords: [],
    rootCause: "Feedback points to a recurring experience gap that needs sharper instrumentation.",
    recommendation: "Tag new feedback with this theme, gather examples, and size the opportunity before committing roadmap capacity.",
  };
}

function isFeedbackChannel(value: string): value is FeedbackChannel {
  return CHANNELS.includes(value as FeedbackChannel);
}

function isReportFormat(value: string): value is ReportFormat {
  return FORMATS.includes(value as ReportFormat);
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

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

const themeDefinitions: ThemeDefinition[] = [
  {
    name: "Onboarding",
    keywords: ["onboarding", "setup", "start", "first", "signup", "install", "activation"],
    rootCause: "First-run guidance is not matching the customer's mental model or time-to-value expectation.",
    recommendation: "Simplify first-run steps, add progress feedback, and ship clearer activation examples.",
  },
  {
    name: "Pricing and Billing",
    keywords: ["price", "pricing", "cost", "expensive", "billing", "invoice", "subscription", "checkout", "payment"],
    rootCause: "Customers do not fully understand what they pay for or how usage maps to value.",
    recommendation: "Clarify pricing copy, expose pre-run quotes, and add billing state messaging in the product.",
  },
  {
    name: "Reliability and Bugs",
    keywords: ["bug", "broken", "crash", "error", "fail", "failed", "issue", "reliable", "stuck", "timeout"],
    rootCause: "Core workflows are hitting failures that customers cannot diagnose or recover from themselves.",
    recommendation: "Prioritize reproducible failures, add user-visible recovery states, and publish incident-level follow-up.",
  },
  {
    name: "Performance",
    keywords: ["slow", "speed", "fast", "lag", "latency", "wait", "loading", "performance"],
    rootCause: "Workflow latency is high enough that users question whether the product is working.",
    recommendation: "Add progress indicators, reduce slow path latency, and set clear expectations for long-running jobs.",
  },
  {
    name: "Integrations",
    keywords: ["integration", "integrate", "slack", "github", "stripe", "api", "webhook", "zapier", "export", "import"],
    rootCause: "Customers want the product to fit existing systems without manual transfer work.",
    recommendation: "Prioritize the highest-volume integration requests and document supported import/export paths.",
  },
  {
    name: "Documentation and Clarity",
    keywords: ["docs", "documentation", "guide", "confusing", "unclear", "understand", "explain", "help"],
    rootCause: "Users cannot predict the correct action from current labels, docs, or examples.",
    recommendation: "Improve task-specific docs, rename ambiguous labels, and add examples near the point of action.",
  },
  {
    name: "Support Experience",
    keywords: ["support", "response", "helpdesk", "ticket", "agent", "reply", "service"],
    rootCause: "Customers need faster or more specific help when the product does not resolve their issue directly.",
    recommendation: "Create support macros for repeated themes and route high-impact accounts to proactive follow-up.",
  },
  {
    name: "Feature Requests",
    keywords: ["wish", "missing", "need", "request", "feature", "add", "could", "want"],
    rootCause: "Customers are asking the product to cover adjacent jobs or missing workflow edges.",
    recommendation: "Group requests by job-to-be-done, estimate reach, and reserve roadmap capacity for high-frequency gaps.",
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
