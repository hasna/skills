import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// We need to test config in isolation, so we'll mock the config file path
const ORIGINAL_CONFIG_PATH = join(homedir(), ".consolelog.json");
const BACKUP_CONFIG_PATH = join(homedir(), ".consolelog.json.backup");

describe("Config", () => {
  let hadExistingConfig = false;

  beforeAll(() => {
    // Backup existing config if it exists
    if (existsSync(ORIGINAL_CONFIG_PATH)) {
      hadExistingConfig = true;
      const content = readFileSync(ORIGINAL_CONFIG_PATH, "utf-8");
      writeFileSync(BACKUP_CONFIG_PATH, content);
      unlinkSync(ORIGINAL_CONFIG_PATH);
    }
  });

  afterAll(() => {
    // Restore original config
    if (existsSync(ORIGINAL_CONFIG_PATH)) {
      unlinkSync(ORIGINAL_CONFIG_PATH);
    }
    if (hadExistingConfig && existsSync(BACKUP_CONFIG_PATH)) {
      const content = readFileSync(BACKUP_CONFIG_PATH, "utf-8");
      writeFileSync(ORIGINAL_CONFIG_PATH, content);
      unlinkSync(BACKUP_CONFIG_PATH);
    }
  });

  // Import after setting up test environment
  const {
    loadConfig,
    saveConfig,
    getConfigValue,
    setConfigValue,
    resetConfig,
    getConfigPath,
    configExists,
    getDatabasePath,
    isHeadless,
    getDefaultTimeout,
    getWatchInterval,
    getLogLevel,
    getServerPort,
  } = require("../src/lib/config");

  describe("Config file operations", () => {
    test("should return config path", () => {
      const path = getConfigPath();
      expect(path).toBe(ORIGINAL_CONFIG_PATH);
    });

    test("should return false when config does not exist", () => {
      expect(configExists()).toBe(false);
    });

    test("should load default config when no file exists", () => {
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(config.databasePath).toBe("./data/service_consolelog.db");
      expect(config.headless).toBe(true);
      expect(config.defaultTimeout).toBe(30000);
      expect(config.watchInterval).toBe(300000);
      expect(config.logLevel).toBe("info");
    });

    test("should save config", () => {
      const saved = saveConfig({ headless: false });
      expect(saved.headless).toBe(false);
      expect(configExists()).toBe(true);
    });

    test("should load saved config", () => {
      const config = loadConfig();
      expect(config.headless).toBe(false);
    });

    test("should get specific config value", () => {
      expect(getConfigValue("headless")).toBe(false);
    });

    test("should set specific config value", () => {
      setConfigValue("defaultTimeout", 60000);
      expect(getConfigValue("defaultTimeout")).toBe(60000);
    });

    test("should reset config to defaults", () => {
      const reset = resetConfig();
      expect(reset.headless).toBe(true);
      expect(reset.defaultTimeout).toBe(30000);
    });
  });

  describe("Environment-aware getters", () => {
    test("should get database path from env", () => {
      const originalEnv = process.env.DATABASE_PATH;
      process.env.DATABASE_PATH = "/custom/path/db.sqlite";

      expect(getDatabasePath()).toBe("/custom/path/db.sqlite");

      if (originalEnv) {
        process.env.DATABASE_PATH = originalEnv;
      } else {
        delete process.env.DATABASE_PATH;
      }
    });

    test("should get headless from env", () => {
      const originalEnv = process.env.HEADLESS;
      process.env.HEADLESS = "false";

      expect(isHeadless()).toBe(false);

      process.env.HEADLESS = "true";
      expect(isHeadless()).toBe(true);

      if (originalEnv) {
        process.env.HEADLESS = originalEnv;
      } else {
        delete process.env.HEADLESS;
      }
    });

    test("should get timeout from env", () => {
      const originalEnv = process.env.DEFAULT_TIMEOUT;
      process.env.DEFAULT_TIMEOUT = "45000";

      expect(getDefaultTimeout()).toBe(45000);

      if (originalEnv) {
        process.env.DEFAULT_TIMEOUT = originalEnv;
      } else {
        delete process.env.DEFAULT_TIMEOUT;
      }
    });

    test("should get watch interval from env", () => {
      const originalEnv = process.env.WATCH_INTERVAL;
      process.env.WATCH_INTERVAL = "600000";

      expect(getWatchInterval()).toBe(600000);

      if (originalEnv) {
        process.env.WATCH_INTERVAL = originalEnv;
      } else {
        delete process.env.WATCH_INTERVAL;
      }
    });

    test("should get log level from env", () => {
      const originalEnv = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = "debug";

      expect(getLogLevel()).toBe("debug");

      if (originalEnv) {
        process.env.LOG_LEVEL = originalEnv;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });

    test("should get server port from env", () => {
      const originalEnv = process.env.PORT;
      process.env.PORT = "4000";

      expect(getServerPort()).toBe(4000);

      if (originalEnv) {
        process.env.PORT = originalEnv;
      } else {
        delete process.env.PORT;
      }
    });

    test("should return default server port", () => {
      const originalEnv = process.env.PORT;
      delete process.env.PORT;

      expect(getServerPort()).toBe(3100);

      if (originalEnv) {
        process.env.PORT = originalEnv;
      }
    });
  });
});
