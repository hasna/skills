import type { Command } from "commander";
import chalk from "chalk";
import { listSessions } from "../lib/storage.js";
import * as logger from "../utils/logger.js";

export function registerSessionsCommand(program: Command): void {
  program
    .command("sessions")
    .alias("ls")
    .description("List crawl sessions")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const sessions = listSessions();

        if (sessions.length === 0) {
          logger.info("No crawl sessions yet");
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
          return;
        }

        logger.heading("Crawl Sessions");

        for (const session of sessions) {
          console.log(chalk.cyan(session.id));
          console.log(`  ${chalk.dim("URL:")} ${session.url}`);
          console.log(`  ${chalk.dim("Pages:")} ${session.pages}`);
          console.log(`  ${chalk.dim("Date:")} ${new Date(session.createdAt).toLocaleDateString()}`);
          console.log();
        }

        logger.info(`${sessions.length} session(s)`);
      } catch (err) {
        logger.error(`Failed to list sessions: ${err}`);
        process.exit(1);
      }
    });
}
