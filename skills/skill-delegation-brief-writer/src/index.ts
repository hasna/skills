#!/usr/bin/env bun
/**
 * skill-delegation-brief-writer
 * Generates structured delegation briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type PriorityLevel = "low" | "normal" | "high" | "urgent";

type DelegationTemplate = {
  background?: string;
  objective?: string;
  deliverables?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  checkpoints?: Array<Record<string, unknown>>;
  stakeholders?: Array<Record<string, unknown>>;
};

interface SkillOptions {
  briefText: string;
  assignee?: string;
  due?: string;
  priority: PriorityLevel;
  channels?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DelegationTemplate;
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

const SKILL_SLUG = "delegation-brief-writer";
const SESSION_ID = randomUUID().slice(0, 8);

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
  const logFile = join(logDir, `log_${sessionStamp}_${SESSION_ID}.log`);

  function write(level: "info" | "success" | "error", message: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    appendFileSync(logFile, entry);
    const prefix = level === "success" ? "✅" : level === "error" ? "❌" : "ℹ️";
    if (level === "error") {
      console.error(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
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
    .slice(0, 40) || "delegation-brief";
}

function parseJsonTemplate(content: string): DelegationTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DelegationTemplate;
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
      assignee: { type: "string" },
      due: { type: "string" },
      priority: { type: "string", default: "normal" },
      channels: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Delegation Brief Writer - Generates structured delegation briefs

Usage:
  skills run delegation-brief-writer -- [options] <file-path>

Options:
  --text <string>      Assignment context (or use positional arg)
  --assignee <string>  Assignee name
  --due <string>       Due date
  --priority <level>   Priority: low, normal, high, urgent (default: normal)
  --channels <string>  Communication channels
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let briefText = values.text || "";
  let template: DelegationTemplate | undefined;

  if (!briefText && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      briefText = template ? "" : content;
    } else {
      briefText = positionals.join(" ");
    }
  }

  if (!briefText.trim() && !template) {
    throw new Error("Provide assignment context via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let priority: PriorityLevel = "normal";
  if (values.priority === "low" || values.priority === "normal" || values.priority === "high" || values.priority === "urgent") {
    priority = values.priority as PriorityLevel;
  }

  return {
    briefText,
    assignee: values.assignee as string,
    due: values.due as string,
    priority,
    channels: values.channels as string,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an experienced operations manager and delegation coach.
Craft a concise, complete delegation brief that enables ownership without micromanagement.
Clarify objectives, success criteria, context, communication cadences, and risk mitigation.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, objectives, deliverables, context, communication, checkpoints, risks, escalation, resources. Each deliverable should include description, format, due, owner." 
      : "Respond in polished Markdown. Start with an executive summary, include bullet objectives, table of deliverables with due dates, communication cadence, checkpoints, risks, and quick-start steps.";

  const payload = {
    assignee: options.assignee || "unspecified",
    due: options.due || "unset",
    priority: options.priority,
    channels: options.channels || "weekly check-in",
    brief_text: options.briefText.substring(0, 6000),
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
    temperature: 0.42,
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

  const descriptor = options.assignee ? `${options.assignee}-${options.priority}` : sessionStamp;
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
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Parsed delegation inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed delegation prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received delegation brief from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved brief to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
