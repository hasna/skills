import { ConsoleMonitor, getMonitor } from "./monitor";
import {
  getAppById,
  getPagesByAppId,
  createScan,
  updateScan,
  createConsoleLogsBatch,
} from "../db/queries";
import { getWatchInterval, isHeadless } from "./config";
import type { WatchStatus, ConsoleLogEntry, CreateConsoleLogInput, ConsoleLogLevel } from "./types";

interface WatcherInfo {
  timer: Timer;
  intervalMs: number;
  lastScan: string | null;
}

class ConsoleWatcher {
  private watchers: Map<number, WatcherInfo> = new Map();
  private monitor: ConsoleMonitor | null = null;

  async ensureMonitor(): Promise<ConsoleMonitor> {
    if (!this.monitor) {
      this.monitor = getMonitor(isHeadless());
      await this.monitor.start();
    }
    return this.monitor;
  }

  async start(appId: number, intervalMs?: number): Promise<boolean> {
    // Check if already watching
    if (this.watchers.has(appId)) {
      return false;
    }

    // Verify app exists
    const app = await getAppById(appId);
    if (!app) {
      throw new Error(`App with ID ${appId} not found`);
    }

    const interval = intervalMs || getWatchInterval();

    // Run initial scan
    await this.scanApp(appId);

    // Set up interval
    const timer = setInterval(async () => {
      await this.scanApp(appId);
    }, interval);

    this.watchers.set(appId, {
      timer,
      intervalMs: interval,
      lastScan: new Date().toISOString(),
    });

    return true;
  }

  stop(appId: number): boolean {
    const info = this.watchers.get(appId);
    if (!info) {
      return false;
    }

    clearInterval(info.timer);
    this.watchers.delete(appId);
    return true;
  }

  async stopAll(): Promise<void> {
    for (const [appId] of this.watchers) {
      this.stop(appId);
    }

    if (this.monitor) {
      await this.monitor.stop();
      this.monitor = null;
    }
  }

  isWatching(appId: number): boolean {
    return this.watchers.has(appId);
  }

  async getStatus(): Promise<WatchStatus[]> {
    const statuses: WatchStatus[] = [];

    for (const [appId, info] of this.watchers) {
      const app = await getAppById(appId);
      if (app) {
        statuses.push({
          appId,
          appName: app.name,
          active: true,
          intervalMs: info.intervalMs,
          lastScan: info.lastScan || undefined,
        });
      }
    }

    return statuses;
  }

  getWatcherInfo(appId: number): WatcherInfo | undefined {
    return this.watchers.get(appId);
  }

  private async scanApp(appId: number): Promise<void> {
    try {
      const app = await getAppById(appId);
      if (!app || !app.active) {
        this.stop(appId);
        return;
      }

      const pages = await getPagesByAppId(appId, true);
      if (pages.length === 0) {
        return;
      }

      const monitor = await this.ensureMonitor();

      // Create scan record
      const scan = await createScan({ app_id: appId });

      let totalErrors = 0;
      let pagesScanned = 0;

      // Scan each page
      for (const page of pages) {
        const url = `${app.base_url}${page.path}`;

        try {
          const logs = await monitor.scanPage(url, {
            timeout: page.timeout,
            waitFor: page.wait_for || undefined,
          });

          // Save logs to database
          if (logs.length > 0) {
            const logInputs: CreateConsoleLogInput[] = logs.map((log) => ({
              scan_id: scan.id,
              page_id: page.id,
              level: log.level as ConsoleLogLevel,
              message: log.message,
              source_url: log.sourceUrl,
              line_number: log.lineNumber,
              column_number: log.columnNumber,
              stack_trace: log.stackTrace,
            }));

            await createConsoleLogsBatch(logInputs);
            totalErrors += logs.filter((l) => l.level === "error").length;
          }

          pagesScanned++;
        } catch (error) {
          const err = error as Error;
          console.error(`Error scanning page ${url}:`, err.message);
        }
      }

      // Update scan record
      await updateScan(scan.id, {
        status: "completed",
        pages_scanned: pagesScanned,
        errors_found: totalErrors,
        completed_at: new Date().toISOString(),
      });

      // Update last scan time
      const info = this.watchers.get(appId);
      if (info) {
        info.lastScan = new Date().toISOString();
      }
    } catch (error) {
      const err = error as Error;
      console.error(`Watch scan failed for app ${appId}:`, err.message);
    }
  }
}

// Singleton instance
export const watcher = new ConsoleWatcher();

// Convenience exports
export function startWatching(appId: number, intervalMs?: number): Promise<boolean> {
  return watcher.start(appId, intervalMs);
}

export function stopWatching(appId: number): boolean {
  return watcher.stop(appId);
}

export async function getWatchStatus(): Promise<WatchStatus[]> {
  return watcher.getStatus();
}

export function isWatching(appId: number): boolean {
  return watcher.isWatching(appId);
}

export async function stopAllWatchers(): Promise<void> {
  return watcher.stopAll();
}
