import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

// Test database path
const TEST_DB_PATH = "./data/test_service_consolelog.db";

// Set env before importing modules
process.env.DATABASE_PATH = TEST_DB_PATH;

import { getDb, closeConnection, testConnection } from "../src/db/index";
import { createTables } from "../src/db/schema";
import {
  createApp,
  getAppById,
  getAppByName,
  getAllApps,
  updateApp,
  deleteApp,
  createPage,
  getPageById,
  getPagesByAppId,
  getPageByAppAndPath,
  deletePage,
  createScan,
  getScanById,
  getScans,
  updateScan,
  createConsoleLog,
  createConsoleLogsBatch,
  getConsoleLogs,
  countConsoleLogs,
  getLogsByLevel,
  createScreenshot,
  getScreenshotsByScanId,
} from "../src/db/queries";

describe("Database", () => {
  beforeAll(() => {
    // Ensure data directory exists
    if (!existsSync("./data")) {
      mkdirSync("./data", { recursive: true });
    }
    // Remove test db if exists
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + "-wal")) {
      unlinkSync(TEST_DB_PATH + "-wal");
    }
    if (existsSync(TEST_DB_PATH + "-shm")) {
      unlinkSync(TEST_DB_PATH + "-shm");
    }
    // Initialize database
    createTables();
  });

  afterAll(() => {
    closeConnection();
    // Cleanup test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + "-wal")) {
      unlinkSync(TEST_DB_PATH + "-wal");
    }
    if (existsSync(TEST_DB_PATH + "-shm")) {
      unlinkSync(TEST_DB_PATH + "-shm");
    }
  });

  describe("Connection", () => {
    test("should connect to database", () => {
      expect(testConnection()).toBe(true);
    });

    test("should get database instance", () => {
      const db = getDb();
      expect(db).toBeDefined();
      expect(db instanceof Database).toBe(true);
    });
  });

  describe("Apps CRUD", () => {
    let testAppId: number;

    test("should create an app", () => {
      const app = createApp({
        name: "test-app",
        port: 3000,
        base_url: "http://localhost:3000",
        description: "Test application",
      });

      expect(app).toBeDefined();
      expect(app.id).toBeGreaterThan(0);
      expect(app.name).toBe("test-app");
      expect(app.port).toBe(3000);
      expect(app.base_url).toBe("http://localhost:3000");
      expect(app.description).toBe("Test application");
      expect(app.active).toBe(1);

      testAppId = app.id;
    });

    test("should get app by id", () => {
      const app = getAppById(testAppId);
      expect(app).toBeDefined();
      expect(app!.name).toBe("test-app");
    });

    test("should get app by name", () => {
      const app = getAppByName("test-app");
      expect(app).toBeDefined();
      expect(app!.id).toBe(testAppId);
    });

    test("should return null for non-existent app", () => {
      const app = getAppById(99999);
      expect(app).toBeNull();
    });

    test("should get all apps", () => {
      const apps = getAllApps();
      expect(apps).toBeInstanceOf(Array);
      expect(apps.length).toBeGreaterThanOrEqual(1);
    });

    test("should update an app", () => {
      const updated = updateApp(testAppId, {
        port: 3001,
        description: "Updated description",
      });

      expect(updated).toBeDefined();
      expect(updated!.port).toBe(3001);
      expect(updated!.description).toBe("Updated description");
    });

    test("should update app active status", () => {
      const updated = updateApp(testAppId, { active: false });
      expect(updated!.active).toBe(0);

      // Restore active status
      updateApp(testAppId, { active: true });
    });

    test("should get only active apps", () => {
      // Create inactive app
      const inactiveApp = createApp({
        name: "inactive-app",
        port: 3002,
        base_url: "http://localhost:3002",
      });
      updateApp(inactiveApp.id, { active: false });

      const activeApps = getAllApps(true);
      const allApps = getAllApps(false);

      expect(activeApps.length).toBeLessThan(allApps.length);
      expect(activeApps.every((a) => a.active === 1)).toBe(true);

      // Cleanup
      deleteApp(inactiveApp.id);
    });
  });

  describe("Pages CRUD", () => {
    let testAppId: number;
    let testPageId: number;

    beforeAll(() => {
      const app = createApp({
        name: "page-test-app",
        port: 4000,
        base_url: "http://localhost:4000",
      });
      testAppId = app.id;
    });

    afterAll(() => {
      deleteApp(testAppId);
    });

    test("should create a page", () => {
      const page = createPage({
        app_id: testAppId,
        path: "/",
        name: "Home",
        wait_for: ".main-content",
        timeout: 5000,
      });

      expect(page).toBeDefined();
      expect(page.id).toBeGreaterThan(0);
      expect(page.app_id).toBe(testAppId);
      expect(page.path).toBe("/");
      expect(page.name).toBe("Home");
      expect(page.wait_for).toBe(".main-content");
      expect(page.timeout).toBe(5000);

      testPageId = page.id;
    });

    test("should get page by id", () => {
      const page = getPageById(testPageId);
      expect(page).toBeDefined();
      expect(page!.name).toBe("Home");
    });

    test("should get pages by app id", () => {
      // Add another page
      createPage({
        app_id: testAppId,
        path: "/about",
        name: "About",
      });

      const pages = getPagesByAppId(testAppId);
      expect(pages.length).toBeGreaterThanOrEqual(2);
    });

    test("should get page by app and path", () => {
      const page = getPageByAppAndPath(testAppId, "/");
      expect(page).toBeDefined();
      expect(page!.name).toBe("Home");
    });

    test("should delete a page", () => {
      const page = createPage({
        app_id: testAppId,
        path: "/delete-me",
      });

      const deleted = deletePage(page.id);
      expect(deleted).toBe(true);

      const found = getPageById(page.id);
      expect(found).toBeNull();
    });
  });

  describe("Scans CRUD", () => {
    let testAppId: number;
    let testScanId: number;

    beforeAll(() => {
      const app = createApp({
        name: "scan-test-app",
        port: 5000,
        base_url: "http://localhost:5000",
      });
      testAppId = app.id;
    });

    afterAll(() => {
      deleteApp(testAppId);
    });

    test("should create a scan", () => {
      const scan = createScan({ app_id: testAppId });

      expect(scan).toBeDefined();
      expect(scan.id).toBeGreaterThan(0);
      expect(scan.app_id).toBe(testAppId);
      expect(scan.status).toBe("running");
      expect(scan.pages_scanned).toBe(0);
      expect(scan.errors_found).toBe(0);

      testScanId = scan.id;
    });

    test("should get scan by id", () => {
      const scan = getScanById(testScanId);
      expect(scan).toBeDefined();
      expect(scan!.app_id).toBe(testAppId);
    });

    test("should get scans with filters", () => {
      const scans = getScans({ app_id: testAppId });
      expect(scans.length).toBeGreaterThanOrEqual(1);
    });

    test("should update scan status", () => {
      const updated = updateScan(testScanId, {
        status: "completed",
        pages_scanned: 5,
        errors_found: 2,
        completed_at: new Date().toISOString(),
      });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("completed");
      expect(updated!.pages_scanned).toBe(5);
      expect(updated!.errors_found).toBe(2);
      expect(updated!.completed_at).toBeDefined();
    });

    test("should limit scan results", () => {
      // Create multiple scans
      createScan({ app_id: testAppId });
      createScan({ app_id: testAppId });

      const limited = getScans({ app_id: testAppId, limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  describe("Console Logs CRUD", () => {
    let testAppId: number;
    let testPageId: number;
    let testScanId: number;

    beforeAll(() => {
      const app = createApp({
        name: "log-test-app",
        port: 6000,
        base_url: "http://localhost:6000",
      });
      testAppId = app.id;

      const page = createPage({
        app_id: testAppId,
        path: "/",
        name: "Home",
      });
      testPageId = page.id;

      const scan = createScan({ app_id: testAppId });
      testScanId = scan.id;
    });

    afterAll(() => {
      deleteApp(testAppId);
    });

    test("should create a console log", () => {
      const log = createConsoleLog({
        scan_id: testScanId,
        page_id: testPageId,
        level: "error",
        message: "Test error message",
        source_url: "http://localhost:6000/app.js",
        line_number: 42,
        column_number: 10,
        stack_trace: "Error: Test\n  at test.js:42:10",
      });

      expect(log).toBeDefined();
      expect(log.id).toBeGreaterThan(0);
      expect(log.level).toBe("error");
      expect(log.message).toBe("Test error message");
    });

    test("should create logs in batch", () => {
      const logs = [
        { scan_id: testScanId, page_id: testPageId, level: "warn" as const, message: "Warning 1" },
        { scan_id: testScanId, page_id: testPageId, level: "info" as const, message: "Info 1" },
        { scan_id: testScanId, page_id: testPageId, level: "log" as const, message: "Log 1" },
        { scan_id: testScanId, page_id: testPageId, level: "debug" as const, message: "Debug 1" },
      ];

      const count = createConsoleLogsBatch(logs);
      expect(count).toBe(4);
    });

    test("should get logs with filters", () => {
      const errorLogs = getConsoleLogs({ scan_id: testScanId, level: "error" });
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);
      expect(errorLogs.every((l) => l.level === "error")).toBe(true);
    });

    test("should count logs", () => {
      const count = countConsoleLogs({ scan_id: testScanId });
      expect(count).toBeGreaterThanOrEqual(5);
    });

    test("should get logs by level", () => {
      const counts = getLogsByLevel(testScanId);
      expect(counts).toBeDefined();
      expect(counts.error).toBeGreaterThanOrEqual(1);
      expect(counts.warn).toBeGreaterThanOrEqual(1);
      expect(counts.info).toBeGreaterThanOrEqual(1);
      expect(counts.log).toBeGreaterThanOrEqual(1);
      expect(counts.debug).toBeGreaterThanOrEqual(1);
    });

    test("should limit log results", () => {
      const limited = getConsoleLogs({ scan_id: testScanId, limit: 2 });
      expect(limited.length).toBe(2);
    });

    test("should offset log results", () => {
      const all = getConsoleLogs({ scan_id: testScanId });
      const offset = getConsoleLogs({ scan_id: testScanId, offset: 2 });
      expect(offset.length).toBe(all.length - 2);
    });
  });

  describe("Screenshots CRUD", () => {
    let testAppId: number;
    let testPageId: number;
    let testScanId: number;

    beforeAll(() => {
      const app = createApp({
        name: "screenshot-test-app",
        port: 7000,
        base_url: "http://localhost:7000",
      });
      testAppId = app.id;

      const page = createPage({
        app_id: testAppId,
        path: "/",
        name: "Home",
      });
      testPageId = page.id;

      const scan = createScan({ app_id: testAppId });
      testScanId = scan.id;
    });

    afterAll(() => {
      deleteApp(testAppId);
    });

    test("should create a screenshot", () => {
      const screenshot = createScreenshot({
        scan_id: testScanId,
        page_id: testPageId,
        filename: "snapshot_home_2024-01-01_abc123.png",
        filepath: "/path/to/snapshot_home_2024-01-01_abc123.png",
      });

      expect(screenshot).toBeDefined();
      expect(screenshot.id).toBeGreaterThan(0);
      expect(screenshot.filename).toBe("snapshot_home_2024-01-01_abc123.png");
    });

    test("should get screenshots by scan id", () => {
      const screenshots = getScreenshotsByScanId(testScanId);
      expect(screenshots.length).toBeGreaterThanOrEqual(1);
    });
  });
});
