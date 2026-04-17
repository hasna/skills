#!/usr/bin/env bun
import * as XLSX from "xlsx";
import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";
import { randomUUID } from "crypto";

const SKILL_NAME = "generate-excel";
const SESSION_ID = randomUUID().slice(0, 8);

// Environment variables
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
[EXPORTS_DIR, LOGS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Logging
const LOG_FILE = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);
  
  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Type definitions
interface ExcelCell {
  v: any; // value
  t?: string; // type
  s?: any; // style
  f?: string; // formula
}

interface SheetData {
  name: string;
  headers: string[];
  rows: any[][];
  formulas?: string[];
}

interface GenerateOptions {
  format: "xlsx" | "csv";
  preset?: string;
  rows: number;
  sheets?: string[];
  formulas: boolean;
  styling: "none" | "basic" | "professional";
  output?: string;
}

// Pre-built templates
const TEMPLATES: Record<string, (rows: number) => SheetData> = {
  budget: (rows: number) => ({
    name: "Budget",
    headers: ["Category", "Budgeted", "Actual", "Difference", "% of Budget"],
    rows: generateBudgetData(rows),
    formulas: ["=C{row}-B{row}", "=C{row}/B{row}"],
  }),

  invoice: (rows: number) => ({
    name: "Invoice",
    headers: ["Item", "Description", "Quantity", "Unit Price", "Total"],
    rows: generateInvoiceData(rows),
    formulas: ["=C{row}*D{row}"],
  }),

  inventory: (rows: number) => ({
    name: "Inventory",
    headers: ["SKU", "Product Name", "Category", "Quantity", "Reorder Level", "Status"],
    rows: generateInventoryData(rows),
    formulas: ['=IF(D{row}<=E{row},"REORDER","OK")'],
  }),

  schedule: (rows: number) => ({
    name: "Schedule",
    headers: ["Date", "Day", "Time", "Task", "Duration (hrs)", "Priority"],
    rows: generateScheduleData(rows),
  }),

  "sales-report": (rows: number) => ({
    name: "Sales",
    headers: ["Date", "Product", "Region", "Units Sold", "Unit Price", "Total Revenue"],
    rows: generateSalesData(rows),
    formulas: ["=D{row}*E{row}"],
  }),

  timesheet: (rows: number) => ({
    name: "Timesheet",
    headers: ["Date", "Employee", "Project", "Hours", "Rate", "Total"],
    rows: generateTimesheetData(rows),
    formulas: ["=D{row}*E{row}"],
  }),

  "project-tracker": (rows: number) => ({
    name: "Projects",
    headers: ["Project", "Owner", "Status", "Start Date", "Due Date", "Progress %", "Health"],
    rows: generateProjectData(rows),
    formulas: ['=IF(F{row}>=90,"On Track",IF(F{row}>=50,"At Risk","Behind"))'],
  }),
};

// Data generators
function generateBudgetData(rows: number): any[][] {
  const categories = [
    "Salary/Wages",
    "Rent/Mortgage",
    "Utilities",
    "Groceries",
    "Transportation",
    "Insurance",
    "Healthcare",
    "Entertainment",
    "Dining Out",
    "Shopping",
    "Savings",
    "Debt Payment",
  ];

  return Array.from({ length: Math.min(rows, categories.length) }, (_, i) => {
    const budgeted = Math.floor(Math.random() * 3000) + 500;
    const actual = budgeted + (Math.random() - 0.5) * 600;
    return [categories[i], budgeted, Math.round(actual)];
  });
}

function generateInvoiceData(rows: number): any[][] {
  const items = [
    ["Web Design", "Homepage redesign and responsive layout"],
    ["Development", "Frontend development with React"],
    ["SEO Services", "On-page optimization and content"],
    ["Consulting", "Strategy and planning sessions"],
    ["Maintenance", "Monthly website maintenance"],
    ["Hosting", "Cloud hosting and CDN services"],
  ];

  return Array.from({ length: rows }, (_, i) => {
    const [item, desc] = items[i % items.length];
    const qty = Math.floor(Math.random() * 10) + 1;
    const price = Math.floor(Math.random() * 200) + 50;
    return [item, desc, qty, price];
  });
}

