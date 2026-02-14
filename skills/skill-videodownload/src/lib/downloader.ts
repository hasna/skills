/**
 * Video downloader using yt-dlp
 */

import { spawn } from "child_process";
import { join } from "path";
import * as logger from "../utils/logger.js";
import { loadConfig, ensureOutputDir, saveDownloadHistory } from "./storage.js";
import { sanitizeFilename, detectPlatform, formatDuration, formatSize } from "../utils/paths.js";
import type { VideoInfo, DownloadResult, DownloadOptions, VideoFormat } from "../types/index.js";

const DEFAULT_OPTIONS: DownloadOptions = {
  output: "",
  format: "best",
  quality: "best",
  audioOnly: false,
  subtitles: false,
  thumbnail: false,
  metadata: true,
};

/**
 * Check if yt-dlp is installed
 */
export async function checkYtDlp(): Promise<boolean> {
  const config = loadConfig();

  return new Promise((resolve) => {
    const proc = spawn(config.ytDlpPath, ["--version"]);

    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Get video information without downloading
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const config = loadConfig();

  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-download",
      "--no-warnings",
      url,
    ];

    const proc = spawn(config.ytDlpPath, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "Failed to get video info"));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolve(parseVideoInfo(data, url));
      } catch (err) {
        reject(new Error(`Failed to parse video info: ${err}`));
      }
    });
  });
}

/**
 * Parse yt-dlp JSON output to VideoInfo
 */
function parseVideoInfo(data: any, url: string): VideoInfo {
  const formats: VideoFormat[] = (data.formats || []).map((f: any) => ({
    formatId: f.format_id || "",
    ext: f.ext || "",
    quality: f.format_note || f.quality || "",
    filesize: f.filesize || f.filesize_approx,
    vcodec: f.vcodec,
    acodec: f.acodec,
    resolution: f.resolution,
    fps: f.fps,
  }));

  return {
    id: data.id || "",
    url,
    title: data.title || "Unknown",
    description: data.description,
    duration: data.duration,
    thumbnail: data.thumbnail,
    formats,
    platform: detectPlatform(url),
    uploader: data.uploader || data.channel,
    uploadDate: data.upload_date,
    viewCount: data.view_count,
  };
}

/**
 * Download a video
 */
export async function downloadVideo(
  url: string,
  options: Partial<DownloadOptions> = {}
): Promise<DownloadResult> {
  const config = loadConfig();
  const opts: DownloadOptions = { ...DEFAULT_OPTIONS, ...options };

  // Check yt-dlp
  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp) {
    return {
      success: false,
      videoId: "",
      title: "",
      error: "yt-dlp not found. Install it with: brew install yt-dlp (macOS) or pip install yt-dlp",
    };
  }

  logger.info(`Fetching video info from ${url}...`);

  let videoInfo: VideoInfo;
  try {
    videoInfo = await getVideoInfo(url);
    logger.success(`Found: ${videoInfo.title}`);
    if (videoInfo.duration) {
      logger.info(`Duration: ${formatDuration(videoInfo.duration)}`);
    }
  } catch (err) {
    return {
      success: false,
      videoId: "",
      title: "",
      error: `Failed to get video info: ${err}`,
    };
  }

  // Prepare output directory
  const platform = detectPlatform(url);
  const outputDir = ensureOutputDir(platform);

  // Build output template
  const filename = sanitizeFilename(videoInfo.title);
  const outputTemplate = opts.output || join(outputDir, `${filename}.%(ext)s`);

  // Build yt-dlp arguments
  const args = buildYtDlpArgs(url, outputTemplate, opts);

  logger.info("Downloading...");

  return new Promise((resolve) => {
    const proc = spawn(config.ytDlpPath, args);
    let stderr = "";
    let lastProgress = "";

    proc.stdout.on("data", (data) => {
      const line = data.toString().trim();

      // Parse progress
      const progressMatch = line.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        const percent = progressMatch[1];
        if (percent !== lastProgress) {
          lastProgress = percent;
          process.stdout.write(`\r${logger} Downloading: ${percent}%`);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      process.stdout.write("\n");

      if (code !== 0) {
        const result: DownloadResult = {
          success: false,
          videoId: videoInfo.id,
          title: videoInfo.title,
          error: stderr || "Download failed",
        };
        saveDownloadHistory(result);
        resolve(result);
        return;
      }

      // Find downloaded file
      const ext = opts.audioOnly ? "m4a" : "mp4";
      const expectedPath = outputTemplate.replace("%(ext)s", ext);

      const result: DownloadResult = {
        success: true,
        videoId: videoInfo.id,
        title: videoInfo.title,
        filepath: expectedPath,
        format: opts.format,
        duration: videoInfo.duration,
      };

      saveDownloadHistory(result);
      logger.success(`Downloaded: ${expectedPath}`);
      resolve(result);
    });
  });
}

/**
 * Build yt-dlp command arguments
 */
function buildYtDlpArgs(
  url: string,
  outputTemplate: string,
  opts: DownloadOptions
): string[] {
  const args = [
    url,
    "-o", outputTemplate,
    "--no-warnings",
    "--progress",
  ];

  // Format selection
  if (opts.audioOnly) {
    args.push("-x", "--audio-format", "m4a");
  } else if (opts.format !== "best") {
    args.push("-f", opts.format);
  } else if (opts.quality === "best") {
    args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
  } else if (opts.quality === "720p") {
    args.push("-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]");
  } else if (opts.quality === "480p") {
    args.push("-f", "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]");
  }

  // Subtitles
  if (opts.subtitles) {
    args.push("--write-subs", "--sub-langs", "en");
  }

  // Thumbnail
  if (opts.thumbnail) {
    args.push("--write-thumbnail");
  }

  // Metadata
  if (opts.metadata) {
    args.push("--embed-metadata");
  }

  return args;
}

/**
 * List available formats for a video
 */
export async function listFormats(url: string): Promise<VideoFormat[]> {
  const info = await getVideoInfo(url);
  return info.formats;
}
