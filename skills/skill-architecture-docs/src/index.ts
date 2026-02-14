#!/usr/bin/env bun
/**
 * Architecture Documentation Generator Skill
 * Analyzes codebases and generates comprehensive architecture documentation
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, extname, basename, relative } from "path";
import { randomUUID } from "crypto";

// Types
type OutputFormat = "markdown" | "json" | "html";
type AnalysisDepth = "basic" | "detailed" | "comprehensive";
type ApiProvider = "anthropic" | "openai";

interface ArchitectureOptions {
  path: string;
  format: OutputFormat;
  output: string;
  depth: AnalysisDepth;
  includeDiagrams: boolean;
  analyzeDependencies: boolean;
  apiProvider: ApiProvider;
  model?: string;
  verbose: boolean;
}

interface FileInfo {
  path: string;
  type: string;
  lines: number;
  language: string | null;
}

interface ComponentInfo {
  name: string;
  type: string;
  path: string;
  dependencies: string[];
  exports: string[];
  description?: string;
}

interface ArchitectureAnalysis {
  overview: string;
  components: ComponentInfo[];
  techStack: string[];
  patterns: string[];
  dataFlow: string;
  dependencies: {
    internal: string[];
    external: string[];
  };
  diagram?: string;
}

// =============================================================================
// Security: HTML Escaping to prevent XSS
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Constants
const SKILL_NAME = "architecture-docs";
const SESSION_ID = randomUUID().slice(0, 8);

const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "Error" : level === "success" ? "Success" : level === "warn" ? "Warning" : "Info";
  console.log(`[${prefix}] ${message}`);
}

// Detect language from file extension
function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
  };
  return languageMap[ext] || null;
}

// Scan directory and collect file information
function scanDirectory(path: string): FileInfo[] {
  const files: FileInfo[] = [];

  if (!existsSync(path)) {
    throw new Error(`Path not found: ${path}`);
  }

  const stat = statSync(path);

  if (stat.isFile()) {
    const language = detectLanguage(path);
    if (language) {
      const content = readFileSync(path, "utf-8");
      files.push({
        path,
        type: "file",
        lines: content.split("\n").length,
        language,
      });
    }
  } else if (stat.isDirectory()) {
    const entries = readdirSync(path);
    for (const entry of entries) {
      // Skip common ignored directories
      if (["node_modules", ".git", "dist", "build", ".next"].includes(entry)) {
        continue;
      }

      const fullPath = join(path, entry);
      try {
        const entryStat = statSync(fullPath);

        if (entryStat.isDirectory()) {
          files.push(...scanDirectory(fullPath));
        } else if (entryStat.isFile()) {
          const language = detectLanguage(fullPath);
          if (language) {
            const content = readFileSync(fullPath, "utf-8");
            files.push({
              path: fullPath,
              type: "file",
              lines: content.split("\n").length,
              language,
            });
          }
        }
      } catch (error) {
        // Skip files we can't read
        continue;
      }
    }
  }

  return files;
}

// Analyze codebase structure
function analyzeCodebase(files: FileInfo[], options: ArchitectureOptions): string {
  const filesByLanguage = files.reduce((acc, file) => {
    if (file.language) {
      acc[file.language] = (acc[file.language] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const totalLines = files.reduce((sum, file) => sum + file.lines, 0);

  let analysis = `# Codebase Analysis\n\n`;
  analysis += `- Total Files: ${files.length}\n`;
  analysis += `- Total Lines: ${totalLines}\n`;
  analysis += `- Languages:\n`;

  for (const [lang, count] of Object.entries(filesByLanguage)) {
    analysis += `  - ${lang}: ${count} files\n`;
  }

  return analysis;
}

// Extract dependencies from package.json
function extractDependencies(basePath: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];

  const packageJsonPath = join(basePath, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    if (packageJson.dependencies) {
      external.push(...Object.keys(packageJson.dependencies));
    }

    if (packageJson.devDependencies) {
      external.push(...Object.keys(packageJson.devDependencies));
    }
  }

  return { internal, external };
}

// Generate architecture analysis using AI
async function generateArchitectureAnalysis(
  files: FileInfo[],
  options: ArchitectureOptions,
  codebaseAnalysis: string
): Promise<ArchitectureAnalysis> {
  const apiKey = options.apiProvider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`${options.apiProvider.toUpperCase()}_API_KEY environment variable is not set`);
  }

  const prompt = buildAnalysisPrompt(files, options, codebaseAnalysis);

  if (options.verbose) {
    log("Analyzing architecture with AI...");
  }

  let analysisText: string;
  if (options.apiProvider === "anthropic") {
    analysisText = await callAnthropicAPI(prompt, apiKey, options.model || "claude-3-5-sonnet-20241022");
  } else {
    analysisText = await callOpenAIAPI(prompt, apiKey, options.model || "gpt-4-turbo");
  }

  // Parse the AI response into structured format
  const dependencies = extractDependencies(options.path);

  return {
    overview: analysisText,
    components: [],
    techStack: [],
    patterns: [],
    dataFlow: "See overview for data flow analysis",
    dependencies,
    diagram: options.includeDiagrams ? generateMermaidDiagram(files) : undefined,
  };
}

// Build analysis prompt
function buildAnalysisPrompt(files: FileInfo[], options: ArchitectureOptions, codebaseAnalysis: string): string {
  let prompt = `You are a software architecture expert. Analyze the following codebase and generate comprehensive architecture documentation.\n\n`;

  prompt += `Codebase Statistics:\n${codebaseAnalysis}\n\n`;

  prompt += `Analysis Depth: ${options.depth}\n\n`;

  prompt += `Please provide:\n`;
  prompt += `1. System Overview - High-level description of the architecture\n`;
  prompt += `2. Key Components - Main components and their responsibilities\n`;
  prompt += `3. Technology Stack - Technologies, frameworks, and libraries used\n`;
  prompt += `4. Design Patterns - Architectural and design patterns identified\n`;
  prompt += `5. Data Flow - How data flows through the system\n`;

  if (options.depth === "comprehensive") {
    prompt += `6. API Endpoints - If applicable\n`;
    prompt += `7. Database Schema - If applicable\n`;
    prompt += `8. Security Considerations - Security measures implemented\n`;
  }

  prompt += `\nGenerate structured markdown documentation that is clear, comprehensive, and well-organized.`;

  return prompt;
}

// Generate Mermaid diagram
function generateMermaidDiagram(files: FileInfo[]): string {
  const languages = [...new Set(files.map(f => f.language).filter(Boolean))];

  let diagram = "```mermaid\ngraph TD\n";
  diagram += "  A[Application] --> B[Frontend]\n";
  diagram += "  A --> C[Backend]\n";
  diagram += "  C --> D[Database]\n";

  if (languages.includes("typescript") || languages.includes("javascript")) {
    diagram += "  B --> E[Components]\n";
    diagram += "  B --> F[Services]\n";
  }

  diagram += "```\n";

  return diagram;
}

// Call Anthropic API
async function callAnthropicAPI(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: prompt,
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

// Call OpenAI API
async function callOpenAIAPI(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: prompt,
      }],
      max_tokens: 4096,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// Generate markdown output
function generateMarkdownOutput(analysis: ArchitectureAnalysis, options: ArchitectureOptions): string {
  let markdown = `# Architecture Documentation\n\n`;
  markdown += `Generated on ${new Date().toLocaleString()}\n\n`;

  markdown += `## Overview\n\n${analysis.overview}\n\n`;

  if (analysis.diagram && options.includeDiagrams) {
    markdown += `## System Diagram\n\n${analysis.diagram}\n\n`;
  }

  if (options.analyzeDependencies) {
    markdown += `## Dependencies\n\n`;
    markdown += `### External Dependencies\n\n`;
    if (analysis.dependencies.external.length > 0) {
      analysis.dependencies.external.forEach(dep => {
        markdown += `- ${dep}\n`;
      });
    } else {
      markdown += `No external dependencies found.\n`;
    }
    markdown += `\n`;
  }

  markdown += `## Data Flow\n\n${analysis.dataFlow}\n\n`;

  return markdown;
}

// Generate JSON output
function generateJSONOutput(analysis: ArchitectureAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}

// Generate HTML output
function generateHTMLOutput(analysis: ArchitectureAnalysis): string {
  const markdown = generateMarkdownOutput(analysis, {
    format: "html",
    includeDiagrams: true,
    analyzeDependencies: true,
  } as ArchitectureOptions);

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Architecture Documentation</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    pre { background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`;
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      format: { type: "string", default: "markdown" },
      output: { type: "string", default: "./ARCHITECTURE.md" },
      depth: { type: "string", default: "detailed" },
      "include-diagrams": { type: "boolean", default: true },
      "analyze-dependencies": { type: "boolean", default: true },
      "api-provider": { type: "string", default: "anthropic" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Architecture Documentation Generator

Usage:
  skills run architecture-docs -- <path> [options]

Options:
  --format <format>              Output format (markdown, json, html) [default: markdown]
  --output <path>                Output file path [default: ./ARCHITECTURE.md]
  --depth <depth>                Analysis depth (basic, detailed, comprehensive) [default: detailed]
  --include-diagrams             Generate mermaid diagrams [default: true]
  --analyze-dependencies         Include dependency analysis [default: true]
  --api-provider <provider>      AI provider (anthropic, openai) [default: anthropic]
  --model <model>                AI model to use [default: provider default]
  --verbose                      Show detailed logging [default: false]
  --help, -h                     Show this help

Examples:
  skills run architecture-docs -- .
  skills run architecture-docs -- ./src --format json --output ./docs/arch.json
  skills run architecture-docs -- ./src --depth comprehensive
`);
    process.exit(0);
  }

  const path = positionals[0] || ".";

  try {
    log(`Session ID: ${SESSION_ID}`);

    const options: ArchitectureOptions = {
      path,
      format: values.format as OutputFormat,
      output: values.output as string,
      depth: values.depth as AnalysisDepth,
      includeDiagrams: values["include-diagrams"] as boolean,
      analyzeDependencies: values["analyze-dependencies"] as boolean,
      apiProvider: values["api-provider"] as ApiProvider,
      model: values.model as string | undefined,
      verbose: values.verbose as boolean,
    };

    log(`Scanning directory: ${path}`);
    const files = scanDirectory(path);
    log(`Found ${files.length} files to analyze`);

    if (files.length === 0) {
      log("No supported files found", "warn");
      process.exit(0);
    }

    const codebaseAnalysis = analyzeCodebase(files, options);

    log("Generating architecture documentation...");
    const analysis = await generateArchitectureAnalysis(files, options, codebaseAnalysis);

    let output: string;
    let extension: string;

    switch (options.format) {
      case "json":
        output = generateJSONOutput(analysis);
        extension = ".json";
        break;
      case "html":
        output = generateHTMLOutput(analysis);
        extension = ".html";
        break;
      default:
        output = generateMarkdownOutput(analysis, options);
        extension = ".md";
    }

    const outputPath = options.output.endsWith(extension)
      ? options.output
      : options.output.replace(/\.[^/.]+$/, "") + extension;

    ensureDir(dirname(outputPath));
    writeFileSync(outputPath, output, "utf-8");

    log(`Documentation generated: ${outputPath}`, "success");

    console.log(`
Architecture documentation complete!
  Files analyzed: ${files.length}
  Output: ${outputPath}
  Format: ${options.format}
  Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}
`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
