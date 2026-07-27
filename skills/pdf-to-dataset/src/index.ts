#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";

const VERSION = "0.1.0";

type Mode = "tables" | "forms" | "auto";
type ColumnType = "string" | "number" | "date" | "empty";

interface CliOptions {
  input?: string;
  output: string;
  mode: Mode;
  pages?: Set<number>;
  minRows: number;
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
}

interface PdfPage {
  page: number;
  lines: PdfLine[];
}

interface TableColumn {
  name: string;
  type: ColumnType;
  nonEmpty: number;
  samples: string[];
}

interface ExtractedTable {
  id: string;
  page: number;
  headerDetected: boolean;
  columns: TableColumn[];
  rows: Array<Record<string, string>>;
  confidence: number;
  notes: string[];
}

interface ExtractedForm {
  page: number;
  fields: Record<string, string>;
  fieldCount: number;
}

interface Report {
  input: string;
  mode: Mode;
  chosenMode: "tables" | "forms";
  totalPages: number;
  scannedPages: number[];
  tables: ExtractedTable[];
  forms: ExtractedForm[];
  records: Array<Record<string, string>>;
  primaryTableId: string | null;
  outputDir: string;
  files: string[];
}

/* ------------------------------------------------------------------ *
 * dependency loading
 * ------------------------------------------------------------------ */

type PdfParseFn = (data: Buffer, options?: Record<string, unknown>) => Promise<{
  numpages: number;
  text: string;
}>;

async function loadPdfParse(): Promise<PdfParseFn> {
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

type StringifyFn = (rows: Array<Record<string, string>>, options: { header: boolean; columns: string[] }) => string;

async function loadCsvStringify(): Promise<StringifyFn> {
  try {
    return (await import("csv-stringify/sync")).stringify as unknown as StringifyFn;
  } catch {
    throw new Error("Missing dependency 'csv-stringify'. Run bun install in this skill directory.");
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`pdf-to-dataset v${VERSION}

USAGE:
  pdf-to-dataset --input <file.pdf> [options]

OPTIONS:
  -i, --input <path>     PDF file to extract (also accepted positionally)
  -o, --output <dir>     Output directory (default: ./pdf-dataset)
  -m, --mode <mode>      tables | forms | auto (default: auto)
  -p, --pages <ranges>   Page selection such as 1-3,8 (default: all pages)
      --min-rows <n>     Minimum data rows for a table block (default: 2)
      --json             Print the extraction report as JSON on stdout
      --help             Show this help message
      --version          Show the current version

OUTPUT FILES:
  dataset.json           All tables/forms plus the flattened record list
  dataset.csv            The primary (largest) table, or one row per form page
  schema.json            Inferred column names and types (string|number|date)
  extraction-report.md   Per-page findings with confidence notes

EXAMPLES:
  pdf-to-dataset --input ./report.pdf
  pdf-to-dataset --input ./invoice.pdf --mode forms --output ./exports/invoice
  pdf-to-dataset --input ./report.pdf --mode tables --pages 2-4 --json
`);
}

function parsePageRanges(value: string): Set<number> {
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
  return pages;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "./pdf-dataset",
    mode: "auto",
    minRows: 2,
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
        options.output = argv[++i] ?? options.output;
        break;
      case "--mode":
      case "-m": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "tables" && value !== "forms" && value !== "auto") {
          throw new Error(`Invalid --mode value: ${value || "(empty)"} (expected tables, forms, or auto)`);
        }
        options.mode = value;
        break;
      }
      case "--pages":
      case "-p": {
        const value = argv[++i];
        if (!value) throw new Error("--pages requires a value such as 1-3,8");
        options.pages = parsePageRanges(value);
        break;
      }
      case "--min-rows": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1) throw new Error(`Invalid --min-rows value: ${argv[i]}`);
        options.minRows = value;
        break;
      }
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
      first = false;
    }

    const trimmed = text.replace(/\s+$/u, "");
    if (trimmed.trim() === "") continue;
    lines.push({ text: trimmed, size: Math.round(size * 2) / 2, y: bucket.y });
  }

  return lines;
}

async function extractPages(path: string, wanted?: Set<number>): Promise<{ pages: PdfPage[]; totalPages: number }> {
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
 * value typing helpers
 * ------------------------------------------------------------------ */

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/u,
  /^\d{4}\/\d{2}\/\d{2}$/u,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/u,
  /^\d{1,2}-\d{1,2}-\d{2,4}$/u,
  /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/u,
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/u,
];

