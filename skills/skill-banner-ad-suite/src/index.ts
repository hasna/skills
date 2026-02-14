#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Constants
const SKILL_NAME = "skill-banner-ad-suite";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface BannerSize {
  name: string;
  width: number;
  height: number;
  popular: boolean;
}

interface GeneratedBanner {
  size: string;
  dimensions: string;
  variant: string;
  filename: string;
  prompt: string;
}

interface Options {
  message: string;
  sizes: string[];
  variants: number;
  brandColor: string;
  accent: string;
  cta: string;
  style: string;
  format: string;
  verbose: boolean;
}

// IAB Standard Banner Sizes
const BANNER_SIZES: Record<string, BannerSize> = {
  "300x250": { name: "Medium Rectangle", width: 300, height: 250, popular: true },
  "728x90": { name: "Leaderboard", width: 728, height: 90, popular: true },
  "160x600": { name: "Wide Skyscraper", width: 160, height: 600, popular: true },
  "320x50": { name: "Mobile Leaderboard", width: 320, height: 50, popular: true },
  "300x600": { name: "Half Page", width: 300, height: 600, popular: true },
  "336x280": { name: "Large Rectangle", width: 336, height: 280, popular: false },
  "970x250": { name: "Billboard", width: 970, height: 250, popular: false },
  "970x90": { name: "Large Leaderboard", width: 970, height: 90, popular: false },
  "320x100": { name: "Large Mobile Banner", width: 320, height: 100, popular: false },
  "250x250": { name: "Square", width: 250, height: 250, popular: false },
  "200x200": { name: "Small Square", width: 200, height: 200, popular: false },
  "468x60": { name: "Banner", width: 468, height: 60, popular: false },
  "120x600": { name: "Skyscraper", width: 120, height: 600, popular: false },
};

