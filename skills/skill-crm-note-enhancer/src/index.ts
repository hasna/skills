#!/usr/bin/env bun
/**
 * skill-crm-note-enhancer
 * Converts call notes into structured CRM entries using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type SentimentTone = "positive" | "neutral" | "cautious";

type CrmTemplate = {
  notes?: string;
  highlights?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  next_steps?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

interface SkillOptions {
  source: string;
  account?: string;
  contact?: string;
  stage?: string;
  opportunity?: string;
  sentiment: SentimentTone;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: CrmTemplate;
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

const SKILL_SLUG = "crm-note-enhancer";
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
    .slice(0, 40) || "crm-entry";
}

function parseJsonTemplate(content: string): CrmTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as CrmTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
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
      opportunity: { type: "string" },
      sentiment: { type: "string", default: "neutral" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
CRM Note Enhancer - Converts call notes into structured CRM entries

Usage:
  skills run crm-note-enhancer -- [options] <file-path>

Options:
  --text <string>      Raw call notes (or use positional arg)
  --account <string>   Account name
  --contact <string>   Contact name
  --stage <string>     Deal stage
  --opportunity <string> Opportunity name
  --sentiment <type>   Target sentiment: positive, neutral, cautious (default: neutral)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let source = values.text || "";
  let template: CrmTemplate | undefined;

  if (!source && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      source = template ? "" : content;
    } else {
      source = positionals.join(" ");
    }
  }

  if (!source.trim() && !template) {
    throw new Error("Provide call notes via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let sentiment: SentimentTone = "neutral";
  if (values.sentiment === "positive" || values.sentiment === "neutral" || values.sentiment === "cautious") {
    sentiment = values.sentiment as SentimentTone;
  }

  return {
    source,
    account: values.account as string,
    contact: values.contact as string,
    stage: values.stage as string,
    opportunity: values.opportunity as string,
    sentiment,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior revenue operations associate updating CRM records.
Extract structured insights, qualification data, objections, and next steps from the call notes.
Use professional tone and align with MEDDIC / BANT style fields where relevant.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, qualification, stakeholders, pain_points, value_drivers, risks, follow_up, timeline, sentiment. Each follow_up entry should include owner, due, channel, notes." 
      : "Respond in polished Markdown. Start with an executive summary, include qualification bullets (metrics, economic buyer, decision criteria), table of stakeholders, objections with rebuttals, follow-up checklist, and sentiment assessment.";

  const payload = {
    account: options.account || "unspecified",
    contact: options.contact || "unspecified",
    stage: options.stage || "prospecting",
    opportunity: options.opportunity || "unnamed opportunity",
    sentiment_target: options.sentiment,
    notes_text: options.source.substring(0, 6000),
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
    temperature: 0.32,
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

  const descriptor = options.account ? `${options.account}-${options.stage || "update"}` : sessionStamp;
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
    logger.info("Parsed CRM note inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed CRM enhancement prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received CRM-ready entry from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved CRM entry to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
