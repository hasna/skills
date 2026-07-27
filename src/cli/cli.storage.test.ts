import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliInCwd } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const CLEAN_STORAGE_ENV = {
  HASNA_SKILLS_DATABASE_URL: "",
  HASNA_SKILLS_DATABASE_SSL: "",
  HASNA_SKILLS_DATABASE_SCHEMA: "",
  HASNA_SKILLS_S3_BUCKET: "",
  HASNA_SKILLS_S3_PREFIX: "",
  HASNA_SKILLS_AWS_REGION: "",
  HASNA_SKILLS_SYNC_DRY_RUN: "",
  SKILLS_DATABASE_URL: "",
  SKILLS_DATABASE_SSL: "",
  SKILLS_DATABASE_SCHEMA: "",
  SKILLS_S3_BUCKET: "",
  SKILLS_S3_PREFIX: "",
  SKILLS_AWS_REGION: "",
  SKILLS_S3_ENDPOINT: "",
  SKILLS_S3_FORCE_PATH_STYLE: "",
  SKILLS_S3_ACCESS_KEY_ID: "",
  SKILLS_S3_SECRET_ACCESS_KEY: "",
  SKILLS_S3_SESSION_TOKEN: "",
  SKILLS_SYNC_BATCH_SIZE: "",
  SKILLS_SYNC_DRY_RUN: "",
};

describe("CLI storage", () => {
  test("reports on-box storage status by default", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "skills-cli-storage-"));
    try {
      const result = await runCliInCwd(["storage", "status", "--json"], tmpDir, { ...CLEAN_STORAGE_ENV, HOME: tmpDir });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        package: "open-skills",
        tables: ["skills_sync_records", "skills_sync_cursors"],
        remote: {
          databaseConfigured: false,
          s3Configured: false,
          databaseEnv: "HASNA_SKILLS_DATABASE_URL",
          activeDatabaseEnv: "HASNA_SKILLS_DATABASE_URL",
          s3BucketEnv: "HASNA_SKILLS_S3_BUCKET",
          dryRun: true,
        },
      });
      expect(data.local.projectStateDir).toContain(".skills");
      // Storage topology is read from what is configured, never from a label.
      expect(data).not.toHaveProperty("mode");
      expect(data.env).not.toHaveProperty("mode");
      expect(data.remote).not.toHaveProperty("activeModeEnv");
      // Pin the surviving shape so those negatives cannot pass by the object
      // they inspect disappearing.
      expect(Object.keys(data.env).sort()).toEqual(["databaseUrl", "s3Bucket"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("plans Postgres and S3 sync without network access", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "skills-cli-storage-plan-"));
    try {
      const result = await runCliInCwd([
        "storage",
        "sync-plan",
        "--schema-sql",
        "--json",
      ], tmpDir, {
        ...CLEAN_STORAGE_ENV,
        HOME: tmpDir,
        HASNA_SKILLS_DATABASE_URL: "postgres://example/skills",
        HASNA_SKILLS_S3_BUCKET: "skills-artifacts",
        HASNA_SKILLS_S3_PREFIX: "opensource/prod/skills",
      });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        package: "open-skills",
        noNetwork: true,
        databaseConfigured: true,
        s3Configured: true,
      });
      expect(data).not.toHaveProperty("mode");
      expect(data.env.databaseUrl).toBe("HASNA_SKILLS_DATABASE_URL");
      expect(data.schemaSql).toContain("CREATE TABLE IF NOT EXISTS skills_sync_records");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("reports fallback storage envs while preserving canonical public names", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "skills-cli-storage-fallback-"));
    try {
      const result = await runCliInCwd(["storage", "status", "--json"], tmpDir, {
        ...CLEAN_STORAGE_ENV,
        HOME: tmpDir,
        SKILLS_DATABASE_URL: "postgres://example/fallback-skills",
        SKILLS_S3_BUCKET: "skills-artifacts",
      });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        package: "open-skills",
        env: {
          databaseUrl: "HASNA_SKILLS_DATABASE_URL",
        },
        remote: {
          databaseConfigured: true,
          s3Configured: true,
          databaseEnv: "HASNA_SKILLS_DATABASE_URL",
          activeDatabaseEnv: "SKILLS_DATABASE_URL",
          activeS3BucketEnv: "SKILLS_S3_BUCKET",
        },
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
