#!/usr/bin/env bun
/**
 * Generate Mock Data Skill
 * Generate realistic mock/fake data using AI (GPT-4o-mini) or built-in generators
 */

import { parseArgs } from "util";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

import { generateDataAI } from "./ai";
import {
  formatCSV,
  formatJSON,
  formatSQL,
  formatTypeScript,
  generateOutputFilename,
} from "./formatters";
import { generateDataBuiltin } from "./generator";
import { ensureDir, log, LOGS_DIR, SESSION_ID, SESSION_TIMESTAMP } from "./logger";
import { PRESET_SCHEMAS } from "./presets";
import type { Locale, OutputFormat, Preset, SchemaField } from "./types";

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      preset: { type: "string" },
      count: { type: "string", default: "10" },
      schema: { type: "string" },
      format: { type: "string", default: "json" },
      locale: { type: "string", default: "en-US" },
      seed: { type: "string" },
      realistic: { type: "boolean", default: true },
      "no-ai": { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      table: { type: "string", default: "mock_data" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Generate Mock Data - Generate realistic mock/fake data using AI or built-in generators

Usage:
  bun run src/index.ts [options]

Options:
  --preset <preset>       Data preset (users, products, orders, companies, articles, reviews, events, transactions)
  --count <number>        Number of records to generate [default: 10]
  --schema <json|file>    JSON schema string or file path for custom data
  --format <format>       Output format (json, csv, sql, typescript) [default: json]
  --locale <locale>       Locale for localized data (en-US, de-DE, ja-JP, etc.) [default: en-US]
  --seed <string>         Seed for reproducible random results
  --realistic             Use AI for more realistic data [default: true]
  --no-ai                 Disable AI generation, use built-in generators only
  --output, -o <path>     Custom output file path
  --table <name>          Table name for SQL format [default: mock_data]
  --help, -h              Show this help

Presets:
  users, products, orders, companies, articles, reviews, events, transactions

Examples:
  bun run src/index.ts --preset users --count 100
  bun run src/index.ts --preset products --format csv --no-ai
  bun run src/index.ts --schema '{"name":"string","age":"number"}' --count 50
  bun run src/index.ts --preset orders --format sql --table orders
  bun run src/index.ts --preset users --locale de-DE --count 50
`);
    process.exit(0);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    // Parse options
    const count = parseInt(values.count || "10", 10);
    const format = (values.format?.toLowerCase() || "json") as OutputFormat;
    const locale = (values.locale || "en-US") as Locale;
    const realistic = values.realistic && !values["no-ai"];
    const table = values.table || "mock_data";

    // Validate format
    const validFormats: OutputFormat[] = ["json", "csv", "sql", "typescript"];
    if (!validFormats.includes(format)) {
      log(`Invalid format: ${format}. Valid formats: ${validFormats.join(", ")}`, "error");
      process.exit(1);
    }

    // Validate count
    if (isNaN(count) || count < 1) {
      log("Count must be a positive number", "error");
      process.exit(1);
    }

    if (count > 10000) {
      log("Warning: Large datasets (>10000) may take a long time", "info");
    }

    // Get schema
    let schema: SchemaField;

    if (values.schema) {
      // Custom schema from string or file
      let schemaContent = values.schema;

      if (existsSync(values.schema)) {
        log(`Loading schema from file: ${values.schema}`);
        schemaContent = readFileSync(values.schema, "utf-8");
      }

      try {
        schema = JSON.parse(schemaContent);
      } catch (error) {
        log(`Invalid JSON schema: ${error}`, "error");
        process.exit(1);
      }
    } else if (values.preset) {
      // Preset schema
      const preset = values.preset.toLowerCase() as Preset;

      if (!PRESET_SCHEMAS[preset]) {
        log(`Invalid preset: ${preset}. Valid presets: ${Object.keys(PRESET_SCHEMAS).join(", ")}`, "error");
        process.exit(1);
      }

      schema = PRESET_SCHEMAS[preset];
      log(`Using preset: ${preset}`);
    } else {
      log("Please provide either --preset or --schema", "error");
      process.exit(1);
    }

    // Generate data
    log(`Generating ${count} records...`);
    log(`Format: ${format}, Locale: ${locale}`);
    log(`Mode: ${realistic ? "AI (realistic)" : "Built-in (fast)"}`);

    let data: any[];

    if (realistic) {
      data = await generateDataAI(schema, count, locale);
    } else {
      data = await generateDataBuiltin(schema, count, values.seed, locale);
    }

    if (data.length === 0) {
      log("No data generated", "error");
      process.exit(1);
    }

    log(`Generated ${data.length} records`, "success");

    // Format data
    let output: string;

    switch (format) {
      case "json":
        output = formatJSON(data);
        break;
      case "csv":
        output = formatCSV(data);
        break;
      case "sql":
        output = formatSQL(data, table);
        break;
      case "typescript":
        output = formatTypeScript(data);
        break;
    }

    // Save to file
    const outputFile = values.output || generateOutputFilename(format);
    const outputDir = dirname(outputFile);

    ensureDir(outputDir);

    await Bun.write(outputFile, output);

    log(`Data saved to: ${outputFile}`, "success");

    // Show summary
    console.log(`\n✨ Mock data generated successfully!`);
    console.log(`   📊 Records: ${data.length}`);
    console.log(`   📄 Format: ${format}`);
    console.log(`   🌍 Locale: ${locale}`);
    console.log(`   🤖 Mode: ${realistic ? "AI" : "Built-in"}`);
    console.log(`   📁 Output: ${outputFile}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
