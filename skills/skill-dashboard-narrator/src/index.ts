#!/usr/bin/env bun
/**
 * skill-dashboard-narrator
 * Generates executive dashboard narratives using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type FocusMode = "growth" | "efficiency" | "risk" | "all";

type DashboardTemplate = {
  metrics?: Array<Record<string, unknown>>;
  charts?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  dataset: string;
  audience?: string;
  cadence?: string;
  focus: FocusMode;
  benchmarks?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DashboardTemplate;
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

const SKILL_SLUG = "dashboard-narrator";
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
    .slice(0, 40) || "dashboard-digest";
}

function parseJsonTemplate(content: string): DashboardTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DashboardTemplate;
    }
  } catch (_error) {
    // treat as plain text
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      audience: { type: "string" },
      cadence: { type: "string" },
      focus: { type: "string", default: "all" },
      benchmarks: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Dashboard Narrator - Generates executive dashboard narratives

Usage:
  skills run dashboard-narrator -- [options] <file-path>

Options:
  --text <string>      Raw dashboard metrics (or use positional arg)
  --audience <string>  Target audience
  --cadence <string>   Reporting cadence
  --focus <mode>       Focus mode: growth, efficiency, risk, all (default: all)
  --benchmarks <string> Benchmark context
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let dataset = values.text || "";
  let template: DashboardTemplate | undefined;

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
    throw new Error("Provide dashboard metrics via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let focus: FocusMode = "all";
  if (values.focus === "growth" || values.focus === "efficiency" || values.focus === "risk" || values.focus === "all") {
    focus = values.focus as FocusMode;
  }

  return {
    dataset,
    audience: values.audience as string,
    cadence: values.cadence as string,
    focus,
    benchmarks: values.benchmarks as string,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an FP&A storyteller turning dashboards into executive narratives.
Highlight what changed, why it matters, and what to do next.
Reference benchmarks and tailor tone to the specified audience.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, highlights, variances, risks, opportunities, actions. Include metric names, values, deltas, benchmark comparisons, and owner/next_step fields." 
      : "Respond in polished Markdown. Start with an executive summary, bullet key highlights with metric deltas, describe root causes, outline risks/opportunities, recommend next steps with owners, and close with data callouts.";

  const payload = {
    audience: options.audience || "Executive",
    cadence: options.cadence || "weekly",
    focus: options.focus,
    benchmarks: options.benchmarks || "plan",
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

  const descriptorParts = [options.audience || "audience", options.focus];
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
    logger.info("Parsed dashboard metrics and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed dashboard narration prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received dashboard narrative from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved dashboard digest to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
