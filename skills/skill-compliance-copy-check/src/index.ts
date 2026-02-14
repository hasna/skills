#!/usr/bin/env bun
/**
 * skill-compliance-copy-check
 * Screens marketing copy for compliance issues using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

interface SkillOptions {
  copy: string;
  industry?: string;
  regions?: string[];
  severity?: "info" | "warning" | "critical";
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

const SKILL_SLUG = "compliance-copy-check";
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
    .slice(0, 40) || "compliance";
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      industry: { type: "string" },
      regions: { type: "string" },
      severity: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Compliance Copy Check - Screens marketing copy for compliance issues

Usage:
  skills run compliance-copy-check -- [options] <copy>

Options:
  --text <string>      Copy to check (or use positional arg)
  --industry <string>  Industry context
  --regions <list>     Comma-separated regions
  --severity <level>   Severity threshold: info, warning, critical (default: warning)
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let copy = values.text || "";
  if (!copy && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      copy = readFileSync(filePath, "utf-8");
    } else {
      copy = positionals.join(" ");
    }
  }

  if (!copy.trim()) {
    throw new Error("Provide copy to scan via positional text, file path, or --text.");
  }

  const regions = values.regions
    ? (values.regions as string).split(",").map(r => r.trim()).filter(Boolean)
    : ["US"];

  const severity = values.severity === "critical" || values.severity === "info" ? values.severity : "warning";

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    copy,
    industry: values.industry as string,
    regions,
    severity,
    format,
    model: values.model as string,
    output: values.output as string,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a compliance reviewer knowledgeable about marketing regulations.
Analyze the copy for issues:
- Industry: ${options.industry || "general marketing"}
- Regions: ${options.regions?.join(", ")}
- Severity threshold: ${options.severity || "warning"}

Provide:
- Issue list with location (excerpt), severity, rule violated, and recommended rewrite.
- Overall compliance risk summary.
- Safe rewrite version of the copy incorporating fixes.
- Approval checklist for reviewers (legal, compliance, product).
- Logging notes (references or precedents).
- Alerts for missing required disclosures.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, issues, safe_copy, checklist, alerts, log_notes. Issues array entries should include excerpt, severity, rule, recommendation."
      : "Respond in polished Markdown. Start with an executive summary blockquote, include a table for issues, provide rewritten safe copy, checklist, alerts, and logging notes.";

  const userPayload = {
    copy: options.copy.substring(0, 6000),
    industry: options.industry,
    regions: options.regions,
    severity: options.severity,
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
    temperature: 0.35,
    max_tokens: options.format === "json" ? 2400 : 2000,
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
    logger.info("Running compliance copy check.");
    logger.info(`Format: ${options.format.toUpperCase()}, Model: ${options.model}`);

    const { system, user } = buildPrompt(options);
    const content = await callOpenAI(options, system, user);

    const slugBase = options.industry || options.copy.split(/\s+/).slice(0, 4).join("-");
    const reportSlug = slugify(slugBase);
    const extension = options.format === "json" ? "json" : "md";
    const defaultPath = join(skillExportsDir, `compliance-report-${reportSlug}-${sessionStamp}.${extension}`);
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

    logger.success("Compliance review completed.");
    console.log("\n=== Compliance Report Preview ===\n");
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
