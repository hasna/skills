#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-video-thumbnail";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface ThumbnailResult {
  variant: string;
  style: string;
  filename: string;
  prompt: string;
  elements: string[];
}

interface Options {
  title: string;
  style: string;
  variants: number;
  text: string;
  primaryColor: string;
  textColor: string;
  platform: string;
  face: boolean;
  emotion: string;
  noText: boolean;
  format: string;
  verbose: boolean;
}

// Thumbnail styles
const STYLES: Record<string, { description: string; elements: string[] }> = {
  reaction: {
    description: "expressive face with shocked or surprised expression, bold text overlay, bright saturated colors",
    elements: ["expressive face", "bold text", "bright colors", "emotion-driven"],
  },
  "before-after": {
    description: "split screen comparison showing transformation, clear before and after states, arrow or transition element",
    elements: ["split screen", "comparison", "transformation arrow", "contrast"],
  },
  listicle: {
    description: "large bold number as focal point, supporting visual context, clean typography",
    elements: ["big number", "list preview", "organized layout"],
  },
  mystery: {
    description: "intriguing visual with hidden or blurred element, question mark or reveal teaser, curiosity-inducing",
    elements: ["mystery element", "blur/hidden", "question mark", "curiosity hook"],
  },
  tutorial: {
    description: "screenshot or preview of end result, step indicator or progress element, educational feel",
    elements: ["result preview", "step numbers", "how-to feel"],
  },
  minimal: {
    description: "clean simple design with lots of negative space, professional typography, brand-focused",
    elements: ["clean design", "negative space", "professional"],
  },
};

