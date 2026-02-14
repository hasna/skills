#!/usr/bin/env bun
/**
 * skill-parent-teacher-brief
 * Generates parent-teacher meeting briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type BriefTemplate = Record<string, unknown>;

interface SkillOptions {
  context: string;
  student?: string;
  meeting?: string;
  tone?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: BriefTemplate;
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

const SKILL_SLUG = "parent-teacher-brief";

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
    .slice(0, 40) || "parent-teacher-brief";
}

function parseJsonTemplate(content: string): BriefTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as BriefTemplate;
    }
  } catch (_error) {
    // treat as text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-parent-teacher-brief - Generate parent-teacher meeting briefs using AI

Usage:
  skills run parent-teacher-brief -- <context-file> [options]
  skills run parent-teacher-brief -- --text "<meeting-context>" [options]

Options:
  -h, --help               Show this help message
  --text <context>         Inline meeting context
  --student <name>         Student name/identifier
  --meeting <type>         Meeting type (default: conference)
  --tone <style>           Communication tone (default: partnership)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run parent-teacher-brief -- ./student-notes.txt --student "Alex"
  skills run parent-teacher-brief -- --text "Progress meeting notes" --meeting "quarterly"

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
      student: { type: "string" },
      meeting: { type: "string" },
      tone: { type: "string" },
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
  let template: BriefTemplate | undefined;

  if (!context && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    context = template ? "" : content;
  }

  if (!context.trim() && !template) {
    throw new Error("Provide meeting details via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    context,
    student: values.student,
    meeting: values.meeting,
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a collaborative educator preparing conference materials. Summarize progress, co-create agenda items, note celebrations, and outline action steps. Maintain a strengths-based tone and avoid confidential details.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: agenda, strengths, growth_focus, family_questions, action_steps, resources, follow_up. Include responsible parties and timelines."
      : "Respond in Markdown with sections for Agenda, Strengths, Growth Focus, Family Questions, Action Steps, Resources, and Follow-up. Use bullet lists and highlight shared commitments.";

  const payload = {
    student: options.student || "student",
    meeting: options.meeting || "conference",
    tone: options.tone || "partnership",
    meeting_context: options.context.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nConference context:\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.36,
    max_tokens: options.format === "json" ? 1800 : 1700,
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

  const descriptorParts = [options.student || "student", options.meeting || "conference"];
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
    logger.info("Parsed conference context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed parent-teacher brief prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received parent-teacher brief from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved conference brief to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
