import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

import {
  install,
  uninstall,
  isInstalled,
  getServiceDir,
  getSnapshotsDir,
  normalizePageName,
  generateScreenshotFilename,
  getScreenshotPath,
  ensureSnapshotsDir,
} from "../src/lib/installer";

const TEST_PROJECT_ROOT = "./test-project-root";

describe("Installer", () => {
  beforeAll(() => {
    // Create test project directory
    if (!existsSync(TEST_PROJECT_ROOT)) {
      mkdirSync(TEST_PROJECT_ROOT, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup test project directory
    if (existsSync(TEST_PROJECT_ROOT)) {
      rmSync(TEST_PROJECT_ROOT, { recursive: true });
    }
  });

  describe("Path utilities", () => {
    test("should get service directory path", () => {
      const dir = getServiceDir(TEST_PROJECT_ROOT);
      expect(dir).toBe(join(TEST_PROJECT_ROOT, ".service-consolelog"));
    });

    test("should get snapshots directory path", () => {
      const dir = getSnapshotsDir(TEST_PROJECT_ROOT);
      expect(dir).toBe(join(TEST_PROJECT_ROOT, ".service-consolelog", "snapshots"));
    });
  });

  describe("Page name normalization", () => {
    test("should normalize root path", () => {
      expect(normalizePageName(null, "/")).toBe("home");
    });

    test("should normalize simple path", () => {
      expect(normalizePageName(null, "/about")).toBe("about");
    });

    test("should normalize nested path", () => {
      expect(normalizePageName(null, "/user/profile")).toBe("user_profile");
    });

    test("should use page name when provided", () => {
      expect(normalizePageName("Dashboard", "/admin")).toBe("dashboard");
    });

    test("should handle special characters", () => {
      expect(normalizePageName(null, "/user@profile!")).toBe("userprofile");
    });

    test("should handle empty path", () => {
      expect(normalizePageName(null, "")).toBe("home");
    });
  });

  describe("Screenshot filename generation", () => {
    test("should generate valid filename", () => {
      const filename = generateScreenshotFilename("Home", "/");
      expect(filename).toMatch(/^snapshot_home_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*_[a-f0-9]{8}\.png$/);
    });

    test("should generate unique filenames", () => {
      const filename1 = generateScreenshotFilename("Home", "/");
      const filename2 = generateScreenshotFilename("Home", "/");
      expect(filename1).not.toBe(filename2);
    });
  });

  describe("Installation", () => {
    test("should not be installed initially", () => {
      expect(isInstalled(TEST_PROJECT_ROOT)).toBe(false);
    });

    test("should install successfully", () => {
      const result = install({ projectRoot: TEST_PROJECT_ROOT });
      expect(result.success).toBe(true);
      expect(isInstalled(TEST_PROJECT_ROOT)).toBe(true);
    });

    test("should create service directory", () => {
      expect(existsSync(getServiceDir(TEST_PROJECT_ROOT))).toBe(true);
    });

    test("should create snapshots directory", () => {
      expect(existsSync(getSnapshotsDir(TEST_PROJECT_ROOT))).toBe(true);
    });

    test("should create README.md", () => {
      expect(existsSync(join(getServiceDir(TEST_PROJECT_ROOT), "README.md"))).toBe(true);
    });

    test("should not reinstall without force", () => {
      const result = install({ projectRoot: TEST_PROJECT_ROOT });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Already installed");
    });

    test("should reinstall with force", () => {
      const result = install({ projectRoot: TEST_PROJECT_ROOT, force: true });
      expect(result.success).toBe(true);
    });

    test("should uninstall successfully", () => {
      const result = uninstall(TEST_PROJECT_ROOT);
      expect(result.success).toBe(true);
      expect(isInstalled(TEST_PROJECT_ROOT)).toBe(false);
    });

    test("should handle uninstall when not installed", () => {
      const result = uninstall(TEST_PROJECT_ROOT);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Not installed");
    });
  });

  describe("Snapshots directory", () => {
    test("should ensure snapshots directory exists", () => {
      // Install first
      install({ projectRoot: TEST_PROJECT_ROOT });

      const dir = ensureSnapshotsDir(TEST_PROJECT_ROOT);
      expect(existsSync(dir)).toBe(true);

      // Cleanup
      uninstall(TEST_PROJECT_ROOT);
    });

    test("should get screenshot path", () => {
      install({ projectRoot: TEST_PROJECT_ROOT });

      const path = getScreenshotPath("test.png", TEST_PROJECT_ROOT);
      expect(path).toContain(".service-consolelog");
      expect(path).toContain("snapshots");
      expect(path).toContain("test.png");

      uninstall(TEST_PROJECT_ROOT);
    });
  });
});
