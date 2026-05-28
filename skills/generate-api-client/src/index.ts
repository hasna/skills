#!/usr/bin/env bun
/**
 * Generate API Client Skill
 * Generates typed API clients from OpenAPI/Swagger specifications
 */

import { parseArgs } from "util";
import { join } from "path";
import { generateApiClient } from "./generator";
import { LOGS_DIR, SESSION_ID, SESSION_TIMESTAMP, log } from "./logger";

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      language: { type: "string", short: "l", default: "typescript" },
      client: { type: "string", default: "fetch" },
      output: { type: "string", short: "o" },
      auth: { type: "string", default: "bearer" },
      style: { type: "string", default: "modular" },
      async: { type: "boolean", default: true },
      sync: { type: "boolean", default: false },
      "base-url": { type: "string" },
      name: { type: "string" },
      "types-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Generate API Client - Generate typed API clients from OpenAPI/Swagger specs

Usage:
  bun run src/index.ts <spec-url-or-file> [options]

Options:
  --language, -l <lang>   Output language (typescript, javascript, python) [default: typescript]
  --client <client>       HTTP client (fetch, axios, ky, requests) [default: fetch]
  --output, -o <path>     Output directory path
  --auth <type>           Auth type (bearer, apikey, oauth2, basic, none) [default: bearer]
  --style <style>         Code style (modular, class, functional) [default: modular]
  --async                 Generate async methods (Python) [default: true]
  --sync                  Generate sync methods [default: false]
  --base-url <url>        Override base URL from spec
  --name <name>           Client class/module name
  --types-only            Generate only TypeScript types
  --help, -h              Show this help

Examples:
  bun run src/index.ts "https://api.example.com/openapi.json"
  bun run src/index.ts "./spec.yaml" --language python --client requests
  bun run src/index.ts "https://petstore.swagger.io/v2/swagger.json" --output ./api
`);
    process.exit(0);
  }

  const specPath = positionals[0];

  if (!specPath) {
    log("Please provide an OpenAPI spec URL or file path", "error");
    process.exit(1);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    const outputDir = await generateApiClient({
      specPath,
      language: values.language as "typescript" | "javascript" | "python",
      client: values.client as "fetch" | "axios" | "ky" | "requests",
      output: values.output as string | undefined,
      auth: values.auth as "bearer" | "apikey" | "oauth2" | "basic" | "none",
      style: values.style as "modular" | "class" | "functional",
      async: values.async as boolean,
      sync: values.sync as boolean,
      baseUrl: values["base-url"] as string | undefined,
      name: values.name as string | undefined,
      typesOnly: values["types-only"] as boolean,
    });

    console.log(`\n✨ API client generated successfully!`);
    console.log(`   📁 Output: ${outputDir}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
