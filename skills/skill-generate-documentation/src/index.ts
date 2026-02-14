#!/usr/bin/env bun
/**
 * Generate Documentation Skill
 * Auto-generates JSDoc/TSDoc/Python docstrings from code using AI analysis
 *
 * Features:
 * - Multi-language support (TypeScript, JavaScript, Python)
 * - AI-powered analysis using Anthropic Claude or OpenAI
 * - Inline insertion or separate markdown output
 * - Batch processing of directories
 * - Intelligent type inference and parameter analysis
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, dirname, extname, basename, relative } from "path";
import { randomUUID } from "crypto";

// Types
type DocFormat = "jsdoc" | "tsdoc" | "python" | "auto";
type OutputMode = "inline" | string; // inline or file path
type ApiProvider = "anthropic" | "openai";

interface GenerateOptions {
  path: string;
  format: DocFormat;
  output: OutputMode;
  includeExamples: boolean;
  update: boolean;
  verbose: boolean;
  apiProvider: ApiProvider;
  model?: string;
}

interface CodeElement {
  type: "function" | "class" | "method" | "interface" | "type";
  name: string;
  code: string;
  startLine: number;
  endLine: number;
  hasExistingDoc: boolean;
  language: "typescript" | "javascript" | "python";
}

interface DocumentationResult {
  element: CodeElement;
  documentation: string;
  updated: boolean;
}

// Constants
const SKILL_NAME = "generate-documentation";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const BACKUPS_DIR = join(SKILLS_OUTPUT_DIR, "backups", SKILL_NAME);

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
function detectLanguage(filePath: string): "typescript" | "javascript" | "python" | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    default:
      return null;
  }
}

// Auto-detect format from language
function autoDetectFormat(language: "typescript" | "javascript" | "python"): DocFormat {
  switch (language) {
    case "typescript":
      return "tsdoc";
    case "javascript":
      return "jsdoc";
    case "python":
      return "python";
  }
}

// Parse TypeScript/JavaScript file to find code elements
function parseTypeScriptFile(content: string, filePath: string): CodeElement[] {
  const elements: CodeElement[] = [];
  const lines = content.split("\n");
  const language = detectLanguage(filePath) as "typescript" | "javascript";

  // Simple regex-based parsing (production version would use proper AST parsing)
  const functionRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
  const arrowFunctionRegex = /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/;
  const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
  const interfaceRegex = /^(?:export\s+)?interface\s+(\w+)/;
  const typeRegex = /^(?:export\s+)?type\s+(\w+)/;
  const methodRegex = /^\s+(?:async\s+)?(\w+)\s*\(/;

  let inClass = false;
  let classDepth = 0;
  let currentElement: Partial<CodeElement> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check for existing documentation
    const hasExistingDoc = i > 0 && lines[i - 1].trim().startsWith("/**");

    // Function
    const funcMatch = functionRegex.exec(trimmedLine);
    if (funcMatch) {
      const startLine = i;
      const endLine = findBlockEnd(lines, i);
      elements.push({
        type: "function",
        name: funcMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language,
      });
      continue;
    }

    // Arrow function
    const arrowMatch = arrowFunctionRegex.exec(trimmedLine);
    if (arrowMatch) {
      const startLine = i;
      const endLine = findBlockEnd(lines, i);
      elements.push({
        type: "function",
        name: arrowMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language,
      });
      continue;
    }

    // Class
    const classMatch = classRegex.exec(trimmedLine);
    if (classMatch) {
      const startLine = i;
      const endLine = findBlockEnd(lines, i);
      elements.push({
        type: "class",
        name: classMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language,
      });
      inClass = true;
      continue;
    }

    // Interface
    const interfaceMatch = interfaceRegex.exec(trimmedLine);
    if (interfaceMatch) {
      const startLine = i;
      const endLine = findBlockEnd(lines, i);
      elements.push({
        type: "interface",
        name: interfaceMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language,
      });
      continue;
    }

    // Type
    const typeMatch = typeRegex.exec(trimmedLine);
    if (typeMatch) {
      const startLine = i;
      // Types can be multi-line
      let endLine = i;
      if (trimmedLine.includes("{")) {
        endLine = findBlockEnd(lines, i);
      } else {
        while (endLine < lines.length - 1 && !lines[endLine].includes(";")) {
          endLine++;
        }
      }
      elements.push({
        type: "type",
        name: typeMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language,
      });
      continue;
    }

    // Method (inside class)
    if (inClass) {
      const methodMatch = methodRegex.exec(line);
      if (methodMatch && !trimmedLine.startsWith("//") && !trimmedLine.startsWith("*")) {
        const startLine = i;
        const endLine = findBlockEnd(lines, i);
        elements.push({
          type: "method",
          name: methodMatch[1],
          code: lines.slice(startLine, endLine + 1).join("\n"),
          startLine,
          endLine,
          hasExistingDoc,
          language,
        });
        continue;
      }
    }

    // Track class depth
    if (inClass) {
      if (trimmedLine.includes("{")) classDepth++;
      if (trimmedLine.includes("}")) {
        classDepth--;
        if (classDepth === 0) inClass = false;
      }
    }
  }

  return elements;
}

// Parse Python file to find code elements
function parsePythonFile(content: string): CodeElement[] {
  const elements: CodeElement[] = [];
  const lines = content.split("\n");

  const functionRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;
  const classRegex = /^class\s+(\w+)/;

  let inClass = false;
  let classIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const indent = line.length - line.trimLeft().length;

    // Check for existing docstring
    const hasExistingDoc = i < lines.length - 1 && lines[i + 1].trim().startsWith('"""');

    // Class
    const classMatch = classRegex.exec(trimmedLine);
    if (classMatch) {
      const startLine = i;
      const endLine = findPythonBlockEnd(lines, i);
      elements.push({
        type: "class",
        name: classMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language: "python",
      });
      inClass = true;
      classIndent = indent;
      continue;
    }

    // Function
    const funcMatch = functionRegex.exec(trimmedLine);
    if (funcMatch) {
      const startLine = i;
      const endLine = findPythonBlockEnd(lines, i);
      const isMethod = inClass && indent > classIndent;

      elements.push({
        type: isMethod ? "method" : "function",
        name: funcMatch[1],
        code: lines.slice(startLine, endLine + 1).join("\n"),
        startLine,
        endLine,
        hasExistingDoc,
        language: "python",
      });
      continue;
    }

    // Check if we've left the class
    if (inClass && indent <= classIndent && trimmedLine && !trimmedLine.startsWith("#")) {
      inClass = false;
    }
  }

  return elements;
}

// Find the end of a code block (TypeScript/JavaScript)
function findBlockEnd(lines: string[], startLine: number): number {
  let braceCount = 0;
  let inBlock = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === "{") {
        braceCount++;
        inBlock = true;
      } else if (char === "}") {
        braceCount--;
        if (inBlock && braceCount === 0) {
          return i;
        }
      }
    }

    // Single-line arrow function without braces
    if (i === startLine && line.includes("=>") && !line.includes("{")) {
      return i;
    }
  }

  return startLine;
}

// Find the end of a Python block
function findPythonBlockEnd(lines: string[], startLine: number): number {
  const startIndent = lines[startLine].length - lines[startLine].trimLeft().length;

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimLeft().length;

    // If we find a line at the same or lower indent level, we've reached the end
    if (indent <= startIndent) {
      return i - 1;
    }
  }

  return lines.length - 1;
}

// Generate documentation using AI
async function generateDocumentation(
  element: CodeElement,
  options: GenerateOptions
): Promise<string> {
  const apiKey = options.apiProvider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`${options.apiProvider.toUpperCase()}_API_KEY environment variable is not set`);
  }

  // Build prompt based on format and language
  const format = options.format === "auto" ? autoDetectFormat(element.language) : options.format;

  const prompt = buildDocumentationPrompt(element, format, options.includeExamples);

  if (options.verbose) {
    log(`Analyzing ${element.type} "${element.name}" in ${element.language}...`);
  }

  // Call AI API
  if (options.apiProvider === "anthropic") {
    return await callAnthropicAPI(prompt, apiKey, options.model || "claude-3-5-sonnet-20241022");
  } else {
    return await callOpenAIAPI(prompt, apiKey, options.model || "gpt-4-turbo");
  }
}

// Build documentation prompt
function buildDocumentationPrompt(element: CodeElement, format: DocFormat, includeExamples: boolean): string {
  let prompt = `You are a technical documentation expert. Generate ${format} documentation for the following ${element.language} ${element.type}.\n\n`;

  prompt += `Code:\n\`\`\`${element.language}\n${element.code}\n\`\`\`\n\n`;

  prompt += `Requirements:\n`;

  if (format === "jsdoc" || format === "tsdoc") {
    prompt += `- Use JSDoc/TSDoc format with /** */ comment block\n`;
    prompt += `- Include a clear description of what the ${element.type} does\n`;
    prompt += `- Document all @param tags with types and descriptions\n`;
    prompt += `- Include @returns tag with return type and description\n`;
    prompt += `- Add @throws tags for any errors that may be thrown\n`;

    if (format === "tsdoc") {
      prompt += `- Use TypeScript-specific features (generics, union types, etc.)\n`;
      prompt += `- Leverage type information from signatures\n`;
    }

    if (includeExamples) {
      prompt += `- Include an @example block with realistic usage example\n`;
      prompt += `- Show expected input and output in the example\n`;
    }
  } else if (format === "python") {
    prompt += `- Use Python docstring format (Google or NumPy style)\n`;
    prompt += `- Include a clear description of what the ${element.type} does\n`;
    prompt += `- Document all Args: with types and descriptions\n`;
    prompt += `- Include Returns: section with return type and description\n`;
    prompt += `- Add Raises: section for any exceptions\n`;

    if (includeExamples) {
      prompt += `- Include an Example: section with realistic usage\n`;
      prompt += `- Use doctest-compatible format for examples\n`;
    }
  }

  prompt += `\nGenerate ONLY the documentation comment block without any additional explanation or the code itself.`;

  return prompt;
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
      max_tokens: 2048,
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
      max_tokens: 2048,
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

// Process a single file
async function processFile(filePath: string, options: GenerateOptions): Promise<DocumentationResult[]> {
  log(`Processing file: ${filePath}`);

  const content = readFileSync(filePath, "utf-8");
  const language = detectLanguage(filePath);

  if (!language) {
    log(`Skipping unsupported file: ${filePath}`, "warn");
    return [];
  }

  // Parse file to find code elements
  const elements = language === "python"
    ? parsePythonFile(content)
    : parseTypeScriptFile(content, filePath);

  log(`Found ${elements.length} code element(s) in ${basename(filePath)}`);

  const results: DocumentationResult[] = [];

  // Generate documentation for each element
  for (const element of elements) {
    // Skip if already documented and not updating
    if (element.hasExistingDoc && !options.update) {
      if (options.verbose) {
        log(`Skipping ${element.name} (already documented)`, "info");
      }
      continue;
    }

    try {
      const documentation = await generateDocumentation(element, options);
      results.push({
        element,
        documentation,
        updated: element.hasExistingDoc,
      });

      log(`Generated documentation for ${element.name}`, "success");
    } catch (error) {
      log(`Failed to generate docs for ${element.name}: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    }
  }

  return results;
}

