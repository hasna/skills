#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type DiscrepancyType = "missing-payment" | "overpaid" | "underpaid" | "duplicate-payment" | "unmatched-payment";
type Severity = "high" | "medium" | "low";

interface ReconciliationOptions {
  invoicesCsv: string;
  paymentsCsv: string;
  company: string;
  currency: string;
  outputDir: string;
}

interface InvoiceRow {
  invoiceId: string;
  customer: string;
  amount: number;
  dueDate: string;
  status: string;
}

interface PaymentRow {
  paymentId: string;
  invoiceId: string;
  customer: string;
  amount: number;
  paidAt: string;
}

interface MatchRow {
  invoiceId: string;
  paymentId: string;
  customer: string;
  invoiceAmount: number;
  paymentAmount: number;
  variance: number;
  status: "matched" | "partial" | "overpaid";
}

interface Discrepancy {
  type: DiscrepancyType;
  severity: Severity;
  invoiceId: string;
  paymentId: string;
  customer: string;
  amount: number;
  note: string;
  recommendation: string;
}

const SKILL_NAME = "invoice-reconciliation";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Invoice Reconciliation

Usage:
  skills run invoice-reconciliation --invoices ./invoices.csv --payments ./payments.csv --company "Acme"
  skills run invoice-reconciliation --data "invoice_id,customer,amount,status\\nINV-1,Acme,1200,open"

Options:
  --invoices <path>  CSV export with invoice rows
  --payments <path>  CSV export with payment rows
  --data <text>      Inline invoice/payment CSV-style data
  --company <text>   Company or finance workspace name. Default: Company
  --currency <code>  Currency code. Default: USD
  --output <dir>     Output directory. Default: current run export directory
  --help             Show this help

