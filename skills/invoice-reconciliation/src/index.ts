#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";

const VERSION = "0.1.0";

type Bucket =
  | "matched"
  | "short-paid"
  | "over-paid"
  | "duplicate-payment"
  | "unpaid-invoice"
  | "orphan-payment";

interface CliOptions {
  invoices?: string;
  payments?: string;
  output: string;
  tolerance: number;
  currency: string;
  json: boolean;
}

interface SourceRow {
  index: number;
  raw: Record<string, string>;
  id: string;
  key: string;
  amount: number | null;
  date: string;
  party: string;
}

interface ColumnMap {
  id: string | null;
  amount: string | null;
  date: string | null;
  party: string | null;
}

interface ResultRow {
  [column: string]: string;
  invoice_id: string;
  status: Bucket;
  invoice_amount: string;
  paid_amount: string;
  difference: string;
  payment_count: string;
  invoice_date: string;
  payment_date: string;
  party: string;
  note: string;
}

interface Anomaly {
  type: string;
  invoiceId: string | null;
  detail: string;
  rows?: number[];
}

interface Summary {
  generatedAt: string;
  currency: string;
  tolerance: number;
  inputs: {
    invoices: string | null;
    payments: string | null;
    invoiceColumns: ColumnMap;
    paymentColumns: ColumnMap;
    invoiceRows: number;
    paymentRows: number;
  };
  buckets: Record<Bucket, { count: number; invoiced: number; paid: number; difference: number }>;
  totals: {
    invoiced: number;
    paid: number;
    difference: number;
    matchRate: number;
  };
  anomalyCount: number;
  outputDir: string;
  files: string[];
}

/* ------------------------------------------------------------------ *
 * dependency loading
 * ------------------------------------------------------------------ */

type ParseFn = (input: string, options: Record<string, unknown>) => Array<Record<string, string>>;
type StringifyFn = (rows: Array<Record<string, string>>, options: { header: boolean; columns: string[] }) => string;

async function loadCsvParse(): Promise<ParseFn> {
  try {
    return (await import("csv-parse/sync")).parse as unknown as ParseFn;
  } catch {
    throw new Error("Missing dependency 'csv-parse'. Run bun install in this skill directory.");
  }
}

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
  console.log(`invoice-reconciliation v${VERSION}

USAGE:
  invoice-reconciliation --invoices <invoices.csv> --payments <payments.csv> [options]

OPTIONS:
      --invoices <path>    CSV export of invoices (required)
      --payments <path>    CSV export of payments (required)
  -o, --output <dir>       Output directory (default: ./reconciliation)
  -t, --tolerance <n>      Amount tolerance for an exact match (default: 0.01)
  -c, --currency <code>    Currency label used in reports (default: USD)
      --json               Print the summary as JSON on stdout
      --help               Show this help message
      --version            Show the current version

COLUMN DETECTION:
  Invoice id   invoice_id, invoice, invoice_no, invoice_number, id, number,
               reference, ref, bill_id, doc_number
  Amount       amount, total, amount_due, invoice_amount, paid_amount, value,
               gross, balance, sum
  Date         date, paid_at, payment_date, invoice_date, issue_date, due_date,
               created_at, posted_at
  Party        customer, client, vendor, supplier, account, payer, company

OUTPUT FILES:
  matched.csv          Invoices whose payments settle within the tolerance
  discrepancies.csv    Short-paid, over-paid, unpaid, duplicate, and orphan rows
  anomalies.json       Structured anomaly list (duplicates, unparseable amounts...)
  summary.json         Bucket counts and totals

EXAMPLES:
  invoice-reconciliation --invoices ./invoices.csv --payments ./payments.csv
  invoice-reconciliation --invoices ./inv.csv --payments ./pay.csv --tolerance 1 --json
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "./reconciliation",
    tolerance: 0.01,
    currency: "USD",
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
      case "--invoices":
      case "-i":
        options.invoices = argv[++i];
        break;
      case "--payments":
      case "-p":
        options.payments = argv[++i];
        break;
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--tolerance":
      case "-t": {
        const value = Number.parseFloat(argv[++i] ?? "");
        if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid --tolerance value: ${argv[i]}`);
        options.tolerance = value;
        break;
      }
      case "--currency":
      case "-c":
        options.currency = (argv[++i] ?? options.currency).toUpperCase();
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (!options.invoices) {
          options.invoices = arg;
          break;
        }
        if (!options.payments) {
          options.payments = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.invoices) throw new Error("Missing required --invoices <path> argument");
  if (!options.payments) throw new Error("Missing required --payments <path> argument");
  return options;
}

