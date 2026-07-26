import chalk from "chalk";
import type { Command } from "commander";
import {
  SKILLS_NATIVE_STORAGE_ENV,
  exportSkillsLocalSnapshot,
  getStorageStatus,
  planSkillsS3SnapshotUpload,
  resolveStorageConfig,
  skillsPostgresSyncSchemaSql,
} from "../../lib/native-storage.js";

export function registerStorage(parent: Command) {
  const storage = parent
    .command("storage")
    .description("Inspect on-box storage paths and optional Postgres/S3 configuration");

  storage
    .command("status")
    .option("--json", "Output as JSON", false)
    .description("Show local paths and optional remote storage readiness")
    .action((options: { json: boolean }) => {
      const status = getStorageStatus();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      console.log(chalk.bold("Hasna Skills storage"));
      console.log(`${chalk.dim("Project state:")} ${status.local.projectStateDir}`);
      console.log(`${chalk.dim("Feedback DB:")} ${status.local.feedbackDbPath}`);
      console.log(`${chalk.dim("Remote DB:")} ${status.remote.databaseConfigured ? "configured" : `not configured (${status.remote.databaseEnv})`}`);
      console.log(`${chalk.dim("S3 artifacts:")} ${status.remote.s3Configured ? "configured" : `not configured (${status.remote.s3BucketEnv})`}`);
      console.log(`${chalk.dim("Dry run:")} ${status.remote.dryRun ? "yes" : "no"}`);
    });

  storage
    .command("sync-plan")
    .option("--json", "Output as JSON", false)
    .option("--schema-sql", "Include PostgreSQL schema SQL", false)
    .description("Plan snapshot and artifact sync without network access")
    .action((options: { json: boolean; schemaSql: boolean }) => {
      const config = resolveStorageConfig();
      const snapshot = exportSkillsLocalSnapshot(process.cwd(), { includeFileContents: false });
      const s3Plan = config.s3Bucket
        ? planSkillsS3SnapshotUpload(snapshot, { prefix: config.s3Prefix })
        : [];
      const plan = {
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
        ...(options.schemaSql ? { schemaSql: skillsPostgresSyncSchemaSql } : {}),
      };
      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      console.log(chalk.bold("Hasna Skills sync plan"));
      console.log(`${chalk.dim("Postgres:")} ${plan.databaseConfigured ? "configured" : "not configured"}`);
      console.log(`${chalk.dim("S3:")} ${plan.s3Configured ? "configured" : "not configured"}`);
      console.log(`${chalk.dim("Snapshot files:")} ${plan.snapshotFileCount}`);
      console.log(`${chalk.dim("S3 objects:")} ${plan.s3ObjectCount}`);
      if (options.schemaSql) {
        console.log("");
        console.log(skillsPostgresSyncSchemaSql);
      }
    });
}