Outputs:
  reconciliation-report.md, matched-invoices.csv, discrepancies.csv,
  anomalies.json, summary.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const invoices = parseInvoices(options.invoicesCsv);
  const payments = parsePayments(options.paymentsCsv);
  const { matches, discrepancies } = reconcile(invoices, payments);
  const anomalies = buildAnomalies(invoices, payments, matches, discrepancies);
  const summary = buildSummary(options, invoices, payments, matches, discrepancies, anomalies);
  const report = buildReport(options, summary, matches, discrepancies, anomalies);
  const files = writeArtifacts(options, summary, matches, discrepancies, anomalies, report);

  console.log(`Generated invoice reconciliation package for ${options.company}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.report}`);
  console.log(`- ${files.matches}`);
  console.log(`- ${files.discrepancies}`);
  console.log(`- ${files.anomalies}`);
  console.log(`- ${files.summary}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): ReconciliationOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      invoices: { type: "string" },
      payments: { type: "string" },
      data: { type: "string" },
      company: { type: "string", default: "Company" },
      currency: { type: "string", default: "USD" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const inlineData = String(values.data || positionals.join(" ")).trim();
  const invoicesCsv = values.invoices ? readSource(String(values.invoices)) : inlineData;
  const paymentsCsv = values.payments ? readSource(String(values.payments)) : "";

  if (!invoicesCsv.trim()) {
    console.error("Invoice data is required. Pass --invoices <path> or --data <csv>.");
    process.exit(1);
  }

  return {
    invoicesCsv,
    paymentsCsv,
    company: String(values.company || "Company").trim(),
    currency: String(values.currency || "USD").trim().toUpperCase(),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSource(path: string): string {
  if (!existsSync(path)) {
    console.error(`Source not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

function parseInvoices(csv: string): InvoiceRow[] {
  return parseCsv(csv).map((row, index) => ({
    invoiceId: pick(row, ["invoice_id", "invoiceId", "invoice", "id"], `INV-${index + 1}`),
    customer: pick(row, ["customer", "client", "account"], "Unknown customer"),
    amount: parseMoney(pick(row, ["amount", "total", "invoice_amount", "invoiceAmount"], "0")),
    dueDate: pick(row, ["due_date", "dueDate", "due", "date"], ""),
    status: pick(row, ["status", "state"], "open").toLowerCase(),
  })).filter((row) => row.amount > 0);
}

function parsePayments(csv: string): PaymentRow[] {
  if (!csv.trim()) return [];
  return parseCsv(csv).map((row, index) => ({
    paymentId: pick(row, ["payment_id", "paymentId", "payment", "id"], `PAY-${index + 1}`),
    invoiceId: pick(row, ["invoice_id", "invoiceId", "invoice"], ""),
    customer: pick(row, ["customer", "client", "account"], "Unknown customer"),
    amount: parseMoney(pick(row, ["amount", "paid", "payment_amount", "paymentAmount"], "0")),
    paidAt: pick(row, ["paid_at", "paidAt", "date"], ""),
  })).filter((row) => row.amount > 0);
}

function reconcile(invoices: InvoiceRow[], payments: PaymentRow[]) {
  const matches: MatchRow[] = [];
  const discrepancies: Discrepancy[] = [];
  const usedPayments = new Set<string>();
  const paymentUseCount = countBy(payments, (payment) => payment.invoiceId || `${payment.customer}:${payment.amount}`);

  for (const invoice of invoices) {
    const candidates = payments.filter((payment) =>
      payment.invoiceId === invoice.invoiceId ||
      (!payment.invoiceId && normalize(payment.customer) === normalize(invoice.customer) && Math.abs(payment.amount - invoice.amount) < 0.01)
    );
    const payment = candidates[0];
    if (!payment) {
      if (!["paid", "void", "cancelled"].includes(invoice.status)) {
        discrepancies.push(discrepancy("missing-payment", "high", invoice, null, invoice.amount, "Invoice has no matching payment.", "Confirm collection status or write off the invoice explicitly."));
      }
      continue;
    }

    usedPayments.add(payment.paymentId);
    const variance = round(payment.amount - invoice.amount);
    const status = variance === 0 ? "matched" : variance > 0 ? "overpaid" : "partial";
    matches.push({
      invoiceId: invoice.invoiceId,
      paymentId: payment.paymentId,
      customer: invoice.customer,
      invoiceAmount: invoice.amount,
      paymentAmount: payment.amount,
      variance,
      status,
    });

    if (variance > 0) {
      discrepancies.push(discrepancy("overpaid", "medium", invoice, payment, variance, "Payment exceeds invoice amount.", "Review whether the overage is a credit, duplicate payment, or allocation issue."));
    }
    if (variance < 0) {
      discrepancies.push(discrepancy("underpaid", "high", invoice, payment, Math.abs(variance), "Payment is lower than invoice amount.", "Collect remaining balance or document an approved discount."));
    }
    const key = payment.invoiceId || `${payment.customer}:${payment.amount}`;
    if (paymentUseCount.get(key)! > 1) {
      discrepancies.push(discrepancy("duplicate-payment", "high", invoice, payment, payment.amount, "Multiple payments appear to target the same invoice.", "Deduplicate payment records before closing the period."));
    }
  }

  for (const payment of payments) {
    if (!usedPayments.has(payment.paymentId)) {
      discrepancies.push(discrepancy("unmatched-payment", "medium", null, payment, payment.amount, "Payment does not match an invoice row.", "Map the payment to an invoice, credit memo, or customer prepayment."));
    }
  }

  return { matches, discrepancies };
}

function discrepancy(
  type: DiscrepancyType,
  severity: Severity,
  invoice: InvoiceRow | null,
  payment: PaymentRow | null,
  amount: number,
  note: string,
  recommendation: string,
): Discrepancy {
  return {
    type,
    severity,
    invoiceId: invoice?.invoiceId || payment?.invoiceId || "",
    paymentId: payment?.paymentId || "",
    customer: invoice?.customer || payment?.customer || "Unknown customer",
    amount: round(amount),
    note,
    recommendation,
  };
}

function buildAnomalies(invoices: InvoiceRow[], payments: PaymentRow[], matches: MatchRow[], discrepancies: Discrepancy[]) {
  const highSeverity = discrepancies.filter((item) => item.severity === "high");
  const openInvoiceTotal = invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    counts: {
      invoices: invoices.length,
      payments: payments.length,
      matches: matches.length,
      discrepancies: discrepancies.length,
      highSeverity: highSeverity.length,
    },
    notes: [
      openInvoiceTotal > 0 ? `Open invoice exposure totals ${round(openInvoiceTotal)} before reconciliation adjustments.` : "No open invoice exposure detected from status values.",
      highSeverity.length > 0 ? "High severity discrepancies need finance review before close." : "No high severity discrepancy pattern detected.",
      payments.length === 0 ? "No payment export was supplied, so all open invoices are treated as missing payments." : "Payment export supplied and matched against invoice identifiers and customer/amount fallback.",
    ],
  };
}

function buildSummary(
  options: ReconciliationOptions,
  invoices: InvoiceRow[],
  payments: PaymentRow[],
  matches: MatchRow[],
  discrepancies: Discrepancy[],
  anomalies: ReturnType<typeof buildAnomalies>,
) {
  const invoiceTotal = round(invoices.reduce((sum, invoice) => sum + invoice.amount, 0));
  const paymentTotal = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const varianceTotal = round(matches.reduce((sum, match) => sum + match.variance, 0));
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    company: options.company,
    currency: options.currency,
    invoiceCount: invoices.length,
    paymentCount: payments.length,
    matchCount: matches.length,
    discrepancyCount: discrepancies.length,
    invoiceTotal,
    paymentTotal,
    varianceTotal,
    highSeverityCount: anomalies.counts.highSeverity,
  };
}