// Emotions for face thumbnails
const EMOTIONS: Record<string, string> = {
  surprised: "eyes wide open, mouth slightly open, raised eyebrows, genuine surprise expression",
  shocked: "extremely surprised expression, jaw dropped, wide eyes, dramatic reaction",
  happy: "big genuine smile, warm friendly expression, approachable",
  excited: "energetic expression, big smile, enthusiastic body language",
  curious: "thoughtful expression, slightly raised eyebrow, engaged look",
  serious: "professional confident expression, direct eye contact, authoritative",
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
    title: "",
    style: "auto",
    variants: 2,
    text: "",
    primaryColor: "auto",
    textColor: "white",
    platform: "youtube",
    face: true,
    emotion: "surprised",
    noText: false,
    format: "png",
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--style": options.style = args[++i]; break;
      case "--variants": options.variants = parseInt(args[++i], 10); break;
      case "--text": options.text = args[++i]; break;
      case "--primary-color": options.primaryColor = args[++i]; break;
      case "--text-color": options.textColor = args[++i]; break;
      case "--platform": options.platform = args[++i]; break;
      case "--face": options.face = true; break;
      case "--no-face": options.face = false; break;
      case "--emotion": options.emotion = args[++i]; break;
      case "--no-text": options.noText = true; break;
      case "--format": options.format = args[++i]; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.title) options.title = arg;
    }
  }

  // Auto-detect style from title
  if (options.style === "auto") {
    const titleLower = options.title.toLowerCase();
    if (/^\d+\s/.test(options.title) || titleLower.includes("top ") || titleLower.includes("best ")) {
      options.style = "listicle";
    } else if (titleLower.includes("before") || titleLower.includes("after") || titleLower.includes("transform")) {
      options.style = "before-after";
    } else if (titleLower.includes("how to") || titleLower.includes("tutorial") || titleLower.includes("learn")) {
      options.style = "tutorial";
    } else if (titleLower.includes("?") || titleLower.includes("secret") || titleLower.includes("reveal")) {
      options.style = "mystery";
    } else {
      options.style = "reaction";
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Video Thumbnail Generator - Create click-worthy YouTube thumbnails

Usage:
  skills run video-thumbnail -- "<video title>" [options]

Options:
  --style <style>       Style: reaction, before-after, listicle, mystery, tutorial, minimal
  --variants <n>        Number of variants (default: 2)
  --text <text>         Custom text overlay (default: from title)
  --primary-color <hex> Primary accent color
  --text-color <color>  Text color (default: white)
  --platform <platform> Platform: youtube, tiktok, both
  --face / --no-face    Include AI face reaction
  --emotion <emotion>   Face emotion: surprised, shocked, happy, excited, curious, serious
  --no-text             Skip text overlay
  --format <fmt>        Output: png, jpg
  --verbose             Show detailed progress

Examples:
  skills run video-thumbnail -- "10 VS Code Extensions You NEED in 2024"
  skills run video-thumbnail -- "I Tried the Viral Recipe" --style reaction --emotion shocked
  skills run video-thumbnail -- "Room Makeover" --style before-after --variants 3
`);
}

function buildPrompt(options: Options, variant: number): { prompt: string; elements: string[] } {
  const styleConfig = STYLES[options.style] || STYLES.reaction;
  const emotionDesc = options.face ? EMOTIONS[options.emotion] || EMOTIONS.surprised : "";

  let prompt = `YouTube video thumbnail design, 16:9 aspect ratio, high contrast, eye-catching. `;
  prompt += `Style: ${styleConfig.description}. `;

  // Add face if requested
  if (options.face && ["reaction", "listicle", "mystery"].includes(options.style)) {
    prompt += `Include person with ${emotionDesc}, positioned on left third of frame. `;
  }

  // Extract key words from title for visual
  const titleWords = options.title.replace(/[^\w\s]/g, "").split(" ").slice(0, 5).join(" ");
  prompt += `Visual theme based on: "${titleWords}". `;

  // Text overlay
  if (!options.noText) {
    const displayText = options.text || extractThumbnailText(options.title);
    prompt += `Bold text overlay: "${displayText}" in ${options.textColor} with dark outline for readability. `;
  }

  // Colors
  if (options.primaryColor !== "auto") {
    prompt += `Primary accent color: ${options.primaryColor}. `;
  } else {
    const colors = ["vibrant red", "electric blue", "bright yellow", "hot pink"];
    prompt += `Primary accent color: ${colors[variant % colors.length]}. `;
  }

  prompt += "Professional thumbnail design, extremely high contrast, readable at small sizes, YouTube-optimized.";

  // Variant differentiation
  const variantMods = ["warm color scheme", "cool color scheme", "minimalist approach", "bold maximalist"];
  prompt += ` Design variation: ${variantMods[variant % variantMods.length]}.`;

  return { prompt, elements: styleConfig.elements };
}

function extractThumbnailText(title: string): string {
  // Extract the most impactful 2-4 words for thumbnail
  const cleaned = title
    .replace(/[|:\-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Look for numbers or key phrases
  const numberMatch = cleaned.match(/(\d+)/);
  if (numberMatch) {
    return numberMatch[1];
  }

  // Get first few impactful words
  const words = cleaned.split(" ");
  const impactWords = words.filter(w =>
    w.length > 3 &&
    !["this", "that", "with", "from", "your", "the", "and", "for"].includes(w.toLowerCase())
  );

  return impactWords.slice(0, 3).join(" ").toUpperCase();
}

async function generateThumbnail(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      n: 1,
      size: "1536x1024", // 16:9 landscape
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

function formatOutput(results: ThumbnailResult[], options: Options): string {
  let output = `# Video Thumbnail: ${options.title}\n\n`;
  output += `**Style:** ${options.style}\n`;
  output += `**Platform:** ${options.platform}\n`;
  output += `**Variants:** ${results.length}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;

  output += `## Generated Thumbnails\n\n`;

  for (const r of results) {
    output += `### Variant ${r.variant}: ${r.style.charAt(0).toUpperCase() + r.style.slice(1)} Style\n`;
    output += `**File:** ${r.filename}\n`;
    output += `**Elements:** ${r.elements.join(", ")}\n\n`;
  }

  output += `---\n\n`;
  output += `**Export Directory:** ${EXPORTS_DIR}\n\n`;
  output += `## Tips for A/B Testing\n\n`;
  output += `1. Test these variants across different videos\n`;
  output += `2. Track CTR (Click-Through Rate) for each style\n`;
  output += `3. Faces typically increase CTR by 30-40%\n`;
  output += `4. Ensure thumbnails are readable at 120px width\n`;
  output += `5. Update thumbnails if video underperforms\n`;

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
  if (!options.title) {
    console.error("Error: Please provide a video title.");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    const results: ThumbnailResult[] = [];

    for (let i = 0; i < options.variants; i++) {
      log(`Generating thumbnail variant ${i + 1}/${options.variants}...`);

      const { prompt, elements } = buildPrompt(options, i);
      const filename = `thumbnail-${String.fromCharCode(65 + i)}-${SESSION_ID}.${options.format}`;

      if (options.verbose) {
        log(`Prompt: ${prompt}`);
      }

      try {
        await generateThumbnail(prompt, filename);

        results.push({
          variant: String.fromCharCode(65 + i),
          style: options.style,
          filename,
          prompt,
          elements,
        });

        log(`Saved: ${filename}`, "success");
      } catch (err) {
        log(`Failed to generate variant ${i + 1}: ${err}`, "error");
      }
    }

    const output = formatOutput(results, options);
    writeFileSync(join(EXPORTS_DIR, "thumbnails-summary.md"), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
