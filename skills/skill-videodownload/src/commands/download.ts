/**
 * Download command - download a video
 */

import type { Command } from "commander";
import { downloadVideo, getVideoInfo, checkYtDlp } from "../lib/downloader.js";
import * as logger from "../utils/logger.js";
import { formatDuration, formatSize } from "../utils/paths.js";

export function registerDownloadCommand(program: Command): void {
  program
    .command("download <url>")
    .alias("dl")
    .description("Download a video from URL")
    .option("-o, --output <path>", "Output file path")
    .option("-f, --format <format>", "Video format (e.g., mp4, webm, best)", "best")
    .option("-q, --quality <quality>", "Video quality (best, 720p, 480p)", "best")
    .option("-a, --audio-only", "Download audio only")
    .option("-s, --subtitles", "Download subtitles")
    .option("-t, --thumbnail", "Download thumbnail")
    .option("--no-metadata", "Don't embed metadata")
    .action(async (url: string, options) => {
      try {
        // Check yt-dlp
        const hasYtDlp = await checkYtDlp();
        if (!hasYtDlp) {
          logger.error("yt-dlp not found");
          logger.info("Install it with:");
          logger.info("  macOS: brew install yt-dlp");
          logger.info("  Linux: pip install yt-dlp");
          logger.info("  Windows: winget install yt-dlp");
          process.exit(1);
        }

        const result = await downloadVideo(url, {
          output: options.output,
          format: options.format,
          quality: options.quality,
          audioOnly: options.audioOnly,
          subtitles: options.subtitles,
          thumbnail: options.thumbnail,
          metadata: options.metadata !== false,
        });

        if (!result.success) {
          logger.error(result.error || "Download failed");
          process.exit(1);
        }

        logger.heading("Download Complete");
        logger.table([
          ["Title", result.title],
          ["File", result.filepath || "Unknown"],
          ["Duration", result.duration ? formatDuration(result.duration) : "Unknown"],
        ]);
      } catch (err) {
        logger.error(`Download failed: ${err}`);
        process.exit(1);
      }
    });
}
