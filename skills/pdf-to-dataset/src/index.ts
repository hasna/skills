#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type ExtractionMode = "auto" | "tables" | "forms" | "invoice";

interface DatasetOptions {
  input: string;
  schemaHints: string[];
  mode: ExtractionMode;
  pages?: string;
  outputDir: string;
}

interface DatasetRow {
  id: string;
  source: string;
  field: string;
  value: string;
  confidence: number;
  notes: string;
}

const SKILL_NAME = "pdf-to-dataset";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `PDF to Dataset

Usage:
  skills run pdf-to-dataset -- --input ./invoice.pdf --schema "invoice_number,date,total,vendor"
  skills run pdf-to-dataset -- --input ./reports --mode tables

Options:
  --input <path-or-url>  PDF file, folder, or URL
  --schema <fields>      Comma-separated field hints
  --mode <mode>          auto, tables, forms, invoice. Default: auto
  --pages <ranges>       Page ranges like 1-3,8
  --output <dir>         Output directory. Default: current run export directory
  --help                 Show this help

Outputs:
  dataset.json, dataset.csv, schema.json, extraction-report.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const source = await loadInputText(options.input);
  const rows = extractDatasetRows(source.text, source.label, options);
  const schema = buildSchema(rows, options);
  const files = writeArtifacts(options, source, rows, schema);

  console.log(`Extracted ${rows.length} dataset row${rows.length === 1 ? "" : "s"} from ${source.label}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.datasetJson}`);
  console.log(`- ${files.datasetCsv}`);
  console.log(`- ${files.schemaJson}`);
  console.log(`- ${files.report}`);
}

function parseCliOptions(): DatasetOptions {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      schema: { type: "string" },
      mode: { type: "string", default: "auto" },
      pages: { type: "string" },
      output: { type: "string", short: "o" },
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

  const mode = String(values.mode || "auto");
  if (!isExtractionMode(mode)) {
    console.error("Invalid mode. Use auto, tables, forms, or invoice.");
    process.exit(1);
  }

  return {
    input,
    schemaHints: splitSchemaHints(values.schema),
    mode,
    pages: values.pages ? String(values.pages) : undefined,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

async function loadInputText(input: string): Promise<{ label: string; text: string; byteSize: number }> {
  if (/^https?:\/\//i.test(input)) {
    if (!process.env.SKILLS_TEST_MODE) {
      const response = await fetch(input);
      if (!response.ok) {
        throw new Error(`Could not fetch input URL: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        label: input,
        text: normalizePdfText(buffer),
        byteSize: buffer.byteLength,
      };
    }
    return {
      label: input,
      text: `Source URL: ${input}\nInvoice Number: INV-1001\nDate: 2026-05-10\nVendor: Example Vendor\nTotal: 2500.00\n`,
      byteSize: 0,
    };
  }

  if (!existsSync(input)) {
    throw new Error(`Input not found: ${input}`);
  }

  const stats = statSync(input);
  if (stats.isDirectory()) {
    const summary = `Folder: ${input}\nFile count: ${Bun.spawnSync(["find", input, "-type", "f"]).stdout.length}\n`;
    return { label: basename(input), text: summary, byteSize: 0 };
  }

  const buffer = readFileSync(input);
  return {
    label: basename(input),
    text: normalizePdfText(buffer),
    byteSize: buffer.byteLength,
  };
}

function normalizePdfText(buffer: Buffer): string {
  const raw = buffer.toString("utf8");
  return raw
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDatasetRows(text: string, source: string, options: DatasetOptions): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const keyValuePattern = /^([A-Za-z][A-Za-z0-9 _/-]{1,60})\s*[:=]\s*(.+)$/;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(keyValuePattern);
    if (match) {
      rows.push(row(source, normalizeField(match[1]), match[2], 0.91, "Detected key-value field"));
    }
  }

  if (options.mode === "tables" || options.mode === "auto") {
    for (const line of lines) {
      const cells = line.split(/\t|,{1}| {2,}/).map((cell) => cell.trim()).filter(Boolean);
      if (cells.length >= 3) {
        rows.push(row(source, "table_row", JSON.stringify(cells), 0.78, "Detected table-like row"));
      }
    }
  }

  if (options.mode === "invoice" || options.mode === "auto") {
    const invoiceRows = invoiceFields(text, source);
    for (const invoiceRow of invoiceRows) rows.push(invoiceRow);
  }

  for (const hint of options.schemaHints) {
    if (!rows.some((candidate) => candidate.field === normalizeField(hint))) {
      rows.push(row(source, normalizeField(hint), "", 0.35, "Schema hint present; value not confidently extracted"));
    }
  }

  if (rows.length === 0) {
    rows.push(row(source, "document_summary", text.slice(0, 500), 0.5, "Fallback summary from extracted PDF text"));
  }

  return dedupeRows(rows);
}

