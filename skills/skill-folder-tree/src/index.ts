#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import ignore from "ignore";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-folder-tree";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || path.join(process.cwd(), ".skills");
const LOGS_DIR = path.join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = path.join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// Types
interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  permissions?: string;
  children?: TreeNode[];
}

interface TreeOptions {
  format: "tree" | "json" | "markdown" | "csv";
  output: string;
  flat: boolean;
  include: string[];
  exclude: string[];
  useGitignore: boolean;
  hidden: boolean;
  dirsOnly: boolean;
  filesOnly: boolean;
  depth: number;
  maxFiles: number;
  showSize: boolean;
  showDate: boolean;
  showPermissions: boolean;
  showStats: boolean;
  fullPath: boolean;
  sort: "name" | "size" | "date" | "type";
  reverse: boolean;
  dirsFirst: boolean;
}

interface Stats {
  directories: number;
  files: number;
  totalSize: number;
  extensions: Record<string, number>;
}

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    format: { type: "string", default: "tree" },
    output: { type: "string", short: "o" },
    flat: { type: "boolean", default: false },
    include: { type: "string" },
    exclude: { type: "string" },
    gitignore: { type: "boolean", default: true },
    hidden: { type: "boolean", default: false },
    "dirs-only": { type: "boolean", default: false },
    "files-only": { type: "boolean", default: false },
    depth: { type: "string" },
    "max-files": { type: "string", default: "1000" },
    size: { type: "boolean", default: false },
    date: { type: "boolean", default: false },
    permissions: { type: "boolean", default: false },
    stats: { type: "boolean", default: false },
    "full-path": { type: "boolean", default: false },
    sort: { type: "string", default: "name" },
    reverse: { type: "boolean", default: false },
    "dirs-first": { type: "boolean", default: true },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

// Show help
if (values.help) {
  console.log(`
Folder Tree - Generate directory structure visualization

Usage:
  skills run folder-tree -- <directory> [options]

Format Options:
  --format <type>       Output: tree, json, markdown, csv (default: tree)
  -o, --output <path>   Output file path (default: stdout)
  --flat                Flat list instead of tree (JSON/CSV)

Filter Options:
  --include <pattern>   Include glob pattern (comma-separated)
  --exclude <pattern>   Exclude glob pattern (comma-separated)
  --gitignore           Respect .gitignore (default: true)
  --hidden              Include hidden files
  --dirs-only           Show directories only
  --files-only          Show files only

Depth Options:
  --depth <n>           Maximum depth (default: unlimited)
  --max-files <n>       Maximum files to show (default: 1000)

Display Options:
  --size                Show file sizes
  --date                Show modification dates
  --permissions         Show file permissions
  --stats               Show summary statistics
  --full-path           Show full paths

Sorting Options:
  --sort <by>           Sort: name, size, date, type (default: name)
  --reverse             Reverse sort order
  --dirs-first          Directories before files (default: true)

Examples:
  skills run folder-tree -- ./my-project
  skills run folder-tree -- ./src --format json -o structure.json
  skills run folder-tree -- . --format markdown --depth 3
  skills run folder-tree -- . --format csv --size --date
`);
  process.exit(0);
}

// Get input directory
const inputDir = positionals[0] || ".";

if (!fs.existsSync(inputDir)) {
  log(`Error: Directory not found: ${inputDir}`, "error");
  process.exit(1);
}

if (!fs.statSync(inputDir).isDirectory()) {
  log(`Error: Not a directory: ${inputDir}`, "error");
  process.exit(1);
}

// Build options
const options: TreeOptions = {
  format: values.format as TreeOptions["format"],
  output: (values.output as string) || "",
  flat: values.flat as boolean,
  include: values.include ? (values.include as string).split(",").map((p: string) => p.trim()) : [],
  exclude: values.exclude ? (values.exclude as string).split(",").map((p: string) => p.trim()) : [],
  useGitignore: values.gitignore as boolean,
  hidden: values.hidden as boolean,
  dirsOnly: values["dirs-only"] as boolean,
  filesOnly: values["files-only"] as boolean,
  depth: values.depth ? parseInt(values.depth as string) : Infinity,
  maxFiles: parseInt(values["max-files"] as string) || 1000,
  showSize: values.size as boolean,
  showDate: values.date as boolean,
  showPermissions: values.permissions as boolean,
  showStats: values.stats as boolean,
  fullPath: values["full-path"] as boolean,
  sort: values.sort as TreeOptions["sort"],
  reverse: values.reverse as boolean,
  dirsFirst: values["dirs-first"] as boolean,
};

