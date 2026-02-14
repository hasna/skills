#!/usr/bin/env bun

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import { randomUUID } from "crypto";

// Path validation to prevent command injection
const DANGEROUS_PATH_CHARS = /[;&|`$(){}[\]<>\\!*?'"]/;

function validatePath(inputPath: string): void {
  if (DANGEROUS_PATH_CHARS.test(inputPath)) {
    throw new Error(`Invalid characters in path: ${inputPath}. Paths cannot contain shell metacharacters.`);
  }
  // Resolve to absolute path and check for path traversal
  const resolved = path.resolve(inputPath);
  if (resolved.includes("..")) {
    throw new Error(`Path traversal detected in: ${inputPath}`);
  }
}

// Constants
const SKILL_NAME = "extract-frames";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || path.join(process.cwd(), ".skills");
const LOGS_DIR = path.join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = path.join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// Types
interface ExtractOptions {
  output: string;
  interval: number | null;
  fps: number | null;
  timestamps: string | null;
  frames: string | null;
  start: number;
  end: number | null;
  duration: number | null;
  first: boolean;
  last: boolean;
  scene: boolean;
  sceneThreshold: number;
  format: "jpg" | "png" | "webp";
  quality: number;
  width: number | null;
  height: number | null;
  scale: number;
  naming: string;
  padDigits: number;
}

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string", short: "o", default: "./frames/" },
    interval: { type: "string" },
    fps: { type: "string" },
    timestamps: { type: "string" },
    frames: { type: "string" },
    start: { type: "string", default: "0" },
    end: { type: "string" },
    duration: { type: "string" },
    first: { type: "boolean", default: false },
    last: { type: "boolean", default: false },
    scene: { type: "boolean", default: false },
    "scene-threshold": { type: "string", default: "0.3" },
    format: { type: "string", default: "jpg" },
    quality: { type: "string", default: "90" },
    width: { type: "string" },
    height: { type: "string" },
    scale: { type: "string", default: "1.0" },
    naming: { type: "string", default: "frame-{n}" },
    "pad-digits": { type: "string", default: "5" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

// Show help
if (values.help || positionals.length === 0) {
  console.log(`
Extract Frames - Extract frames from videos

Usage:
  skills run extract-frames -- <video> [options]

Options:
  -o, --output <path>         Output directory or file (default: ./frames/)
  --interval <seconds>        Extract every N seconds
  --fps <number>              Frames per second to extract
  --timestamps <times>        Specific timestamps: "0:30,1:00,1:30"
  --frames <numbers>          Specific frame numbers: "1,100,200"
  --start <seconds>           Start time (default: 0)
  --end <seconds>             End time
  --duration <seconds>        Duration to process
  --first                     Extract only first frame
  --last                      Extract only last frame
  --scene                     Extract scene change frames
  --scene-threshold <0-1>     Scene detection sensitivity (default: 0.3)
  --format <type>             Output format: jpg, png, webp (default: jpg)
  --quality <1-100>           JPEG/WebP quality (default: 90)
  --width <pixels>            Output width
  --height <pixels>           Output height
  --scale <factor>            Scale factor (default: 1.0)
  --naming <template>         Naming: frame-{n}, {video}-{time}
  --pad-digits <n>            Zero-padding (default: 5)
  -h, --help                  Show this help message

Examples:
  skills run extract-frames -- video.mp4 --interval 10 -o ./frames/
  skills run extract-frames -- video.mp4 --first -o thumbnail.jpg
  skills run extract-frames -- video.mp4 --scene -o ./scenes/
  skills run extract-frames -- video.mp4 --timestamps "0:30,1:00" -o ./shots/
`);
  process.exit(0);
}

// Check for FFmpeg
function checkFFmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!checkFFmpeg()) {
  log("Error: FFmpeg is not installed or not in PATH", "error");
  console.error("Install FFmpeg:");
  console.error("  macOS: brew install ffmpeg");
  console.error("  Ubuntu: sudo apt install ffmpeg");
  process.exit(1);
}

// Get input video
const inputVideo = positionals[0];

if (!inputVideo) {
  log("Error: No input video specified", "error");
  process.exit(1);
}

// Validate input path to prevent command injection
try {
  validatePath(inputVideo);
} catch (error: any) {
  log(error.message, "error");
  process.exit(1);
}

if (!fs.existsSync(inputVideo)) {
  log(`Error: File not found: ${inputVideo}`, "error");
  process.exit(1);
}

// Parse options
const options: ExtractOptions = {
  output: values.output as string,
  interval: values.interval ? parseFloat(values.interval as string) : null,
  fps: values.fps ? parseFloat(values.fps as string) : null,
  timestamps: (values.timestamps as string) || null,
  frames: (values.frames as string) || null,
  start: parseFloat(values.start as string) || 0,
  end: values.end ? parseFloat(values.end as string) : null,
  duration: values.duration ? parseFloat(values.duration as string) : null,
  first: values.first as boolean,
  last: values.last as boolean,
  scene: values.scene as boolean,
  sceneThreshold: parseFloat(values["scene-threshold"] as string) || 0.3,
  format: values.format as ExtractOptions["format"],
  quality: parseInt(values.quality as string) || 90,
  width: values.width ? parseInt(values.width as string) : null,
  height: values.height ? parseInt(values.height as string) : null,
  scale: parseFloat(values.scale as string) || 1.0,
  naming: values.naming as string,
  padDigits: parseInt(values["pad-digits"] as string) || 5,
};

// Get video info using execFileSync with array args (safe from injection)
function getVideoInfo(file: string): { duration: number; fps: number; width: number; height: number; frames: number } {
  try {
    const durationResult = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file
    ], { encoding: "utf-8" });
    const duration = parseFloat(durationResult.trim());

    const streamResult = execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
      "-of", "csv=p=0",
      file
    ], { encoding: "utf-8" });
    const [width, height, fpsStr, framesStr] = streamResult.trim().split(",");

    // Parse frame rate (could be "30/1" format)
    let fps = 30;
    if (fpsStr.includes("/")) {
      const [num, den] = fpsStr.split("/").map(Number);
      fps = num / den;
    } else {
      fps = parseFloat(fpsStr);
    }

    const frames = parseInt(framesStr) || Math.round(duration * fps);

    return {
      duration,
      fps,
      width: parseInt(width),
      height: parseInt(height),
      frames,
    };
  } catch (error) {
    return { duration: 0, fps: 30, width: 1920, height: 1080, frames: 0 };
  }
}

// Parse timestamp string to seconds
function parseTimestamp(ts: string): number {
  const parts = ts.split(":").map((p) => parseFloat(p.trim()));
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else {
    // Seconds
    return parts[0];
  }
}

// Format timestamp for filename
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}-${m.toString().padStart(2, "0")}-${s.toString().padStart(2, "0")}`;
}

