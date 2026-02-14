#!/usr/bin/env bun
/**
 * Advanced Math Skill
 * Performs advanced mathematical calculations, symbolic math, and numerical analysis
 *
 * Features:
 * - Basic arithmetic with arbitrary precision
 * - Scientific calculations (trig, log, exp, etc.)
 * - Statistics (mean, median, mode, std dev, variance, percentiles)
 * - Linear algebra (matrix operations, determinant, inverse, eigenvalues)
 * - Calculus (derivatives, integrals - symbolic using AI)
 * - Unit conversions (length, weight, temperature, time, data)
 * - Financial calculations (compound interest, NPV, IRR, loan payments)
 * - Number theory (prime check, factorization, GCD, LCM)
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import * as math from "mathjs";

// Types
type Mode = "calc" | "stats" | "matrix" | "convert" | "finance" | "symbolic";
type OutputFormat = "text" | "json" | "latex";
type NumberFormat = "number" | "scientific" | "fraction" | "percentage";
type MatrixOperation = "add" | "multiply" | "transpose" | "determinant" | "inverse" | "eigenvalues" | "rank" | "trace";
type FinanceType = "compound" | "simple" | "npv" | "irr" | "pmt" | "fv" | "pv";
type SymbolicOperation = "derivative" | "integral" | "simplify" | "factor" | "expand" | "solve";

interface MathOptions {
  mode: Mode;
  precision: number;
  format: NumberFormat;
  output: OutputFormat;
  showSteps: boolean;
  stats?: string;
  matrix?: MatrixOperation;
  from?: string;
  to?: string;
  finance?: FinanceType;
  principal?: number;
  rate?: number;
  years?: number;
  periods?: number;
  payment?: number;
  cashflows?: string;
  operation?: SymbolicOperation;
  var?: string;
}

interface Result {
  input: string | string[];
  mode: Mode;
  output: any;
  steps?: string[];
  formatted?: string;
  latex?: string;
}

// Constants
const SKILL_NAME = "skill-advanced-math";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Configure mathjs
const mathConfig = math.create(math.all, {
  number: "BigNumber",
  precision: 64,
});

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefixes = { 
    info: "ℹ️ ", 
    error: "❌ ", 
    success: "✅ " 
  };

  if (level === "error") {
    console.error(`${prefixes[level]} ${message}`);
  } else {
    console.log(`${prefixes[level]} ${message}`);
  }
}

// ============================================================================
// Calculator Mode
// ============================================================================
function evaluateExpression(expr: string, precision: number): any {
  try {
    // Configure precision
    mathConfig.config({ precision });

    const result = mathConfig.evaluate(expr);
    return result;
  } catch (error) {
    throw new Error(`Failed to evaluate expression: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// ============================================================================
// Statistics Mode
// ============================================================================
function calculateStatistics(data: number[], metrics?: string): any {
  const requestedMetrics = metrics?.split(",").map(m => m.trim()) || ["all"];
  const stats: any = {};

  if (requestedMetrics.includes("all") || requestedMetrics.includes("mean")) {
    stats.mean = mathConfig.mean(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("median")) {
    stats.median = mathConfig.median(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("mode")) {
    stats.mode = mathConfig.mode(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("std")) {
    stats.std = mathConfig.std(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("variance")) {
    stats.variance = mathConfig.variance(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("min")) {
    stats.min = mathConfig.min(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("max")) {
    stats.max = mathConfig.max(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("range")) {
    stats.range = mathConfig.max(data) - mathConfig.min(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("sum")) {
    stats.sum = mathConfig.sum(data);
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("count")) {
    stats.count = data.length;
  }

  if (requestedMetrics.includes("all") || requestedMetrics.includes("quartiles")) {
    const sorted = [...data].sort((a, b) => a - b);
    stats.quartiles = {
      q1: mathConfig.quantileSeq(sorted, 0.25),
      q2: mathConfig.quantileSeq(sorted, 0.5),
      q3: mathConfig.quantileSeq(sorted, 0.75),
    };
    stats.iqr = stats.quartiles.q3 - stats.quartiles.q1;
  }

  return stats;
}

// ============================================================================
// Matrix Mode
// ============================================================================
function performMatrixOperation(matrices: any[], operation: MatrixOperation): any {
  const matrix1 = mathConfig.matrix(matrices[0]);

  switch (operation) {
    case "add":
      if (matrices.length < 2) throw new Error("Addition requires two matrices");
      return mathConfig.add(matrix1, mathConfig.matrix(matrices[1]));

    case "multiply":
      if (matrices.length < 2) throw new Error("Multiplication requires two matrices");
      return mathConfig.multiply(matrix1, mathConfig.matrix(matrices[1]));

    case "transpose":
      return mathConfig.transpose(matrix1);

    case "determinant":
      return mathConfig.det(matrix1);

    case "inverse":
      return mathConfig.inv(matrix1);

    case "eigenvalues":
      return mathConfig.eigs(matrix1).values;

    case "rank":
      // mathjs doesn't have rank, approximate with determinant check
      const det = mathConfig.det(matrix1);
      return det !== 0 ? mathConfig.size(matrix1)[0] : "< " + mathConfig.size(matrix1)[0];

    case "trace":
      return mathConfig.trace(matrix1);

    default:
      throw new Error(`Unknown matrix operation: ${operation}`);
  }
}

// ============================================================================
// Unit Conversion Mode
// ============================================================================
const unitMappings: Record<string, string> = {
  // Length
  "meter": "m", "meters": "m", "m": "m",
  "kilometer": "km", "kilometers": "km", "km": "km",
  "centimeter": "cm", "centimeters": "cm", "cm": "cm",
  "millimeter": "mm", "millimeters": "mm", "mm": "mm",
  "mile": "mile", "miles": "mile",
  "yard": "yard", "yards": "yard",
  "foot": "ft", "feet": "ft", "ft": "ft",
  "inch": "inch", "inches": "inch", "in": "inch",

  // Mass
  "kilogram": "kg", "kilograms": "kg", "kg": "kg",
  "gram": "g", "grams": "g", "g": "g",
  "milligram": "mg", "milligrams": "mg", "mg": "mg",
  "pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
  "ounce": "oz", "ounces": "oz", "oz": "oz",
  "ton": "ton", "tons": "ton",

  // Time
  "second": "s", "seconds": "s", "s": "s", "sec": "s",
  "minute": "min", "minutes": "min", "min": "min",
  "hour": "hour", "hours": "hour", "hr": "hour", "h": "hour",
  "day": "day", "days": "day",
  "week": "week", "weeks": "week",
  "month": "month", "months": "month",
  "year": "year", "years": "year", "yr": "year",
};

function convertUnit(value: number, from: string, to: string): number {
  const fromUnit = unitMappings[from.toLowerCase()] || from;
  const toUnit = unitMappings[to.toLowerCase()] || to;

  // Handle temperature separately (not supported by mathjs unit system)
  if (["celsius", "fahrenheit", "kelvin"].includes(from.toLowerCase())) {
    return convertTemperature(value, from.toLowerCase(), to.toLowerCase());
  }

  // Handle data sizes separately
  if (["bit", "byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"].includes(from.toLowerCase())) {
    return convertDataSize(value, from.toLowerCase(), to.toLowerCase());
  }

  try {
    const result = mathConfig.evaluate(`${value} ${fromUnit} to ${toUnit}`);
    return Number(result.toNumeric(toUnit));
  } catch (error) {
    throw new Error(`Failed to convert ${from} to ${to}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function convertTemperature(value: number, from: string, to: string): number {
  let celsius: number;

  // Convert to Celsius first
  switch (from) {
    case "celsius": celsius = value; break;
    case "fahrenheit": celsius = (value - 32) * 5 / 9; break;
    case "kelvin": celsius = value - 273.15; break;
    default: throw new Error(`Unknown temperature unit: ${from}`);
  }

  // Convert from Celsius to target
  switch (to) {
    case "celsius": return celsius;
    case "fahrenheit": return celsius * 9 / 5 + 32;
    case "kelvin": return celsius + 273.15;
    default: throw new Error(`Unknown temperature unit: ${to}`);
  }
}

function convertDataSize(value: number, from: string, to: string): number {
  const bytes: Record<string, number> = {
    "bit": 0.125,
    "byte": 1,
    "kilobyte": 1024,
    "megabyte": 1024 ** 2,
    "gigabyte": 1024 ** 3,
    "terabyte": 1024 ** 4,
    "petabyte": 1024 ** 5,
  };

  const valueInBytes = value * bytes[from];
  return valueInBytes / bytes[to];
}

// ============================================================================
// Finance Mode
// ============================================================================
function calculateFinance(type: FinanceType, options: MathOptions): number {
  const { principal = 0, rate = 0, years = 0, periods, payment = 0, cashflows } = options;
  const r = rate / 100; // Convert percentage to decimal

  switch (type) {
    case "compound":
      // FV = PV * (1 + r)^n
      const n = periods || years;
      return principal * Math.pow(1 + r, n);

    case "simple":
      // FV = PV * (1 + r*n)
      return principal * (1 + r * years);

    case "npv":
      // NPV = sum(CF_t / (1+r)^t)
      if (!cashflows) throw new Error("Cash flows required for NPV");
      const flows = cashflows.split(",").map(Number);
      return flows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + r, t), 0);

    case "irr":
      // IRR calculation using Newton-Raphson method
      if (!cashflows) throw new Error("Cash flows required for IRR");
      return calculateIRR(cashflows.split(",").map(Number));

    case "pmt":
      // PMT = PV * (r * (1+r)^n) / ((1+r)^n - 1)
      const monthlyRate = r / 12;
      const numPayments = years * 12;
      return principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
             (Math.pow(1 + monthlyRate, numPayments) - 1);

    case "fv":
      // Future Value = PV * (1 + r)^n
      return principal * Math.pow(1 + r, years);

    case "pv":
      // Present Value = FV / (1 + r)^n
      return payment / Math.pow(1 + r, years);

    default:
      throw new Error(`Unknown finance type: ${type}`);
  }
}

function calculateIRR(cashflows: number[], guess: number = 0.1): number {
  const maxIterations = 100;
  const tolerance = 0.0001;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let t = 0; t < cashflows.length; t++) {
      npv += cashflows[t] / Math.pow(1 + rate, t);
      dnpv -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate * 100; // Return as percentage
    }

    rate = newRate;
  }

  throw new Error("IRR did not converge");
}

// ============================================================================
// Symbolic Math Mode (Using AI)
// ============================================================================
async function performSymbolicMath(
  expression: string,
  operation: SymbolicOperation,
  variable: string = "x",
  showSteps: boolean = false
): Promise<{ result: string; steps?: string[]; latex?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for symbolic math");
  }

  const prompt = buildSymbolicPrompt(expression, operation, variable, showSteps);

  log(`Performing symbolic ${operation} on: ${expression}`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a mathematics expert. Provide accurate symbolic mathematics solutions. Always show your work clearly and provide LaTeX formatting when requested.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  return parseSymbolicResponse(content, showSteps);
}

function buildSymbolicPrompt(expr: string, operation: SymbolicOperation, variable: string, showSteps: boolean): string {
  const basePrompts: Record<SymbolicOperation, string> = {
    derivative: `Calculate the derivative of the expression "${expr}" with respect to ${variable}.`,
    integral: `Calculate the indefinite integral of the expression "${expr}" with respect to ${variable}.`,
    simplify: `Simplify the expression "${expr}".`,
    factor: `Factor the expression "${expr}".`,
    expand: `Expand the expression "${expr}".`,
    solve: `Solve the equation "${expr}" for ${variable}.`,
  };

  let prompt = basePrompts[operation];

  if (showSteps) {
    prompt += "\n\nPlease show step-by-step solution with explanations.";
  }

  prompt += "\n\nFormat your response as follows:";
  prompt += "\nRESULT: [final answer]";

  if (showSteps) {
    prompt += "\nSTEPS:";
    prompt += "\n1. [step 1]";
    prompt += "\n2. [step 2]";
    prompt += "\n...";
  }

  prompt += "\nLATEX: [result in LaTeX format]";

  return prompt;
}

function parseSymbolicResponse(content: string, showSteps: boolean): { result: string; steps?: string[]; latex?: string } {
  const resultMatch = content.match(/RESULT:\s*(.+?)(?=\n|$)/i);
  const latexMatch = content.match(/LATEX:\s*(.+?)(?=\n|$)/i);

  const result: any = {
    result: resultMatch ? resultMatch[1].trim() : content,
  };

  if (showSteps) {
    const stepsMatch = content.match(/STEPS:([\s\S]+?)(?=LATEX:|$)/i);
    if (stepsMatch) {
      result.steps = stepsMatch[1]
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && /^\d+\./.test(s));
    }
  }

  if (latexMatch) {
    result.latex = latexMatch[1].trim();
  }

  return result;
}

// ============================================================================
// Formatting Functions
// ============================================================================
function formatNumber(value: any, format: NumberFormat, precision: number): string {
  // Convert mathjs BigNumber to regular number
  let num: number;
  if (value && typeof value === "object" && "toNumber" in value) {
    num = value.toNumber();
  } else if (typeof value === "number") {
    num = value;
  } else {
    num = Number(value);
  }

  switch (format) {
    case "scientific":
      return num.toExponential(precision);

    case "fraction":
      return mathConfig.format(mathConfig.fraction(num), { precision });

    case "percentage":
      return (num * 100).toFixed(precision) + "%";

    case "number":
    default:
      return num.toFixed(precision);
  }
}

function formatResult(result: Result, options: MathOptions): string {
  // Helper to convert BigNumber to string
  const toString = (val: any): string => {
    if (val && typeof val === "object" && "toString" in val) {
      return val.toString();
    }
    return String(val);
  };

  if (options.output === "json") {
    // Convert BigNumbers to strings for JSON
    const jsonResult = JSON.parse(JSON.stringify(result, (key, value) => {
      if (value && typeof value === "object" && "toString" in value) {
        return value.toString();
      }
      return value;
    }));
    return JSON.stringify(jsonResult, null, 2);
  }

  if (options.output === "latex" && result.latex) {
    return result.latex;
  }

  // Text format
  let output = `\n${"=".repeat(80)}\n`;
  output += `  Advanced Math - ${result.mode.toUpperCase()} Mode\n`;
  output += `${"=".repeat(80)}\n\n`;

  output += `Input: ${Array.isArray(result.input) ? result.input.join(", ") : result.input}\n\n`;

  if (typeof result.output === "object" && !Array.isArray(result.output) && result.output !== null && !("toNumber" in result.output)) {
    output += "Results:\n";
    for (const [key, value] of Object.entries(result.output)) {
      if (typeof value === "object" && value !== null && !("toNumber" in value)) {
        output += `  ${key}:\n`;
        for (const [k, v] of Object.entries(value as any)) {
          output += `    ${k}: ${toString(v)}\n`;
        }
      } else {
        output += `  ${key}: ${toString(value)}\n`;
      }
    }
  } else {
    output += `Result: ${result.formatted || toString(result.output)}\n`;
  }

  if (result.steps && result.steps.length > 0) {
    output += "\nSteps:\n";
    result.steps.forEach((step, i) => {
      output += `  ${i + 1}. ${step}\n`;
    });
  }

  if (result.latex) {
    output += `\nLaTeX: ${result.latex}\n`;
  }

  output += `\n${"=".repeat(80)}\n`;

  return output;
}

// ============================================================================
// Main Handler
// ============================================================================
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mode: { type: "string", default: "calc" },
      precision: { type: "string", default: "10" },
      format: { type: "string", default: "number" },
      output: { type: "string", default: "text" },
      "show-steps": { type: "boolean", default: false },
      stats: { type: "string" },
      matrix: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      finance: { type: "string" },
      principal: { type: "string" },
      rate: { type: "string" },
      years: { type: "string" },
      periods: { type: "string" },
      payment: { type: "string" },
      cashflows: { type: "string" },
      operation: { type: "string" },
      var: { type: "string", default: "x" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        ADVANCED MATH - Calculation Engine                      ║
║     Perform complex mathematical operations, statistics, and symbolic math     ║
╚═══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  skills run advanced-math -- "<expression or data>" [options]

MODES:
  calc      Basic expression evaluation and scientific calculations
  stats     Statistical analysis (mean, median, std dev, etc.)
  matrix    Matrix operations (determinant, inverse, eigenvalues)
  convert   Unit conversions (length, weight, temperature, etc.)
  finance   Financial calculations (compound interest, NPV, IRR)
  symbolic  AI-powered symbolic math (derivatives, integrals)

OPTIONS:
  --mode <mode>           Calculation mode [default: calc]
  --precision <n>         Decimal places [default: 10]
  --format <format>       Output format: number, scientific, fraction, percentage
  --output <format>       Result format: text, json, latex [default: text]
  --show-steps           Show calculation steps

CALC MODE:
  skills run advanced-math -- "2 + 2 * 3"
  skills run advanced-math -- "sin(pi/4) + cos(pi/4)"
  skills run advanced-math -- "sqrt(16) + log10(100)"

STATS MODE:
  skills run advanced-math -- "1,2,3,4,5" --mode stats
  skills run advanced-math -- "10,20,30" --mode stats --stats mean,median

MATRIX MODE:
  skills run advanced-math -- "[[1,2],[3,4]]" --mode matrix --matrix determinant
  skills run advanced-math -- "[[4,7],[2,6]]" --mode matrix --matrix inverse

CONVERT MODE:
  skills run advanced-math -- "100" --mode convert --from celsius --to fahrenheit
  skills run advanced-math -- "1" --mode convert --from kilometer --to mile

FINANCE MODE:
  skills run advanced-math -- --mode finance --finance compound --principal 1000 --rate 5 --years 10
  skills run advanced-math -- --mode finance --finance pmt --principal 200000 --rate 4.5 --years 30

SYMBOLIC MODE (requires OPENAI_API_KEY):
  skills run advanced-math -- "x^2 + 3*x" --mode symbolic --operation derivative --var x
  skills run advanced-math -- "2*x + 3" --mode symbolic --operation integral --show-steps

For full documentation, see SKILL.md
`);
    process.exit(0);
  }

  const input = positionals.join(" ");
  const mode = values.mode as Mode;
  const precision = parseInt(values.precision as string);

  if (isNaN(precision) || precision < 0 || precision > 100) {
    log("Error: Precision must be a number between 0 and 100", "error");
    process.exit(1);
  }

  const options: MathOptions = {
    mode,
    precision,
    format: values.format as NumberFormat,
    output: values.output as OutputFormat,
    showSteps: values["show-steps"] as boolean,
    stats: values.stats as string,
    matrix: values.matrix as MatrixOperation,
    from: values.from as string,
    to: values.to as string,
    finance: values.finance as FinanceType,
    principal: values.principal ? parseFloat(values.principal as string) : undefined,
    rate: values.rate ? parseFloat(values.rate as string) : undefined,
    years: values.years ? parseFloat(values.years as string) : undefined,
    periods: values.periods ? parseFloat(values.periods as string) : undefined,
    payment: values.payment ? parseFloat(values.payment as string) : undefined,
    cashflows: values.cashflows as string,
    operation: values.operation as SymbolicOperation,
    var: values.var as string,
  };

  try {
    log(`Session ID: ${SESSION_ID}`);
    log(`Mode: ${mode}`);

    let result: Result;

    switch (mode) {
      case "calc": {
        if (!input) throw new Error("Expression required for calc mode");
        const output = evaluateExpression(input, precision);
        const formatted = formatNumber(output, options.format, precision);
        result = { input, mode, output, formatted };
        break;
      }

      case "stats": {
        if (!input) throw new Error("Data required for stats mode");
        const data = input.split(",").map(v => parseFloat(v.trim()));
        if (data.some(isNaN)) throw new Error("Invalid data: must be comma-separated numbers");
        const output = calculateStatistics(data, options.stats);
        result = { input, mode, output };
        break;
      }

      case "matrix": {
        if (!input) throw new Error("Matrix required for matrix mode");
        if (!options.matrix) throw new Error("Matrix operation required (--matrix)");

        // Parse matrix/matrices from input
        let matrices;
        try {
          matrices = positionals.map(p => JSON.parse(p));
        } catch (e) {
          throw new Error("Invalid matrix format. Use JSON arrays e.g. [[1,2],[3,4]]");
        }
        const output = performMatrixOperation(matrices, options.matrix);
        const formatted = mathConfig.format(output, { precision });
        result = { input: positionals, mode, output, formatted };
        break;
      }

      case "convert": {
        if (!input) throw new Error("Value required for convert mode");
        if (!options.from || !options.to) throw new Error("--from and --to units required");

        const value = parseFloat(input);
        if (isNaN(value)) throw new Error("Invalid value for conversion");
        const output = convertUnit(value, options.from, options.to);
        const formatted = formatNumber(output, options.format, precision);
        result = { input: `${input} ${options.from}`, mode, output, formatted: `${formatted} ${options.to}` };
        break;
      }

      case "finance": {
        if (!options.finance) throw new Error("Finance type required (--finance)");
        const output = calculateFinance(options.finance, options);
        const formatted = formatNumber(output, options.format, precision);
        result = { input: options.finance, mode, output, formatted };
        break;
      }

      case "symbolic": {
        if (!input) throw new Error("Expression required for symbolic mode");
        if (!options.operation) throw new Error("Operation required (--operation)");

        const symbolicResult = await performSymbolicMath(
          input,
          options.operation,
          options.var,
          options.showSteps
        );

        result = {
          input,
          mode,
          output: symbolicResult.result,
          steps: symbolicResult.steps,
          latex: symbolicResult.latex,
        };
        break;
      }

      default:
        throw new Error(`Unknown mode: ${mode}`);
    }

    // Format and display result
    const outputText = formatResult(result, options);
    console.log(outputText);

    // Save to file if JSON or complex result
    if (options.output === "json" || mode === "stats") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);
      const outputFile = join(EXPORTS_DIR, `export_${timestamp}_${mode}.json`);
      ensureDir(EXPORTS_DIR);
      writeFileSync(outputFile, JSON.stringify(result, null, 2));
      log(`Results saved to: ${outputFile}`, "success");
    }

    log("Calculation completed successfully", "success");

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
