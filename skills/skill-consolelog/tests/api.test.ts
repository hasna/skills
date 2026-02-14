import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, mkdirSync } from "fs";

// Test database path
const TEST_DB_PATH = "./data/test_api_service_consolelog.db";
process.env.DATABASE_PATH = TEST_DB_PATH;

import { createTables } from "../src/db/schema";
import { closeConnection } from "../src/db/index";
import {
  createApp,
  createPage,
  createScan,
  createConsoleLog,
  deleteApp,
} from "../src/db/queries";

// We'll test the API handlers directly since starting the server
// in tests can cause port conflicts

describe("API Handlers", () => {
  let testAppId: number;
  let testPageId: number;
  let testScanId: number;

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

    // Create test data
    const app = createApp({
      name: "api-test-app",
      port: 9000,
      base_url: "http://localhost:9000",
      description: "API test app",
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

    // Add some logs
    createConsoleLog({
      scan_id: testScanId,
      page_id: testPageId,
      level: "error",
      message: "Test error",
    });
    createConsoleLog({
      scan_id: testScanId,
      page_id: testPageId,
      level: "warn",
      message: "Test warning",
    });
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

  describe("Data integrity for API", () => {
    test("should have test app created", () => {
      const { getAppById } = require("../src/db/queries");
      const app = getAppById(testAppId);
      expect(app).toBeDefined();
      expect(app.name).toBe("api-test-app");
    });

    test("should have test page created", () => {
      const { getPageById } = require("../src/db/queries");
      const page = getPageById(testPageId);
      expect(page).toBeDefined();
      expect(page.name).toBe("Home");
    });

    test("should have test scan created", () => {
      const { getScanById } = require("../src/db/queries");
      const scan = getScanById(testScanId);
      expect(scan).toBeDefined();
    });

    test("should have logs created", () => {
      const { getConsoleLogs } = require("../src/db/queries");
      const logs = getConsoleLogs({ scan_id: testScanId });
      expect(logs.length).toBe(2);
    });
  });

  describe("Query functions for API endpoints", () => {
    test("getAllApps should return array", () => {
      const { getAllApps } = require("../src/db/queries");
      const apps = getAllApps();
      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThan(0);
    });

    test("getScans with filter should work", () => {
      const { getScans } = require("../src/db/queries");
      const scans = getScans({ app_id: testAppId, limit: 10 });
      expect(Array.isArray(scans)).toBe(true);
    });

    test("getConsoleLogs with multiple filters should work", () => {
      const { getConsoleLogs } = require("../src/db/queries");
      const logs = getConsoleLogs({
        app_id: testAppId,
        level: "error",
        limit: 10,
        offset: 0,
      });
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.every((l: any) => l.level === "error")).toBe(true);
    });

    test("countConsoleLogs should return number", () => {
      const { countConsoleLogs } = require("../src/db/queries");
      const count = countConsoleLogs({ scan_id: testScanId });
      expect(typeof count).toBe("number");
      expect(count).toBe(2);
    });
  });
});
