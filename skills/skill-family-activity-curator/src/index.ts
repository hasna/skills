#!/usr/bin/env bun
/**
 * skill-family-activity-curator
 * Curates family activities with supplies and adaptations using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";

type OutputFormat = "markdown" | "json";

type FamilyTemplate = Record<string, unknown>;

interface SkillOptions {
  profile: string;
  group?: string;
  ages?: string;
  setting?: string;
  duration?: string;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: FamilyTemplate;
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

const SKILL_SLUG = "family-activity-curator";
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
    .slice(0, 40) || "family-activities";
}

function parseJsonTemplate(content: string): FamilyTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as FamilyTemplate;
    }
  } catch (_error) {
    // treat as text when parse fails
  }
  return undefined;
}

function parseOptions(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      text: { type: "string" },
      group: { type: "string" },
      ages: { type: "string" },
      setting: { type: "string" },
      duration: { type: "string" },
      format: { type: "string", default: "markdown" },
      model: { type: "string", default: "gpt-4o-mini" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Family Activity Curator - Curates family activities

Usage:
  skills run family-activity-curator -- [options] <profile>

Options:
  --text <string>      Family profile (or use positional arg)
  --group <string>     Group size/type
  --ages <string>      Age range
  --setting <string>   Setting (indoor, outdoor, etc.)
  --duration <string>  Duration
  --format <fmt>       Output format: markdown, json (default: markdown)
  --model <model>      OpenAI model to use (default: gpt-4o-mini)
  --output <path>      Save report to file
  --help, -h           Show this help
`);
    process.exit(0);
  }

  let profile = values.text || "";
  let template: FamilyTemplate | undefined;

  if (!profile && positionals[0]) {
    const filePath = resolve(positionals[0]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      template = parseJsonTemplate(content);
      profile = template ? "" : content;
    } else {
      profile = positionals.join(" ");
    }
  }

  if (!profile.trim() && !template) {
    throw new Error("Provide family details via positional text, file path, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  return {
    profile,
    group: values.group as string,
    ages: values.ages as string,
    setting: values.setting as string,
    duration: values.duration as string,
    format,
    model: values.model as string,
    output: values.output as string,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a creative family activity coordinator. Suggest inclusive, age-appropriate experiences with clear instructions, supply lists, and adaptations for different abilities. Avoid unsafe recommendations and encourage adult supervision when needed.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: overview, activities, supply_list, prep_steps, adaptations, reflection_prompts. Each activity should include duration, difficulty, and sensory considerations."
      : "Respond in Markdown with sections for Overview, Activities, Supplies, Prep Steps, Adaptations, and Reflection Prompts. Use tables for supplies and bullet lists for steps.";

  const payload = {
    group: options.group || "family",
    ages: options.ages || "mixed ages",
    setting: options.setting || "mixed",
    duration: options.duration || "60 minutes",
    family_profile: options.profile.substring(0, 6000),
    structured_template: options.template,
  };

  const user = `${instructions}\n\nFamily context:\n${JSON.stringify(payload, null, 2)}`;

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

  const descriptorParts = [options.group || "family", options.setting || "mixed"];
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
    logger.info("Parsed family context and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed family activity prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received family activity set from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved activity plan to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
