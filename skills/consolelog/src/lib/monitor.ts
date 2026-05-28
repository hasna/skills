import { chromium, type Browser, type Page as PlaywrightPage } from "playwright";
import type { ConsoleLogEntry, ScanOptions, PageScanResult } from "./types";

export class ConsoleMonitor {
  private browser: Browser | null = null;
  private headless: boolean;

  constructor(headless = true) {
    this.headless = headless;
  }

  async start(): Promise<void> {
    if (this.browser) {
      return;
    }
    this.browser = await chromium.launch({ headless: this.headless });
  }

  async stop(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null;
  }

  async scanPage(url: string, options?: ScanOptions): Promise<PageScanResult> {
    if (!this.browser) {
      throw new Error("Browser not started. Call start() first.");
    }

    const context = await this.browser.newContext();
    const page = await context.newPage();
    const logs: ConsoleLogEntry[] = [];
    let screenshotPath: string | undefined;

    // Attach console listener for all message types
    page.on("console", (msg) => {
      const location = msg.location();
      logs.push({
        level: mapConsoleType(msg.type()),
        message: msg.text(),
        sourceUrl: location.url || undefined,
        lineNumber: location.lineNumber || undefined,
        columnNumber: location.columnNumber || undefined,
      });
    });

    // Attach error listener for uncaught exceptions
    page.on("pageerror", (err) => {
      logs.push({
        level: "error",
        message: err.message,
        stackTrace: err.stack,
      });
    });

    try {
      // Navigate to the page
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options?.timeout || 30000,
      });

      // Wait for specific selector if provided
      if (options?.waitFor) {
        await page.waitForSelector(options.waitFor, {
          timeout: options.timeout || 30000,
        });
      }

      // Small delay to catch any async console messages
      await page.waitForTimeout(1000);

      // Capture screenshot if requested
      if (options?.captureScreenshot && options?.screenshotDir) {
        try {
          screenshotPath = options.screenshotDir;
          await page.screenshot({
            path: screenshotPath,
            fullPage: true,
          });
        } catch (screenshotError) {
          const err = screenshotError as Error;
          logs.push({
            level: "warn",
            message: `Screenshot capture failed: ${err.message}`,
          });
          screenshotPath = undefined;
        }
      }
    } catch (error) {
      const err = error as Error;
      logs.push({
        level: "error",
        message: `Navigation error: ${err.message}`,
        stackTrace: err.stack,
      });
    } finally {
      await context.close();
    }

    return { logs, screenshotPath };
  }

  async scanMultiplePages(
    pages: { url: string; pageId: number; options?: ScanOptions }[]
  ): Promise<Map<number, PageScanResult>> {
    const results = new Map<number, PageScanResult>();

    for (const { url, pageId, options } of pages) {
      try {
        const result = await this.scanPage(url, options);
        results.set(pageId, result);
      } catch (error) {
        const err = error as Error;
        results.set(pageId, {
          logs: [
            {
              level: "error",
              message: `Failed to scan page: ${err.message}`,
              stackTrace: err.stack,
            },
          ],
        });
      }
    }

    return results;
  }

  async checkUrl(url: string, timeout = 5000): Promise<boolean> {
    if (!this.browser) {
      throw new Error("Browser not started. Call start() first.");
    }

    const context = await this.browser.newContext();
    const page = await context.newPage();

    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });
      await context.close();
      return response?.ok() ?? false;
    } catch {
      await context.close();
      return false;
    }
  }
}

function mapConsoleType(type: string): string {
  // Map Playwright console types to our levels
  switch (type) {
    case "error":
      return "error";
    case "warning":
      return "warn";
    case "info":
      return "info";
    case "log":
      return "log";
    case "debug":
      return "debug";
    case "trace":
      return "debug";
    case "assert":
      return "error";
    default:
      return "log";
  }
}

// Singleton instance for convenience
let monitorInstance: ConsoleMonitor | null = null;

export function getMonitor(headless = true): ConsoleMonitor {
  if (!monitorInstance) {
    monitorInstance = new ConsoleMonitor(headless);
  }
  return monitorInstance;
}

export async function shutdownMonitor(): Promise<void> {
  if (monitorInstance) {
    await monitorInstance.stop();
    monitorInstance = null;
  }
}
