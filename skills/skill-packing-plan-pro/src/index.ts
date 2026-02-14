#!/usr/bin/env bun
/**
 * skill-packing-plan-pro
 * Creates tailored packing lists using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type PackingTemplate = {
  trip?: Record<string, unknown>;
  activities?: Array<Record<string, unknown>>;
  preferences?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  trip: string;
  audience?: string;
  weather?: string;
  constraints?: string[];
  format: OutputFormat;
  model: string;
  output?: string;
  template?: PackingTemplate;
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

const SKILL_SLUG = "packing-plan-pro";

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
    .slice(0, 40) || "packing-plan";
}

function parseJsonTemplate(content: string): PackingTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as PackingTemplate;
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
skill-packing-plan-pro - Create tailored packing lists using AI

Usage:
  skills run packing-plan-pro -- <trip-file> [options]
  skills run packing-plan-pro -- --text "<trip-details>" [options]

Options:
  -h, --help               Show this help message
  --text <details>         Inline trip details
  --audience <type>        Traveler type: Solo | Family | Business (default: Solo)
  --weather <conditions>   Expected weather (default: mixed)
  --constraints <list>     Comma-separated constraints (e.g., carry-on only)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run packing-plan-pro -- ./trip-itinerary.txt --weather "tropical"
  skills run packing-plan-pro -- --text "7 days in Paris" --audience Family

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
      weather: { type: "string" },
      constraints: { type: "string" },
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

  let trip = values.text || "";
  let template: PackingTemplate | undefined;

  if (!trip && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    trip = template ? "" : content;
  }

  if (!trip.trim() && !template) {
    throw new Error("Provide trip details via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    trip,
    audience: values.audience,
    weather: values.weather,
    constraints: parseList(values.constraints),
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a travel concierge crafting tailored packing lists.
Consider itinerary, weather, and traveler preferences.
Include essentials, activity-specific gear, documents, tech, wellness items, and reminders.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, essentials, clothing, gear, toiletries, documents, reminders. For each item include quantity, rationale, and notes." 
      : "Respond in polished Markdown. Start with an executive summary, list categorized packing sections (essentials, clothing, accessories, tech, toiletries, documents), note optional items, include reminders and weight-saving tips.";

  const payload = {
    audience: options.audience || "Solo",
    weather: options.weather || "mixed",
    constraints: options.constraints || [],
    trip_text: options.trip.substring(0, 6000),
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
    temperature: 0.41,
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

  const descriptorParts = [options.audience || "solo", options.weather || "mixed"];
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
    logger.info("Parsed trip data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed packing plan prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received packing plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved packing plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