function generateInventoryData(rows: number): any[][] {
  const categories = ["Electronics", "Furniture", "Office Supplies", "Hardware", "Software"];
  const products = [
    "Laptop",
    "Monitor",
    "Keyboard",
    "Mouse",
    "Desk",
    "Chair",
    "Paper",
    "Pens",
    "Stapler",
    "Cables",
  ];

  return Array.from({ length: rows }, (_, i) => {
    const sku = `SKU-${(1000 + i).toString().padStart(4, "0")}`;
    const product = products[i % products.length];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const quantity = Math.floor(Math.random() * 200);
    const reorder = Math.floor(Math.random() * 50) + 10;
    return [sku, product, category, quantity, reorder];
  });
}

function generateScheduleData(rows: number): any[][] {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const tasks = [
    "Team Meeting",
    "Client Call",
    "Development",
    "Code Review",
    "Planning",
    "Testing",
    "Documentation",
  ];
  const priorities = ["High", "Medium", "Low"];

  const startDate = new Date();
  return Array.from({ length: rows }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const day = days[date.getDay()];
    const hour = Math.floor(Math.random() * 8) + 9;
    const time = `${hour}:00 - ${hour + 2}:00`;
    const task = tasks[Math.floor(Math.random() * tasks.length)];
    const duration = Math.floor(Math.random() * 4) + 1;
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    return [date.toISOString().split("T")[0], day, time, task, duration, priority];
  });
}

function generateSalesData(rows: number): any[][] {
  const products = [
    "Product A",
    "Product B",
    "Product C",
    "Product D",
    "Product E",
  ];
  const regions = ["North", "South", "East", "West", "Central"];

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  return Array.from({ length: rows }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i * 2);
    const product = products[Math.floor(Math.random() * products.length)];
    const region = regions[Math.floor(Math.random() * regions.length)];
    const units = Math.floor(Math.random() * 100) + 10;
    const price = Math.floor(Math.random() * 100) + 20;
    return [date.toISOString().split("T")[0], product, region, units, price];
  });
}

function generateTimesheetData(rows: number): any[][] {
  const employees = ["John Smith", "Jane Doe", "Bob Johnson", "Alice Williams", "Charlie Brown"];
  const projects = ["Project Alpha", "Project Beta", "Project Gamma", "Internal", "Training"];

  const startDate = new Date();
  startDate.setDate(1);

  return Array.from({ length: rows }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + Math.floor(i / 5));
    const employee = employees[i % employees.length];
    const project = projects[Math.floor(Math.random() * projects.length)];
    const hours = Math.floor(Math.random() * 8) + 1;
    const rate = Math.floor(Math.random() * 100) + 50;
    return [date.toISOString().split("T")[0], employee, project, hours, rate];
  });
}