function buildReport(
  options: ReconciliationOptions,
  summary: ReturnType<typeof buildSummary>,
  matches: MatchRow[],
  discrepancies: Discrepancy[],
  anomalies: ReturnType<typeof buildAnomalies>,
): string {
  return `# Invoice Reconciliation Report: ${options.company}

## Summary

| Metric | Value |
| --- | ---: |
| Invoices analyzed | ${summary.invoiceCount} |
| Payments analyzed | ${summary.paymentCount} |
| Matched invoices | ${summary.matchCount} |
| Discrepancies | ${summary.discrepancyCount} |
| Invoice total | ${money(summary.invoiceTotal, options.currency)} |
| Payment total | ${money(summary.paymentTotal, options.currency)} |
| Matched variance | ${money(summary.varianceTotal, options.currency)} |

## Matched Invoices

| Invoice | Payment | Customer | Invoice | Payment | Variance | Status |
| --- | --- | --- | ---: | ---: | ---: | --- |
${matches.map((row) => `| ${cell(row.invoiceId)} | ${cell(row.paymentId)} | ${cell(row.customer)} | ${money(row.invoiceAmount, options.currency)} | ${money(row.paymentAmount, options.currency)} | ${money(row.variance, options.currency)} | ${row.status} |`).join("\n") || "| - | - | - | - | - | - | No matches |"}

## Discrepancies

| Type | Severity | Invoice | Payment | Customer | Amount | Recommendation |
| --- | --- | --- | --- | --- | ---: | --- |
${discrepancies.map((row) => `| ${row.type} | ${row.severity} | ${cell(row.invoiceId || "-")} | ${cell(row.paymentId || "-")} | ${cell(row.customer)} | ${money(row.amount, options.currency)} | ${cell(row.recommendation)} |`).join("\n") || "| - | - | - | - | - | - | No discrepancy detected |"}

## Anomaly Notes

${anomalies.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function writeArtifacts(
  options: ReconciliationOptions,
  summary: ReturnType<typeof buildSummary>,
  matches: MatchRow[],
  discrepancies: Discrepancy[],
  anomalies: ReturnType<typeof buildAnomalies>,
  report: string,
) {
  const reportPath = join(options.outputDir, "reconciliation-report.md");
  const matchesPath = join(options.outputDir, "matched-invoices.csv");
  const discrepanciesPath = join(options.outputDir, "discrepancies.csv");
  const anomaliesPath = join(options.outputDir, "anomalies.json");
  const summaryPath = join(options.outputDir, "summary.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, report);
  writeFileSync(matchesPath, matchesCsv(matches));
  writeFileSync(discrepanciesPath, discrepanciesCsv(discrepancies));
  writeJson(anomaliesPath, anomalies);
  writeJson(summaryPath, summary);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      company: options.company,
      currency: options.currency,
      invoiceCount: summary.invoiceCount,
      paymentCount: summary.paymentCount,
    },
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      matches: toManifestPath(options.outputDir, matchesPath),
      discrepancies: toManifestPath(options.outputDir, discrepanciesPath),
      anomalies: toManifestPath(options.outputDir, anomaliesPath),
      summary: toManifestPath(options.outputDir, summaryPath),
    },
  });

  return {
    report: reportPath,
    matches: matchesPath,
    discrepancies: discrepanciesPath,
    anomalies: anomaliesPath,
    summary: summaryPath,
    manifest: manifestPath,
  };
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""]));
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function matchesCsv(rows: MatchRow[]): string {
  const headers = ["invoiceId", "paymentId", "customer", "invoiceAmount", "paymentAmount", "variance", "status"] as const;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(String(row[header]))).join(","))].join("\n") + "\n";
}

function discrepanciesCsv(rows: Discrepancy[]): string {
  const headers = ["type", "severity", "invoiceId", "paymentId", "customer", "amount", "note", "recommendation"] as const;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(String(row[header]))).join(","))].join("\n") + "\n";
}

function pick(row: Record<string, string>, keys: string[], fallback: string): string {
  const lowerMap = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lowerMap.get(key.toLowerCase());
    if (value) return value;
  }
  return fallback;
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  return counts;
}

function parseMoney(value: string): number {
  return round(Number(value.replace(/[$,\s]/g, "")) || 0);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
