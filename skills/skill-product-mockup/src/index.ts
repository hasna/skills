#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-product-mockup";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface MockupResult {
  style: string;
  scene: string;
  angle: string;
  lighting: string;
  filename: string;
  prompt: string;
}

interface Options {
  product: string;
  style: string;
  scene: string;
  background: string;
  variations: number;
  angle: string;
  lighting: string;
  season: string;
  size: string;
  format: string;
  verbose: boolean;
}

// Style configurations
const STYLES: Record<string, string> = {
  lifestyle: "product in real-world lifestyle setting, natural environment, authentic usage context",
  minimal: "product on clean white background, studio lighting, e-commerce ready, pure and simple",
  flatlay: "top-down flat lay photography, organized arrangement, styled composition",
  inuse: "product being used by person, demonstration shot, action context",
  seasonal: "seasonal themed setting, holiday or season-specific decoration and props",
  premium: "luxury aesthetic, high-end styling, premium materials and backdrop",
};

const SCENES: Record<string, string> = {
  office: "modern office desk with laptop, coffee cup, plants, natural light from window",
  kitchen: "clean marble kitchen counter, cooking ingredients, warm home atmosphere",
  outdoor: "natural outdoor setting, grass, trees, golden hour sunlight",
  gym: "fitness studio environment, workout equipment, energetic atmosphere",
  travel: "travel adventure context, suitcase, passport, world map background",
  cozy: "cozy home environment, soft blankets, warm lighting, comfortable setting",
  urban: "urban city street style, concrete, graffiti, modern architecture",
  nature: "natural elements, wood texture, green plants, stone, organic materials",
};

const ANGLES: Record<string, string> = {
  front: "front-facing straight-on view",
  side: "side profile view, 90-degree angle",
  top: "top-down bird's eye view",
  "3/4": "three-quarter angle view, dynamic perspective",
  hero: "hero shot, dramatic angle, showcasing product at its best",
};

// Utilities
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  const timestamp = new Date().toISOString();
  ensureDir(LOGS_DIR);
  appendFileSync(join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`), `[${timestamp}] [${level.toUpperCase()}] ${message}\n`);
  console.log(`[${level.toUpperCase()}] ${message}`);
}

function parseArguments(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    product: "",
    style: "lifestyle",
    scene: "auto",
    background: "contextual",
    variations: 1,
    angle: "hero",
    lighting: "natural",
    season: "none",
    size: "square",
    format: "images",
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--style": options.style = args[++i]; break;
      case "--scene": options.scene = args[++i]; break;
      case "--background": options.background = args[++i]; break;
      case "--variations": options.variations = parseInt(args[++i], 10); break;
      case "--angle": options.angle = args[++i]; break;
      case "--lighting": options.lighting = args[++i]; break;
      case "--season": options.season = args[++i]; break;
      case "--size": options.size = args[++i]; break;
      case "--format": options.format = args[++i]; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.product) options.product = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Product Mockup Generator - AI-powered product photography

Usage:
  skills run product-mockup -- "<product description>" [options]

Options:
  --style <style>       Style: lifestyle, minimal, flatlay, inuse, seasonal, premium
  --scene <scene>       Scene: office, kitchen, outdoor, gym, travel, cozy, urban, nature
  --background <bg>     Background color or description
  --variations <n>      Number of image variations (default: 1)
  --angle <angle>       Angle: front, side, top, 3/4, hero
  --lighting <type>     Lighting: natural, studio, dramatic, soft
  --season <season>     Season theme: spring, summer, fall, winter, holiday
  --size <size>         Size: square, portrait, landscape, story
  --verbose             Show detailed progress

Examples:
  skills run product-mockup -- "Stainless steel water bottle, matte black, 32oz"
  skills run product-mockup -- "Leather laptop bag" --style lifestyle --scene office
  skills run product-mockup -- "Organic face cream" --style premium --variations 3
`);
}

function buildPrompt(options: Options, variation: number): string {
  const styleDesc = STYLES[options.style] || options.style;
  const sceneDesc = options.scene !== "auto" ? (SCENES[options.scene] || options.scene) : "";
  const angleDesc = ANGLES[options.angle] || options.angle;

  let prompt = `Professional product photography of ${options.product}. `;
  prompt += `${styleDesc}. `;
  if (sceneDesc) prompt += `Setting: ${sceneDesc}. `;
  prompt += `Camera angle: ${angleDesc}. `;
  prompt += `Lighting: ${options.lighting} lighting. `;

  if (options.season !== "none") {
    prompt += `Seasonal theme: ${options.season}. `;
  }

  if (options.background !== "contextual") {
    prompt += `Background: ${options.background}. `;
  }

  prompt += "High-resolution, commercial quality, sharp focus on product, professional color grading.";

  // Add variation hint
  if (variation > 0) {
    const variationHints = ["slightly different angle", "alternative composition", "different prop arrangement", "varied lighting mood"];
    prompt += ` Variation: ${variationHints[variation % variationHints.length]}.`;
  }

  return prompt;
}

async function generateMockup(prompt: string, filename: string, size: string): Promise<string> {
  const sizeMap: Record<string, string> = {
    square: "1024x1024",
    portrait: "1024x1536",
    landscape: "1536x1024",
    story: "1024x1536",
  };

  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      n: 1,
      size: sizeMap[size] || "1024x1024",
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

function formatOutput(results: MockupResult[], options: Options): string {
  let output = `# Product Mockup: ${options.product}\n\n`;
  output += `**Generated:** ${new Date().toISOString()}\n`;
  output += `**Style:** ${options.style}\n`;
  output += `**Variations:** ${options.variations}\n\n---\n\n`;
  output += `## Generated Images\n\n`;

  for (const result of results) {
    output += `### ${result.style.charAt(0).toUpperCase() + result.style.slice(1)} Shot\n`;
    output += `**File:** ${result.filename}\n`;
    output += `**Scene:** ${result.scene}\n`;
    output += `**Angle:** ${result.angle}\n`;
    output += `**Lighting:** ${result.lighting}\n\n`;
  }

  output += `---\n\n**Export Directory:** ${EXPORTS_DIR}\n`;
  output += `**Total Images:** ${results.length}\n`;

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
  if (!options.product) {
    console.error("Error: Please provide a product description.");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    const results: MockupResult[] = [];

    for (let i = 0; i < options.variations; i++) {
      const prompt = buildPrompt(options, i);
      const filename = `mockup-${options.style}-${i + 1}-${SESSION_ID}.png`;

      log(`Generating mockup ${i + 1}/${options.variations}...`);
      if (options.verbose) log(`Prompt: ${prompt}`);

      await generateMockup(prompt, filename, options.size);

      results.push({
        style: options.style,
        scene: options.scene,
        angle: options.angle,
        lighting: options.lighting,
        filename,
        prompt,
      });

      log(`Saved: ${filename}`, "success");
    }

    const output = formatOutput(results, options);
    const outputFile = join(EXPORTS_DIR, "mockup-summary.md");
    writeFileSync(outputFile, output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
