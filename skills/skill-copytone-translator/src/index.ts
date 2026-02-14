#!/usr/bin/env bun
/**
 * skill-copytone-translator
 * Rewrites copy into alternate tones using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  sourceCopy: string;
  tone: string;
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

const SKILL_SLUG = "copytone-translator";
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
    .slice(0, 40) || "copytone";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      tone: { type: "string" },
      audience: { type: "string" },
      variants: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Copytone Translator - Rewrites copy into alternate tones

Usage:
  skills run copytone-translator -- [options] <copy>

Options:
  --text <string>      Source copy (or use positional arg)
  --tone <string>      Target tone attributes (e.g. "friendly, professional")
  --audience <string>  Target audience
  --variants <n>       Number of variants (1-5, default: 2)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let sourceCopy = values.text || "";
  if (!sourceCopy && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      sourceCopy = readFileSync(filePath, "utf-8");
    } else {
      sourceCopy = positionals.join(" ");
    }
  }

  if (!sourceCopy.trim()) {
    throw new Error("Provide source copy via positional text, file path, or --text.");
  }

  if (!values.tone || !values.tone.trim()) {
    throw new Error("Specify target tone attributes using --tone \"attribute1, attribute2\".");
  }

  const variants = values.variants ? parseInt(values.variants as string, 10) : 2;
  if (Number.isNaN(variants) || variants < 1 || variants > 5) {
    throw new Error("--variants must be between 1 and 5.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    sourceCopy,
    tone: values.tone as string,
    audience: values.audience as string,
    variants,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior brand copywriter and tone coach.
Rewrite the given source copy into ${options.variants} tone variants:
- Target tone attributes: ${options.tone}
- Audience: ${options.audience || "general audience"}

For each variant provide:
- Variant name (e.g., "Playful Premium").
- Tone rationale (1-2 sentences calling out how attributes are applied).
- Rewritten copy maintaining original meaning but adjusting voice and structure.
- Guardrails: do/don't list to keep future copy in this tone.

Also produce:
- Tone palette summary comparing variants.
- Suggestions for where each variant fits (channel/use case).
- Quality checks (readability, compliance with brand tone).
- Optional prompts for AI copy tools to achieve this tone.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: tone_palette, variants, use_cases, quality_checks, prompts. Variants array should include name, rationale, copy, guardrails."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include tables for tone palette and use cases, and subsections for each variant with rewritten copy and guardrails.";

  const userPayload = {
    source_copy: options.sourceCopy.substring(0, 4000), // keep prompt manageable
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
    temperature: 0.6,
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
    logger.info("Translating copy tone.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.tone.split(",")[0] || "copytone";
    const toneSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `copytone-${toneSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Copy tone translation completed.");
    console.log("\n=== Copy Tone Preview ===\n");
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
