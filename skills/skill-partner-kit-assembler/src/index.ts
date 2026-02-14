#!/usr/bin/env bun
/**
 * skill-partner-kit-assembler
 * Generates partner enablement kits using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type DeliverableTemplate = {
  partner_profile?: Record<string, unknown>;
  product?: Record<string, unknown>;
  value_props?: Array<Record<string, unknown>>;
  competitors?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  brief: string;
  partnerTier?: string;
  launchWindow?: string;
  deliverables?: string[];
  audience?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DeliverableTemplate;
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

const SKILL_SLUG = "partner-kit-assembler";

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
    .slice(0, 40) || "partner-kit";
}

function parseJsonTemplate(content: string): DeliverableTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DeliverableTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function showHelp(): void {
  console.log(`
skill-partner-kit-assembler - Generate partner enablement kits using AI

Usage:
  skills run partner-kit-assembler -- <brief-file> [options]
  skills run partner-kit-assembler -- --text "<partner-context>" [options]

Options:
  -h, --help               Show this help message
  --text <context>         Inline partner context/brief
  --partner-tier <tier>    Partner tier: reseller | affiliate | strategic
  --launch-window <days>   Launch timeline (default: 30 days)
  --deliverables <list>    Comma-separated deliverables (default: pitch deck,battlecard)
  --audience <type>        Target audience
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run partner-kit-assembler -- ./partner-info.txt --partner-tier strategic
  skills run partner-kit-assembler -- --text "New SaaS partner" --launch-window "60 days"

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
      "partner-tier": { type: "string" },
      "launch-window": { type: "string" },
      deliverables: { type: "string" },
      audience: { type: "string" },
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

  let brief = values.text || "";
  let template: DeliverableTemplate | undefined;

  if (!brief && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    brief = template ? "" : content;
  }

  if (!brief.trim() && !template) {
    throw new Error("Provide partner context via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief,
    partnerTier: values["partner-tier"],
    launchWindow: values["launch-window"],
    deliverables: parseList(values.deliverables),
    audience: values.audience,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a partner enablement leader crafting a launch kit.
Package messaging, assets, and campaign plays tailored to the partner tier and target audience.
Outline deliverables, responsibilities, timelines, and success metrics.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, messaging, deliverables, campaign_plays, enablement, metrics, checklist. Deliverables should include name, purpose, owner, format, due." 
      : "Respond in polished Markdown. Start with executive summary, include messaging pillars, deliverable table (asset, owner, due), campaign plays, enablement checklist, co-marketing metrics, and launch timeline.";

  const payload = {
    partner_tier: options.partnerTier || "reseller",
    launch_window: options.launchWindow || "30 days",
    deliverables: options.deliverables || ["pitch deck", "battlecard"],
    audience: options.audience || "general",
    brief_text: options.brief.substring(0, 6000),
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

  const descriptorParts = [options.partnerTier || "partner", options.launchWindow || "launch"];
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
    logger.info("Parsed partner kit inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed partner kit prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received partner kit plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved partner kit to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
