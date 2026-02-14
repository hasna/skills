#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Constants
const SKILL_NAME = "skill-ad-creative-generator";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface Platform {
  name: string;
  displayName: string;
  formats: AdFormat[];
  charLimits: { headline: number; body: number; description: number };
}

interface AdFormat {
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
}

interface AdCreative {
  platform: string;
  format: string;
  variant: number;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  hashtags: string[];
  imagePath?: string;
  imagePrompt?: string;
}

interface Options {
  product: string;
  platforms: string[];
  brand: string;
  variants: number;
  audience: string;
  cta: string;
  tone: string;
  format: string;
  noImages: boolean;
  verbose: boolean;
}

// Platform configurations
const PLATFORMS: Record<string, Platform> = {
  facebook: {
    name: "facebook",
    displayName: "Facebook",
    formats: [
      { name: "Feed", width: 1200, height: 628, aspectRatio: "1.91:1" },
      { name: "Stories", width: 1080, height: 1920, aspectRatio: "9:16" },
    ],
    charLimits: { headline: 40, body: 125, description: 30 },
  },
  instagram: {
    name: "instagram",
    displayName: "Instagram",
    formats: [
      { name: "Feed", width: 1080, height: 1080, aspectRatio: "1:1" },
      { name: "Stories", width: 1080, height: 1920, aspectRatio: "9:16" },
    ],
    charLimits: { headline: 40, body: 2200, description: 0 },
  },
  google: {
    name: "google",
    displayName: "Google Ads",
    formats: [{ name: "Responsive Display", width: 1200, height: 628, aspectRatio: "1.91:1" }],
    charLimits: { headline: 30, body: 90, description: 90 },
  },
  linkedin: {
    name: "linkedin",
    displayName: "LinkedIn",
    formats: [{ name: "Sponsored Content", width: 1200, height: 627, aspectRatio: "1.91:1" }],
    charLimits: { headline: 70, body: 150, description: 100 },
  },
  tiktok: {
    name: "tiktok",
    displayName: "TikTok",
    formats: [{ name: "In-Feed", width: 1080, height: 1920, aspectRatio: "9:16" }],
    charLimits: { headline: 0, body: 100, description: 0 },
  },
};

// Utility functions
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  const timestamp = new Date().toISOString();
  ensureDir(LOGS_DIR);
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  appendFileSync(logFile, `[${timestamp}] [${level.toUpperCase()}] ${message}\n`);
  
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
      platforms: { type: "string", default: "facebook,instagram,google,linkedin" },
      brand: { type: "string", default: "neutral" },
      variants: { type: "string", default: "2" },
      audience: { type: "string", default: "general" },
      cta: { type: "string", default: "auto" },
      tone: { type: "string", default: "professional" },
      format: { type: "string", default: "markdown" },
      "no-images": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const product = positionals.join(" ");
  
  return {
    product,
    platforms: (values.platforms as string).split(",").map((p) => p.trim().toLowerCase()),
    brand: values.brand as string,
    variants: parseInt(values.variants as string, 10),
    audience: values.audience as string,
    cta: values.cta as string,
    tone: values.tone as string,
    format: values.format as string,
    noImages: values["no-images"] as boolean,
    verbose: values.verbose as boolean,
  };
}

function printHelp(): void {
  console.log(`
Ad Creative Generator - Generate ad copy and visuals for multiple platforms

Usage:
  skills run ad-creative-generator -- "<product description>" [options]

Options:
  --platforms <list>   Target platforms (comma-separated): facebook,instagram,google,linkedin,tiktok
  --brand <desc>       Brand voice description
  --variants <n>       Number of copy variants per platform (default: 2)
  --audience <desc>    Target audience description
  --cta <text>         Preferred call-to-action
  --tone <tone>        Tone: professional, casual, urgent, playful
  --format <format>    Output format: markdown, json
  --no-images          Skip image generation
  --verbose            Show detailed progress
  --help, -h           Show this help

Examples:
  skills run ad-creative-generator -- "Premium yoga mats made from eco-friendly materials"
  skills run ad-creative-generator -- "SaaS project management tool" --platforms facebook,linkedin --variants 3
`);
}

