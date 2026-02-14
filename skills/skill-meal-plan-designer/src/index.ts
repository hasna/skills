#!/usr/bin/env bun
/**
 * skill-meal-plan-designer
 * Creates personalized meal plans and grocery lists using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type MealTemplate = {
  preferences?: Record<string, unknown>;
  nutrition?: Record<string, unknown>;
  schedule?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  profile: string;
  audience?: string;
  duration?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: MealTemplate;
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

const SKILL_SLUG = "meal-plan-designer";

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
    .slice(0, 40) || "meal-plan";
}

function parseJsonTemplate(content: string): MealTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as MealTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-meal-plan-designer - Create personalized meal plans and grocery lists using AI

Usage:
  skills run meal-plan-designer -- <profile-file> [options]
  skills run meal-plan-designer -- --text "<dietary-profile>" [options]

Options:
  -h, --help               Show this help message
  --text <profile>         Inline dietary profile/requirements
  --audience <type>        Target audience: Individual | Family | Athletes
  --duration <days>        Plan duration (default: 7 days)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Daily meal schedule
  - Recipes with nutrition info
  - Categorized grocery list with quantities
  - Prep tips and guidance
  - Substitution options

Examples:
  skills run meal-plan-designer -- ./diet-profile.txt --duration "14 days"
  skills run meal-plan-designer -- --text "Vegetarian, low sodium" --audience Family
  skills run meal-plan-designer -- requirements.json --format json

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

  let profile = values.text || "";
  let template: MealTemplate | undefined;

  if (!profile && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    profile = template ? "" : content;
  }

  if (!profile.trim() && !template) {
    throw new Error("Provide meal plan profile via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    profile,
    audience: values.audience,
    duration: values.duration,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a registered dietitian crafting meal plans.
Balance nutrition targets, dietary restrictions, and schedule.
Provide meal schedule, recipes, grocery list with quantities, prep guidance, and substitution options.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, schedule, meals, grocery_list, prep_plan, substitutions. Each meal entry should include name, calories, macros, recipe_notes." 
      : "Respond in polished Markdown. Start with an executive summary, outline daily schedule with meals/snacks, include nutrition highlights, grocery list categorized with quantities, prep tips, and substitutions.";

  const payload = {
    audience: options.audience || "Individual",
    duration: options.duration || "7 days",
    profile_text: options.profile.substring(0, 6000),
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
    temperature: 0.38,
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

  const descriptorParts = [options.audience || "individual", options.duration || "7-days"];
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
    logger.info("Parsed meal plan profile and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed meal plan prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received meal plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved meal plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