// Insert documentation into file
function insertDocumentation(filePath: string, results: DocumentationResult[]): void {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Create backup
  const backupDir = join(BACKUPS_DIR, SESSION_TIMESTAMP);
  ensureDir(backupDir);
  const backupPath = join(backupDir, basename(filePath));
  copyFileSync(filePath, backupPath);
  log(`Backed up to: ${backupPath}`);

  // Sort results by start line (descending) to avoid line number shifts
  const sortedResults = [...results].sort((a, b) => b.element.startLine - a.element.startLine);

  for (const result of sortedResults) {
    const { element, documentation } = result;

    // Find insertion point (before the code element)
    const insertLine = element.startLine;

    // Remove existing documentation if updating
    let startRemove = insertLine;
    if (element.hasExistingDoc) {
      // Find the start of the existing doc comment
      for (let i = insertLine - 1; i >= 0; i--) {
        if (lines[i].trim().startsWith("/**") || lines[i].trim().startsWith('"""')) {
          startRemove = i;
          break;
        }
      }
      // Remove old documentation
      const removeCount = insertLine - startRemove;
      lines.splice(startRemove, removeCount);
    }

    // Get indentation from the code line
    const codeLineIndent = element.code.split("\n")[0].match(/^\s*/)?.[0] || "";

    // Format documentation with proper indentation
    const docLines = documentation.split("\n").map(line => codeLineIndent + line);

    // Insert new documentation
    lines.splice(startRemove, 0, ...docLines);
  }

  // Write updated content
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  log(`Updated file: ${filePath}`, "success");
}

