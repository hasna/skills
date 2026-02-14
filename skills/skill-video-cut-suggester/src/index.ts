#!/usr/bin/env bun
/**
 * skill-video-cut-suggester
 * Generates highlight cut suggestions from video transcripts using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  transcript: string;
  audience?: string;
  clips: number;
  maxDuration: number;
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

const SKILL_SLUG = "video-cut-suggester";

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
    .slice(0, 40) || "highlights";
}

function showHelp(): void {
  console.log(`
skill-video-cut-suggester - Generate highlight cut suggestions from transcripts using AI

Usage:
  skills run video-cut-suggester -- <transcript-file> [options]
  skills run video-cut-suggester -- --text "<transcript>" [options]

Options:
  -h, --help               Show this help message
  --text <transcript>      Inline transcript text
  --audience <platforms>   Target platforms (default: short-form social)
  --clips <count>          Number of highlight clips (default: 3)
  --max-duration <seconds> Max clip duration in seconds (default: 60)
  --tone <style>           Content tone (default: high-energy, informative)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Top highlight segments with timestamps
  - Hook lines and emotional beats
  - B-roll and overlay suggestions
  - Platform recommendations
  - Editing cues and CTA ideas

Examples:
  skills run video-cut-suggester -- ./transcript.txt --clips 5 --max-duration 90
  skills run video-cut-suggester -- talk.txt --audience "TikTok, YouTube Shorts"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      audience: { type: "string" },
      clips: { type: "string" },
      "max-duration": { type: "string" },
      tone: { type: "string" },
      text: { type: "string" },
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

  let transcript = "";
  if (values.text) {
    transcript = values.text;
  } else if (positionals[0]) {
    const resolved = resolve(positionals[0]);
    transcript = readFileSync(resolved, "utf-8");
  }

  if (!transcript.trim()) {
    throw new Error(
      "Provide a transcript file path or use --text to supply transcript content.\nExample: skills run video-cut-suggester -- ./transcripts/talk.txt"
    );
  }

  const clips = values.clips ? parseInt(values.clips, 10) : 3;
  if (Number.isNaN(clips) || clips < 1) {
    throw new Error("--clips must be a positive integer.");
  }

  const maxDuration = values["max-duration"] ? parseInt(values["max-duration"], 10) : 60;
  if (Number.isNaN(maxDuration) || maxDuration < 10) {
    throw new Error("--max-duration must be an integer >= 10 seconds.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    transcript,
    audience: values.audience,
    clips,
    maxDuration,
    tone: values.tone,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a video editor and storyteller specializing in short-form highlight reels.
Analyze the transcript and produce:
- Top highlight segments (limit ${options.clips} clips)
- For each clip: timestamp start/end (estimate if unavailable), duration, hook line, emotional beat, suggested b-roll or overlay, caption text, and why it works
- Platform recommendations based on ${options.audience || "short-form social platforms"}
- Editing cues (jump cuts, transitions, onscreen graphics, music mood)
- CTA ideas tying into the provided tone (${options.tone || "high-energy, informative"})
- Optional alternate hooks and A/B test angles`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, clips, platforms, editing, cta. Clips array should include title, start, end, duration_sec, hook, description, broll, captions, reason."
      : "Respond in polished Markdown. Include sections for Overview, Clips (table with start/end/duration), Platform Tips, Editing Directions, CTA Suggestions, Alternate Hooks.";

  const userPayload = {
    transcript: options.transcript,
    target_platforms: options.audience,
    clip_count: options.clips,
    max_duration_seconds: options.maxDuration,
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
    max_tokens: options.format === "json" ? 2200 : 2000,
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
    logger.info("Generating video highlight suggestions.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.audience || options.tone || "video";
    const planSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `video-cut-plan-${planSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Video cut suggestions generated successfully.");
    console.log("\n=== Highlight Plan Preview ===\n");
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