function isDateValue(value: string): boolean {
  const trimmed = value.trim();
  return DATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isNumberValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (isDateValue(trimmed)) return false;
  const normalized = trimmed
    .replace(/^\((.*)\)$/u, "-$1")
    .replace(/[$€£¥₹]/gu, "")
    .replace(/,/gu, "")
    .replace(/%$/u, "")
    .trim();
  if (normalized === "" || normalized === "-") return false;
  return Number.isFinite(Number(normalized));
}

function inferType(values: string[]): ColumnType {
  const filled = values.map((value) => value.trim()).filter((value) => value !== "");
  if (filled.length === 0) return "empty";
  if (filled.every(isDateValue)) return "date";
  if (filled.every(isNumberValue)) return "number";
  return "string";
}

function slugColumn(value: string, index: number, seen: Set<string>): string {
  const base =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || `column_${index + 1}`;
  let next = base;
  let suffix = 2;
  while (seen.has(next)) {
    next = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(next);
  return next;
}

/* ------------------------------------------------------------------ *
 * table extraction
 * ------------------------------------------------------------------ */

function splitColumns(text: string): string[] {
  return text.split(/\s{2,}/u).map((cell) => cell.trim()).filter((cell, index, all) => {
    if (cell !== "") return true;
    return index !== 0 && index !== all.length - 1;
  });
}

function looksTabular(text: string): boolean {
  return /\S\s{2,}\S/u.test(text) && splitColumns(text).length >= 2;
}

function extractTables(pages: PdfPage[], minRows: number): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  let counter = 0;

  for (const page of pages) {
    let block: string[][] = [];

    const flush = () => {
      if (block.length >= Math.max(2, minRows)) {
        const table = buildTable(block, page.page, ++counter);
        if (table) tables.push(table);
      }
      block = [];
    };

    for (const line of page.lines) {
      if (!looksTabular(line.text)) {
        flush();
        continue;
      }
      const columns = splitColumns(line.text);
      if (block.length > 0) {
        const width = block[0].length;
        // Allow one column of drift (missing trailing cell), otherwise start
        // a new block: the column layout changed.
        if (Math.abs(width - columns.length) > 1) flush();
      }
      block.push(columns);
    }
    flush();
  }

  return tables;
}

