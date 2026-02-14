#!/usr/bin/env bun
/**
 * skill-benchmark-finder
 * Locates public benchmarks using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type BenchmarkTemplate = {
  kpis?: Array<Record<string, unknown>>;
  filters?: Record<string, unknown>;
  notes?: string;
};

interface SkillOptions {
  query: string;
  limit: number;
  audience?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: BenchmarkTemplate;
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

const SKILL_SLUG = "benchmark-finder";
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
    .slice(0, 40) || "benchmarks";
}

function parseJsonTemplate(content: string): BenchmarkTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as BenchmarkTemplate;
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
      limit: { type: "string", default: "10" },
      audience: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Benchmark Finder - Locates public benchmarks using OpenAI

Usage:
  skills run benchmark-finder -- [options] <query>

Options:
  --text <string>      Benchmark query
  --limit <n>          Number of benchmarks (default: 10)
  --audience <string>  Target audience
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let query = values.text || "";
  let template: BenchmarkTemplate | undefined;

  if (!query && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      query = template ? "" : content;
    } else {
      query = positionals.join(" ");
    }
  }

  if (!query.trim() && !template) {
    throw new Error("Provide benchmark query via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const limit = (() => {
    const parsed = Number.parseInt(values.limit as string, 10);
    return Number.isNaN(parsed) ? 10 : Math.min(Math.max(parsed, 1), 50);
  })();

  return {
    query,
    limit,
    audience: values.audience as string,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a market researcher compiling public KPI benchmarks.
Use reputable public sources (reports, analyst firms, government data) to find current benchmark ranges.
Always cite sources with publication name and year.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, benchmarks, methodology, caveats, recommendations. Each benchmark should include metric, segment, value_range, source, year, url." 
      : "Respond in polished Markdown. Start with an executive summary, list benchmarks with metric, segment, range, and source citation, describe methodology/validity, note caveats, and recommend how the audience should apply the data.";

  const payload = {
    query: options.query.substring(0, 6000),
    limit: options.limit,
    audience: options.audience || "Finance",
    template: options.template,
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

  const descriptor = slugify(options.query.split(/\s+/).slice(0, 3).join("-"));
  const extension = options.format === "json" ? "json" : "md";
  return join(skillExportsDir, `${descriptor}_${sessionStamp}.${extension}`);
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
    logger.info("Parsed benchmark request and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed benchmark search prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received benchmark summary from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved benchmark report to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
