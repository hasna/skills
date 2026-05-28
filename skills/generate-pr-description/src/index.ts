#!/usr/bin/env bun

/**
 * Generate PR Description Skill
 *
 * Auto-generate comprehensive PR descriptions from git diff with AI-powered analysis
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { analyzeWithAI, generateBasicDescription } from "./ai";
import { parseArguments } from "./cli";
import { copyToClipboard } from "./clipboard";
import { applyTemplate, formatOutput } from "./formatters";
import { branchExists, getCommitHistory, getDiff, isGitRepository } from "./git";
import type { PRDescription } from "./types";

async function main() {
  try {
    const options = parseArguments();

    if (!isGitRepository()) {
      console.error("❌ Error: Not a git repository");
      console.error("Run this command from within a git repository");
      process.exit(1);
    }

    if (options.verbose) {
      console.log("🔍 Analyzing git changes...");
    }

    if (!options.staged && !options.unstaged) {
      if (!branchExists(options.base)) {
        console.error(`❌ Error: Base branch '${options.base}' does not exist`);
        process.exit(1);
      }

      if (options.head && !branchExists(options.head)) {
        console.error(`❌ Error: Head branch '${options.head}' does not exist`);
        process.exit(1);
      }
    }

    const diffResult = getDiff(options);

    if (!diffResult.diff) {
      console.log("ℹ️  No changes to analyze");
      process.exit(0);
    }

    if (options.verbose) {
      console.log(
        `📊 Found ${diffResult.stats.filesChanged} files changed ` +
          `(+${diffResult.stats.insertions}, -${diffResult.stats.deletions})`
      );
    }

    const commits = getCommitHistory(options);

    if (options.verbose && commits.length > 0) {
      console.log(`📝 Analyzing ${commits.length} commits`);
    }

    let description: PRDescription;

    if (options.noAi) {
      if (options.verbose) {
        console.log("📄 Generating basic template (AI disabled)");
      }
      description = generateBasicDescription(diffResult.diff, commits, diffResult.files);
    } else {
      if (options.verbose) {
        console.log("🤖 Analyzing with AI...");
      }
      description = await analyzeWithAI(diffResult.diff, commits, diffResult.files, options);
    }

    let output: string;

    if (options.template) {
      if (!existsSync(options.template)) {
        console.error(`❌ Error: Template file not found: ${options.template}`);
        process.exit(1);
      }
      const template = readFileSync(options.template, "utf-8");
      output = applyTemplate(template, description);
    } else {
      output = formatOutput(description, options);
    }

    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, output, "utf-8");
      console.log(`✅ PR description saved to: ${outputPath}`);
    } else {
      console.log(output);
    }

    if (options.copy) {
      if (copyToClipboard(output)) {
        console.log("📋 Copied to clipboard");
      } else {
        console.log("⚠️  Could not copy to clipboard (no clipboard utility found)");
      }
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
