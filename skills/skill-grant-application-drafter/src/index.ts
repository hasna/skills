#!/usr/bin/env bun
/**
 * skill-grant-application-drafter
 * Drafts grant application responses using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type GrantTemplate = {
  questions?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  stories?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  prompts: string;
  funder?: string;
  org?: string;
  wordLimit: number;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: GrantTemplate;
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

const SKILL_SLUG = "grant-application-drafter";

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
    .slice(0, 40) || "grant-draft";
}

function parseJsonTemplate(content: string): GrantTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as GrantTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-grant-application-drafter - Draft grant application responses using AI

Usage:
  skills run grant-application-drafter -- <prompts-file> [options]
  skills run grant-application-drafter -- --text "<grant-prompts>" [options]

Options:
  -h, --help               Show this help message
  --text <prompts>         Inline grant prompts
  --funder <name>          Funder name (default: General Funder)
  --org <name>             Organization name (default: Your Organization)
  --word-limit <num>       Word limit per response (default: 800)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Draft responses per prompt
  - Impact metrics
  - Budget notes
  - Funder alignment

Examples:
  skills run grant-application-drafter -- ./grant-prompts.txt --funder "Gates Foundation"
  skills run grant-application-drafter -- --text "Describe your impact..." --word-limit 500

Requirements:
  OPENAI_API_KEY environment variable must be set.
`);
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      funder: { type: "string" },
      org: { type: "string" },
      "word-limit": { type: "string", default: "800" },
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

  let prompts = values.text || "";
  let template: GrantTemplate | undefined;

  if (!prompts && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    prompts = template ? "" : content;
  }

  if (!prompts.trim() && !template) {
    throw new Error("Provide grant prompts via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  const wordLimit = (() => {
    const parsed = Number.parseInt(values["word-limit"], 10);
    return Number.isNaN(parsed) ? 800 : Math.max(200, parsed);
  })();

  return {
    prompts,
    funder: values.funder,
    org: values.org,
    wordLimit,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a grant writing specialist.
Craft persuasive, clear grant responses using the provided prompts, metrics, and stories.
Follow the word limit and tailor tone to the funder and organization.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, sections, budget_notes, impact, alignment. Each section should include prompt, draft_response, word_count." 
      : "Respond in polished Markdown. Start with an executive summary, provide sections per prompt with headings, weave in organizational impact metrics, include budget notes if relevant, and finish with closing remarks aligned to the funder.";

  const payload = {
    funder: options.funder || "General Funder",
    organization: options.org || "Your Organization",
    word_limit: options.wordLimit,
    prompts_text: options.prompts.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\n${JSON.stringify(payload, null, 2)}`;

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
    temperature: 0.42,
    max_tokens: options.format === "json" ? 2300 : 2100,
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

function buildExportPath(skillExportsDir: string, sessionStamp: string, options: SkillOptions) {
  if (options.output) {
    return resolve(options.output);
  }

  const descriptorParts = [options.funder || "funder", options.org || "org"];
  const base = slugify(descriptorParts.filter(Boolean).join("-"));
  const extension = options.format === "json" ? "json" : "md";
  return join(skillExportsDir, `${base}_${sessionStamp}.${extension}`);
}

function preview(content: string) {
  const lines = content.split(/\r?\n/).slice(0, 8);
  lines.forEach(line => console.log(`   ${line}`));
  if (content.split(/\r?\n/).length > 8) {
    console.log("   ...");
  }
}

async function main() {
  const { sessionStamp, skillExportsDir, skillLogsDir } = getPaths();
  const logger = createLogger(skillLogsDir, sessionStamp);

  try {
    const options = parseOptions();
    logger.info("Parsed grant prompts and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed grant drafting prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received grant draft from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved grant draft to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
