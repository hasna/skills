#!/usr/bin/env bun

import { writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { parseArguments } from "./cli";
import { EXPORTS_DIR, SESSION_ID, SKILL_NAME, ensureDir, getOpenAIApiKey, log } from "./runtime";
import { extractInvoiceData } from "./extractor";
import { formatAsCSV, formatAsJSON, formatAsMarkdown } from "./formatters";
import { validateFiles } from "./file-utils";
import type { ExtractionResult } from "./types";

async function main(): Promise<void> {
  const startTime = Date.now();

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  if (!getOpenAIApiKey()) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Get your API key from https://platform.openai.com/api-keys");
    process.exit(1);
  }

  const options = parseArguments();

  if (options.verbose) {
    log(`Options: ${JSON.stringify({ ...options, files: `${options.files.length} file(s)` })}`);
  }

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

  const { output, extension } = formatResults(results, options);

  ensureDir(EXPORTS_DIR);

  const outputFilename = options.output
    ? resolve(process.cwd(), options.output)
    : join(EXPORTS_DIR, `invoice-data.${extension}`);

  writeFileSync(outputFilename, output, "utf-8");
  log(`Output saved to: ${outputFilename}`, "success");

  printSummary(results, output, outputFilename, options.batch);

  const duration = Date.now() - startTime;
  log(`Completed in ${duration}ms`, "success");
}

function formatResults(
  results: ExtractionResult[],
  options: ReturnType<typeof parseArguments>,
): { output: string; extension: string } {
  switch (options.format) {
    case "csv":
      return { output: formatAsCSV(results), extension: "csv" };
    case "excel":
      log("Excel format outputs as CSV (compatible with Excel)", "info");
      return { output: formatAsCSV(results), extension: "csv" };
    case "markdown":
      return { output: formatAsMarkdown(results, options), extension: "md" };
    default:
      return { output: formatAsJSON(results, options), extension: "json" };
  }
}

function printSummary(
  results: ExtractionResult[],
  output: string,
  outputFilename: string,
  isBatch: boolean,
): void {
  console.log("\n" + "=".repeat(60) + "\n");

  const successful = results.filter((result) => result.success).length;
  const failed = results.filter((result) => !result.success).length;

  console.log("Extraction Summary:");
  console.log(`  Total files: ${results.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);
  console.log("");

  if (results.length === 1 && !isBatch) {
    console.log(output);
  } else {
    console.log(`Results saved to: ${outputFilename}`);
  }
}

main();
