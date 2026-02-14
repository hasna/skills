#!/usr/bin/env bun
/**
 * skill-invoice-dispute-helper
 * Drafts invoice dispute communications using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type DisputeTemplate = {
  invoice?: Record<string, unknown>;
  issues?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  audience?: string;
  currency?: string;
  tone?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DisputeTemplate;
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

const SKILL_SLUG = "invoice-dispute-helper";

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
    .slice(0, 40) || "invoice-dispute";
}

function parseJsonTemplate(content: string): DisputeTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DisputeTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-invoice-dispute-helper - Draft invoice dispute communications using AI

Usage:
  skills run invoice-dispute-helper -- <dispute-file> [options]
  skills run invoice-dispute-helper -- --text "<dispute-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline invoice dispute data
  --audience <type>        Target audience: Vendor | Client | Internal (default: Vendor)
  --currency <code>        Currency code (default: USD)
  --tone <style>           Communication tone (default: professional)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Dispute letter draft
  - Itemized discrepancies
  - Evidence list
  - Recommended next steps

Examples:
  skills run invoice-dispute-helper -- ./invoice-issues.txt --tone "assertive"
  skills run invoice-dispute-helper -- --text "Invoice #123 shows wrong amount..." --currency "EUR"

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
      currency: { type: "string" },
      tone: { type: "string" },
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

  let dataset = values.text || "";
  let template: DisputeTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide invoice dispute data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    dataset,
    audience: values.audience,
    currency: values.currency,
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a finance specialist drafting invoice dispute communications.
Summarize discrepancies, reference contractual terms, cite evidence, and propose clear resolution steps.
Tailor the tone to the audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, dispute_letter, issues, evidence_list, next_steps. Dispute letter should include greeting, issue explanation, requested remedy, closing." 
      : "Respond in polished Markdown. Start with an executive summary, draft the dispute letter body (greeting, issue synopsis, evidence summary, remedy request, closing), list itemized discrepancies, and recommend next steps.";

  const payload = {
    audience: options.audience || "Vendor",
    currency: options.currency || "USD",
    tone: options.tone || "professional",
    dispute_data: options.dataset.substring(0, 6000),
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
    temperature: 0.35,
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

  const descriptorParts = [options.audience || "audience", options.tone || "tone"];
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
    logger.info("Parsed invoice dispute data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed dispute drafting prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received dispute draft from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved dispute draft to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