async function generateAdCopy(options: Options): Promise<AdCreative[]> {
  const systemPrompt = `You are an expert advertising copywriter. Generate compelling ad copy for multiple platforms.
Brand voice: ${options.brand}
Target audience: ${options.audience}
Tone: ${options.tone}

For each platform, create copy that:
1. Hooks attention in the first line
2. Highlights key benefits
3. Includes a clear call-to-action
4. Respects platform-specific character limits
5. Uses platform-appropriate language and hashtags`;

  const platformDetails = options.platforms
    .filter((p) => PLATFORMS[p])
    .map((p) => {
      const platform = PLATFORMS[p];
      return `${platform.displayName}: headline ${platform.charLimits.headline} chars, body ${platform.charLimits.body} chars`;
    })
    .join("\n");

  const userPrompt = `Create ${options.variants} ad variants for each platform for this product/service:

"${options.product}"

Platforms and character limits:
${platformDetails}

${options.cta !== "auto" ? `Preferred CTA: ${options.cta}` : "Choose appropriate CTAs"}

Return JSON array with this structure:
[{
  "platform": "platform_name",
  "variant": 1,
  "headline": "...",
  "primaryText": "...",
  "description": "...",
  "cta": "...",
  "hashtags": ["...", "..."],
  "imagePrompt": "DALL-E prompt for ad visual"
}]

Generate ${options.variants} variants for each of these platforms: ${options.platforms.join(", ")}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  let content = result.choices[0]?.message?.content || "[]";

  // Parse JSON from response
  if (content.includes("```json")) {
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  }

  try {
    return JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Failed to parse OpenAI response: ${content.substring(0, 100)}...`);
  }
}

async function generateImage(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "dall-e-3", // Updated to dall-e-3 as gpt-image-1.5 is not standard
      prompt: `Professional advertising visual: ${prompt}. High quality, commercial photography style, clean composition, suitable for digital advertising.`,
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

function formatAsMarkdown(creatives: AdCreative[], options: Options): string {
  let output = `# Ad Creative Campaign\n\n`;
  output += `**Product:** ${options.product}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n`;
  output += `**Platforms:** ${options.platforms.join(", ")}\n`;
  output += `**Variants per platform:** ${options.variants}\n\n`;
  output += `---\n\n`;

  const grouped: Record<string, AdCreative[]> = {};
  for (const creative of creatives) {
    if (!grouped[creative.platform]) grouped[creative.platform] = [];
    grouped[creative.platform].push(creative);
  }

  for (const [platform, ads] of Object.entries(grouped)) {
    const platformConfig = PLATFORMS[platform];
    output += `## ${platformConfig?.displayName || platform}\n\n`;

    for (const ad of ads) {
      output += `### Variant ${ad.variant}\n\n`;
      if (ad.headline) output += `**Headline:** ${ad.headline}\n\n`;
      output += `**Primary Text:**\n${ad.primaryText}\n\n`;
      if (ad.description) output += `**Description:** ${ad.description}\n\n`;
      output += `**CTA:** ${ad.cta}\n\n`;
      if (ad.hashtags && ad.hashtags.length > 0) {
        output += `**Hashtags:** ${ad.hashtags.join(" ")}\n\n`;
      }
      if (ad.imagePath) {
        output += `**Image:** ${ad.imagePath}\n\n`;
      }
      output += `---\n\n`;
    }
  }

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

  if (!options.product) {
    log("Error: Please provide a product/service description.", "error");
    console.log('Example: skills run ad-creative-generator -- "Your product description"');
    process.exit(1);
  }

  if (options.verbose) {
    log(`Options: ${JSON.stringify(options)}`);
  }

  ensureDir(EXPORTS_DIR);

  try {
    log("Generating ad copy for all platforms...");
    const creatives = await generateAdCopy(options);
    log(`Generated ${creatives.length} ad variants`, "success");

    if (!options.noImages) {
      log("Generating images...");
      for (let i = 0; i < creatives.length; i++) {
        const creative = creatives[i];
        if (creative.imagePrompt) {
          try {
            const filename = `${creative.platform}-v${creative.variant}-${SESSION_ID}.png`;
            log(`Generating image for ${creative.platform} variant ${creative.variant}...`);
            creative.imagePath = await generateImage(creative.imagePrompt, filename);
            log(`Image saved: ${filename}`, "success");
          } catch (err) {
            log(`Failed to generate image: ${err}`, "error");
          }
        }
      }
    }

    // Format and save output
    let output: string;
    let extension: string;

    if (options.format === "json") {
      output = JSON.stringify(creatives, null, 2);
      extension = "json";
    } else {
      output = formatAsMarkdown(creatives, options);
      extension = "md";
    }

    const outputFile = join(EXPORTS_DIR, `ad-creatives.${extension}`);
    writeFileSync(outputFile, output, "utf-8");
    log(`Output saved to: ${outputFile}`, "success");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    const duration = Date.now() - startTime;
    log(`Completed in ${duration}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
