#!/usr/bin/env bun

import * as fs from "fs";

import { generateDescriptions } from "./ai-descriptions";
import { generatePython, generateTypeScript } from "./generators";
import { parseBuildOptions } from "./options";

const options = parseBuildOptions();

async function main(): Promise<void> {
  console.log("\nMCP Builder");
  console.log("===========\n");

  // Check if output exists
  if (fs.existsSync(options.output) && !options.overwrite) {
    console.error(`Error: Directory already exists: ${options.output}`);
    console.error("Use --overwrite to replace existing files");
    process.exit(1);
  }

  // Generate AI descriptions if requested
  if (options.aiDescriptions) {
    await generateDescriptions(options);
  }

  console.log(`Server name: ${options.name}`);
  console.log(`Language: ${options.language}`);
  console.log(`Tools: ${options.tools.length}`);
  console.log(`Resources: ${options.resources.length}`);
  console.log(`Prompts: ${options.prompts.length}`);
  console.log("");

  // Generate project
  if (options.language === "typescript") {
    generateTypeScript(options);
  } else {
    generatePython(options);
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("MCP Server Generated");
  console.log("=".repeat(50));
  console.log(`  Output: ${options.output}`);
  console.log(`  Language: ${options.language}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${options.output}`);
  if (options.language === "typescript") {
    console.log("  npm install");
    console.log("  npm run build");
  } else {
    console.log("  pip install -e .");
  }
  console.log("");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
