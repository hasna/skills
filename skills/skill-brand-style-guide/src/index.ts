#!/usr/bin/env bun
/**
 * skill-brand-style-guide
 * Generates comprehensive brand guidelines using OpenAI.
 *
 * This microservice relies only on its local files and the Bun runtime.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  brand?: string;
  voice?: string;
  audience?: string;
  channels: string[];
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

const SKILL_SLUG = "brand-style-guide";
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
    .slice(0, 40) || "brand";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brand: { type: "string" },
      voice: { type: "string" },
      audience: { type: "string" },
      channels: { type: "string", default: "web,mobile,email,social" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Brand Style Guide - Generates comprehensive brand guidelines

Usage:
  skills run brand-style-guide -- [options] <brief>

Options:
  --brief <string>     Creative brief (or use positional arg)
  --brand <string>     Brand name
  --voice <string>     Voice description
  --audience <string>  Target audience
  --channels <list>    Comma-separated channels (default: web,mobile,email,social)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const brief = positionals.join(" ").trim();

  if (!brief) {
    throw new Error(
      "A creative brief is required.\nExample: skills run brand-style-guide -- \"AI writing assistant for marketers\""
    );
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const channels = values.channels
    ? (values.channels as string)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : ["web", "mobile", "email", "social"];

  return {
    brief,
    brand: values.brand as string,
    voice: values.voice as string,
    audience: values.audience as string,
    channels: channels.length > 0 ? channels : ["web", "mobile", "email", "social"],
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are an award-winning brand strategist and creative director.
Produce a complete, actionable brand style guide that includes:
- Brand essence and positioning
- Voice & tone (with do/don't examples)
- Audience insights
- Visual direction (color palette with accessibility notes, typography, imagery, iconography)
- Channel-specific applications for each requested channel
- Asset checklist and governance tips.
`;

  const userDetails = {
    request: "Create a brand style guide",
    brief: options.brief,
    brand: options.brand,
    voice: options.voice,
    audience: options.audience,
    channels: options.channels,
    format: options.format,
  };

  const user =
    (options.format === "json"
      ? "Respond in JSON with keys: overview, voice, audience, visual_identity, channel_applications, asset_checklist, governance. Use structured subfields.\n\n"
      : "Respond in polished Markdown with an executive summary blockquote, clear headings, tables, and action lists.\n\n") +
    JSON.stringify(userDetails, null, 2);

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
    max_tokens: options.format === "json" ? 2500 : 2000,
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

async function writeExport(filePath: string, content: string) {
  ensureDir(dirname(filePath));
  await Bun.write(filePath, content);
}

async function run() {
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Starting brand-style-guide generation.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const brandSlug = slugify(options.brand || options.brief.split(/\s+/).slice(0, 3).join("-"));
    const extension = options.format === "json" ? "json" : "md";

    const targetPath =
      options.output ||
      join(skillExportsDir, `brand-style-guide-${brandSlug}-${sessionStamp}.${extension}`);

    let finalContent = content;

    if (options.format === "json") {
      try {
        finalContent = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        logger.error("Model response was not valid JSON. Wrapping response.");
        finalContent = JSON.stringify({ raw: content }, null, 2);
      }
    }

    await writeExport(targetPath, finalContent);

    logger.success("Brand style guide generated successfully.");

    console.log("\n=== Brand Style Guide Preview ===\n");
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
