#!/usr/bin/env bun
/**
 * Generate Social Posts Skill
 * Transform blog posts and articles into engaging social media content
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Types
type Platform = "twitter" | "linkedin" | "facebook" | "instagram" | "threads";
type Tone = "professional" | "casual" | "witty" | "inspiring" | "educational";
type OutputFormat = "json" | "markdown" | "text";

interface GenerateOptions {
  source: string; // URL, file path, or direct text
  sourceType: "url" | "file" | "text";
  platforms: Platform[];
  count: number;
  tone: Tone;
  includeHashtags: boolean;
  threads: boolean;
  maxLength: number;
  output?: string;
  format: OutputFormat;
}

interface PlatformConfig {
  name: string;
  charLimit: number;
  hashtagLimit: number;
  emojiUsage: "minimal" | "moderate" | "heavy";
  style: string;
}

interface SocialPost {
  platform: Platform;
  content: string;
  hashtags: string[];
  hooks: string[];
  cta?: string;
  threadPosts?: string[];
  bestTime?: string;
  characterCount: number;
}

interface GeneratedContent {
  sourceTitle: string;
  sourceSummary: string;
  platforms: Platform[];
  posts: SocialPost[];
  generatedAt: string;
  options: GenerateOptions;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface AnthropicResponse {
  content: Array<{
    text: string;
  }>;
}

// Constants
const SKILL_NAME = "generate-social-posts";
const SESSION_ID = randomUUID().slice(0, 8);

const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  twitter: {
    name: "Twitter/X",
    charLimit: 280,
    hashtagLimit: 3,
    emojiUsage: "moderate",
    style: "Concise, punchy, attention-grabbing. Use strategic line breaks. Include hooks that stop the scroll.",
  },
  linkedin: {
    name: "LinkedIn",
    charLimit: 3000,
    hashtagLimit: 5,
    emojiUsage: "minimal",
    style: "Professional, value-driven, business-focused. Multi-paragraph format. Start with a strong hook.",
  },
  facebook: {
    name: "Facebook",
    charLimit: 63206,
    hashtagLimit: 3,
    emojiUsage: "moderate",
    style: "Conversational, story-driven, community-oriented. Personal and relatable.",
  },
  instagram: {
    name: "Instagram",
    charLimit: 2200,
    hashtagLimit: 30,
    emojiUsage: "heavy",
    style: "Visual-first descriptions, emoji-rich, inspirational. Hashtag-heavy at the end.",
  },
  threads: {
    name: "Threads",
    charLimit: 500,
    hashtagLimit: 2,
    emojiUsage: "moderate",
    style: "Brief, authentic, conversational. Similar to Twitter but more personal.",
  },
};

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

// Generate slug from text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Detect source type
function detectSourceType(source: string): "url" | "file" | "text" {
  // Check if it's a URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return "url";
  }

  // Check if it's a file path
  if (existsSync(source)) {
    return "file";
  }

  // Otherwise it's direct text
  return "text";
}

// Extract content from URL
async function extractFromURL(url: string): Promise<string> {
  log(`Fetching content from URL: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();

    // Basic HTML to text conversion
    // Remove script and style tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    log(`Extracted ${text.length} characters from URL`, "success");
    return text;
  } catch (error) {
    throw new Error(`Failed to extract content from URL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Extract content from file
function extractFromFile(filePath: string): string {
  log(`Reading content from file: ${filePath}`);

  try {
    const content = readFileSync(filePath, "utf-8");

    // If it's markdown, do some basic cleanup
    let text = content;

    if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) {
      // Remove markdown syntax for cleaner processing
      text = text.replace(/^#{1,6}\s+/gm, ""); // Headers
      text = text.replace(/\*\*(.+?)\*\*/g, "$1"); // Bold
      text = text.replace(/\*(.+?)\*/g, "$1"); // Italic
      text = text.replace(/\[(.+?)\]\(.+?\)/g, "$1"); // Links
      text = text.replace(/`{1,3}[^`]+`{1,3}/g, ""); // Code blocks
    }

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    log(`Extracted ${text.length} characters from file`, "success");
    return text;
  } catch (error) {
    throw new Error(`Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Get content based on source type
async function getContent(source: string, sourceType: "url" | "file" | "text", maxLength: number): Promise<string> {
  let content: string;

  if (sourceType === "url") {
    content = await extractFromURL(source);
  } else if (sourceType === "file") {
    content = extractFromFile(source);
  } else {
    content = source;
  }

  // Truncate if too long
  if (content.length > maxLength) {
    log(`Content truncated from ${content.length} to ${maxLength} characters`);
    content = content.slice(0, maxLength);
  }

  return content;
}

