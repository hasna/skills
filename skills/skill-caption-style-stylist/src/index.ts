#!/usr/bin/env bun
/**
 * skill-caption-style-stylist
 * Generates branded caption style guides using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  tone?: string;
  platforms?: string[];
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

const SKILL_SLUG = "caption-style-stylist";
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
    .slice(0, 40) || "captions";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      brand: { type: "string" },
      tone: { type: "string" },
      platforms: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Caption Style Stylist - Generates branded caption style guides

Usage:
  skills run caption-style-stylist -- [options] <brief>

Options:
  --brief <string>     Content brief (or use positional arg)
  --brand <string>     Brand name
  --tone <string>      Desired tone
  --platforms <list>   Comma-separated platforms (default: Instagram Reels,TikTok,YouTube)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const brief = values.brief || positionals.join(" ").trim();
  if (!brief) {
    throw new Error("Provide a caption content brief via positional text or --brief.");
  }

  const platforms = values.platforms
    ? (values.platforms as string).split(",").map(p => p.trim()).filter(Boolean)
    : ["Instagram Reels", "TikTok", "YouTube"];

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief: brief as string,
    brand: values.brand as string,
    tone: values.tone as string,
    platforms,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a motion graphics and caption design lead.
Create a caption style guide including:
- Summary of brand voice (${options.tone || "energetic, modern"}) tied to ${options.brief}.
- Typography recommendations (primary/secondary fonts, sizes, spacing) with accessibility notes.
- Color system referencing brand (${options.brand || "brand palette"}), including safe overlays for video.
- Animation treatments: in/out durations, easing, bounce or kinetic style, platform-specific do's/don'ts.
- Caption templates for ${options.platforms?.join(", ")}, with safe zones and text limits.
- Callout styles (emojis, emphasis, background shapes).
- Accessibility considerations (contrast, subtitles vs captions, multi-language).
- Tool implementation tips (Premiere, After Effects, CapCut, etc.) and export checklist.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, typography, colors, animation, templates, callouts, accessibility, tooling. Templates array should include platform, max_chars, safe_zone_note, style_notes."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include tables for typography and color values, bullet lists for animation cues, and sections per platform.";

  const userPayload = {
    content_brief: options.brief,
    brand: options.brand,
    tone: options.tone,
    platforms: options.platforms,
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

async function run() {
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Designing caption style guide.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.brand || options.brief.split(/\s+/).slice(0, 4).join("-");
    const guideSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `caption-style-${guideSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Caption style guide generated successfully.");
    console.log("\n=== Caption Guide Preview ===\n");
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
