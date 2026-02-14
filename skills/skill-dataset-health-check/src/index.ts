#!/usr/bin/env bun
/**
 * skill-dataset-health-check
 * Profiles datasets for quality issues using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type DatasetTemplate = {
  rows?: Array<Record<string, unknown>>;
  schema?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  schema?: string;
  primaryKey?: string[];
  dateColumn?: string;
  sampleRows: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DatasetTemplate;
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

const SKILL_SLUG = "dataset-health-check";
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
    .slice(0, 40) || "dataset-health";
}

function parseJsonTemplate(content: string): DatasetTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DatasetTemplate;
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

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      schema: { type: "string" },
      "primary-key": { type: "string" },
      "date-column": { type: "string" },
      "sample-rows": { type: "string", default: "500" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Dataset Health Check - Profiles datasets for quality issues

Usage:
  skills run dataset-health-check -- [options] <file-path>

Options:
  --text <string>      Dataset sample (or use positional arg)
  --schema <string>    Schema definition
  --primary-key <list> Primary key columns
  --date-column <name> Date column for freshness check
  --sample-rows <n>    Number of rows to sample (default: 500)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let dataset = values.text || "";
  let template: DatasetTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      dataset = template ? "" : content;
    } else {
      dataset = positionals.join(" ");
    }
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide dataset sample via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const sampleRows = (() => {
    const parsed = Number.parseInt(values["sample-rows"] as string, 10);
    return Number.isNaN(parsed) ? 500 : Math.max(50, parsed);
  })();

  return {
    dataset,
    schema: loadSchema(values.schema as string),
    primaryKey: parseList(values["primary-key"] as string),
    dateColumn: values["date-column"] as string,
    sampleRows,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a data quality engineer performing a dataset health check.
Validate schema alignment, assess completeness, detect duplicates/outliers, and provide remediation guidance.
Consider primary keys, date freshness, and statistical distribution shifts.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, schema_check, completeness, duplicates, anomalies, freshness, actions. Each section should include pass_fail, details, and severity." 
      : "Respond in polished Markdown. Start with an executive summary, provide schema alignment results, completeness analysis, duplicate/primary key issues, anomaly detection, freshness check, and recommended actions with owners.";

  const payload = {
    schema_reference: options.schema,
    primary_key: options.primaryKey || [],
    date_column: options.dateColumn,
    sample_rows: options.sampleRows,
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
    temperature: 0.33,
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

  const descriptorParts = [options.primaryKey?.[0] || "dataset", options.dateColumn || "freshness"];
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
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Parsed dataset sample and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed dataset health prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received dataset health report from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved dataset health report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
