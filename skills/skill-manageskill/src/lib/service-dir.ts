import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SERVICE_NAME = "skill-manageskill";
const SERVICE_DIR_NAME = `.${SERVICE_NAME}`;

export function getServiceDir(): string {
  return join(homedir(), SERVICE_DIR_NAME);
}

export function getLogFilePath(): string {
  return join(getServiceDir(), `${SERVICE_NAME}.log`);
}

export function getReadmePath(): string {
  return join(getServiceDir(), "README.md");
}

export function isServiceDirInstalled(): boolean {
  return existsSync(getServiceDir());
}

export function ensureServiceDir(): void {
  if (!isServiceDirInstalled()) {
    initServiceDir();
  }
}

export function initServiceDir(force = false): { success: boolean; path: string; message: string } {
  const serviceDir = getServiceDir();

  if (existsSync(serviceDir) && !force) {
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

function generateReadme(): string {
  return `# .${SERVICE_NAME}

This directory contains local configuration and logs for \`${SERVICE_NAME}\`.

## Files

| Path | Description |
|------|-------------|
| \`${SERVICE_NAME}.log\` | Activity log |
| \`README.md\` | This file |

## What is ${SERVICE_NAME}?

\`${SERVICE_NAME}\` is a tool for managing Claude Code skills.

## Log File

The \`${SERVICE_NAME}.log\` file contains:
- Activity logs
- Error logs
- API activity

## More Information

For full documentation, run:

\`\`\`bash
${SERVICE_NAME} --help
\`\`\`
`;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logToFile(message: string, level: LogLevel = "info"): void {
  ensureServiceDir();

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
