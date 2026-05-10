#!/usr/bin/env bun

/**
 * Environment Configuration Generator
 *
 * Analyzes codebase to detect environment variables and generates
 * comprehensive .env templates with documentation, types, and validation.
 */

import { parseArgs } from "util";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join, resolve } from "path";
import { glob } from "glob";
import { randomBytes, randomUUID } from "crypto";

// Constants
const SKILL_NAME = "generate-env";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ============================================================================
// Types
// ============================================================================

interface EnvVariable {
  name: string;
  category: string;
  description: string;
  example?: string;
  defaultValue?: string;
  required: boolean;
  sensitive: boolean;
  format?: string;
  validation?: string;
}

interface GenerateOptions {
  dir: string;
  include: string[];
  exclude: string[];
  output: string;
  envs: string[];
  prefix: string;
  generateSecrets: boolean;
  secretLength: number;
  withTypes: boolean;
  withValidation: boolean;
  templateOnly: boolean;
  categories: string[];
  autoCategorize: boolean;
  format: 'inline' | 'block' | 'minimal';
  includeExamples: boolean;
  securityWarnings: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CATEGORIES = [
  'database',
  'auth',
  'api',
  'services',
  'email',
  'storage',
  'monitoring',
  'security',
  'misc'
];

const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /private.*key/i,
  /api.*key/i,
  /token/i,
  /credential/i,
  /auth/i,
];

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  database: [/database/i, /_db_/i, /postgres/i, /mongodb/i, /mysql/i, /redis/i, /_url$/i],
  auth: [/auth/i, /jwt/i, /session/i, /token/i, /oauth/i, /saml/i],
  api: [/api.*key/i, /^api_/i, /_api$/i],
  services: [/stripe/i, /sendgrid/i, /twilio/i, /aws/i, /openai/i, /anthropic/i],
  email: [/mail/i, /smtp/i, /sendgrid/i, /resend/i, /postmark/i],
  storage: [/bucket/i, /storage/i, /s3/i, /cdn/i, /cloudinary/i],
  monitoring: [/sentry/i, /analytics/i, /log/i, /datadog/i, /newrelic/i],
  security: [/cors/i, /csp/i, /encryption/i, /cipher/i],
};

const COMMON_VARIABLES: EnvVariable[] = [
  {
    name: 'NODE_ENV',
    category: 'general',
    description: 'Node.js environment mode',
    example: 'development',
    defaultValue: 'development',
    required: true,
    sensitive: false,
    validation: "z.enum(['development', 'production', 'test'])",
  },
  {
    name: 'PORT',
    category: 'general',
    description: 'Server port number',
    example: '3000',
    defaultValue: '3000',
    required: false,
    sensitive: false,
    validation: 'z.string().regex(/^\\d+$/).transform(Number)',
  },
  {
    name: 'HOST',
    category: 'general',
    description: 'Server host address',
    example: 'localhost',
    defaultValue: 'localhost',
    required: false,
    sensitive: false,
  },
];

// ============================================================================
// Variable Detection
// ============================================================================

/**
 * Detect environment variables from codebase
 */
async function detectEnvVariables(options: GenerateOptions): Promise<EnvVariable[]> {
  const { dir, include, exclude } = options;

  log('Analyzing codebase for environment variables...');
  log(`Scanning: ${include.join(', ')}`);

  const files = await glob(include, {
    cwd: dir,
    ignore: exclude,
    absolute: true,
  });

  log(`Found ${files.length} files to analyze`);

  const envVars = new Map<string, EnvVariable>();

  // Add common variables
  COMMON_VARIABLES.forEach(v => envVars.set(v.name, v));

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const detected = extractEnvVarsFromCode(content);

      detected.forEach(varName => {
        if (!envVars.has(varName)) {
          envVars.set(varName, {
            name: varName,
            category: options.autoCategorize ? categorizeVariable(varName) : 'misc',
            description: generateDescription(varName),
            required: true,
            sensitive: isSensitive(varName),
            example: generateExample(varName),
          });
        }
      });
    } catch (error) {
      log(`Could not read file: ${file}`, "warn");
    }
  }

  log(`Found ${envVars.size} environment variables`, "success");

  return Array.from(envVars.values()).sort((a, b) => {
    // Sort by category, then by name
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Extract environment variable names from code
 */
function extractEnvVarsFromCode(content: string): string[] {
  const vars = new Set<string>();

  // Pattern 1: process.env.VAR_NAME
  const pattern1 = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  let match;
  while ((match = pattern1.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // Pattern 2: process.env['VAR_NAME'] or process.env["VAR_NAME"]
  const pattern2 = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;
  while ((match = pattern2.exec(content)) !== null) {
    vars.add(match[1]);
  }

  // Pattern 3: Destructuring { VAR1, VAR2 } = process.env
  const pattern3 = /\{\s*([A-Z_][A-Z0-9_,\s]*)\s*\}\s*=\s*process\.env/g;
  while ((match = pattern3.exec(content)) !== null) {
    const varNames = match[1].split(',').map(v => v.trim());
    varNames.forEach(v => {
      if (v && /^[A-Z_][A-Z0-9_]*$/.test(v)) {
        vars.add(v);
      }
    });
  }

  // Pattern 4: import.meta.env.VAR_NAME (Vite)
  const pattern4 = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((match = pattern4.exec(content)) !== null) {
    vars.add(match[1]);
  }

  return Array.from(vars);
}

/**
 * Categorize a variable based on its name
 */
function categorizeVariable(varName: string): string {
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(varName))) {
      return category;
    }
  }
  return 'misc';
}

/**
 * Check if variable is sensitive
 */
function isSensitive(varName: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(varName));
}

