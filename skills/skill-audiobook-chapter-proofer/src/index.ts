#!/usr/bin/env bun
/**
 * skill-audiobook-chapter-proofer
 * Generates audiobook proofing notes using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  transcript: string;
  genre?: string;
  narrator?: string;
  accents?: string;
  issues?: string;
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

const SKILL_SLUG = "audiobook-chapter-proofer";
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
    .slice(0, 40) || "chapter";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      genre: { type: "string" },
      narrator: { type: "string" },
      accents: { type: "string" },
      issues: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Audiobook Chapter Proofer - Generates proofing notes for audiobook chapters

Usage:
  skills run audiobook-chapter-proofer -- [options] <transcript-file>

Options:
  --text <string>      Raw transcript text
  --genre <string>     Genre (e.g. "Sci-Fi", "Romance")
  --narrator <string>  Narrator name
  --accents <string>   Required accents
  --issues <string>    Known issues to check for
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let transcript = values.text || "";

  if (!transcript && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    transcript = readFileSync(filePath, "utf-8");
  }

  if (!transcript.trim()) {
    throw new Error("Provide a chapter transcript via file path or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    transcript: transcript as string,
    genre: values.genre as string,
    narrator: values.narrator as string,
    accents: values.accents as string,
    issues: values.issues as string,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an audiobook proof director and dialogue coach.
Given transcript content, produce a proofing report that includes:
- Summary of overall pacing, energy, and tone fit for ${options.genre || "the genre"}.
- Pronunciation risks (names, locations, foreign terms) with phonetic guidance.
- Character voice consistency notes (if narrator plays multiple roles${options.accents ? `; required accents: ${options.accents}` : ""}).
- Noise/artifacts checklist (mouth clicks, breaths, page turns, ${options.issues || "background noise"}).
- Suggested retakes with timestamps or line references, including coaching prompts.
- Editing/mastering notes for engineers (leveling, EQ, ambience matching).
- Accessibility compliance reminders (chapter markers, metadata).
- Final approval checklist for producer and narrator.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, pacing, pronunciation, characters, noise, retakes, engineering, checklist. Retakes array should include location, issue, coaching_tip."
      : "Respond in polished Markdown. Start with an executive summary blockquote, use tables for pronunciations and retakes, bullet lists for noise issues and engineering notes.";

  const userPayload = {
    transcript_excerpt: options.transcript.substring(0, 20000), // limit length to keep prompt manageable
    narrator: options.narrator,
    genre: options.genre,
    accents: options.accents,
    known_issues: options.issues,
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
    temperature: 0.45,
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
    logger.info("Proofing audiobook chapter.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.narrator || options.genre || "chapter";
    const proofSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `audiobook-proof-${proofSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Audiobook proofing report generated successfully.");
    console.log("\n=== Proofing Preview ===\n");
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
