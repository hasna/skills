#!/usr/bin/env bun
/**
 * skill-homework-feedback-coach
 * Drafts rubric-aligned feedback using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type SubmissionTemplate = Record<string, unknown>;

interface SkillOptions {
  submission: string;
  rubric?: string;
  tone?: string;
  goal?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SubmissionTemplate;
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

const SKILL_SLUG = "homework-feedback-coach";

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
    .slice(0, 40) || "homework-feedback";
}

function parseJsonTemplate(content: string): SubmissionTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SubmissionTemplate;
    }
  } catch (_error) {
    // treat as text if parsing fails
  }
  return undefined;
}

function readOptionalFile(value?: string): string | undefined {
  if (!value) return undefined;
  const expanded = value.startsWith("~")
    ? value.replace("~", process.env.HOME || "")
    : value;
  try {
    const resolved = resolve(expanded);
    if (existsSync(resolved)) {
      return readFileSync(resolved, "utf-8");
    }
  } catch (_error) {
    // fall back to treating value as inline text
  }
  return value;
}

function showHelp(): void {
  console.log(`
skill-homework-feedback-coach - Draft rubric-aligned feedback using AI

Usage:
  skills run homework-feedback-coach -- <submission-file> [options]
  skills run homework-feedback-coach -- --text "<student-work>" [options]

Options:
  -h, --help               Show this help message
  --text <submission>      Inline student work
  --rubric <path|text>     Rubric file path or inline text
  --tone <style>           Feedback tone (default: encouraging)
  --goal <objective>       Learning goal (default: standard mastery)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Summary
  - Strengths
  - Growth areas
  - Next steps
  - Rubric alignment
  - Notes

Examples:
  skills run homework-feedback-coach -- ./essay.txt --rubric ./rubric.txt
  skills run homework-feedback-coach -- --text "Student's paragraph..." --tone "constructive"

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
      rubric: { type: "string" },
      tone: { type: "string" },
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

  let submission = values.text || "";
  let template: SubmissionTemplate | undefined;

  if (!submission && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    submission = template ? "" : content;
  }

  if (!submission.trim() && !template) {
    throw new Error("Provide student work via file path, JSON template, or --text.");
  }

  const rubric = readOptionalFile(values.rubric);

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    submission,
    rubric,
    tone: values.tone,
    goal: values.goal,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an empathetic educator delivering standards-based feedback. Reference rubric descriptors, celebrate strengths, and outline actionable next steps. Avoid numeric grades and maintain a professional tone.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, strengths, growth_areas, next_steps, rubric_alignment, notes. Include criterion references."
      : "Respond in Markdown with sections for Summary, Strengths, Growth Areas, Next Steps, Rubric Alignment, and Notes. Cite rubric criteria where relevant.";

  const payload = {
    tone: options.tone || "encouraging",
    goal: options.goal || "standard mastery",
    rubric: options.rubric?.substring(0, 6000),
    submission_excerpt: options.submission.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nFeedback context:\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.32,
    max_tokens: options.format === "json" ? 1700 : 1600,
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

  const descriptorParts = [options.tone || "encouraging", options.goal || "mastery"];
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
    logger.info("Parsed submission, rubric, and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed homework feedback prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received homework feedback from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved homework feedback to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
