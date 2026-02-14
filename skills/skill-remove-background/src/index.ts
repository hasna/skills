#!/usr/bin/env bun

/**
 * Remove Background Skill
 *
 * Removes backgrounds from images using local AI processing
 * Supports batch processing, custom backgrounds, and multiple output formats
 * No API key required - runs entirely locally
 */

import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { existsSync } from "node:fs";

// Types
interface ProcessedImage {
  input: string;
  output: string;
  size: string;
  error?: string;
}

interface Metadata {
  timestamp: string;
  totalImages: number;
  successful: number;
  failed: number;
  settings: {
    bgColor: string;
    format: string;
  };
  images: ProcessedImage[];
}

// Configuration
const OUTPUT_BASE = process.env.SKILLS_OUTPUT_DIR || process.env.SKILLS_EXPORTS_DIR || ".skills";
const PROJECT_ROOT = process.env.SKILLS_PROJECT_ROOT || process.cwd();

// Supported formats
const SUPPORTED_FORMATS = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * Parse command line arguments
 */
function parseArguments() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "bg-color": { type: "string", default: "transparent" },
      output: { type: "string", short: "o" },
      format: { type: "string", default: "png" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Validate inputs
  if (positionals.length === 0) {
    console.error("Error: No image files specified");
    console.error("Usage: skills run remove-background -- image.jpg [image2.png ...]");
    console.error("Run with --help for more information");
    process.exit(1);
  }

  // Validate format
  if (!["png", "jpg", "webp"].includes(values.format as string)) {
    console.error(`Error: Invalid format "${values.format}". Use: png, jpg, or webp`);
    process.exit(1);
  }

  // Validate color format (if not transparent)
  const bgColor = values["bg-color"] as string;
  if (bgColor !== "transparent" && !/^#[0-9A-Fa-f]{6}$/.test(bgColor)) {
    console.error(`Error: Invalid color format "${bgColor}". Use hex format like #FF5733 or "transparent"`);
    process.exit(1);
  }

  return {
    images: positionals,
    bgColor,
    outputDir: values.output as string | undefined,
    format: values.format as string,
  };
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Remove Background - AI-powered background removal (runs locally)

USAGE:
  skills run remove-background -- <images...> [options]

OPTIONS:
  --bg-color <color>    Background color (hex like #FF5733 or "transparent")
  --output, -o <dir>    Custom output directory
  --format <format>     Output format: png, jpg, webp (default: png)
  -h, --help            Show this help message

EXAMPLES:
  # Basic usage
  skills run remove-background -- photo.jpg

  # White background
  skills run remove-background -- product.jpg --bg-color "#FFFFFF"

  # Batch process
  skills run remove-background -- image1.jpg image2.png image3.webp

  # Custom output directory
  skills run remove-background -- image.jpg --output ./processed

NOTE:
  This skill runs locally using AI - no API key required.
  First run may download the model (~30MB).
`);
}

/**
 * Validate image file
 */
async function validateImage(imagePath: string): Promise<boolean> {
  try {
    if (!existsSync(imagePath)) {
      console.error(`File not found: ${imagePath}`);
      return false;
    }

    const ext = extname(imagePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      console.error(`Unsupported format: ${imagePath} (use PNG, JPG, JPEG, or WebP)`);
      return false;
    }

    const stats = await stat(imagePath);
    const maxSize = 20 * 1024 * 1024; // 20 MB
    if (stats.size > maxSize) {
      console.error(`File too large: ${imagePath} (max 20 MB)`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error validating ${imagePath}:`, error);
    return false;
  }
}

/**
 * Get mime type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "image/png";
}

/**
 * Remove background from image using local AI model
 */
async function removeBackground(imagePath: string): Promise<Blob> {
  // Dynamic import to avoid loading until needed
  const { removeBackground: removeBg } = await import("@imgly/background-removal-node");

  console.log("   Running local AI background removal...");

  // Read image as blob with proper mime type
  const imageBuffer = await readFile(imagePath);
  const mimeType = getMimeType(imagePath);
  const blob = new Blob([imageBuffer], { type: mimeType });

  // Process with local AI model
  const result = await removeBg(blob, {
    progress: (key, current, total) => {
      if (key === "compute:inference") {
        const pct = Math.round((current / total) * 100);
        process.stdout.write(`\r   Processing: ${pct}%`);
      }
    },
  });

  console.log("\r   Processing: 100%");
  return result;
}

