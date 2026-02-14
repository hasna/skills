#!/usr/bin/env bun
/**
 * skill-roi-comparison-tool
 * Compares ROI across campaigns using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type RoiTemplate = {
  campaigns?: Array<Record<string, unknown>>;
  notes?: string;
  benchmarks?: Record<string, unknown>;
};

interface SkillOptions {
  dataset: string;
  timeframe?: string;
  audience?: string;
  benchmarks?: string;
  sensitivity: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: RoiTemplate;
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

const SKILL_SLUG = "roi-comparison-tool";

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
    .slice(0, 40) || "roi-comparison";
}

function parseJsonTemplate(content: string): RoiTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as RoiTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
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
skill-roi-comparison-tool - Compare ROI across campaigns using AI

Usage:
  skills run roi-comparison-tool -- <data-file> [options]
  skills run roi-comparison-tool -- --text "<campaign-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline campaign ROI data
  --timeframe <period>     Analysis timeframe (default: current period)
  --audience <type>        Report audience (default: Leadership)
  --benchmarks <source>    Benchmark source (default: historical)
  --sensitivity <decimal>  Sensitivity threshold (default: 0.10)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Campaign comparison table
  - Sensitivity analysis
  - Benchmark performance
  - Budget reallocation recommendations

Examples:
  skills run roi-comparison-tool -- ./campaigns.csv --sensitivity 0.15
  skills run roi-comparison-tool -- --text "Email: $5k spend, $50k rev" --timeframe "Q4 2024"

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
      timeframe: { type: "string" },
      audience: { type: "string" },
      benchmarks: { type: "string" },
      sensitivity: { type: "string", default: "0.10" },
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
  let template: RoiTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide ROI data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const sensitivity = (() => {
    const parsed = Number.parseFloat(values.sensitivity);
    return Number.isNaN(parsed) ? 0.10 : Math.max(0.01, parsed);
  })();

  return {
    dataset,
    timeframe: values.timeframe,
    audience: values.audience,
    benchmarks: values.benchmarks,
    sensitivity,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a marketing finance analyst comparing campaign ROI.
Calculate ROI, CAC, payback, and efficiency metrics; perform sensitivity analysis; and suggest budget reallocations.
Reference benchmarks when available and tailor narrative to the audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, comparison_table, sensitivity, benchmarks, recommendations, risks. Comparison table entries should include campaign, spend, revenue, pipeline, roi, cac, payback." 
      : "Respond in polished Markdown. Start with an executive summary, provide a comparison table of campaigns (ROI, CAC, payback, pipeline), detail sensitivity insights, note benchmark performance, highlight risks/opportunities, and recommend next actions.";

  const payload = {
    timeframe: options.timeframe || "current period",
    audience: options.audience || "Leadership",
    benchmarks: options.benchmarks || "historical",
    sensitivity: options.sensitivity,
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

  const descriptorParts = [options.timeframe || "roi", options.benchmarks || "bench"];
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
    logger.info("Parsed ROI inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed ROI comparison prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received ROI comparison from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved ROI comparison to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
