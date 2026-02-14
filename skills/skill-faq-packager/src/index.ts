#!/usr/bin/env bun
/**
 * skill-faq-packager
 * Packages raw FAQ content into structured Q&A using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  content: string;
  audience?: string;
  categories?: string[];
  escalation?: string[];
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

const SKILL_SLUG = "faq-packager";
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
    .slice(0, 40) || "faq";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      audience: { type: "string" },
      categories: { type: "string" },
      escalation: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
FAQ Packager - Packages raw FAQ content into structured Q&A

Usage:
  skills run faq-packager -- [options] <content>

Options:
  --text <string>      Raw FAQ content (or use positional arg)
  --audience <string>  Target audience
  --categories <list>  Comma-separated categories
  --escalation <list>  Comma-separated escalation paths
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let content = values.text || "";

  if (!content && positionals[0]) {
    const resolved = resolve(positionals[0]);
    if (existsSync(resolved)) {
      content = readFileSync(resolved, "utf-8");
    } else {
      content = positionals.join(" ");
    }
  }

  if (!content.trim()) {
    throw new Error("Provide raw FAQ content via positional text, file path, or --text.");
  }

  const categories = values.categories
    ? (values.categories as string).split(",").map(c => c.trim()).filter(Boolean)
    : undefined;

  const escalation = values.escalation
    ? (values.escalation as string).split(",").map(e => e.trim()).filter(Boolean)
    : ["contact support", "escalate to success team"];

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    content,
    audience: values.audience as string,
    categories,
    escalation,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a knowledge base strategist.
Organize the FAQ content provided into a structured FAQ hub:
- Audience: ${options.audience || "general audience"}
- Use categories: ${options.categories ? options.categories.join(", ") : "determine best-fit categories automatically"}
- Escalation actions: ${options.escalation?.join(", ")}

Deliver:
- Categorized FAQ list with question, concise answer, related tags.
- Indicate when self-serve vs escalation needed.
- Surface top 5 most critical questions.
- Provide microcopy tips for consistent tone.
- Publishing guidelines (formatting, update cadence, ownership).
- Suggestions for accompanying assets (videos, screenshots, links).`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: categories, top_questions, tone_guidelines, publishing, assets. Categories array should include name, faqs (question, answer, tags, escalation_required)."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include sections per category with Q&A bullet lists, highlight top questions, and provide tone/publishing guidance.";

  const userPayload = {
    raw_content: options.content.substring(0, 4000),
    audience: options.audience,
    provided_categories: options.categories,
    escalation: options.escalation,
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
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Packaging FAQs.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = (options.categories?.[0] || options.audience || "faq").split(/\s+/).slice(0, 4).join("-");
    const faqSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `faq-package-${faqSlug}-${sessionStamp}.${extension}`);
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

    logger.success("FAQ package generated successfully.");
    console.log("\n=== FAQ Package Preview ===\n");
    console.log(finalContent.slice(0, 1500));
    if (finalContent.length > 1500) {
      console.log("\n… (truncated)");
    }
    console.log(`\nExport saved to: ${targetPath}`);
    console.log(`Logs written to: ${skillLogsDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

run();