function invoiceFields(text: string, source: string): DatasetRow[] {
  const patterns: Array<[string, RegExp]> = [
    ["invoice_number", /\b(?:invoice|inv)[\s#:.-]*(\w[\w-]+)/i],
    ["date", /\b(?:date|issued)[\s:.-]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i],
    ["total", /\b(?:total|amount due|balance due)[\s:.-]*([$€£]?\s?[0-9][0-9,]*(?:\.[0-9]{2})?)/i],
    ["vendor", /\b(?:vendor|supplier|from)[\s:.-]*([A-Za-z0-9 &.,'-]{3,80})/i],
  ];
  return patterns.flatMap(([field, pattern]) => {
    const match = text.match(pattern);
    return match ? [row(source, field, match[1].trim(), 0.82, "Detected invoice field")] : [];
  });
}

function buildSchema(rows: DatasetRow[], options: DatasetOptions) {
  const fields = Array.from(new Set(rows.map((datasetRow) => datasetRow.field))).sort();
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    mode: options.mode,
    fields: fields.map((field) => ({
      name: field,
      type: inferFieldType(field, rows),
      nullable: rows.some((datasetRow) => datasetRow.field === field && datasetRow.value === ""),
    })),
  };
}

function writeArtifacts(
  options: DatasetOptions,
  source: { label: string; text: string; byteSize: number },
  rows: DatasetRow[],
  schema: unknown,
) {
  const datasetJson = join(options.outputDir, "dataset.json");
  const datasetCsv = join(options.outputDir, "dataset.csv");
  const schemaJson = join(options.outputDir, "schema.json");
  const report = join(options.outputDir, "extraction-report.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeJson(datasetJson, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    source: {
      label: source.label,
      byteSize: source.byteSize,
      pages: options.pages || "all",
    },
    rows,
  });
  writeFileSync(datasetCsv, toCsv(rows));
  writeJson(schemaJson, schema);
  writeFileSync(report, markdownReport(options, source, rows));
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    input: options.input,
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    files: {
      datasetJson: toManifestPath(options.outputDir, datasetJson),
      datasetCsv: toManifestPath(options.outputDir, datasetCsv),
      schemaJson: toManifestPath(options.outputDir, schemaJson),
      report: toManifestPath(options.outputDir, report),
    },
  });

  return { datasetJson, datasetCsv, schemaJson, report };
}

function row(source: string, field: string, value: string, confidence: number, notes: string): DatasetRow {
  return {
    id: `${field}_${Math.abs(hash(`${field}:${value}`)).toString(36)}`,
    source,
    field,
    value: value.trim(),
    confidence,
    notes,
  };
}

function dedupeRows(rows: DatasetRow[]): DatasetRow[] {
  const seen = new Set<string>();
  return rows.filter((datasetRow) => {
    const key = `${datasetRow.field}:${datasetRow.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toCsv(rows: DatasetRow[]): string {
  const header = ["id", "source", "field", "value", "confidence", "notes"];
  return [
    header.join(","),
    ...rows.map((datasetRow) => header.map((key) => csvCell(String(datasetRow[key as keyof DatasetRow]))).join(",")),
  ].join("\n");
}

function markdownReport(options: DatasetOptions, source: { label: string; byteSize: number }, rows: DatasetRow[]): string {
  const averageConfidence = rows.reduce((sum, datasetRow) => sum + datasetRow.confidence, 0) / rows.length;
  return `# PDF Dataset Extraction Report

- Source: ${source.label}
- Byte size: ${source.byteSize}
- Mode: ${options.mode}
- Pages: ${options.pages || "all"}
- Rows: ${rows.length}
- Average confidence: ${averageConfidence.toFixed(2)}

## Fields

${Array.from(new Set(rows.map((datasetRow) => datasetRow.field))).sort().map((field) => `- ${field}`).join("\n")}

## Confidence Notes

${rows.map((datasetRow) => `- ${datasetRow.field}: ${datasetRow.notes} (${datasetRow.confidence.toFixed(2)})`).join("\n")}
`;
}

function splitSchemaHints(value: unknown): string[] {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((field) => normalizeField(field))
    .filter(Boolean);
}

function normalizeField(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferFieldType(field: string, rows: DatasetRow[]): "string" | "number" | "date" | "array" {
  const values = rows.filter((datasetRow) => datasetRow.field === field).map((datasetRow) => datasetRow.value).filter(Boolean);
  if (field.includes("date")) return "date";
  if (field.includes("total") || values.every((value) => /^[$€£]?\s?[0-9][0-9,]*(?:\.[0-9]+)?$/.test(value))) return "number";
  if (field.includes("row")) return "array";
  return "string";
}

function isExtractionMode(value: string): value is ExtractionMode {
  return value === "auto" || value === "tables" || value === "forms" || value === "invoice";
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

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function hash(value: string): number {
  let hashValue = 0;
  for (let index = 0; index < value.length; index++) {
    hashValue = (hashValue << 5) - hashValue + value.charCodeAt(index);
    hashValue |= 0;
  }
  return hashValue;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
