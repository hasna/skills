// Database Types

export interface App {
  id: number;
  name: string;
  port: number;
  base_url: string;
  description: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: number;
  app_id: number;
  path: string;
  name: string | null;
  wait_for: string | null;
  timeout: number;
  active: number;
  created_at: string;
}

export interface Scan {
  id: number;
  app_id: number;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  pages_scanned: number;
  errors_found: number;
}

export interface ConsoleLog {
  id: number;
  scan_id: number;
  page_id: number;
  level: ConsoleLogLevel;
  message: string;
  source_url: string | null;
  line_number: number | null;
  column_number: number | null;
  stack_trace: string | null;
  timestamp: string;
}

export type ConsoleLogLevel = "error" | "warn" | "info" | "log" | "debug";

// Input Types

export interface CreateAppInput {
  name: string;
  port: number;
  base_url: string;
  description?: string;
}

export interface UpdateAppInput {
  name?: string;
  port?: number;
  base_url?: string;
  description?: string;
  active?: boolean;
}

export interface CreatePageInput {
  app_id: number;
  path: string;
  name?: string;
  wait_for?: string;
  timeout?: number;
}

export interface CreateScanInput {
  app_id: number;
}

export interface CreateConsoleLogInput {
  scan_id: number;
  page_id: number;
  level: ConsoleLogLevel;
  message: string;
  source_url?: string;
  line_number?: number;
  column_number?: number;
  stack_trace?: string;
}

// Query Filters

export interface LogFilter {
  app_id?: number;
  scan_id?: number;
  page_id?: number;
  level?: ConsoleLogLevel;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface ScanFilter {
  app_id?: number;
  status?: "running" | "completed" | "failed";
  limit?: number;
  offset?: number;
}

// Scan Options

export interface ScanOptions {
  timeout?: number;
  waitFor?: string;
  captureScreenshot?: boolean;
  screenshotDir?: string;
}

// Screenshot

export interface Screenshot {
  id: number;
  scan_id: number;
  page_id: number;
  filename: string;
  filepath: string;
  created_at: string;
}

export interface CreateScreenshotInput {
  scan_id: number;
  page_id: number;
  filename: string;
  filepath: string;
}

// Console Log Entry (from Playwright)

export interface ConsoleLogEntry {
  level: string;
  message: string;
  sourceUrl?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
}

// Page Scan Result

export interface PageScanResult {
  logs: ConsoleLogEntry[];
  screenshotPath?: string;
}

// Watch Status

export interface WatchStatus {
  appId: number;
  appName: string;
  active: boolean;
  intervalMs?: number;
  lastScan?: string;
}

// Config

export interface Config {
  databasePath: string;
  headless: boolean;
  defaultTimeout: number;
  watchInterval: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

// API Response Types

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