// Generate output filename
function generateFilename(
  template: string,
  index: number,
  frameNum: number,
  timestamp: number,
  videoName: string,
  padDigits: number,
  format: string
): string {
  const paddedIndex = String(index).padStart(padDigits, "0");
  const paddedFrame = String(frameNum).padStart(padDigits, "0");
  const timeStr = formatTimestamp(timestamp);

  return (
    template
      .replace("{n}", paddedIndex)
      .replace("{frame}", paddedFrame)
      .replace("{time}", timeStr)
      .replace("{video}", videoName) +
    "." +
    format
  );
}

// Build FFmpeg scale filter
function buildScaleFilter(options: ExtractOptions): string {
  if (options.width && options.height) {
    return `scale=${options.width}:${options.height}`;
  } else if (options.width) {
    return `scale=${options.width}:-1`;
  } else if (options.height) {
    return `scale=-1:${options.height}`;
  } else if (options.scale !== 1.0) {
    return `scale=iw*${options.scale}:ih*${options.scale}`;
  }
  return "";
}

// Extract frames at specific timestamps using spawnSync with array args (safe from injection)
async function extractAtTimestamps(timestamps: number[]): Promise<number> {
  const videoName = path.basename(inputVideo, path.extname(inputVideo));
  const outputDir = options.output.endsWith("/") || !options.output.includes(".")
    ? options.output
    : path.dirname(options.output);

  // Validate output directory
  validatePath(outputDir);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const scaleFilter = buildScaleFilter(options);
  let extracted = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const filename = generateFilename(
      options.naming,
      i + 1,
      Math.round(ts * 30), // Approximate frame
      ts,
      videoName,
      options.padDigits,
      options.format
    );

    const outputPath = path.join(outputDir, filename);

    // Build ffmpeg arguments as array (safe from injection)
    const ffmpegArgs: string[] = ["-y", "-ss", String(ts), "-i", inputVideo, "-vframes", "1"];

    if (scaleFilter) {
      ffmpegArgs.push("-vf", scaleFilter);
    }

    if (options.format !== "png") {
      ffmpegArgs.push("-q:v", String(Math.round((100 - options.quality) / 3.2 + 1)));
    }

    ffmpegArgs.push(outputPath);

    try {
      const result = spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
      if (result.error) throw result.error;
      log(`Extracted: ${filename} (${formatTimestamp(ts)})`, "success");
      extracted++;
    } catch (error) {
      log(`Failed: ${filename}`, "error");
    }
  }

  return extracted;
}

