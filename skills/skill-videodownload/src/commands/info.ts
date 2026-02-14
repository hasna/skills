/**
 * Info command - get video information
 */

import type { Command } from "commander";
import { getVideoInfo, checkYtDlp, listFormats } from "../lib/downloader.js";
import * as logger from "../utils/logger.js";
import { formatDuration, formatSize } from "../utils/paths.js";

export function registerInfoCommand(program: Command): void {
  program
    .command("info <url>")
    .description("Get video information without downloading")
    .option("--json", "Output as JSON")
    .option("--formats", "Show available formats")
    .action(async (url: string, options) => {
      try {
        // Check yt-dlp
        const hasYtDlp = await checkYtDlp();
        if (!hasYtDlp) {
          logger.error("yt-dlp not found");
          logger.info("Install with: brew install yt-dlp (macOS) or pip install yt-dlp");
          process.exit(1);
        }

        logger.info(`Fetching video info from ${url}...`);

        const info = await getVideoInfo(url);

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
          return;
        }

        logger.heading("Video Information");
        logger.table([
          ["Title", info.title],
          ["Platform", info.platform],
          ["ID", info.id],
          ["Duration", info.duration ? formatDuration(info.duration) : "Unknown"],
          ["Uploader", info.uploader || "Unknown"],
          ["Upload Date", info.uploadDate || "Unknown"],
          ["Views", info.viewCount?.toLocaleString() || "Unknown"],
        ]);

        if (info.description) {
          console.log();
          console.log("Description:");
          console.log(info.description.substring(0, 500) + (info.description.length > 500 ? "..." : ""));
        }

        if (options.formats && info.formats.length > 0) {
          logger.heading("Available Formats");

          // Group formats
          const videoFormats = info.formats.filter((f) => f.vcodec && f.vcodec !== "none");
          const audioFormats = info.formats.filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"));

          if (videoFormats.length > 0) {
            console.log("Video:");
            for (const f of videoFormats.slice(0, 10)) {
              const size = f.filesize ? formatSize(f.filesize) : "";
              console.log(`  ${f.formatId.padEnd(10)} ${f.ext.padEnd(5)} ${(f.resolution || f.quality).padEnd(12)} ${size}`);
            }
            if (videoFormats.length > 10) {
              console.log(`  ... and ${videoFormats.length - 10} more`);
            }
          }

          if (audioFormats.length > 0) {
            console.log("\nAudio:");
            for (const f of audioFormats.slice(0, 5)) {
              const size = f.filesize ? formatSize(f.filesize) : "";
              console.log(`  ${f.formatId.padEnd(10)} ${f.ext.padEnd(5)} ${(f.quality || "").padEnd(12)} ${size}`);
            }
          }
        }
      } catch (err) {
        logger.error(`Failed to get video info: ${err}`);
        process.exit(1);
      }
    });
}
