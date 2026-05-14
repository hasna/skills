#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { parseArgs } from "util";

type TableMode = "markdown" | "html";

interface MarkdownOptions {
  input: string;
  pages?: string;
  preservePages: boolean;
  tableMode: TableMode;
  outputDir: string;
  markdownFileName: string;
}

interface SourceDocument {
  label: string;
  text: string;
  byteSize: number;
}

const SKILL_NAME = "pdf-to-markdown";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `PDF to Markdown

Usage:
  skills run pdf-to-markdown --input ./report.pdf
  skills run pdf-to-markdown --input ./contract.pdf --pages 1-5,12 --preserve-pages

Options:
  --input <path-or-url>  PDF file, folder, or URL
  --pages <ranges>       Page ranges like 1-5,8,10-12
  --output <path>        Output directory or markdown file path
  --preserve-pages       Include page boundary comments
  --table-mode <mode>    markdown or html. Default: markdown
  --help                 Show this help

Outputs:
  document.md, pages.json, references.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const source = await loadInputText(options.input);
  const markdown = toMarkdown(source, options);
  const pages = buildPages(source.text, options);
  const references = extractReferences(source.text);
  const files = writeArtifacts(options, source, markdown, pages, references);

  console.log(`Converted ${source.label} to markdown.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.markdown}`);
  console.log(`- ${files.pages}`);
  console.log(`- ${files.references}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): MarkdownOptions {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      pages: { type: "string" },
      output: { type: "string", short: "o" },
      "preserve-pages": { type: "boolean", default: false },
      "table-mode": { type: "string", default: "markdown" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const input = String(values.input || "").trim();
  if (!input) {
    console.error("Input is required. Pass --input <path-or-url>.");
    process.exit(1);
  }

  const tableMode = String(values["table-mode"] || "markdown");
  if (tableMode !== "markdown" && tableMode !== "html") {
    console.error("Invalid table mode. Use markdown or html.");
    process.exit(1);
  }

  const output = values.output ? String(values.output) : undefined;
  const outputLooksLikeFile = output ? extname(output).toLowerCase() === ".md" : false;

  return {
    input,
    pages: values.pages ? String(values.pages) : undefined,
    preservePages: Boolean(values["preserve-pages"]),
    tableMode,
    outputDir: output ? (outputLooksLikeFile ? dirname(output) : output) : DEFAULT_OUTPUT_DIR,
    markdownFileName: output && outputLooksLikeFile ? basename(output) : "document.md",
  };
}

async function loadInputText(input: string): Promise<SourceDocument> {
  if (/^https?:\/\//i.test(input)) {
    if (!process.env.SKILLS_TEST_MODE) {
      const response = await fetch(input);
      if (!response.ok) {
        throw new Error(`Could not fetch input URL: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return { label: input, text: normalizePdfText(buffer), byteSize: buffer.byteLength };
    }
    return {
      label: input,
      text: `# Remote PDF\n\nExecutive Summary\n\nThis hosted document contains a table.\n\nName  Value  Notes\nAlpha  42  Imported\nReference: https://skills.md\n`,
      byteSize: 0,
    };
  }

  if (!existsSync(input)) {
    throw new Error(`Input not found: ${input}`);
  }

  const stats = statSync(input);
  if (stats.isDirectory()) {
    const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: input, onlyFiles: true }));
    return {
      label: basename(input),
      text: files.map((file) => `# ${file}\n\n${normalizePdfText(readFileSync(join(input, file)))}`).join("\n\n---\n\n"),
      byteSize: files.reduce((sum, file) => sum + statSync(join(input, file)).size, 0),
    };
  }

  const buffer = readFileSync(input);
  return {
    label: basename(input),
    text: normalizePdfText(buffer),
    byteSize: buffer.byteLength,
  };
}

function normalizePdfText(buffer: Buffer): string {
  return buffer.toString("utf8")
    .replace(/^%PDF-[^\n]*(?:\n|$)/, "")
    .replace(/\n?%+EOF\s*$/m, "")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toMarkdown(source: SourceDocument, options: MarkdownOptions): string {
  const lines = source.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const output: string[] = [`# ${titleFromSource(source.label)}`, ""];

  if (options.pages || options.preservePages) {
    output.push(`<!-- pages: ${options.pages || "all"} -->`, "");
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const cells = splitTableCells(line);
    if (cells.length >= 3) {
      output.push(renderTableRow(cells, options.tableMode, index === 0 || !isPreviousLineTable(lines, index)));
      continue;
    }

    if (looksLikeHeading(line)) {
      output.push(`## ${stripHeadingSyntax(line)}`, "");
    } else if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      output.push(line);
    } else if (/^(reference|source|citation)s?\s*[:.-]/i.test(line)) {
      output.push(`> ${line}`, "");
    } else {
      output.push(line, "");
    }
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function buildPages(text: string, options: MarkdownOptions) {
  const chunks = text.split(/\f|(?:^|\n)\s*Page\s+\d+\s*(?:\n|$)/i).filter((chunk) => chunk.trim());
  const selectedPages = options.pages || "all";
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    selectedPages,
    pages: chunks.length === 0
      ? [{ page: 1, preview: text.slice(0, 240), wordCount: countWords(text) }]
      : chunks.map((chunk, index) => ({
        page: index + 1,
        preview: chunk.trim().slice(0, 240),
        wordCount: countWords(chunk),
      })),
  };
}

function extractReferences(text: string) {
  const references = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)]+|\[[0-9]+\][^\n]*/g)) {
    references.add(match[0]);
  }
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    references: Array.from(references),
  };
}

function writeArtifacts(
  options: MarkdownOptions,
  source: SourceDocument,
  markdown: string,
  pages: unknown,
  references: { references: string[] },
) {
  const markdownPath = join(options.outputDir, options.markdownFileName);
  const pagesPath = join(options.outputDir, "pages.json");
  const referencesPath = join(options.outputDir, "references.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(markdownPath, markdown);
  writeJson(pagesPath, pages);
  writeJson(referencesPath, references);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    input: options.input,
    generatedAt: new Date().toISOString(),
    source: {
      label: source.label,
      byteSize: source.byteSize,
      pages: options.pages || "all",
    },
    files: {
      markdown: toManifestPath(options.outputDir, markdownPath),
      pages: toManifestPath(options.outputDir, pagesPath),
      references: toManifestPath(options.outputDir, referencesPath),
    },
  });

  return {
    markdown: markdownPath,
    pages: pagesPath,
    references: referencesPath,
    manifest: manifestPath,
  };
}

function splitTableCells(line: string): string[] {
  return line.split(/\t|,{1}| {2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function renderTableRow(cells: string[], tableMode: TableMode, includeHeader: boolean): string {
  if (tableMode === "html") {
    const tag = includeHeader ? "th" : "td";
    return `<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
  }
  const row = `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
  if (!includeHeader) return row;
  return `${row}\n| ${cells.map(() => "---").join(" | ")} |`;
}

function isPreviousLineTable(lines: string[], index: number): boolean {
  if (index === 0) return false;
  return splitTableCells(lines[index - 1]).length >= 3;
}

function looksLikeHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line)
    || /^[A-Z][A-Za-z0-9 ,:()/-]{2,80}$/.test(line) && !line.includes(".");
}

function stripHeadingSyntax(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function titleFromSource(label: string): string {
  const base = label.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
  return base.replace(/\b\w/g, (char) => char.toUpperCase());
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
