#!/usr/bin/env bun
/**
 * skill-sleep-routine-analyzer
 * Reviews sleep data and recommends adjustments using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type SleepTemplate = Record<string, unknown>;

interface SkillOptions {
  sleepData: string;
  focus?: string;
  goal?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SleepTemplate;
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

const SKILL_SLUG = "sleep-routine-analyzer";

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
    .slice(0, 40) || "sleep-routine";
}

function parseJsonTemplate(content: string): SleepTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SleepTemplate;
    }
  } catch (_error) {
    // ignore parse errors; treat content as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-sleep-routine-analyzer - Review sleep data and recommend adjustments using AI

Usage:
  skills run sleep-routine-analyzer -- <sleep-data-file> [options]
  skills run sleep-routine-analyzer -- --text "<sleep-log>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline sleep data
  --focus <area>           Focus area (default: routine)
  --goal <objective>       Sleep goal (default: consistent sleep)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Sleep trends
  - Contributing factors
  - Quick wins
  - Schedule adjustments
  - Tracking metrics
  - Follow-up notes

Examples:
  skills run sleep-routine-analyzer -- ./sleep-log.json --focus "quality"
  skills run sleep-routine-analyzer -- --text "Avg 6hrs, wake up tired" --goal "8 hours"

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
      focus: { type: "string" },
      goal: { type: "string" },
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

  let sleepData = values.text || "";
  let template: SleepTemplate | undefined;

  if (!sleepData && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    sleepData = template ? "" : content;
  }

  if (!sleepData.trim() && !template) {
    throw new Error("Provide sleep data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    sleepData,
    focus: values.focus,
    goal: values.goal,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a certified sleep coach translating logs into actionable recommendations. Identify patterns, highlight contributing factors, and propose gentle experiments grounded in sleep hygiene. Avoid medical diagnoses and encourage medical consultation for severe symptoms.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: trends, contributing_factors, quick_wins, schedule_adjustments, tracking_metrics, notes. Each recommendation should include rationale and expected impact."
      : "Respond in Markdown with sections for Sleep Trends, Contributing Factors, Quick Wins, Schedule Adjustments, Tracking Metrics, and Follow-up Notes. Include bullet lists and tables where useful.";

  const payload = {
    focus: options.focus || "routine",
    goal: options.goal || "consistent sleep",
    sleep_log_excerpt: options.sleepData.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nSleep data:\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.35,
    max_tokens: options.format === "json" ? 2000 : 1900,
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

  const descriptorParts = [options.focus || "routine", options.goal || "sleep"];
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
    logger.info("Parsed sleep data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed sleep routine analysis prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received sleep routine analysis from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved sleep recommendations to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
