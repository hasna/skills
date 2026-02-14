#!/usr/bin/env bun
/**
 * skill-pet-care-scheduler
 * Coordinates pet care schedules and reminders using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type PetTemplate = Record<string, unknown>;

interface SkillOptions {
  profile: string;
  audience?: string;
  species?: string;
  timespan?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: PetTemplate;
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

const SKILL_SLUG = "pet-care-scheduler";

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
    .slice(0, 40) || "pet-care";
}

function parseJsonTemplate(content: string): PetTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as PetTemplate;
    }
  } catch (_error) {
    // treat as text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-pet-care-scheduler - Coordinate pet care schedules and reminders using AI

Usage:
  skills run pet-care-scheduler -- <pet-profile-file> [options]
  skills run pet-care-scheduler -- --text "<pet-details>" [options]

Options:
  -h, --help               Show this help message
  --text <profile>         Inline pet profile/details
  --audience <role>        Target audience (default: owner)
  --species <type>         Pet species (default: mixed)
  --timespan <duration>    Schedule timespan (default: 7 days)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Overview
  - Daily schedule
  - Medication plan
  - Reminders
  - Supplies checklist
  - Vet notes

Examples:
  skills run pet-care-scheduler -- ./pets.json --timespan "14 days"
  skills run pet-care-scheduler -- --text "2 dogs, daily walks needed" --species "dog"

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
      species: { type: "string" },
      timespan: { type: "string" },
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
  let template: PetTemplate | undefined;

  if (!profile && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    profile = template ? "" : content;
  }

  if (!profile.trim() && !template) {
    throw new Error("Provide pet care details via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    profile,
    audience: values.audience,
    species: values.species,
    timespan: values.timespan,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an organized pet care coordinator. Build daily schedules, medication reminders, and supply checklists tailored to species and household routines. Emphasize safety, dosage accuracy, and vet escalation guidance. Do not provide veterinary diagnoses.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, daily_schedule, medication_plan, reminders, supplies, vet_notes. Include timing, responsible person, and alerts for each item."
      : "Respond in Markdown with sections for Overview, Daily Schedule, Medication Plan, Reminders, Supplies, and Vet Notes. Use tables for schedules and bullets for reminders.";

  const payload = {
    audience: options.audience || "owner",
    species: options.species || "mixed",
    timespan: options.timespan || "7 days",
    pet_profile: options.profile.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nPet care context:\n${JSON.stringify(payload, null, 2)}`;

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
    max_tokens: options.format === "json" ? 1900 : 1800,
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

  const descriptorParts = [options.audience || "owner", options.timespan || "7-days"];
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
    logger.info("Parsed pet care context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed pet care scheduling prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received pet care schedule from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved pet care schedule to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
