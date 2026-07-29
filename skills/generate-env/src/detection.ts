import { readFileSync } from "fs";
import { glob } from "glob";
import { CATEGORY_PATTERNS, COMMON_VARIABLES, SENSITIVE_PATTERNS } from "./env-data";
import { log } from "./runtime";
import type { EnvVariable, GenerateOptions } from "./types";

// Variable Detection
// ============================================================================

/**
 * Detect environment variables from codebase
 */
export async function detectEnvVariables(options: GenerateOptions): Promise<EnvVariable[]> {
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
export function extractEnvVarsFromCode(content: string): string[] {
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
export function categorizeVariable(varName: string): string {
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
export function isSensitive(varName: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(varName));
}

/**
 * Generate description for variable
 */
export function generateDescription(varName: string): string {
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
export function generateExample(varName: string): string {
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
