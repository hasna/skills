#!/usr/bin/env bun
/**
 * skill-highlight-reel-generator
 * Generates highlight reel edit plans using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  transcripts: string;
  reelLength: number;
  segments: number;
  tone?: string;
  music?: string;
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

const SKILL_SLUG = "highlight-reel-generator";

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
    .slice(0, 40) || "reel";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "reel-length": { type: "string" },
      segments: { type: "string" },
      tone: { type: "string" },
      music: { type: "string" },
      text: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  let transcripts = "";
  if (values.text) {
    transcripts = values.text;
  } else if (positionals.length > 0) {
    transcripts = positionals
      .map((file) => readFileSync(resolve(file), "utf-8"))
      .join("\n\n---\n\n");
  }

  if (!transcripts.trim()) {
    throw new Error(
      "Provide at least one transcript file path or use --text to pass transcript content."
    );
  }

  const reelLength = values["reel-length"] ? parseInt(values["reel-length"], 10) : 120;
  if (Number.isNaN(reelLength) || reelLength < 30) {
    throw new Error("--reel-length must be an integer of at least 30 seconds.");
  }

  const segments = values.segments ? parseInt(values.segments, 10) : 3;
  if (Number.isNaN(segments) || segments < 2) {
    throw new Error("--segments must be an integer of at least 2.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    transcripts,
    reelLength,
    segments,
    tone: values.tone,
    music: values.music,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior video editor crafting highlight reels.
Produce a reel plan that includes:
- Overview: narrative arc summarizing ${options.segments} segments fitting within ${options.reelLength} seconds
- Segment list with order, start, end, duration, key message, emotional beat
- Script excerpts or paraphrases for narration/dialogue
- Suggested visuals (primary footage, b-roll, motion graphics)
- Caption text and on-screen titles for each segment
- Audio direction (music cues: ${options.music || "uplifting electronic"}, sound design)
- Transitions between segments with pacing notes
- Final CTA and outro guidance aligned to tone (${options.tone || "energetic, motivational"})
- Delivery checklist for editors (aspect ratios, export formats, QC checks)`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, segments, transitions, audio, cta, checklist. Segments array must include index, title, start, end, duration_sec, script, visuals, captions, notes."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include a table for segments, bullet lists for visuals/captions, and sections for transitions, audio, CTA, checklist.";

  const userPayload = {
    transcripts: options.transcripts,
    reel_length_seconds: options.reelLength,
    segment_count: options.segments,
    tone: options.tone,
    music: options.music,
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
    logger.info("Generating highlight reel plan.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.tone || "reel";
    const reelSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `highlight-reel-${reelSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Highlight reel blueprint generated successfully.");
    console.log("\n=== Highlight Reel Preview ===\n");
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
