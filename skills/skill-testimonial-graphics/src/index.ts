#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-testimonial-graphics";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface Testimonial {
  text: string;
  author: string;
  title?: string;
  rating?: number;
  photo?: string;
}

interface GeneratedGraphic {
  testimonial: Testimonial;
  platform: string;
  filename: string;
  size: string;
}

interface Options {
  text: string;
  author: string;
  title: string;
  rating: number;
  style: string;
  brandColor: string;
  accentColor: string;
  platform: string;
  file: string;
  batch: boolean;
  format: string;
  verbose: boolean;
}

// Style configs
const STYLES: Record<string, string> = {
  minimal: "clean minimalist design with lots of white space, subtle typography, modern sans-serif font",
  bold: "bold high-contrast design with strong colors, large quotation marks, impactful typography",
  elegant: "sophisticated elegant design with serif fonts, subtle gradients, premium feel",
  playful: "fun colorful design with rounded shapes, friendly fonts, vibrant colors",
  corporate: "professional corporate design with clean lines, trustworthy blue tones, business appropriate",
  gradient: "modern gradient background design with contemporary feel, smooth color transitions",
};

// Platform sizes
const PLATFORMS: Record<string, { width: number; height: number; name: string }> = {
  instagram: { width: 1080, height: 1080, name: "Instagram Feed" },
  story: { width: 1080, height: 1920, name: "Instagram Story" },
  facebook: { width: 1200, height: 628, name: "Facebook" },
  twitter: { width: 1200, height: 675, name: "Twitter" },
  linkedin: { width: 1200, height: 627, name: "LinkedIn" },
  pinterest: { width: 1000, height: 1500, name: "Pinterest" },
  website: { width: 800, height: 400, name: "Website" },
};

// Utilities
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  ensureDir(LOGS_DIR);
  appendFileSync(join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`), `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`);
  console.log(`[${level.toUpperCase()}] ${message}`);
}

function parseArguments(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    text: "",
    author: "Anonymous",
    title: "",
    rating: 0,
    style: "minimal",
    brandColor: "#000000",
    accentColor: "auto",
    platform: "instagram",
    file: "",
    batch: false,
    format: "png",
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--author": options.author = args[++i]; break;
      case "--title": options.title = args[++i]; break;
      case "--rating": options.rating = parseInt(args[++i], 10); break;
      case "--style": options.style = args[++i]; break;
      case "--brand-color": options.brandColor = args[++i]; break;
      case "--accent-color": options.accentColor = args[++i]; break;
      case "--platform": options.platform = args[++i]; break;
      case "--file": options.file = args[++i]; break;
      case "--batch": options.batch = true; break;
      case "--format": options.format = args[++i]; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.text) options.text = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Testimonial Graphics - Transform reviews into shareable graphics

Usage:
  skills run testimonial-graphics -- "<testimonial text>" [options]

Options:
  --author <name>       Customer name
  --title <title>       Customer title/company
  --rating <1-5>        Star rating
  --style <style>       Style: minimal, bold, elegant, playful, corporate, gradient
  --brand-color <hex>   Primary color
  --platform <platform> Platform: instagram, story, facebook, twitter, linkedin, pinterest, website
  --file <path>         JSON file with multiple testimonials
  --batch               Process multiple testimonials
  --format <fmt>        Output: png, jpg
  --verbose             Show detailed progress

Examples:
  skills run testimonial-graphics -- "Amazing product!" --author "Sarah M." --rating 5
  skills run testimonial-graphics -- "Best purchase ever" --style elegant --platform instagram
`);
}

function buildPrompt(testimonial: Testimonial, options: Options, platform: string): string {
  const platformConfig = PLATFORMS[platform];
  const styleDesc = STYLES[options.style] || STYLES.minimal;

  let prompt = `Professional testimonial quote card graphic design. `;
  prompt += `${styleDesc}. `;
  prompt += `Aspect ratio optimized for ${platformConfig.name}. `;
  prompt += `Large decorative quotation marks. `;
  prompt += `Quote text: "${testimonial.text.substring(0, 100)}${testimonial.text.length > 100 ? "..." : ""}". `;
  prompt += `Attribution: "${testimonial.author}"`;
  if (testimonial.title) prompt += `, "${testimonial.title}"`;
  prompt += `. `;

  if (testimonial.rating && testimonial.rating > 0) {
    prompt += `${testimonial.rating} star rating visual. `;
  }

  if (options.brandColor !== "#000000") {
    prompt += `Brand color: ${options.brandColor}. `;
  }

  prompt += "Clean professional design, readable text, social media ready, no placeholder elements.";

  return prompt;
}

async function generateGraphic(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "high",
      output_format: "png",
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

function loadTestimonialsFromFile(filepath: string): Testimonial[] {
  const content = readFileSync(filepath, "utf-8");
  const data = JSON.parse(content);
  return data.testimonials || [data];
}

function formatOutput(graphics: GeneratedGraphic[], options: Options): string {
  let output = `# Testimonial Graphics\n\n`;
  output += `**Style:** ${options.style}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;
  output += `## Generated Graphics\n\n`;

  for (let i = 0; i < graphics.length; i++) {
    const g = graphics[i];
    output += `### Testimonial ${i + 1}\n`;
    output += `**Quote:** "${g.testimonial.text}"\n`;
    output += `**Author:** ${g.testimonial.author}`;
    if (g.testimonial.title) output += `, ${g.testimonial.title}`;
    output += `\n`;
    if (g.testimonial.rating) output += `**Rating:** ${"★".repeat(g.testimonial.rating)}${"☆".repeat(5 - g.testimonial.rating)}\n`;
    output += `**Platform:** ${g.platform}\n`;
    output += `**File:** ${g.filename}\n\n`;
  }

  output += `---\n\n**Export Directory:** ${EXPORTS_DIR}\n`;
  output += `**Total Graphics:** ${graphics.length}\n`;

  return output;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  if (!OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const options = parseArguments();

  // Load testimonials
  let testimonials: Testimonial[] = [];

  if (options.file) {
    testimonials = loadTestimonialsFromFile(options.file);
  } else if (options.text) {
    testimonials = [{
      text: options.text,
      author: options.author,
      title: options.title || undefined,
      rating: options.rating || undefined,
    }];
  } else {
    console.error("Error: Please provide testimonial text or a file with testimonials.");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    const graphics: GeneratedGraphic[] = [];
    const platforms = options.platform === "all" ? Object.keys(PLATFORMS) : [options.platform];

    let total = testimonials.length * platforms.length;
    let completed = 0;

    for (let t = 0; t < testimonials.length; t++) {
      const testimonial = testimonials[t];

      for (const platform of platforms) {
        completed++;
        log(`Generating graphic ${completed}/${total}: testimonial ${t + 1}, ${platform}...`);

        const prompt = buildPrompt(testimonial, options, platform);
        const filename = `testimonial-${t + 1}-${platform}.${options.format}`;

        try {
          await generateGraphic(prompt, filename);
          graphics.push({ testimonial, platform, filename, size: `${PLATFORMS[platform].width}x${PLATFORMS[platform].height}` });
          log(`Saved: ${filename}`, "success");
        } catch (err) {
          log(`Failed to generate: ${err}`, "error");
        }
      }
    }

    const output = formatOutput(graphics, options);
    writeFileSync(join(EXPORTS_DIR, "testimonials-summary.md"), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
