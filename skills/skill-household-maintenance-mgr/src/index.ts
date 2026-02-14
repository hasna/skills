#!/usr/bin/env bun
/**
 * skill-household-maintenance-mgr
 * Plans home maintenance schedules using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type MaintenanceTemplate = Record<string, unknown>;

interface SkillOptions {
  context: string;
  property?: string;
  season?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: MaintenanceTemplate;
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

const SKILL_SLUG = "household-maintenance-mgr";

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
    .slice(0, 40) || "maintenance-plan";
}

function parseJsonTemplate(content: string): MaintenanceTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as MaintenanceTemplate;
    }
  } catch (_error) {
    // treat as text if JSON parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-household-maintenance-mgr - Plan home maintenance schedules using AI

Usage:
  skills run household-maintenance-mgr -- <property-file> [options]
  skills run household-maintenance-mgr -- --text "<property-details>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline property details
  --property <type>        Property type (default: home)
  --season <schedule>      Maintenance schedule (default: quarterly)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Summary of maintenance needs
  - Upcoming tasks with timeframes
  - Recurring schedule (monthly, quarterly, annual)
  - Supplies and parts list
  - Contractor prompts for professional help
  - Safety-critical task flags

Examples:
  skills run household-maintenance-mgr -- ./property.json --season "spring"
  skills run household-maintenance-mgr -- --text "3BR house, built 1990, gas furnace, asphalt shingle roof" --property "single-family"

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
      property: { type: "string" },
      season: { type: "string" },
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

  let context = values.text || "";
  let template: MaintenanceTemplate | undefined;

  if (!context && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    context = template ? "" : content;
  }

  if (!context.trim() && !template) {
    throw new Error("Provide property details via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    context,
    property: values.property,
    season: values.season,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a meticulous household maintenance planner. Produce checklists, schedules, and supply reminders tailored to property type, climate, and equipment. Flag safety-critical tasks and suggest professional help where appropriate. Avoid structural engineering advice.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, upcoming_tasks, recurring_schedule, supplies, contractor_prompts, notes. Include timeframes and responsible party hints."
      : "Respond in Markdown with sections for Summary, Upcoming Tasks, Recurring Schedule, Supplies & Parts, Contractor Prompts, and Notes. Use tables or bullet lists for clarity.";

  const payload = {
    property: options.property || "home",
    season: options.season || "quarterly",
    property_details: options.context.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nProperty context:\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.4,
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

  const descriptorParts = [options.property || "home", options.season || "quarterly"];
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
    logger.info("Parsed property context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed maintenance planning prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received maintenance schedule from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved maintenance plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
