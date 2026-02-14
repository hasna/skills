#!/usr/bin/env bun
/**
 * skill-podcast-show-notes
 * Generates podcast show notes from transcripts using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  transcript: string;
  title?: string;
  guest?: string;
  keywords?: string;
  cta?: string;
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

const SKILL_SLUG = "podcast-show-notes";

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
    .slice(0, 40) || "podcast";
}

function showHelp(): void {
  console.log(`
skill-podcast-show-notes - Generate podcast show notes from transcripts using AI

Usage:
  skills run podcast-show-notes -- <transcript-file> [options]
  skills run podcast-show-notes -- --text "<transcript>" [options]

Options:
  -h, --help               Show this help message
  --text <transcript>      Inline transcript text
  --title <title>          Episode title
  --guest <name>           Guest name
  --keywords <words>       Target SEO keywords (comma-separated)
  --cta <text>             Call to action text
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Episode summary
  - Bullet highlights with timestamps
  - Guest bio
  - Key quotes
  - Resources/links mentioned
  - SEO keywords and meta description
  - Chapter markers
  - Promotional CTA
  - Social post snippet

Examples:
  skills run podcast-show-notes -- ./transcripts/ep1.txt --title "Episode 1"
  skills run podcast-show-notes -- episode.txt --guest "John Doe" --format json

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      title: { type: "string" },
      guest: { type: "string" },
      keywords: { type: "string" },
      cta: { type: "string" },
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
      "Provide a transcript path or inline text.\nExample: skills run podcast-show-notes -- ./transcripts/ep1.txt"
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    transcript,
    title: values.title,
    guest: values.guest,
    keywords: values.keywords,
    cta: values.cta,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a podcast content producer and SEO strategist.
Given a transcript, produce:
- Compelling episode summary (50-80 words)
- Bullet highlights with timestamps (estimate when absent)
- Guest bio and credentials (use transcript context; if none, note n/a)
- Key quotes with speaker attribution
- Resources / links mentioned
- SEO keywords and meta description
- Chapter markers (title + timestamp)
- Promotional CTA paragraph using provided CTA
- Suggested social post snippet`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, highlights, guest, quotes, resources, seo, chapters, cta, social. Highlights array should include title, timestamp, description."
      : "Respond in polished Markdown. Start with H1 title (use provided title or derive), include sections for Summary, Highlights, Guest, Quotes, Resources, SEO Keywords, Chapters, CTA, Social Post.";

  const userPayload = {
    transcript: options.transcript,
    episode_title: options.title,
    guest_name: options.guest,
    target_keywords: options.keywords,
    call_to_action: options.cta || "Subscribe for more episodes and leave a review!",
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
  const options = parseOptions();
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info("Generating podcast show notes.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const baseSlug = options.title || options.guest || "podcast";
    const slug = slugify(baseSlug);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `podcast-show-notes-${slug}-${sessionStamp}.${extension}`);
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

    logger.success("Podcast show notes generated successfully.");
    console.log("\n=== Show Notes Preview ===\n");
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
