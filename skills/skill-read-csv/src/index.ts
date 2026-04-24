#!/usr/bin/env bun

import { createReadStream } from "fs";
import { mkdir, open, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

const VERSION = "0.1.0";
const SAMPLE_BYTES = 128 * 1024;

type HeaderMode = "auto" | "true" | "false";

interface CliOptions {
  input?: string;
  delimiter?: string;
  encoding: string;
  headers: HeaderMode;
  limit?: number;
  output?: string;
}

interface CsvResult {
  input: string;
  encoding: string;
  delimiter: string;
  hasHeader: boolean;
  columns: string[];
  rowCount: number;
  truncated: boolean;
  rows: Array<Record<string, string | null>>;
}

async function loadCsvParse() {
  try {
    return (await import("csv-parse")).parse;
  } catch {
    throw new Error("Missing dependency 'csv-parse'. Run bun install in this skill directory.");
  }
}

async function loadCsvParseSync() {
  try {
    return (await import("csv-parse/sync")).parse;
  } catch {
    throw new Error("Missing dependency 'csv-parse'. Run bun install in this skill directory.");
  }
}

async function loadIconv() {
  try {
    return (await import("iconv-lite")).default;
  } catch {
    throw new Error("Missing dependency 'iconv-lite'. Run bun install in this skill directory.");
  }
}

function printHelp(): void {
  console.log(`skill-read-csv v${VERSION}

USAGE:
  skill-read-csv --input <path> [options]

OPTIONS:
  -i, --input <path>        CSV file to parse
  -d, --delimiter <value>   comma | tab | semicolon | pipe | literal character
  -e, --encoding <value>    auto | utf8 | utf16le | utf16be | latin1 | win1252
      --headers <mode>      auto | true | false
  -l, --limit <n>           Stop after parsing n rows
  -o, --output <path>       Save JSON result to a file
      --help                Show this help message
      --version             Show the current version
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    encoding: "auto",
    headers: "auto",
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
      case "--delimiter":
      case "-d":
        options.delimiter = argv[++i];
        break;
      case "--encoding":
      case "-e":
        options.encoding = argv[++i] ?? "auto";
        break;
      case "--headers": {
        const value = (argv[++i] ?? "auto").toLowerCase();
        if (value !== "auto" && value !== "true" && value !== "false") {
          throw new Error(`Invalid --headers value: ${value}`);
        }
        options.headers = value;
        break;
      }
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

function normalizeDelimiter(input?: string): string | undefined {
  if (!input) return undefined;
  const value = input.toLowerCase();
  switch (value) {
    case "comma":
      return ",";
    case "tab":
      return "\t";
    case "semicolon":
      return ";";
    case "pipe":
      return "|";
    default:
      return input;
  }
}

async function readSample(path: string, byteCount = SAMPLE_BYTES): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectEncoding(sample: Buffer, requested: string): { encoding: string; bomBytes: number } {
  if (requested !== "auto") {
    return { encoding: requested, bomBytes: 0 };
  }

  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return { encoding: "utf8", bomBytes: 3 };
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return { encoding: "utf16le", bomBytes: 2 };
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return { encoding: "utf16be", bomBytes: 2 };
  }

  return { encoding: "utf8", bomBytes: 0 };
}

function detectDelimiter(sampleText: string): string {
  const candidates = [",", "\t", ";", "|"];
  const lines = sampleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (lines.length === 0) {
    return ",";
  }

  let bestDelimiter = ",";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const delimiter of candidates) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const variance = counts.reduce((sum, count) => sum + Math.abs(count - counts[0]), 0);
    const score = total * 10 - variance;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

async function parseSampleRows(sampleText: string, delimiter: string): Promise<string[][]> {
  const parseCsvSync = await loadCsvParseSync();
  const records = parseCsvSync(sampleText, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    to_line: 5,
  }) as string[][];
  return records;
}

function looksNumeric(value: string): boolean {
  return value.trim() !== "" && !Number.isNaN(Number(value));
}

function normalizeColumnName(value: string, index: number, seen: Set<string>): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `column_${index + 1}`;

  let next = base;
  let suffix = 2;
  while (seen.has(next)) {
    next = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(next);
  return next;
}

function inferHeader(sampleRows: string[][]): boolean {
  if (sampleRows.length < 2) {
    return false;
  }

  const first = sampleRows[0];
  const second = sampleRows[1];
  const unique = new Set(first.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const mostlyText = first.filter((value) => !looksNumeric(value)).length >= Math.ceil(first.length / 2);
  const secondHasNumeric = second.some((value) => looksNumeric(value));

  return unique.size === first.length && mostlyText && secondHasNumeric;
}

function buildColumns(sampleRows: string[][], headerMode: HeaderMode): { hasHeader: boolean; columns: string[] } {
  const firstRow = sampleRows[0] ?? [];
  const seen = new Set<string>();

  if (headerMode === "true" || (headerMode === "auto" && inferHeader(sampleRows))) {
    return {
      hasHeader: true,
      columns: firstRow.map((value, index) => normalizeColumnName(String(value), index, seen)),
    };
  }

  return {
    hasHeader: false,
    columns: firstRow.map((_, index) => normalizeColumnName(`column_${index + 1}`, index, seen)),
  };
}

async function parseCsvFile(
  path: string,
  options: CliOptions,
  encoding: string,
  bomBytes: number,
  delimiter: string,
  columns: string[],
  hasHeader: boolean,
): Promise<{ rows: Array<Record<string, string | null>>; truncated: boolean }> {
  const iconv = await loadIconv();
  const createParser = await loadCsvParse();
  const rows: Array<Record<string, string | null>> = [];
  let truncated = false;
  const stream = createReadStream(path, bomBytes > 0 ? { start: bomBytes } : undefined)
    .pipe(iconv.decodeStream(encoding))
    .pipe(createParser({
      delimiter,
      columns: hasHeader ? true : columns,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false,
    }));

  for await (const record of stream) {
    rows.push(record as Record<string, string | null>);
    if (options.limit && rows.length >= options.limit) {
      truncated = true;
      break;
    }
  }

  stream.destroy();
  return { rows, truncated };
}

async function writeJson(path: string, payload: CsvResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input!);
  const sample = await readSample(inputPath);
  const iconv = await loadIconv();
  const { encoding, bomBytes } = detectEncoding(sample, options.encoding.toLowerCase());
  const sampleText = iconv.decode(sample.subarray(bomBytes), encoding);
  const delimiter = normalizeDelimiter(options.delimiter) ?? detectDelimiter(sampleText);
  const sampleRows = await parseSampleRows(sampleText, delimiter);
  const { hasHeader, columns } = buildColumns(sampleRows, options.headers);
  const { rows, truncated } = await parseCsvFile(inputPath, options, encoding, bomBytes, delimiter, columns, hasHeader);

  const result: CsvResult = {
    input: inputPath,
    encoding,
    delimiter,
    hasHeader,
    columns,
    rowCount: rows.length,
    truncated,
    rows,
  };

  if (options.output) {
    await writeJson(resolve(options.output), result);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skill-read-csv: ${message}\n`);
  process.exit(1);
});
