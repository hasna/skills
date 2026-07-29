#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

const VERSION = "0.1.0";

interface CliOptions {
  input?: string;
  output?: string;
  pages?: Set<number>;
  pagesLabel: string;
  preservePages: boolean;
  reflow: boolean;
  tables: boolean;
  keepRepeats: boolean;
  json: boolean;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfLine {
  text: string;
  size: number;
  y: number;
  left: number;
  right: number;
}

interface PdfPage {
  page: number;
  lines: PdfLine[];
}

interface Heading {
  level: number;
  text: string;
  page: number;
}

interface ConversionResult {
  input: string;
  totalPages: number;
  convertedPages: number[];
  headings: Heading[];
  droppedRepeats: string[];
  stats: {
    lines: number;
    paragraphs: number;
    bullets: number;
    tables: number;
    characters: number;
  };
  markdown: string;
}

/* ------------------------------------------------------------------ *
 * dependency loading
 * ------------------------------------------------------------------ */

type PdfParseFn = (data: Buffer, options?: Record<string, unknown>) => Promise<{
  numpages: number;
  numrender: number;
  info: Record<string, unknown> | null;
  text: string;
}>;

async function loadPdfParse(): Promise<PdfParseFn> {
  // The package entry point of pdf-parse@1.x bundles a debug harness in some
  // releases; the lib/ entry is the stable one. Fall back to the package root.
  for (const specifier of ["pdf-parse/lib/pdf-parse.js", "pdf-parse"]) {
    try {
      const mod = await import(specifier);
      const fn = (mod?.default ?? mod) as PdfParseFn;
      if (typeof fn === "function") return fn;
    } catch {
      /* try the next specifier */
    }
  }
  throw new Error("Missing dependency 'pdf-parse'. Run bun install in this skill directory.");
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`pdf-to-markdown v${VERSION}

USAGE:
  pdf-to-markdown --input <file.pdf> [options]

OPTIONS:
  -i, --input <path>     PDF file to convert (also accepted positionally)
  -o, --output <path>    Write markdown to a file (default: stdout)
  -p, --pages <ranges>   Page selection such as 1-5,8,12 (default: all pages)
      --preserve-pages   Emit <!-- page N --> boundary comments
      --no-reflow        Keep original hard line breaks instead of rejoining
                         wrapped paragraph lines
      --no-tables        Do not convert aligned columns into markdown tables
      --keep-repeats     Keep running headers/footers instead of stripping them
      --json             Print a JSON envelope (markdown + stats) instead of
                         raw markdown
      --help             Show this help message
      --version          Show the current version

EXAMPLES:
  pdf-to-markdown --input ./report.pdf
  pdf-to-markdown --input ./report.pdf --output ./report.md
  pdf-to-markdown --input ./contract.pdf --pages 1-5,12 --preserve-pages
`);
}

function parsePageRanges(value: string): { pages: Set<number>; label: string } {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;
    const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (start < 1 || end < start) throw new Error(`Invalid page range: ${chunk}`);
      for (let page = start; page <= end; page += 1) pages.add(page);
      continue;
    }
    const single = Number.parseInt(chunk, 10);
    if (!Number.isFinite(single) || single < 1 || String(single) !== chunk) {
      throw new Error(`Invalid page selection: ${chunk}`);
    }
    pages.add(single);
  }
  if (pages.size === 0) throw new Error("--pages did not select any page");
  return { pages, label: value };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pagesLabel: "all",
    preservePages: false,
    reflow: true,
    tables: true,
    keepRepeats: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--input":
      case "-i":
        options.input = argv[++i];
        break;
      case "--output":
      case "-o":
        options.output = argv[++i];
        break;
      case "--pages":
      case "-p": {
        const value = argv[++i];
        if (!value) throw new Error("--pages requires a value such as 1-5,8");
        const parsed = parsePageRanges(value);
        options.pages = parsed.pages;
        options.pagesLabel = parsed.label;
        break;
      }
      case "--preserve-pages":
        options.preservePages = true;
        break;
      case "--no-reflow":
        options.reflow = false;
        break;
      case "--no-tables":
        options.tables = false;
        break;
      case "--keep-repeats":
        options.keepRepeats = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (!options.input) {
          options.input = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.input) throw new Error("Missing required --input <file.pdf> argument");
  return options;
}

/* ------------------------------------------------------------------ *
 * PDF text layout extraction
 * ------------------------------------------------------------------ */

