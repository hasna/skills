import type { Command } from "commander";
import { scrapeUrl } from "../lib/crawler.js";
import * as logger from "../utils/logger.js";

export function registerScrapeCommand(program: Command): void {
  program
    .command("scrape <url>")
    .description("Scrape a single URL")
    .option("-f, --format <format>", "Output format: markdown, html, json", "markdown")
    .option("--full-page", "Include full page content (not just main)")
    .action(async (url: string, options) => {
      try {
        const result = await scrapeUrl(url, {
          formats: options.format === "html" ? ["html"] : ["markdown"],
          onlyMainContent: !options.fullPage,
        });

        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.format === "html") {
          console.log(result.html || "No HTML content");
        } else {
          console.log(result.markdown || "No content");
        }

        logger.success("Scrape complete");
      } catch (err) {
        logger.error(`Scrape failed: ${err}`);
        process.exit(1);
      }
    });
}