// Call AI API
async function callAI(prompt: string, systemPrompt: string): Promise<string> {
  // Try OpenAI first
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openaiKey) {
    return await callOpenAI(prompt, systemPrompt, openaiKey);
  } else if (anthropicKey) {
    return await callAnthropic(prompt, systemPrompt, anthropicKey);
  } else {
    throw new Error("No AI API key found. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable");
  }
}

// Call OpenAI API
async function callOpenAI(prompt: string, systemPrompt: string, apiKey: string): Promise<string> {
  log("Using OpenAI API...");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data: OpenAIChatResponse = await response.json();

  if (!data.choices?.[0]?.message?.content) {
    throw new Error("No content returned from OpenAI");
  }

  return data.choices[0].message.content;
}

// Call Anthropic API
async function callAnthropic(prompt: string, systemPrompt: string, apiKey: string): Promise<string> {
  log("Using Anthropic Claude API...");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data: AnthropicResponse = await response.json();

  if (!data.content?.[0]?.text) {
    throw new Error("No content returned from Anthropic");
  }

  return data.content[0].text;
}

// Generate posts for a specific platform
async function generatePlatformPosts(
  content: string,
  platform: Platform,
  options: GenerateOptions
): Promise<SocialPost[]> {
  const config = PLATFORM_CONFIGS[platform];

  log(`Generating ${options.count} post(s) for ${config.name}...`);

  const systemPrompt = `You are an expert social media content creator specializing in ${config.name}. Create engaging, platform-optimized posts that drive engagement and conversions.`;

  const toneDescriptions = {
    professional: "formal, authoritative, business-appropriate",
    casual: "friendly, approachable, conversational",
    witty: "clever, humorous, attention-grabbing",
    inspiring: "motivational, uplifting, aspirational",
    educational: "informative, clear, teaching-focused",
  };

  const userPrompt = `Transform the following content into ${options.count} engaging ${config.name} post(s).

CONTENT:
${content.slice(0, 3000)}...

REQUIREMENTS:
- Platform: ${config.name}
- Character limit: ${config.charLimit}
- Tone: ${toneDescriptions[options.tone]}
- Style: ${config.style}
- Emoji usage: ${config.emojiUsage}
${options.includeHashtags ? `- Include ${config.hashtagLimit} relevant hashtags` : "- No hashtags"}
${options.threads ? "- Create thread version if content is long" : ""}

Return a JSON array with ${options.count} post objects in this format:
[
  {
    "content": "The post content (respecting character limit)",
    "hashtags": ["hashtag1", "hashtag2"],
    "hook": "Attention-grabbing opening line",
    "cta": "Call to action",
    ${options.threads ? '"threadPosts": ["post 1/5", "post 2/5", ...],' : ""}
    "bestTime": "Optimal posting time (e.g., 'Weekday mornings 9-11am')"
  }
]

Make each post variant unique and engaging. Ensure character counts are within limits.`;

  const response = await callAI(userPrompt, systemPrompt);

  // Parse JSON response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not parse ${platform} posts JSON from response`);
  }

  const postsData = JSON.parse(jsonMatch[0]);

  const posts: SocialPost[] = postsData.map((post: any) => ({
    platform,
    content: post.content,
    hashtags: post.hashtags || [],
    hooks: [post.hook].filter(Boolean),
    cta: post.cta,
    threadPosts: post.threadPosts,
    bestTime: post.bestTime,
    characterCount: post.content.length,
  }));

  log(`Generated ${posts.length} ${config.name} post(s)`, "success");

  return posts;
}

// Generate all posts
async function generateAllPosts(
  content: string,
  options: GenerateOptions
): Promise<GeneratedContent> {
  log(`Generating posts for ${options.platforms.length} platform(s)...`);

  // First, get a summary and title from the content
  const summaryPrompt = `Analyze this content and provide a title and brief summary.

CONTENT:
${content.slice(0, 2000)}...

Return JSON:
{
  "title": "Content title or main topic",
  "summary": "2-3 sentence summary"
}`;

  const summaryResponse = await callAI(
    summaryPrompt,
    "You are a content analyst. Provide concise, accurate summaries."
  );

  const summaryMatch = summaryResponse.match(/\{[\s\S]*\}/);
  const summaryData = summaryMatch ? JSON.parse(summaryMatch[0]) : {
    title: "Generated Content",
    summary: "Social media posts generated from content",
  };

  // Generate posts for each platform
  const allPosts: SocialPost[] = [];

  for (const platform of options.platforms) {
    const posts = await generatePlatformPosts(content, platform, options);
    allPosts.push(...posts);
  }

  const result: GeneratedContent = {
    sourceTitle: summaryData.title,
    sourceSummary: summaryData.summary,
    platforms: options.platforms,
    posts: allPosts,
    generatedAt: new Date().toISOString(),
    options,
  };

  log(`Generated ${allPosts.length} total posts across all platforms`, "success");

  return result;
}

