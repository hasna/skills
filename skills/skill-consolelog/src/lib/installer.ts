import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";

const SERVICE_DIR_NAME = ".service-consolelog";
const SNAPSHOTS_DIR_NAME = "snapshots";

export interface InstallOptions {
  projectRoot?: string;
  force?: boolean;
}

// Get the global service directory in home
export function getGlobalServiceDir(): string {
  return join(homedir(), SERVICE_DIR_NAME);
}

// Get the project-specific service directory (for per-project logs)
export function getServiceDir(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  return join(root, SERVICE_DIR_NAME);
}

export function getSnapshotsDir(projectRoot?: string): string {
  return join(getServiceDir(projectRoot), SNAPSHOTS_DIR_NAME);
}

export function getLogFilePath(projectRoot?: string): string {
  return join(getServiceDir(projectRoot), "service-consolelog.log");
}

export function getReadmePath(projectRoot?: string): string {
  return join(getServiceDir(projectRoot), "README.md");
}

export function isInstalled(projectRoot?: string): boolean {
  return existsSync(getServiceDir(projectRoot));
}

export function isGlobalInstalled(): boolean {
  return existsSync(getGlobalServiceDir());
}

// Ensure global service directory in home exists
export function ensureGlobalInstalled(): void {
  const globalDir = getGlobalServiceDir();
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });

    // Create README
    const readmePath = join(globalDir, "README.md");
    writeFileSync(readmePath, generateReadme());

    // Create log file
    const logPath = join(globalDir, "service-consolelog.log");
    const logHeader = `# service-consolelog log file
# Created: ${new Date().toISOString()}
# This file contains global activity history.
# -------------------------------------------------------

`;
    writeFileSync(logPath, logHeader);
  }
}

export function ensureInstalled(projectRoot?: string): void {
  // Always ensure global directory exists
  ensureGlobalInstalled();

  // Also create project-specific directory if projectRoot specified
  if (projectRoot && !isInstalled(projectRoot)) {
    install({ projectRoot });
  }
}

