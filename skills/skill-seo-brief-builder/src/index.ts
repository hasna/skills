#!/usr/bin/env bun
/**
 * skill-seo-brief-builder
 * Generates SEO content briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  keyword: string;
  audience?: string;
  goals?: string;
  language?: string;
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

const SKILL_SLUG = "seo-brief-builder";

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
    .slice(0, 40) || "seo-brief";
}

function showHelp(): void {
  console.log(`
skill-seo-brief-builder - Generate SEO content briefs using AI

Usage:
  skills run seo-brief-builder -- "<keyword/topic>" [options]
  skills run seo-brief-builder -- --keyword "<target-keyword>" [options]

Options:
  -h, --help               Show this help message
  --keyword <text>         Target keyword or topic
  --audience <type>        Target audience (default: general readers)
  --goals <text>           Content goals (default: increase organic traffic)
  --language <lang>        Content language (default: English)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Search intent analysis
  - SERP competitor snapshot
  - Keyword list with difficulty
  - Article outline with H2/H3 structure
  - FAQ suggestions
  - Linking recommendations

Examples:
  skills run seo-brief-builder -- "best project management tools 2024"
  skills run seo-brief-builder -- --keyword "remote work tips" --audience "HR managers"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      keyword: { type: "string" },
      audience: { type: "string" },
      goals: { type: "string" },
      language: { type: "string" },
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

  const keyword = values.keyword || positionals.join(" ").trim();
  if (!keyword) {
    throw new Error("Provide a target keyword/topic via positional text or --keyword.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    keyword,
    audience: values.audience,
    goals: values.goals,
    language: values.language,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an SEO strategist and senior content editor.
Create a comprehensive brief for the keyword/topic: ${options.keyword}
- Audience: ${options.audience || "general readers"}
- Goals: ${options.goals || "increase organic traffic"}
- Language: ${options.language || "English"}

Include:
- Search intent classification and reader pain points.
- SERP snapshot (top competitors with notes on angle/content gaps).
- Primary keyword list (core, secondary, semantic) with search intent and estimated difficulty.
- Article outline with H2/H3 structure, word count guidance, CTA placement, recommended visuals.
- People Also Ask questions or FAQ suggestions.
- Internal/external linking recommendations.
- Content requirements (tone, examples, data, quotes, compliance).`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: intent, serp, keywords, outline, faqs, linking, requirements. Keywords array entries should include term, intent, difficulty, priority."
      : "Respond in polished Markdown. Begin with an executive summary blockquote, use tables for SERP and keyword data, bullet lists for outline sections, and sections for FAQs, linking, requirements.";

  const userPayload = {
    keyword: options.keyword,
    audience: options.audience,
    goals: options.goals,
    language: options.language,
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
    logger.info("Generating SEO content brief.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.keyword.split(/\s+/).slice(0, 4).join("-");
    const briefSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `seo-brief-${briefSlug}-${sessionStamp}.${extension}`);
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

    logger.success("SEO brief generated successfully.");
    console.log("\n=== SEO Brief Preview ===\n");
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