// Extract frames with interval/fps using spawnSync with array args (safe from injection)
async function extractWithInterval(): Promise<number> {
  const videoInfo = getVideoInfo(inputVideo);
  const videoName = path.basename(inputVideo, path.extname(inputVideo));
  const outputDir = options.output.endsWith("/") || !options.output.includes(".")
    ? options.output
    : path.dirname(options.output);

  // Validate output directory
  validatePath(outputDir);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Calculate effective FPS
  let extractFps: number;
  if (options.fps) {
    extractFps = options.fps;
  } else if (options.interval) {
    extractFps = 1 / options.interval;
  } else {
    extractFps = videoInfo.fps; // Extract all frames
  }

  // Build filter
  const filters: string[] = [];

  if (options.fps || options.interval) {
    filters.push(`fps=${extractFps}`);
  }

  const scaleFilter = buildScaleFilter(options);
  if (scaleFilter) {
    filters.push(scaleFilter);
  }

  // Output pattern
  const outputPattern = path.join(
    outputDir,
    options.naming.replace("{n}", `%0${options.padDigits}d`).replace("{frame}", `%0${options.padDigits}d`) + `.${options.format}`
  );

  // Build ffmpeg arguments as array (safe from injection)
  const ffmpegArgs: string[] = ["-y"];

  if (options.start > 0) {
    ffmpegArgs.push("-ss", String(options.start));
  }

  ffmpegArgs.push("-i", inputVideo);

  if (options.duration) {
    ffmpegArgs.push("-t", String(options.duration));
  } else if (options.end) {
    ffmpegArgs.push("-t", String(options.end - options.start));
  }

  if (filters.length > 0) {
    ffmpegArgs.push("-vf", filters.join(","));
  }

  if (options.format !== "png") {
    ffmpegArgs.push("-q:v", String(Math.round((100 - options.quality) / 3.2 + 1)));
  }

  ffmpegArgs.push(outputPattern);

  log("Extracting frames...", "info");

  try {
    spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
  } catch (error: any) {
    // FFmpeg might return non-zero even on success
  }

  // Count extracted files
  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(`.${options.format}`));
  return files.length;
}

// Extract scene changes using spawnSync with array args (safe from injection)
async function extractScenes(): Promise<number> {
  const videoName = path.basename(inputVideo, path.extname(inputVideo));
  const outputDir = options.output.endsWith("/") || !options.output.includes(".")
    ? options.output
    : path.dirname(options.output);

  // Validate output directory
  validatePath(outputDir);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build filter for scene detection
  const filters: string[] = [`select='gt(scene,${options.sceneThreshold})'`];

  const scaleFilter = buildScaleFilter(options);
  if (scaleFilter) {
    filters.push(scaleFilter);
  }

  // Output pattern
  const outputPattern = path.join(
    outputDir,
    options.naming.replace("{n}", `%0${options.padDigits}d`).replace("{frame}", `%0${options.padDigits}d`) + `.${options.format}`
  );

  // Build ffmpeg arguments as array (safe from injection)
  const ffmpegArgs: string[] = ["-y"];

  if (options.start > 0) {
    ffmpegArgs.push("-ss", String(options.start));
  }

  ffmpegArgs.push("-i", inputVideo);

  if (options.duration) {
    ffmpegArgs.push("-t", String(options.duration));
  } else if (options.end) {
    ffmpegArgs.push("-t", String(options.end - options.start));
  }

  ffmpegArgs.push("-vf", filters.join(","), "-vsync", "vfr");

  if (options.format !== "png") {
    ffmpegArgs.push("-q:v", String(Math.round((100 - options.quality) / 3.2 + 1)));
  }

  ffmpegArgs.push(outputPattern);

  log("Detecting scene changes...", "info");

  try {
    spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
  } catch (error: any) {
    // FFmpeg might return non-zero even on success
  }

  // Count extracted files
  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(`.${options.format}`));
  return files.length;
}

