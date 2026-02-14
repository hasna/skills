#!/usr/bin/env bun
/**
 * skill-habit-reflection-digest
 * Generates reflective habit summaries using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type HabitTemplate = {
  habits?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  notes?: string;
  highlights?: Array<Record<string, unknown>>;
};

interface SkillOptions {
  trackerText: string;
  period?: string;
  focus?: string;
  goal?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: HabitTemplate;
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

const SKILL_SLUG = "habit-reflection-digest";

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
    .slice(0, 40) || "habit-digest";
}

function parseJsonTemplate(content: string): HabitTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as HabitTemplate;
    }
  } catch (error) {
    // treat as plain text if JSON parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-habit-reflection-digest - Generate reflective habit summaries using AI

Usage:
  skills run habit-reflection-digest -- <tracker-file> [options]
  skills run habit-reflection-digest -- --text "<habit-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline habit tracker data
  --period <duration>      Evaluation period (default: last 7 days)
  --focus <area>           Focus area (default: general)
  --goal <objective>       Goal for analysis (default: unspecified)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Summary with celebration
  - Wins and watch-outs
  - Trend analysis
  - Recommendations
  - Experiments to try
  - Affirmations

Examples:
  skills run habit-reflection-digest -- ./habits.json --period "last 30 days"
  skills run habit-reflection-digest -- --text "Day 1: Meditation 10m, Exercise 30m..." --focus "wellness"

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

  let trackerText = values.text || "";
  let template: HabitTemplate | undefined;

  if (!trackerText && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    trackerText = template ? "" : content;
  }

  if (!trackerText.trim() && !template) {
    throw new Error("Provide habit data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    trackerText,
    period: values.period,
    focus: values.focus,
    goal: values.goal,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a compassionate habit coach and data analyst.
Review the provided habit records and craft a reflective digest.
Celebrate progress, surface patterns, and recommend small, realistic adjustments.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, wins, struggles, trends, recommendations, experiments, metrics. Each trend should include habit, direction, evidence, confidence." 
      : "Respond in polished Markdown. Start with a blockquote celebration, include tables for wins and watch-outs, chart streak trends narratively, and close with experiments and affirmations.";

  const payload = {
    evaluation_period: options.period || "last 7 days",
    focus: options.focus || "general",
    goal: options.goal || "unspecified",
    tracker_text: options.trackerText.substring(0, 6000),
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
    temperature: 0.45,
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

  const descriptor = options.period ? `${options.period}-${options.focus || "digest"}` : sessionStamp;
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
    const options = parseOptions();
    logger.info("Parsed habit data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed reflection prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received habit digest from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved digest to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
