#!/usr/bin/env bun
/**
 * Extract Audio Skill
 * Extracts audio from video files using FFmpeg
 */

import { parseArgs } from "util";
import { mkdirSync, appendFileSync, existsSync, statSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

// Types
interface ExtractOptions {
  inputFiles: string[];
  format: "mp3" | "wav" | "aac" | "flac" | "ogg";
  quality: "low" | "medium" | "high" | "ultra";
  output?: string;
}

interface BitrateConfig {
  mp3: string;
  aac: string;
  wav: string;
  flac: string;
  ogg: string;
}

// Constants
const SKILL_NAME = "extract-audio";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Supported video formats
const SUPPORTED_VIDEO_FORMATS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".3gp"];

// Bitrate configurations for different quality levels
const BITRATES: Record<ExtractOptions["quality"], BitrateConfig> = {
  low: { mp3: "128k", aac: "96k", wav: "", flac: "", ogg: "64k" },
  medium: { mp3: "192k", aac: "128k", wav: "", flac: "", ogg: "128k" },
  high: { mp3: "256k", aac: "192k", wav: "", flac: "", ogg: "192k" },
  ultra: { mp3: "320k", aac: "256k", wav: "", flac: "", ogg: "256k" },
};

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Check if FFmpeg is installed
async function checkFFmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn("ffmpeg", ["-version"]);

    process.on("error", () => {
      resolve(false);
    });

    process.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

// Validate input file
function validateInputFile(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_VIDEO_FORMATS.includes(ext)) {
    throw new Error(`Unsupported video format: ${ext}. Supported formats: ${SUPPORTED_VIDEO_FORMATS.join(", ")}`);
  }
}

// Extract audio from video file
async function extractAudio(
  inputFile: string,
  outputFile: string,
  options: ExtractOptions
): Promise<void> {
  log(`Extracting audio from: ${inputFile}`);
  log(`Output format: ${options.format}, Quality: ${options.quality}`);

  const args: string[] = [
    "-i", inputFile,
    "-vn", // No video
  ];

  // Add codec and bitrate based on format
  const bitrate = BITRATES[options.quality][options.format];

  switch (options.format) {
    case "mp3":
      args.push("-acodec", "libmp3lame");
      if (bitrate) args.push("-b:a", bitrate);
      break;
    case "wav":
      args.push("-acodec", "pcm_s16le");
      break;
    case "aac":
      args.push("-acodec", "aac");
      if (bitrate) args.push("-b:a", bitrate);
      break;
    case "flac":
      args.push("-acodec", "flac");
      break;
    case "ogg":
      args.push("-acodec", "libvorbis");
      if (bitrate) args.push("-b:a", bitrate);
      break;
  }

  args.push("-y"); // Overwrite output file
  args.push(outputFile);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        log(`Successfully extracted audio to: ${outputFile}`, "success");
        resolve();
      } else {
        log(`FFmpeg error: ${stderr}`, "error");
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
    });
  });
}

// Generate output filename
function generateOutputFilename(inputFile: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
  const inputBasename = basename(inputFile, extname(inputFile));
  return join(EXPORTS_DIR, `export_${timestamp}_${inputBasename}.${format}`);
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      format: { type: "string", default: "mp3" },
      quality: { type: "string", default: "medium" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Extract Audio - Extract audio from video files using FFmpeg

Usage:
  bun run src/index.ts <video-file> [more-files...] [options]

Options:
  --format <format>   Output format (mp3, wav, aac, flac, ogg) [default: mp3]
  --quality <quality> Quality level (low, medium, high, ultra) [default: medium]
  --output, -o <path> Custom output path (single file only)
  --help, -h          Show this help

Quality Levels:
  low    - MP3: 128k, AAC: 96k  (suitable for voice, podcasts)
  medium - MP3: 192k, AAC: 128k (good balance)
  high   - MP3: 256k, AAC: 192k (high quality music)
  ultra  - MP3: 320k, AAC: 256k (maximum quality)

Supported Input Formats:
  ${SUPPORTED_VIDEO_FORMATS.join(", ")}

Examples:
  bun run src/index.ts video.mp4
  bun run src/index.ts video.mov --format wav --quality high
  bun run src/index.ts video1.mp4 video2.mp4 video3.mp4
  bun run src/index.ts interview.mp4 --output ./podcast.mp3
`);
    process.exit(0);
  }

  // Validate format
  const format = values.format?.toLowerCase() as ExtractOptions["format"];
  const validFormats = ["mp3", "wav", "aac", "flac", "ogg"];
  if (!validFormats.includes(format)) {
    log(`Invalid format: ${format}. Valid formats: ${validFormats.join(", ")}`, "error");
    process.exit(1);
  }

  // Validate quality
  const quality = values.quality?.toLowerCase() as ExtractOptions["quality"];
  const validQualities = ["low", "medium", "high", "ultra"];
  if (!validQualities.includes(quality)) {
    log(`Invalid quality: ${quality}. Valid qualities: ${validQualities.join(", ")}`, "error");
    process.exit(1);
  }

  // Get input files
  const inputFiles = positionals;

  if (inputFiles.length === 0) {
    log("Please provide at least one video file", "error");
    process.exit(1);
  }

  // Check for custom output with multiple files
  if (values.output && inputFiles.length > 1) {
    log("Custom output path can only be used with a single input file", "error");
    process.exit(1);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    // Check if FFmpeg is installed
    log("Checking for FFmpeg installation...");
    const ffmpegInstalled = await checkFFmpeg();

    if (!ffmpegInstalled) {
      log("FFmpeg is not installed or not found in PATH", "error");
      console.log(`
⚠️  FFmpeg is required but not found

Please install FFmpeg:

  macOS:
    brew install ffmpeg

  Ubuntu/Debian:
    sudo apt-get install ffmpeg

  Windows:
    Download from https://ffmpeg.org/download.html
`);
      process.exit(1);
    }

    log("FFmpeg is installed", "success");

    // Ensure export directory exists
    ensureDir(EXPORTS_DIR);

    // Validate all input files
    for (const inputFile of inputFiles) {
      validateInputFile(inputFile);
    }

    log(`Processing ${inputFiles.length} file(s)...`);

    // Process each file
    for (const inputFile of inputFiles) {
      const outputFile = values.output || generateOutputFilename(inputFile, format);

      // Ensure output directory exists
      const outputDir = dirname(outputFile);
      ensureDir(outputDir);

      await extractAudio(inputFile, outputFile, {
        inputFiles,
        format,
        quality,
        output: values.output as string,
      });

      console.log(`\n✨ Audio extracted successfully!`);
      console.log(`   📁 Input: ${inputFile}`);
      console.log(`   🎵 Output: ${outputFile}`);
    }

    console.log(`\n   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
