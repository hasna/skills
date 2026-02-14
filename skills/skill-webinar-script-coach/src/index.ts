#!/usr/bin/env bun
/**
 * skill-webinar-script-coach
 * Generates webinar run-of-show and scripting guidance using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  topic: string;
  duration: number;
  audience?: string;
  hosts?: string;
  goals?: string;
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

const SKILL_SLUG = "webinar-script-coach";

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
    .slice(0, 40) || "webinar";
}

function showHelp(): void {
  console.log(`
skill-webinar-script-coach - Generate webinar run-of-show and scripting guidance using AI

Usage:
  skills run webinar-script-coach -- "<topic>" [options]
  skills run webinar-script-coach -- --topic "<topic>" [options]

Options:
  -h, --help               Show this help message
  --topic <text>           Webinar topic/brief
  --duration <minutes>     Duration in minutes (default: 60, min: 15)
  --audience <description> Target audience description
  --hosts <names>          Host/speaker names
  --goals <objectives>     Goals for the webinar
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Run-of-show timeline with buffer
  - Segment breakdown (intro, value content, demo, interaction, outro)
  - Host/speaker scripts and bullet prompts
  - Interaction moments (polls, Q&A, chat prompts)
  - Slide/visual cues per segment
  - Technical checklist
  - Follow-up actions

Examples:
  skills run webinar-script-coach -- "Customer onboarding webinar" --duration 45
  skills run webinar-script-coach -- --topic "SaaS product demo" --audience "enterprise IT"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      topic: { type: "string" },
      duration: { type: "string" },
      audience: { type: "string" },
      hosts: { type: "string" },
      goals: { type: "string" },
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

  const topic = values.topic || positionals.join(" ").trim();
  if (!topic) {
    throw new Error(
      "Provide a webinar brief via positional text or --topic.\nExample: skills run webinar-script-coach -- \"Customer onboarding webinar\""
    );
  }

  const duration = values.duration ? parseInt(values.duration, 10) : 60;
  if (Number.isNaN(duration) || duration < 15) {
    throw new Error("--duration must be an integer >= 15.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    topic,
    duration,
    audience: values.audience,
    hosts: values.hosts,
    goals: values.goals,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a webinar producer and speaking coach.
Create a comprehensive webinar plan including:
- Run-of-show timeline that fits ${options.duration} minutes (with buffer).
- Segment breakdown (intro, value content, demo, interaction, outro) with allocated times.
- Host/speaker scripts or bullet prompts tailored to ${options.hosts || "the listed hosts"}.
- Interaction moments (polls, Q&A, chat prompts) designed for ${options.audience || "the described audience"}.
- Slide or visual cues per segment.
- Technical checklist (rehearsal, audio/video, contingency plans).
- Follow-up actions (emails, assets, CTA) aligned to goals (${options.goals || "educate, engage, convert"}).
- Coaching tips for tone (${options.topic}).`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, timeline, segments, interactions, slides, checklist, followup, coaching. Timeline should be an ordered array with start_minute, end_minute, segment, description."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include tables for timeline, bullet lists for interactions and checklist, and script excerpts per segment.";

  const userPayload = {
    topic: options.topic,
    duration_minutes: options.duration,
    audience: options.audience,
    hosts: options.hosts,
    goals: options.goals,
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
  const options = parseOptions();
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info("Generating webinar script and run-of-show.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.topic.split(/\s+/).slice(0, 4).join("-");
    const planSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `webinar-plan-${planSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Webinar plan generated successfully.");
    console.log("\n=== Webinar Plan Preview ===\n");
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