// Load gitignore
let gitignoreFilter: ReturnType<typeof ignore> | null = null;
if (options.useGitignore) {
  const gitignorePath = path.join(inputDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    gitignoreFilter = ignore().add(gitignoreContent);
  }
}

// Statistics
const stats: Stats = {
  directories: 0,
  files: 0,
  totalSize: 0,
  extensions: {},
};

let fileCount = 0;

// Check if file matches patterns
function matchesPattern(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
      return regex.test(name);
    }
    return name === pattern || name.endsWith(pattern);
  });
}

// Check if path should be excluded
function shouldExclude(relativePath: string, name: string): boolean {
  // Hidden files
  if (!options.hidden && name.startsWith(".")) {
    return true;
  }

  // Gitignore
  if (gitignoreFilter && gitignoreFilter.ignores(relativePath)) {
    return true;
  }

  // Exclude patterns
  if (options.exclude.length > 0 && matchesPattern(name, options.exclude)) {
    return true;
  }

  return false;
}

// Check if file should be included
function shouldInclude(name: string, isDir: boolean): boolean {
  if (options.dirsOnly && !isDir) return false;
  if (options.filesOnly && isDir) return false;
  if (options.include.length > 0 && !isDir && !matchesPattern(name, options.include)) {
    return false;
  }
  return true;
}

// Get file info
function getFileInfo(filePath: string): { size: number; modified: string; permissions: string } {
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    modified: stat.mtime.toISOString().split("T")[0],
    permissions: (stat.mode & 0o777).toString(8),
  };
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Sort nodes
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    // Dirs first
    if (options.dirsFirst) {
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;
    }

    // Sort by criteria
    let comparison = 0;
    switch (options.sort) {
      case "size":
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case "date":
        comparison = (a.modified || "").localeCompare(b.modified || "");
        break;
      case "type":
        const extA = path.extname(a.name);
        const extB = path.extname(b.name);
        comparison = extA.localeCompare(extB);
        break;
      case "name":
      default:
        comparison = a.name.localeCompare(b.name);
    }

    return options.reverse ? -comparison : comparison;
  });

  return sorted;
}

// Build tree
function buildTree(dirPath: string, relativePath: string = "", currentDepth: number = 0): TreeNode | null {
  if (currentDepth > options.depth) return null;
  if (fileCount >= options.maxFiles) return null;

  const name = path.basename(dirPath) || dirPath;
  const stat = fs.statSync(dirPath);
  const isDir = stat.isDirectory();

  // Check exclusions
  if (relativePath && shouldExclude(relativePath, name)) {
    return null;
  }

  // Check inclusions
  if (!shouldInclude(name, isDir)) {
    return null;
  }

  const node: TreeNode = {
    name,
    path: options.fullPath ? dirPath : relativePath || name,
    type: isDir ? "directory" : "file",
  };

  if (options.showSize || options.sort === "size" || options.showStats) {
    node.size = stat.size;
  }
  if (options.showDate || options.sort === "date") {
    node.modified = stat.mtime.toISOString().split("T")[0];
  }
  if (options.showPermissions) {
    node.permissions = (stat.mode & 0o777).toString(8);
  }

  if (isDir) {
    stats.directories++;
    const children: TreeNode[] = [];

    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const entryRelative = relativePath ? `${relativePath}/${entry}` : entry;
        const childNode = buildTree(entryPath, entryRelative, currentDepth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }
    } catch (error) {
      // Permission denied or other error
    }

    node.children = sortNodes(children);

    // Calculate directory size
    if (options.showSize || options.showStats) {
      node.size = children.reduce((sum, child) => sum + (child.size || 0), 0);
    }
  } else {
    stats.files++;
    fileCount++;
    stats.totalSize += stat.size;

    const ext = path.extname(name) || "(no extension)";
    stats.extensions[ext] = (stats.extensions[ext] || 0) + 1;
  }

  return node;
}

// Flatten tree
function flattenTree(node: TreeNode, result: TreeNode[] = []): TreeNode[] {
  if (node.type === "file" || !node.children) {
    result.push({ ...node, children: undefined });
  } else {
    if (!options.filesOnly) {
      result.push({ ...node, children: undefined });
    }
    for (const child of node.children) {
      flattenTree(child, result);
    }
  }
  return result;
}

