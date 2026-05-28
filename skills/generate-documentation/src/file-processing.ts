import { basename, dirname, join } from "path";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { generateDocumentation } from "./ai";
import { detectLanguage, parsePythonFile, parseTypeScriptFile } from "./code-parser";
import { BACKUPS_DIR, SESSION_TIMESTAMP, ensureDir, log } from "./runtime";
import type { DocumentationResult, GenerateOptions } from "./types";

// Process a single file
export async function processFile(filePath: string, options: GenerateOptions): Promise<DocumentationResult[]> {
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
export function insertDocumentation(filePath: string, results: DocumentationResult[]): void {
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
export function generateMarkdownDocs(allResults: Map<string, DocumentationResult[]>, outputPath: string): void {
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
export function collectFiles(path: string): string[] {
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
