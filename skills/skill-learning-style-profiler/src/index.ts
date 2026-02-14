#!/usr/bin/env bun
/**
 * skill-learning-style-profiler
 * Generates learning preference profiles using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type ProfileTemplate = Record<string, unknown>;

interface SkillOptions {
  observations: string;
  student?: string;
  age?: string;
  focus?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: ProfileTemplate;
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

const SKILL_SLUG = "learning-style-profiler";

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
    .slice(0, 40) || "learning-profile";
}

function parseJsonTemplate(content: string): ProfileTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as ProfileTemplate;
    }
  } catch (_error) {
    // treat as text if parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-learning-style-profiler - Generate learning preference profiles using AI

Usage:
  skills run learning-style-profiler -- <observations-file> [options]
  skills run learning-style-profiler -- --text "<observations>" [options]

Options:
  -h, --help               Show this help message
  --text <observations>    Inline learning observations text
  --student <name>         Student name or identifier
  --age <age>              Student age or age group
  --focus <context>        Focus area: classroom | homeschool | tutoring
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run learning-style-profiler -- ./student-observations.txt
  skills run learning-style-profiler -- --text "Student prefers visual aids" --student "Alex" --age 12
  skills run learning-style-profiler -- observations.json --format json

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
      age: { type: "string" },
      focus: { type: "string" },
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

  let observations = values.text || "";
  let template: ProfileTemplate | undefined;

  if (!observations && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    observations = template ? "" : content;
  }

  if (!observations.trim() && !template) {
    throw new Error("Provide learning observations via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    observations,
    student: values.student,
    age: values.age,
    focus: values.focus,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an inclusive learning strategist. Translate observations into preference insights, brain-based recommendations, and collaboration guidance. Emphasize strengths, provide actionable strategies, and avoid labeling students rigidly.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, strengths, engagement_strategies, environment_supports, collaboration_tips, cautions. Include rationale for each suggestion."
      : "Respond in Markdown with sections for Overview, Strengths, Engagement Strategies, Environment Supports, Collaboration Tips, and Cautions. Include concrete examples.";

  const payload = {
    student: options.student || "learner",
    age: options.age || "mixed ages",
    focus: options.focus || "classroom",
    observation_excerpt: options.observations.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nLearning profile context:\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.46,
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

  const descriptorParts = [options.student || "learner", options.focus || "classroom"];
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
    logger.info("Parsed learning observations and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed learning profile prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received learning profile from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved learning profile to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
