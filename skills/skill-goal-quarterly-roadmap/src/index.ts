#!/usr/bin/env bun
/**
 * skill-goal-quarterly-roadmap
 * Converts strategic goals into quarterly plans using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

interface GoalTemplate {
  goals?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  initiatives?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  notes?: string;
}

interface SkillOptions {
  narrative: string;
  quarter?: string;
  framework?: "okr" | "v2mom" | "roadmap";
  companyStage?: string;
  capacity?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: GoalTemplate;
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

const SKILL_SLUG = "goal-quarterly-roadmap";

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
    .slice(0, 40) || "quarterly-plan";
}

function parseJsonTemplate(content: string): GoalTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as GoalTemplate;
    }
  } catch (error) {
    // fall through to treat as plain text
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      quarter: { type: "string" },
      framework: { type: "string" },
      "company-stage": { type: "string" },
      capacity: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Goal Quarterly Roadmap - Convert strategic goals into quarterly plans

USAGE:
  skills run goal-quarterly-roadmap -- [input.json] [options]
  skills run goal-quarterly-roadmap -- --text "Your goals"

OPTIONS:
  -h, --help              Show this help message
  --text <text>           Goal narrative text
  --quarter <quarter>     Target quarter (e.g., Q1 2024)
  --framework <type>      Planning framework: okr, v2mom, roadmap
  --company-stage <stage> Company stage for context
  --capacity <info>       Team capacity information
  --format <format>       Output format: markdown, json (default: markdown)
  --model <model>         AI model to use (default: gpt-4o-mini)
  --output <file>         Output file path

EXAMPLES:
  skills run goal-quarterly-roadmap -- goals.json
  skills run goal-quarterly-roadmap -- --text "Increase revenue by 20%"
  skills run goal-quarterly-roadmap -- goals.json --framework okr --quarter "Q2 2024"
`);
    process.exit(0);
  }

  let narrative = values.text || "";
  let template: GoalTemplate | undefined;

  if (!narrative && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    narrative = template ? "" : content;
  }

  if (!narrative.trim() && !template) {
    throw new Error("Provide goal input via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let framework: "okr" | "v2mom" | "roadmap" | undefined;
  if (values.framework === "okr" || values.framework === "v2mom" || values.framework === "roadmap") {
    framework = values.framework;
  }

  return {
    narrative,
    quarter: values.quarter,
    framework,
    companyStage: values["company-stage"],
    capacity: values.capacity,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior strategy operator and portfolio PM.
Translate high-level goals into a realistic quarterly execution roadmap.
Balance ambition with capacity, highlight risks, and sequence milestones logically.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, okrs, roadmap, milestones, resources, risks, metrics. Each OKR should include objective, key_results (with target_metric, confidence), lead_owner, and dependencies."
      : "Respond in polished Markdown. Start with a blockquote executive summary, include an OKR table, milestone timeline, resource notes, risk register, and success metrics dashboard.";

  const payload = {
    quarter: options.quarter || "current quarter",
    framework: options.framework || "okr",
    company_stage: options.companyStage || "general",
    capacity: options.capacity || "unspecified",
    narrative_text: options.narrative.substring(0, 6000),
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
    temperature: 0.38,
    max_tokens: options.format === "json" ? 2400 : 2100,
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

  const descriptor = options.quarter ? `${options.quarter}-${options.framework || "plan"}` : sessionStamp;
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
    logger.info("Parsed goal inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed quarterly planning prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received quarterly roadmap from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved roadmap to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
