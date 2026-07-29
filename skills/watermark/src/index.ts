#!/usr/bin/env bun

import sharp from "sharp";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import { globSync } from "glob";

// Types
interface WatermarkOptions {
  output: string | null;
  text: string | null;
  image: string | null;
  position: string;
  opacity: number;
  rotation: number;
  tile: boolean;
  margin: number;
  // Text options
  font: string;
  fontSize: number;
  color: string;
  bgColor: string | null;
  shadow: boolean;
  outline: boolean;
  outlineColor: string;
  // Image options
  scale: number;
  width: number | null;
  height: number | null;
  // PDF options
  pages: string;
  layer: "over" | "under";
}

// Position presets
const POSITION_PRESETS: Record<string, { x: string; y: string }> = {
  "top-left": { x: "left", y: "top" },
  "top-center": { x: "center", y: "top" },
  "top-right": { x: "right", y: "top" },
  "center-left": { x: "left", y: "center" },
  center: { x: "center", y: "center" },
  "center-right": { x: "right", y: "center" },
  "bottom-left": { x: "left", y: "bottom" },
  "bottom-center": { x: "center", y: "bottom" },
  "bottom-right": { x: "right", y: "bottom" },
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: [
    "output",
    "text",
    "image",
    "position",
    "font",
    "color",
    "bg-color",
    "outline-color",
    "pages",
    "layer",
  ],
  boolean: ["tile", "shadow", "outline", "help"],
  default: {
    position: "bottom-right",
    opacity: 0.5,
    rotation: 0,
    tile: false,
    margin: 20,
    font: "Arial",
    "font-size": 24,
    color: "#ffffff",
    shadow: true,
    outline: false,
    "outline-color": "#000000",
    scale: 0.2,
    pages: "all",
    layer: "over",
  },
  alias: {
    o: "output",
    t: "text",
    i: "image",
    p: "position",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
Watermark - Add watermarks to images and PDFs

Usage:
  skills run watermark -- <file> [options]

Options:
  -o, --output <path>       Output file or directory
  -t, --text <text>         Text watermark content
  -i, --image <path>        Image watermark (logo) path
  -p, --position <pos>      Position: top-left, center, bottom-right, etc. or "x,y"
  --opacity <number>        Opacity 0.0-1.0 (default: 0.5)
  --rotation <degrees>      Rotation angle (default: 0)
  --tile                    Tile watermark across image
  --margin <pixels>         Margin from edges (default: 20)

Text Options:
  --font <name>             Font family (default: Arial)
  --font-size <pixels>      Font size (default: 24)
  --color <hex>             Text color (default: #ffffff)
  --bg-color <hex>          Background color
  --shadow                  Add drop shadow (default: true)
  --outline                 Add text outline
  --outline-color <hex>     Outline color (default: #000000)

Image Options:
  --scale <factor>          Scale relative to image (default: 0.2)
  --width <pixels>          Fixed width
  --height <pixels>         Fixed height

PDF Options:
  --pages <range>           Pages: "all", "1-5", "1,3,5" (default: all)
  --layer <position>        Layer: over, under (default: over)

Examples:
  skills run watermark -- photo.jpg --text "Copyright" -o marked.jpg
  skills run watermark -- photo.jpg --image logo.png -o branded.jpg
  skills run watermark -- doc.pdf --text "DRAFT" --rotation -45 -o draft.pdf
`);
  process.exit(0);
}

// Parse options
const options: WatermarkOptions = {
  output: args.output || null,
  text: args.text || null,
  image: args.image || null,
  position: args.position,
  opacity: parseFloat(args.opacity) || 0.5,
  rotation: parseFloat(args.rotation) || 0,
  tile: args.tile,
  margin: parseInt(args.margin) || 20,
  font: args.font,
  fontSize: parseInt(args["font-size"]) || 24,
  color: args.color,
  bgColor: args["bg-color"] || null,
  shadow: args.shadow,
  outline: args.outline,
  outlineColor: args["outline-color"],
  scale: parseFloat(args.scale) || 0.2,
  width: args.width ? parseInt(args.width) : null,
  height: args.height ? parseInt(args.height) : null,
  pages: args.pages,
  layer: args.layer as "over" | "under",
};

// Validate
if (!options.text && !options.image) {
  console.error("Error: Must specify --text or --image watermark");
  process.exit(1);
}

// Get input files
function getInputFiles(patterns: string[]): string[] {
  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = globSync(pattern);
    if (matches.length > 0) {
      files.push(...matches);
    } else if (fs.existsSync(pattern)) {
      files.push(pattern);
    }
  }

  return files;
}

// Parse hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }
  return { r: 255, g: 255, b: 255 };
}

// Calculate position
function calculatePosition(
  position: string,
  containerWidth: number,
  containerHeight: number,
  watermarkWidth: number,
  watermarkHeight: number,
  margin: number
): { x: number; y: number } {
  // Check for custom position
  if (position.includes(",")) {
    const [x, y] = position.split(",").map((v) => parseInt(v.trim()));
    return { x, y };
  }

  const preset = POSITION_PRESETS[position] || POSITION_PRESETS["bottom-right"];

  let x: number;
  let y: number;

  // Calculate X
  switch (preset.x) {
    case "left":
      x = margin;
      break;
    case "right":
      x = containerWidth - watermarkWidth - margin;
      break;
    default: // center
      x = (containerWidth - watermarkWidth) / 2;
  }

  // Calculate Y
  switch (preset.y) {
    case "top":
      y = margin;
      break;
    case "bottom":
      y = containerHeight - watermarkHeight - margin;
      break;
    default: // center
      y = (containerHeight - watermarkHeight) / 2;
  }

  return { x: Math.max(0, x), y: Math.max(0, y) };
}

// Create text watermark SVG
function createTextSvg(
  text: string,
  options: WatermarkOptions,
  width: number,
  height: number
): string {
  const { color, fontSize, shadow, outline, outlineColor, bgColor } = options;

  let shadowFilter = "";
  if (shadow) {
    shadowFilter = `
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.5"/>
      </filter>
    `;
  }

  const textStyle = `
    font-family: ${options.font}, Arial, sans-serif;
    font-size: ${fontSize}px;
    fill: ${color};
    ${shadow ? 'filter: url(#shadow);' : ''}
    ${outline ? `stroke: ${outlineColor}; stroke-width: 1px;` : ''}
  `;

  let bgRect = "";
  if (bgColor) {
    bgRect = `<rect x="0" y="0" width="100%" height="100%" fill="${bgColor}" rx="4"/>`;
  }

  // Estimate text dimensions
  const textWidth = text.length * fontSize * 0.6;
  const textHeight = fontSize * 1.2;
  const padding = 10;

  return `
    <svg width="${textWidth + padding * 2}" height="${textHeight + padding * 2}" xmlns="http://www.w3.org/2000/svg">
      <defs>${shadowFilter}</defs>
      ${bgRect}
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" style="${textStyle}">
        ${text}
      </text>
    </svg>
  `;
}

// Watermark image using Sharp
async function watermarkImage(inputPath: string, outputPath: string): Promise<void> {
  console.log(`Processing: ${inputPath}`);

  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const { width: imgWidth = 800, height: imgHeight = 600 } = metadata;

  let watermarkBuffer: Buffer;
  let watermarkWidth: number;
  let watermarkHeight: number;

  if (options.text) {
    // Create text watermark
    const svg = createTextSvg(options.text, options, imgWidth, imgHeight);
    const svgBuffer = Buffer.from(svg);
    const svgImage = sharp(svgBuffer);
    const svgMeta = await svgImage.metadata();
    watermarkWidth = svgMeta.width || 200;
    watermarkHeight = svgMeta.height || 50;

    // Apply rotation if needed
    if (options.rotation !== 0) {
      watermarkBuffer = await svgImage
        .rotate(options.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();
      const rotatedMeta = await sharp(watermarkBuffer).metadata();
      watermarkWidth = rotatedMeta.width || watermarkWidth;
      watermarkHeight = rotatedMeta.height || watermarkHeight;
    } else {
      watermarkBuffer = await svgImage.toBuffer();
    }
  } else if (options.image) {
    // Load image watermark
    let wmImage = sharp(options.image);
    const wmMeta = await wmImage.metadata();

    // Calculate dimensions
    if (options.width || options.height) {
      watermarkWidth = options.width || Math.round((options.height! / wmMeta.height!) * wmMeta.width!);
      watermarkHeight = options.height || Math.round((options.width! / wmMeta.width!) * wmMeta.height!);
    } else {
      watermarkWidth = Math.round(imgWidth * options.scale);
      watermarkHeight = Math.round((watermarkWidth / wmMeta.width!) * wmMeta.height!);
    }

    wmImage = wmImage.resize(watermarkWidth, watermarkHeight, { fit: "inside" });

    // Apply rotation
    if (options.rotation !== 0) {
      wmImage = wmImage.rotate(options.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    watermarkBuffer = await wmImage.toBuffer();
    const finalMeta = await sharp(watermarkBuffer).metadata();
    watermarkWidth = finalMeta.width || watermarkWidth;
    watermarkHeight = finalMeta.height || watermarkHeight;
  } else {
    throw new Error("No watermark specified");
  }

  // Apply opacity
  if (options.opacity < 1) {
    watermarkBuffer = await sharp(watermarkBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        // Modify alpha channel
        for (let i = 3; i < data.length; i += 4) {
          data[i] = Math.round(data[i] * options.opacity);
        }
        return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
          .png()
          .toBuffer();
      });
  }

  if (options.tile) {
    // Create tiled watermark
    const composites: sharp.OverlayOptions[] = [];
    const spacingX = watermarkWidth + options.margin * 2;
    const spacingY = watermarkHeight + options.margin * 2;

    for (let y = 0; y < imgHeight; y += spacingY) {
      for (let x = 0; x < imgWidth; x += spacingX) {
        composites.push({
          input: watermarkBuffer,
          left: Math.round(x),
          top: Math.round(y),
        });
      }
    }

    await image.composite(composites).toFile(outputPath);
  } else {
    // Single watermark
    const { x, y } = calculatePosition(
      options.position,
      imgWidth,
      imgHeight,
      watermarkWidth,
      watermarkHeight,
      options.margin
    );

    await image
      .composite([
        {
          input: watermarkBuffer,
          left: Math.round(x),
          top: Math.round(y),
        },
      ])
      .toFile(outputPath);
  }

  console.log(`  -> ${outputPath}`);
}

// Parse page range
function parsePageRange(pageStr: string, totalPages: number): number[] {
  if (pageStr === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const pages: Set<number> = new Set();
  const parts = pageStr.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n.trim()));
      for (let i = start - 1; i < Math.min(end, totalPages); i++) {
        if (i >= 0) pages.add(i);
      }
    } else {
      const pageNum = parseInt(part) - 1;
      if (pageNum >= 0 && pageNum < totalPages) {
        pages.add(pageNum);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

// Watermark PDF
async function watermarkPdf(inputPath: string, outputPath: string): Promise<void> {
  console.log(`Processing PDF: ${inputPath}`);

  const pdfBytes = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  const pageIndices = parsePageRange(options.pages, totalPages);
  console.log(`  Watermarking ${pageIndices.length} of ${totalPages} pages`);

  // Embed font for text watermark
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const pageIndex of pageIndices) {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();

    if (options.text) {
      // Process text variables
      let text = options.text
        .replace("{n}", String(pageIndex + 1))
        .replace("{total}", String(totalPages))
        .replace("{date}", new Date().toISOString().split("T")[0])
        .replace("{filename}", path.basename(inputPath, ".pdf"));

      const textWidth = font.widthOfTextAtSize(text, options.fontSize);
      const textHeight = options.fontSize;

      const { x, y } = calculatePosition(
        options.position,
        width,
        height,
        textWidth,
        textHeight,
        options.margin
      );

      const color = hexToRgb(options.color);

      // Draw text
      page.drawText(text, {
        x,
        y,
        size: options.fontSize,
        font,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
        opacity: options.opacity,
        rotate: degrees(options.rotation),
      });
    }

    if (options.image) {
      // Embed and draw image watermark
      const imageBytes = fs.readFileSync(options.image);
      const ext = path.extname(options.image).toLowerCase();

      let embeddedImage;
      if (ext === ".png") {
        embeddedImage = await pdfDoc.embedPng(imageBytes);
      } else {
        embeddedImage = await pdfDoc.embedJpg(imageBytes);
      }

      // Calculate dimensions
      let wmWidth = embeddedImage.width;
      let wmHeight = embeddedImage.height;

      if (options.width || options.height) {
        wmWidth = options.width || Math.round((options.height! / wmHeight) * wmWidth);
        wmHeight = options.height || Math.round((options.width! / wmWidth) * wmHeight);
      } else {
        wmWidth = Math.round(width * options.scale);
        wmHeight = Math.round((wmWidth / embeddedImage.width) * embeddedImage.height);
      }

      const { x, y } = calculatePosition(
        options.position,
        width,
        height,
        wmWidth,
        wmHeight,
        options.margin
      );

      page.drawImage(embeddedImage, {
        x,
        y,
        width: wmWidth,
        height: wmHeight,
        opacity: options.opacity,
        rotate: degrees(options.rotation),
      });
    }
  }

  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);
  console.log(`  -> ${outputPath}`);
}

// Main execution
async function main(): Promise<void> {
  try {
    const inputFiles = getInputFiles(args._ as string[]);

    if (inputFiles.length === 0) {
      console.error("Error: No input files found");
      process.exit(1);
    }

    const isBatch = inputFiles.length > 1;
    const outputIsDir = options.output && (isBatch || fs.existsSync(options.output) && fs.statSync(options.output).isDirectory());

    // Create output directory if needed
    if (outputIsDir && options.output && !fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    console.log(`\nProcessing ${inputFiles.length} file(s)...\n`);

    for (const inputFile of inputFiles) {
      const ext = path.extname(inputFile).toLowerCase();
      const basename = path.basename(inputFile);

      // Determine output path
      let outputPath: string;
      if (outputIsDir && options.output) {
        outputPath = path.join(options.output, basename);
      } else if (options.output) {
        outputPath = options.output;
      } else {
        const name = path.basename(inputFile, ext);
        outputPath = path.join(path.dirname(inputFile), `${name}-watermarked${ext}`);
      }

      // Process based on type
      if (ext === ".pdf") {
        await watermarkPdf(inputFile, outputPath);
      } else if ([".jpg", ".jpeg", ".png", ".webp", ".tiff", ".bmp"].includes(ext)) {
        await watermarkImage(inputFile, outputPath);
      } else {
        console.warn(`Skipping unsupported format: ${inputFile}`);
      }
    }

    console.log("\nDone!");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
