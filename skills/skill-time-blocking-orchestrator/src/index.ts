#!/usr/bin/env bun
/**
 * skill-time-blocking-orchestrator
 * Generates calendar-friendly time blocks using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type FocusMode = "maker" | "manager" | "hybrid";

type DayTemplate = {
  tasks?: Array<Record<string, unknown>>;
  meetings?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  preferences?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  agenda: string;
  date?: string;
  timezone?: string;
  workHours?: string;
  focusMode: FocusMode;
  contextSwitchLimit: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DayTemplate;
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

const SKILL_SLUG = "time-blocking-orchestrator";

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
    .slice(0, 40) || "time-blocks";
}

function parseJsonTemplate(content: string): DayTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DayTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-time-blocking-orchestrator - Generate calendar-friendly time blocks using AI

Usage:
  skills run time-blocking-orchestrator -- <agenda-file> [options]
  skills run time-blocking-orchestrator -- --text "<tasks-and-meetings>" [options]

Options:
  -h, --help                     Show this help message
  --text <agenda>                Inline agenda/tasks
  --date <date>                  Planning date (default: today)
  --timezone <tz>                Timezone (default: UTC)
  --work-hours <range>           Work hours (default: 09:00-17:00)
  --focus-mode <mode>            Focus mode: maker | manager | hybrid (default: hybrid)
  --context-switch-limit <num>   Max context switches (default: 4)
  --format <type>                Output format: markdown | json (default: markdown)
  --model <model>                OpenAI model (default: gpt-4o-mini)
  --output <path>                Custom output file path

Output includes:
  - Schedule summary
  - Time blocks with focus areas
  - Buffer periods
  - Conflict flags
  - Recommendations

Examples:
  skills run time-blocking-orchestrator -- ./agenda.txt --focus-mode "maker"
  skills run time-blocking-orchestrator -- --text "Code review, 2 meetings" --work-hours "08:00-16:00"

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
      date: { type: "string" },
      timezone: { type: "string" },
      "work-hours": { type: "string" },
      "focus-mode": { type: "string", default: "hybrid" },
      "context-switch-limit": { type: "string", default: "4" },
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

  let agenda = values.text || "";
  let template: DayTemplate | undefined;

  if (!agenda && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    agenda = template ? "" : content;
  }

  if (!agenda.trim() && !template) {
    throw new Error("Provide inputs via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let focusMode: FocusMode = "hybrid";
  if (values["focus-mode"] === "maker" || values["focus-mode"] === "manager" || values["focus-mode"] === "hybrid") {
    focusMode = values["focus-mode"];
  }

  const parsedSwitchLimit = Number.parseInt(values["context-switch-limit"], 10);
  const contextSwitchLimit = Number.isNaN(parsedSwitchLimit) ? 4 : Math.max(1, parsedSwitchLimit);

  return {
    agenda,
    date: values.date,
    timezone: values.timezone,
    workHours: values["work-hours"],
    focusMode,
    contextSwitchLimit,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an elite time management strategist.
Build a realistic schedule that respects existing meetings, deep work needs, and energy cycles.
Prevent over-scheduling and include buffers, ramp-down, and recovery breaks.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, blocks, buffers, conflicts, recommendations. Each block should include start, end, title, category, energy, location, notes." 
      : "Respond in polished Markdown. Start with a summary blockquote, include a table of scheduled blocks (time, focus, intention), list buffers and transitions, flag conflicts, and final recommendations.";

  const payload = {
    date: options.date || new Date().toISOString().slice(0, 10),
    timezone: options.timezone || "UTC",
    work_hours: options.workHours || "09:00-17:00",
    focus_mode: options.focusMode,
    context_switch_limit: options.contextSwitchLimit,
    agenda_text: options.agenda.substring(0, 6000),
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
    temperature: 0.35,
    max_tokens: options.format === "json" ? 2300 : 2100,
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

  const descriptorParts = [options.date || "day", options.focusMode];
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
    logger.info("Parsed scheduling inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed time-blocking prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received time-block plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved time-block plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
