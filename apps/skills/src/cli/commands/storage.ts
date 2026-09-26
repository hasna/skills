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
import { migrateOwnerLayout, SKILLS_CACHE_DIRNAME, LOGS_DIRNAME, OUTPUTS_DIRNAME } from "../../lib/home-migration.js";

export function registerStorage(parent: Command) {
  const storage = parent
    .command("storage")
    .description("Inspect on-box storage paths and optional Postgres/S3 configuration");

  storage
    .command("status")
    .allowExcessArguments(false)
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
    .allowExcessArguments(false)
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
        package: "skills",
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

  storage
    .command("migrate")
    .allowExcessArguments(false)
    .option("--dry-run", "Show what would move without touching the layout", false)
    .option("--json", "Output as JSON", false)
    .description(
      `Migrate the owner layout: installed/ and legacy flat skill dirs move into ${SKILLS_CACHE_DIRNAME}/; ${LOGS_DIRNAME}/ and ${OUTPUTS_DIRNAME}/ are created lazily. Idempotent; refuses a non-empty conflicting destination.`,
    )
    .action((options: { dryRun: boolean; json: boolean }) => {
      const result = migrateOwnerLayout({ dryRun: options.dryRun });
      if (options.json) {
        if (result.status === "refused") process.exitCode = 1;
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      switch (result.status) {
        case "already-migrated":
          console.log(chalk.dim("Layout already migrated; nothing to do."));
          break;
        case "refused":
          console.error(chalk.red(`Refusing to migrate: ${result.reason ?? "unknown conflict"}`));
          process.exitCode = 1;
          break;
        case "nothing-to-do":
          console.log(chalk.dim("Nothing to migrate; no installed/ corpus and no legacy flat skill dirs."));
          if (!options.dryRun) console.log(chalk.dim(`Created ${LOGS_DIRNAME}/ and ${OUTPUTS_DIRNAME}/ (lazy).`));
          break;
        case "migrated":
          if (options.dryRun) {
            console.log(chalk.dim("Dry-run; nothing was moved."));
            for (const entry of result.moved) console.log(`  ${chalk.dim("would move")} ${chalk.bold(entry)} → ${SKILLS_CACHE_DIRNAME}/`);
          } else {
            console.log(chalk.green(`Migrated ${result.moved.length} entr${result.moved.length === 1 ? "y" : "ies"} into ${SKILLS_CACHE_DIRNAME}/`));
            for (const entry of result.moved) console.log(`  ${chalk.green("✓")} ${entry} → ${SKILLS_CACHE_DIRNAME}/${entry === "installed" ? "" : entry}`);
            for (const dir of result.created) console.log(`  ${chalk.dim("created")} ${dir}`);
          }
          break;
      }
    });
}