// Format as ASCII tree
function formatTree(node: TreeNode, prefix: string = "", isLast: boolean = true, isRoot: boolean = true): string {
  let output = "";

  if (isRoot) {
    output += node.name + "/\n";
  } else {
    const connector = isLast ? "└── " : "├── ";
    let line = prefix + connector + node.name;

    if (node.type === "directory") {
      line += "/";
    }

    // Add metadata
    const meta: string[] = [];
    if (options.showSize && node.size !== undefined) {
      meta.push(formatSize(node.size));
    }
    if (options.showDate && node.modified) {
      meta.push(node.modified);
    }
    if (options.showPermissions && node.permissions) {
      meta.push(node.permissions);
    }
    if (meta.length > 0) {
      line += "  (" + meta.join(", ") + ")";
    }

    output += line + "\n";
  }

  if (node.children) {
    const newPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childIsLast = i === node.children.length - 1;
      output += formatTree(child, newPrefix, childIsLast, false);
    }
  }

  return output;
}

// Format as JSON
function formatJson(node: TreeNode): string {
  if (options.flat) {
    const flattened = flattenTree(node);
    return JSON.stringify(flattened, null, 2);
  }
  return JSON.stringify(node, null, 2);
}

// Format as Markdown
function formatMarkdown(node: TreeNode, depth: number = 0): string {
  let output = "";

  if (depth === 0) {
    output += `# Directory Structure\n\n`;
    output += `## ${node.name}/\n\n`;
  }

  if (node.children) {
    for (const child of node.children) {
      const indent = "  ".repeat(depth);
      if (child.type === "directory") {
        output += `${indent}- **${child.name}/**\n`;
        output += formatMarkdown(child, depth + 1);
      } else {
        let line = `${indent}- \`${child.name}\``;
        if (options.showSize && child.size !== undefined) {
          line += ` (${formatSize(child.size)})`;
        }
        output += line + "\n";
      }
    }
  }

  return output;
}

// Format as CSV
function formatCsv(node: TreeNode): string {
  const headers = ["path", "type"];
  if (options.showSize) headers.push("size");
  if (options.showDate) headers.push("modified");
  if (options.showPermissions) headers.push("permissions");

  const flattened = flattenTree(node);
  const rows = flattened.map((n) => {
    const row = [n.path, n.type];
    if (options.showSize) row.push(String(n.size || 0));
    if (options.showDate) row.push(n.modified || "");
    if (options.showPermissions) row.push(n.permissions || "");
    return row.map((v) => `"${v}"`).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// Format statistics
function formatStats(): string {
  const sortedExts = Object.entries(stats.extensions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => `${ext} (${count})`)
    .join(", ");

  return `
Statistics:
  Directories: ${stats.directories}
  Files: ${stats.files}
  Total Size: ${formatSize(stats.totalSize)}
  Extensions: ${sortedExts}
`;
}

// Main execution
async function main(): Promise<void> {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");
  log(`Scanning: ${path.resolve(inputDir)}`, "debug");
  log(`Format: ${options.format}`, "debug");

  // Build tree
  const tree = buildTree(path.resolve(inputDir));

  if (!tree) {
    log("Error: Could not build tree", "error");
    process.exit(1);
  }

  // Format output
  let output: string;
  switch (options.format) {
    case "json":
      output = formatJson(tree);
      break;
    case "markdown":
      output = formatMarkdown(tree);
      break;
    case "csv":
      output = formatCsv(tree);
      break;
    case "tree":
    default:
      output = formatTree(tree);
  }

  // Add statistics
  if (options.showStats && options.format === "tree") {
    output += formatStats();
  }

  // Write output
  if (options.output) {
    const outputDir = path.dirname(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(options.output, output);
    log(`Output written to: ${options.output}`, "success");
  } else {
    console.log(output);
  }

  // Summary
  if (options.output || options.showStats) {
    log(`Directories: ${stats.directories}`, "info");
    log(`Files: ${stats.files}`, "info");
    log(`Total Size: ${formatSize(stats.totalSize)}`, "info");
    if (fileCount >= options.maxFiles) {
      log(`Note: Output truncated at ${options.maxFiles} files`, "warn");
    }
  }
}

main().catch((error) => {
  log(`Error: ${error.message}`, "error");
  process.exit(1);
});