// Generate markdown documentation
function generateMarkdownDocs(allResults: Map<string, DocumentationResult[]>, outputPath: string): void {
  let markdown = `# API Documentation\n\n`;
  markdown += `Generated on ${new Date().toLocaleString()}\n\n`;

  for (const [filePath, results] of allResults.entries()) {
    if (results.length === 0) continue;

    markdown += `## ${filePath}\n\n`;

    for (const result of results) {
      const { element, documentation } = result;

      markdown += `### ${element.name}\n\n`;
      markdown += `**Type:** ${element.type}\n\n`;

      // Extract description from documentation
      const docLines = documentation.split("\n");
      const description = docLines
        .filter(line => !line.includes("@param") && !line.includes("@returns") && !line.includes("Args:") && !line.includes("Returns:"))
        .join("\n")
        .replace(/\/\*\*|\*\/|\*/g, "")
        .trim();

      if (description) {
        markdown += `${description}\n\n`;
      }

      // Show code signature
      const signature = element.code.split("\n")[0];
      markdown += `**Signature:**\n\`\`\`${element.language}\n${signature}\n\`\`\`\n\n`;

      markdown += `---\n\n`;
    }
  }

  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, markdown, "utf-8");
  log(`Generated markdown documentation: ${outputPath}`, "success");
}

