#!/usr/bin/env bun
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import markdownlint from "markdownlint";
import { promisify } from "util";

const markdownlintAsync = promisify(markdownlint);

function showHelp(): void {
  console.log(`
skill-markdown-validator - Validate Markdown files for common issues

Usage:
  skills run markdown-validator -- file=<path> [options]
  skills run markdown-validator -- path=<directory> [options]

Options:
  -h, --help               Show this help message
  file=<path>              Single Markdown file to validate
  path=<directory>         Directory containing Markdown files to validate

Output includes:
  - Linting issues found
  - Rule violations with line numbers
  - Fix suggestions

Examples:
  skills run markdown-validator -- file=./README.md
  skills run markdown-validator -- path=./docs

Note:
  Line length check (MD013) is disabled by default.
`);
}

const args = process.argv.slice(2);

// Check for help flag
if (args.includes("-h") || args.includes("--help")) {
  showHelp();
  process.exit(0);
}

const fileArg = args.find(a => a.startsWith("file="))?.split("=")[1];
const pathArg = args.find(a => a.startsWith("path="))?.split("=")[1];

async function main() {
  if (!fileArg && !pathArg) {
    console.log("Usage: skills run markdown-validator -- [file=...] [path=...]");
    console.log("Run with --help for more information.");
    process.exit(1);
  }

  let files: string[] = [];

  if (fileArg) {
    files.push(fileArg);
  } else if (pathArg) {
    const dirFiles = await readdir(pathArg);
    files = dirFiles.filter(f => f.endsWith(".md")).map(f => join(pathArg, f));
  }

  if (files.length === 0) {
    console.log("No Markdown files found.");
    process.exit(0);
  }

  console.log(`Linting ${files.length} file(s)...`);

  const options = {
    files: files,
    config: {
      "default": true,
      "MD013": false, // Disable line length check
    }
  };

  try {
    const result = await markdownlintAsync(options);
    const resultString = result.toString();

    if (resultString) {
      console.log("Issues found:");
      console.log(resultString);
      process.exit(1);
    } else {
      console.log("✅ No issues found.");
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
