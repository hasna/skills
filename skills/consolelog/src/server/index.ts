import { createTables } from "../db/schema";
import { getDb } from "../db/index";
import {
  createApp,
  getAllApps,
  getAppById,
  getAppByName,
  updateApp,
  deleteApp,
  createPage,
  getPagesByAppId,
  deletePage,
  createScan,
  getScans,
  getScanById,
  updateScan,
  getConsoleLogs,
  countConsoleLogs,
  createConsoleLogsBatch,
} from "../db/queries";
import { testConnection } from "../db/index";
import { getMonitor, shutdownMonitor } from "../lib/monitor";
import {
  startWatching,
  stopWatching,
  getWatchStatus,
  isWatching,
} from "../lib/watcher";
import { isHeadless, getServerPort } from "../lib/config";
import { logScanStart, logScanComplete, logWatchStart, logWatchStop } from "../lib/installer";
import type { ConsoleLogLevel, CreateConsoleLogInput, ApiResponse, LogFilter } from "../lib/types";

const PATH_PREFIX = '/consolelog';
const API_KEY = process.env.API_KEY || '';

// API Key validation - ALWAYS require API key
function validateApiKey(req: Request): boolean {
  if (!API_KEY) {
    console.warn('WARNING: API_KEY not set - all requests will be rejected');
    return false;
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  return authHeader.slice(7) === API_KEY;
}

async function ensureDb(): Promise<void> {
  getDb();
  await createTables();
}

function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

function success<T>(data: T): Response {
  return json({ success: true, data });
}

async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function getPathParams(pathname: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      const paramName = patternParts[i].slice(1);
      params[paramName] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let { pathname } = url;
  const { searchParams } = url;
  const method = req.method;

  // Strip path prefix if present (for ALB routing)
  if (pathname.startsWith(PATH_PREFIX)) {
    pathname = pathname.slice(PATH_PREFIX.length) || '/';
  }

  // Health check (no auth required)
  if (pathname === "/health" && method === "GET") {
    return success({ status: "ok", timestamp: new Date().toISOString() });
  }

  // All routes below require authentication
  if (!validateApiKey(req)) {
    return error("Unauthorized", 401);
  }

  // ============ APPS ============

  // GET /api/apps
  if (pathname === "/api/apps" && method === "GET") {
    const apps = await getAllApps();
    return success(apps);
  }

  // POST /api/apps
  if (pathname === "/api/apps" && method === "POST") {
    const body = await parseBody<{
      name: string;
      port: number;
      base_url: string;
      description?: string;
    }>(req);

    if (!body || !body.name || !body.port || !body.base_url) {
      return error("Missing required fields: name, port, base_url");
    }

    try {
      const app = await createApp(body);
      return success(app);
    } catch (e) {
      const err = e as Error;
      return error(err.message);
    }
  }

  // GET /api/apps/:id
  let params = getPathParams(pathname, "/api/apps/:id");
  if (params && method === "GET") {
    const app = await getAppById(parseInt(params.id, 10)) || await getAppByName(params.id);
    if (!app) {
      return error("App not found", 404);
    }
    return success(app);
  }

  // PUT /api/apps/:id
  if (params && method === "PUT") {
    const app = await getAppById(parseInt(params.id, 10));
    if (!app) {
      return error("App not found", 404);
    }

    const body = await parseBody<{
      name?: string;
      port?: number;
      base_url?: string;
      description?: string;
      active?: boolean;
    }>(req);

    if (!body) {
      return error("Invalid request body");
    }

    const updated = await updateApp(app.id, body);
    return success(updated);
  }

  // DELETE /api/apps/:id
  if (params && method === "DELETE") {
    const app = await getAppById(parseInt(params.id, 10));
    if (!app) {
      return error("App not found", 404);
    }

    await deleteApp(app.id);
    return success({ deleted: true });
  }

  // ============ PAGES ============

  // GET /api/apps/:appId/pages
  params = getPathParams(pathname, "/api/apps/:appId/pages");
  if (params && method === "GET") {
    const app = await getAppById(parseInt(params.appId, 10));
    if (!app) {
      return error("App not found", 404);
    }

    const pages = await getPagesByAppId(app.id);
    return success(pages);
  }

  // POST /api/apps/:appId/pages
  if (params && method === "POST") {
    const app = await getAppById(parseInt(params.appId, 10));
    if (!app) {
      return error("App not found", 404);
    }

    const body = await parseBody<{
      path: string;
      name?: string;
      wait_for?: string;
      timeout?: number;
    }>(req);

    if (!body || !body.path) {
      return error("Missing required field: path");
    }

    try {
      const page = await createPage({
        app_id: app.id,
        path: body.path,
        name: body.name,
        wait_for: body.wait_for,
        timeout: body.timeout,
      });
      return success(page);
    } catch (e) {
      const err = e as Error;
      return error(err.message);
    }
  }

  // DELETE /api/pages/:id
  params = getPathParams(pathname, "/api/pages/:id");
  if (params && method === "DELETE") {
    const deleted = await deletePage(parseInt(params.id, 10));
    if (!deleted) {
      return error("Page not found", 404);
    }
    return success({ deleted: true });
  }

  // ============ SCANS ============

  // GET /api/scans
  if (pathname === "/api/scans" && method === "GET") {
    const appId = searchParams.get("appId");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    const scans = await getScans({
      app_id: appId ? parseInt(appId, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return success(scans);
  }

  // POST /api/scans
  if (pathname === "/api/scans" && method === "POST") {
    const body = await parseBody<{
      appId: number;
      pages?: string[];
    }>(req);

    if (!body || !body.appId) {
      return error("Missing required field: appId");
    }

    const app = await getAppById(body.appId);
    if (!app) {
      return error("App not found", 404);
    }

    // Run scan asynchronously
    runScan(app.id, body.pages).catch(console.error);

    return success({ message: "Scan started", appId: app.id });
  }

  // GET /api/scans/:id
  params = getPathParams(pathname, "/api/scans/:id");
  if (params && method === "GET") {
    const scan = await getScanById(parseInt(params.id, 10));
    if (!scan) {
      return error("Scan not found", 404);
    }

    const logs = await getConsoleLogs({ scan_id: scan.id });
    return success({ ...scan, logs });
  }

  // ============ LOGS ============

  // GET /api/logs
  if (pathname === "/api/logs" && method === "GET") {
    const filter: LogFilter = {};

    const appId = searchParams.get("appId");
    const scanId = searchParams.get("scanId");
    const level = searchParams.get("level");
    const since = searchParams.get("since");
    const until = searchParams.get("until");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    if (appId) filter.app_id = parseInt(appId, 10);
    if (scanId) filter.scan_id = parseInt(scanId, 10);
    if (level) filter.level = level as ConsoleLogLevel;
    if (since) filter.since = since;
    if (until) filter.until = until;
    if (limit) filter.limit = parseInt(limit, 10);
    if (offset) filter.offset = parseInt(offset, 10);

    const logs = await getConsoleLogs(filter);
    const total = await countConsoleLogs(filter);

    return json({
      success: true,
      data: logs,
      total,
      limit: filter.limit || 50,
      offset: filter.offset || 0,
    });
  }

  // GET /api/logs/export
  if (pathname === "/api/logs/export" && method === "GET") {
    const appId = searchParams.get("appId");
    const format = searchParams.get("format") || "json";

    if (!appId) {
      return error("Missing required param: appId");
    }

    const logs = await getConsoleLogs({ app_id: parseInt(appId, 10) });

    if (format === "csv") {
      const headers = ["id", "scan_id", "page_id", "level", "message", "source_url", "line_number", "column_number", "timestamp"];
      const rows = logs.map((l) =>
        [l.id, l.scan_id, l.page_id, l.level, `"${l.message.replace(/"/g, '""')}"`, l.source_url || "", l.line_number || "", l.column_number || "", l.timestamp].join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=logs.csv",
        },
      });
    }

    return json(logs);
  }

  // ============ WATCH ============

  // POST /api/watch/start
  if (pathname === "/api/watch/start" && method === "POST") {
    const body = await parseBody<{
      appId: number;
      intervalMs?: number;
    }>(req);

    if (!body || !body.appId) {
      return error("Missing required field: appId");
    }

    const app = await getAppById(body.appId);
    if (!app) {
      return error("App not found", 404);
    }

    try {
      const started = await startWatching(app.id, body.intervalMs);
      if (started) {
        logWatchStart(app.name, body.intervalMs || 300000);
        return success({ message: "Watch started", appId: app.id });
      } else {
        return success({ message: "Already watching", appId: app.id });
      }
    } catch (e) {
      const err = e as Error;
      return error(err.message);
    }
  }

  // POST /api/watch/stop
  if (pathname === "/api/watch/stop" && method === "POST") {
    const body = await parseBody<{ appId: number }>(req);

    if (!body || !body.appId) {
      return error("Missing required field: appId");
    }

    const app = await getAppById(body.appId);
    if (!app) {
      return error("App not found", 404);
    }

    const stopped = stopWatching(app.id);
    if (stopped) {
      logWatchStop(app.name);
    }
    return success({ stopped, appId: app.id });
  }

  // GET /api/watch/status
  if (pathname === "/api/watch/status" && method === "GET") {
    const statuses = await getWatchStatus();
    return success(statuses);
  }

  // 404
  return error("Not found", 404);
}

async function runScan(appId: number, specificPaths?: string[]): Promise<void> {
  const app = await getAppById(appId);
  if (!app) return;

  let pages = await getPagesByAppId(appId, true);

  if (specificPaths && specificPaths.length > 0) {
    pages = pages.filter((p) => specificPaths.includes(p.path));
  }

  if (pages.length === 0) return;

  logScanStart(app.name, pages.length);

  const monitor = getMonitor(isHeadless());
  await monitor.start();

  const scan = await createScan({ app_id: appId });
  let totalErrors = 0;
  let pagesScanned = 0;

  try {
    for (const page of pages) {
      const url = `${app.base_url}${page.path}`;

      try {
        const logs = await monitor.scanPage(url, {
          timeout: page.timeout,
          waitFor: page.wait_for || undefined,
        });

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
      } catch (e) {
        console.error(`Error scanning ${url}:`, e);
      }
    }
  } finally {
    await shutdownMonitor();
  }

  await updateScan(scan.id, {
    status: "completed",
    pages_scanned: pagesScanned,
    errors_found: totalErrors,
    completed_at: new Date().toISOString(),
  });

  logScanComplete(app.name, pagesScanned, totalErrors);
}

export async function startServer(port?: number): Promise<void> {
  await ensureDb();

  const serverPort = port || getServerPort();

  Bun.serve({
    port: serverPort,
    fetch: handleRequest,
  });

  console.log(`Server running at http://localhost:${serverPort}`);
}

// Allow running directly
if (import.meta.main) {
  startServer();
}
