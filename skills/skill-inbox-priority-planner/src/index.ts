#!/usr/bin/env bun
/**
 * skill-inbox-priority-planner
 * Generates prioritized inbox action plans using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type InboxTemplate = {
  messages?: Array<Record<string, unknown>>;
  threads?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

interface SkillOptions {
  inboxText: string;
  persona?: string;
  backlogWindow?: string;
  workdayStart?: string;
  workdayEnd?: string;
  capacity?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: InboxTemplate;
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

const SKILL_SLUG = "inbox-priority-planner";

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
    .slice(0, 40) || "inbox-plan";
}

function parseJsonTemplate(content: string): InboxTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as InboxTemplate;
    }
  } catch (error) {
    // treat as plain text if JSON parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-inbox-priority-planner - Generate prioritized inbox action plans using AI

Usage:
  skills run inbox-priority-planner -- <inbox-file> [options]
  skills run inbox-priority-planner -- --text "<inbox-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline inbox data/messages
  --persona <type>         Worker persona (default: general knowledge worker)
  --backlog-window <time>  Backlog time window (default: 48h)
  --workday-start <time>   Workday start time (default: 09:00)
  --workday-end <time>     Workday end time (default: 17:00)
  --capacity <hours>       Available capacity (default: 3h)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run inbox-priority-planner -- ./inbox-export.txt --persona "Executive"
  skills run inbox-priority-planner -- --text "5 urgent emails..." --capacity "2h"

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
      persona: { type: "string" },
      "backlog-window": { type: "string" },
      "workday-start": { type: "string" },
      "workday-end": { type: "string" },
      capacity: { type: "string" },
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

  let inboxText = values.text || "";
  let template: InboxTemplate | undefined;

  if (!inboxText && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    inboxText = template ? "" : content;
  }

  if (!inboxText.trim() && !template) {
    throw new Error("Provide inbox data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    inboxText,
    persona: values.persona,
    backlogWindow: values["backlog-window"],
    workdayStart: values["workday-start"],
    workdayEnd: values["workday-end"],
    capacity: values.capacity,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an executive assistant triaging email.
Categorize each message by urgency, importance, and delegation potential.
Return a plan that slots work into the day, schedules follow-ups, and drafts reply notes.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, urgent, focus_blocks, quick_replies, delegate, defer. Each item should include subject, rationale, recommended_action, owner, eta, suggested_reply." 
      : "Respond in polished Markdown. Start with an executive summary, list urgent responses, outline focus blocks with associated messages, quick replies, delegation list, deferred queue, and include draft snippets.";

  const payload = {
    persona: options.persona || "general knowledge worker",
    backlog_window: options.backlogWindow || "48h",
    workday_start: options.workdayStart || "09:00",
    workday_end: options.workdayEnd || "17:00",
    capacity: options.capacity || "3h",
    inbox_text: options.inboxText.substring(0, 6000),
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
    temperature: 0.37,
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

  const descriptor = options.persona ? `${options.persona}-${options.backlogWindow || "inbox"}` : sessionStamp;
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
    logger.info("Parsed inbox inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed inbox planning prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received inbox plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved inbox plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
