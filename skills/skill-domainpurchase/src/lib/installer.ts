import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SERVICE_NAME = "service-domainpurchase";
const SERVICE_DIR_NAME = `.${SERVICE_NAME}`;

export interface InstallOptions {
  force?: boolean;
}

export function getServiceDir(): string {
  return join(homedir(), SERVICE_DIR_NAME);
}

export function getLogFilePath(): string {
  return join(getServiceDir(), `${SERVICE_NAME}.log`);
}

export function getReadmePath(): string {
  return join(getServiceDir(), "README.md");
}

export function isInstalled(): boolean {
  return existsSync(getServiceDir());
}

export function ensureInstalled(): void {
  if (!isInstalled()) {
    install();
  }
}

export function install(options: InstallOptions = {}): { success: boolean; path: string; message: string } {
  const serviceDir = getServiceDir();

  if (existsSync(serviceDir) && !options.force) {
    return {
      success: false,
      path: serviceDir,
      message: "Already installed. Use --force to reinstall.",
    };
  }

  mkdirSync(serviceDir, { recursive: true });

  const readmeContent = generateReadme();
  writeFileSync(getReadmePath(), readmeContent);

  const logHeader = `# ${SERVICE_NAME} log file
# Created: ${new Date().toISOString()}
# This file contains activity history and logs.
# -------------------------------------------------------

`;
  writeFileSync(getLogFilePath(), logHeader);

  return {
    success: true,
    path: serviceDir,
    message: `Installed at ${serviceDir}`,
  };
}

export function uninstall(): { success: boolean; message: string } {
  const serviceDir = getServiceDir();

  if (!existsSync(serviceDir)) {
    return {
      success: false,
      message: "Not installed.",
    };
  }

  const { rmSync } = require("fs");
  rmSync(serviceDir, { recursive: true, force: true });

  return {
    success: true,
    message: `Uninstalled from ${serviceDir}`,
  };
}

function generateReadme(): string {
  return `# .${SERVICE_NAME}

This directory contains local configuration and logs for \`${SERVICE_NAME}\`.

## Files

| Path | Description |
|------|-------------|
| \`${SERVICE_NAME}.log\` | Activity log |
| \`README.md\` | This file |

## What is ${SERVICE_NAME}?

\`${SERVICE_NAME}\` is a domain purchase service that provides:

- Domain registration automation
- Registrar integrations (GoDaddy, Namecheap, etc.)
- DNS configuration
- Domain transfer management
- Renewal tracking

## Usage

\`\`\`bash
# Purchase a domain
service-domainpurchase buy --domain "example.com"

# List purchased domains
service-domainpurchase list

# Check purchase status
service-domainpurchase status --domain "example.com"

# Start the server
service-domainpurchase server
\`\`\`

## Log File

The \`${SERVICE_NAME}.log\` file contains:
- Purchase transactions
- Registration status
- DNS changes
- API activity

## More Information

For full documentation, run:

\`\`\`bash
service-domainpurchase --help
\`\`\`
`;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logToFile(message: string, level: LogLevel = "info"): void {
  ensureInstalled();

  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

  try {
    appendFileSync(getLogFilePath(), logLine);
  } catch {
    // Silently fail
  }
}

export function logInfo(message: string): void {
  logToFile(message, "info");
}

export function logError(message: string): void {
  logToFile(message, "error");
}

export function logWarn(message: string): void {
  logToFile(message, "warn");
}
