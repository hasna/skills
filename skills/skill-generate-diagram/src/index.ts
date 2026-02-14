#!/usr/bin/env bun
/**
 * Diagram Generator Skill
 * Generate technical diagrams from natural language or code analysis
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, extname, basename } from "path";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Types
type DiagramType = "flowchart" | "sequence" | "class" | "er" | "state" | "architecture";
type OutputFormat = "mermaid" | "plantuml" | "ascii";
type Direction = "TB" | "LR" | "RL" | "BT";
type Theme = "default" | "dark" | "forest" | "neutral";

interface GenerateOptions {
  prompt: string;
  type?: DiagramType;
  format: OutputFormat;
  fromCode: boolean;
  output?: string;
  render: boolean;
  theme: Theme;
  direction: Direction;
  codePaths?: string[];
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Constants
const SKILL_NAME = "generate-diagram";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

// Generate slug from text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

// Read code files
function readCodeFiles(paths: string[]): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  for (const path of paths) {
    if (!existsSync(path)) {
      log(`Path not found: ${path}`, "error");
      continue;
    }

    const stat = statSync(path);

    if (stat.isDirectory()) {
      // Read all TypeScript/JavaScript files in directory
      const dirFiles = readdirSync(path);
      for (const file of dirFiles) {
        const filePath = join(path, file);
        const ext = extname(file);
        if ([".ts", ".tsx", ".js", ".jsx"].includes(ext) && statSync(filePath).isFile()) {
          files.push({
            path: filePath,
            content: readFileSync(filePath, "utf-8"),
          });
        }
      }
    } else if (stat.isFile()) {
      files.push({
        path,
        content: readFileSync(path, "utf-8"),
      });
    }
  }

  return files;
}

// Auto-detect diagram type from prompt
function detectDiagramType(prompt: string): DiagramType {
  const lower = prompt.toLowerCase();

  if (lower.includes("class") || lower.includes("inheritance") || lower.includes("extends")) {
    return "class";
  }
  if (lower.includes("sequence") || lower.includes("interaction") || lower.includes("api call")) {
    return "sequence";
  }
  if (lower.includes("database") || lower.includes("entity") || lower.includes("table") || lower.includes("schema")) {
    return "er";
  }
  if (lower.includes("state") || lower.includes("lifecycle") || lower.includes("transition")) {
    return "state";
  }
  if (lower.includes("architecture") || lower.includes("microservice") || lower.includes("system design") || lower.includes("component")) {
    return "architecture";
  }

  return "flowchart";
}

// Generate diagram using Anthropic API
async function generateDiagram(options: GenerateOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const diagramType = options.type || detectDiagramType(options.prompt);
  log(`Generating ${diagramType} diagram in ${options.format} format`);

  let systemPrompt = "";
  let userPrompt = "";

  // Build context from code if analyzing files
  let codeContext = "";
  if (options.fromCode && options.codePaths) {
    const files = readCodeFiles(options.codePaths);
    if (files.length === 0) {
      throw new Error("No code files found to analyze");
    }

    codeContext = files.map(f => `\n// File: ${f.path}\n${f.content}`).join("\n\n");
    log(`Analyzing ${files.length} code file(s)`);
  }

  // Build prompts based on format
  if (options.format === "mermaid") {
    systemPrompt = `You are an expert at creating Mermaid diagrams. Generate clean, well-structured Mermaid diagram code based on the user's description or code analysis.

Guidelines:
- Return ONLY the Mermaid diagram code, no explanations or markdown code blocks
- Use proper Mermaid syntax for the specified diagram type
- Make diagrams clear and readable
- Use meaningful node/entity names
- Add appropriate labels and descriptions
- Follow Mermaid best practices`;

    if (options.fromCode) {
      userPrompt = `Analyze this code and create a ${diagramType} diagram in Mermaid format:

${codeContext}

Additional context: ${options.prompt}

Direction: ${options.direction}
Theme: ${options.theme}

Return only the Mermaid diagram code.`;
    } else {
      userPrompt = `Create a ${diagramType} diagram in Mermaid format for:

${options.prompt}

Direction: ${options.direction}
Theme: ${options.theme}

Return only the Mermaid diagram code.`;
    }
  } else if (options.format === "plantuml") {
    systemPrompt = `You are an expert at creating PlantUML diagrams. Generate clean, well-structured PlantUML code based on the user's description or code analysis.

Guidelines:
- Return ONLY the PlantUML diagram code, no explanations or markdown code blocks
- Use proper PlantUML syntax for the specified diagram type
- Make diagrams clear and readable
- Use meaningful names
- Add appropriate labels and descriptions
- Follow PlantUML best practices`;

    if (options.fromCode) {
      userPrompt = `Analyze this code and create a ${diagramType} diagram in PlantUML format:

${codeContext}

Additional context: ${options.prompt}

Direction: ${options.direction}

Return only the PlantUML code.`;
    } else {
      userPrompt = `Create a ${diagramType} diagram in PlantUML format for:

${options.prompt}

Direction: ${options.direction}

Return only the PlantUML code.`;
    }
  } else {
    // ASCII
    systemPrompt = `You are an expert at creating ASCII art diagrams. Generate clean, well-structured ASCII diagrams based on the user's description or code analysis.

Guidelines:
- Return ONLY the ASCII diagram, no explanations
- Use box-drawing characters (─, │, ┌, ┐, └, ┘, ├, ┤, ┬, ┴, ┼)
- Make diagrams clear and aligned
- Use arrows (→, ←, ↑, ↓) for flow
- Keep it simple and readable in monospace font
- Maximum width of 80 characters`;

    if (options.fromCode) {
      userPrompt = `Analyze this code and create a ${diagramType} diagram in ASCII art format:

${codeContext}

Additional context: ${options.prompt}

Return only the ASCII diagram.`;
    } else {
      userPrompt = `Create a ${diagramType} diagram in ASCII art format for:

${options.prompt}

Return only the ASCII diagram.`;
    }
  }

  log(`Sending request to Anthropic API...`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data: AnthropicResponse = await response.json();

  if (!data.content?.[0]?.text) {
    throw new Error("No diagram code returned from Anthropic API");
  }

  const diagramCode = data.content[0].text.trim();
  log(`Diagram generated successfully (${data.usage.output_tokens} tokens)`, "success");

  return diagramCode;
}

// Validate diagram syntax
function validateDiagram(code: string, format: OutputFormat): { valid: boolean; error?: string } {
  if (format === "mermaid") {
    // Basic Mermaid validation
    if (!code.includes("graph") && !code.includes("flowchart") && !code.includes("sequenceDiagram") &&
        !code.includes("classDiagram") && !code.includes("erDiagram") && !code.includes("stateDiagram")) {
      return { valid: false, error: "Invalid Mermaid diagram: missing diagram type declaration" };
    }
  } else if (format === "plantuml") {
    // Basic PlantUML validation
    if (!code.includes("@startuml") || !code.includes("@enduml")) {
      return { valid: false, error: "Invalid PlantUML diagram: missing @startuml/@enduml tags" };
    }
  }

  return { valid: true };
}

// Check if mermaid-cli is installed
async function isMermaidCliInstalled(): Promise<boolean> {
  try {
    await execAsync("mmdc --version");
    return true;
  } catch {
    return false;
  }
}

// Render diagram to image using mermaid-cli
async function renderToImage(mermaidCode: string, outputPath: string, theme: Theme): Promise<void> {
  const hasMMDC = await isMermaidCliInstalled();

  if (!hasMMDC) {
    throw new Error("mermaid-cli (mmdc) is not installed. Install with: npm install -g @mermaid-js/mermaid-cli");
  }

  log(`Rendering diagram to image: ${outputPath}`);

  // Create temporary mermaid file
  const tempMmdFile = join(EXPORTS_DIR, `temp_${SESSION_ID}.mmd`);
  ensureDir(dirname(tempMmdFile));
  writeFileSync(tempMmdFile, mermaidCode);

  try {
    const ext = extname(outputPath).toLowerCase();
    const format = ext === ".svg" ? "svg" : "png";

    // Render using mermaid-cli
    await execAsync(`mmdc -i "${tempMmdFile}" -o "${outputPath}" -t ${theme} -b transparent`);

    log(`Image rendered successfully: ${outputPath}`, "success");
  } finally {
    // Clean up temp file
    if (existsSync(tempMmdFile)) {
      const fs = await import("fs/promises");
      await fs.unlink(tempMmdFile);
    }
  }
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      type: { type: "string" },
      format: { type: "string", default: "mermaid" },
      "from-code": { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      render: { type: "boolean", default: false },
      theme: { type: "string", default: "default" },
      direction: { type: "string", default: "TB" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Generate Diagram - Create technical diagrams from natural language or code

Usage:
  bun run src/index.ts <description> [options]
  bun run src/index.ts <code-path> --from-code [options]

Options:
  --type <type>           Diagram type: flowchart, sequence, class, er, state, architecture
  --format <format>       Output format: mermaid, plantuml, ascii [default: mermaid]
  --from-code             Analyze code files to generate diagram
  --output, -o <path>     Custom output path (.mmd, .puml, .txt, .png, .svg)
  --render                Render to image using mermaid-cli
  --theme <theme>         Visual theme: default, dark, forest, neutral [default: default]
  --direction <dir>       Diagram direction: TB, LR, RL, BT [default: TB]
  --help, -h              Show this help

Examples:
  bun run src/index.ts "User login flow with OAuth"
  bun run src/index.ts "API architecture" --type architecture --format mermaid
  bun run src/index.ts ./src/models --type class --from-code
  bun run src/index.ts "Database schema" --type er --output ./docs/db.png --render
`);
    process.exit(0);
  }

  const prompt = positionals.join(" ");

  if (!prompt) {
    log("Please provide a description or path", "error");
    process.exit(1);
  }

  // Validate options
  const format = values.format as OutputFormat;
  if (!["mermaid", "plantuml", "ascii"].includes(format)) {
    log(`Invalid format: ${format}. Use: mermaid, plantuml, or ascii`, "error");
    process.exit(1);
  }

  const diagramType = values.type as DiagramType | undefined;
  if (diagramType && !["flowchart", "sequence", "class", "er", "state", "architecture"].includes(diagramType)) {
    log(`Invalid diagram type: ${diagramType}`, "error");
    process.exit(1);
  }

  const theme = values.theme as Theme;
  const direction = values.direction as Direction;

  try {
    log(`Session ID: ${SESSION_ID}`);

    // Prepare options
    const options: GenerateOptions = {
      prompt,
      type: diagramType,
      format,
      fromCode: values["from-code"] as boolean,
      render: values.render as boolean,
      theme,
      direction,
      codePaths: values["from-code"] ? [prompt] : undefined,
    };

    // Generate diagram
    const diagramCode = await generateDiagram(options);

    // Validate diagram
    const validation = validateDiagram(diagramCode, format);
    if (!validation.valid) {
      log(`Diagram validation failed: ${validation.error}`, "error");
      log("Generated code may be invalid. Saving anyway...");
    }

    // Determine output path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
    const type = diagramType || detectDiagramType(prompt);
    const ext = format === "mermaid" ? "mmd" : format === "plantuml" ? "puml" : "txt";

    let outputPath = values.output as string;

    if (!outputPath) {
      const promptSlug = slugify(prompt);
      outputPath = join(EXPORTS_DIR, `export_${timestamp}_${type}.${ext}`);
    }

    // If render is requested and output doesn't specify image format, use .png
    if (values.render && format === "mermaid") {
      const outputExt = extname(outputPath).toLowerCase();
      if (![".png", ".svg"].includes(outputExt)) {
        outputPath = outputPath.replace(/\.[^.]+$/, "") + ".png";
      }
    }

    ensureDir(dirname(outputPath));

    // Save diagram code
    if (values.render && format === "mermaid") {
      // Render to image
      await renderToImage(diagramCode, outputPath, theme);

      // Also save the .mmd source
      const mmdPath = outputPath.replace(/\.(png|svg)$/, ".mmd");
      writeFileSync(mmdPath, diagramCode);
      log(`Source diagram saved to: ${mmdPath}`, "success");
    } else {
      // Save as text
      writeFileSync(outputPath, diagramCode);
      log(`Diagram saved to: ${outputPath}`, "success");
    }

    console.log(`\n✨ Diagram generated successfully!`);
    console.log(`   📁 Output: ${outputPath}`);
    console.log(`   📊 Type: ${type}`);
    console.log(`   📝 Format: ${format}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

    if (format === "mermaid" && !values.render) {
      console.log(`\nTip: Add --render flag to generate PNG/SVG image`);
    }

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