// Export as JSON
function exportJSON(content: GeneratedContent, outputPath: string): void {
  const json = JSON.stringify(content, null, 2);
  writeFileSync(outputPath, json);
  log(`JSON exported to: ${outputPath}`);
}

// Export as Markdown
function exportMarkdown(content: GeneratedContent, outputPath: string): void {
  let markdown = `# Social Media Posts\n\n`;
  markdown += `**Source:** ${content.sourceTitle}\n\n`;
  markdown += `**Summary:** ${content.sourceSummary}\n\n`;
  markdown += `**Generated:** ${new Date(content.generatedAt).toLocaleString()}\n\n`;
  markdown += `**Platforms:** ${content.platforms.join(", ")}\n\n`;
  markdown += `---\n\n`;

  // Group posts by platform
  const postsByPlatform: Record<Platform, SocialPost[]> = {
    twitter: [],
    linkedin: [],
    facebook: [],
    instagram: [],
    threads: [],
  };

  content.posts.forEach(post => {
    postsByPlatform[post.platform].push(post);
  });

  // Write posts for each platform
  for (const platform of content.platforms) {
    const posts = postsByPlatform[platform];
    if (posts.length === 0) continue;

    const config = PLATFORM_CONFIGS[platform];
    markdown += `## ${config.name}\n\n`;

    posts.forEach((post, index) => {
      markdown += `### Variant ${index + 1}\n\n`;
      markdown += `${post.content}\n\n`;

      if (post.hashtags.length > 0) {
        markdown += `**Hashtags:** ${post.hashtags.join(" ")}\n\n`;
      }

      if (post.hooks.length > 0) {
        markdown += `**Hook:** ${post.hooks[0]}\n\n`;
      }

      if (post.cta) {
        markdown += `**CTA:** ${post.cta}\n\n`;
      }

      if (post.threadPosts && post.threadPosts.length > 0) {
        markdown += `**Thread Version:**\n\n`;
        post.threadPosts.forEach((threadPost, i) => {
          markdown += `${i + 1}. ${threadPost}\n\n`;
        });
      }

      if (post.bestTime) {
        markdown += `**Best Time:** ${post.bestTime}\n\n`;
      }

      markdown += `**Character Count:** ${post.characterCount}\n\n`;
      markdown += `---\n\n`;
    });
  }

  writeFileSync(outputPath, markdown);
  log(`Markdown exported to: ${outputPath}`);
}