/**
 * Apply background color to transparent image
 */
async function applyBackgroundColor(
  imageBuffer: Buffer,
  bgColor: string
): Promise<Buffer> {
  // If transparent, return as-is
  if (bgColor === "transparent") {
    return imageBuffer;
  }

  // Use sharp to composite with background color
  const sharp = (await import("sharp")).default;

  // Parse hex color
  const r = parseInt(bgColor.slice(1, 3), 16);
  const g = parseInt(bgColor.slice(3, 5), 16);
  const b = parseInt(bgColor.slice(5, 7), 16);

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;

  // Create solid color background
  const background = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  // Composite foreground over background
  const result = await sharp(background)
    .composite([{ input: imageBuffer, blend: "over" }])
    .png()
    .toBuffer();

  return result;
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Process single image
 */
async function processImage(
  imagePath: string,
  outputDir: string,
  options: {
    bgColor: string;
    format: string;
  }
): Promise<ProcessedImage> {
  try {
    console.log(`\nProcessing: ${basename(imagePath)}`);

    const isValid = await validateImage(imagePath);
    if (!isValid) {
      return {
        input: imagePath,
        output: "",
        size: "0",
        error: "Validation failed",
      };
    }

    // Remove background
    const resultBlob = await removeBackground(imagePath);
    let resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

    // Apply background color if specified
    if (options.bgColor !== "transparent") {
      console.log(`   Applying background color: ${options.bgColor}`);
      resultBuffer = await applyBackgroundColor(resultBuffer, options.bgColor);
    }

    // Convert to desired format
    const sharp = (await import("sharp")).default;
    if (options.format === "jpg") {
      resultBuffer = await sharp(resultBuffer).jpeg({ quality: 95 }).toBuffer();
    } else if (options.format === "webp") {
      resultBuffer = await sharp(resultBuffer).webp({ quality: 95 }).toBuffer();
    }

    // Generate output filename
    const ext = extname(imagePath);
    const name = basename(imagePath, ext);
    const outputExt = options.format === "jpg" ? ".jpg" : `.${options.format}`;
    const outputPath = join(outputDir, `${name}-nobg${outputExt}`);

    // Save processed image
    await writeFile(outputPath, resultBuffer);

    const stats = await stat(outputPath);

    console.log(`   Saved: ${basename(outputPath)}`);
    console.log(`   Size: ${formatSize(stats.size)}`);

    return {
      input: imagePath,
      output: outputPath,
      size: formatSize(stats.size),
    };
  } catch (error) {
    console.error(`   Failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      input: imagePath,
      output: "",
      size: "0",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main function
 */
async function main() {
  console.log("Remove Background Skill v2.1.0\n");
  console.log("   Powered by local AI (no API key needed)\n");

  // Parse arguments
  const args = parseArguments();

  // Setup output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] + "_" +
                   new Date().toTimeString().split(" ")[0].replace(/:/g, "");

  const outputDir = args.outputDir
    ? join(PROJECT_ROOT, args.outputDir)
    : join(OUTPUT_BASE, "remove-background", timestamp);

  await mkdir(outputDir, { recursive: true });

  console.log(`Output directory: ${outputDir}`);
  console.log(`Background: ${args.bgColor}`);
  console.log(`Format: ${args.format}`);
  console.log(`Processing ${args.images.length} image(s)...`);

  // Process all images
  const results: ProcessedImage[] = [];
  for (const imagePath of args.images) {
    // Handle both absolute and relative paths
    const absolutePath = imagePath.startsWith("/") ? imagePath : join(PROJECT_ROOT, imagePath);
    const result = await processImage(absolutePath, outputDir, {
      bgColor: args.bgColor,
      format: args.format,
    });
    results.push(result);
  }

  // Calculate statistics
  const successful = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;

  // Create metadata
  const metadata: Metadata = {
    timestamp: new Date().toISOString(),
    totalImages: results.length,
    successful,
    failed,
    settings: {
      bgColor: args.bgColor,
      format: args.format,
    },
    images: results,
  };

  // Save metadata
  const metadataPath = join(outputDir, "metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("Summary");
  console.log("=".repeat(50));
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Output: ${outputDir}`);
  console.log("=".repeat(50));

  if (failed > 0) {
    console.error("\nSome images failed to process. Check errors above.");
    process.exit(1);
  }

  console.log("\nAll images processed successfully!");
}

// Run main function
main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
