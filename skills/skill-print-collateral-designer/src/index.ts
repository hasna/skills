#!/usr/bin/env bun
/**
 * skill-print-collateral-designer
 * Generates print collateral design briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  formats: string[];
  tone?: string;
  paper?: string;
  format: OutputFormat;
  model: string;
  output?: string;
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

const SKILL_SLUG = "print-collateral-designer";

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
    .slice(0, 40) || "collateral";
}

function showHelp(): void {
  console.log(`
skill-print-collateral-designer - Generate print collateral design briefs using AI

Usage:
  skills run print-collateral-designer -- "<brief>" [options]

Options:
  -h, --help               Show this help message
  --brand <name>           Brand name
  --formats <list>         Comma-separated formats (default: flyer 5x7, tri-fold brochure, poster 18x24)
  --tone <style>           Design tone/style
  --paper <stock>          Paper stock preferences
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Concept overview and messaging pillars
  - Format-by-format layout guidance
  - Copy blocks (headlines, CTAs, body copy)
  - Imagery and illustration direction
  - Typography pairing and usage rules
  - Color application and ink coverage tips
  - Paper stock, finishes, and sustainability notes
  - Production specs and preflight checklist

Examples:
  skills run print-collateral-designer -- "Product launch postcard and brochure" --brand "TechCo"
  skills run print-collateral-designer -- "Conference booth materials" --formats "banner,flyer,business-card"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      brand: { type: "string" },
      formats: { type: "string", default: "flyer 5x7, tri-fold brochure, poster 18x24" },
      tone: { type: "string" },
      paper: { type: "string" },
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

  const brief = positionals.join(" ").trim();

  if (!brief) {
    throw new Error(
      "A print collateral brief is required.\nExample: skills run print-collateral-designer -- \"Product launch postcard and brochure\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const formats = values.formats
    ? values.formats
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["flyer 5x7", "tri-fold brochure", "poster 18x24"];

  return {
    brief,
    brand: values.brand,
    formats: formats.length > 0 ? formats : ["flyer 5x7", "tri-fold brochure", "poster 18x24"],
    tone: values.tone,
    paper: values.paper,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior print designer and production specialist.
Create a collateral design brief that covers:
- Concept overview + messaging pillars
- Format-by-format layout guidance (panels, sections, hierarchy)
- Copy blocks (headlines, subheads, CTAs, body copy suggestions)
- Imagery and illustration direction, including composition and style notes
- Typography pairing (primary, secondary) with usage rules
- Color application and ink coverage tips
- Paper stock, finishes, binding, and sustainability considerations
- Production specs (bleeds, margins, DPI, color profiles) and preflight checklist`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, formats, copy, imagery, typography, color, production, checklist. Each format entry should include dimensions, panels, layout_notes, copy_blocks."
      : "Respond in polished Markdown with tables for format specs and bullet lists for copy/imagery guidance. Start with an executive summary blockquote.";

  const userPayload = {
    request: "Create print collateral design direction",
    brief: options.brief,
    brand: options.brand,
    formats: options.formats,
    tone: options.tone,
    paper: options.paper,
    format: options.format,
  };

  const user = `${instructions}\n\n${JSON.stringify(userPayload, null, 2)}`;

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
    temperature: 0.55,
    max_tokens: options.format === "json" ? 2600 : 2200,
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

async function run() {
  const options = parseOptions();
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info("Generating print collateral design brief.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const brandSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `print-collateral-${brandSlug}-${sessionStamp}.${extension}`);
    const targetPath = options.output ? options.output : defaultPath;

    let finalContent = content;

    if (options.format === "json") {
      try {
        finalContent = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        logger.error("Model response was not valid JSON. Wrapping raw response.");
        finalContent = JSON.stringify({ raw: content }, null, 2);
      }
    }

    await writeExport(targetPath, finalContent);

    logger.success("Print collateral brief generated successfully.");
    console.log("\n=== Print Collateral Preview ===\n");
    console.log(finalContent.slice(0, 1500));
    if (finalContent.length > 1500) {
      console.log("\n… (truncated)");
    }
    console.log(`\nExport saved to: ${targetPath}`);
    console.log(`Logs written to: ${skillLogsDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exit(1);
  }
}

run();
