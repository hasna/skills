#!/usr/bin/env bun
/**
 * skill-audio-cleanup-lab
 * Generates audio cleanup recipes using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  project: string;
  issues?: string;
  deliverable?: string;
  software?: string;
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

const SKILL_SLUG = "audio-cleanup-lab";
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
    .slice(0, 40) || "audio";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      issues: { type: "string" },
      deliverable: { type: "string" },
      software: { type: "string" },
      project: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Audio Cleanup Lab - Generates audio cleanup recipes

Usage:
  skills run audio-cleanup-lab -- [options] <project-description>

Options:
  --project <string>     Project description (or use positional arg)
  --issues <string>      Specific audio issues (e.g. "hiss, clicks")
  --deliverable <string> Target deliverable (e.g. "podcast", "film")
  --software <string>    Preferred software (e.g. "Pro Tools", "Audacity")
  --format <fmt>         Output format: markdown, json (default: markdown)
  --model <model>        OpenAI model to use (default: gpt-4o-mini)
  --output <path>        Save report to file
  --help, -h             Show this help
`);
    process.exit(0);
  }

  const project =
    values.project ||
    positionals.join(" ").trim();

  if (!project) {
    throw new Error(
      "Provide a project description or issues summary via positional text or --project."
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    project: project as string,
    issues: values.issues as string,
    deliverable: values.deliverable as string,
    software: values.software as string,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an audio post-production engineer.
Generate a cleanup/mastering recipe including:
- Diagnostic summary of likely issues from description (${options.issues || "general background noise"}).
- Recommended processing chain (order of operations with rationale).
- Detailed settings for EQ, noise reduction, de-ess, compression, gating, limiting.
- Suggested plugins or built-in tools (tailored to ${options.software || "any DAW"}).
- Tips for salvage, alternate takes, or ADR if problems are severe.
- Loudness targets and export specs for ${options.deliverable || "podcast episode"}.
- Quick reference checklist for the engineer.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, chain, settings, plugins, salvage, loudness, checklist. Chain should be an ordered array with step, purpose, settings."
      : "Respond in polished Markdown. Start with an executive summary blockquote, use numbered lists for processing chain, tables for settings, and bullet lists for plugins, loudness, checklist.";

  const userPayload = {
    project_description: options.project,
    audio_issues: options.issues,
    deliverable: options.deliverable,
    preferred_software: options.software,
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
    temperature: 0.5,
    max_tokens: options.format === "json" ? 2200 : 1900,
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
    logger.info("Generating audio cleanup recipe.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.deliverable || options.software || "audio";
    const recipeSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `audio-cleanup-${recipeSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Audio cleanup recipe generated successfully.");
    console.log("\n=== Audio Cleanup Preview ===\n");
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
