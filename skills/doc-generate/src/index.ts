#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import { generateWithAI } from "./ai";
import { parseCli } from "./cli";
import { loadDocumentDeps } from "./dependencies";
import { buildDocument } from "./document-builder";
import { parseMarkdown } from "./markdown-parser";

async function resolveMarkdown(inputFile: string | undefined, options: ReturnType<typeof parseCli>["options"]) {
  if (inputFile) {
    if (!fs.existsSync(inputFile)) {
      console.error(`Error: File not found: ${inputFile}`);
      process.exit(1);
    }
    console.log(`Reading from: ${inputFile}`);
    return fs.readFileSync(inputFile, "utf-8");
  }

  if (options.topic) {
    return generateWithAI(options, options.topic);
  }

  if (options.prompt) {
    return generateWithAI(options, options.prompt, true);
  }

  if (options.text) {
    return options.text;
  }

  console.error("Error: No input specified. Provide a markdown file, --topic, --prompt, or --text");
  process.exit(1);
}

function outputPathFor(
  requestedPath: string,
  outputDir: string,
  inputFile: string | undefined,
  title: string
) {
  if (requestedPath) return requestedPath;
  const baseName = inputFile
    ? path.basename(inputFile, path.extname(inputFile))
    : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  return path.join(outputDir, `${baseName}.docx`);
}

async function main(): Promise<void> {
  try {
    const { options, inputFile } = parseCli();
    const markdown = await resolveMarkdown(inputFile, options);
    const deps = await loadDocumentDeps();

    console.log("Parsing content...");
    const content = parseMarkdown(markdown, options);
    if (options.title) {
      content.title = options.title;
    }

    console.log("Building document...");
    const doc = buildDocument(content, options, deps);
    const outputPath = outputPathFor(options.output, options.dir, inputFile, content.title);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log("Writing document...");
    const buffer = await deps.Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    console.log(`\n${"=".repeat(50)}`);
    console.log("Document Generated");
    console.log("=".repeat(50));
    console.log(`  Title: ${content.title}`);
    console.log(`  Template: ${options.template}`);
    console.log(`  Sections: ${content.sections.filter((section) => section.type === "heading").length}`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log("");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
