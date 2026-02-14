#!/usr/bin/env bun
/**
 * skill-presentation-theme-maker
 * Generates presentation theme guidelines using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  tone?: string;
  channels: string[];
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

const SKILL_SLUG = "presentation-theme-maker";

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
    .slice(0, 40) || "theme";
}

function showHelp(): void {
  console.log(`
skill-presentation-theme-maker - Generate presentation theme guidelines using AI

Usage:
  skills run presentation-theme-maker -- "<brief>" [options]

Options:
  -h, --help               Show this help message
  --brand <name>           Brand name for styling
  --tone <style>           Tone/style (e.g., professional, playful)
  --channels <tools>       Comma-separated presentation tools (default: keynote,powerpoint,google slides,figma)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Concept narrative
  - Typography ramp
  - Color palette
  - Slide layouts
  - Imagery guidance
  - Motion behaviors
  - Tool-specific export guidance
  - Consistency checklist

Examples:
  skills run presentation-theme-maker -- "Sales kickoff deck" --brand "Acme Corp"
  skills run presentation-theme-maker -- "Product launch" --tone "modern minimal"

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
      tone: { type: "string" },
      channels: { type: "string", default: "keynote,powerpoint,google slides,figma" },
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
      "A presentation brief is required.\nExample: skills run presentation-theme-maker -- \"Sales kickoff deck\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const channels = values.channels
    ? values.channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["keynote", "powerpoint", "google slides", "figma"];

  return {
    brief,
    brand: values.brand,
    tone: values.tone,
    channels: channels.length > 0 ? channels : ["keynote", "powerpoint", "google slides", "figma"],
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a presentation design lead and motion director.
Create a theme guide that includes:
- Concept narrative and voice cues
- Type ramp (heading, subhead, body, metadata) with typeface suggestions and fallbacks
- Color palette mapping (background, emphasis, data visuals, neutral surfaces)
- Slide layout archetypes with grid specs (title, agenda, section break, comparison, timeline, data, quote)
- Iconography style, illustration direction, photography guidance
- Motion behaviors (transitions, builds) and accessibility considerations
- Export guidance for the specified presentation tools (master slides, theme files, token mapping)
- Checklist for maintaining consistency across teams`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, typography, color, layouts, imagery, motion, tooling, checklist. Layouts array should include name, purpose, grid, content_zones, notes."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include tables for type ramp and color mapping, and bullet lists for layouts and motion.";

  const userPayload = {
    request: "Create a presentation theme guide",
    brief: options.brief,
    brand: options.brand,
    tone: options.tone,
    channels: options.channels,
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
    temperature: 0.6,
    max_tokens: options.format === "json" ? 2400 : 2100,
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
    logger.info("Generating presentation theme guide.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const themeSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `presentation-theme-${themeSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Presentation theme guide generated successfully.");
    console.log("\n=== Theme Preview ===\n");
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