/**
 * Generate description for variable
 */
function generateDescription(varName: string): string {
  // Convert SCREAMING_SNAKE_CASE to readable text
  const words = varName.toLowerCase().split('_');
  const readable = words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Add context based on patterns
  if (/url$/i.test(varName)) return `${readable} connection URL`;
  if (/key$/i.test(varName)) return `${readable} for authentication`;
  if (/secret/i.test(varName)) return `${readable} for encryption`;
  if (/token/i.test(varName)) return `${readable} for authorization`;
  if (/host/i.test(varName)) return `${readable} hostname`;
  if (/port/i.test(varName)) return `${readable} port number`;

  return readable;
}

/**
 * Generate example value for variable
 */
function generateExample(varName: string): string {
  if (/database.*url/i.test(varName)) return 'postgresql://user:password@localhost:5432/dbname';
  if (/mongodb/i.test(varName)) return 'mongodb://localhost:27017/dbname';
  if (/redis/i.test(varName)) return 'redis://localhost:6379';
  if (/^port$/i.test(varName)) return '3000';
  if (/^host$/i.test(varName)) return 'localhost';
  if (/url$/i.test(varName)) return 'https://example.com';
  if (/email/i.test(varName)) return 'admin@example.com';
  if (/openai.*key/i.test(varName)) return 'sk-...';
  if (/stripe.*publishable/i.test(varName)) return 'pk_test_...';
  if (/stripe.*secret/i.test(varName)) return 'sk_test_...';
  if (/next_public/i.test(varName)) return 'public-value';

  return 'your-value-here';
}

// ============================================================================
// Secret Generation
// ============================================================================

/**
 * Generate a secure random secret
 */
function generateSecret(length: number = 32): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

// ============================================================================
// File Generation
// ============================================================================

/**
 * Generate .env file content
 */
