#!/usr/bin/env bun
import { readFile, writeFile } from "fs/promises";
import { join, resolve, normalize, isAbsolute } from "path";

// ============================================================================
// Path Security
// ============================================================================

// Sensitive paths that should never be read
const BLOCKED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
  '/etc/sudoers',
  '/etc/ssh',
  '/root',
  '/.ssh',
  '/.aws',
  '/.config',
  '/.env',
  '/proc',
  '/sys',
  '/dev',
  '/var/log',
  '/var/run',
  '/tmp',
  '/private/etc',
  '/private/var',
];

// File patterns that should be blocked
const BLOCKED_PATTERNS = [
  /\.env($|\.)/i,               // .env, .env.local, .env.production
  /\.pem$/i,                    // Private keys
  /\.key$/i,                    // Private keys
  /\.crt$/i,                    // Certificates
  /id_rsa/i,                    // SSH keys
  /id_ed25519/i,                // SSH keys
  /\.secrets?/i,                // Secrets directories/files
  /credentials/i,               // Credential files
  /password/i,                  // Password files
  /\.git\/config$/i,            // Git config with potential tokens
  /\.npmrc$/i,                  // npm config with tokens
  /\.pypirc$/i,                 // PyPI config with tokens
  /kubeconfig/i,                // Kubernetes configs
  /\.docker\/config\.json$/i,   // Docker configs with auth
];

function isPathBlocked(filePath: string): { blocked: boolean; reason?: string } {
  const normalizedPath = normalize(filePath).toLowerCase();
  const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(process.cwd(), filePath);
  const resolvedLower = resolvedPath.toLowerCase();

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    // Allow .. only if it doesn't escape the current working directory
    const cwd = process.cwd();
    if (!resolvedPath.startsWith(cwd)) {
      return { blocked: true, reason: 'Path traversal outside working directory is not allowed' };
    }
  }

  // Check against blocked paths
  for (const blockedPath of BLOCKED_PATHS) {
    if (resolvedLower.startsWith(blockedPath.toLowerCase()) ||
        resolvedLower.includes(blockedPath.toLowerCase())) {
      return { blocked: true, reason: `Access to ${blockedPath} is restricted for security reasons` };
    }
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedPath) || pattern.test(resolvedPath)) {
      return { blocked: true, reason: `Access to files matching ${pattern} is restricted for security reasons` };
    }
  }

  return { blocked: false };
}

function validateFilePath(filePath: string, argName: string): string {
  if (!filePath || filePath.trim() === '') {
    throw new Error(`${argName} cannot be empty`);
  }

  // Check for null bytes (path traversal attack vector)
  if (filePath.includes('\0')) {
    throw new Error(`${argName} contains invalid characters`);
  }

  const blockCheck = isPathBlocked(filePath);
  if (blockCheck.blocked) {
    throw new Error(`Security: ${blockCheck.reason}`);
  }

  return filePath;
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-data-anonymizer - Anonymize sensitive data in text

Usage:
  skills run data-anonymizer -- [text=<text>] [file=<path>] [output=<file>]

Options:
  -h, --help           Show this help message
  text=<text>          Text to anonymize
  file=<path>          File to anonymize
  output=<file>        Output file path (prints to stdout if omitted)

Anonymizes:
  - Email addresses → [EMAIL]
  - Phone numbers → [PHONE]
  - Credit card numbers → [CREDIT_CARD]
  - IP addresses → [IP]

Examples:
  skills run data-anonymizer -- text="Contact john@example.com"
  skills run data-anonymizer -- file=data.txt output=clean.txt
`);
  process.exit(0);
}

const textArg = args.find(a => a.startsWith("text="))?.split("=")[1];
const fileArg = args.find(a => a.startsWith("file="))?.split("=")[1];
const outputArg = args.find(a => a.startsWith("output="))?.split("=")[1];

const PATTERNS = [
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: "[PHONE]" },
  { regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: "[CREDIT_CARD]" },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[IP]" },
];

function anonymize(text: string): string {
  let result = text;
  for (const p of PATTERNS) {
    result = result.replace(p.regex, p.replacement);
  }
  return result;
}

async function main() {
  if (!textArg && !fileArg) {
    console.log("Usage: skills run data-anonymizer -- [text=...] [file=...] [output=...]");
    process.exit(1);
  }

  try {
    let content = "";
    if (fileArg) {
      // Validate file path before reading
      const validatedPath = validateFilePath(fileArg, "file");
      content = await readFile(validatedPath, "utf-8");
    } else if (textArg) {
      content = textArg;
    }

    const clean = anonymize(content);

    if (outputArg) {
      const outputDir = process.env.SKILLS_EXPORTS_DIR || ".";
      const outputPath = join(outputDir, outputArg);
      await writeFile(outputPath, clean);
      console.log(`Anonymized data saved to ${outputPath}`);
    } else {
      console.log(clean);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