// Collect all files from path (file or directory)
function collectFiles(path: string): string[] {
  const files: string[] = [];

  if (!existsSync(path)) {
    throw new Error(`Path not found: ${path}`);
  }

  const stat = statSync(path);

  if (stat.isFile()) {
    const language = detectLanguage(path);
    if (language) {
      files.push(path);
    }
  } else if (stat.isDirectory()) {
    const entries = readdirSync(path);
    for (const entry of entries) {
      const fullPath = join(path, entry);
      const entryStat = statSync(fullPath);

      if (entryStat.isDirectory()) {
        // Recurse into subdirectories
        files.push(...collectFiles(fullPath));
      } else if (entryStat.isFile()) {
        const language = detectLanguage(fullPath);
        if (language) {
          files.push(fullPath);
        }
      }
    }
  }

  return files;
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      format: { type: "string", default: "auto" },
      output: { type: "string", default: "inline" },
      "include-examples": { type: "boolean", default: false },
      update: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "api-provider": { type: "string", default: "anthropic" },
      model: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Generate Documentation - AI-powered code documentation generator

Usage:
  skills run generate-documentation -- <file-or-directory> [options]

Options:
  --format <format>           Documentation format (jsdoc, tsdoc, python, auto) [default: auto]
  --output <mode>             Output mode: "inline" or file path for markdown [default: inline]
  --include-examples          Generate usage examples [default: false]
  --update                    Update existing documentation [default: false]
  --verbose                   Show detailed analysis [default: false]
  --api-provider <provider>   AI provider (anthropic, openai) [default: anthropic]
  --model <model>             AI model to use [default: provider default]
  --help, -h                  Show this help

Examples:
  # Single file with inline documentation
  skills run generate-documentation -- ./src/utils.ts

  # Directory with examples
  skills run generate-documentation -- ./src --include-examples

  # Generate markdown output
  skills run generate-documentation -- ./lib --output ./docs/api.md

  # Python with specific provider
  skills run generate-documentation -- ./app.py --format python --api-provider openai
`);
    process.exit(0);
  }

  const path = positionals[0];

  if (!path) {
    log("Please provide a file or directory path", "error");
    process.exit(1);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    const options: GenerateOptions = {
      path,
      format: values.format as DocFormat,
      output: values.output as OutputMode,
      includeExamples: values["include-examples"] as boolean,
      update: values.update as boolean,
      verbose: values.verbose as boolean,
      apiProvider: values["api-provider"] as ApiProvider,
      model: values.model as string | undefined,
    };

    // Collect all files to process
    const files = collectFiles(path);
    log(`Found ${files.length} file(s) to process`);

    if (files.length === 0) {
      log("No supported files found", "warn");
      process.exit(0);
    }

    // Process all files
    const allResults = new Map<string, DocumentationResult[]>();
    let totalGenerated = 0;

    for (const file of files) {
      const results = await processFile(file, options);
      allResults.set(file, results);
      totalGenerated += results.length;

      // Insert documentation inline
      if (options.output === "inline" && results.length > 0) {
        insertDocumentation(file, results);
      }
    }

    // Generate markdown output if specified
    if (options.output !== "inline") {
      const outputPath = options.output.endsWith(".md")
        ? options.output
        : join(EXPORTS_DIR, `export_${SESSION_TIMESTAMP}_docs.md`);

      generateMarkdownDocs(allResults, outputPath);
    }

    console.log(`
Documentation generation complete!
  Files processed: ${files.length}
  Documentation generated: ${totalGenerated}
  Output: ${options.output === "inline" ? "Inline (files updated)" : options.output}
  Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}
`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