function generateEnvFile(
  variables: EnvVariable[],
  environment: string,
  options: GenerateOptions
): string {
  const lines: string[] = [];

  // Header
  if (environment === 'example') {
    lines.push('# Environment Configuration Template');
    lines.push('# Copy this file to .env.local and fill in the values');
  } else {
    lines.push(`# ${environment.charAt(0).toUpperCase() + environment.slice(1)} Environment Configuration`);
  }
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Group by category
  const categories = new Map<string, EnvVariable[]>();
  variables.forEach(v => {
    const cat = v.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(v);
  });

  // Generate sections
  for (const [category, vars] of categories) {
    lines.push('# ' + '='.repeat(77));
    lines.push(`# ${category.toUpperCase()}`);
    lines.push('# ' + '='.repeat(77));
    lines.push('');

    for (const envVar of vars) {
      // Add description
      if (options.format !== 'minimal') {
        lines.push(`# ${envVar.description}`);

        if (options.includeExamples && envVar.example) {
          lines.push(`# Example: ${envVar.example}`);
        }

        if (options.securityWarnings && envVar.sensitive) {
          lines.push('# ⚠️  SECURITY WARNING: This is a sensitive credential');
          lines.push('#    - Never commit this to version control');
          lines.push('#    - Use a strong, randomly generated value');
          lines.push('#    - Store securely (e.g., password manager, secrets vault)');
        }
      }

      // Generate value
      let value = '';
      if (environment === 'example') {
        value = envVar.example || 'your-value-here';
      } else if (options.generateSecrets && envVar.sensitive && !envVar.example?.includes('sk-')) {
        value = generateSecret(options.secretLength);
      } else {
        value = envVar.defaultValue || envVar.example || '';
      }

      // Add variable
      if (environment === 'example' || !value) {
        lines.push(`${envVar.name}="${value}"`);
      } else {
        lines.push(`${envVar.name}="${value}"`);
      }

      lines.push('');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate TypeScript type definitions
 */
function generateTypeDefs(variables: EnvVariable[]): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * Environment Variables Type Definitions');
  lines.push(' * Generated by generate-env skill');
  lines.push(' */');
  lines.push('');
  lines.push('declare global {');
  lines.push('  namespace NodeJS {');
  lines.push('    interface ProcessEnv {');

  // Group by category
  const categories = new Map<string, EnvVariable[]>();
  variables.forEach(v => {
    const cat = v.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(v);
  });

  for (const [category, vars] of categories) {
    lines.push(`      // ${category.charAt(0).toUpperCase() + category.slice(1)}`);

    for (const envVar of vars) {
      let type = 'string';
      if (envVar.name === 'NODE_ENV') {
        type = "'development' | 'production' | 'test'";
      } else if (envVar.name === 'PORT') {
        type = 'string';
      }

      const optional = envVar.required ? '' : '?';
      lines.push(`      ${envVar.name}${optional}: ${type};`);
    }

    lines.push('');
  }

  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('export {};');

  return lines.join('\n');
}

/**
 * Generate Zod validation schema
 */
function generateValidation(variables: EnvVariable[]): string {
  const lines: string[] = [];

  lines.push("import { z } from 'zod';");
  lines.push('');
  lines.push('/**');
  lines.push(' * Environment Variables Validation Schema');
  lines.push(' * Generated by generate-env skill');
  lines.push(' */');
  lines.push('');
  lines.push('export const envSchema = z.object({');

  // Group by category
  const categories = new Map<string, EnvVariable[]>();
  variables.forEach(v => {
    const cat = v.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(v);
  });

  for (const [category, vars] of categories) {
    lines.push(`  // ${category.charAt(0).toUpperCase() + category.slice(1)}`);

    for (const envVar of vars) {
      let validation = envVar.validation || 'z.string()';

      // Add specific validations
      if (envVar.name.endsWith('_URL')) {
        validation = 'z.string().url()';
      } else if (envVar.name.endsWith('_EMAIL')) {
        validation = 'z.string().email()';
      } else if (envVar.sensitive && !envVar.validation) {
        validation = 'z.string().min(1)';
      }

      if (!envVar.required) {
        validation += '.optional()';
      }

      lines.push(`  ${envVar.name}: ${validation},`);
    }

    lines.push('');
  }

  lines.push('});');
  lines.push('');
  lines.push('export type Env = z.infer<typeof envSchema>;');
  lines.push('');
  lines.push('/**');
  lines.push(' * Validate environment variables at runtime');
  lines.push(' */');
  lines.push('export function validateEnv(): Env {');
  lines.push('  const parsed = envSchema.safeParse(process.env);');
  lines.push('');
  lines.push('  if (!parsed.success) {');
  lines.push("    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);");
  lines.push("    throw new Error('Invalid environment variables');");
  lines.push('  }');
  lines.push('');
  lines.push('  return parsed.data;');
  lines.push('}');

  return lines.join('\n');
}

/**
 * Generate metadata file
 */
function generateMetadata(variables: EnvVariable[], options: GenerateOptions): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalVariables: variables.length,
    categories: Array.from(new Set(variables.map(v => v.category))).sort(),
    sensitiveCount: variables.filter(v => v.sensitive).length,
    requiredCount: variables.filter(v => v.required).length,
    options: {
      templateOnly: options.templateOnly,
      generateSecrets: options.generateSecrets,
      withTypes: options.withTypes,
      withValidation: options.withValidation,
    },
    variables: variables.map(v => ({
      name: v.name,
      category: v.category,
      required: v.required,
      sensitive: v.sensitive,
    })),
  }, null, 2);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      dir: { type: 'string', default: process.cwd() },
      include: { type: 'string', default: '**/*.{ts,js,tsx,jsx}' },
      exclude: { type: 'string', default: 'node_modules/**,dist/**,.next/**,build/**' },
      output: { type: 'string', default: process.cwd() },
      envs: { type: 'string', default: 'example,local,development,production' },
      prefix: { type: 'string', default: '.env' },
      'generate-secrets': { type: 'boolean', default: false },
      'secret-length': { type: 'string', default: '32' },
      'with-types': { type: 'boolean', default: false },
      'with-validation': { type: 'boolean', default: false },
      'template-only': { type: 'boolean', default: false },
      categories: { type: 'string', default: DEFAULT_CATEGORIES.join(',') },
      'auto-categorize': { type: 'boolean', default: true },
      format: { type: 'string', default: 'inline' },
      'include-examples': { type: 'boolean', default: true },
      'security-warnings': { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
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

  const options: GenerateOptions = {
    dir: resolve(values.dir as string),
    include: (values.include as string).split(','),
    exclude: (values.exclude as string).split(','),
    output: resolve(values.output as string),
    envs: (values.envs as string).split(','),
    prefix: values.prefix as string,
    generateSecrets: values['generate-secrets'] as boolean,
    secretLength: parseInt(values['secret-length'] as string, 10),
    withTypes: values['with-types'] as boolean,
    withValidation: values['with-validation'] as boolean,
    templateOnly: values['template-only'] as boolean,
    categories: (values.categories as string).split(','),
    autoCategorize: values['auto-categorize'] as boolean,
    format: values.format as 'inline' | 'block' | 'minimal',
    includeExamples: values['include-examples'] as boolean,
    securityWarnings: values['security-warnings'] as boolean,
  };

  // Detect or use template variables
  let variables: EnvVariable[];
  if (options.templateOnly) {
    log('Using template variables...');
    variables = COMMON_VARIABLES;
  } else {
    variables = await detectEnvVariables(options);
  }

  // Categorize
  if (variables.length > 0) {
    log('Categorizing variables...');
    const categoryCounts = new Map<string, number>();
    variables.forEach(v => {
      categoryCounts.set(v.category, (categoryCounts.get(v.category) || 0) + 1);
    });
    categoryCounts.forEach((count, category) => {
      log(`   ${category}: ${count} variables`);
    });
  }

  // Generate secrets if needed
  if (options.generateSecrets) {
    log('Generating secrets...');
    const secretVars = variables.filter(v => v.sensitive);
    secretVars.forEach(v => {
      log(`   ✓ ${v.name} (${options.secretLength} chars)`);
    });
  }

  // Create output directory
  if (!existsSync(options.output)) {
    mkdirSync(options.output, { recursive: true });
  }

  // Generate files
  log('Writing configuration files...');

  for (const env of options.envs) {
    const filename = env === 'example'
      ? `${options.prefix}.${env}`
      : `${options.prefix}.${env}`;
    const filepath = join(options.output, filename);
    const content = generateEnvFile(variables, env, options);
    writeFileSync(filepath, content, 'utf-8');
    log(`   ✓ ${filename}`);
  }

  // Generate types
  if (options.withTypes) {
    const filepath = join(options.output, 'env.d.ts');
    const content = generateTypeDefs(variables);
    writeFileSync(filepath, content, 'utf-8');
    log('   ✓ env.d.ts (TypeScript types)');
  }

  // Generate validation
  if (options.withValidation) {
    const filepath = join(options.output, 'env.validation.ts');
    const content = generateValidation(variables);
    writeFileSync(filepath, content, 'utf-8');
    log('   ✓ env.validation.ts (Zod schema)');
  }

  // Generate metadata
  const metadataPath = join(options.output, '.env.generated.json');
  const metadata = generateMetadata(variables, options);
  writeFileSync(metadataPath, metadata, 'utf-8');
  log('   ✓ .env.generated.json (metadata)');

  log('Environment configuration generated successfully!', "success");

  // Warnings and next steps
  console.log('⚠️  Important:');
  console.log('   - Review generated values before committing');
  console.log('   - Add .env.local and .env.production to .gitignore');
  console.log('   - Update placeholder values in .env.example');
  if (options.withValidation) {
    console.log('   - Run validation: bun run env.validation.ts');
  }
  console.log('');

  console.log('📚 Next steps:');
  console.log('   1. Copy .env.example to .env.local');
  console.log('   2. Fill in actual values for your environment');
  if (options.withValidation) {
    console.log('   3. Import and use validateEnv() in your app');
  }
  console.log('   4. Update values in CI/CD for production');
  console.log('');
}

main().catch(error => {
  log(`Error: ${error.message}`, "error");
  process.exit(1);
});
