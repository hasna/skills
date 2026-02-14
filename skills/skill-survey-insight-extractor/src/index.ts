#!/usr/bin/env bun
/**
 * skill-survey-insight-extractor
 * Clusters survey responses and surfaces sentiment insights using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type FocusMode = "detractors" | "promoters" | "all";

type SurveyTemplate = {
  responses?: Array<Record<string, unknown>>;
  scores?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  survey?: string;
  audience?: string;
  focus: FocusMode;
  sentimentWindow?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: SurveyTemplate;
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

const SKILL_SLUG = "survey-insight-extractor";

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
    .slice(0, 40) || "survey-insights";
}

function parseJsonTemplate(content: string): SurveyTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as SurveyTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-survey-insight-extractor - Cluster survey responses and surface sentiment insights using AI

Usage:
  skills run survey-insight-extractor -- <data-file> [options]
  skills run survey-insight-extractor -- --text "<survey-data>" [options]

Options:
  -h, --help               Show this help message
  --text <data>            Inline survey response data
  --survey <name>          Survey name (default: latest survey)
  --audience <target>      Target audience (default: Leadership)
  --focus <mode>           Focus mode: detractors | promoters | all (default: all)
  --sentiment-window <days> Sentiment analysis window (default: 90 days)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Sentiment breakdown
  - Thematic clusters with quotes
  - Promoter/detractor contrasts
  - Risks and opportunities
  - Recommended actions

Examples:
  skills run survey-insight-extractor -- ./responses.csv --focus "detractors"
  skills run survey-insight-extractor -- --text "Response 1: Great product..." --audience "Product team"

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
      survey: { type: "string" },
      audience: { type: "string" },
      focus: { type: "string", default: "all" },
      "sentiment-window": { type: "string" },
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
  let template: SurveyTemplate | undefined;

  if (!dataset && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    dataset = template ? "" : content;
  }

  if (!dataset.trim() && !template) {
    throw new Error("Provide survey responses via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let focus: FocusMode = "all";
  if (values.focus === "detractors" || values.focus === "promoters" || values.focus === "all") {
    focus = values.focus;
  }

  return {
    dataset,
    survey: values.survey,
    audience: values.audience,
    focus,
    sentimentWindow: values["sentiment-window"],
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a research analyst synthesizing survey data.
Identify dominant themes, sentiment trends, and actionable follow-ups tailored to the specified audience.
Highlight differences across promoters versus detractors when relevant.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, sentiment, themes, quotes, opportunities, risks, actions. Each theme entry should include name, frequency, sentiment_score, representative_quotes." 
      : "Respond in polished Markdown. Start with an executive summary, provide sentiment breakdown, thematic clusters with representative quotes, promoter/detractor contrasts, risks, and recommended actions with owners.";

  const payload = {
    survey: options.survey || "latest survey",
    audience: options.audience || "Leadership",
    focus: options.focus,
    sentiment_window: options.sentimentWindow || "90 days",
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
    temperature: 0.45,
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

  const descriptorParts = [options.survey || "survey", options.focus];
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
    logger.info("Parsed survey dataset and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed survey insight prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received survey insights from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved survey insight report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
