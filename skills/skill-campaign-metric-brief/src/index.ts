#!/usr/bin/env bun
/**
 * skill-campaign-metric-brief
 * Summarizes campaign analytics into executive briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type BenchmarksMode = "industry" | "historical" | "none";

type MetricsTemplate = {
  metrics?: Array<Record<string, unknown>>;
  notes?: string;
  highlights?: Array<Record<string, unknown>>;
  anomalies?: Array<Record<string, unknown>>;
};

interface SkillOptions {
  dataset: string;
  goal?: string;
  timeframe?: string;
  audience?: string;
  benchmarks: BenchmarksMode;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: MetricsTemplate;
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

const SKILL_SLUG = "campaign-metric-brief";
const SESSION_ID = randomUUID().slice(0, 8);

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
  const logFile = join(logDir, `log_${sessionStamp}_${SESSION_ID}.log`);

  function write(level: "info" | "success" | "error", message: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    appendFileSync(logFile, entry);
    const prefix = level === "success" ? "✅" : level === "error" ? "❌" : "ℹ️";
    if (level === "error") {
      console.error(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
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
    .slice(0, 40) || "campaign-brief";
}

function parseJsonTemplate(content: string): MetricsTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as MetricsTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      goal: { type: "string" },
      timeframe: { type: "string" },
      audience: { type: "string" },
      benchmarks: { type: "string", default: "historical" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Campaign Metric Brief - Summarizes campaign analytics

Usage:
  skills run campaign-metric-brief -- [options] <file-path>

Options:
  --text <string>      Raw campaign metrics
  --goal <string>      Campaign goal
  --timeframe <string> Analysis timeframe
  --audience <string>  Target audience
  --benchmarks <mode>  Benchmarks mode: industry, historical, none (default: historical)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let dataset = values.text || "";
  let template: MetricsTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide campaign metrics via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let benchmarks: BenchmarksMode = "historical";
  if (values.benchmarks === "industry" || values.benchmarks === "historical" || values.benchmarks === "none") {
    benchmarks = values.benchmarks as BenchmarksMode;
  }

  return {
    dataset,
    goal: values.goal as string,
    timeframe: values.timeframe as string,
    audience: values.audience as string,
    benchmarks,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a marketing analytics lead preparing an executive briefing.
Digest campaign metrics, surface key wins and gaps, reference benchmarks, and recommend next actions.
Tailor tone to the specified audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, topline, channel_breakdown, efficiency, risks, recommendations, next_steps. Include numeric deltas, benchmark comparisons, and confidence levels." 
      : "Respond in polished Markdown. Start with an executive summary, present topline metrics with deltas, channel-level insights, efficiency analysis (CAC/ROAS), risks/opportunities, and recommended next steps with owners.";

  const payload = {
    goal: options.goal || "revenue",
    timeframe: options.timeframe || "current period",
    audience: options.audience || "executives",
    benchmarks: options.benchmarks,
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
    temperature: 0.33,
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

  const descriptor = options.timeframe ? `${options.goal || "campaign"}-${options.timeframe}` : sessionStamp;
  const base = slugify(descriptor);
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
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Parsed campaign metrics and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed campaign brief prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received campaign brief from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved campaign brief to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