// Extract first/last frame using spawnSync with array args (safe from injection)
async function extractSingleFrame(first: boolean): Promise<number> {
  const videoInfo = getVideoInfo(inputVideo);
  const videoName = path.basename(inputVideo, path.extname(inputVideo));

  // Determine output path
  let outputPath: string;
  if (options.output.includes(".")) {
    outputPath = options.output;
  } else {
    const outputDir = options.output;
    // Validate output directory
    validatePath(outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    outputPath = path.join(outputDir, `${first ? "first" : "last"}-frame.${options.format}`);
  }

  // Validate output path
  validatePath(outputPath);

  const scaleFilter = buildScaleFilter(options);

  // Build ffmpeg arguments as array (safe from injection)
  const ffmpegArgs: string[] = ["-y"];

  if (!first) {
    // For last frame, seek from end of file
    ffmpegArgs.push("-sseof", "-1");
  }

  ffmpegArgs.push("-i", inputVideo, "-vframes", "1");

  if (scaleFilter) {
    ffmpegArgs.push("-vf", scaleFilter);
  }

  if (options.format !== "png") {
    ffmpegArgs.push("-q:v", String(Math.round((100 - options.quality) / 3.2 + 1)));
  }

  ffmpegArgs.push(outputPath);

  try {
    const result = spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
    if (result.error) throw result.error;
    log(`Extracted: ${path.basename(outputPath)}`, "success");
    return 1;
  } catch (error) {
    log("Failed to extract frame", "error");
    return 0;
  }
}

// Main execution
async function main(): Promise<void> {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");

  try {
    const videoInfo = getVideoInfo(inputVideo);

    console.log(`\nVideo: ${inputVideo}`);
    console.log(`  Duration: ${videoInfo.duration.toFixed(1)}s`);
    console.log(`  Resolution: ${videoInfo.width}x${videoInfo.height}`);
    console.log(`  FPS: ${videoInfo.fps.toFixed(2)}`);
    console.log("");

    let extracted = 0;

    if (options.first) {
      extracted = await extractSingleFrame(true);
    } else if (options.last) {
      extracted = await extractSingleFrame(false);
    } else if (options.timestamps) {
      const timestamps = options.timestamps.split(",").map((t) => parseTimestamp(t.trim()));
      log(`Extracting ${timestamps.length} frames at specific timestamps...`, "info");
      extracted = await extractAtTimestamps(timestamps);
    } else if (options.frames) {
      const frameNums = options.frames.split(",").map((f) => parseInt(f.trim()));
      const timestamps = frameNums.map((f) => f / videoInfo.fps);
      log(`Extracting ${frameNums.length} specific frames...`, "info");
      extracted = await extractAtTimestamps(timestamps);
    } else if (options.scene) {
      extracted = await extractScenes();
    } else {
      extracted = await extractWithInterval();
    }

    // Summary
    console.log(`\n${"=".repeat(50)}`);
    console.log("Extraction Complete");
    console.log("=".repeat(50));
    console.log(`  Extracted: ${extracted} frames`);
    console.log(`  Format: ${options.format.toUpperCase()}${options.format !== "png" ? ` (${options.quality}% quality)` : ""}`);
    console.log(`  Output: ${options.output}`);
    console.log("");

  } catch (error: any) {
    log(`Error: ${error.message}`, "error");
    process.exit(1);
  }
}

main();
