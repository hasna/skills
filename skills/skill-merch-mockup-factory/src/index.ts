#!/usr/bin/env bun
/**
 * skill-merch-mockup-factory
 * Generates merchandise mockup direction using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  palette?: string;
  items: string[];
  tone?: string;
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

const SKILL_SLUG = "merch-mockup-factory";

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
    .slice(0, 40) || "merch";
}

function showHelp(): void {
  console.log(`
skill-merch-mockup-factory - Generate merchandise mockup direction using AI

Usage:
  skills run merch-mockup-factory -- "<brief>" [options]

Options:
  -h, --help               Show this help message
  --brand <name>           Brand name
  --palette <colors>       Color palette description
  --items <list>           Comma-separated item list (default: hoodie, tee, cap, tote, sticker)
  --tone <style>           Design tone/style
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Collection concept and messaging pillars
  - Item-by-item design direction (colorway, placement, print technique)
  - Model casting and pose guidance
  - Lighting/backdrop recommendations
  - AI prompt variations for image generation tools
  - File prep notes and production specs
  - Packaging suggestions

Examples:
  skills run merch-mockup-factory -- "Fan merch for indie band tour" --brand "The Echoes"
  skills run merch-mockup-factory -- "Tech startup swag" --items "tee,hoodie,cap,water-bottle"

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
      palette: { type: "string" },
      items: { type: "string", default: "hoodie, tee, cap, tote, sticker" },
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

  const brief = positionals.join(" ").trim();

  if (!brief) {
    throw new Error(
      "A merch brief is required.\nExample: skills run merch-mockup-factory -- \"Fan merch for indie band tour\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const items = values.items
    ? values.items
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["hoodie", "tee", "cap", "tote", "sticker"];

  return {
    brief,
    brand: values.brand,
    palette: values.palette,
    items: items.length > 0 ? items : ["hoodie", "tee", "cap", "tote", "sticker"],
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a merch creative director specializing in apparel and accessory mockups.
Create a guidance doc that includes:
- Collection concept and messaging pillars
- Item-by-item design direction (colorway, placement, print technique, scale)
- Model casting or mannequin diversity suggestions with pose guidance
- Lighting/backdrop recommendations for mockup renders or photoshoots
- AI prompt variations for image generation tools (Midjourney, DALL·E, etc.)
- File prep notes (layers, print sizes, bleed, color profile)
- Packaging or presentation suggestions for fulfillment`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, items, styling, prompts, production, packaging. Each item entry should include name, colorways, graphics, placement, technique, notes."
      : "Respond in polished Markdown. Start with an executive summary blockquote, use tables for item specs, and bullet lists for prompts and production notes.";

  const userPayload = {
    request: "Create a merch mockup concept plan",
    brief: options.brief,
    brand: options.brand,
    palette: options.palette,
    items: options.items,
    tone: options.tone,
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
    max_tokens: options.format === "json" ? 2400 : 2000,
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
    logger.info("Generating merch mockup guidance.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const brandSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `merch-mockup-${brandSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Merch mockup plan generated successfully.");
    console.log("\n=== Merch Mockup Preview ===\n");
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
