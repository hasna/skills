import { sql } from "./index";
import type {
  App,
  Page,
  Scan,
  ConsoleLog,
  Screenshot,
  CreateAppInput,
  UpdateAppInput,
  CreatePageInput,
  CreateScanInput,
  CreateConsoleLogInput,
  CreateScreenshotInput,
  LogFilter,
  ScanFilter,
} from "../lib/types";

// ============ APPS ============

export async function createApp(input: CreateAppInput): Promise<App> {
  const result = await sql<App[]>`
    INSERT INTO apps (name, port, base_url, description)
    VALUES (${input.name}, ${input.port}, ${input.base_url}, ${input.description || null})
    RETURNING *
  `;
  return result[0];
}

export async function getAppById(id: number): Promise<App | null> {
  const result = await sql<App[]>`SELECT * FROM apps WHERE id = ${id}`;
  return result[0] || null;
}

export async function getAppByName(name: string): Promise<App | null> {
  const result = await sql<App[]>`SELECT * FROM apps WHERE name = ${name}`;
  return result[0] || null;
}

export async function getAllApps(activeOnly = false): Promise<App[]> {
  if (activeOnly) {
    return sql<App[]>`SELECT * FROM apps WHERE active = true ORDER BY name`;
  }
  return sql<App[]>`SELECT * FROM apps ORDER BY name`;
}

export async function updateApp(id: number, input: UpdateAppInput): Promise<App | null> {
  const result = await sql<App[]>`
    UPDATE apps SET
      name = COALESCE(${input.name}, name),
      port = COALESCE(${input.port}, port),
      base_url = COALESCE(${input.base_url}, base_url),
      description = COALESCE(${input.description}, description),
      active = COALESCE(${input.active}, active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `;
  return result[0] || null;
}

export async function deleteApp(id: number): Promise<boolean> {
  const result = await sql`DELETE FROM apps WHERE id = ${id}`;
  return result.count > 0;
}

// ============ PAGES ============

export async function createPage(input: CreatePageInput): Promise<Page> {
  const result = await sql<Page[]>`
    INSERT INTO pages (app_id, path, name, wait_for, timeout)
    VALUES (${input.app_id}, ${input.path}, ${input.name || null}, ${input.wait_for || null}, ${input.timeout || 30000})
    RETURNING *
  `;
  return result[0];
}

export async function getPageById(id: number): Promise<Page | null> {
  const result = await sql<Page[]>`SELECT * FROM pages WHERE id = ${id}`;
  return result[0] || null;
}

export async function getPagesByAppId(appId: number, activeOnly = false): Promise<Page[]> {
  if (activeOnly) {
    return sql<Page[]>`SELECT * FROM pages WHERE app_id = ${appId} AND active = true ORDER BY path`;
  }
  return sql<Page[]>`SELECT * FROM pages WHERE app_id = ${appId} ORDER BY path`;
}

export async function getPageByAppAndPath(appId: number, path: string): Promise<Page | null> {
  const result = await sql<Page[]>`SELECT * FROM pages WHERE app_id = ${appId} AND path = ${path}`;
  return result[0] || null;
}

export async function deletePage(id: number): Promise<boolean> {
  const result = await sql`DELETE FROM pages WHERE id = ${id}`;
  return result.count > 0;
}

export async function updatePageActive(id: number, active: boolean): Promise<boolean> {
  const result = await sql`UPDATE pages SET active = ${active} WHERE id = ${id}`;
  return result.count > 0;
}

// ============ SCANS ============

export async function createScan(input: CreateScanInput): Promise<Scan> {
  const result = await sql<Scan[]>`
    INSERT INTO scans (app_id)
    VALUES (${input.app_id})
    RETURNING *
  `;
  return result[0];
}

export async function getScanById(id: number): Promise<Scan | null> {
  const result = await sql<Scan[]>`SELECT * FROM scans WHERE id = ${id}`;
  return result[0] || null;
}