function generateProjectData(rows: number): any[][] {
  const statuses = ["Not Started", "In Progress", "On Hold", "Completed"];
  const owners = ["John Smith", "Jane Doe", "Bob Johnson", "Alice Williams"];

  const startDate = new Date();
  return Array.from({ length: rows }, (_, i) => {
    const project = `Project ${String.fromCharCode(65 + i)}`;
    const owner = owners[Math.floor(Math.random() * owners.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const start = new Date(startDate);
    start.setMonth(start.getMonth() - Math.floor(Math.random() * 6));
    const due = new Date(start);
    due.setMonth(due.getMonth() + Math.floor(Math.random() * 6) + 1);
    const progress = Math.floor(Math.random() * 100);
    return [
      project,
      owner,
      status,
      start.toISOString().split("T")[0],
      due.toISOString().split("T")[0],
      progress,
    ];
  });
}

// AI-powered data generation
async function generateDataFromPrompt(
  prompt: string,
  rows: number
): Promise<SheetData> {
  log(`Generating data from prompt using AI...`);

  const systemPrompt = `You are a data generation assistant. Generate realistic spreadsheet data based on user descriptions.
Return a JSON object with:
{
  "name": "Sheet name",
  "headers": ["Column1", "Column2", ...],
  "rows": [[value1, value2, ...], ...],
  "formulas": ["=A{row}+B{row}", ...] (optional, use {row} placeholder for row number)
}

Generate exactly ${rows} rows of data. Make the data realistic and varied.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  return JSON.parse(content);
}

// Parse JSON data
function parseJsonData(jsonString: string): SheetData {
  const data = JSON.parse(jsonString);

  if (data.headers && data.rows) {
    return {
      name: data.name || "Sheet1",
      headers: data.headers,
      rows: data.rows,
      formulas: data.formulas,
    };
  }

  // If it's just an array, treat first row as headers
  if (Array.isArray(data)) {
    return {
      name: "Sheet1",
      headers: data[0],
      rows: data.slice(1),
    };
  }

  throw new Error("Invalid JSON format. Expected {headers: [...], rows: [[...]]}");
}

// Apply styling to worksheet
function applyStyles(
  ws: XLSX.WorkSheet,
  sheetData: SheetData,
  styling: "none" | "basic" | "professional"
) {
  if (styling === "none") return;

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  // Header styling
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellRef]) continue;

    ws[cellRef].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: styling === "professional" ? "4472C4" : "366092" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } },
      },
    };
  }

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  // Auto-fit column widths
  const colWidths = sheetData.headers.map((header, i) => {
    let maxWidth = header.length;
    for (let row = 0; row < sheetData.rows.length; row++) {
      const value = String(sheetData.rows[row][i] || "");
      maxWidth = Math.max(maxWidth, value.length);
    }
    return { wch: Math.min(maxWidth + 2, 50) };
  });
  ws["!cols"] = colWidths;

  // Professional styling: alternate row colors
  if (styling === "professional") {
    for (let row = 1; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellRef]) continue;

        ws[cellRef].s = {
          ...ws[cellRef].s,
          fill: {
            fgColor: { rgb: row % 2 === 0 ? "F2F2F2" : "FFFFFF" },
          },
        };
      }
    }
  }
}

// Add formulas to worksheet
function addFormulas(
  ws: XLSX.WorkSheet,
  sheetData: SheetData,
  startRow: number = 2
) {
  if (!sheetData.formulas || sheetData.formulas.length === 0) return;

  const dataRowCount = sheetData.rows.length;

  sheetData.formulas.forEach((formulaTemplate, colOffset) => {
    const formulaCol = sheetData.headers.length + colOffset;

    for (let i = 0; i < dataRowCount; i++) {
      const row = startRow + i;
      const formula = formulaTemplate.replace(/{row}/g, row.toString());
      const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: formulaCol });
      ws[cellRef] = { f: formula, t: "n" };
    }
  });
}

// Add summary row with totals
function addSummaryRow(
  ws: XLSX.WorkSheet,
  sheetData: SheetData
): void {
  const lastRow = sheetData.rows.length + 1;

  // Add "Total" label
  const labelCell = XLSX.utils.encode_cell({ r: lastRow, c: 0 });
  ws[labelCell] = { v: "TOTAL", t: "s", s: { font: { bold: true } } };

  // Add SUM formulas for numeric columns
  sheetData.headers.forEach((header, col) => {
    if (col === 0) return; // Skip label column

    const firstDataRow = 2;
    const lastDataRow = lastRow;

    // Check if column contains numbers
    const sampleValue = sheetData.rows[0]?.[col];
    if (typeof sampleValue === "number") {
      const colLetter = XLSX.utils.encode_col(col);
      const formula = `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})`;
      const cellRef = XLSX.utils.encode_cell({ r: lastRow, c: col });
      ws[cellRef] = {
        f: formula,
        t: "n",
        s: { font: { bold: true }, border: { top: { style: "double" } } },
      };
    }
  });
}

// Create workbook
function createWorkbook(
  sheets: SheetData[],
  options: GenerateOptions
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  sheets.forEach((sheetData) => {
    // Add formulas to headers if needed
    const headers = [...sheetData.headers];
    if (sheetData.formulas && options.formulas) {
      sheetData.formulas.forEach((_, i) => {
        headers.push(`Calculated ${i + 1}`);
      });
    }

    // Create worksheet with headers and data
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sheetData.rows]);

    // Apply formulas
    if (sheetData.formulas && options.formulas) {
      addFormulas(ws, sheetData);
    }

    // Apply styling
    applyStyles(ws, sheetData, options.styling);

    // Add summary row for financial sheets
    if (["budget", "invoice", "sales-report", "timesheet"].includes(options.preset || "")) {
      addSummaryRow(ws, sheetData);
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetData.name);
  });

  return wb;
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: { type: "string", default: "xlsx" },
      preset: { type: "string" },
      rows: { type: "string", default: "10" },
      sheets: { type: "string" },
      formulas: { type: "boolean", default: false },
      styling: { type: "string", default: "professional" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Generate Excel - Create Excel spreadsheets with data and formatting

Usage:
  skills run generate-excel -- [options] <description>

Options:
  --format <fmt>       Output format: xlsx, csv (default: xlsx)
  --preset <name>      Use a preset template (budget, invoice, inventory, schedule, sales-report, timesheet, project-tracker)
  --rows <n>           Number of rows to generate (default: 10)
  --sheets <list>      Comma-separated sheet names
  --formulas           Include formulas
  --styling <style>    Styling level: none, basic, professional (default: professional)
  --output <path>      Output file path
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const prompt = positionals[0];

  log(`Starting ${SKILL_NAME} skill`);
  log(`Session ID: ${SESSION_ID}`);

  // Validate options
  const options: GenerateOptions = {
    format: (values.format as "xlsx" | "csv") || "xlsx",
    preset: values.preset as string | undefined,
    rows: parseInt(values.rows as string) || 10,
    sheets: values.sheets ? (values.sheets as string).split(",") : undefined,
    formulas: values.formulas as boolean,
    styling: (values.styling as "none" | "basic" | "professional") || "professional",
    output: values.output as string | undefined,
  };

  log(`Options: ${JSON.stringify(options, null, 2)}`);

  // Generate sheet data
  let sheets: SheetData[] = [];

  if (options.preset && TEMPLATES[options.preset]) {
    log(`Using preset template: ${options.preset}`);
    sheets = [TEMPLATES[options.preset](options.rows)];
  } else if (options.sheets && options.sheets.length > 0) {
    log(`Generating multi-sheet workbook: ${options.sheets.join(", ")}`);
    for (const sheetName of options.sheets) {
      const sheetData = await generateDataFromPrompt(
        `${prompt || "Generate data for"} ${sheetName}`,
        options.rows
      );
      sheetData.name = sheetName;
      sheets.push(sheetData);
    }
  } else if (prompt) {
    // Check if prompt is JSON
    if (prompt.trim().startsWith("{") || prompt.trim().startsWith("[")) {
      log("Parsing JSON data...");
      try {
        sheets = [parseJsonData(prompt)];
      } catch (error) {
        log(`JSON parsing failed, treating as natural language prompt`);
        sheets = [await generateDataFromPrompt(prompt, options.rows)];
      }
    } else {
      sheets = [await generateDataFromPrompt(prompt, options.rows)];
    }
  } else {
    console.error("Error: No prompt, preset, or data provided");
    console.error("\nUsage:");
    console.error('  skills run generate-excel -- "description"');
    console.error("  skills run generate-excel -- --preset budget");
    console.error('  skills run generate-excel -- \'{"headers": [...], "rows": [...]}\'');
    process.exit(1);
  }

  // Create workbook
  log(`Creating ${options.format.toUpperCase()} file...`);
  const wb = createWorkbook(sheets, options);

  // Generate output filename
  const timestamp = new Date().toISOString().split("T")[0];
  const defaultFilename = options.preset
    ? `${options.preset}-${timestamp}.${options.format}`
    : `spreadsheet-${timestamp}.${options.format}`;

  const outputPath = options.output
    ? join(process.cwd(), options.output)
    : join(EXPORTS_DIR, defaultFilename);

  // Write file
  XLSX.writeFile(wb, outputPath, {
    bookType: options.format === "csv" ? "csv" : "xlsx",
  });

  log(`File saved to: ${outputPath}`);
  console.log(`\nSuccess! File created: ${outputPath}`);
  console.log(`Sheets: ${sheets.map((s) => s.name).join(", ")}`);
  console.log(`Total rows: ${sheets.reduce((sum, s) => sum + s.rows.length, 0)}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  log(`Error: ${error.message}`);
  process.exit(1);
});
