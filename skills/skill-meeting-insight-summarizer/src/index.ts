#!/usr/bin/env bun
/**
 * skill-meeting-insight-summarizer
 * Generates structured meeting summaries using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type FocusArea = "actions" | "risks" | "decisions" | "all";

type MeetingTemplate = {
  agenda?: Array<Record<string, unknown>>;
  notes?: string;
  participants?: Array<Record<string, unknown>>;
  decisions?: Array<Record<string, unknown>>;
  action_items?: Array<Record<string, unknown>>;
};

interface SkillOptions {
  notes: string;
  meeting?: string;
  date?: string;
  focus: FocusArea;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: MeetingTemplate;
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

const SKILL_SLUG = "meeting-insight-summarizer";

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
    .slice(0, 40) || "meeting-summary";
}

function parseJsonTemplate(content: string): MeetingTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as MeetingTemplate;
    }
  } catch (error) {
    // treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-meeting-insight-summarizer - Generate structured meeting summaries using AI

Usage:
  skills run meeting-insight-summarizer -- <notes-file> [options]
  skills run meeting-insight-summarizer -- --text "<meeting-notes>" [options]

Options:
  -h, --help               Show this help message
  --text <notes>           Inline meeting notes
  --meeting <name>         Meeting name/title
  --date <date>            Meeting date (default: today)
  --focus <area>           Focus area: actions | risks | decisions | all (default: all)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Decisions made
  - Action items with owners and due dates
  - Risks identified
  - Open questions
  - Attendee contributions

Examples:
  skills run meeting-insight-summarizer -- ./notes.txt --meeting "Q4 Planning"
  skills run meeting-insight-summarizer -- --text "Discussed roadmap..." --focus "actions"

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
      meeting: { type: "string" },
      date: { type: "string" },
      focus: { type: "string", default: "all" },
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

  let notes = values.text || "";
  let template: MeetingTemplate | undefined;

  if (!notes && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    notes = template ? "" : content;
  }

  if (!notes.trim() && !template) {
    throw new Error("Provide meeting notes via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let focus: FocusArea = "all";
  if (values.focus === "actions" || values.focus === "risks" || values.focus === "decisions" || values.focus === "all") {
    focus = values.focus;
  }

  return {
    notes,
    meeting: values.meeting,
    date: values.date,
    focus,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an expert chief of staff and meeting facilitator.
Summarize the meeting with clarity, capturing alignment, decisions, risks, and follow-up tasks.
Preserve nuance while keeping content concise and actionable.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, decisions, action_items, risks, follow_up, attendees, questions. Each action_item should include owner, due, status, notes." 
      : "Respond in polished Markdown. Start with an executive summary, list decisions, table of action items (owner, due, status), risks, open questions, and attendee shout-outs.";

  const payload = {
    meeting: options.meeting || "General meeting",
    date: options.date || new Date().toISOString().slice(0, 10),
    focus: options.focus,
    notes_text: options.notes.substring(0, 6000),
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

  const descriptor = options.meeting ? `${options.meeting}-${options.date || "summary"}` : sessionStamp;
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
    logger.info("Parsed meeting notes and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed meeting summary prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received meeting summary from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved summary to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