export async function getScans(filter: ScanFilter = {}): Promise<Scan[]> {
  const conditions: string[] = [];

  if (filter.app_id !== undefined) {
    conditions.push(`app_id = ${filter.app_id}`);
  }
  if (filter.status !== undefined) {
    conditions.push(`status = '${filter.status}'`);
  }

  const limit = filter.limit !== undefined ? filter.limit : 100;
  const offset = filter.offset !== undefined ? filter.offset : 0;

  if (conditions.length === 0) {
    return sql<Scan[]>`SELECT * FROM scans ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  // Build dynamic query with conditions
  if (filter.app_id !== undefined && filter.status !== undefined) {
    return sql<Scan[]>`SELECT * FROM scans WHERE app_id = ${filter.app_id} AND status = ${filter.status} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (filter.app_id !== undefined) {
    return sql<Scan[]>`SELECT * FROM scans WHERE app_id = ${filter.app_id} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (filter.status !== undefined) {
    return sql<Scan[]>`SELECT * FROM scans WHERE status = ${filter.status} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  return sql<Scan[]>`SELECT * FROM scans ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function updateScan(
  id: number,
  updates: {
    status?: "running" | "completed" | "failed";
    pages_scanned?: number;
    errors_found?: number;
    completed_at?: string;
  }
): Promise<Scan | null> {
  const result = await sql<Scan[]>`
    UPDATE scans SET
      status = COALESCE(${updates.status}, status),
      pages_scanned = COALESCE(${updates.pages_scanned}, pages_scanned),
      errors_found = COALESCE(${updates.errors_found}, errors_found),
      completed_at = COALESCE(${updates.completed_at}, completed_at)
    WHERE id = ${id}
    RETURNING *
  `;
  return result[0] || null;
}

export async function getLastScanForApp(appId: number): Promise<Scan | null> {
  const result = await sql<Scan[]>`
    SELECT * FROM scans WHERE app_id = ${appId} ORDER BY started_at DESC LIMIT 1
  `;
  return result[0] || null;
}

// ============ CONSOLE LOGS ============

export async function createConsoleLog(input: CreateConsoleLogInput): Promise<ConsoleLog> {
  const result = await sql<ConsoleLog[]>`
    INSERT INTO console_logs (scan_id, page_id, level, message, source_url, line_number, column_number, stack_trace)
    VALUES (${input.scan_id}, ${input.page_id}, ${input.level}, ${input.message}, ${input.source_url || null}, ${input.line_number || null}, ${input.column_number || null}, ${input.stack_trace || null})
    RETURNING *
  `;
  return result[0];
}

export async function createConsoleLogsBatch(inputs: CreateConsoleLogInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  let count = 0;
  await sql.begin(async (sql) => {
    for (const log of inputs) {
      await sql`
        INSERT INTO console_logs (scan_id, page_id, level, message, source_url, line_number, column_number, stack_trace)
        VALUES (${log.scan_id}, ${log.page_id}, ${log.level}, ${log.message}, ${log.source_url || null}, ${log.line_number || null}, ${log.column_number || null}, ${log.stack_trace || null})
      `;
      count++;
    }
  });
  return count;
}

export async function getConsoleLogById(id: number): Promise<ConsoleLog | null> {
  const result = await sql<ConsoleLog[]>`SELECT * FROM console_logs WHERE id = ${id}`;
  return result[0] || null;
}

export async function getConsoleLogs(filter: LogFilter = {}): Promise<ConsoleLog[]> {
  const limit = filter.limit !== undefined ? filter.limit : 100;
  const offset = filter.offset !== undefined ? filter.offset : 0;

  // Handle app_id filter with join
  if (filter.app_id !== undefined) {
    if (filter.level !== undefined) {
      return sql<ConsoleLog[]>`
        SELECT console_logs.* FROM console_logs
        JOIN scans ON console_logs.scan_id = scans.id
        WHERE scans.app_id = ${filter.app_id} AND console_logs.level = ${filter.level}
        ORDER BY console_logs.timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    return sql<ConsoleLog[]>`
      SELECT console_logs.* FROM console_logs
      JOIN scans ON console_logs.scan_id = scans.id
      WHERE scans.app_id = ${filter.app_id}
      ORDER BY console_logs.timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  // Handle other filters
  if (filter.scan_id !== undefined && filter.level !== undefined) {
    return sql<ConsoleLog[]>`
      SELECT * FROM console_logs
      WHERE scan_id = ${filter.scan_id} AND level = ${filter.level}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (filter.scan_id !== undefined) {
    return sql<ConsoleLog[]>`
      SELECT * FROM console_logs
      WHERE scan_id = ${filter.scan_id}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (filter.level !== undefined) {
    return sql<ConsoleLog[]>`
      SELECT * FROM console_logs
      WHERE level = ${filter.level}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql<ConsoleLog[]>`SELECT * FROM console_logs ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function countConsoleLogs(filter: LogFilter = {}): Promise<number> {
  let result: { count: string }[];

  if (filter.app_id !== undefined) {
    if (filter.level !== undefined) {
      result = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM console_logs
        JOIN scans ON console_logs.scan_id = scans.id
        WHERE scans.app_id = ${filter.app_id} AND console_logs.level = ${filter.level}
      `;
    } else {
      result = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM console_logs
        JOIN scans ON console_logs.scan_id = scans.id
        WHERE scans.app_id = ${filter.app_id}
      `;
    }
  } else if (filter.scan_id !== undefined) {
    result = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count FROM console_logs WHERE scan_id = ${filter.scan_id}
    `;
  } else {
    result = await sql<{ count: string }[]>`SELECT COUNT(*)::text as count FROM console_logs`;
  }

  return parseInt(result[0].count, 10);
}

export async function getLogsByLevel(scanId: number): Promise<Record<string, number>> {
  const results = await sql<{ level: string; count: string }[]>`
    SELECT level, COUNT(*)::text as count
    FROM console_logs
    WHERE scan_id = ${scanId}
    GROUP BY level
  `;

  const counts: Record<string, number> = {
    error: 0,
    warn: 0,
    info: 0,
    log: 0,
    debug: 0,
  };

  for (const row of results) {
    counts[row.level] = parseInt(row.count, 10);
  }

  return counts;
}

// ============ SCREENSHOTS ============

export async function createScreenshot(input: CreateScreenshotInput): Promise<Screenshot> {
  const result = await sql<Screenshot[]>`
    INSERT INTO screenshots (scan_id, page_id, filename, filepath)
    VALUES (${input.scan_id}, ${input.page_id}, ${input.filename}, ${input.filepath})
    RETURNING *
  `;
  return result[0];
}

export async function getScreenshotById(id: number): Promise<Screenshot | null> {
  const result = await sql<Screenshot[]>`SELECT * FROM screenshots WHERE id = ${id}`;
  return result[0] || null;
}

export async function getScreenshotsByScanId(scanId: number): Promise<Screenshot[]> {
  return sql<Screenshot[]>`SELECT * FROM screenshots WHERE scan_id = ${scanId} ORDER BY created_at DESC`;
}

export async function getScreenshotsByPageId(pageId: number): Promise<Screenshot[]> {
  return sql<Screenshot[]>`SELECT * FROM screenshots WHERE page_id = ${pageId} ORDER BY created_at DESC`;
}

export async function getLatestScreenshotForPage(scanId: number, pageId: number): Promise<Screenshot | null> {
  const result = await sql<Screenshot[]>`
    SELECT * FROM screenshots
    WHERE scan_id = ${scanId} AND page_id = ${pageId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return result[0] || null;
}

export async function deleteScreenshot(id: number): Promise<boolean> {
  const result = await sql`DELETE FROM screenshots WHERE id = ${id}`;
  return result.count > 0;
}
