#!/usr/bin/env bun
/**
 * skill-scholarship-tracker
 * Matches students to scholarships and tracks tasks using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type ScholarshipTemplate = Record<string, unknown>;

interface SkillOptions {
  profile: string;
  student?: string;
  term?: string;
  focus?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: ScholarshipTemplate;
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

const SKILL_SLUG = "scholarship-tracker";

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
    .slice(0, 40) || "scholarship-tracker";
}

function parseJsonTemplate(content: string): ScholarshipTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as ScholarshipTemplate;
    }
  } catch (_error) {
    // treat as text if parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-scholarship-tracker - Match students to scholarships and track tasks using AI

Usage:
  skills run scholarship-tracker -- <profile-file> [options]
  skills run scholarship-tracker -- --text "<student-profile>" [options]

Options:
  -h, --help               Show this help message
  --text <profile>         Inline student profile
  --student <name>         Student name/identifier
  --term <period>          Target term (default: upcoming)
  --focus <area>           Focus area (default: general)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Summary
  - Scholarship opportunities
  - Eligibility notes
  - Application tasks
  - Documentation checklist
  - Reminders

Examples:
  skills run scholarship-tracker -- ./student-profile.json --focus "STEM"
  skills run scholarship-tracker -- --text "Senior, 3.8 GPA, CS major" --term "Fall 2025"

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
      term: { type: "string" },
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

  let profile = values.text || "";
  let template: ScholarshipTemplate | undefined;

  if (!profile && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    profile = template ? "" : content;
  }

  if (!profile.trim() && !template) {
    throw new Error("Provide student profile via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    profile,
    student: values.student,
    term: values.term,
    focus: values.focus,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a scholarship coach. Recommend relevant opportunities, note eligibility, and build application task trackers. Encourage verification and note sources. Do not guarantee awards or fabricate funding.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, opportunities, eligibility_notes, tasks, documentation, reminders. Include deadlines (ISO when possible) and required effort estimates."
      : "Respond in Markdown with sections for Summary, Opportunities, Eligibility Notes, Tasks, Documentation, and Reminders. Include deadlines and verification tips.";

  const payload = {
    student: options.student || "student",
    term: options.term || "upcoming",
    focus: options.focus || "general",
    profile_excerpt: options.profile.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nScholarship context:\n${JSON.stringify(payload, null, 2)}`;

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
    max_tokens: options.format === "json" ? 2100 : 1900,
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

  const descriptorParts = [options.focus || "general", options.term || "upcoming"];
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
    logger.info("Parsed scholarship profile and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed scholarship tracking prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received scholarship tracker from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved scholarship tracker to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
