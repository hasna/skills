#!/usr/bin/env bun
/**
 * skill-decision-journal
 * Creates structured decision journal entries using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type RiskLevel = "low" | "medium" | "high";

type DecisionTemplate = {
  context?: string;
  decision?: string;
  rationale?: Array<Record<string, unknown>>;
  alternatives?: Array<Record<string, unknown>>;
  signals?: Array<Record<string, unknown>>;
  assumptions?: Array<Record<string, unknown>>;
  follow_up?: Array<Record<string, unknown>>;
};

interface SkillOptions {
  narrative: string;
  owner?: string;
  decisionDate?: string;
  timeHorizon?: string;
  risk: RiskLevel;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DecisionTemplate;
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

const SKILL_SLUG = "decision-journal";
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
    .slice(0, 40) || "decision";
}

function parseJsonTemplate(content: string): DecisionTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DecisionTemplate;
    }
  } catch (error) {
    // treat as plain text if JSON parsing fails
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      owner: { type: "string" },
      "decision-date": { type: "string" },
      "time-horizon": { type: "string" },
      risk: { type: "string", default: "medium" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Decision Journal - Creates structured decision journal entries

Usage:
  skills run decision-journal -- [options] <narrative>

Options:
  --text <string>      Decision narrative (or use positional arg)
  --owner <string>     Decision owner
  --decision-date <date> Date of decision
  --time-horizon <string> Time horizon for review
  --risk <level>       Risk level: low, medium, high (default: medium)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let narrative = values.text || "";
  let template: DecisionTemplate | undefined;

  if (!narrative && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      narrative = template ? "" : content;
    } else {
      narrative = positionals.join(" ");
    }
  }

  if (!narrative.trim() && !template) {
    throw new Error("Provide decision context via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let risk: RiskLevel = "medium";
  if (values.risk === "low" || values.risk === "medium" || values.risk === "high") {
    risk = values.risk as RiskLevel;
  }

  return {
    narrative,
    owner: values.owner as string,
    decisionDate: values["decision-date"] as string,
    timeHorizon: values["time-horizon"] as string,
    risk,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a strategic operator maintaining a rigorous decision journal.
Document the decision clearly, capture rationale pillars, alternatives rejected, risks, and explicit follow-up reminders.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: decision, context, rationale, assumptions, risks, metrics, follow_up. Each follow_up item should include owner, review_date, trigger, status." 
      : "Respond in polished Markdown. Start with a summary blockquote, include sections for context, rationale pillars, alternatives, risks, guardrails, metrics to monitor, and follow-up checklist.";

  const payload = {
    owner: options.owner || "unspecified",
    decision_date: options.decisionDate || new Date().toISOString().slice(0, 10),
    time_horizon: options.timeHorizon || "30 days",
    risk: options.risk,
    narrative_text: options.narrative.substring(0, 6000),
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
    temperature: 0.34,
    max_tokens: options.format === "json" ? 2000 : 1900,
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

  const descriptor = options.owner ? `${options.owner}-${options.risk}` : sessionStamp;
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
    logger.info(`Starting ${SKILL_SLUG} session: ${SESSION_ID}`);
    const options = parseOptions();
    logger.info("Parsed decision context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed decision journal prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received decision journal entry from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved decision journal entry to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