// Export as text files per platform
function exportText(content: GeneratedContent, outputDir: string): void {
  const postsByPlatform: Record<Platform, SocialPost[]> = {
    twitter: [],
    linkedin: [],
    facebook: [],
    instagram: [],
    threads: [],
  };

  content.posts.forEach(post => {
    postsByPlatform[post.platform].push(post);
  });

  for (const platform of content.platforms) {
    const posts = postsByPlatform[platform];
    if (posts.length === 0) continue;

    let text = `${PLATFORM_CONFIGS[platform].name} Posts\n`;
    text += `${"=".repeat(50)}\n\n`;

    posts.forEach((post, index) => {
      text += `--- Variant ${index + 1} ---\n\n`;
      text += `${post.content}\n\n`;

      if (post.hashtags.length > 0) {
        text += `Hashtags: ${post.hashtags.join(" ")}\n\n`;
      }

      if (post.threadPosts && post.threadPosts.length > 0) {
        text += `Thread Version:\n`;
        post.threadPosts.forEach((threadPost, i) => {
          text += `${i + 1}. ${threadPost}\n`;
        });
        text += `\n`;
      }

      text += `Character Count: ${post.characterCount}\n`;
      text += `Best Time: ${post.bestTime || "N/A"}\n\n`;
      text += `${"=".repeat(50)}\n\n`;
    });

    const outputPath = join(outputDir, `${platform}.txt`);
    writeFileSync(outputPath, text);
    log(`${PLATFORM_CONFIGS[platform].name} posts exported to: ${outputPath}`);
  }
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string" },
      platforms: { type: "string", default: "all" },
      count: { type: "string", default: "3" },
      tone: { type: "string", default: "professional" },
      "include-hashtags": { type: "boolean", default: true },
      threads: { type: "boolean", default: false },
      "max-length": { type: "string", default: "10000" },
      output: { type: "string", short: "o" },
      format: { type: "string", default: "json" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Generate Social Posts - Transform content into platform-optimized social media posts

Usage:
  bun run src/index.ts <url|file> [options]
  bun run src/index.ts --input "text" [options]

Options:
  --input <text>          Direct text input (alternative to URL/file)
  --platforms <list>      Comma-separated platforms (twitter,linkedin,facebook,instagram,threads,all) [default: all]
  --count <number>        Number of post variants per platform [default: 3]
  --tone <tone>           Writing tone (professional,casual,witty,inspiring,educational) [default: professional]
  --include-hashtags      Include hashtag suggestions [default: true]
  --threads               Generate thread/carousel versions [default: false]
  --max-length <chars>    Maximum content length to process [default: 10000]
  --output, -o <path>     Custom output path
  --format <format>       Output format (json,markdown,text) [default: json]
  --help, -h              Show this help

Examples:
  bun run src/index.ts "https://blog.com/article"
  bun run src/index.ts ./article.md --platforms twitter,linkedin
  bun run src/index.ts --input "Launch announcement" --tone witty
  bun run src/index.ts ./post.md --threads --count 5
`);
    process.exit(0);
  }

  // Determine source
  let source: string;
  let sourceType: "url" | "file" | "text";

  if (values.input) {
    source = values.input as string;
    sourceType = "text";
  } else if (positionals.length > 0) {
    source = positionals.join(" ");
    sourceType = detectSourceType(source);
  } else {
    log("Please provide a URL, file path, or use --input for direct text", "error");
    process.exit(1);
  }

  // Parse platforms
  let platforms: Platform[];
  const platformsInput = (values.platforms as string).toLowerCase();

  if (platformsInput === "all") {
    platforms = ["twitter", "linkedin", "facebook", "instagram", "threads"];
  } else {
    const platformList = platformsInput.split(",").map(p => p.trim());
    const validPlatforms: Platform[] = ["twitter", "linkedin", "facebook", "instagram", "threads"];

    platforms = platformList.filter(p => validPlatforms.includes(p as Platform)) as Platform[];

    if (platforms.length === 0) {
      log("No valid platforms specified. Use: twitter, linkedin, facebook, instagram, threads, or all", "error");
      process.exit(1);
    }
  }

  // Validate options
  const count = parseInt(values.count as string);
  const maxLength = parseInt(values["max-length"] as string);
  const tone = values.tone as Tone;
  const format = values.format as OutputFormat;

  const validTones: Tone[] = ["professional", "casual", "witty", "inspiring", "educational"];
  const validFormats: OutputFormat[] = ["json", "markdown", "text"];

  if (!validTones.includes(tone)) {
    log(`Invalid tone: ${tone}. Must be one of: ${validTones.join(", ")}`, "error");
    process.exit(1);
  }

  if (!validFormats.includes(format)) {
    log(`Invalid format: ${format}. Must be one of: ${validFormats.join(", ")}`, "error");
    process.exit(1);
  }

  if (count < 1 || count > 20) {
    log("Count must be between 1 and 20", "error");
    process.exit(1);
  }

  const options: GenerateOptions = {
    source,
    sourceType,
    platforms,
    count,
    tone,
    includeHashtags: values["include-hashtags"] as boolean,
    threads: values.threads as boolean,
    maxLength,
    output: values.output as string | undefined,
    format,
  };

  try {
    log(`Session ID: ${SESSION_ID}`);
    log(`Source: ${source} (${sourceType})`);
    log(`Platforms: ${platforms.join(", ")}`);
    log(`Options: ${tone} tone, ${count} variants per platform, hashtags: ${options.includeHashtags}, threads: ${options.threads}`);

    // Get content
    const content = await getContent(source, sourceType, maxLength);

    if (content.length < 50) {
      log("Content is too short. Please provide more substantial content (minimum 50 characters)", "error");
      process.exit(1);
    }

    // Determine output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
    const sourceSlug = slugify(sourceType === "url" ? new URL(source).pathname : sourceType === "file" ? source : content.slice(0, 50));
    const outputDir = options.output || join(EXPORTS_DIR, `export_${timestamp}_${sourceSlug}`);
    ensureDir(outputDir);

    log(`Output directory: ${outputDir}`);

    // Generate posts
    const generatedContent = await generateAllPosts(content, options);

    // Export in requested format(s)
    if (format === "json" || format === "text") {
      exportJSON(generatedContent, join(outputDir, "posts.json"));
    }

    if (format === "markdown" || format === "text") {
      exportMarkdown(generatedContent, join(outputDir, "posts.md"));
    }

    if (format === "text") {
      exportText(generatedContent, outputDir);
    }

    // Summary
    console.log(`\n✨ Social media posts generated successfully!`);
    console.log(`   📁 Output: ${outputDir}`);
    console.log(`   🌐 Platforms: ${platforms.map(p => PLATFORM_CONFIGS[p].name).join(", ")}`);
    console.log(`   📝 Total Posts: ${generatedContent.posts.length}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
    console.log(`\n📊 Posts by Platform:`);

    platforms.forEach(platform => {
      const count = generatedContent.posts.filter(p => p.platform === platform).length;
      console.log(`   ${PLATFORM_CONFIGS[platform].name}: ${count} posts`);
    });

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, "error");
    }
    process.exit(1);
  }
}

main();
