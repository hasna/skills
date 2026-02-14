#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-social-media-kit";
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
interface SocialPost {
  platform: string;
  content: string;
  hashtags: string[];
  imagePrompt: string;
  imagePath?: string;
  bestTime: string;
  contentType: string;
}

interface Options {
  topic: string;
  platforms: string[];
  type: string;
  brand: string;
  posts: number;
  schedule: boolean;
  hashtags: number;
  tone: string;
  format: string;
  noImages: boolean;
  verbose: boolean;
}

// Platform configs
const PLATFORM_CONFIGS: Record<string, { charLimit: number; hashtagLimit: number; bestTimes: string[] }> = {
  instagram: { charLimit: 2200, hashtagLimit: 30, bestTimes: ["11am", "2pm", "7pm"] },
  twitter: { charLimit: 280, hashtagLimit: 3, bestTimes: ["9am", "12pm", "5pm"] },
  linkedin: { charLimit: 3000, hashtagLimit: 5, bestTimes: ["8am", "12pm", "5pm"] },
  facebook: { charLimit: 63206, hashtagLimit: 3, bestTimes: ["1pm", "4pm", "8pm"] },
  tiktok: { charLimit: 2200, hashtagLimit: 10, bestTimes: ["7pm", "8pm", "9pm"] },
  pinterest: { charLimit: 500, hashtagLimit: 20, bestTimes: ["8pm", "9pm", "11pm"] },
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
    topic: "",
    platforms: ["instagram", "twitter", "linkedin", "facebook"],
    type: "single",
    brand: "neutral",
    posts: 1,
    schedule: false,
    hashtags: 0, // 0 means platform default
    tone: "casual",
    format: "markdown",
    noImages: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--platforms": options.platforms = args[++i].split(",").map(p => p.trim().toLowerCase()); break;
      case "--type": options.type = args[++i]; break;
      case "--brand": options.brand = args[++i]; break;
      case "--posts": options.posts = parseInt(args[++i], 10); break;
      case "--schedule": options.schedule = true; break;
      case "--hashtags": options.hashtags = parseInt(args[++i], 10); break;
      case "--tone": options.tone = args[++i]; break;
      case "--format": options.format = args[++i]; break;
      case "--no-images": options.noImages = true; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.topic) options.topic = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Social Media Kit - Generate content for all platforms from one brief

Usage:
  skills run social-media-kit -- "<topic>" [options]

Options:
  --platforms <list>   Platforms: instagram,twitter,linkedin,facebook,tiktok,pinterest
  --type <type>        Content type: single, carousel, thread, story
  --brand <desc>       Brand voice description
  --posts <n>          Number of post variations (default: 1)
  --schedule           Include posting schedule suggestions
  --hashtags <n>       Number of hashtags per post (0 for platform default)
  --tone <tone>        Tone: professional, casual, humorous, inspirational
  --format <format>    Output format: markdown, json
  --no-images          Skip image generation
  --verbose            Show detailed progress

Examples:
  skills run social-media-kit -- "5 tips for productive remote work"
  skills run social-media-kit -- "Product launch announcement" --platforms instagram,linkedin
`);
}

async function generateSocialContent(options: Options): Promise<SocialPost[]> {
  const systemPrompt = `You are a social media content strategist. Create engaging posts optimized for each platform.
Brand voice: ${options.brand}
Tone: ${options.tone}

Guidelines:
- Instagram: Visual-first, engaging captions, strategic hashtags
- Twitter/X: Concise, punchy, conversation-starting
- LinkedIn: Professional, value-driven, thought leadership
- Facebook: Community-focused, shareable, engaging
- TikTok: Trendy, casual, hook-driven
- Pinterest: Descriptive, searchable, inspirational`;

  const userPrompt = `Create social media posts for this topic:
"${options.topic}"

Generate content for: ${options.platforms.join(", ")}

Platform limits:
${options.platforms.map(p => `${p}: ${PLATFORM_CONFIGS[p]?.charLimit || 2000} chars, ${PLATFORM_CONFIGS[p]?.hashtagLimit || 10} hashtags max`).join("\n")}

Return JSON array:
[{
  "platform": "platform_name",
  "content": "post content",
  "hashtags": ["tag1", "tag2"],
  "imagePrompt": "DALL-E prompt for accompanying image",
  "bestTime": "recommended posting time",
  "contentType": "single/carousel/thread/story"
}]`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      max_tokens: 4096,
      temperature: 0.8,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const result = await response.json();
  let content = result.choices[0]?.message?.content || "[]";
  if (content.includes("```json")) content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");

  return JSON.parse(content.trim());
}

async function generateImage(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: `Social media visual: ${prompt}. Modern, engaging, shareable, high quality.`,
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

function formatOutput(posts: SocialPost[], options: Options): string {
  if (options.format === "json") return JSON.stringify(posts, null, 2);

  let output = `# Social Media Kit: ${options.topic}\n\n`;
  output += `**Generated:** ${new Date().toISOString()}\n`;
  output += `**Platforms:** ${options.platforms.join(", ")}\n\n---\n\n`;

  for (const post of posts) {
    output += `## ${post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}\n\n`;
    output += `**Caption:**\n${post.content}\n\n`;
    output += `**Hashtags:**\n${post.hashtags.map(h => `#${h}`).join(" ")}\n\n`;
    if (options.schedule) output += `**Best Time to Post:** ${post.bestTime}\n\n`;
    if (post.imagePath) output += `**Image:** ${post.imagePath}\n\n`;
    output += `---\n\n`;
  }

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
  if (!options.topic) {
    console.error("Error: Please provide a topic.");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    log("Generating social media content...");
    const posts = await generateSocialContent(options);
    log(`Generated ${posts.length} posts`, "success");

    if (!options.noImages) {
      log("Generating images...");
      for (const post of posts) {
        try {
          const filename = `${post.platform}-${SESSION_ID}.png`;
          post.imagePath = await generateImage(post.imagePrompt, filename);
          log(`Image saved: ${filename}`, "success");
        } catch (err) {
          log(`Failed to generate image for ${post.platform}: ${err}`, "error");
        }
      }
    }

    const output = formatOutput(posts, options);
    const ext = options.format === "json" ? "json" : "md";
    const outputFile = join(EXPORTS_DIR, `social-media-kit.${ext}`);
    writeFileSync(outputFile, output, "utf-8");
    log(`Output saved to: ${outputFile}`, "success");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
