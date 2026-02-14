#!/usr/bin/env bun
/**
 * skill-kpi-digest-generator
 * Produces narrative KPI digests using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type DigestTemplate = {
  metrics?: Array<Record<string, unknown>>;
  highlights?: Array<Record<string, unknown>>;
  alerts?: Array<Record<string, unknown>>;
  commentary?: string;
};

interface SkillOptions {
  dataset: string;
  cadence?: string;
  audience?: string;
  alerts?: string[];
  trendWindow?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DigestTemplate;
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

const SKILL_SLUG = "kpi-digest-generator";

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
    .slice(0, 40) || "kpi-digest";
}

function parseJsonTemplate(content: string): DigestTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DigestTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function showHelp(): void {
  console.log(`
skill-kpi-digest-generator - Produce narrative KPI digests using AI

Usage:
  skills run kpi-digest-generator -- <data-file> [options]
  skills run kpi-digest-generator -- --text "<kpi-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline KPI data
  --cadence <period>       Reporting cadence (default: monthly)
  --audience <type>        Report audience (default: Leadership)
  --alerts <list>          Comma-separated alert topics
  --trend-window <period>  Trend analysis window (default: 4 weeks)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Key metrics with deltas
  - Trend highlights
  - Alerts and risks
  - Recommended actions

Examples:
  skills run kpi-digest-generator -- ./metrics.json --cadence "weekly"
  skills run kpi-digest-generator -- --text "Revenue: $1.2M, Churn: 2.1%" --audience "Board"

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
      cadence: { type: "string" },
      audience: { type: "string" },
      alerts: { type: "string" },
      "trend-window": { type: "string" },
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
  let template: DigestTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide KPI data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    dataset,
    cadence: values.cadence,
    audience: values.audience,
    alerts: parseList(values.alerts),
    trendWindow: values["trend-window"],
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an FP&A analyst preparing a KPI digest.
Summarize metrics, highlight trends, flag alerts, and recommend actions for the specified audience.
Use the cadence and trend window to contextualize performance.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, metrics, trends, alerts, recommendations, next_steps. Metrics entries should include name, value, delta, sparkline_comment, owner." 
      : "Respond in polished Markdown. Start with an executive summary, present key KPIs with deltas and sparkline commentary, highlight trends over the trend window, call out alerts, and list recommended actions with owners and deadlines.";

  const payload = {
    cadence: options.cadence || "monthly",
    audience: options.audience || "Leadership",
    alerts: options.alerts || [],
    trend_window: options.trendWindow || "4 weeks",
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
    temperature: 0.36,
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

  const descriptorParts = [options.cadence || "digest", options.audience || "audience"];
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
    logger.info("Parsed KPI data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed KPI digest prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received KPI digest from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved KPI digest to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