function buildTable(block: string[][], page: number, index: number): ExtractedTable | null {
  const width = Math.max(...block.map((row) => row.length));
  if (width < 2) return null;

  const padded = block.map((row) => {
    const copy = row.map((cell) => cell.trim());
    while (copy.length < width) copy.push("");
    return copy.slice(0, width);
  });

  const notes: string[] = [];
  const first = padded[0];
  const rest = padded.slice(1);

  const uniqueHeader = new Set(first.map((cell) => cell.toLowerCase())).size === first.length;
  const headerTextual = first.filter((cell) => cell !== "" && !isNumberValue(cell) && !isDateValue(cell)).length >= Math.ceil(width / 2);
  const bodyHasValues = rest.some((row) => row.some((cell) => isNumberValue(cell) || isDateValue(cell)));
  const headerDetected = rest.length > 0 && uniqueHeader && headerTextual && (bodyHasValues || rest.length >= 2);

  const seen = new Set<string>();
  const names = headerDetected
    ? first.map((cell, position) => slugColumn(cell, position, seen))
    : Array.from({ length: width }, (_, position) => slugColumn(`column_${position + 1}`, position, seen));

  const dataRows = headerDetected ? rest : padded;
  if (dataRows.length === 0) return null;

  const rows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, position) => {
      record[name] = row[position] ?? "";
    });
    return record;
  });

  const columns: TableColumn[] = names.map((name, position) => {
    const values = dataRows.map((row) => row[position] ?? "");
    const nonEmpty = values.filter((value) => value.trim() !== "").length;
    return {
      name,
      type: inferType(values),
      nonEmpty,
      samples: values.filter((value) => value.trim() !== "").slice(0, 3),
    };
  });

  if (!headerDetected) notes.push("No header row detected; columns were auto-named column_1..column_n.");
  const ragged = padded.filter((row) => row.filter((cell) => cell !== "").length !== width).length;
  if (ragged > 0) notes.push(`${ragged} of ${padded.length} rows had missing cells and were padded.`);

  const fillRate =
    columns.reduce((sum, column) => sum + column.nonEmpty, 0) / Math.max(1, columns.length * dataRows.length);
  const typedColumns = columns.filter((column) => column.type === "number" || column.type === "date").length;
  const confidence = Math.max(
    0.2,
    Math.min(
      0.9,
      0.3 +
        (headerDetected ? 0.2 : 0) +
        fillRate * 0.2 +
        (typedColumns / Math.max(1, columns.length)) * 0.1 +
        Math.min(0.1, dataRows.length / 50),
    ),
  );

  return {
    id: `table-${index}`,
    page,
    headerDetected,
    columns,
    rows,
    confidence: Math.round(confidence * 100) / 100,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * form extraction
 * ------------------------------------------------------------------ */

const FIELD_PATTERN = /^([^:]{1,48}?)\s*[::]\s+(\S.*)$/u;

function extractForms(pages: PdfPage[]): ExtractedForm[] {
  const forms: ExtractedForm[] = [];

  for (const page of pages) {
    const fields: Record<string, string> = {};
    const seen = new Set<string>();

    for (const line of page.lines) {
      // A line can carry several `Label: value` pairs separated by wide gaps.
      const segments = looksTabular(line.text) ? splitColumns(line.text) : [line.text];
      for (const segment of segments) {
        const match = segment.trim().match(FIELD_PATTERN);
        if (!match) continue;
        const label = match[1].trim();
        const value = match[2].trim();
        if (label === "" || value === "") continue;
        if (label.split(/\s+/u).length > 6) continue;
        if (/^https?$/iu.test(label)) continue;
        const key = slugColumn(label, Object.keys(fields).length, seen);
        fields[key] = value;
      }
    }

    const fieldCount = Object.keys(fields).length;
    if (fieldCount > 0) forms.push({ page: page.page, fields, fieldCount });
  }

  return forms;
}

/* ------------------------------------------------------------------ *
 * reporting + output
 * ------------------------------------------------------------------ */

function buildSchema(report: Report): Record<string, unknown> {
  if (report.chosenMode === "tables") {
    const primary = report.tables.find((table) => table.id === report.primaryTableId);
    return {
      source: report.input,
      mode: "tables",
      primaryTable: report.primaryTableId,
      columns: (primary?.columns ?? []).map((column) => ({
        name: column.name,
        type: column.type,
        nonEmpty: column.nonEmpty,
        samples: column.samples,
      })),
      tables: report.tables.map((table) => ({
        id: table.id,
        page: table.page,
        rowCount: table.rows.length,
        headerDetected: table.headerDetected,
        confidence: table.confidence,
        columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
      })),
    };
  }

  const keys = new Set<string>();
  for (const form of report.forms) for (const key of Object.keys(form.fields)) keys.add(key);
  return {
    source: report.input,
    mode: "forms",
    columns: [...keys].map((key) => {
      const values = report.forms.map((form) => form.fields[key] ?? "");
      return {
        name: key,
        type: inferType(values),
        nonEmpty: values.filter((value) => value.trim() !== "").length,
        samples: values.filter((value) => value.trim() !== "").slice(0, 3),
      };
    }),
  };
}

function buildMarkdownReport(report: Report): string {
  const lines: string[] = [];
  lines.push("# PDF Extraction Report", "");
  lines.push(`- Source: \`${report.input}\``);
  lines.push(`- Requested mode: \`${report.mode}\` (used: \`${report.chosenMode}\`)`);
  lines.push(`- Pages in document: ${report.totalPages}`);
  lines.push(`- Pages scanned: ${report.scannedPages.join(", ") || "none"}`);
  lines.push(`- Records extracted: ${report.records.length}`);
  lines.push("");

  lines.push("## Per-page findings", "");
  lines.push("| Page | Tables | Table rows | Form fields |");
  lines.push("|------|--------|------------|-------------|");
  for (const page of report.scannedPages) {
    const tables = report.tables.filter((table) => table.page === page);
    const rows = tables.reduce((sum, table) => sum + table.rows.length, 0);
    const form = report.forms.find((entry) => entry.page === page);
    lines.push(`| ${page} | ${tables.length} | ${rows} | ${form?.fieldCount ?? 0} |`);
  }
  lines.push("");

  if (report.tables.length > 0) {
    lines.push("## Tables", "");
    for (const table of report.tables) {
      lines.push(`### ${table.id} (page ${table.page})`, "");
      lines.push(`- Rows: ${table.rows.length}`);
      lines.push(`- Header row detected: ${table.headerDetected ? "yes" : "no"}`);
      lines.push(`- Confidence: ${table.confidence.toFixed(2)}`);
      lines.push(
        `- Columns: ${table.columns.map((column) => `\`${column.name}\` (${column.type})`).join(", ")}`,
      );
      for (const note of table.notes) lines.push(`- Note: ${note}`);
      lines.push("");
    }
  }

  if (report.forms.length > 0) {
    lines.push("## Form fields", "");
    for (const form of report.forms) {
      lines.push(`### Page ${form.page}`, "");
      for (const [key, value] of Object.entries(form.fields)) lines.push(`- \`${key}\`: ${value}`);
      lines.push("");
    }
  }

  lines.push("## Confidence notes", "");
  lines.push(
    "Confidence is a heuristic derived from header detection, cell fill rate, how many columns",
    "resolved to a number/date type, and row count. It is not a model score. Values below ~0.6",
    "usually mean the column layout was ragged or no header row was found - review",
    "`dataset.json` against the source PDF before using the data downstream.",
    "",
  );

  if (report.tables.length === 0 && report.forms.length === 0) {
    lines.push(
      "No tables or form fields were detected. The PDF may use single-column prose, graphical",
      "table rules without whitespace gaps, or scanned images.",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeOutputs(report: Report, outputDir: string): Promise<string[]> {
  const stringify = await loadCsvStringify();
  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];

  const write = async (name: string, content: string) => {
    await writeFile(join(outputDir, name), content, "utf8");
    written.push(name);
  };

  await write(
    "dataset.json",
    `${JSON.stringify(
      {
        source: report.input,
        mode: report.chosenMode,
        totalPages: report.totalPages,
        scannedPages: report.scannedPages,
        primaryTable: report.primaryTableId,
        tables: report.tables,
        forms: report.forms,
        records: report.records,
      },
      null,
      2,
    )}\n`,
  );

  const columns =
    report.records.length > 0
      ? [...new Set(report.records.flatMap((record) => Object.keys(record)))]
      : [];
  const csv =
    columns.length > 0
      ? stringify(report.records, { header: true, columns })
      : "";
  await write("dataset.csv", csv);

  await write("schema.json", `${JSON.stringify(buildSchema(report), null, 2)}\n`);
  await write("extraction-report.md", buildMarkdownReport(report));

  return written;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input!);
  const outputDir = resolve(options.output);

  const { pages, totalPages } = await extractPages(inputPath, options.pages);

  const tables = options.mode === "forms" ? [] : extractTables(pages, options.minRows);
  const forms = options.mode === "tables" ? [] : extractForms(pages);

  let chosenMode: "tables" | "forms";
  if (options.mode === "tables") chosenMode = "tables";
  else if (options.mode === "forms") chosenMode = "forms";
  else chosenMode = tables.length > 0 ? "tables" : "forms";

  const primary =
    chosenMode === "tables"
      ? tables.slice().sort((a, b) => b.rows.length * b.columns.length - a.rows.length * a.columns.length)[0]
      : undefined;

  const records =
    chosenMode === "tables"
      ? (primary?.rows ?? [])
      : forms.map((form) => ({ page: String(form.page), ...form.fields }));

  const report: Report = {
    input: inputPath,
    mode: options.mode,
    chosenMode,
    totalPages,
    scannedPages: pages.map((page) => page.page),
    tables,
    forms,
    records,
    primaryTableId: primary?.id ?? null,
    outputDir,
    files: [],
  };

  report.files = await writeOutputs(report, outputDir);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          input: report.input,
          outputDir: report.outputDir,
          mode: report.mode,
          chosenMode: report.chosenMode,
          totalPages: report.totalPages,
          scannedPages: report.scannedPages,
          tableCount: report.tables.length,
          formPages: report.forms.length,
          recordCount: report.records.length,
          primaryTable: report.primaryTableId,
          files: report.files,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log(`pdf-to-dataset: ${inputPath}`);
  console.log(`  mode           ${report.mode} -> ${report.chosenMode}`);
  console.log(`  pages scanned  ${report.scannedPages.length}/${report.totalPages}`);
  console.log(`  tables found   ${report.tables.length}`);
  console.log(`  form pages     ${report.forms.length}`);
  console.log(`  records        ${report.records.length}`);
  for (const table of report.tables) {
    console.log(
      `    ${table.id} (page ${table.page}): ${table.rows.length} rows x ${table.columns.length} cols, confidence ${table.confidence.toFixed(2)}`,
    );
  }
  console.log(`  output         ${outputDir}`);
  console.log(`  files          ${report.files.join(", ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`pdf-to-dataset: ${message}\n`);
  process.exit(1);
});
