#!/usr/bin/env bun

import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

type XlsxModule = typeof import("xlsx");
type WorkBook = import("xlsx").WorkBook;
type WorkSheet = import("xlsx").WorkSheet;
type CellObject = import("xlsx").CellObject;

const VERSION = "0.1.0";

interface CliOptions {
  input?: string;
  sheets?: string[];
  limit?: number;
  output?: string;
}

interface NamedRange {
  name: string;
  ref: string;
  sheet?: string;
}

interface SheetResult {
  name: string;
  index: number;
  range: string | null;
  rowCount: number;
  columnCount: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  formattedCells: Array<{ cell: string; raw?: unknown; formatted?: string; format?: string }>;
}

interface WorkbookResult {
  input: string;
  workbook: {
    sheetNames: string[];
    namedRanges: NamedRange[];
  };
  sheets: SheetResult[];
}

async function loadXlsx(): Promise<XlsxModule> {
  try {
    return await import("xlsx");
  } catch {
    throw new Error("Missing dependency 'xlsx'. Run bun install in this skill directory.");
  }
}

function printHelp(): void {
  console.log(`skill-read-excel v${VERSION}

USAGE:
  skill-read-excel --input <path> [options]

OPTIONS:
  -i, --input <path>      Excel workbook to parse (.xls or .xlsx)
  -s, --sheets <list>     Comma-separated sheet names to include
  -l, --limit <n>         Limit rows returned per sheet
  -o, --output <path>     Save JSON result to a file
      --help              Show this help message
      --version           Show the current version
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

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
      case "--sheets":
      case "-s":
        options.sheets = (argv[++i] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--limit":
      case "-l": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --limit value: ${argv[i]}`);
        }
        options.limit = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i];
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.input) {
          options.input = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.input) {
    throw new Error("Missing required --input <path> argument");
  }

  return options;
}

function normalizeColumnName(value: unknown, index: number, seen: Set<string>): string {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `column_${index + 1}`;

  let next = text;
  let suffix = 2;
  while (seen.has(next)) {
    next = `${text}_${suffix}`;
    suffix += 1;
  }
  seen.add(next);
  return next;
}

function inferHeader(rows: unknown[][]): boolean {
  if (rows.length < 2) {
    return false;
  }
  const first = rows[0];
  const second = rows[1];
  const unique = new Set(first.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean));
  const mostlyText = first.filter((value) => String(value ?? "").trim() !== "" && Number.isNaN(Number(value))).length >= Math.ceil(first.length / 2);
  const secondHasNumeric = second.some((value) => String(value ?? "").trim() !== "" && !Number.isNaN(Number(value)));
  return unique.size === first.length && mostlyText && secondHasNumeric;
}

function collectFormattedCells(sheet: WorkSheet, maxCells = 50): Array<{ cell: string; raw?: unknown; formatted?: string; format?: string }> {
  const result: Array<{ cell: string; raw?: unknown; formatted?: string; format?: string }> = [];
  const entries = Object.entries(sheet).filter(([key]) => !key.startsWith("!"));

  for (const [cell, value] of entries) {
    if (result.length >= maxCells) {
      break;
    }
    const cellValue = value as CellObject;
    if (cellValue.z || cellValue.w) {
      result.push({
        cell,
        raw: cellValue.v,
        formatted: cellValue.w,
        format: typeof cellValue.z === "string" ? cellValue.z : undefined,
      });
    }
  }

  return result;
}

function parseSheet(xlsx: XlsxModule, name: string, index: number, sheet: WorkSheet, limit?: number): SheetResult {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  }) as unknown[][];

  const trimmedRows = limit ? rows.slice(0, limit + 1) : rows;
  const hasHeader = inferHeader(trimmedRows);
  const headerRow = trimmedRows[0] ?? [];
  const seen = new Set<string>();
  const columns = (hasHeader ? headerRow : headerRow.map((_, colIndex) => `column_${colIndex + 1}`))
    .map((value, colIndex) => normalizeColumnName(value, colIndex, seen));

  const dataRows = hasHeader ? trimmedRows.slice(1) : trimmedRows;
  const normalizedRows = dataRows.map((row) =>
    columns.reduce<Record<string, unknown>>((record, column, colIndex) => {
      record[column] = row[colIndex] ?? null;
      return record;
    }, {})
  );

  return {
    name,
    index,
    range: sheet["!ref"] ?? null,
    rowCount: normalizedRows.length,
    columnCount: columns.length,
    columns,
    rows: normalizedRows,
    formattedCells: collectFormattedCells(sheet),
  };
}

function collectNamedRanges(workbook: WorkBook): NamedRange[] {
  const names = workbook.Workbook?.Names ?? [];
  return names.map((entry) => ({
    name: entry.Name ?? "",
    ref: entry.Ref ?? "",
    sheet: entry.Sheet != null ? workbook.SheetNames[entry.Sheet] : undefined,
  }));
}

async function writeJson(path: string, payload: WorkbookResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const xlsx = await loadXlsx();
  const inputPath = resolve(options.input!);
  const workbook = xlsx.readFile(inputPath, {
    cellDates: true,
    cellNF: true,
    cellStyles: true,
    dense: false,
  });

  const selectedSheetNames = options.sheets?.length
    ? workbook.SheetNames.filter((name) => options.sheets!.includes(name))
    : workbook.SheetNames;

  if (selectedSheetNames.length === 0) {
    throw new Error("No matching sheets found");
  }

  const result: WorkbookResult = {
    input: inputPath,
    workbook: {
      sheetNames: workbook.SheetNames,
      namedRanges: collectNamedRanges(workbook),
    },
    sheets: selectedSheetNames.map((name) => parseSheet(xlsx, name, workbook.SheetNames.indexOf(name), workbook.Sheets[name], options.limit)),
  };

  if (options.output) {
    await writeJson(resolve(options.output), result);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skill-read-excel: ${message}\n`);
  process.exit(1);
});
