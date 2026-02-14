#!/usr/bin/env bun
/**
 * skill-stress-relief-playbook
 * Builds personalized stress relief routines using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type MoodTemplate = Record<string, unknown>;

interface SkillOptions {
  checkIn: string;
  mood?: string;
  energy?: string;
  duration?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: MoodTemplate;
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

const SKILL_SLUG = "stress-relief-playbook";

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
    .slice(0, 40) || "stress-relief";
}

function showHelp(): void {
  console.log(`
skill-stress-relief-playbook - Build personalized stress relief routines using AI

Usage:
  skills run stress-relief-playbook -- <check-in-file> [options]
  skills run stress-relief-playbook -- --text "<mood-check-in>" [options]

Options:
  -h, --help               Show this help message
  --text <check-in>        Inline mood check-in text
  --mood <state>           Current mood (default: reflective)
  --energy <level>         Energy level (default: moderate)
  --duration <time>        Available time (default: 15 minutes)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Overview
  - Immediate relief steps
  - Extended practice
  - Environment reset
  - Ongoing habits
  - Follow-up suggestions

Examples:
  skills run stress-relief-playbook -- ./mood-check.txt --duration "30 minutes"
  skills run stress-relief-playbook -- --text "Feeling overwhelmed after meetings" --mood "anxious"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseJsonTemplate(content: string): MoodTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as MoodTemplate;
    }
  } catch (_error) {
    // ignore parse errors, treat content as plain text
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      mood: { type: "string" },
      energy: { type: "string" },
      duration: { type: "string" },
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

  let checkIn = values.text || "";
  let template: MoodTemplate | undefined;

  if (!checkIn && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    checkIn = template ? "" : content;
  }

  if (!checkIn.trim() && !template) {
    throw new Error("Provide a mood check-in via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    checkIn,
    mood: values.mood,
    energy: values.energy,
    duration: values.duration,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a trauma-informed wellbeing coach who designs compassionate, evidence-based stress relief routines. Offer grounding, mindfulness, movement, or reframing exercises that are safe for general audiences. Highlight when to seek professional support and avoid diagnosing conditions.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, immediate_steps, extended_practice, environment_reset, follow_up, reminders. Each step should list purpose, duration, and instructions."
      : "Respond in polished Markdown. Include sections for Overview, Immediate Relief, Extended Practice, Environment Reset, Ongoing Habits, and Suggested Follow-ups. Use bullet lists and time estimates.";

  const payload = {
    mood: options.mood || "reflective",
    energy: options.energy || "moderate",
    available_time: options.duration || "15 minutes",
    check_in_text: options.checkIn.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nMood context:\n${JSON.stringify(payload, null, 2)}`;

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
    max_tokens: options.format === "json" ? 1900 : 1700,
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

  const descriptorParts = [options.mood || "general", options.duration || "15-min"];
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
    logger.info("Parsed mood check-in and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed stress relief prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received stress relief playbook from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved stress relief playbook to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
