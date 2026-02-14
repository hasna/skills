#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve, basename, extname } from "path";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Constants
const SKILL_NAME = "skill-extract-invoice";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "_")
  .replace(/-/g, "_")
  .slice(0, 19)
  .toLowerCase();

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// API Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Types
interface InvoiceData {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  po_number: string | null;
  payment_terms: string | null;
  vendor: VendorInfo;
  customer: CustomerInfo;
  line_items: LineItem[];
  subtotal: number | null;
  tax: TaxInfo | null;
  discount: DiscountInfo | null;
  shipping: number | null;
  total: number | null;
  currency: string;
  payment_info: PaymentInfo | null;
  notes: string | null;
  confidence: number;
  raw_text?: string;
}

interface VendorInfo {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  website: string | null;
}

interface CustomerInfo {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface LineItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  tax_rate: number | null;
  subtotal: number | null;
  discount: number | null;
}

interface TaxInfo {
  rate: number | null;
  amount: number;
  type?: string;
}

interface DiscountInfo {
  type: "percentage" | "fixed" | null;
  value: number | null;
  amount: number;
}

interface PaymentInfo {
  method: string | null;
  bank_name: string | null;
  account_number: string | null;
  routing_number: string | null;
  iban: string | null;
  swift: string | null;
  reference: string | null;
}

interface ExtractionResult {
  file: string;
  success: boolean;
  data: InvoiceData | null;
  error?: string;
  processing_time_ms: number;
}

interface Options {
  files: string[];
  format: "json" | "csv" | "excel" | "markdown";
  confidence: boolean;
  currency?: string;
  language?: string;
  pages?: string;
  batch: boolean;
  output?: string;
  verbose: boolean;
}

// Supported file types
const SUPPORTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".heic", ".webp"];

// Utility functions
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" | "warn" = "info"): void {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefixes: Record<string, string> = {
    info: "[INFO]",
    error: "[ERROR]",
    success: "[SUCCESS]",
    warn: "[WARN]",
  };

  console.log(`${prefixes[level]} ${message}`);
}

function parseArguments(): Options {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: { type: "string", default: "json" },
      confidence: { type: "boolean", default: false },
      currency: { type: "string" },
      language: { type: "string" },
      pages: { type: "string" },
      batch: { type: "boolean", default: false },
      output: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const files: string[] = [];
  for (const arg of positionals) {
    if (arg.includes("*")) {
      const expandedFiles = expandGlob(arg);
      files.push(...expandedFiles);
    } else {
      files.push(resolve(process.cwd(), arg));
    }
  }

  return {
    files,
    format: values.format as "json" | "csv" | "excel" | "markdown",
    confidence: values.confidence as boolean,
    currency: values.currency as string,
    language: values.language as string,
    pages: values.pages as string,
    batch: values.batch as boolean,
    output: values.output as string,
    verbose: values.verbose as boolean,
  };
}

function expandGlob(pattern: string): string[] {
  const dir = pattern.includes("/") ? pattern.substring(0, pattern.lastIndexOf("/")) : ".";
  const filePattern = pattern.includes("/") ? pattern.substring(pattern.lastIndexOf("/") + 1) : pattern;
  const regex = new RegExp("^" + filePattern.replace(/\*/g, ".*") + "$");

  const resolvedDir = resolve(process.cwd(), dir);
  if (!existsSync(resolvedDir)) {
    return [];
  }

  return readdirSync(resolvedDir)
    .filter((file) => regex.test(file))
    .map((file) => join(resolvedDir, file))
    .filter((file) => {
      const ext = extname(file).toLowerCase();
      return SUPPORTED_EXTENSIONS.includes(ext);
    });
}

