#!/usr/bin/env bun
/**
 * skill-sales-call-recapper
 * Generates sales call recap emails using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type EmailTone = "professional" | "friendly" | "concise";

type RecapTemplate = {
  summary?: string;
  highlights?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  next_steps?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  notes: string;
  account?: string;
  contact?: string;
  stage?: string;
  tone: EmailTone;
  cta?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: RecapTemplate;
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

const SKILL_SLUG = "sales-call-recapper";

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
    .slice(0, 40) || "sales-recap";
}

function parseJsonTemplate(content: string): RecapTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as RecapTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      account: { type: "string" },
      contact: { type: "string" },
      stage: { type: "string" },
      tone: { type: "string", default: "professional" },
      cta: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  let notes = values.text || "";
  let template: RecapTemplate | undefined;

  if (!notes && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    notes = template ? "" : content;
  }

  if (!notes.trim() && !template) {
    throw new Error("Provide call notes via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let tone: EmailTone = "professional";
  if (values.tone === "professional" || values.tone === "friendly" || values.tone === "concise") {
    tone = values.tone;
  }

  return {
    notes,
    account: values.account,
    contact: values.contact,
    stage: values.stage,
    tone,
    cta: values.cta,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an account executive crafting a polished call recap email.
Summarize key outcomes, reiterate value, confirm next steps, and reinforce momentum.
Keep tone aligned with the requested style and pipeline stage.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: subject, greeting, summary, value_points, next_steps, asks, follow_up_date, signature, p.s. Each next_steps item should include owner, action, due, confidence." 
      : "Respond in polished Markdown formatted as an email. Include subject line, greeting, gratitude, bullet summary, value reinforcement, numbered next steps with owners and due dates, explicit CTA, and warm sign-off.";

  const payload = {
    account: options.account || "valued customer",
    contact: options.contact || "team",
    stage: options.stage || "Discovery",
    tone: options.tone,
    cta: options.cta || "schedule next meeting",
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
    temperature: 0.41,
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

  const descriptor = options.account ? `${options.account}-${options.stage || "recap"}` : sessionStamp;
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
    logger.info("Parsed call notes and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed recap prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received recap email from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved recap to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
