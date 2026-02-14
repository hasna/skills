#!/usr/bin/env bun
/**
 * skill-action-item-router
 * Routes action items into target systems using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type PriorityMode = "strict" | "balanced" | "light";

type RoutingTemplate = {
  items?: Array<Record<string, unknown>>;
  systems?: Array<Record<string, unknown>>;
  defaults?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

interface SkillOptions {
  rawItems: string;
  workspace?: string;
  defaultSystem?: string;
  priorityMode: PriorityMode;
  sla?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: RoutingTemplate;
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

const SKILL_SLUG = "action-item-router";

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
    .slice(0, 40) || "action-items";
}

function parseJsonTemplate(content: string): RoutingTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as RoutingTemplate;
    }
  } catch (error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      workspace: { type: "string" },
      "default-system": { type: "string" },
      "priority-mode": { type: "string", default: "balanced" },
      sla: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
skill-action-item-router - Route action items to target systems

Usage:
  bun run skills/skill-action-item-router/src/index.ts [options] [file]

Options:
  -h, --help           Show this help message
  --text <text>        Action items as text
  --workspace <name>   Workspace name
  --default-system <s> Default target system (Asana, Jira, etc.)
  --priority-mode <m>  Priority mode: strict | balanced | light (default: balanced)
  --sla <time>         SLA deadline (default: 48h)
  --format <fmt>       Output format: markdown | json (default: markdown)
  --model <model>      OpenAI model (default: gpt-4o-mini)
  --output <path>      Output file path

Examples:
  bun run skills/skill-action-item-router/src/index.ts items.txt
  bun run skills/skill-action-item-router/src/index.ts --text "Review Q4 budget"
`);
    process.exit(0);
  }

  let rawItems = values.text || "";
  let template: RoutingTemplate | undefined;

  if (!rawItems && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    rawItems = template ? "" : content;
  }

  if (!rawItems.trim() && !template) {
    throw new Error("Provide action items via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let priorityMode: PriorityMode = "balanced";
  if (values["priority-mode"] === "strict" || values["priority-mode"] === "balanced" || values["priority-mode"] === "light") {
    priorityMode = values["priority-mode"];
  }

  return {
    rawItems,
    workspace: values.workspace,
    defaultSystem: values["default-system"],
    priorityMode,
    sla: values.sla,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an operations orchestrator that routes action items to the right destination systems.
Recommend the best system per item (e.g. Asana, Jira, Salesforce, Notion, Zendesk, Email) based on context and tags.
Include enriched metadata so the task can be pasted directly into the target tool.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, items, routing_rules, escalations. Each item should include title, summary, owner_suggestion, priority, due, destination_system, destination_payload, tags." 
      : "Respond in polished Markdown. Start with summary bullet list, include a table (Item, Destination, Owner, Due, Priority, Notes), routing rules, escalations, and integration steps.";

  const payload = {
    workspace: options.workspace || "general workspace",
    default_system: options.defaultSystem || "Asana",
    priority_mode: options.priorityMode,
    sla: options.sla || "48h",
    raw_items: options.rawItems.substring(0, 6000),
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
    temperature: 0.36,
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

  const descriptor = options.workspace ? `${options.workspace}-${options.priorityMode}` : sessionStamp;
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
    logger.info("Parsed action routing inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed routing prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received action routing guidance from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved routing plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
