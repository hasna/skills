#!/usr/bin/env bun
/**
 * skill-wellness-progress-reporter
 * Combines wellness metrics into narrative reports using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type WellnessTemplate = Record<string, unknown>;

interface SkillOptions {
  data: string;
  audience?: string;
  lookback?: string;
  focus?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: WellnessTemplate;
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

const SKILL_SLUG = "wellness-progress-reporter";

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
    .slice(0, 40) || "wellness-report";
}

function parseJsonTemplate(content: string): WellnessTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as WellnessTemplate;
    }
  } catch (_error) {
    // treat as raw text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-wellness-progress-reporter - Generate wellness progress reports using AI

Usage:
  skills run wellness-progress-reporter -- <data-file> [options]
  skills run wellness-progress-reporter -- --text "<wellness-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline wellness data/metrics
  --audience <type>        Report audience: self | coach | physician (default: self)
  --lookback <period>      Analysis period (default: 14 days)
  --focus <area>           Focus area (default: overall balance)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Metrics snapshot
  - Trend highlights
  - Risks to watch
  - Experiment suggestions
  - Follow-up actions

Examples:
  skills run wellness-progress-reporter -- ./health-data.json --lookback "30 days"
  skills run wellness-progress-reporter -- --text "Sleep: 7h avg, Steps: 8k/day" --focus "sleep"

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
      audience: { type: "string" },
      lookback: { type: "string" },
      focus: { type: "string" },
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

  let data = values.text || "";
  let template: WellnessTemplate | undefined;

  if (!data && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    data = template ? "" : content;
  }

  if (!data.trim() && !template) {
    throw new Error("Provide wellness data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    data,
    audience: values.audience,
    lookback: values.lookback,
    focus: values.focus,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a wellness data analyst and health coach. Turn multi-source metrics into accessible narratives, highlight statistically relevant shifts, and suggest low-risk experiments. Avoid medical diagnoses or guarantees.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: executive_summary, metrics_snapshot, trends, risks, experiments, follow_up. Include numeric references and percent changes when possible."
      : "Respond in Markdown with sections for Executive Summary, Metrics Snapshot, Trend Highlights, Risks to Watch, Experiments, and Follow-up Actions. Use bullet lists and tables for clarity.";

  const payload = {
    audience: options.audience || "self",
    lookback: options.lookback || "14 days",
    focus: options.focus || "overall balance",
    data_excerpt: options.data.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nWellness dataset:\n${JSON.stringify(payload, null, 2)}`;

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

  const descriptorParts = [options.audience || "self", options.lookback || "14-days"];
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
    logger.info("Parsed wellness metrics and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed wellness report prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received wellness progress report from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved wellness report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