// Utilities
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  ensureDir(LOGS_DIR);
  appendFileSync(join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`), `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`);
  
  const prefixes = { 
    info: "ℹ️ ", 
    error: "❌ ", 
    success: "✅ " 
  };

  if (level === "error") {
    console.error(`${prefixes[level]} ${message}`);
  } else {
    console.log(`${prefixes[level]} ${message}`);
  }
}

function parseArguments(): Options {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      sizes: { type: "string", default: "popular" },
      variants: { type: "string", default: "1" },
      "brand-color": { type: "string", default: "auto" },
      accent: { type: "string", default: "auto" },
      cta: { type: "string", default: "auto" },
      style: { type: "string", default: "modern" },
      format: { type: "string", default: "png" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const message = positionals.join(" ");
  
  let sizes = (values.sizes as string).split(",").map(s => s.trim());
  if (sizes.includes("popular")) {
    sizes = Object.entries(BANNER_SIZES)
      .filter(([, config]) => config.popular)
      .map(([size]) => size);
  } else if (sizes.includes("all")) {
    sizes = Object.keys(BANNER_SIZES);
  }

  return {
    message,
    sizes,
    variants: parseInt(values.variants as string, 10),
    brandColor: values["brand-color"] as string,
    accent: values.accent as string,
    cta: values.cta as string,
    style: values.style as string,
    format: values.format as string,
    verbose: values.verbose as boolean,
  };
}

function printHelp(): void {
  console.log(`
Banner Ad Suite - Generate display banners in all IAB sizes

Usage:
  skills run banner-ad-suite -- "<ad message>" [options]

Options:
  --sizes <list>        Sizes: popular, all, or comma-separated (300x250,728x90)
  --variants <n>        Number of design variants (default: 1)
  --brand-color <hex>   Primary brand color
  --accent <hex>        Accent color
  --cta <text>          Call-to-action text
  --style <style>       Style: modern, bold, minimal, playful
  --format <fmt>        Output format: png, jpg, webp
  --verbose             Show detailed progress
  --help, -h            Show this help

Popular sizes: 300x250, 728x90, 160x600, 320x50, 300x600

Examples:
  skills run banner-ad-suite -- "Summer Sale - 50% Off"
  skills run banner-ad-suite -- "Download Our App" --sizes 300x250,728x90 --variants 2
`);
}

function buildPrompt(options: Options, size: BannerSize, variant: number): string {
  const styleDescriptions: Record<string, string> = {
    modern: "clean modern design with subtle gradients and professional typography",
    bold: "bold high-contrast design with strong typography and vibrant colors",
    minimal: "minimalist design with lots of white space and simple elements",
    playful: "fun colorful design with rounded shapes and friendly feel",
  };

  let prompt = `Digital display advertisement banner, ${size.width}x${size.height} pixels aspect ratio. `;
  prompt += `${styleDescriptions[options.style] || styleDescriptions.modern}. `;
  prompt += `Message: "${options.message}". `;

  if (options.brandColor !== "auto") {
    prompt += `Primary color: ${options.brandColor}. `;
  }
  if (options.accent !== "auto") {
    prompt += `Accent color: ${options.accent}. `;
  }
  if (options.cta !== "auto") {
    prompt += `Call-to-action button: "${options.cta}". `;
  }

  prompt += "Professional advertising design, clear visual hierarchy, eye-catching, ";
  prompt += "suitable for Google Display Network, no placeholder text, complete polished design.";

  // Variant differentiation
  const variantHints = ["warm color palette", "cool color palette", "geometric elements", "organic shapes"];
  if (variant > 0) {
    prompt += ` Design variation: ${variantHints[variant % variantHints.length]}.`;
  }

  return prompt;
}

async function generateBanner(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "dall-e-3", // Updated to dall-e-3
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Image generation failed: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const b64Data = result.data[0]?.b64_json;

  if (b64Data) {
    const imageBuffer = Buffer.from(b64Data, "base64");
    const imagePath = join(EXPORTS_DIR, filename);
    writeFileSync(imagePath, imageBuffer);
    return imagePath;
  }
  throw new Error("No image data returned");
}

function formatOutput(banners: GeneratedBanner[], options: Options): string {
  let output = `# Banner Ad Suite\n\n`;
  output += `**Message:** ${options.message}\n`;
  output += `**Style:** ${options.style}\n`;
  output += `**Variants:** ${options.variants}\n`;
  output += `**Total Banners:** ${banners.length}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;

  // Group by variant
  const byVariant: Record<string, GeneratedBanner[]> = {};
  for (const banner of banners) {
    if (!byVariant[banner.variant]) byVariant[banner.variant] = [];
    byVariant[banner.variant].push(banner);
  }

  for (const [variant, variantBanners] of Object.entries(byVariant)) {
    output += `## Variant ${variant}\n\n`;
    output += `| Size | Dimensions | File |\n`;
    output += `|------|------------|------|\n`;
    for (const banner of variantBanners) {
      output += `| ${banner.size} | ${banner.dimensions} | ${banner.filename} |\n`;
    }
    output += `\n`;
  }

  output += `---\n\n**Export Directory:** ${EXPORTS_DIR}\n`;
  output += `\n**Note:** Images are generated at 1024x1024 and should be resized to target dimensions for production use.\n`;

  return output;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  
  // Parse args first to check for help
  const options = parseArguments();

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  if (!OPENAI_API_KEY) {
    log("Error: OPENAI_API_KEY environment variable is required.", "error");
    process.exit(1);
  }

  if (!options.message) {
    log("Error: Please provide an ad message.", "error");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    const banners: GeneratedBanner[] = [];
    const totalBanners = options.sizes.length * options.variants;
    let completed = 0;

    for (let v = 0; v < options.variants; v++) {
      const variantDir = join(EXPORTS_DIR, `variant-${String.fromCharCode(65 + v)}`);
      ensureDir(variantDir);

      for (const sizeKey of options.sizes) {
        const sizeConfig = BANNER_SIZES[sizeKey];
        if (!sizeConfig) {
          log(`Unknown size: ${sizeKey}, skipping`, "error");
          continue;
        }

        completed++;
        log(`Generating banner ${completed}/${totalBanners}: ${sizeKey} variant ${String.fromCharCode(65 + v)}...`);

        const prompt = buildPrompt(options, sizeConfig, v);
        const filename = `banner-${sizeKey}.${options.format}`;
        const filepath = join(variantDir, filename);

        try {
          await generateBanner(prompt, filepath);

          banners.push({
            size: sizeConfig.name,
            dimensions: `${sizeConfig.width}x${sizeConfig.height}`,
            variant: String.fromCharCode(65 + v),
            filename: `variant-${String.fromCharCode(65 + v)}/${filename}`,
            prompt,
          });

          log(`Saved: ${filename}`, "success");
        } catch (err) {
          log(`Failed to generate ${sizeKey}: ${err}`, "error");
        }
      }
    }

    const output = formatOutput(banners, options);
    writeFileSync(join(EXPORTS_DIR, "banner-suite-summary.md"), output, "utf-8");
    writeFileSync(join(EXPORTS_DIR, "manifest.json"), JSON.stringify(banners, null, 2), "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
