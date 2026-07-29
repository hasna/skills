#!/usr/bin/env bun

/**
 * Analyze Data Skill
 *
 * Comprehensive data analysis for CSV and JSON files with statistics,
 * quality checks, correlation detection, and trend analysis.
 */

import { statSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { analyzeData } from './analysis';
import { parseArguments } from './cli';
import { formatHTML, formatMarkdown } from './formatters';
import { log, SESSION_ID, SKILL_NAME } from './logger';

async function main() {
  try {
    log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);
    const { filePath, options } = parseArguments();

    // Check if file exists
    try {
      statSync(filePath);
    } catch {
      log(`Error: File not found: ${filePath}`, 'error');
      process.exit(1);
    }

    // Perform analysis
    const report = await analyzeData(filePath, options);

    // Format output
    let output: string;
    switch (options.format) {
      case 'json':
        output = JSON.stringify(report, null, 2);
        break;
      case 'html':
        output = formatHTML(report);
        break;
      default:
        output = formatMarkdown(report);
    }

    // Save or print
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, output, 'utf-8');
      log(`Report saved to: ${outputPath}`, 'success');
    } else {
      console.log(output);
    }

    // Show summary in verbose mode
    if (options.verbose) {
      log('Analysis Complete', 'success');
      log(`Rows: ${report.overview.rowCount}`);
      log(`Columns: ${report.overview.columnCount}`);
      log(`Quality Score: ${report.quality.dataQualityScore}/100`);
      log(`Processing Time: ${report.overview.processingTime}ms`);
    }

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
