#!/usr/bin/env bun

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import { globSync } from "glob";

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

// Types
interface GifOptions {
  output: string;
  start: number;
  duration: number | null;
  end: number | null;
  fps: number;
  width: number | null;
  height: number | null;
  scale: number;
  quality: "low" | "medium" | "high";
  loop: number;
  speed: number;
  reverse: boolean;
  bounce: boolean;
  delay: number | null;
  optimize: "none" | "balanced" | "aggressive";
  dither: string;
  colors: number;
}

// Quality presets
const QUALITY_PRESETS = {
  low: { fps: 8, colors: 64, dither: "none" },
  medium: { fps: 12, colors: 128, dither: "sierra2_4a" },
  high: { fps: 20, colors: 256, dither: "floyd_steinberg" },
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["output", "quality", "optimize", "dither"],
  boolean: ["reverse", "bounce", "help"],
  default: {
    output: "output.gif",
    start: 0,
    fps: 10,
    scale: 1.0,
    quality: "medium",
    loop: 0,
    speed: 1.0,
    reverse: false,
    bounce: false,
    optimize: "balanced",
    dither: "sierra2_4a",
    colors: 256,
  },
  alias: {
    o: "output",
    q: "quality",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
GIF Maker - Create animated GIFs from videos or images

Usage:
  skills run gif-maker -- <input> [options]
  skills run gif-maker -- video.mp4 -o output.gif
  skills run gif-maker -- *.png -o animation.gif

Options:
  -o, --output <file>       Output file path (default: output.gif)
  --start <seconds>         Start time for video (default: 0)
  --duration <seconds>      Duration to capture
  --end <seconds>           End time for video
  --fps <number>            Frames per second (default: 10)
  --width <pixels>          Output width (auto-scales height)
  --height <pixels>         Output height (auto-scales width)
  --scale <factor>          Scale factor (default: 1.0)
  -q, --quality <preset>    Quality: low, medium, high (default: medium)
  --loop <count>            Loop count, 0 = infinite (default: 0)
  --speed <factor>          Playback speed (default: 1.0)
  --reverse                 Reverse playback
  --bounce                  Play forward then reverse
  --delay <ms>              Frame delay in ms (images only)
  --optimize <level>        Optimization: none, balanced, aggressive
  --dither <algorithm>      Dithering: none, bayer, sierra2_4a, floyd_steinberg
  --colors <number>         Max colors 2-256 (default: 256)
  -h, --help                Show this help message

Examples:
  skills run gif-maker -- video.mp4 -o demo.gif
  skills run gif-maker -- video.mp4 --start 5 --duration 3 -o clip.gif
  skills run gif-maker -- "frames/*.png" --fps 24 -o animation.gif
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
  console.error("Error: FFmpeg is not installed or not in PATH");
  console.error("Install FFmpeg:");
  console.error("  macOS: brew install ffmpeg");
  console.error("  Ubuntu: sudo apt install ffmpeg");
  console.error("  Windows: winget install ffmpeg");
  process.exit(1);
}

// Parse options
const options: GifOptions = {
  output: args.output,
  start: parseFloat(args.start) || 0,
  duration: args.duration ? parseFloat(args.duration) : null,
  end: args.end ? parseFloat(args.end) : null,
  fps: parseInt(args.fps) || 10,
  width: args.width ? parseInt(args.width) : null,
  height: args.height ? parseInt(args.height) : null,
  scale: parseFloat(args.scale) || 1.0,
  quality: args.quality as GifOptions["quality"],
  loop: parseInt(args.loop) ?? 0,
  speed: parseFloat(args.speed) || 1.0,
  reverse: args.reverse,
  bounce: args.bounce,
  delay: args.delay ? parseInt(args.delay) : null,
  optimize: args.optimize as GifOptions["optimize"],
  dither: args.dither,
  colors: Math.min(256, Math.max(2, parseInt(args.colors) || 256)),
};

// Apply quality preset
if (options.quality && QUALITY_PRESETS[options.quality]) {
  const preset = QUALITY_PRESETS[options.quality];
  if (!args.fps) options.fps = preset.fps;
  if (!args.colors) options.colors = preset.colors;
  if (!args.dither) options.dither = preset.dither;
}

// Get input files
function getInputFiles(patterns: string[]): string[] {
  const files: string[] = [];

  for (const pattern of patterns) {
    // Validate input pattern for dangerous characters before processing
    // Allow glob wildcards in patterns but validate the base path
    const hasGlob = pattern.includes("*") || pattern.includes("?");

    // If it contains dangerous characters (other than glob wildcards), validate strictly
    if (!hasGlob) {
      validatePath(pattern);
    } else {
      // For glob patterns, check for command injection chars but allow * and ?
      const DANGEROUS_CHARS_GLOB = /[;&|`$(){}[\]<>\\!'"]/;
      if (DANGEROUS_CHARS_GLOB.test(pattern)) {
        throw new Error(`Invalid characters in path: ${pattern}. Paths cannot contain shell metacharacters.`);
      }
    }

    const matches = globSync(pattern);
    if (matches.length > 0) {
      // Validate all matched files
      for (const match of matches) {
        validatePath(match);
      }
      files.push(...matches);
    } else if (fs.existsSync(pattern)) {
      files.push(pattern);
    }
  }

  return files.sort();
}

// Check if input is video or images
function isVideo(file: string): boolean {
  const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv"];
  return videoExtensions.includes(path.extname(file).toLowerCase());
}

// Get video duration (using execFileSync with array args for safety)
function getVideoDuration(file: string): number {
  try {
    const result = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file
    ], { encoding: "utf-8" });
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

// Get video dimensions (using execFileSync with array args for safety)
function getVideoDimensions(file: string): { width: number; height: number } {
  try {
    const result = execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      file
    ], { encoding: "utf-8" });
    const [width, height] = result.trim().split("x").map(Number);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

// Build FFmpeg filter for scaling
function buildScaleFilter(options: GifOptions, inputWidth: number, inputHeight: number): string {
  let width = inputWidth;
  let height = inputHeight;

  if (options.width && options.height) {
    width = options.width;
    height = options.height;
  } else if (options.width) {
    width = options.width;
    height = -1; // Auto
  } else if (options.height) {
    width = -1; // Auto
    height = options.height;
  } else if (options.scale !== 1.0) {
    width = Math.round(inputWidth * options.scale);
    height = Math.round(inputHeight * options.scale);
  }

  // Ensure even dimensions
  if (width > 0) width = width % 2 === 0 ? width : width - 1;
  if (height > 0) height = height % 2 === 0 ? height : height - 1;

  return `scale=${width}:${height}:flags=lanczos`;
}

// Create GIF from video
async function createGifFromVideo(inputFile: string): Promise<void> {
  console.log(`\nProcessing video: ${inputFile}`);

  const duration = getVideoDuration(inputFile);
  const { width: inputWidth, height: inputHeight } = getVideoDimensions(inputFile);

  console.log(`  - Duration: ${duration.toFixed(1)}s`);
  console.log(`  - Dimensions: ${inputWidth}x${inputHeight}`);

  // Calculate actual duration to process
  let startTime = options.start;
  let endTime = options.end !== null ? options.end : duration;
  let clipDuration = options.duration !== null ? options.duration : endTime - startTime;

  if (startTime >= duration) {
    console.error("Error: Start time exceeds video duration");
    process.exit(1);
  }

  clipDuration = Math.min(clipDuration, duration - startTime);

  console.log(`  - Extracting: ${startTime}s to ${(startTime + clipDuration).toFixed(1)}s`);

  // Build filter chain
  const filters: string[] = [];

  // Time trimming
  const inputArgs: string[] = [];
  if (startTime > 0) {
    inputArgs.push("-ss", startTime.toString());
  }
  if (clipDuration) {
    inputArgs.push("-t", clipDuration.toString());
  }

  // Speed adjustment
  if (options.speed !== 1.0) {
    const speedFactor = 1 / options.speed;
    filters.push(`setpts=${speedFactor}*PTS`);
  }

  // Scale filter
  const scaleFilter = buildScaleFilter(options, inputWidth, inputHeight);
  filters.push(scaleFilter);

  // FPS filter
  filters.push(`fps=${options.fps}`);

  // Reverse filter
  if (options.reverse) {
    filters.push("reverse");
  }

  // Create temp directory
  const tempDir = process.env.SKILLS_OUTPUT_DIR || "/tmp";
  const paletteFile = path.join(tempDir, `palette_${Date.now()}.png`);

  // Build filter string
  const filterString = filters.join(",");

  // Two-pass encoding for better quality
  console.log("\nGenerating optimized palette...");

  // Pass 1: Generate palette (using spawnSync with array args for safety)
  const paletteArgs = [
    "-y",
    ...inputArgs,
    "-i", inputFile,
    "-vf", `${filterString},palettegen=max_colors=${options.colors}:stats_mode=diff`,
    paletteFile,
  ];

  try {
    const result = spawnSync("ffmpeg", paletteArgs, { stdio: "pipe" });
    if (result.error) throw result.error;
  } catch (error: any) {
    console.error("Error generating palette:", error.message);
    process.exit(1);
  }

  console.log("Creating GIF...");

  // Pass 2: Create GIF with palette (using spawnSync with array args for safety)
  const ditherOption = options.dither === "none" ? "" : `:dither=${options.dither}`;
  const gifArgs = [
    "-y",
    ...inputArgs,
    "-i", inputFile,
    "-i", paletteFile,
    "-lavfi", `${filterString} [x]; [x][1:v] paletteuse${ditherOption}`,
    "-loop", options.loop.toString(),
    options.output,
  ];

  try {
    const result = spawnSync("ffmpeg", gifArgs, { stdio: "pipe" });
    if (result.error) throw result.error;
  } catch (error: any) {
    console.error("Error creating GIF:", error.message);
    // Clean up palette
    if (fs.existsSync(paletteFile)) fs.unlinkSync(paletteFile);
    process.exit(1);
  }

  // Clean up palette
  if (fs.existsSync(paletteFile)) fs.unlinkSync(paletteFile);

  // Handle bounce effect (append reversed version)
  if (options.bounce) {
    console.log("Applying bounce effect...");
    const tempGif = path.join(tempDir, `temp_bounce_${Date.now()}.gif`);
    fs.renameSync(options.output, tempGif);

    // Using spawnSync with array args for safety
    const bounceArgs = [
      "-y",
      "-i", tempGif,
      "-filter_complex", "[0:v]reverse[r];[0:v][r]concat=n=2:v=1:a=0",
      "-loop", options.loop.toString(),
      options.output,
    ];

    try {
      const result = spawnSync("ffmpeg", bounceArgs, { stdio: "pipe" });
      if (result.error) throw result.error;
    } catch {
      // Restore original if bounce fails
      fs.renameSync(tempGif, options.output);
    }

    if (fs.existsSync(tempGif)) fs.unlinkSync(tempGif);
  }

  // Optimize if requested (using spawnSync with array args for safety)
  if (options.optimize === "aggressive") {
    console.log("Optimizing...");
    try {
      // Try gifsicle if available
      const result = spawnSync("gifsicle", [
        "-O3",
        "--colors", options.colors.toString(),
        "-o", options.output,
        options.output
      ], { stdio: "pipe" });
      if (result.error) throw result.error;
    } catch {
      // gifsicle not available, skip
    }
  }

  printSummary();
}

// Create GIF from images
async function createGifFromImages(imageFiles: string[]): Promise<void> {
  console.log(`\nProcessing ${imageFiles.length} images...`);

  // Get dimensions from first image
  const firstImage = imageFiles[0];
  const { width: inputWidth, height: inputHeight } = getVideoDimensions(firstImage);

  // Calculate frame delay
  const frameDelay = options.delay !== null ? options.delay / 1000 : 1 / options.fps;

  // Create temp directory for ordered images
  const tempDir = process.env.SKILLS_OUTPUT_DIR || "/tmp";
  const listFile = path.join(tempDir, `filelist_${Date.now()}.txt`);

  // Handle reverse
  let orderedFiles = [...imageFiles];
  if (options.reverse) {
    orderedFiles.reverse();
  }

  // Handle bounce
  if (options.bounce) {
    const reversed = [...orderedFiles].reverse().slice(1, -1);
    orderedFiles = [...orderedFiles, ...reversed];
  }

  // Create file list for FFmpeg
  const fileListContent = orderedFiles
    .map((f) => `file '${path.resolve(f)}'\nduration ${frameDelay}`)
    .join("\n");
  fs.writeFileSync(listFile, fileListContent);

  // Build filter chain
  const filters: string[] = [];
  const scaleFilter = buildScaleFilter(options, inputWidth || 640, inputHeight || 480);
  filters.push(scaleFilter);
  filters.push(`fps=${options.fps}`);

  const filterString = filters.join(",");

  // Generate palette (using spawnSync with array args for safety)
  console.log("Generating palette...");
  const paletteFile = path.join(tempDir, `palette_${Date.now()}.png`);

  const paletteArgs = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-vf", `${filterString},palettegen=max_colors=${options.colors}`,
    paletteFile,
  ];

  try {
    const result = spawnSync("ffmpeg", paletteArgs, { stdio: "pipe" });
    if (result.error) throw result.error;
  } catch (error: any) {
    console.error("Error generating palette");
    fs.unlinkSync(listFile);
    process.exit(1);
  }

  // Create GIF (using spawnSync with array args for safety)
  console.log("Creating GIF...");
  const ditherOption = options.dither === "none" ? "" : `:dither=${options.dither}`;
  const gifArgs = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-i", paletteFile,
    "-lavfi", `${filterString} [x]; [x][1:v] paletteuse${ditherOption}`,
    "-loop", options.loop.toString(),
    options.output,
  ];

  try {
    const result = spawnSync("ffmpeg", gifArgs, { stdio: "pipe" });
    if (result.error) throw result.error;
  } catch (error: any) {
    console.error("Error creating GIF");
  }

  // Clean up
  fs.unlinkSync(listFile);
  if (fs.existsSync(paletteFile)) fs.unlinkSync(paletteFile);

  printSummary();
}

// Print summary
function printSummary(): void {
  if (!fs.existsSync(options.output)) {
    console.error("\nError: Failed to create GIF");
    process.exit(1);
  }

  const stats = fs.statSync(options.output);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  // Get GIF info (using execFileSync with array args for safety)
  let dimensions = "unknown";
  let frames = "unknown";
  try {
    const info = execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,nb_frames",
      "-of", "csv=p=0",
      options.output
    ], { encoding: "utf-8" });
    const [width, height, frameCount] = info.trim().split(",");
    dimensions = `${width}x${height}`;
    frames = frameCount || "unknown";
  } catch {
    // Ignore
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Created: ${options.output}`);
  console.log("=".repeat(50));
  console.log(`  - Size: ${sizeMB} MB`);
  console.log(`  - Dimensions: ${dimensions}`);
  console.log(`  - Frames: ${frames}`);
  console.log(`  - FPS: ${options.fps}`);
  console.log(`  - Colors: ${options.colors}`);
  console.log(`  - Loop: ${options.loop === 0 ? "infinite" : options.loop}`);
  console.log("");
}

// Main execution
async function main(): Promise<void> {
  try {
    // Validate output path first (before any processing)
    try {
      validatePath(options.output);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    // Get input files (includes validation inside)
    let inputFiles: string[];
    try {
      inputFiles = getInputFiles(args._ as string[]);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    if (inputFiles.length === 0) {
      console.error("Error: No input files found");
      process.exit(1);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(options.output);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Determine if video or images
    if (inputFiles.length === 1 && isVideo(inputFiles[0])) {
      await createGifFromVideo(inputFiles[0]);
    } else {
      // Filter to only image files
      const imageFiles = inputFiles.filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"].includes(ext);
      });

      if (imageFiles.length === 0) {
        console.error("Error: No valid image files found");
        process.exit(1);
      }

      await createGifFromImages(imageFiles);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
