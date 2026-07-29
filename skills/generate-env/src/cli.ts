import { parseArgs } from "util";
import { resolve } from "path";
import { DEFAULT_CATEGORIES } from "./env-data";
import type { GenerateOptions } from "./types";

export function parseGenerateOptions(): GenerateOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      dir: { type: "string", default: process.cwd() },
      include: { type: "string", default: "**/*.{ts,js,tsx,jsx}" },
      exclude: { type: "string", default: "node_modules/**,dist/**,.next/**,build/**" },
      output: { type: "string", default: process.cwd() },
      envs: { type: "string", default: "example,local,development,production" },
      prefix: { type: "string", default: ".env" },
      "generate-secrets": { type: "boolean", default: false },
      "secret-length": { type: "string", default: "32" },
      "with-types": { type: "boolean", default: false },
      "with-validation": { type: "boolean", default: false },
      "template-only": { type: "boolean", default: false },
      categories: { type: "string", default: DEFAULT_CATEGORIES.join(",") },
      "auto-categorize": { type: "boolean", default: true },
      format: { type: "string", default: "inline" },
      "include-examples": { type: "boolean", default: true },
      "security-warnings": { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Generate Env - Generate comprehensive .env templates

Usage:
  skills run generate-env -- [options]

Options:
  --dir <path>             Project directory
  --include <pattern>      Glob pattern to include
  --exclude <pattern>      Glob pattern to exclude
  --output <path>          Output directory
  --envs <list>            Environments to generate (comma-separated)
  --prefix <string>        File prefix (default: .env)
  --generate-secrets       Generate random secrets
  --secret-length <n>      Length of generated secrets
  --with-types             Generate TypeScript types
  --with-validation        Generate Zod validation
  --template-only          Use template variables only
  --categories <list>      Custom categories
  --auto-categorize        Auto-categorize variables
  --format <type>          Output format: inline, block, minimal
  --include-examples       Include examples in comments
  --security-warnings      Include security warnings
  --help, -h               Show this help
`);
    process.exit(0);
  }

  return {
    dir: resolve(values.dir as string),
    include: splitGlobList(values.include as string),
    exclude: splitGlobList(values.exclude as string),
    output: resolve(values.output as string),
    envs: (values.envs as string).split(","),
    prefix: values.prefix as string,
    generateSecrets: values["generate-secrets"] as boolean,
    secretLength: parseInt(values["secret-length"] as string, 10),
    withTypes: values["with-types"] as boolean,
    withValidation: values["with-validation"] as boolean,
    templateOnly: values["template-only"] as boolean,
    categories: (values.categories as string).split(","),
    autoCategorize: values["auto-categorize"] as boolean,
    format: values.format as "inline" | "block" | "minimal",
    includeExamples: values["include-examples"] as boolean,
    securityWarnings: values["security-warnings"] as boolean,
  };
}

function splitGlobList(value: string): string[] {
  if (value.includes("{") && value.includes("}")) {
    return [value];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
