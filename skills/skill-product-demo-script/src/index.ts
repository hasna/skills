#!/usr/bin/env bun
/**
 * skill-product-demo-script
 * Generates structured product demo scripts using OpenAI.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

type OutputFormat = "markdown" | "json";

type StoryArc = "problem-solution" | "before-after" | "jobs-to-be-done";

type PresenterTone = "confident" | "friendly" | "energetic";

type DemoTemplate = {
  key_features?: Array<Record<string, unknown>>;
  audience_pains?: Array<Record<string, unknown>>;
  stories?: Array<Record<string, unknown>>;
  objections?: Array<Record<string, unknown>>;
  proof_points?: Array<Record<string, unknown>>;
  notes?: string;
};

interface SkillOptions {
  brief: string;
  audience?: string;
  duration?: string;
  storyArc: StoryArc;
  tone: PresenterTone;
  format: OutputFormat;
  model: string;
  output?: string;
  template?: DemoTemplate;
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

const SKILL_SLUG = "product-demo-script";

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
    .slice(0, 40) || "demo-script";
}

function parseJsonTemplate(content: string): DemoTemplate | undefined {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as DemoTemplate;
    }
  } catch (_error) {
    // treat as plain text if parsing fails
  }
  return undefined;
}

function showHelp(): void {
  console.log(`
skill-product-demo-script - Generate structured product demo scripts using AI

Usage:
  skills run product-demo-script -- <brief-file> [options]
  skills run product-demo-script -- --text "<product-brief>" [options]

Options:
  -h, --help               Show this help message
  --text <brief>           Inline product/demo brief
  --audience <type>        Target audience (default: executive audience)
  --duration <time>        Demo duration (default: 30 minutes)
  --story-arc <arc>        Narrative arc: problem-solution | before-after | jobs-to-be-done
  --tone <style>           Presenter tone: confident | friendly | energetic (default: confident)
  --format <type>          Output format: markdown | json (default: markdown)
  --model <model>          OpenAI model (default: gpt-4o-mini)
  --output <path>          Custom output file path

Output includes:
  - Executive summary
  - Agenda with time boxes
  - Detailed segments (talk track, features, proof points)
  - Objection handling
  - Visual recommendations
  - CTA close

Examples:
  skills run product-demo-script -- ./product-info.txt --duration "15 minutes" --tone "energetic"
  skills run product-demo-script -- --text "SaaS analytics platform" --story-arc "before-after"

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
      audience: { type: "string" },
      duration: { type: "string" },
      "story-arc": { type: "string", default: "problem-solution" },
      tone: { type: "string", default: "confident" },
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
  let template: DemoTemplate | undefined;

  if (!brief && positionals[0]) {
    const filePath = resolve(positionals[0]);
    const content = readFileSync(filePath, "utf-8");
    template = parseJsonTemplate(content);
    brief = template ? "" : content;
  }

  if (!brief.trim() && !template) {
    throw new Error("Provide demo inputs via file path, JSON template, or --text.");
  }

  const format: OutputFormat =
    values.format === "json" ? "json" : values.format === "markdown" ? "markdown" : "markdown";

  let storyArc: StoryArc = "problem-solution";
  if (values["story-arc"] === "problem-solution" || values["story-arc"] === "before-after" || values["story-arc"] === "jobs-to-be-done") {
    storyArc = values["story-arc"];
  }

  let tone: PresenterTone = "confident";
  if (values.tone === "confident" || values.tone === "friendly" || values.tone === "energetic") {
    tone = values.tone;
  }

  return {
    brief,
    audience: values.audience,
    duration: values.duration,
    storyArc,
    tone,
    format,
    model: values.model,
    output: values.output,
    template,
  };
}

function buildPrompt(options: SkillOptions) {
  const system = `You are a senior solutions consultant building a captivating product demo.
Design a narrative arc, align proof points with pains, script objection handling, and specify visuals.
Include transitions that reinforce value and end with a strong CTA.`;

  const instructions =
    options.format === "json"
      ? "Respond in JSON with keys: summary, agenda, segments, objections, visuals, cta. Each segment should include title, objective, talk_track, feature_callout, proof_point, time_allocation." 
      : "Respond in polished Markdown. Start with an executive summary, outline agenda with time boxes, detail segments (talk track, feature, proof, customer story), objection handling table, recommended visuals, and CTA close.";

  const payload = {
    audience: options.audience || "executive audience",
    duration: options.duration || "30 minutes",
    story_arc: options.storyArc,
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
    temperature: 0.39,
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

  const descriptorParts = [options.audience || "demo", options.storyArc];
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
    logger.info("Parsed demo brief and options.");

    const { system, user } = buildPrompt(options);
    logger.info("Constructed demo script prompt.");

    const content = await callOpenAI(options, system, user);
    logger.success("Received demo script from OpenAI.");

    const exportPath = buildExportPath(skillExportsDir, sessionStamp, options);
    await writeExport(exportPath, content);
    logger.success(`Saved demo script to ${exportPath}`);

    console.log("\nPreview:");
    preview(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

main();
