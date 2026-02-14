#!/usr/bin/env bun
/**
 * skill-seating-chart-maker
 * Optimizes seating charts using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type SeatingTemplate = {
  guests?: Array<Record<string, unknown>>;
  constraints?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  guests: string;
  tables?: number;
  capacity?: string[];
  audience?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SeatingTemplate;
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

const SKILL_SLUG = "seating-chart-maker";

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
    .slice(0, 40) || "seating";
}

function parseJsonTemplate(content: string): SeatingTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SeatingTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
  }
  return undefined;
}

function parseCapacity(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function showHelp(): void {
  console.log(`
skill-seating-chart-maker - Optimize seating charts using AI

Usage:
  skills run seating-chart-maker -- <guest-file> [options]
  skills run seating-chart-maker -- --text "<guest-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline guest data
  --tables <count>         Number of tables
  --capacity <list>        Comma-separated table capacities
  --audience <event>       Event type (default: Gala)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Table assignments with guest names
  - Conflict notes
  - Recommendations and adjustments

Examples:
  skills run seating-chart-maker -- ./guests.json --tables 10
  skills run seating-chart-maker -- --text "Alice (VIP), Bob (prefers quiet)..." --audience "Wedding"

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
      tables: { type: "string" },
      capacity: { type: "string" },
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

  let guests = values.text || "";
  let template: SeatingTemplate | undefined;

  if (!guests && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    guests = template ? "" : content;
  }

  if (!guests.trim() && !template) {
    throw new Error("Provide guest data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const tables = values.tables ? Number.parseInt(values.tables, 10) : undefined;

  return {
    guests,
    tables: tables && !Number.isNaN(tables) ? tables : undefined,
    capacity: parseCapacity(values.capacity),
    audience: values.audience,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an event planner optimizing seating assignments.
Respect guest preferences, avoid conflicts, balance table sizes, and note logistics.
Provide rationale for any compromises.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, tables, conflicts, recommendations. Each table entry should include table_name, guests, notes." 
      : "Respond in polished Markdown. Start with an executive summary, list table assignments with guest names and notes, highlight conflicts or follow-ups, and recommend adjustments.";

  const payload = {
    audience: options.audience || "Gala",
    tables: options.tables,
    capacity: options.capacity,
    guest_data: options.guests.substring(0, 6000),
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
    temperature: 0.4,
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

  const descriptorParts = [options.audience || "event", options.tables ? `tables${options.tables}` : "auto"];
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
    logger.info("Parsed guest data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed seating prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received seating plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved seating plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
