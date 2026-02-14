#!/usr/bin/env bun
/**
 * skill-grocery-basket-optimizer
 * Compares grocery options for savings and nutrition using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type GroceryTemplate = {
  items?: Array<Record<string, unknown>>;
  prices?: Array<Record<string, unknown>>;
  nutrition?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  basket: string;
  budget?: string;
  audience?: string;
  tone?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: GroceryTemplate;
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

const SKILL_SLUG = "grocery-basket-optimizer";

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
    .slice(0, 40) || "grocery-optimizer";
}

function parseJsonTemplate(content: string): GroceryTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as GroceryTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-grocery-basket-optimizer - Compare grocery options for savings and nutrition using AI

Usage:
  skills run grocery-basket-optimizer -- <basket-file> [options]
  skills run grocery-basket-optimizer -- --text "<grocery-list>" [options]

Options:
  -h, --help               Show this help message
  --text <basket>          Inline grocery list/basket
  --budget <amount>        Budget constraint
  --audience <type>        Target audience (default: Individual)
  --tone <style>           Report tone (default: data-driven)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Cost comparison
  - Substitution ideas
  - Nutrition analysis
  - Savings recommendations
  - Next steps

Examples:
  skills run grocery-basket-optimizer -- ./groceries.txt --budget "$100"
  skills run grocery-basket-optimizer -- --text "Milk, eggs, bread, chicken" --audience "Family"

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
      budget: { type: "string" },
      audience: { type: "string" },
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

  let basket = values.text || "";
  let template: GroceryTemplate | undefined;

  if (!basket && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    basket = template ? "" : content;
  }

  if (!basket.trim() && !template) {
    throw new Error("Provide grocery data via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    basket,
    budget: values.budget,
    audience: values.audience,
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a nutrition-aware budget analyst optimizing grocery baskets.
Compare store options, check nutrition targets, propose substitutions, and calculate savings.
Tailor recommendations to the specified audience and tone.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, cost_comparison, substitutions, nutrition_analysis, recommendations, next_steps." 
      : "Respond in polished Markdown. Start with an executive summary, show cost comparison table, list substitution ideas with savings, provide nutrition callouts, and recommend next actions.";

  const payload = {
    budget: options.budget,
    audience: options.audience || "Individual",
    tone: options.tone || "data-driven",
    basket_text: options.basket.substring(0, 6000),
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
    max_tokens: options.format === "json" ? 2300 : 2000,
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

  const descriptorParts = [options.audience || "individual", options.tone || "tone"];
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
    logger.info("Parsed grocery data and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed grocery optimization prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received grocery optimization plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved grocery optimization report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