/* ------------------------------------------------------------------ *
 * column detection + parsing
 * ------------------------------------------------------------------ */

const ID_CANDIDATES = [
  "invoice_id",
  "invoiceid",
  "invoice_no",
  "invoice_number",
  "invoicenumber",
  "invoice",
  "bill_id",
  "doc_number",
  "document_number",
  "reference",
  "ref",
  "number",
  "id",
];

const AMOUNT_CANDIDATES = [
  "amount_due",
  "amount_paid",
  "paid_amount",
  "invoice_amount",
  "payment_amount",
  "amount",
  "total",
  "total_amount",
  "grand_total",
  "gross",
  "balance",
  "value",
  "sum",
];

const DATE_CANDIDATES = [
  "paid_at",
  "payment_date",
  "paid_on",
  "invoice_date",
  "issue_date",
  "issued_at",
  "due_date",
  "posted_at",
  "created_at",
  "date",
];

const PARTY_CANDIDATES = [
  "customer",
  "customer_name",
  "client",
  "vendor",
  "supplier",
  "payer",
  "account",
  "company",
  "counterparty",
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function pickColumn(headers: string[], candidates: string[]): string | null {
  const normalized = new Map(headers.map((header) => [normalizeKey(header), header]));
  for (const candidate of candidates) {
    const hit = normalized.get(candidate);
    if (hit) return hit;
  }
  // Fall back to a partial match (e.g. "customer_invoice_id" -> id candidates).
  for (const candidate of candidates) {
    for (const [key, header] of normalized) {
      if (key.includes(candidate)) return header;
    }
  }
  return null;
}

function detectColumns(headers: string[]): ColumnMap {
  return {
    id: pickColumn(headers, ID_CANDIDATES),
    amount: pickColumn(headers, AMOUNT_CANDIDATES),
    date: pickColumn(headers, DATE_CANDIDATES),
    party: pickColumn(headers, PARTY_CANDIDATES),
  };
}

function parseAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  let text = value.trim();
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/u.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[^0-9.,\-+]/gu, "").trim();
  if (text === "") return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // The right-most separator is the decimal separator.
    if (lastComma > lastDot) text = text.replace(/\./gu, "").replace(",", ".");
    else text = text.replace(/,/gu, "");
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 ? text.replace(/,/gu, "") : text.replace(",", ".");
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function matchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return value.toFixed(2);
}

