#!/usr/bin/env bun
/**
 * skill-jingle-composer
 * Generates jingle composition briefs using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  tone?: string;
  tempo?: string;
  length: number;
  instruments?: string;
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

const SKILL_SLUG = "jingle-composer";

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
    .slice(0, 40) || "jingle";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      tone: { type: "string" },
      tempo: { type: "string" },
      length: { type: "string" },
      instruments: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
    },
    allowPositionals: true,
  });

  const brief = values.brief || positionals.join(" ").trim();
  if (!brief) {
    throw new Error("Provide a campaign brief via positional text or --brief.");
  }

  const length = values.length ? parseInt(values.length, 10) : 20;
  if (Number.isNaN(length) || length < 5) {
    throw new Error("--length must be an integer >= 5 seconds.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief,
    tone: values.tone,
    tempo: values.tempo,
    length,
    instruments: values.instruments,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a music director and jingle composer.
Create a composition brief that includes:
- Concept overview and storytelling (tied to brief).
- Musical direction: key, tempo (${options.tempo || "110 BPM"}), rhythm feel, genre influences (${options.tone || "upbeat, friendly"}).
- Chord progression suggestions and melodic motifs for intro, verse, tagline/hook.
- Lyric ideas referencing product benefits (verse + hook) with optional alternatives.
- Instrumentation plan featuring ${options.instruments || "guitar, bass, drums, synth"}.
- Production notes (mix, FX, transitions, stingers).
- Delivery guidance for ${options.length}-second edit, including 5s/15s cutdown tips.
- AI music model prompts or human composer briefing summary.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, musical_direction, chord_progressions, lyrics, instrumentation, production, delivery, prompts. Musical direction should include key, tempo, groove, style."
      : "Respond in polished Markdown. Start with an executive summary blockquote, use tables for chord progressions and instrumentation, bullet lists for lyrics and production notes.";

  const userPayload = {
    campaign_brief: options.brief,
    tone: options.tone,
    tempo: options.tempo,
    length_seconds: options.length,
    instruments: options.instruments,
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
    logger.info("Composing jingle brief.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.brief.split(/\s+/).slice(0, 4).join("-");
    const briefSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `jingle-brief-${briefSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Jingle composition brief generated successfully.");
    console.log("\n=== Jingle Brief Preview ===\n");
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
