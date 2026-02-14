/**
 * List command - list downloaded videos
 */

import type { Command } from "commander";
import chalk from "chalk";
import { listDownloads, loadDownloadHistory, loadConfig } from "../lib/storage.js";
import * as logger from "../utils/logger.js";
import { formatSize } from "../utils/paths.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List downloaded videos")
    .option("--json", "Output as JSON")
    .option("--history", "Show download history")
    .option("-n, --limit <number>", "Limit number of results", "20")
    .action(async (options) => {
      try {
        const limit = parseInt(options.limit);

        if (options.history) {
          const history = loadDownloadHistory().slice(0, limit);

          if (history.length === 0) {
            logger.info("No download history");
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(history, null, 2));
            return;
          }

          logger.heading("Download History");

          for (const entry of history) {
            const status = entry.success ? chalk.green("✓") : chalk.red("✗");
            console.log(`${status} ${entry.title}`);
            if (entry.filepath) {
              console.log(`  ${chalk.dim(entry.filepath)}`);
            }
            if (entry.error) {
              console.log(`  ${chalk.red(entry.error)}`);
            }
          }

          return;
        }

        // List files
        const files = listDownloads().slice(0, limit);

        if (files.length === 0) {
          logger.info("No videos downloaded yet");
          const config = loadConfig();
          logger.info(`Download directory: ${config.outputDir}`);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(files, null, 2));
          return;
        }

        logger.heading("Downloaded Videos");

        for (const file of files) {
          console.log(chalk.cyan(file.filename));
          console.log(`  ${chalk.dim(`${formatSize(file.size)} • ${file.modified.toLocaleDateString()}`)}`);
        }

        console.log();
        logger.info(`${files.length} video(s)`);

        const config = loadConfig();
        console.log(chalk.dim(`Location: ${config.outputDir}`));
      } catch (err) {
        logger.error(`Failed to list videos: ${err}`);
        process.exit(1);
      }
    });
}
