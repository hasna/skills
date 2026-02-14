#!/usr/bin/env bun
/**
 * skill-microcopy-generator
 * Generates UX microcopy variants for product surfaces.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  brief: string;
  surface?: string;
  tone?: string;
  audience?: string;
  variants: number;
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

const SKILL_SLUG = "microcopy-generator";

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
    .slice(0, 40) || "microcopy";
}

function showHelp(): void {
  console.log(`
skill-microcopy-generator - Generate UX microcopy variants for product surfaces using AI

Usage:
  skills run microcopy-generator -- "<brief>" [options]
  skills run microcopy-generator -- --brief "<brief>" [options]

Options:
  -h, --help               Show this help message
  --brief <text>           Context/brief for the microcopy
  --surface <type>         UI surface type (default: button + helper text)
  --tone <style>           Desired tone (default: helpful, direct)
  --audience <target>      Target audience (default: general users)
  --variants <count>       Number of variants 1-5 (default: 3)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Microcopy variants with name, primary copy, supporting text
  - Rationale for each variant
  - Localization notes
  - Tone guardrails (do/don't)
  - Accessibility checks
  - A/B test suggestions

Examples:
  skills run microcopy-generator -- "Error message for invalid email" --surface "form validation"
  skills run microcopy-generator -- --brief "Upgrade to Pro CTA" --tone "persuasive" --variants 5

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
      surface: { type: "string" },
      tone: { type: "string" },
      audience: { type: "string" },
      variants: { type: "string" },
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
    throw new Error("Provide microcopy context via positional text or --brief.");
  }

  const variants = values.variants ? parseInt(values.variants, 10) : 3;
  if (Number.isNaN(variants) || variants < 1 || variants > 5) {
    throw new Error("--variants must be between 1 and 5.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief,
    surface: values.surface,
    tone: values.tone,
    audience: values.audience,
    variants,
    format,
    model: values.model,
    output: values.output,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a UX writer and localization strategist.
Generate ${options.variants} microcopy variants for:
- Context: ${options.brief}
- Surface: ${options.surface || "button + helper text"}
- Tone: ${options.tone || "helpful, direct"}
- Audience: ${options.audience || "general users"}

For each variant deliver:
- Variant name (tone descriptor).
- Copy for primary element (button/CTA/headline, etc.).
- Supporting text (helper/error/tooltip as applicable).
- Rationale (why it works for persona/tone).
- Localization notes (max length, cultural considerations).

Additionally provide:
- Tone guardrails (do/don't).
- Voice consistency checklist.
- Accessibility checks (reading level, contrast cues).
- Suggestions for A/B tests and success metrics.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: variants, guardrails, accessibility, experiments. Variants array should include name, primary_copy, supporting_copy, rationale, localization."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include subsections per variant with tables/lists for copy and rationale, and conclude with guardrails, accessibility, and experiment suggestions.";

  const userPayload = {
    brief: options.brief,
    surface: options.surface,
    tone: options.tone,
    audience: options.audience,
    variants: options.variants,
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
    logger.info("Generating microcopy variants.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.surface || options.brief.split(/\s+/).slice(0, 4).join("-");
    const microSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `microcopy-${microSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Microcopy package generated successfully.");
    console.log("\n=== Microcopy Preview ===\n");
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
