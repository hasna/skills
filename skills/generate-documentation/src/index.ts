#!/usr/bin/env bun
/**
 * Generate Documentation Skill
 * Auto-generates JSDoc/TSDoc/Python docstrings from code using AI analysis.
 */

import { join } from "path";
import { parseGenerateOptions } from "./cli";
import {
  collectFiles,
  generateMarkdownDocs,
  insertDocumentation,
  processFile,
} from "./file-processing";
import { EXPORTS_DIR, LOGS_DIR, SESSION_ID, SESSION_TIMESTAMP, log } from "./runtime";
import type { DocumentationResult } from "./types";

async function main() {
  try {
    log(`Session ID: ${SESSION_ID}`);

    const options = parseGenerateOptions();
    const files = collectFiles(options.path);
    log(`Found ${files.length} file(s) to process`);

    if (files.length === 0) {
      log("No supported files found", "warn");
      process.exit(0);
    }

    const allResults = new Map<string, DocumentationResult[]>();
    let totalGenerated = 0;

    for (const file of files) {
      const results = await processFile(file, options);
      allResults.set(file, results);
      totalGenerated += results.length;

      if (options.output === "inline" && results.length > 0) {
        insertDocumentation(file, results);
      }
    }

    if (options.output !== "inline") {
      const outputPath = options.output.endsWith(".md")
        ? options.output
        : join(EXPORTS_DIR, `export_${SESSION_TIMESTAMP}_docs.md`);

      generateMarkdownDocs(allResults, outputPath);
    }

    console.log(`
Documentation generation complete!
  Files processed: ${files.length}
  Documentation generated: ${totalGenerated}
  Output: ${options.output === "inline" ? "Inline (files updated)" : options.output}
  Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}
`);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