function printHelp(): void {
  console.log(`
Extract Invoice - AI-powered invoice data extraction

Usage:
  skills run extract-invoice -- <file(s)> [options]

Arguments:
  file(s)               Invoice file(s) to process (PDF, PNG, JPG, etc.)

Options:
  --format <format>     Output format: json, csv, excel, markdown (default: json)
  --confidence          Include confidence scores for extracted fields
  --currency <code>     Convert totals to specified currency (e.g., USD, EUR)
  --language <lang>     Document language hint (e.g., en, es, fr)
  --pages <range>       Pages to process (e.g., "1-3,5")
  --batch               Process multiple files and combine output
  --output <file>       Output file path
  --verbose             Show detailed progress
  --help, -h            Show this help

Examples:
  skills run extract-invoice -- invoice.pdf
  skills run extract-invoice -- receipt.jpg --format csv
  skills run extract-invoice -- ./invoices/*.pdf --batch
  skills run extract-invoice -- invoice.pdf --confidence --verbose

Supported file types:
  PDF, PNG, JPG, JPEG, TIFF, HEIC, WebP
`);
}

function validateFiles(files: string[]): string[] {
  const validFiles: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) {
      log(`File not found: ${file}`, "warn");
      continue;
    }

    const ext = extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      log(`Unsupported file type: ${file}`, "warn");
      continue;
    }

    validFiles.push(file);
  }

  return validFiles;
}

function fileToBase64(filePath: string): string {
  const buffer = readFileSync(filePath);
  return buffer.toString("base64");
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".heic": "image/heic",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function extractInvoiceData(filePath: string, options: Options): Promise<InvoiceData> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const base64Content = fileToBase64(filePath);
  const mimeType = getMimeType(filePath);

  if (options.verbose) {
    log(`Processing ${basename(filePath)} (${mimeType})...`);
  }

  const systemPrompt = `You are an expert invoice data extraction system. Extract all relevant information from the provided invoice image/document and return it as structured JSON.

Be thorough and extract:
- Invoice details (number, dates, PO number, payment terms)
- Vendor information (name, address, contact, tax ID)
- Customer/Bill-to information
- All line items with quantities, prices, and totals
- Tax calculations
- Discounts if any
- Grand total and currency
- Payment information (bank details, references)
- Any notes or special instructions

For amounts, extract numeric values without currency symbols.
For dates, use ISO format (YYYY-MM-DD) when possible.
Estimate your confidence in the extraction (0-100).

${options.language ? `The document is in ${options.language}.` : "Detect the document language automatically."}
${options.currency ? `Convert all amounts to ${options.currency} if possible.` : "Detect and preserve the original currency."}`;

  const userPrompt = `Extract all invoice data from this document and return it as JSON matching this structure:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "po_number": "string or null",
  "payment_terms": "string or null",
  "vendor": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null",
    "tax_id": "string or null",
    "website": "string or null"
  },
  "customer": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "line_items": [
    {
      "description": "string",
      "quantity": number or null,
      "unit": "string or null",
      "unit_price": number or null,
      "tax_rate": number or null,
      "subtotal": number or null,
      "discount": number or null
    }
  ],
  "subtotal": number or null,
  "tax": {
    "rate": number or null,
    "amount": number,
    "type": "string or null"
  },
  "discount": {
    "type": "percentage or fixed or null",
    "value": number or null,
    "amount": number
  },
  "shipping": number or null,
  "total": number or null,
  "currency": "USD, EUR, etc.",
  "payment_info": {
    "method": "string or null",
    "bank_name": "string or null",
    "account_number": "string or null (masked if sensitive)",
    "routing_number": "string or null",
    "iban": "string or null (masked)",
    "swift": "string or null",
    "reference": "string or null"
  },
  "notes": "string or null",
  "confidence": number (0-100)
}

Return ONLY the JSON object, no markdown formatting or explanation.`;

  const requestBody = {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Content}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  const content = result.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No response from OpenAI API");
  }

  // Parse the JSON response
  try {
    // Remove markdown code blocks if present
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith("```")) {
      jsonStr = jsonStr.slice(0, -3);
    }

    const invoiceData: InvoiceData = JSON.parse(jsonStr.trim());
    return invoiceData;
  } catch (parseError) {
    log(`Failed to parse API response: ${content}`, "error");
    throw new Error("Failed to parse invoice data from API response");
  }
}

