import { extname } from "path";
import type { CodeElement, DocFormat } from "./types";

// Detect language from file extension
export function detectLanguage(filePath: string): "typescript" | "javascript" | "python" | null {
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
export function autoDetectFormat(language: "typescript" | "javascript" | "python"): DocFormat {
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
export function parseTypeScriptFile(content: string, filePath: string): CodeElement[] {
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
export function parsePythonFile(content: string): CodeElement[] {
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
