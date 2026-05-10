import type { Command } from "commander";
import { crawlAndSave } from "../lib/crawler.js";
import * as logger from "../utils/logger.js";

export function registerCrawlCommand(program: Command): void {
  program
    .command("crawl <url>")
    .description("Crawl an entire website")
    .option("-d, --depth <number>", "Maximum crawl depth", "2")
    .option("-l, --limit <number>", "Maximum pages to crawl", "10")
    .option("--exclude <paths>", "Exclude paths (comma-separated)")
    .option("--include <paths>", "Include only paths (comma-separated)")
    .action(async (url: string, options) => {
      try {
        const { sessionId, result } = await crawlAndSave(url, {
          maxDepth: parseInt(options.depth),
          limit: parseInt(options.limit),
          excludePaths: options.exclude?.split(","),
          includePaths: options.include?.split(","),
        });

        logger.heading("Crawl Complete");
        logger.table([
          ["Session ID", sessionId],
          ["URL", result.url],
          ["Pages", result.totalPages.toString()],
        ]);
      } catch (err) {
        logger.error(`Crawl failed: ${err}`);
        process.exit(1);
      }
    });
}