function buildLines(items: TextItem[]): PdfLine[] {
  const buckets: Array<{ y: number; items: TextItem[] }> = [];

  for (const item of items) {
    if (typeof item.str !== "string" || item.str.trim() === "") continue;
    const y = item.transform[5];
    const tolerance = Math.max(2, (item.height || 10) * 0.4);
    const bucket = buckets.find((candidate) => Math.abs(candidate.y - y) <= tolerance);
    if (bucket) {
      bucket.items.push(item);
      continue;
    }
    buckets.push({ y, items: [item] });
  }

  buckets.sort((a, b) => b.y - a.y);

  const lines: PdfLine[] = [];
  for (const bucket of buckets) {
    bucket.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = "";
    let cursor = 0;
    let size = 0;
    let first = true;
    let left = Number.POSITIVE_INFINITY;
    let right = 0;

    for (const item of bucket.items) {
      const x = item.transform[4];
      const charWidth = item.str.length > 0 ? item.width / item.str.length : 5;
      if (!first) {
        const gap = x - cursor;
        const spaces = charWidth > 0 ? Math.round(gap / charWidth) : 0;
        if (spaces > 0) text += " ".repeat(Math.min(spaces, 60));
      }
      text += item.str;
      cursor = x + item.width;
      size = Math.max(size, item.height || 0);
      left = Math.min(left, x);
      right = Math.max(right, cursor);
      first = false;
    }

    const trimmed = text.replace(/\s+$/u, "");
    if (trimmed.trim() === "") continue;
    lines.push({
      text: trimmed,
      size: Math.round(size * 2) / 2,
      y: bucket.y,
      left: Number.isFinite(left) ? left : 0,
      right,
    });
  }

  return lines;
}

