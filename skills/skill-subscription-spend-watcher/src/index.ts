#!/usr/bin/env bun
/**
 * skill-subscription-spend-watcher
 * Detects subscription spend anomalies using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type SpendTemplate = {
  subscriptions?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  period?: string;
  threshold: number;
  currency?: string;
  audience?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SpendTemplate;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

const SKILL_SLUG = "subscription-spend-watcher";

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function getPaths() {
  const sessionStamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_");
  const exportsRoot = process.env.SKILLS_EXPORTS_DIR || join(process.cwd(), ".skills", "exports");
  const logsRoot = process.env.SKILLS_LOGS_DIR || join(process.cwd(), ".skills", "logs");

  const skillExportsDir = join(exportsRoot, SKILL_SLUG);
  const skillLogsDir = join(logsRoot, SKILL_SLUG);

  ensureDir(skillExportsDir);
  ensureDir(skillLogsDir);

  return {
    sessionStamp,
    skillExportsDir,
    skillLogsDir,
  };
}

function createLogger(logDir: string, sessionStamp: string) {
  const logFile = join(logDir, `log_${sessionStamp}.txt`);

  function write(level: "info" | "success" | "error", message: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    appendFileSync(logFile, entry);
    const prefix = level === "success" ? "✅" : level === "error" ? "❌" : "ℹ️";
    console.log(`${prefix} ${message}`);
  }

  return {
    info: (message: string) => write("info", message),
    success: (message: string) => write("success", message),
    error: (message: string) => write("error", message),
    logFile,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "subscription-spend";
}

function parseJsonTemplate(content: string): SpendTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SpendTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-subscription-spend-watcher - Detect subscription spend anomalies using AI

Usage:
  skills run subscription-spend-watcher -- <data-file> [options]
  skills run subscription-spend-watcher -- --text "<subscription-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline subscription data
  --period <period>        Analysis period (default: current month)
  --threshold <percent>    Variance threshold percentage (default: 30)
  --currency <code>        Currency code (default: USD)
  --audience <type>        Report audience (default: Finance)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Anomaly detection
  - Underutilized tools
  - Upcoming renewals
  - Savings recommendations

Examples:
  skills run subscription-spend-watcher -- ./subscriptions.csv --threshold 20
  skills run subscription-spend-watcher -- --text "Slack: $500/mo, Zoom: $300/mo" --audience "Leadership"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      period: { type: "string" },
      threshold: { type: "string", default: "30" },
      currency: { type: "string" },
      audience: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  let dataset = values.text || "";
  let template: SpendTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide subscription data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const threshold = (() => {
    const parsed = Number.parseFloat(values.threshold);
    return Number.isNaN(parsed) ? 30 : Math.max(1, parsed);
  })();

  return {
    dataset,
    period: values.period,
    threshold,
    currency: values.currency,
    audience: values.audience,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a finance operations analyst reviewing subscription spend.
Identify underutilized tools, overlapping vendors, sudden cost spikes, and upcoming renewals.
Recommend savings actions tailored to the specified audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, anomalies, underutilized, renewals, recommendations. Each entry should include vendor, spend, usage_metric, variance, recommended_action, savings_estimate." 
      : "Respond in polished Markdown. Start with an executive summary, list anomalies and underutilized tools (vendor, spend, usage, savings estimate), highlight renewals and risks, and recommend actions with owners and timelines.";

  const payload = {
    period: options.period || "current month",
    threshold_percent: options.threshold,
    currency: options.currency || "USD",
    audience: options.audience || "Finance",
    dataset_text: options.dataset.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\n${JSON.stringify(payload, null, 2)}`;

  return { system, user };
}

async function callOpenAI(options: SkillOptions, system: string, user: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required.");
  }

  const body = {
    model: options.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.37,
    max_tokens: options.format === "json" ? 2200 : 2000,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data: OpenAIChatResponse = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not include content.");
  }

  return content.trim();
}

async function writeExport(path: string, content: string) {
  ensureDir(dirname(path));
  await Bun.write(path, content);
}

function buildExportPath(skillExportsDir: string, sessionStamp: string, options: SkillOptions) {
  if (options.output) {
    return resolve(options.output);
  }

  const descriptorParts = [options.period || "period", `${options.threshold}`];
  const base = slugify(descriptorParts.filter(Boolean).join("-"));
  const extension = options.format === "json" ? "json" : "md";
  return join(skillExportsDir, `${base}_${sessionStamp}.${extension}`);
}

function preview(content: string) {
  const lines = content.split(/\r?\n/).slice(0, 8);
  lines.forEach(line => console.log(`   ${line}`));
  if (content.split(/\r?\n/).length > 8) {
    console.log("   ...");
  }
}

async function main() {
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    const options = parseOptions();
    logger.info("Parsed subscription spend inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed spend analysis prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received subscription spend report from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved subscription spend report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
