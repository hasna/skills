#!/usr/bin/env bun
/**
 * skill-mindfulness-prompt-cache
 * Generates themed mindfulness prompts and trackers using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type PromptTemplate = Record<string, unknown>;

interface SkillOptions {
  journal: string;
  theme?: string;
  cadence?: string;
  goal?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: PromptTemplate;
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

const SKILL_SLUG = "mindfulness-prompt-cache";

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
    .slice(0, 40) || "mindfulness-prompts";
}

function parseJsonTemplate(content: string): PromptTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as PromptTemplate;
    }
  } catch (_error) {
    // treat as plain text when parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-mindfulness-prompt-cache - Generate themed mindfulness prompts using AI

Usage:
  skills run mindfulness-prompt-cache -- <journal-file> [options]
  skills run mindfulness-prompt-cache -- --text "<context>" [options]

Options:
  -h, --help               Show this help message
  --text <context>         Inline mindfulness context/journal
  --theme <style>          Theme: calm | focus | gratitude (default: calm)
  --cadence <frequency>    Prompt cadence (default: daily)
  --goal <objective>       Mindfulness goal (default: mindful presence)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Examples:
  skills run mindfulness-prompt-cache -- ./journal.txt --theme "gratitude"
  skills run mindfulness-prompt-cache -- --text "I want to reduce stress" --cadence "weekly"

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
      theme: { type: "string" },
      cadence: { type: "string" },
      goal: { type: "string" },
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

  let journal = values.text || "";
  let template: PromptTemplate | undefined;

  if (!journal && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    journal = template ? "" : content;
  }

  if (!journal.trim() && !template) {
    throw new Error("Provide mindfulness context via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    journal,
    theme: values.theme,
    cadence: values.cadence,
    goal: values.goal,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a certified mindfulness coach. Create themed prompts and micro-practices that are inclusive, trauma-sensitive, and practical. Track progress with gentle language and measurable cues. Avoid medical claims.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, prompt_pack, micro_practices, reflection_tracker, encouragements. Each prompt should include title, guidance, and when to use it."
      : "Respond in clear Markdown with sections for Overview, Prompt Pack, Micro Practices, Reflection Tracker, and Encouragements. Use tables or bullet lists where helpful.";

  const payload = {
    theme: options.theme || "calm",
    cadence: options.cadence || "daily",
    goal: options.goal || "mindful presence",
    journal_excerpt: options.journal.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nMindfulness context:\n${JSON.stringify(payload, null, 2)}`;

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
    max_tokens: options.format === "json" ? 1800 : 1700,
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

  const descriptorParts = [options.theme || "calm", options.cadence || "daily"];
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
    const options = parseOptions();
    logger.info("Parsed mindfulness context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed mindfulness prompt request.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received mindfulness prompt cache from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved prompt cache to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
