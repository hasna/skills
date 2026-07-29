import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { EXPORTS_DIR, ensureDir, log } from "./logger";
import { generatePythonClient } from "./python-generator";
import { loadSpec } from "./spec-loader";
import { generateTypeScriptFetchClient, generateTypeScriptTypes } from "./typescript-generator";
import type { GenerateOptions } from "./types";

export async function generateApiClient(options: GenerateOptions): Promise<string> {
  log(`Generating ${options.language} API client...`);

  const spec = await loadSpec(options.specPath);
  let files: Record<string, string>;

  if (options.language === "typescript" || options.language === "javascript") {
    files = options.typesOnly
      ? { "types.ts": generateTypeScriptTypes(spec) }
      : generateTypeScriptFetchClient(spec, options);
  } else if (options.language === "python") {
    files = generatePythonClient(spec, options);
  } else {
    throw new Error(`Unsupported language: ${options.language}`);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "_")
    .replace(/-/g, "_")
    .slice(0, 19)
    .toLowerCase();
  const apiName = spec.info.title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const defaultOutput = join(EXPORTS_DIR, `export_${timestamp}_${apiName}`);
  const outputDir = options.output || defaultOutput;

  log(`Writing files to: ${outputDir}`);
  ensureDir(outputDir);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(outputDir, filename);
    ensureDir(dirname(filePath));
    writeFileSync(filePath, content, "utf-8");
    log(`Created: ${filename}`);
  }

  log(`Generated ${Object.keys(files).length} files`, "success");
  return outputDir;
}
