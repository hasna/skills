#!/usr/bin/env bun
/**
 * skill-personal-daily-ops
 * Builds a prioritized daily operating plan using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type EnergyProfile = "morning peak" | "evening peak" | "balanced";

type WorkdayTemplate = {
  tasks?: Array<Record<string, unknown>>;
  meetings?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  rituals?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  workload: string;
  role?: string;
  day?: string;
  timezone?: string;
  workHours?: string;
  energy?: EnergyProfile;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: WorkdayTemplate;
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

const SKILL_SLUG = "personal-daily-ops";

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
    .slice(0, 40) || "daily-ops";
}

function parseJsonTemplate(content: string): WorkdayTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as WorkdayTemplate;
    }
  } catch (error) {
    // fall through to treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-personal-daily-ops - Build a prioritized daily operating plan using AI

Usage:
  skills run personal-daily-ops -- <workload-file> [options]
  skills run personal-daily-ops -- --text "<tasks-and-priorities>" [options]

Options:
  -h, --help               Show this help message
  --text <workload>        Inline tasks and priorities
  --role <role>            Your role (default: knowledge worker)
  --day <date>             Planning day (default: today)
  --timezone <tz>          Timezone (default: UTC)
  --work-hours <range>     Work hours (default: 09:00-17:00)
  --energy <profile>       Energy profile: morning peak | evening peak | balanced (default: balanced)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Daily summary
  - Prioritized schedule
  - Energy-matched blocks
  - Risk flags
  - Follow-up actions

Examples:
  skills run personal-daily-ops -- ./tasks.txt --energy "morning peak"
  skills run personal-daily-ops -- --text "Code review, client call, planning" --role "Tech lead"

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
      role: { type: "string" },
      day: { type: "string" },
      timezone: { type: "string" },
      "work-hours": { type: "string" },
      energy: { type: "string" },
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

  let workload = values.text || "";
  let template: WorkdayTemplate | undefined;

  if (!workload && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    workload = template ? "" : content;
  }

  if (!workload.trim() && !template) {
    throw new Error("Provide tasks via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let energy: EnergyProfile = "balanced";
  if (values.energy === "morning peak" || values.energy === "evening peak" || values.energy === "balanced") {
    energy = values.energy;
  }

  return {
    workload,
    role: values.role,
    day: values.day,
    timezone: values.timezone,
    workHours: values["work-hours"],
    energy,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an elite chief of staff and productivity strategist.
Design a realistic daily operating plan with timeboxing, focus blocks, and recovery periods.
Respect role context, meetings, and constraints. Flag conflicts and suggest delegation if needed.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, schedule, priorities, rituals, risks, follow_up. Schedule should be array with start, end, label, objective, energy_match, location, notes."
      : "Respond in polished Markdown. Start with a blockquote summary, include a table for schedule blocks, highlight top priorities, rituals, risk flags, and follow-up list.";

  const payload = {
    role: options.role || "knowledge worker",
    planning_day: options.day || "today",
    timezone: options.timezone || "UTC",
    work_hours: options.workHours || "09:00-17:00",
    energy_profile: options.energy || "balanced",
    workload_text: options.workload.substring(0, 6000),
    workload_template: options.template,
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
    temperature: 0.4,
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

  const base = slugify(options.role ? `${options.role}-${options.day || "agenda"}` : sessionStamp);
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
    logger.info("Parsed input options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed planning prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received agenda from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved agenda to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