async function readCsv(path: string, label: string): Promise<Array<Record<string, string>>> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(`Cannot read ${label} CSV: ${path}`);
  }
  if (!fileStat.isFile()) throw new Error(`${label} path is not a file: ${path}`);

  const text = await readFile(path, "utf8");
  if (text.trim() === "") throw new Error(`${label} CSV is empty: ${path}`);

  const parse = await loadCsvParse();
  let rows: Array<Record<string, string>>;
  try {
    rows = parse(text.replace(/^﻿/u, ""), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label} CSV (${path}): ${message}`);
  }

  if (rows.length === 0) throw new Error(`${label} CSV has a header but no rows: ${path}`);
  return rows;
}

function toSourceRows(
  rows: Array<Record<string, string>>,
  columns: ColumnMap,
  label: string,
  anomalies: Anomaly[],
): SourceRow[] {
  if (!columns.id) {
    throw new Error(
      `Could not find an invoice id column in the ${label} CSV. ` +
        `Looked for: ${ID_CANDIDATES.slice(0, 6).join(", ")}...`,
    );
  }
  if (!columns.amount) {
    throw new Error(
      `Could not find an amount column in the ${label} CSV. ` +
        `Looked for: ${AMOUNT_CANDIDATES.slice(0, 6).join(", ")}...`,
    );
  }

  const out: SourceRow[] = [];
  rows.forEach((raw, index) => {
    const id = (raw[columns.id!] ?? "").trim();
    const amount = parseAmount(raw[columns.amount!]);
    const rowNumber = index + 2; // header is line 1

    if (id === "") {
      anomalies.push({
        type: "missing-id",
        invoiceId: null,
        detail: `${label} row ${rowNumber} has no value in column "${columns.id}" and was skipped.`,
        rows: [rowNumber],
      });
      return;
    }
    if (amount === null) {
      anomalies.push({
        type: "unparseable-amount",
        invoiceId: id,
        detail: `${label} row ${rowNumber} has an unparseable amount ("${raw[columns.amount!] ?? ""}") in column "${columns.amount}"; treated as 0.`,
        rows: [rowNumber],
      });
    }

    out.push({
      index: rowNumber,
      raw,
      id,
      key: matchKey(id),
      amount,
      date: columns.date ? (raw[columns.date] ?? "").trim() : "",
      party: columns.party ? (raw[columns.party] ?? "").trim() : "",
    });
  });

  return out;
}

/* ------------------------------------------------------------------ *
 * reconciliation
 * ------------------------------------------------------------------ */

const BUCKETS: Bucket[] = [
  "matched",
  "short-paid",
  "over-paid",
  "duplicate-payment",
  "unpaid-invoice",
  "orphan-payment",
];

function reconcile(
  invoices: SourceRow[],
  payments: SourceRow[],
  tolerance: number,
  anomalies: Anomaly[],
): ResultRow[] {
  const paymentsByKey = new Map<string, SourceRow[]>();
  for (const payment of payments) {
    const bucket = paymentsByKey.get(payment.key);
    if (bucket) bucket.push(payment);
    else paymentsByKey.set(payment.key, [payment]);
  }

  const invoicesByKey = new Map<string, SourceRow[]>();
  for (const invoice of invoices) {
    const bucket = invoicesByKey.get(invoice.key);
    if (bucket) bucket.push(invoice);
    else invoicesByKey.set(invoice.key, [invoice]);
  }

  for (const group of invoicesByKey.values()) {
    if (group.length > 1) {
      anomalies.push({
        type: "duplicate-invoice-row",
        invoiceId: group[0].id,
        detail: `Invoice id "${group[0].id}" appears on ${group.length} invoice rows (${group.map((row) => row.index).join(", ")}); amounts were summed.`,
        rows: group.map((row) => row.index),
      });
    }
  }

  const results: ResultRow[] = [];
  const usedPaymentKeys = new Set<string>();

  for (const [key, group] of invoicesByKey) {
    const invoiceAmount = round(group.reduce((sum, row) => sum + (row.amount ?? 0), 0));
    const matches = paymentsByKey.get(key) ?? [];
    usedPaymentKeys.add(key);

    const paidAmount = round(matches.reduce((sum, row) => sum + (row.amount ?? 0), 0));
    const difference = round(paidAmount - invoiceAmount);
    const first = group[0];

    if (matches.length > 1) {
      const exactDuplicates = new Map<string, SourceRow[]>();
      for (const payment of matches) {
        const signature = `${money(payment.amount ?? 0)}|${payment.date}`;
        const bucket = exactDuplicates.get(signature);
        if (bucket) bucket.push(payment);
        else exactDuplicates.set(signature, [payment]);
      }
      for (const [signature, bucket] of exactDuplicates) {
        if (bucket.length > 1) {
          anomalies.push({
            type: "identical-payment-rows",
            invoiceId: first.id,
            detail: `Invoice "${first.id}" has ${bucket.length} identical payment rows (${signature.replace("|", " on ")}) at rows ${bucket.map((row) => row.index).join(", ")}.`,
            rows: bucket.map((row) => row.index),
          });
        }
      }
      anomalies.push({
        type: "multiple-payments",
        invoiceId: first.id,
        detail: `Invoice "${first.id}" was paid by ${matches.length} payment rows totalling ${money(paidAmount)} against ${money(invoiceAmount)}.`,
        rows: matches.map((row) => row.index),
      });
    }

    let status: Bucket;
    let note: string;
    if (matches.length === 0) {
      status = "unpaid-invoice";
      note = "No payment row matched this invoice id.";
    } else if (matches.length > 1) {
      status = "duplicate-payment";
      note =
        Math.abs(difference) <= tolerance
          ? `${matches.length} payments settle the invoice exactly; confirm they are instalments, not duplicates.`
          : `${matches.length} payments differ from the invoice by ${money(difference)}.`;
    } else if (Math.abs(difference) <= tolerance) {
      status = "matched";
      note = "Paid within tolerance.";
    } else if (difference < 0) {
      status = "short-paid";
      note = `Underpaid by ${money(Math.abs(difference))}.`;
    } else {
      status = "over-paid";
      note = `Overpaid by ${money(difference)}.`;
    }

    results.push({
      invoice_id: first.id,
      status,
      invoice_amount: money(invoiceAmount),
      paid_amount: money(paidAmount),
      difference: money(difference),
      payment_count: String(matches.length),
      invoice_date: first.date,
      payment_date: matches.map((row) => row.date).filter(Boolean).join(" | "),
      party: first.party || matches.find((row) => row.party)?.party || "",
      note,
    });
  }

  for (const [key, group] of paymentsByKey) {
    if (usedPaymentKeys.has(key)) continue;
    const paidAmount = round(group.reduce((sum, row) => sum + (row.amount ?? 0), 0));
    const first = group[0];
    anomalies.push({
      type: "orphan-payment",
      invoiceId: first.id,
      detail: `Payment id "${first.id}" (${money(paidAmount)}) has no matching invoice row.`,
      rows: group.map((row) => row.index),
    });
    results.push({
      invoice_id: first.id,
      status: "orphan-payment",
      invoice_amount: money(0),
      paid_amount: money(paidAmount),
      difference: money(paidAmount),
      payment_count: String(group.length),
      invoice_date: "",
      payment_date: group.map((row) => row.date).filter(Boolean).join(" | "),
      party: first.party,
      note: "No invoice row matched this payment id.",
    });
  }

  results.sort((a, b) => {
    if (a.status !== b.status) return BUCKETS.indexOf(a.status) - BUCKETS.indexOf(b.status);
    return a.invoice_id.localeCompare(b.invoice_id);
  });

  return results;
}

/* ------------------------------------------------------------------ *
 * output
 * ------------------------------------------------------------------ */

const RESULT_COLUMNS = [
  "invoice_id",
  "status",
  "invoice_amount",
  "paid_amount",
  "difference",
  "payment_count",
  "invoice_date",
  "payment_date",
  "party",
  "note",
];

function summarize(results: ResultRow[]): Summary["buckets"] {
  const buckets = {} as Summary["buckets"];
  for (const bucket of BUCKETS) buckets[bucket] = { count: 0, invoiced: 0, paid: 0, difference: 0 };

  for (const row of results) {
    const entry = buckets[row.status];
    entry.count += 1;
    entry.invoiced = round(entry.invoiced + Number(row.invoice_amount));
    entry.paid = round(entry.paid + Number(row.paid_amount));
    entry.difference = round(entry.difference + Number(row.difference));
  }
  return buckets;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function printSummaryTable(summary: Summary): void {
  const header = ["bucket", "count", "invoiced", "paid", "difference"];
  const rows = BUCKETS.map((bucket) => {
    const entry = summary.buckets[bucket];
    return [bucket, String(entry.count), money(entry.invoiced), money(entry.paid), money(entry.difference)];
  });
  rows.push([
    "TOTAL",
    String(BUCKETS.reduce((sum, bucket) => sum + summary.buckets[bucket].count, 0)),
    money(summary.totals.invoiced),
    money(summary.totals.paid),
    money(summary.totals.difference),
  ]);

  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column].length)),
  );

  const line = (cells: string[]) =>
    `  ${cells
      .map((cell, column) => (column === 0 ? padRight(cell, widths[column]) : padLeft(cell, widths[column])))
      .join("  ")}`;

  console.log(line(header));
  console.log(`  ${widths.map((width) => "-".repeat(width)).join("  ")}`);
  for (const row of rows.slice(0, -1)) console.log(line(row));
  console.log(`  ${widths.map((width) => "-".repeat(width)).join("  ")}`);
  console.log(line(rows[rows.length - 1]));
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const invoicesPath = resolve(options.invoices!);
  const paymentsPath = resolve(options.payments!);
  const outputDir = resolve(options.output);

  const anomalies: Anomaly[] = [];

  const invoiceRaw = await readCsv(invoicesPath, "invoices");
  const paymentRaw = await readCsv(paymentsPath, "payments");

  const invoiceColumns = detectColumns(Object.keys(invoiceRaw[0]));
  const paymentColumns = detectColumns(Object.keys(paymentRaw[0]));

  const invoices = toSourceRows(invoiceRaw, invoiceColumns, "invoices", anomalies);
  const payments = toSourceRows(paymentRaw, paymentColumns, "payments", anomalies);

  const results = reconcile(invoices, payments, options.tolerance, anomalies);
  const buckets = summarize(results);

  const invoiced = round(BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].invoiced, 0));
  const paid = round(BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].paid, 0));
  const totalRows = results.length || 1;

  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    currency: options.currency,
    tolerance: options.tolerance,
    inputs: {
      invoices: invoicesPath,
      payments: paymentsPath,
      invoiceColumns,
      paymentColumns,
      invoiceRows: invoices.length,
      paymentRows: payments.length,
    },
    buckets,
    totals: {
      invoiced,
      paid,
      difference: round(paid - invoiced),
      matchRate: Math.round((buckets.matched.count / totalRows) * 1000) / 1000,
    },
    anomalyCount: anomalies.length,
    outputDir,
    files: [],
  };

  const stringify = await loadCsvStringify();
  await mkdir(outputDir, { recursive: true });

  const matched = results.filter((row) => row.status === "matched");
  const discrepancies = results.filter((row) => row.status !== "matched");

  const files: string[] = [];
  const write = async (name: string, content: string) => {
    await writeFile(join(outputDir, name), content, "utf8");
    files.push(name);
  };

  await write("matched.csv", stringify(matched, { header: true, columns: RESULT_COLUMNS }));
  await write("discrepancies.csv", stringify(discrepancies, { header: true, columns: RESULT_COLUMNS }));
  await write("anomalies.json", `${JSON.stringify({ count: anomalies.length, anomalies }, null, 2)}\n`);

  summary.files = [...files, "summary.json"];
  await writeFile(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...summary, anomalies }, null, 2)}\n`);
    return;
  }

  console.log(`invoice-reconciliation (${summary.currency}, tolerance ${options.tolerance})`);
  console.log(`  invoices  ${invoicesPath} (${invoices.length} rows, id="${invoiceColumns.id}", amount="${invoiceColumns.amount}")`);
  console.log(`  payments  ${paymentsPath} (${payments.length} rows, id="${paymentColumns.id}", amount="${paymentColumns.amount}")`);
  console.log("");
  printSummaryTable(summary);
  console.log("");
  console.log(`  match rate ${(summary.totals.matchRate * 100).toFixed(1)}%   anomalies ${anomalies.length}`);
  console.log(`  output     ${outputDir}`);
  console.log(`  files      ${summary.files.join(", ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`invoice-reconciliation: ${message}\n`);
  process.exit(1);
});
