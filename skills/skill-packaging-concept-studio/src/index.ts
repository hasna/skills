#!/usr/bin/env bun
/**
 * skill-packaging-concept-studio
 * Generates packaging concept briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  channels: string[];
  materials?: string;
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

const SKILL_SLUG = "packaging-concept-studio";

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
    .slice(0, 40) || "packaging";
}

function showHelp(): void {
  console.log(`
skill-packaging-concept-studio - Generate packaging concept briefs using AI

Usage:
  skills run packaging-concept-studio -- "<brief>" [options]

Options:
  -h, --help               Show this help message
  --brand <name>           Brand name
  --channels <list>        Comma-separated channels (default: retail,ecommerce,pop-up)
  --materials <specs>      Material preferences
  --tone <style>           Design tone
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Concept overview
  - Structural format and dieline recommendations
  - Material and finish suggestions
  - Artwork zones with copy direction
  - Channel-specific adaptations
  - Production checklist

Examples:
  skills run packaging-concept-studio -- "Organic skincare jar for spa retail"
  skills run packaging-concept-studio -- "Premium tea packaging" --brand "Harmony Teas"

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
      channels: { type: "string", default: "retail,ecommerce,pop-up" },
      materials: { type: "string" },
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
      "A packaging brief is required.\nExample: skills run packaging-concept-studio -- \"Organic skincare jar for spa retail\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const channels = values.channels
    ? values.channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["retail", "ecommerce", "pop-up"];

  return {
    brief,
    brand: values.brand,
    channels: channels.length > 0 ? channels : ["retail", "ecommerce", "pop-up"],
    materials: values.materials,
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior packaging designer and structural engineer.
Produce a comprehensive packaging concept brief that includes:
- Concept overview with positioning and storytelling
- Structural format and dieline recommendations (dimensions, folding notes)
- Material + finish suggestions referencing sustainability considerations
- Artwork zones (front, back, sides) with copy direction
- Compliance and regulatory reminders for relevant markets
- Channel-specific adaptations across the provided channels
- Unboxing or merchandising experience suggestions
- Production checklist (deliverables, file formats, print specs)`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: concept, structure, materials, artwork, channels, sustainability, production, risks. Use nested fields per channel."
      : "Respond in polished Markdown with tables for structure specs and material palette. Begin with an executive summary blockquote.";

  const userPayload = {
    request: "Create a packaging concept brief",
    brief: options.brief,
    brand: options.brand,
    channels: options.channels,
    materials: options.materials,
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
    temperature: 0.58,
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
    logger.info("Generating packaging concept brief.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const brandSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `packaging-concept-${brandSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Packaging concept brief generated successfully.");
    console.log("\n=== Packaging Concept Preview ===\n");
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
