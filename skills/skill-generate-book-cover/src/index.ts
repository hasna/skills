#!/usr/bin/env bun

/**
 * Generate Book Cover - AI-powered book cover generation
 *
 * This script generates professional book covers using DALL-E 3 with customizable
 * genres, dimensions, styles, and text overlays.
 */

import { parseArgs } from "util";
import { mkdir, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import OpenAI from "openai";
import { randomUUID } from "crypto";

// ============================================================================
// Constants & Logging
// ============================================================================

const SKILL_NAME = "generate-book-cover";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  try {
    await appendFile(logFile, logEntry);
  } catch (e) {
    // Silent fail for logging
  }

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

interface BookCoverOptions {
  title: string;
  genre: string;
  author?: string;
  subtitle?: string;
  tagline?: string;
  series?: string;
  style: string;
  dimensions: string;
  colors?: string;
  fontStyle: string;
  includeSpine: boolean;
  includeBack: boolean;
  fullWrap: boolean;
  spineWidth?: number;
  pageCount: number;
  variations: number;
  styles?: string[];
  quality: "standard" | "hd";
  aspectFocus: string;
  mood?: string;
  output: string;
  format: "png" | "jpg" | "both";
  prefix?: string;
  includeMockup: boolean;
}

interface DimensionSpec {
  format: string;
  width: number;
  height: number;
  dpi: number;
  bleed?: number;
}

interface GeneratedCover {
  type: "front" | "spine" | "back" | "full-wrap" | "mockup";
  filename: string;
  url: string;
  prompt: string;
}

interface CoverMetadata {
  title: string;
  author?: string;
  genre: string;
  style: string;
  dimensions: DimensionSpec;
  colors?: string[];
  mood?: string;
  generatedAt: string;
  aiPrompt: string;
  files: {
    front?: string;
    spine?: string;
    back?: string;
    fullWrap?: string;
    mockup?: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const DIMENSIONS: Record<string, DimensionSpec> = {
  paperback: { format: "paperback", width: 1800, height: 2700, dpi: 300 },
  hardcover: { format: "hardcover", width: 1875, height: 2775, dpi: 300, bleed: 0.125 },
  ebook: { format: "ebook", width: 1600, height: 2400, dpi: 300 },
  square: { format: "square", width: 2400, height: 2400, dpi: 300 },
  trade: { format: "trade", width: 1650, height: 2550, dpi: 300 },
};

const GENRE_KEYWORDS: Record<string, string[]> = {
  fiction: ["literary", "contemporary", "artistic"],
  "non-fiction": ["professional", "educational", "informative"],
  "sci-fi": ["futuristic", "space", "technology", "alien", "cyberpunk"],
  fantasy: ["magical", "medieval", "mystical", "dragons", "enchanted"],
  romance: ["romantic", "passionate", "soft lighting", "couples", "flowers"],
  thriller: ["dark", "tense", "mysterious", "suspenseful", "urban"],
  mystery: ["noir", "detective", "shadows", "clues", "investigation"],
  horror: ["dark", "scary", "haunting", "supernatural", "eerie"],
  business: ["professional", "corporate", "clean", "modern", "success"],
  "self-help": ["uplifting", "inspiring", "peaceful", "transformation"],
  biography: ["portrait", "historical", "personal", "legacy"],
  history: ["historical", "documentary", "archival", "period"],
  children: ["colorful", "playful", "fun", "illustrated", "whimsical"],
  "young-adult": ["dynamic", "coming-of-age", "vibrant", "teen"],
  literary: ["sophisticated", "artistic", "elegant", "thoughtful"],
};

const COLOR_PALETTES: Record<string, string[]> = {
  ocean: ["deep blue", "turquoise", "white", "sea foam"],
  sunset: ["orange", "pink", "purple", "gold"],
  monochrome: ["black", "white", "grey"],
  forest: ["deep green", "brown", "gold", "moss"],
  fire: ["red", "orange", "yellow", "black"],
  ice: ["light blue", "white", "silver", "pale purple"],
  royal: ["purple", "gold", "deep red", "black"],
  earth: ["brown", "tan", "forest green", "terracotta"],
  midnight: ["navy", "black", "silver", "deep purple"],
  vintage: ["sepia", "cream", "muted gold", "brown"],
};

// ============================================================================
// Helper Functions
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function parseColorInput(colorInput?: string): string[] {
  if (!colorInput) return [];

  // Check if it's a predefined palette
  if (COLOR_PALETTES[colorInput.toLowerCase()]) {
    return COLOR_PALETTES[colorInput.toLowerCase()];
  }

  // Parse as comma-separated colors
  return colorInput.split(",").map(c => c.trim()).filter(Boolean);
}

function calculateSpineWidth(pageCount: number, paperType: "standard" | "premium" = "standard"): number {
  // Standard calculation: pages * paper thickness
  // 60# paper = 0.0025 inches per sheet (0.005 per page since it's double-sided)
  // 70# paper = 0.003 inches per sheet
  const thickness = paperType === "standard" ? 0.0025 : 0.003;
  return (pageCount / 2) * thickness;
}

function generatePrompt(options: BookCoverOptions, coverType: "front" | "spine" | "back" | "full-wrap"): string {
  const { title, genre, style, colors, mood, author, subtitle, series, fontStyle } = options;

  // Get genre-specific keywords
  const genreKeywords = GENRE_KEYWORDS[genre] || GENRE_KEYWORDS.fiction;

  // Parse colors
  const colorList = colors ? parseColorInput(colors) : [];

  let prompt = `Professional ${genre} book cover design, ${style} style. `;

  // Cover type specific
  if (coverType === "front") {
    prompt += `Front cover only. `;

    // Add title and typography
    prompt += `Large bold title "${title}" prominently displayed. `;
    if (fontStyle) {
      prompt += `${fontStyle} typography. `;
    }

    if (author) {
      prompt += `Author name "${author}" elegantly placed. `;
    }

    if (subtitle) {
      prompt += `Subtitle "${subtitle}" in smaller text. `;
    }

    if (series) {
      prompt += `Series indicator "${series}". `;
    }
  } else if (coverType === "spine") {
    prompt += `Book spine design with vertical text. `;
    prompt += `Title "${title}" and author "${author || "Author"}" on spine. `;
  } else if (coverType === "back") {
    prompt += `Back cover design with space for book description. `;
    prompt += `Clean layout with barcode area. `;
  } else if (coverType === "full-wrap") {
    prompt += `Complete book wraparound cover (front, spine, and back). `;
    prompt += `Title "${title}" on front and spine. `;
  }

  // Add genre elements
  prompt += `Incorporating ${genreKeywords.slice(0, 3).join(", ")} elements. `;

  // Add style specifics
  switch (style) {
    case "minimalist":
      prompt += `Clean, simple design with lots of negative space. Minimal elements. `;
      break;
    case "illustrated":
      prompt += `Hand-drawn or digitally illustrated artwork. Artistic and detailed. `;
      break;
    case "photographic":
      prompt += `High-quality photographic imagery. Realistic and cinematic. `;
      break;
    case "typographic":
      prompt += `Typography-focused design. Bold, creative text treatment as main element. `;
      break;
    case "abstract":
      prompt += `Abstract shapes and patterns. Modern and artistic interpretation. `;
      break;
    case "vintage":
      prompt += `Vintage or retro aesthetic. Classic design elements. `;
      break;
    case "modern":
      prompt += `Contemporary and sleek design. Current trends. `;
      break;
    case "bold":
      prompt += `Strong, impactful design. High contrast and dramatic. `;
      break;
    case "elegant":
      prompt += `Sophisticated and refined. Graceful composition. `;
      break;
  }

  // Add colors
  if (colorList.length > 0) {
    prompt += `Color palette: ${colorList.join(", ")}. `;
  }

  // Add mood
  if (mood) {
    prompt += `Overall mood: ${mood}. `;
  }

  // Add professional requirements
  prompt += `Professional quality, suitable for print. High-resolution, balanced composition. `;
  prompt += `Cover should be visually appealing and genre-appropriate.`;

  return prompt;
}

async function generateImageWithDallE(
  openai: OpenAI,
  prompt: string,
  quality: "standard" | "hd",
  dimensions: DimensionSpec
): Promise<string> {
  log(`Generating image with DALL-E 3...`, "debug");
  log(`Prompt: ${prompt.substring(0, 100)}...`, "debug");

  try {
    // DALL-E 3 only supports 1024x1024, 1024x1792, or 1792x1024
    // We'll request the appropriate size and note that post-processing would be needed
    const aspectRatio = dimensions.width / dimensions.height;
    let size: "1024x1024" | "1024x1792" | "1792x1024" = "1024x1792";

    if (Math.abs(aspectRatio - 1) < 0.1) {
      size = "1024x1024"; // Square
    } else if (aspectRatio > 1) {
      size = "1792x1024"; // Landscape
    } else {
      size = "1024x1792"; // Portrait
    }

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: size,
      quality: quality,
      style: "vivid",
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL returned from DALL-E");
    }

    log(`Image generated successfully`, "success");
    return imageUrl;
  } catch (error) {
    log(`Failed to generate image: ${error}`, "error");
    throw error;
  }
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  log(`Downloading image...`, "debug");
  log(`URL: ${url.substring(0, 50)}...`, "debug");
  log(`Output: ${outputPath}`, "debug");

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await writeFile(outputPath, buffer);
    log(`Image saved successfully`, "success");
  } catch (error) {
    log(`Failed to download image: ${error}`, "error");
    throw error;
  }
}

async function generateCover(
  openai: OpenAI,
  options: BookCoverOptions,
  coverType: "front" | "spine" | "back" | "full-wrap",
  outputDir: string,
  filePrefix: string
): Promise<GeneratedCover> {
  const prompt = generatePrompt(options, coverType);
  const dimensions = DIMENSIONS[options.dimensions];

  const imageUrl = await generateImageWithDallE(openai, prompt, options.quality, dimensions);

  const ext = options.format === "jpg" ? "jpg" : "png";
  const filename = `${filePrefix}-${coverType}.${ext}`;
  const filepath = join(outputDir, filename);

  await downloadImage(imageUrl, filepath);

  return {
    type: coverType,
    filename,
    url: imageUrl,
    prompt,
  };
}

async function generateMockup(
  openai: OpenAI,
  options: BookCoverOptions,
  frontCoverPath: string,
  outputDir: string,
  filePrefix: string
): Promise<GeneratedCover> {
  log(`Generating 3D book mockup...`, "info");

  const prompt = `3D realistic book mockup, ${options.dimensions} book standing upright at a slight angle,
    professional photography, clean white background, soft shadows, studio lighting,
    photorealistic rendering, high quality product photography`;

  const dimensions = { format: "mockup", width: 2048, height: 2048, dpi: 300 };

  const imageUrl = await generateImageWithDallE(openai, prompt, "hd", dimensions);

  const ext = options.format === "jpg" ? "jpg" : "png";
  const filename = `${filePrefix}-mockup.${ext}`;
  const filepath = join(outputDir, filename);

  await downloadImage(imageUrl, filepath);

  return {
    type: "mockup",
    filename,
    url: imageUrl,
    prompt,
  };
}

async function saveMetadata(
  options: BookCoverOptions,
  generatedCovers: GeneratedCover[],
  outputDir: string
): Promise<void> {
  const metadata: CoverMetadata = {
    title: options.title,
    author: options.author,
    genre: options.genre,
    style: options.style,
    dimensions: DIMENSIONS[options.dimensions],
    colors: options.colors ? parseColorInput(options.colors) : undefined,
    mood: options.mood,
    generatedAt: new Date().toISOString(),
    aiPrompt: generatedCovers[0]?.prompt || "",
    files: {},
  };

  for (const cover of generatedCovers) {
    metadata.files[cover.type === "full-wrap" ? "fullWrap" : cover.type] = cover.filename;
  }

  const metadataPath = join(outputDir, "metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  log(`Metadata saved to ${metadataPath}`, "success");
}

async function generateReadme(outputDir: string): Promise<void> {
  const readme = `# Generated Book Covers

This directory contains AI-generated book covers created with the generate-book-cover skill.

## Using Your Covers

### For Digital Publishing (Ebook)
- Use the \`*-front.png\` file
- Upload to Amazon KDP, Draft2Digital, or other platforms
- Recommended: 1600x2400px for ebooks

### For Print Publishing
- Use the \`*-full-wrap.png\` file if available (includes front, spine, and back)
- Or use individual \`*-front.png\`, \`*-spine.png\`, \`*-back.png\` files
- Ensure 300 DPI resolution for professional printing
- Convert RGB to CMYK before sending to printer

### For Marketing
- Use the \`*-mockup.png\` file for promotional materials
- Share on social media, websites, and advertising

## File Formats

- **PNG**: Lossless format, best for editing and archiving
- **JPG**: Smaller file size, suitable for web use

## Next Steps

1. Review the generated covers in this directory
2. Edit text overlays if needed (use Photoshop, GIMP, or Canva)
3. Convert to CMYK for print (use Adobe Photoshop or online tools)
4. Upload to your publishing platform

## Metadata

Each cover includes a \`metadata.json\` file with:
- Book title and author
- Genre and style used
- Dimensions and specifications
- Color palette
- AI prompt used for generation

## Need Help?

- Regenerate with different options: \`skills run generate-book-cover --help\`
- Visit: https://skills.md/docs/generate-book-cover
- Support: support@skills.md
`;

  const readmePath = join(outputDir, "README.md");
  await writeFile(readmePath, readme);

  log(`README saved to ${readmePath}`, "success");
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");

  // Parse command-line arguments
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      genre: { type: "string", default: "fiction" },
      author: { type: "string" },
      subtitle: { type: "string" },
      tagline: { type: "string" },
      series: { type: "string" },
      style: { type: "string", default: "modern" },
      dimensions: { type: "string", default: "paperback" },
      colors: { type: "string" },
      "font-style": { type: "string", default: "serif" },
      "include-spine": { type: "boolean", default: false },
      "include-back": { type: "boolean", default: false },
      "full-wrap": { type: "boolean", default: false },
      "spine-width": { type: "string" },
      "page-count": { type: "string", default: "200" },
      variations: { type: "string", default: "1" },
      styles: { type: "string" },
      quality: { type: "string", default: "hd" },
      "aspect-focus": { type: "string", default: "center" },
      mood: { type: "string" },
      output: { type: "string" },
      format: { type: "string", default: "png" },
      prefix: { type: "string" },
      "include-mockup": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Generate Book Cover - AI-Powered Book Cover Design

Usage:
  skills run generate-book-cover -- "Book Title" [options]

Options:
  --genre <string>       Genre (fiction, non-fiction, sci-fi, etc.) [default: fiction]
  --author <string>      Author name
  --subtitle <string>    Book subtitle
  --style <string>       Visual style (modern, minimalist, etc.) [default: modern]
  --dimensions <string>  Format (paperback, hardcover, ebook) [default: paperback]
  --colors <string>      Color palette
  --output <path>        Output directory
  --help, -h             Show this help
`);
    process.exit(0);
  }

  // Get title from positional argument
  const title = positionals[0];
  if (!title) {
    log("Error: Book title is required", "error");
    console.error("Usage: skills run generate-book-cover -- \"Your Book Title\" [options]");
    process.exit(1);
  }

  // Get OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log("Error: OPENAI_API_KEY environment variable is required", "error");
    console.error("\nSet it with: export OPENAI_API_KEY='sk-...'");
    process.exit(1);
  }

  // Initialize OpenAI client
  const openai = new OpenAI({ apiKey });

  // Parse options
  const options: BookCoverOptions = {
    title,
    genre: values.genre as string,
    author: values.author as string | undefined,
    subtitle: values.subtitle as string | undefined,
    tagline: values.tagline as string | undefined,
    series: values.series as string | undefined,
    style: values.style as string,
    dimensions: values.dimensions as string,
    colors: values.colors as string | undefined,
    fontStyle: values["font-style"] as string,
    includeSpine: values["include-spine"] as boolean,
    includeBack: values["include-back"] as boolean,
    fullWrap: values["full-wrap"] as boolean,
    spineWidth: values["spine-width"] ? parseFloat(values["spine-width"] as string) : undefined,
    pageCount: parseInt(values["page-count"] as string),
    variations: parseInt(values.variations as string),
    styles: values.styles ? (values.styles as string).split(",").map(s => s.trim()) : undefined,
    quality: (values.quality as "standard" | "hd") || "hd",
    aspectFocus: values["aspect-focus"] as string,
    mood: values.mood as string | undefined,
    output: values.output as string || process.env.SKILLS_OUTPUT_DIR || ".skills/exports/generate-book-cover",
    format: (values.format as "png" | "jpg" | "both") || "png",
    prefix: values.prefix as string | undefined,
    includeMockup: values["include-mockup"] as boolean,
  };

  // Validate dimensions
  if (!DIMENSIONS[options.dimensions]) {
    log(`Error: Invalid dimensions "${options.dimensions}"`, "error");
    console.error(`Valid options: ${Object.keys(DIMENSIONS).join(", ")}`);
    process.exit(1);
  }

  // Calculate spine width if needed
  if (options.includeSpine && !options.spineWidth) {
    options.spineWidth = calculateSpineWidth(options.pageCount);
  }

  // Create output directory
  const filePrefix = options.prefix || slugify(title);
  const outputDir = join(options.output, filePrefix);
  await mkdir(outputDir, { recursive: true });

  log("Configuration:", "info");
  log(`   Title: ${options.title}`, "info");
  log(`   Genre: ${options.genre}`, "info");
  log(`   Style: ${options.style}`, "info");
  log(`   Output: ${outputDir}`, "info");

  // Generate covers
  const generatedCovers: GeneratedCover[] = [];

  try {
    // Generate variations if requested
    const stylesToGenerate = options.styles || [options.style];
    const numVariations = Math.min(options.variations, stylesToGenerate.length);

    for (let i = 0; i < numVariations; i++) {
      const variantStyle = stylesToGenerate[i] || options.style;
      const variantOptions = { ...options, style: variantStyle };
      const variantPrefix = numVariations > 1 ? `${filePrefix}-${i + 1}` : filePrefix;

      log(`Generating variation ${i + 1} of ${numVariations} (${variantStyle} style)`, "info");

      // Generate front cover (always)
      const frontCover = await generateCover(openai, variantOptions, "front", outputDir, variantPrefix);
      generatedCovers.push(frontCover);

      // Generate spine if requested
      if (options.includeSpine) {
        const spineCover = await generateCover(openai, variantOptions, "spine", outputDir, variantPrefix);
        generatedCovers.push(spineCover);
      }

      // Generate back cover if requested
      if (options.includeBack) {
        const backCover = await generateCover(openai, variantOptions, "back", outputDir, variantPrefix);
        generatedCovers.push(backCover);
      }

      // Generate full wrap if requested
      if (options.fullWrap) {
        const fullWrapCover = await generateCover(openai, variantOptions, "full-wrap", outputDir, variantPrefix);
        generatedCovers.push(fullWrapCover);
      }

      // Generate mockup if requested
      if (options.includeMockup) {
        const mockup = await generateMockup(openai, variantOptions, frontCover.filename, outputDir, variantPrefix);
        generatedCovers.push(mockup);
      }

      // Save metadata for this variation
      await saveMetadata(variantOptions, generatedCovers, outputDir);
    }

    // Generate README
    await generateReadme(outputDir);

    // Success summary
    log("Book cover generation complete!", "success");
    console.log(`\n📁 Output directory: ${outputDir}`);
    console.log(`\n📊 Generated files:`);
    for (const cover of generatedCovers) {
      console.log(`   - ${cover.filename} (${cover.type})`);
    }

  } catch (error) {
    log(`Error generating book cover: ${error}`, "error");
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