// Normalize page name for filename (remove special chars, lowercase, replace spaces)
export function normalizePageName(pageName: string | null, pagePath: string): string {
  const name = pageName || pagePath;
  return name
    .toLowerCase()
    .replace(/^\//, "") // Remove leading slash
    .replace(/\//g, "_") // Replace slashes with underscores
    .replace(/[^a-z0-9_-]/g, "") // Remove special chars
    .replace(/^$/, "home"); // Default to "home" if empty (root path)
}

// Generate screenshot filename
export function generateScreenshotFilename(pageName: string | null, pagePath: string): string {
  const normalized = normalizePageName(pageName, pagePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueId = randomUUID().slice(0, 8);
  return `snapshot_${normalized}_${timestamp}_${uniqueId}.png`;
}

// Get full screenshot path
export function getScreenshotPath(filename: string, projectRoot?: string): string {
  return join(getSnapshotsDir(projectRoot), filename);
}

// Ensure snapshots directory exists
export function ensureSnapshotsDir(projectRoot?: string): string {
  const dir = getSnapshotsDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function install(options: InstallOptions = {}): { success: boolean; path: string; message: string } {
  const serviceDir = getServiceDir(options.projectRoot);

  if (existsSync(serviceDir) && !options.force) {
    return {
      success: false,
      path: serviceDir,
      message: "Already installed. Use --force to reinstall.",
    };
  }

  // Create directory
  mkdirSync(serviceDir, { recursive: true });

  // Create snapshots directory
  mkdirSync(getSnapshotsDir(options.projectRoot), { recursive: true });

  // Create README
  const readmeContent = generateReadme();
  writeFileSync(getReadmePath(options.projectRoot), readmeContent);

  // Create empty log file with header
  const logHeader = `# service-consolelog log file
# Created: ${new Date().toISOString()}
# This file contains local scan logs and activity history.
# -------------------------------------------------------

`;
  writeFileSync(getLogFilePath(options.projectRoot), logHeader);

  return {
    success: true,
    path: serviceDir,
    message: `Installed at ${serviceDir}`,
  };
}

export function uninstall(projectRoot?: string): { success: boolean; message: string } {
  const serviceDir = getServiceDir(projectRoot);

  if (!existsSync(serviceDir)) {
    return {
      success: false,
      message: "Not installed.",
    };
  }

  // Remove directory recursively
  const { rmSync } = require("fs");
  rmSync(serviceDir, { recursive: true, force: true });

  return {
    success: true,
    message: `Uninstalled from ${serviceDir}`,
  };
}

function generateReadme(): string {
  return `# .service-consolelog

This directory contains local configuration and logs for \`service-consolelog\`.

## Files & Folders

| Path | Description |
|------|-------------|
| \`service-consolelog.log\` | Activity log for console monitoring sessions |
| \`snapshots/\` | Page screenshots captured during scans |
| \`README.md\` | This file |

## Snapshots

Screenshots are captured during scans and saved to the \`snapshots/\` folder with naming:
\`\`\`
snapshot_<pagename>_<timestamp>_<uniqueid>.png
\`\`\`

Example: \`snapshot_home_2024-01-15T10-30-45-123Z_a1b2c3d4.png\`

## What is service-consolelog?

\`service-consolelog\` is a Bun-based service that monitors console logs from web applications using Playwright headless browser. It helps you:

- Track console errors, warnings, and info messages
- Monitor multiple pages across your applications
- View historical scan data
- Set up continuous monitoring with watch mode

## Usage

\`\`\`bash
# Add an app to monitor
service-consolelog app add --name "myapp" --port 3000 --url "http://localhost:3000"

# Add pages to monitor
service-consolelog page add --app "myapp" --path "/" --name "Home"
service-consolelog page add --app "myapp" --path "/dashboard" --name "Dashboard"

# Run a scan
service-consolelog scan --app "myapp"

# View logs
service-consolelog logs --app "myapp" --level error

# Start watching (continuous monitoring)
service-consolelog watch start --app "myapp" --interval 5
\`\`\`

## Log File

The \`service-consolelog.log\` file in this directory contains:
- Scan timestamps and results
- Error summaries
- Watch mode activity

This file is local to your project and is not synced to any remote service.

## Configuration

Global configuration is stored at \`~/.consolelog.json\`.
Database is stored at \`./data/consolelog.db\` (configurable).

## More Information

For full documentation, see the main project README or run:

\`\`\`bash
service-consolelog --help
\`\`\`
`;
}

// Logging utilities

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logToFile(
  message: string,
  level: LogLevel = "info",
  projectRoot?: string
): void {
  if (!isInstalled(projectRoot)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

  try {
    appendFileSync(getLogFilePath(projectRoot), logLine);
  } catch {
    // Silently fail if we can't write to log
  }
}

export function logScanStart(appName: string, pageCount: number, projectRoot?: string): void {
  logToFile(`Starting scan for "${appName}" (${pageCount} pages)`, "info", projectRoot);
}

export function logScanComplete(
  appName: string,
  pagesScanned: number,
  errorsFound: number,
  projectRoot?: string
): void {
  const level = errorsFound > 0 ? "warn" : "info";
  logToFile(
    `Scan complete for "${appName}": ${pagesScanned} pages, ${errorsFound} errors found`,
    level,
    projectRoot
  );
}

export function logWatchStart(appName: string, intervalMs: number, projectRoot?: string): void {
  const intervalMin = intervalMs / 60000;
  logToFile(`Watch mode started for "${appName}" (interval: ${intervalMin}min)`, "info", projectRoot);
}

export function logWatchStop(appName: string, projectRoot?: string): void {
  logToFile(`Watch mode stopped for "${appName}"`, "info", projectRoot);
}

export function logError(error: string, projectRoot?: string): void {
  logToFile(error, "error", projectRoot);
}