function formatAsJSON(results: ExtractionResult[], options: Options): string {
  if (results.length === 1 && !options.batch) {
    const result = results[0];
    if (result.success && result.data) {
      if (!options.confidence) {
        const { confidence, ...dataWithoutConfidence } = result.data;
        return JSON.stringify(dataWithoutConfidence, null, 2);
      }
      return JSON.stringify(result.data, null, 2);
    }
    return JSON.stringify({ error: result.error }, null, 2);
  }

  // Batch output
  const output = {
    processed_at: new Date().toISOString(),
    total_files: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results: results.map((r) => ({
      file: basename(r.file),
      success: r.success,
      data: r.data,
      error: r.error,
      processing_time_ms: r.processing_time_ms,
    })),
  };

  return JSON.stringify(output, null, 2);
}

function formatAsCSV(results: ExtractionResult[]): string {
  const headers = [
    "file",
    "invoice_number",
    "invoice_date",
    "due_date",
    "vendor_name",
    "vendor_address",
    "customer_name",
    "subtotal",
    "tax_amount",
    "total",
    "currency",
    "status",
  ];

  const rows: string[][] = [headers];

  for (const result of results) {
    if (result.success && result.data) {
      const d = result.data;
      rows.push([
        basename(result.file),
        d.invoice_number || "",
        d.invoice_date || "",
        d.due_date || "",
        d.vendor.name || "",
        d.vendor.address || "",
        d.customer.name || "",
        d.subtotal?.toString() || "",
        d.tax?.amount?.toString() || "",
        d.total?.toString() || "",
        d.currency || "",
        "success",
      ]);
    } else {
      rows.push([
        basename(result.file),
        "", "", "", "", "", "", "", "", "", "",
        `error: ${result.error}`,
      ]);
    }
  }

  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function formatAsMarkdown(results: ExtractionResult[], options: Options): string {
  let output = "# Invoice Extraction Results\n\n";
  output += `Processed: ${new Date().toISOString()}\n\n`;

  for (const result of results) {
    output += `---\n\n`;
    output += `## ${basename(result.file)}\n\n`;

    if (!result.success) {
      output += `**Error:** ${result.error}\n\n`;
      continue;
    }

    const d = result.data!;

    output += `### Invoice Details\n\n`;
    output += `| Field | Value |\n`;
    output += `|-------|-------|\n`;
    output += `| Invoice Number | ${d.invoice_number || "N/A"} |\n`;
    output += `| Date | ${d.invoice_date || "N/A"} |\n`;
    output += `| Due Date | ${d.due_date || "N/A"} |\n`;
    output += `| PO Number | ${d.po_number || "N/A"} |\n`;
    output += `| Payment Terms | ${d.payment_terms || "N/A"} |\n\n`;

    output += `### Vendor\n\n`;
    output += `**${d.vendor.name || "Unknown Vendor"}**\n`;
    if (d.vendor.address) output += `${d.vendor.address}\n`;
    if (d.vendor.email) output += `Email: ${d.vendor.email}\n`;
    if (d.vendor.phone) output += `Phone: ${d.vendor.phone}\n`;
    if (d.vendor.tax_id) output += `Tax ID: ${d.vendor.tax_id}\n`;
    output += "\n";

    if (d.customer.name) {
      output += `### Customer\n\n`;
      output += `**${d.customer.name}**\n`;
      if (d.customer.address) output += `${d.customer.address}\n`;
      if (d.customer.email) output += `Email: ${d.customer.email}\n`;
      output += "\n";
    }

    if (d.line_items.length > 0) {
      output += `### Line Items\n\n`;
      output += `| Description | Qty | Unit Price | Subtotal |\n`;
      output += `|-------------|-----|------------|----------|\n`;
      for (const item of d.line_items) {
        output += `| ${item.description} | ${item.quantity || "-"} ${item.unit || ""} | ${item.unit_price?.toFixed(2) || "-"} | ${item.subtotal?.toFixed(2) || "-"} |\n`;
      }
      output += "\n";
    }

    output += `### Totals\n\n`;
    if (d.subtotal) output += `- **Subtotal:** ${d.currency} ${d.subtotal.toFixed(2)}\n`;
    if (d.tax) output += `- **Tax${d.tax.rate ? ` (${d.tax.rate}%)` : ""}:** ${d.currency} ${d.tax.amount.toFixed(2)}\n`;
    if (d.discount) output += `- **Discount:** -${d.currency} ${d.discount.amount.toFixed(2)}\n`;
    if (d.shipping) output += `- **Shipping:** ${d.currency} ${d.shipping.toFixed(2)}\n`;
    output += `- **Total:** ${d.currency} ${d.total?.toFixed(2) || "N/A"}\n\n`;

    if (d.notes) {
      output += `### Notes\n\n${d.notes}\n\n`;
    }

    if (options.confidence) {
      output += `*Extraction confidence: ${d.confidence}%*\n\n`;
    }
  }

  return output;
}

// Main execution
async function main(): Promise<void> {
  const startTime = Date.now();

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  // Check for API key
  if (!OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Get your API key from https://platform.openai.com/api-keys");
    process.exit(1);
  }

  const options = parseArguments();

  if (options.verbose) {
    log(`Options: ${JSON.stringify({ ...options, files: options.files.length + " file(s)" })}`);
  }

  // Validate input
  if (options.files.length === 0) {
    console.error("Error: Please specify at least one invoice file.");
    console.error("\nExample: skills run extract-invoice -- invoice.pdf");
    process.exit(1);
  }

  const validFiles = validateFiles(options.files);
  if (validFiles.length === 0) {
    console.error("Error: No valid files to process.");
    process.exit(1);
  }

  log(`Processing ${validFiles.length} file(s)...`);

  const results: ExtractionResult[] = [];

  for (const file of validFiles) {
    const fileStartTime = Date.now();
    log(`Extracting data from ${basename(file)}...`);

    try {
      const data = await extractInvoiceData(file, options);
      results.push({
        file,
        success: true,
        data,
        processing_time_ms: Date.now() - fileStartTime,
      });
      log(`Successfully extracted data from ${basename(file)}`, "success");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        file,
        success: false,
        data: null,
        error: errorMessage,
        processing_time_ms: Date.now() - fileStartTime,
      });
      log(`Failed to extract data from ${basename(file)}: ${errorMessage}`, "error");
    }
  }

  // Format output
  let output: string;
  let extension: string;

  switch (options.format) {
    case "csv":
      output = formatAsCSV(results);
      extension = "csv";
      break;
    case "excel":
      // For Excel, we output CSV which can be opened in Excel
      output = formatAsCSV(results);
      extension = "csv";
      log("Excel format outputs as CSV (compatible with Excel)", "info");
      break;
    case "markdown":
      output = formatAsMarkdown(results, options);
      extension = "md";
      break;
    default:
      output = formatAsJSON(results, options);
      extension = "json";
  }

  // Ensure export directory exists
  ensureDir(EXPORTS_DIR);

  // Determine output filename
  const outputFilename = options.output
    ? resolve(process.cwd(), options.output)
    : join(EXPORTS_DIR, `invoice-data.${extension}`);

  // Save to file
  writeFileSync(outputFilename, output, "utf-8");
  log(`Output saved to: ${outputFilename}`, "success");

  // Print summary
  console.log("\n" + "=".repeat(60) + "\n");

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`Extraction Summary:`);
  console.log(`  Total files: ${results.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);
  console.log("");

  // Print output for single file
  if (results.length === 1 && !options.batch) {
    console.log(output);
  } else {
    console.log(`Results saved to: ${outputFilename}`);
  }

  const duration = Date.now() - startTime;
  log(`Completed in ${duration}ms`, "success");
}

main();
