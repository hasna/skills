#!/usr/bin/env bun
/**
 * skill-spreadsheet-cleanroom
 * Normalizes spreadsheet data against a target schema using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type SpreadsheetTemplate = {
  rows?: Array<Record<string, unknown>>;
  schema?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  schema?: string;
  required?: string[];
  delimiter?: string;
  sampleRows: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SpreadsheetTemplate;
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

const SKILL_SLUG = "spreadsheet-cleanroom";

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
    .slice(0, 40) || "cleanroom-report";
}

function parseJsonTemplate(content: string): SpreadsheetTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SpreadsheetTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
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

function loadSchema(schemaArg?: string): string | undefined {
  if (!schemaArg) return undefined;
  const maybePath = resolve(schemaArg);
  if (existsSync(maybePath)) {
    return readFileSync(maybePath, "utf-8");
  }
  return schemaArg;
}

function showHelp(): void {
  console.log(`
skill-spreadsheet-cleanroom - Normalize spreadsheet data against a target schema using AI

Usage:
  skills run spreadsheet-cleanroom -- <data-file> [options]
  skills run spreadsheet-cleanroom -- --text "<csv-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline spreadsheet data
  --schema <path|json>     Target schema file or JSON
  --required <columns>     Comma-separated required columns
  --delimiter <char>       Delimiter hint (default: auto)
  --sample-rows <num>      Sample rows to analyze (default: 200)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Normalized column mapping
  - Data quality issues
  - Remediation steps
  - Sample transformed rows

Examples:
  skills run spreadsheet-cleanroom -- ./data.csv --required "email,name"
  skills run spreadsheet-cleanroom -- --text "name,email\\nJohn,john@example.com" --schema ./schema.json

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
      schema: { type: "string" },
      required: { type: "string" },
      delimiter: { type: "string" },
      "sample-rows": { type: "string", default: "200" },
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
  let template: SpreadsheetTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide spreadsheet data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const sampleRows = (() => {
    const parsed = Number.parseInt(values["sample-rows"], 10);
    return Number.isNaN(parsed) ? 200 : Math.max(10, parsed);
  })();

  return {
    dataset,
    schema: loadSchema(values.schema),
    required: parseList(values.required),
    delimiter: values.delimiter,
    sampleRows,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a data quality analyst normalizing spreadsheets.
Align columns to the target schema, infer data types, detect anomalies, and propose fixes.
Respect required columns and highlight any missing or unmapped fields.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, schema, issues, fixes, normalized_columns, sample_rows, actions. Each issue should include column, description, severity, suggested_fix." 
      : "Respond in polished Markdown. Start with an executive summary, include a table of normalized columns (detected type, source column, status), list issues with severity, provide remediation steps, and include sample transformed rows.";

  const payload = {
    required_columns: options.required || [],
    delimiter_hint: options.delimiter || "auto",
    sample_rows: options.sampleRows,
    schema_reference: options.schema,
    dataset_preview: options.dataset.substring(0, 6000),
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
    temperature: 0.34,
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

  const descriptorParts = [options.required?.[0] || "schema", options.delimiter || "auto"];
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
    logger.info("Parsed spreadsheet data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed cleanroom prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received normalization report from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved cleanroom report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