async function extractPages(
  path: string,
  wanted?: Set<number>,
): Promise<{ pages: PdfPage[]; totalPages: number }> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(`Cannot read PDF: ${path}`);
  }
  if (!fileStat.isFile()) throw new Error(`Not a file: ${path}`);
  if (fileStat.size === 0) throw new Error(`PDF file is empty: ${path}`);

  const buffer = await readFile(path);
  if (!buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    throw new Error(`Not a PDF file (missing %PDF header): ${path}`);
  }

  const pdfParse = await loadPdfParse();
  const pages: PdfPage[] = [];
  let counter = 0;
  const maxWanted = wanted ? Math.max(...wanted) : 0;

  const pagerender = (pageData: {
    pageIndex?: number;
    getTextContent: (options: Record<string, unknown>) => Promise<{ items: TextItem[] }>;
  }): Promise<string> => {
    const pageNumber = typeof pageData.pageIndex === "number" ? pageData.pageIndex + 1 : ++counter;
    if (wanted && !wanted.has(pageNumber)) return Promise.resolve("");
    return pageData
      .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then((content) => {
        pages.push({ page: pageNumber, lines: buildLines(content.items ?? []) });
        return "";
      });
  };

  let parsed;
  try {
    parsed = await pdfParse(buffer, { pagerender, max: maxWanted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse PDF (${path}): ${message}`);
  }

  pages.sort((a, b) => a.page - b.page);
  if (pages.length === 0) {
    throw new Error(`No extractable text found in ${path} (scanned or image-only PDF?)`);
  }

  return { pages, totalPages: parsed.numpages };
}

/* ------------------------------------------------------------------ *
 * markdown conversion
 * ------------------------------------------------------------------ */

function normalizeRepeat(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, " ").replace(/\d+/gu, "#");
}

function findRepeatedLines(pages: PdfPage[]): Set<string> {
  const repeats = new Set<string>();
  if (pages.length < 2) return repeats;

  const counts = new Map<string, number>();
  for (const page of pages) {
    const edge = new Set<string>();
    const total = page.lines.length;
    page.lines.forEach((line, index) => {
      if (index < 3 || index >= total - 3) edge.add(normalizeRepeat(line.text));
    });
    for (const key of edge) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of counts) {
    if (count >= 2 && count / pages.length > 0.5) repeats.add(key);
  }
  return repeats;
}

function isPageNumberLine(text: string): boolean {
  const value = text.trim();
  return /^\d{1,4}$/u.test(value) || /^page\s+\d+(\s*(of|\/)\s*\d+)?$/iu.test(value);
}

const BULLET_PATTERN = /^\s*([-*•‣▪●·o])\s+(?=\S)/u;
const ORDERED_PATTERN = /^\s*(\d{1,3})[.)]\s+(?=\S)/u;
const KEY_VALUE_PATTERN = /^([^:]{1,44}):\s+(\S.*)$/u;

/** A short `Label: value` line reads as a field, not as wrapped prose. */
function isFieldLine(text: string): boolean {
  if (text.length > 90) return false;
  const match = text.match(KEY_VALUE_PATTERN);
  if (!match) return false;
  const label = match[1].trim();
  return label.length > 0 && label.split(/\s+/u).length <= 6 && !/[.!?]$/u.test(label);
}

function isTitleish(text: string): boolean {
  const value = text.trim();
  if (value.length === 0 || value.length > 80) return false;
  if (/[.;,]$/u.test(value)) return false;
  const words = value.split(/\s+/u);
  if (words.length > 12) return false;
  const letters = value.replace(/[^A-Za-z]/gu, "");
  if (letters.length === 0) return false;
  if (value === value.toUpperCase() && letters.length >= 3) return true;
  const significant = words.filter((word) => word.length > 3);
  if (significant.length === 0) return false;
  const capitalized = significant.filter((word) => /^[A-Z0-9]/u.test(word));
  return capitalized.length / significant.length >= 0.6;
}

function splitColumns(text: string): string[] {
  return text
    .split(/\s{2,}/u)
    .map((cell) => cell.trim())
    .filter((cell, index, all) => !(cell === "" && (index === 0 || index === all.length - 1)));
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, "\\|");
}

interface Block {
  kind: "heading" | "paragraph" | "bullet" | "ordered" | "table";
  level?: number;
  text?: string;
  items?: string[];
  rows?: string[][];
  page: number;
}

function buildHeadingLevels(pages: PdfPage[]): { bodySize: number; levels: Map<number, number> } {
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      counts.set(line.size, (counts.get(line.size) ?? 0) + line.text.length);
    }
  }

  let bodySize = 0;
  let bodyWeight = -1;
  for (const [size, weight] of counts) {
    if (weight > bodyWeight) {
      bodyWeight = weight;
      bodySize = size;
    }
  }

  // A heading size must be both absolutely and relatively larger than body
  // text, and must stay a small share of the document (headings are rare).
  const totalWeight = [...counts.values()].reduce((sum, weight) => sum + weight, 0) || 1;
  const larger = [...counts.keys()]
    .filter((size) => size >= bodySize + 0.75 && size >= bodySize * 1.15)
    .filter((size) => (counts.get(size) ?? 0) / totalWeight < 0.3)
    .sort((a, b) => b - a);

  const levels = new Map<number, number>();
  larger.slice(0, 4).forEach((size, index) => levels.set(size, index + 1));
  return { bodySize, levels };
}

function medianGap(lines: PdfLine[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function pageToBlocks(page: PdfPage, options: CliOptions, headingLevels: Map<number, number>, bodySize: number): Block[] {
  const blocks: Block[] = [];
  const lines = page.lines;
  const typicalGap = medianGap(lines);
  const shapeLevel = Math.min(6, headingLevels.size + 1);
  const maxRight = lines.reduce((max, line) => Math.max(max, line.right), 0);

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let bulletKind: "bullet" | "ordered" | null = null;
  let tableRows: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(options.reflow ? " " : "\n"), page: page.page });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0 || !bulletKind) return;
    blocks.push({ kind: bulletKind, items: bullets, page: page.page });
    bullets = [];
    bulletKind = null;
  };
  const flushTable = () => {
    if (tableRows.length >= 2) {
      blocks.push({ kind: "table", rows: tableRows, page: page.page });
    } else if (tableRows.length === 1) {
      blocks.push({ kind: "paragraph", text: tableRows[0].join(" "), page: page.page });
    }
    tableRows = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushTable();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = lines[index - 1];
    const gap = previous ? previous.y - line.y : 0;
    const bigGap = typicalGap > 0 && gap > typicalGap * 1.6;
    const text = line.text.trim();

    const columns = options.tables ? splitColumns(line.text) : [];
    const looksTabular = columns.length >= 2 && /\s{3,}/u.test(line.text);

    if (looksTabular) {
      flushParagraph();
      flushBullets();
      if (tableRows.length > 0 && tableRows[0].length !== columns.length && Math.abs(tableRows[0].length - columns.length) > 1) {
        flushTable();
      }
      tableRows.push(columns);
      continue;
    }
    flushTable();

    const sizeLevel = headingLevels.get(line.size);
    const shapeHeading =
      !sizeLevel &&
      line.size <= bodySize + 0.25 &&
      isTitleish(text) &&
      (index === 0 || bigGap) &&
      !BULLET_PATTERN.test(line.text) &&
      !ORDERED_PATTERN.test(line.text);

    if (sizeLevel || shapeHeading) {
      flushAll();
      blocks.push({ kind: "heading", level: sizeLevel ?? shapeLevel, text, page: page.page });
      continue;
    }

    const bulletMatch = line.text.match(BULLET_PATTERN);
    if (bulletMatch) {
      flushParagraph();
      if (bulletKind && bulletKind !== "bullet") flushBullets();
      bulletKind = "bullet";
      bullets.push(line.text.replace(BULLET_PATTERN, "").trim());
      continue;
    }

    const orderedMatch = line.text.match(ORDERED_PATTERN);
    if (orderedMatch) {
      flushParagraph();
      if (bulletKind && bulletKind !== "ordered") flushBullets();
      bulletKind = "ordered";
      bullets.push(line.text.replace(ORDERED_PATTERN, "").trim());
      continue;
    }

    flushBullets();

    if (!options.reflow) {
      if (bigGap) flushParagraph();
      paragraph.push(text);
      continue;
    }

    if (isFieldLine(text)) {
      flushParagraph();
      blocks.push({ kind: "paragraph", text, page: page.page });
      continue;
    }

    const previousShort = previous ? previous.right < maxRight * 0.75 : false;
    const previousEnded = previous ? /[.!?:;"')\]]$/u.test(previous.text.trim()) : false;
    if (bigGap || (previousShort && previousEnded)) flushParagraph();
    paragraph.push(text);
  }

  flushAll();
  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  const chunks: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        chunks.push(`${"#".repeat(Math.min(6, block.level ?? 2))} ${block.text}`);
        break;
      case "paragraph":
        chunks.push(block.text ?? "");
        break;
      case "bullet":
        chunks.push((block.items ?? []).map((item) => `- ${item}`).join("\n"));
        break;
      case "ordered":
        chunks.push((block.items ?? []).map((item, index) => `${index + 1}. ${item}`).join("\n"));
        break;
      case "table": {
        const rows = block.rows ?? [];
        const width = Math.max(...rows.map((row) => row.length));
        const padded = rows.map((row) => {
          const copy = [...row];
          while (copy.length < width) copy.push("");
          return copy;
        });
        const [header, ...body] = padded;
        const lines = [
          `| ${header.map(escapeCell).join(" | ")} |`,
          `| ${header.map(() => "---").join(" | ")} |`,
          ...body.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
        ];
        chunks.push(lines.join("\n"));
        break;
      }
    }
  }
  return chunks.filter((chunk) => chunk.trim() !== "").join("\n\n");
}

function convert(pages: PdfPage[], totalPages: number, inputPath: string, options: CliOptions): ConversionResult {
  const repeats = options.keepRepeats ? new Set<string>() : findRepeatedLines(pages);
  const dropped = new Set<string>();

  const cleaned: PdfPage[] = pages.map((page) => {
    const total = page.lines.length;
    const lines = page.lines.filter((line, index) => {
      const atEdge = index < 3 || index >= total - 3;
      if (!atEdge) return true;
      if (!options.keepRepeats && isPageNumberLine(line.text)) {
        dropped.add(line.text.trim());
        return false;
      }
      if (repeats.has(normalizeRepeat(line.text))) {
        dropped.add(line.text.trim());
        return false;
      }
      return true;
    });
    return { page: page.page, lines };
  });

  const { bodySize, levels } = buildHeadingLevels(cleaned);

  const sections: string[] = [];
  const headings: Heading[] = [];
  const stats = { lines: 0, paragraphs: 0, bullets: 0, tables: 0, characters: 0 };

  for (const page of cleaned) {
    stats.lines += page.lines.length;
    const blocks = pageToBlocks(page, options, levels, bodySize);
    for (const block of blocks) {
      if (block.kind === "heading") headings.push({ level: block.level ?? 2, text: block.text ?? "", page: page.page });
      if (block.kind === "paragraph") stats.paragraphs += 1;
      if (block.kind === "bullet" || block.kind === "ordered") stats.bullets += (block.items ?? []).length;
      if (block.kind === "table") stats.tables += 1;
    }
    const body = renderBlocks(blocks);
    if (options.preservePages) {
      sections.push(`<!-- page ${page.page} -->${body ? `\n\n${body}` : ""}`);
    } else if (body) {
      sections.push(body);
    }
  }

  const markdown = `${sections.join("\n\n").replace(/\n{3,}/gu, "\n\n").trim()}\n`;
  stats.characters = markdown.length;

  return {
    input: inputPath,
    totalPages,
    convertedPages: cleaned.map((page) => page.page),
    headings,
    droppedRepeats: [...dropped],
    stats,
    markdown,
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input!);
  const { pages, totalPages } = await extractPages(inputPath, options.pages);
  const result = convert(pages, totalPages, inputPath, options);

  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.markdown, "utf8");
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ...result, output: outputPath }, null, 2)}\n`);
      return;
    }
    console.log(
      `pdf-to-markdown: wrote ${outputPath} (${result.convertedPages.length}/${result.totalPages} pages, ` +
        `${result.headings.length} headings, ${result.stats.tables} tables, ${result.stats.characters} chars)`,
    );
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(result.markdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`pdf-to-markdown: ${message}\n`);
  process.exit(1);
});
