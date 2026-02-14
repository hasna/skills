#!/usr/bin/env bun
import { parseArgs } from "util";
import { existsSync, statSync } from "fs";
import sizeOf from "image-size";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Scientific Figure Check
Usage: skills run scientific-figure-check -- <file>

Description:
  Analyzes image files to check if they meet common journal submission standards.
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

try {
  const stats = statSync(filePath);
  const dimensions = sizeOf(filePath);
  
  const fileSizeMB = stats.size / (1024 * 1024);
  const width = dimensions.width || 0;
  const height = dimensions.height || 0;
  const type = dimensions.type || "unknown";

  // Heuristics for "Print Quality" (assuming 300 DPI target)
  // If we don't know physical size, we can only guess based on pixel count.
  // A 3-inch wide figure at 300 DPI needs 900 pixels.
  const minWidth = 900; 
  const minHeight = 900;

  console.log(`
Figure Analysis Report
----------------------
File:   ${filePath}
Type:   ${type.toUpperCase()}
Size:   ${fileSizeMB.toFixed(2)} MB
Pixels: ${width} x ${height}

Checks:
`);

  // Check Format
  const validFormats = ["png", "jpg", "jpeg", "tiff", "eps", "pdf"];
  if (validFormats.includes(type.toLowerCase())) {
    console.log(`[PASS] Format (${type}) is generally accepted.`);
  } else {
    console.log(`[WARN] Format (${type}) might not be accepted. Prefer TIFF, EPS, or high-res PDF/PNG.`);
  }

  // Check Resolution (Heuristic)
  if (width >= minWidth && height >= minHeight) {
    console.log(`[PASS] Dimensions are likely sufficient for print (>3 inches at 300 DPI).`);
  } else {
    console.log(`[WARN] Dimensions are small (${width}x${height}). Ensure this provides 300 DPI at print size.`);
  }

  // Check File Size
  if (fileSizeMB > 10) {
    console.log(`[WARN] File size is large (${fileSizeMB.toFixed(2)} MB). Check journal limits.`);
  } else {
    console.log(`[PASS] File size is reasonable.`);
  }

} catch (error) {
  console.error("Error analyzing image:", error);
  process.exit(1);
}