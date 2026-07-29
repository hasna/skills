#!/usr/bin/env bun

/**
 * Generate Favicon Skill
 * Creates complete favicon sets from a single source image
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join, resolve, basename } from "path";
import sharp from "sharp";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "generate-favicon";
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
function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

interface GenerateFaviconOptions {
  source: string;
  output: string;
  name: string;
  bgColor: string;
  themeColor: string;
  tileColor: string;
}

const SIZES = {
  favicon16: 16,
  favicon32: 32,
  favicon48: 48,
  favicon64: 64,
  favicon128: 128,
  appleTouch: 180,
  androidChrome192: 192,
  androidChrome512: 512,
} as const;

async function generateFavicon(options: GenerateFaviconOptions): Promise<void> {
  const { source, output, name, bgColor, themeColor, tileColor } = options;

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);
  log(`Source: ${source}`);
  log(`Output: ${output}`);
  log(`App Name: ${name}`);

  // Validate source image
  if (!existsSync(source)) {
    log(`Error: Source image not found: ${source}`, "error");
    process.exit(1);
  }

  // Create output directory
  mkdirSync(output, { recursive: true });

  // Load source image
  log("Loading source image...");
  const sourceImage = sharp(source);
  const metadata = await sourceImage.metadata();

  if (!metadata.width || !metadata.height) {
    log("Error: Could not read image dimensions", "error");
    process.exit(1);
  }

  if (metadata.width < 256 || metadata.height < 256) {
    log("Error: Source image too small (minimum 256x256)", "error");
    process.exit(1);
  }

  log(`Source loaded (${metadata.width}x${metadata.height}, ${metadata.format})`, "success");

  // Generate PNG files
  log("Generating PNG files...");

  const pngFiles: { size: number; path: string; buffer: Buffer }[] = [];

  // 16x16
  log("  • favicon-16x16.png");
  const png16 = await sourceImage
    .clone()
    .resize(SIZES.favicon16, SIZES.favicon16, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const path16 = join(output, "favicon-16x16.png");
  writeFileSync(path16, png16);
  pngFiles.push({ size: 16, path: path16, buffer: png16 });

  // 32x32
  log("  • favicon-32x32.png");
  const png32 = await sourceImage
    .clone()
    .resize(SIZES.favicon32, SIZES.favicon32, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const path32 = join(output, "favicon-32x32.png");
  writeFileSync(path32, png32);
  pngFiles.push({ size: 32, path: path32, buffer: png32 });

  // 48x48
  log("  • favicon-48x48.png");
  const png48 = await sourceImage
    .clone()
    .resize(SIZES.favicon48, SIZES.favicon48, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const path48 = join(output, "favicon-48x48.png");
  writeFileSync(path48, png48);
  pngFiles.push({ size: 48, path: path48, buffer: png48 });

  // 64x64
  log("  • favicon-64x64.png");
  const png64 = await sourceImage
    .clone()
    .resize(SIZES.favicon64, SIZES.favicon64, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(join(output, "favicon-64x64.png"), png64);

  // 128x128
  log("  • favicon-128x128.png");
  const png128 = await sourceImage
    .clone()
    .resize(SIZES.favicon128, SIZES.favicon128, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(join(output, "favicon-128x128.png"), png128);

  // Apple Touch Icon (180x180)
  log("  • apple-touch-icon.png");
  const pngApple = await sourceImage
    .clone()
    .resize(SIZES.appleTouch, SIZES.appleTouch, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(join(output, "apple-touch-icon.png"), pngApple);

  // Android Chrome 192x192
  log("  • android-chrome-192x192.png");
  const pngAndroid192 = await sourceImage
    .clone()
    .resize(SIZES.androidChrome192, SIZES.androidChrome192, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(join(output, "android-chrome-192x192.png"), pngAndroid192);

  // Android Chrome 512x512
  log("  • android-chrome-512x512.png");
  const pngAndroid512 = await sourceImage
    .clone()
    .resize(SIZES.androidChrome512, SIZES.androidChrome512, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  writeFileSync(join(output, "android-chrome-512x512.png"), pngAndroid512);

  // Generate ICO file
  log("Generating favicon.ico...");
  await generateIcoFile(pngFiles, join(output, "favicon.ico"));
  log("  ✓ favicon.ico (16x16, 32x32, 48x48 embedded)", "success");

  // Generate site.webmanifest
  log("Generating configuration files...");
  const manifest = {
    name: name,
    short_name: name,
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    theme_color: themeColor,
    background_color: bgColor,
    display: "standalone",
  };
  writeFileSync(
    join(output, "site.webmanifest"),
    JSON.stringify(manifest, null, 2)
  );
  log("  • site.webmanifest");

  // Generate browserconfig.xml
  const browserConfig = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/favicon-128x128.png"/>
      <TileColor>${tileColor}</TileColor>
    </tile>
  </msapplication>
</browserconfig>`;
  writeFileSync(join(output, "browserconfig.xml"), browserConfig);
  log("  • browserconfig.xml");

  // Generate HTML snippets
  log("Generating HTML snippets...");
  const htmlSnippets = `<!-- Favicons - Copy and paste into your HTML <head> -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${themeColor}">

<!-- Optional: For Windows tiles -->
<meta name="msapplication-config" content="/browserconfig.xml">
<meta name="msapplication-TileColor" content="${tileColor}">
`;
  writeFileSync(join(output, "html-snippets.txt"), htmlSnippets);
  log("  • html-snippets.txt");

  // Summary
  log("Favicon generation complete!", "success");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Generated files:");
  console.log("  • 9 PNG files (various sizes)");
  console.log("  • 1 ICO file (multi-size)");
  console.log("  • 1 webmanifest");
  console.log("  • 1 browserconfig.xml");
  console.log("  • 1 html-snippets.txt");
  console.log("");
  console.log(`📂 Output directory: ${output}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy files to your project's public directory");
  console.log("  2. Add HTML snippets from html-snippets.txt to your <head>");
  console.log("  3. Test your favicon at https://realfavicongenerator.net/favicon_checker");
}

/**
 * Generate ICO file with embedded sizes
 * ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
async function generateIcoFile(
  pngFiles: { size: number; path: string; buffer: Buffer }[],
  outputPath: string
): Promise<void> {
  // Sort by size and take first 3 (16, 32, 48)
  const sorted = pngFiles.sort((a, b) => a.size - b.size).slice(0, 3);

  // ICO Header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved (must be 0)
  header.writeUInt16LE(1, 2); // Type (1 = ICO)
  header.writeUInt16LE(sorted.length, 4); // Number of images

  // Directory entries (16 bytes each)
  let offset = 6 + sorted.length * 16;
  const entries: Buffer[] = [];

  for (const png of sorted) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(png.size === 256 ? 0 : png.size, 0); // Width (0 = 256)
    entry.writeUInt8(png.size === 256 ? 0 : png.size, 1); // Height (0 = 256)
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(png.buffer.length, 8); // Size of image data
    entry.writeUInt32LE(offset, 12); // Offset to image data
    entries.push(entry);
    offset += png.buffer.length;
  }

  // Combine header + entries + PNG data
  const icoBuffer = Buffer.concat([
    header,
    ...entries,
    ...sorted.map((png) => png.buffer),
  ]);

  writeFileSync(outputPath, icoBuffer);
}

/**
 * Parse hex color to RGB
 */
function parseColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.substring(0, 2), 16),
    g: parseInt(cleaned.substring(2, 4), 16),
    b: parseInt(cleaned.substring(4, 6), 16),
  };
}

/**
 * Main entry point
 */
async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        output: { type: "string", short: "o" },
        name: { type: "string", short: "n" },
        "bg-color": { type: "string" },
        "theme-color": { type: "string" },
        "tile-color": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Generate Favicon - Create complete favicon sets from a single source image

Usage:
  skills run generate-favicon -- <source-image> [options]

Options:
  -o, --output <dir>        Output directory (default: .skills/exports/generate-favicon)
  -n, --name <name>         App name for manifest (default: "My App")
  --bg-color <hex>          Background color for manifest (default: #ffffff)
  --theme-color <hex>       Theme color for manifest (default: #000000)
  --tile-color <hex>        Tile color for Windows (default: #da532c)
  -h, --help                Show this help message

Examples:
  skills run generate-favicon -- ./logo.png
  skills run generate-favicon -- ./logo.png --output ./public
  skills run generate-favicon -- ./logo.png --name "My App" --theme-color "#ff6b00"
      `);
      process.exit(0);
    }

    // Get source image
    const source = positionals[0];
    if (!source) {
      log("Error: Source image path required", "error");
      console.error("Usage: skills run generate-favicon -- <source-image>");
      console.error('Run with --help for more information');
      process.exit(1);
    }

    // Determine output directory
    let outputDir: string;
    if (values.output) {
      outputDir = resolve(values.output as string);
    } else if (process.env.SKILLS_OUTPUT_DIR) {
      outputDir = join(process.env.SKILLS_OUTPUT_DIR, "exports", "generate-favicon");
    } else {
      outputDir = resolve(".skills/exports/generate-favicon");
    }

    const options: GenerateFaviconOptions = {
      source: resolve(source),
      output: outputDir,
      name: (values.name as string) || "My App",
      bgColor: (values["bg-color"] as string) || "#ffffff",
      themeColor: (values["theme-color"] as string) || "#000000",
      tileColor: (values["tile-color"] as string) || "#da532c",
    };

    await generateFavicon(options);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : error}`, "error");
    process.exit(1);
  }
}

main();
