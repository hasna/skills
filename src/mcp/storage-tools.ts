import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  SKILLS_NATIVE_STORAGE_ENV,
  exportSkillsLocalSnapshot,
  getStorageStatus,
  planSkillsS3SnapshotUpload,
  resolveStorageConfig,
  skillsPostgresSyncSchemaSql,
} from "../lib/native-storage.js";
import { mcpJson } from "./helpers.js";

export function registerStorageTools(server: McpServer): void {
  server.registerTool("storage_status", {
    title: "Storage Status",
    description: "Show on-box storage paths and optional repo-owned Postgres/S3 readiness.",
    inputSchema: {
      directory: z.string().optional(),
    },
  }, async ({ directory }) => {
    return mcpJson(getStorageStatus({ targetDir: directory || process.cwd() }), true);
  });

  server.registerTool("storage_sync_plan", {
    title: "Storage Sync Plan",
    description: "Plan .skills snapshot sync for optional Postgres/S3 storage without network access.",
    inputSchema: {
      directory: z.string().optional(),
      includeSchemaSql: z.boolean().optional(),
    },
  }, async ({ directory, includeSchemaSql }) => {
    const targetDir = directory || process.cwd();
    const config = resolveStorageConfig();
    const snapshot = exportSkillsLocalSnapshot(targetDir, { includeFileContents: false });
    const s3Plan = config.s3Bucket
      ? planSkillsS3SnapshotUpload(snapshot, { prefix: config.s3Prefix })
      : [];

    return mcpJson({
      package: "open-skills",
      noNetwork: true,
      databaseConfigured: Boolean(config.databaseUrl),
      s3Configured: Boolean(config.s3Bucket),
      snapshotFileCount: snapshot.files.length,
      s3ObjectCount: s3Plan.length,
      env: {
        databaseUrl: SKILLS_NATIVE_STORAGE_ENV.databaseUrl,
        s3Bucket: SKILLS_NATIVE_STORAGE_ENV.s3Bucket,
      },
      ...(includeSchemaSql ? { schemaSql: skillsPostgresSyncSchemaSql } : {}),
    }, true);
  });
}
