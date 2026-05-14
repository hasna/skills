#!/usr/bin/env bun

/**
 * Environment Configuration Generator
 *
 * Analyzes codebase to detect environment variables and generates
 * comprehensive .env templates with documentation, types, and validation.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseGenerateOptions } from "./cli";
import { detectEnvVariables } from "./detection";
import { COMMON_VARIABLES } from "./env-data";
import {
  generateEnvFile,
  generateMetadata,
  generateTypeDefs,
  generateValidation,
} from "./generators";
import { SESSION_ID, SKILL_NAME, log } from "./runtime";
import type { EnvVariable } from "./types";

async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  const options = parseGenerateOptions();
  const variables = options.templateOnly
    ? useTemplateVariables()
    : await detectEnvVariables(options);

  logCategoryCounts(variables);
  logGeneratedSecrets(variables, options.generateSecrets, options.secretLength);

  if (!existsSync(options.output)) {
    mkdirSync(options.output, { recursive: true });
  }

  log("Writing configuration files...");

  for (const env of options.envs) {
    const filename = `${options.prefix}.${env}`;
    const filepath = join(options.output, filename);
    const content = generateEnvFile(variables, env, options);
    writeFileSync(filepath, content, "utf-8");
    log(`   ✓ ${filename}`);
  }

  if (options.withTypes) {
    const filepath = join(options.output, "env.d.ts");
    writeFileSync(filepath, generateTypeDefs(variables), "utf-8");
    log("   ✓ env.d.ts (TypeScript types)");
  }

  if (options.withValidation) {
    const filepath = join(options.output, "env.validation.ts");
    writeFileSync(filepath, generateValidation(variables), "utf-8");
    log("   ✓ env.validation.ts (Zod schema)");
  }

  const metadataPath = join(options.output, ".env.generated.json");
  writeFileSync(metadataPath, generateMetadata(variables, options), "utf-8");
  log("   ✓ .env.generated.json (metadata)");

  log("Environment configuration generated successfully!", "success");
  printNextSteps(options.withValidation);
}

function useTemplateVariables() {
  log("Using template variables...");
  return COMMON_VARIABLES;
}

function logCategoryCounts(variables: EnvVariable[]) {
  if (variables.length === 0) return;

  log("Categorizing variables...");
  const categoryCounts = new Map<string, number>();
  variables.forEach((variable) => {
    categoryCounts.set(variable.category, (categoryCounts.get(variable.category) || 0) + 1);
  });
  categoryCounts.forEach((count, category) => {
    log(`   ${category}: ${count} variables`);
  });
}

function logGeneratedSecrets(variables: EnvVariable[], generateSecrets: boolean, secretLength: number) {
  if (!generateSecrets) return;

  log("Generating secrets...");
  const secretVars = variables.filter((variable) => variable.sensitive);
  secretVars.forEach((variable) => {
    log(`   ✓ ${variable.name} (${secretLength} chars)`);
  });
}

function printNextSteps(withValidation: boolean) {
  console.log("⚠️  Important:");
  console.log("   - Review generated values before committing");
  console.log("   - Add .env.local and .env.production to .gitignore");
  console.log("   - Update placeholder values in .env.example");
  if (withValidation) {
    console.log("   - Run validation: bun run env.validation.ts");
  }
  console.log("");

  console.log("📚 Next steps:");
  console.log("   1. Copy .env.example to .env.local");
  console.log("   2. Fill in actual values for your environment");
  if (withValidation) {
    console.log("   3. Import and use validateEnv() in your app");
  }
  console.log("   4. Update values in CI/CD for production");
  console.log("");
}

main().catch((error) => {
  log(`Error: ${error.message}`, "error");
  process.exit(1);
});
