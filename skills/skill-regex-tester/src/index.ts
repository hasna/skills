#!/usr/bin/env bun
import { readFile } from "fs/promises";
import { resolve, normalize, isAbsolute } from "path";

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

function showHelp(): void {
  console.log(`
skill-regex-tester - Test regular expressions against text

Usage:
  skills run regex-tester -- pattern=<regex> [text=<text>|file=<path>] [flags=<flags>]

Options:
  -h, --help               Show this help message
  pattern=<regex>          Regular expression pattern to test
  text=<text>              Text to test against (inline)
  file=<path>              File containing text to test against
  flags=<flags>            Regex flags (default: g for global)

Output includes:
  - Pattern and flags used
  - Number of matches found
  - Each match with captured groups and index

Examples:
  skills run regex-tester -- pattern="\\d+" text="There are 42 apples and 7 oranges"
  skills run regex-tester -- pattern="(\\w+)@(\\w+\\.\\w+)" file=./emails.txt
  skills run regex-tester -- pattern="hello" text="Hello World" flags=gi
`);
}

const args = process.argv.slice(2);

// Check for help flag
if (args.includes("-h") || args.includes("--help")) {
  showHelp();
  process.exit(0);
}
const patternArg = args.find(a => a.startsWith("pattern="))?.split("=")[1];
const textArg = args.find(a => a.startsWith("text="))?.split("=")[1];
const fileArg = args.find(a => a.startsWith("file="))?.split("=")[1];
const flagsArg = args.find(a => a.startsWith("flags="))?.split("=")[1] || "g";

async function main() {
  if (!patternArg || (!textArg && !fileArg)) {
    console.log("Usage: skills run regex-tester -- pattern=... [text=...|file=...] [flags=...]");
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

    const regex = new RegExp(patternArg, flagsArg);
    const matches = [...content.matchAll(regex)];

    console.log(`Pattern: /${patternArg}/${flagsArg}`);
    console.log(`Matches found: ${matches.length}\n`);

    matches.forEach((m, i) => {
      console.log(`Match ${i + 1}: "${m[0]}"`);
      if (m.length > 1) {
        console.log(`  Groups: ${JSON.stringify(m.slice(1))}`);
      }
      console.log(`  Index: ${m.index}`);
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Check if it's a security error or regex error
    if (message.startsWith("Security:") || message.includes("cannot be empty") || message.includes("invalid characters")) {
      console.error(`Error: ${message}`);
    } else {
      console.error("Invalid Regex:", message);
    }
    process.exit(1);
  }
}

main();
