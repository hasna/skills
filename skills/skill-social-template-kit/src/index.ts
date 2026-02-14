#!/usr/bin/env bun
/**
 * skill-social-template-kit
 * Generates social media template systems using OpenAI.
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
  formats: string[];
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

const SKILL_SLUG = "social-template-kit";

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
    .slice(0, 40) || "social-kit";
}

function showHelp(): void {
  console.log(`
skill-social-template-kit - Generate social media template systems using AI

Usage:
  skills run social-template-kit -- "<campaign-brief>" [options]

Options:
  -h, --help               Show this help message
  --brand <name>           Brand name
  --tone <style>           Content tone
  --channels <list>        Comma-separated channels (default: instagram feed,instagram stories,tiktok,linkedin)
  --formats <list>         Comma-separated template formats (default: carousel,static,reel,story)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Campaign narrative
  - Layout blueprints per template type
  - Aspect ratios and grid specs
  - Channel-specific copy angles
  - Asset requirements
  - Production workflow
  - Measurement checklist

Examples:
  skills run social-template-kit -- "Product launch for smart water bottle"
  skills run social-template-kit -- "Holiday campaign" --brand "Acme Corp" --channels "instagram,tiktok"

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
      channels: { type: "string", default: "instagram feed,instagram stories,tiktok,linkedin" },
      formats: { type: "string", default: "carousel,static,reel,story" },
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
      "A campaign brief is required.\nExample: skills run social-template-kit -- \"Product launch for smart water bottle\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const channels = values.channels
    ? values.channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["instagram feed", "instagram stories", "tiktok", "linkedin"];

  const templateFormats = values.formats
    ? values.formats
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["carousel", "static", "reel", "story"];

  return {
    brief,
    brand: values.brand,
    tone: values.tone,
    channels: channels.length > 0 ? channels : ["instagram feed", "instagram stories", "tiktok", "linkedin"],
    formats: templateFormats.length > 0 ? templateFormats : ["carousel", "static", "reel", "story"],
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an award-winning social content strategist and art director.
Create a template kit that covers:
- Campaign narrative and key storytelling pillars
- Layout blueprints for each template type with safe zones and focal hierarchy
- Aspect ratios, grid specs, motion cues, and accessibility tips
- Channel-specific copy angles, hook suggestions, CTA patterns
- Asset requirements (imagery, typography, brand elements) per template
- Recommended production workflow (tools, file naming, versioning)
- Measurement and iteration checklist (A/B ideas, performance signals)`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, templates, channels, copy_prompts, assets, workflow, measurement. Each template entry should include type, aspect_ratios, layout_notes, animation, accessibility."
      : "Respond in polished Markdown. Begin with an executive summary blockquote, use tables for layout specs, and bullet lists for copy angles.";

  const userPayload = {
    request: "Create a social media template system",
    brief: options.brief,
    brand: options.brand,
    tone: options.tone,
    channels: options.channels,
    template_formats: options.formats,
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
    temperature: 0.62,
    max_tokens: options.format === "json" ? 2500 : 2100,
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
    logger.info("Generating social template kit.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const campaignSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `social-template-${campaignSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Social template kit generated successfully.");
    console.log("\n=== Social Template Preview ===\n");
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
