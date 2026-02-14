#!/usr/bin/env bun
/**
 * skill-project-retro-companion
 * Generates retrospective packets using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type FocusArea = "process" | "delivery" | "collaboration" | "quality" | "all";

type RetroTemplate = {
  went_well?: Array<Record<string, unknown>>;
  challenges?: Array<Record<string, unknown>>;
  ideas?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  feedbackText: string;
  cadence?: string;
  team?: string;
  focus: FocusArea;
  history?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: RetroTemplate;
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

const SKILL_SLUG = "project-retro-companion";

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
    .slice(0, 40) || "retro";
}

function parseJsonTemplate(content: string): RetroTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as RetroTemplate;
    }
  } catch (error) {
    // treat as plain text
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      cadence: { type: "string" },
      team: { type: "string" },
      focus: { type: "string", default: "all" },
      history: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  let feedbackText = values.text || "";
  let template: RetroTemplate | undefined;

  if (!feedbackText && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    feedbackText = template ? "" : content;
  }

  if (!feedbackText.trim() && !template) {
    throw new Error("Provide retro input via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let focus: FocusArea = "all";
  if (values.focus === "process" || values.focus === "delivery" || values.focus === "collaboration" || values.focus === "quality" || values.focus === "all") {
    focus = values.focus;
  }

  return {
    feedbackText,
    cadence: values.cadence,
    team: values.team,
    focus,
    history: values.history,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a seasoned agile coach and facilitator.
Analyze retrospective feedback, detect themes, and propose actionable experiments.
Encourage psychological safety and continuous improvement.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, appreciations, insights, risks, experiments, metrics, prompts. Experiments should include hypothesis, owner, start_date, expected_impact." 
      : "Respond in polished Markdown. Start with an overview, list appreciations, theme insights, risks, experiment backlog (table), metrics to watch, and tailored retro prompts.";

  const payload = {
    cadence: options.cadence || "current sprint",
    team: options.team || "cross-functional team",
    focus: options.focus,
    history: options.history,
    feedback_text: options.feedbackText.substring(0, 6000),
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
    temperature: 0.4,
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

  const descriptor = options.cadence ? `${options.cadence}-${options.team || "team"}` : sessionStamp;
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
    logger.info("Parsed retrospective inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed retro prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received retro packet from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved retro packet to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
