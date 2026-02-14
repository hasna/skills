#!/usr/bin/env bun
/**
 * skill-longform-structurer
 * Converts raw notes into structured long-form content outlines using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  notes: string;
  goal?: string;
  audience?: string;
  length?: string;
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

const SKILL_SLUG = "longform-structurer";

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
    .slice(0, 40) || "longform";
}

function showHelp(): void {
  console.log(`
skill-longform-structurer - Convert raw notes into structured long-form content outlines using AI

Usage:
  skills run longform-structurer -- <notes-file> [options]
  skills run longform-structurer -- --text "<notes>" [options]

Options:
  -h, --help               Show this help message
  --text <notes>           Inline source notes
  --goal <objective>       Content goal (default: in-depth article)
  --audience <target>      Target audience (default: broad readers)
  --length <words>         Desired length (default: 1500-2000 words)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Hierarchical outline with sections and subsections
  - Talking points and word counts
  - Suggested visuals
  - Sources and research gaps
  - CTA placement recommendations
  - Editorial guidance

Examples:
  skills run longform-structurer -- ./research-notes.txt --goal "whitepaper"
  skills run longform-structurer -- --text "Key findings from user research..." --audience "executives"

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
      goal: { type: "string" },
      audience: { type: "string" },
      length: { type: "string" },
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

  let notes = values.text || "";
  if (!notes && positionals[0]) {
    const filePath = resolve(positionals[0]);
    notes = readFileSync(filePath, "utf-8");
  }

  if (!notes.trim()) {
    throw new Error("Provide source notes via file path or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    notes,
    goal: values.goal,
    audience: values.audience,
    length: values.length,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an editorial strategist and long-form content editor.
Use the provided notes to create a structured outline.
- Content goal: ${options.goal || "in-depth article"}
- Target audience: ${options.audience || "broad readers"}
- Desired length: ${options.length || "1500-2000 words"}

Deliver:
- Executive summary (3-4 bullet takeaways).
- Outline with sections (H2) and subsections (H3) including purpose, key talking points, supporting data requests, and estimated word counts.
- Suggested visuals or embeds per section.
- Sources to cite or research gaps.
- CTA placement recommendations.
- Editorial guidance (voice, readability, next steps).`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, outline, visuals, sources, cta, guidance. Outline should be array of sections with title, goal, talking_points, subsections, word_count."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include hierarchical outline with bullet lists for talking points, table for visuals/sources, and conclude with CTA and editorial guidance.";

  const userPayload = {
    notes: options.notes.substring(0, 6000),
    goal: options.goal,
    audience: options.audience,
    length: options.length,
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
    temperature: 0.52,
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
    logger.info("Structuring long-form content.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.goal || options.notes.split(/\s+/).slice(0, 4).join("-");
    const outlineSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `longform-outline-${outlineSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Long-form outline generated successfully.");
    console.log("\n=== Long-form Outline Preview ===\n");
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
