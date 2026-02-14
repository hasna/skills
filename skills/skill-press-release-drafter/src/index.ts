#!/usr/bin/env bun
/**
 * skill-press-release-drafter
 * Generates press release drafts using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  quotes?: string;
  angle?: string;
  region?: string;
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

const SKILL_SLUG = "press-release-drafter";

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
    .slice(0, 40) || "press-release";
}

function showHelp(): void {
  console.log(`
skill-press-release-drafter - Generate press release drafts using AI

Usage:
  skills run press-release-drafter -- "<announcement>" [options]
  skills run press-release-drafter -- --brief "<announcement>" [options]

Options:
  -h, --help               Show this help message
  --brief <text>           Announcement summary
  --quotes <stakeholders>  Stakeholders to quote (default: CEO)
  --angle <focus>          Messaging angle (default: innovation and customer impact)
  --region <market>        Region focus (default: Global)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Headline and subheadline
  - Lead paragraph
  - Body with supporting details
  - Stakeholder quotes
  - CTA and boilerplate
  - Media contact information
  - Media kit recommendations

Examples:
  skills run press-release-drafter -- "Product launch for new AI assistant"
  skills run press-release-drafter -- --brief "Series B funding announcement" --quotes "CEO,CFO"

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      brief: { type: "string" },
      quotes: { type: "string" },
      angle: { type: "string" },
      region: { type: "string" },
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

  const brief = values.brief || positionals.join(" ").trim();
  if (!brief) {
    throw new Error("Provide an announcement summary via positional text or --brief.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief,
    quotes: values.quotes,
    angle: values.angle,
    region: values.region,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a PR director and press release writer.
Draft a professional press release for: ${options.brief}
- Messaging angle: ${options.angle || "innovation and customer impact"}
- Stakeholders to quote: ${options.quotes || "CEO"}
- Region focus: ${options.region || "Global"}

Include:
- Dateline and location.
- Headline + subheadline.
- Lead paragraph summarizing announcement with key stats/benefits.
- Body paragraphs with supporting details, product features, customer impact.
- At least two quotes from stakeholders provided.
- CTA for media or customers.
- Company boilerplate.
- Media contact information.
- Suggested media kit assets and distribution checklist.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: headline, subheadline, dateline, body, quotes, cta, boilerplate, contact, media_kit, distribution. Body should be array of paragraphs."
      : "Respond in polished Markdown. Start with headline/subheadline, then structure release with standard sections, followed by media contact, boilerplate, and media kit recommendations.";

  const userPayload = {
    announcement: options.brief,
    quotes: options.quotes,
    angle: options.angle,
    region: options.region,
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
    logger.info("Drafting press release.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.brief.split(/\s+/).slice(0, 4).join("-");
    const releaseSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `press-release-${releaseSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Press release drafted successfully.");
    console.log("\n=== Press Release Preview ===\n");
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
