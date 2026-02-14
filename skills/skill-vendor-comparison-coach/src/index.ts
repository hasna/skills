#!/usr/bin/env bun
/**
 * skill-vendor-comparison-coach
 * Compares event vendor proposals using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type ScorecardTemplate = {
  vendors?: Array<Record<string, unknown>>;
  criteria?: Array<Record<string, unknown>>;
  weights?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  audience?: string;
  weights?: Record<string, number>;
  threshold: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: ScorecardTemplate;
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

const SKILL_SLUG = "vendor-comparison-coach";

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
    .slice(0, 40) || "vendor-scorecard";
}

function parseJsonTemplate(content: string): ScorecardTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as ScorecardTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
  }
  return undefined;
}

function parseWeights(value?: string): Record<string, number> | undefined {
  if (!value) return undefined;
  const weights: Record<string, number> = {};
  value.split(",").forEach(entry => {
    const [key, raw] = entry.split("=").map(part => part.trim());
    if (key && raw) {
      const num = Number.parseFloat(raw);
      if (!Number.isNaN(num)) {
        weights[key] = num;
      }
    }
  });
  return Object.keys(weights).length ? weights : undefined;
}

function normalizeWeights(weights?: Record<string, number>): Record<string, number> | undefined {
  if (!weights) return undefined;
  const total = Object.values(weights).reduce((sum, val) => sum + val, 0);
  if (total <= 0) return undefined;
  const normalized: Record<string, number> = {};
  Object.entries(weights).forEach(([key, val]) => {
    normalized[key] = Number((val / total * 100).toFixed(2));
  });
  return normalized;
}

function showHelp(): void {
  console.log(`
skill-vendor-comparison-coach - Compare event vendor proposals using AI

Usage:
  skills run vendor-comparison-coach -- <data-file> [options]
  skills run vendor-comparison-coach -- --text "<vendor-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline vendor data
  --audience <type>        Target audience (default: Events)
  --weights <criteria>     Comma-separated criteria weights (e.g., "price=3,quality=5")
  --threshold <score>      Minimum score threshold 0-100 (default: 80)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Vendor ranking
  - Score breakdown
  - Strengths and weaknesses
  - Risk assessment
  - Recommendations

Examples:
  skills run vendor-comparison-coach -- ./vendors.json --weights "price=2,quality=4"
  skills run vendor-comparison-coach -- --text "Vendor A: $5000, Vendor B: $4500" --threshold 70

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
      weights: { type: "string" },
      threshold: { type: "string", default: "80" },
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
  let template: ScorecardTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide vendor data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const threshold = (() => {
    const parsed = Number.parseFloat(values.threshold);
    return Number.isNaN(parsed) ? 80 : Math.min(Math.max(parsed, 0), 100);
  })();

  const weights = normalizeWeights(parseWeights(values.weights));

  return {
    dataset,
    audience: values.audience,
    weights,
    threshold,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an events procurement advisor comparing vendor proposals.
Apply weighting to criteria, evaluate qualitative fit, call out risks, and provide recommendations tailored to the audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, ranking, scores, highlights, risks, recommendations. Each score entry should include vendor, total_score, strengths, weaknesses, next_steps." 
      : "Respond in polished Markdown. Start with an executive summary, table vendor scores, describe strengths and trade-offs, flag risks, and recommend vendor selection with follow-up actions.";

  const payload = {
    audience: options.audience || "Events",
    threshold: options.threshold,
    weights: options.weights,
    dataset_text: options.dataset.substring(0, 6000),
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

  const descriptorParts = [options.audience || "events", `${options.threshold}`];
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
    logger.info("Parsed vendor inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed vendor comparison prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received vendor comparison from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved vendor comparison to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
