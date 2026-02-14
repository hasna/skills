#!/usr/bin/env bun
/**
 * skill-outreach-cadence-designer
 * Generates personalized outreach cadences using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type ToneOption = "consultative" | "direct" | "friendly";

type CadenceTemplate = {
  audience?: string;
  value_props?: Array<Record<string, unknown>>;
  objections?: Array<Record<string, unknown>>;
  assets?: Array<Record<string, unknown>>;
  touches?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  brief: string;
  persona?: string;
  product?: string;
  channels?: string[];
  duration?: string;
  tone: ToneOption;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: CadenceTemplate;
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

const SKILL_SLUG = "outreach-cadence-designer";

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
    .slice(0, 40) || "cadence";
}

function parseJsonTemplate(content: string): CadenceTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as CadenceTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-outreach-cadence-designer - Generate personalized outreach cadences using AI

Usage:
  skills run outreach-cadence-designer -- <campaign-file> [options]
  skills run outreach-cadence-designer -- --text "<campaign-brief>" [options]

Options:
  -h, --help               Show this help message
  --text <brief>           Inline campaign brief
  --persona <target>       Target persona (default: decision maker)
  --product <offering>     Product/service name (default: core offering)
  --channels <list>        Comma-separated channels (default: email,linkedin)
  --duration <days>        Cadence duration (default: 12 days)
  --tone <style>           Tone: consultative | direct | friendly (default: consultative)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Summary
  - Touch sequence with timing
  - Personalization angles
  - Recommended assets
  - Coaching tips

Examples:
  skills run outreach-cadence-designer -- ./brief.txt --persona "CTO" --channels "email,phone"
  skills run outreach-cadence-designer -- --text "SaaS demo outreach" --tone "direct"

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
      persona: { type: "string" },
      product: { type: "string" },
      channels: { type: "string" },
      duration: { type: "string" },
      tone: { type: "string", default: "consultative" },
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

  let brief = values.text || "";
  let template: CadenceTemplate | undefined;

  if (!brief && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    brief = template ? "" : content;
  }

  if (!brief.trim() && !template) {
    throw new Error("Provide campaign input via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let tone: ToneOption = "consultative";
  if (values.tone === "consultative" || values.tone === "direct" || values.tone === "friendly") {
    tone = values.tone;
  }

  const channelList = values.channels
    ? values.channels.split(",").map(item => item.trim()).filter(Boolean)
    : undefined;

  return {
    brief,
    persona: values.persona,
    product: values.product,
    channels: channelList,
    duration: values.duration,
    tone,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a sales development leader designing a high-performing outbound cadence.
Sequence multi-channel touches, adapt messaging to persona, and respect buyer etiquette.
Provide subject lines, opener snippets, CTA ideas, and personalization hooks.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, touches, personalization, assets, tips. Each touch should include day_offset, channel, subject_or_intro, objective, call_to_action, fallback." 
      : "Respond in polished Markdown. Start with a summary, include a table of touches (day, channel, objective, CTA), list personalization angles, recommended assets, and coaching tips.";

  const payload = {
    persona: options.persona || "decision maker",
    product: options.product || "core offering",
    channels: options.channels || ["email", "linkedin"],
    duration: options.duration || "12 days",
    tone: options.tone,
    brief_text: options.brief.substring(0, 6000),
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
    temperature: 0.43,
    max_tokens: options.format === "json" ? 2200 : 2100,
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

  const descriptor = options.persona ? `${options.persona}-${options.tone}` : sessionStamp;
  const base = slugify(descriptor);
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
    logger.info("Parsed outreach inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed cadence design prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received outreach cadence from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved cadence to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
