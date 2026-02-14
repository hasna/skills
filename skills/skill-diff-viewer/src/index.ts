#!/usr/bin/env bun
import { readFile } from "fs/promises";
import { diffLines } from "diff";
import chalk from "chalk";
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

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-diff-viewer - Compare two files and show differences

Usage:
  skills run diff-viewer -- file1=<path> file2=<path>

Options:
  -h, --help           Show this help message
  file1=<path>         First file to compare (required)
  file2=<path>         Second file to compare (required)

Output:
  Green text: Lines added in file2
  Red text: Lines removed from file1
  Grey text: Unchanged lines

Examples:
  skills run diff-viewer -- file1=old.txt file2=new.txt
  skills run diff-viewer -- file1=src/v1.ts file2=src/v2.ts
`);
  process.exit(0);
}

const file1Arg = args.find(a => a.startsWith("file1="))?.split("=")[1];
const file2Arg = args.find(a => a.startsWith("file2="))?.split("=")[1];

async function main() {
  if (!file1Arg || !file2Arg) {
    console.log("Usage: skills run diff-viewer -- file1=... file2=...");
    process.exit(1);
  }

  try {
    // Validate file paths before reading
    const validatedPath1 = validateFilePath(file1Arg, "file1");
    const validatedPath2 = validateFilePath(file2Arg, "file2");

    const content1 = await readFile(validatedPath1, "utf-8");
    const content2 = await readFile(validatedPath2, "utf-8");

    const diff = diffLines(content1, content2);

    diff.forEach(part => {
      const color = part.added ? chalk.green :
                    part.removed ? chalk.red :
                    chalk.grey;
      process.stdout.write(color(part.value));
    });
    console.log(); // Newline at end

  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
