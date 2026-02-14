#!/usr/bin/env bun
/**
 * skill-onboarding-sequence-builder
 * Generates customer onboarding sequences using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type OnboardingTemplate = {
  stakeholders?: Array<Record<string, unknown>>;
  goals?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  milestones?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  brief: string;
  customerTier?: string;
  timespan?: string;
  segments?: string[];
  successMetrics?: string[];
  format: OutputFormat;
  model: string;
  output?: string;
  template?: OnboardingTemplate;
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

const SKILL_SLUG = "onboarding-sequence-builder";

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
    .slice(0, 40) || "onboarding";
}

function parseJsonTemplate(content: string): OnboardingTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as OnboardingTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function showHelp(): void {
  console.log(`
skill-onboarding-sequence-builder - Generate customer onboarding sequences using AI

Usage:
  skills run onboarding-sequence-builder -- <brief-file> [options]
  skills run onboarding-sequence-builder -- --text "<brief>" [options]

Options:
  -h, --help               Show this help message
  --text <brief>           Inline onboarding brief
  --customer-tier <tier>   Customer tier (default: general)
  --timespan <duration>    Onboarding timespan (default: 45 days)
  --segments <list>        Comma-separated segments (default: kickoff,enablement,value review)
  --success-metrics <list> Comma-separated metrics (default: time-to-value)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Timeline with milestones
  - Communication plan
  - Risk watchlist
  - Playbook references
  - Metric review schedule

Examples:
  skills run onboarding-sequence-builder -- ./customer-brief.txt --customer-tier "Enterprise"
  skills run onboarding-sequence-builder -- --text "SaaS platform onboarding" --timespan "30 days"

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
      "customer-tier": { type: "string" },
      timespan: { type: "string" },
      segments: { type: "string" },
      "success-metrics": { type: "string" },
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
  let template: OnboardingTemplate | undefined;

  if (!brief && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    brief = template ? "" : content;
  }

  if (!brief.trim() && !template) {
    throw new Error("Provide onboarding inputs via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    brief,
    customerTier: values["customer-tier"],
    timespan: values.timespan,
    segments: parseList(values.segments),
    successMetrics: parseList(values["success-metrics"]),
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a customer onboarding lead designing a high-touch activation plan.
Sequence milestones, communications, enablement, and risk mitigation steps tailored to customer tier and goals.
Account for owners, tooling, and proactive checkpoints.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, timeline, milestones, communications, risks, playbooks, metrics. Each timeline entry should include day_offset, title, owner, channel, deliverables, success_metric." 
      : "Respond in polished Markdown. Start with an executive summary, include a timeline table (day, milestone, owner, deliverables, success metric), communication plan, risk watchlist, playbook references, and metric review schedule.";

  const payload = {
    customer_tier: options.customerTier || "general",
    timespan: options.timespan || "45 days",
    segments: options.segments || ["kickoff", "enablement", "value review"],
    success_metrics: options.successMetrics || ["time-to-value"],
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
    temperature: 0.38,
    max_tokens: options.format === "json" ? 2200 : 2000,
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

  const descriptorParts = [options.customerTier || "customer", options.timespan || "timeline"];
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
    logger.info("Parsed onboarding inputs and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed onboarding prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received onboarding plan from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved onboarding plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
