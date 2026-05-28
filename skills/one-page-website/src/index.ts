#!/usr/bin/env bun

import { writeArtifacts } from "./artifacts";
import { parseCliOptions } from "./cli";
import { ensureDir } from "./file-writer";
import { buildSections } from "./sections";
import { buildPalette } from "./utils";

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const palette = buildPalette(options);
  const sections = buildSections(options);
  const files = writeArtifacts(options, palette, sections);

  console.log(`Generated one-page website for ${options.name}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
