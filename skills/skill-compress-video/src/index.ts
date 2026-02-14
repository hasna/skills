#!/usr/bin/env bun

import { parseArgs } from "util";
import { existsSync, statSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

// Constants
const SKILL_NAME = "compress-video";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

interface CompressionPreset {
  crf: number;
  codec: string;
  resolution?: string;
  audioBitrate: number;
  description: string;
}

const PRESETS: Record<string, CompressionPreset> = {
  web: {
    crf: 23,
    codec: "h264",
    audioBitrate: 128,
    description: "Balanced for web streaming",
  },
  mobile: {
    crf: 28,
    codec: "h264",
    resolution: "720p",
    audioBitrate: 96,
    description: "Optimized for mobile devices",
  },
  archive: {
    crf: 30,
    codec: "hevc",
    audioBitrate: 96,
    description: "Maximum compression for archival",
  },
  "high-quality": {
    crf: 18,
    codec: "h264",
    audioBitrate: 192,
    description: "Minimal quality loss",
  },
};

const RESOLUTIONS: Record<string, string> = {
  "1080p": "1920:1080",
  "720p": "1280:720",
  "480p": "854:480",
  "360p": "640:360",
};

const CODECS: Record<string, { encoder: string; extension: string }> = {
  h264: { encoder: "libx264", extension: ".mp4" },
  hevc: { encoder: "libx265", extension: ".mp4" },
  vp9: { encoder: "libvpx-vp9", extension: ".webm" },
};

interface CompressOptions {
  preset: string;
  crf?: number;
  targetSize?: number;
  resolution: string;
  codec: string;
  audioBitrate: number;
  noAudio: boolean;
  output: string;
  suffix: string;
  overwrite: boolean;
  stats: boolean;
  verbose: boolean;
}

interface CompressionResult {
  inputFile: string;
  outputFile: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  success: boolean;
  error?: string;
}

async function checkFFmpeg(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

async function getVideoInfo(
  file: string
): Promise<{ duration: number; bitrate: number; width: number; height: number }> {
  const cmd = `ffprobe -v error -show_entries format=duration,bit_rate -show_entries stream=width,height -of json "${file}"`;
  const { stdout } = await execAsync(cmd);
  const info = JSON.parse(stdout);

  return {
    duration: parseFloat(info.format.duration || 0),
    bitrate: parseInt(info.format.bit_rate || 0),
    width: info.streams[0]?.width || 0,
    height: info.streams[0]?.height || 0,
  };
}

function calculateBitrateForTargetSize(
  targetSizeMB: number,
  durationSeconds: number,
  audioBitrate: number
): number {
  // Convert MB to bits
  const targetSizeBits = targetSizeMB * 8 * 1024 * 1024;
  // Calculate total bitrate needed
  const totalBitrate = targetSizeBits / durationSeconds;
  // Subtract audio bitrate to get video bitrate
  const videoBitrate = totalBitrate - audioBitrate * 1000;
  return Math.max(Math.floor(videoBitrate / 1000), 100); // Return kbps, min 100
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

async function compressVideo(
  inputFile: string,
  options: CompressOptions
): Promise<CompressionResult> {
  try {
    // Validate input file
    if (!existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }

    // Get preset settings
    const preset = PRESETS[options.preset];
    const crf = options.crf ?? preset.crf;
    const codec = CODECS[options.codec];
    const audioBitrate = options.audioBitrate ?? preset.audioBitrate;

    // Get video info
    const videoInfo = await getVideoInfo(inputFile);

    // Determine output path
    const inputDir = dirname(inputFile);
    const inputBase = basename(inputFile, extname(inputFile));
    const outputDir = options.output || inputDir;
    const outputExt = codec.extension;
    const outputFile = join(outputDir, `${inputBase}${options.suffix}${outputExt}`);

    // Create output directory if needed
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Check if output exists
    if (existsSync(outputFile) && !options.overwrite) {
      throw new Error(
        `Output file already exists: ${outputFile}. Use --overwrite to replace.`
      );
    }

    // Build FFmpeg command
    let cmd = `ffmpeg -i "${inputFile}" -c:v ${codec.encoder}`;

    // Video encoding settings
    if (options.targetSize) {
      // Calculate bitrate for target size
      const videoBitrate = calculateBitrateForTargetSize(
        options.targetSize,
        videoInfo.duration,
        audioBitrate
      );
      cmd += ` -b:v ${videoBitrate}k -maxrate ${videoBitrate * 1.5}k -bufsize ${videoBitrate * 2}k`;
      // Two-pass encoding for better quality at target size
      cmd += " -pass 1 -an -f null /dev/null && ";
      cmd += `ffmpeg -i "${inputFile}" -c:v ${codec.encoder}`;
      cmd += ` -b:v ${videoBitrate}k -maxrate ${videoBitrate * 1.5}k -bufsize ${videoBitrate * 2}k`;
      cmd += " -pass 2";
    } else {
      // CRF-based encoding
      cmd += ` -crf ${crf}`;
    }

    // Resolution scaling
    if (options.resolution !== "original") {
      const resolution = RESOLUTIONS[options.resolution] || options.resolution;
      cmd += ` -vf scale=${resolution}:force_original_aspect_ratio=decrease`;
    } else if (preset.resolution && options.resolution === "original") {
      // Use preset resolution if no custom resolution specified
      const resolution = RESOLUTIONS[preset.resolution];
      if (resolution) {
        cmd += ` -vf scale=${resolution}:force_original_aspect_ratio=decrease`;
      }
    }

    // Audio settings
    if (options.noAudio) {
      cmd += " -an";
    } else {
      const audioCodec = codec.extension === ".webm" ? "libopus" : "aac";
      cmd += ` -c:a ${audioCodec} -b:a ${audioBitrate}k`;
    }

    // Preset and optimization
    if (options.codec === "h264" || options.codec === "hevc") {
      cmd += " -preset medium";
    }

    // Overwrite flag
    if (options.overwrite) {
      cmd += " -y";
    }

    // Output file
    cmd += ` "${outputFile}"`;

    // Add error output suppression unless verbose
    if (!options.verbose) {
      cmd += " 2>&1 | grep -E 'time=|error|Error|failed|Failed' || true";
    }

    // Show compression details
    log(`Processing: ${basename(inputFile)}`);
    log(`  Preset: ${options.preset}`, "debug");
    log(`  Codec: ${options.codec.toUpperCase()}`, "debug");
    log(
      `  Resolution: ${videoInfo.width}x${videoInfo.height}${options.resolution !== "original" ? ` → ${options.resolution}` : ""}`, "debug"
    );
    if (options.targetSize) {
      log(`  Target Size: ${options.targetSize} MB`, "debug");
    } else {
      log(`  CRF: ${crf}`, "debug");
    }

    // Execute compression
    const startTime = Date.now();
    await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
    const endTime = Date.now();

    // Get file sizes
    const originalSize = statSync(inputFile).size;
    const compressedSize = statSync(outputFile).size;
    const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;

    log(`✓ ${basename(outputFile)}`, "success");
    log(`  Time: ${((endTime - startTime) / 1000).toFixed(1)}s`, "debug");

    return {
      inputFile,
      outputFile,
      originalSize,
      compressedSize,
      compressionRatio,
      success: true,
    };
  } catch (error) {
    return {
      inputFile,
      outputFile: "",
      originalSize: 0,
      compressedSize: 0,
      compressionRatio: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      preset: { type: "string", default: "web" },
      crf: { type: "string" },
      "target-size": { type: "string" },
      resolution: { type: "string", default: "original" },
      codec: { type: "string", default: "h264" },
      "audio-bitrate": { type: "string" },
      "no-audio": { type: "boolean", default: false },
      output: { type: "string" },
      suffix: { type: "string", default: "_compressed" },
      overwrite: { type: "boolean", default: false },
      stats: { type: "boolean", default: true },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Compress Video - FFmpeg video compression tool

Usage:
  compress-video <files...> [options]

Options:
  --preset <name>          Compression preset (web, mobile, archive, high-quality)
  --crf <value>           Constant Rate Factor (0-51, lower = better)
  --target-size <MB>      Target file size in megabytes
  --resolution <size>     Output resolution (1080p, 720p, 480p, 360p, original)
  --codec <name>          Video codec (h264, hevc, vp9)
  --audio-bitrate <kbps>  Audio bitrate in kbps
  --no-audio              Remove audio track
  --output <dir>          Output directory
  --suffix <text>         Filename suffix (default: _compressed)
  --overwrite             Overwrite existing files
  --stats                 Show compression statistics
  --verbose               Show FFmpeg output
  --help                  Show this help message

Examples:
  compress-video video.mp4
  compress-video video.mp4 --preset mobile
  compress-video video.mp4 --target-size 50
  compress-video *.mp4 --preset web --output ./compressed/
`);
    process.exit(0);
  }

  // Check for input files
  if (positionals.length === 0) {
    log("Error: No input files specified", "error");
    console.error("Usage: compress-video <files...> [options]");
    console.error('Run "compress-video --help" for more information');
    process.exit(1);
  }

  // Validate preset
  if (values.preset && !PRESETS[values.preset as string]) {
    log(`Error: Invalid preset "${values.preset}"`, "error");
    console.error(`Available presets: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  // Validate codec
  const codec = (values.codec as string) || "h264";
  if (!CODECS[codec]) {
    log(`Error: Invalid codec "${codec}"`, "error");
    console.error(`Available codecs: ${Object.keys(CODECS).join(", ")}`);
    process.exit(1);
  }

  // Check FFmpeg
  const hasFFmpeg = await checkFFmpeg();
  if (!hasFFmpeg) {
    log("Error: FFmpeg is not installed or not in PATH", "error");
    console.error("\nInstall FFmpeg:");
    console.error("  macOS:   brew install ffmpeg");
    console.error("  Ubuntu:  sudo apt-get install ffmpeg");
    console.error("  Windows: choco install ffmpeg");
    process.exit(1);
  }

  // Build options
  const options: CompressOptions = {
    preset: (values.preset as string) || "web",
    crf: values.crf ? parseInt(values.crf as string) : undefined,
    targetSize: values["target-size"] ? parseFloat(values["target-size"] as string) : undefined,
    resolution: (values.resolution as string) || "original",
    codec: codec,
    audioBitrate: values["audio-bitrate"] ? parseInt(values["audio-bitrate"] as string) : PRESETS[(values.preset as string) || "web"].audioBitrate,
    noAudio: values["no-audio"] as boolean,
    output: values.output as string,
    suffix: (values.suffix as string) || "_compressed",
    overwrite: values.overwrite as boolean,
    stats: values.stats !== false,
    verbose: values.verbose as boolean,
  };

  log("Compressing Videos", "info");

  // Process all files
  const results: CompressionResult[] = [];
  for (const file of positionals) {
    const result = await compressVideo(file, options);
    results.push(result);

    if (!result.success) {
      log(`Failed: ${basename(file)}`, "error");
      log(`Error: ${result.error}`, "error");
    }
  }

  // Show statistics
  if (options.stats) {
    console.log("\nCompression Statistics");
    console.log("======================\n");

    let totalOriginal = 0;
    let totalCompressed = 0;
    let successCount = 0;

    for (const result of results) {
      if (result.success) {
        console.log(`File: ${basename(result.inputFile)}`);
        console.log(`  Original Size:  ${formatBytes(result.originalSize)}`);
        console.log(`  Compressed Size: ${formatBytes(result.compressedSize)}`);
        console.log(`  Compression Ratio: ${result.compressionRatio.toFixed(1)}%`);
        console.log(
          `  Space Saved: ${formatBytes(result.originalSize - result.compressedSize)}\n`
        );

        totalOriginal += result.originalSize;
        totalCompressed += result.compressedSize;
        successCount++;
      }
    }

    if (successCount > 0) {
      const avgCompression = ((totalOriginal - totalCompressed) / totalOriginal) * 100;
      console.log("Total Results");
      console.log("=============");
      console.log(`Files Processed: ${successCount}/${results.length}`);
      console.log(`Total Original Size: ${formatBytes(totalOriginal)}`);
      console.log(`Total Compressed Size: ${formatBytes(totalCompressed)}`);
      console.log(`Average Compression: ${avgCompression.toFixed(1)}%`);
      console.log(`Total Space Saved: ${formatBytes(totalOriginal - totalCompressed)}`);
    }
  }

  // Exit with error if any failed
  const failedCount = results.filter((r) => !r.success).length;
  if (failedCount > 0) {
    log(`${failedCount} file(s) failed to compress`, "error");
    process.exit(1);
  }
}

main().catch((error) => {
  log(`Error: ${error.message}`, "error");
  process.exit(1);
});
