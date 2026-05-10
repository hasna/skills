#!/usr/bin/env bun
/**
 * Create Blog Article Skill
 * Generates complete blog articles with AI-generated images
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// Types
interface ArticleOptions {
  topic: string;
  tone: "professional" | "casual" | "technical" | "friendly";
  length: "short" | "medium" | "long";
  images: number;
  style: "photorealistic" | "illustration" | "minimalist";
  seo: boolean;
  outlineOnly: boolean;
  output?: string;
}

interface ArticleOutline {
  title: string;
  metaDescription: string;
  introduction: string;
  sections: Array<{
    heading: string;
    subheadings?: string[];
    imagePrompt?: string;
  }>;
  conclusion: string;
  keywords: string[];
}

interface ArticleContent {
  title: string;
  metaDescription: string;
  featuredImageUrl?: string;
  introduction: string;
  sections: Array<{
    heading: string;
    content: string;
    imageUrl?: string;
  }>;
  conclusion: string;
  keywords: string[];
  tags: string[];
  wordCount: number;
  readingTime: number;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    total_tokens: number;
  };
}

interface OpenAIImageResponse {
  data: Array<{
    url?: string;
    revised_prompt?: string;
  }>;
}

// =============================================================================
// Security: HTML Escaping to prevent XSS
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Constants
const SKILL_NAME = "create-blog-article";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Generate slug from text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Calculate reading time (assuming 200 words per minute)
function calculateReadingTime(wordCount: number): number {
  return Math.ceil(wordCount / 200);
}

// Count words in text
function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

// Call OpenAI Chat API
async function callOpenAI(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

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
      temperature: 0.7,
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

// Generate article outline
async function generateOutline(options: ArticleOptions): Promise<ArticleOutline> {
  log(`Generating article outline for: "${options.topic}"`);

  const lengthGuide = {
    short: "3-4 sections, ~500 words total",
    medium: "5-6 sections, ~1000 words total",
    long: "7-9 sections, ~2000 words total",
  };

  const systemPrompt = `You are an expert content writer and SEO specialist. Generate a detailed article outline in JSON format. The outline should be engaging, well-structured, and optimized for readability.`;

  const userPrompt = `Create a detailed outline for a blog article with the following requirements:

Topic: ${options.topic}
Tone: ${options.tone}
Length: ${options.length} (${lengthGuide[options.length]})
Images: ${options.images} images will be generated
${options.seo ? "SEO: Include keywords and meta description optimized for search engines" : ""}

Return a JSON object with this exact structure:
{
  "title": "Compelling article title",
  "metaDescription": "SEO-optimized meta description (150-160 characters)",
  "introduction": "Brief outline of introduction paragraph",
  "sections": [
    {
      "heading": "Section heading",
      "subheadings": ["Optional subheading 1", "Optional subheading 2"],
      "imagePrompt": "Optional DALL-E prompt for section image"
    }
  ],
  "conclusion": "Brief outline of conclusion",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Make the outline engaging and informative. ${options.images > 1 ? `Include imagePrompt for ${options.images - 1} sections (featured image will be generated separately).` : "No section images needed."}`;

  const response = await callOpenAI(userPrompt, systemPrompt);

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse outline JSON from response");
  }

  const outline = JSON.parse(jsonMatch[0]);
  log(`Outline generated with ${outline.sections.length} sections`, "success");

  return outline;
}

// Generate full article content from outline
async function generateArticleContent(outline: ArticleOutline, options: ArticleOptions): Promise<ArticleContent> {
  log(`Generating full article content`);

  const lengthGuide = {
    short: "500 words",
    medium: "1000 words",
    long: "2000 words",
  };

  const systemPrompt = `You are an expert content writer. Write engaging, informative blog articles with a ${options.tone} tone. Focus on providing value to readers with clear, well-structured content.`;

  const userPrompt = `Write a complete blog article based on this outline:

Title: ${outline.title}
Topic: ${options.topic}
Tone: ${options.tone}
Target Length: ${lengthGuide[options.length]}

Introduction: ${outline.introduction}

Sections:
${outline.sections.map((s, i) => `${i + 1}. ${s.heading}${s.subheadings ? "\n   - " + s.subheadings.join("\n   - ") : ""}`).join("\n")}

Conclusion: ${outline.conclusion}

Return a JSON object with this structure:
{
  "introduction": "Full introduction paragraph(s)",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Full section content with multiple paragraphs"
    }
  ],
  "conclusion": "Full conclusion paragraph(s)",
  "tags": ["tag1", "tag2", "tag3"]
}

Write naturally and engagingly. Each section should be substantial and informative.`;

  const response = await callOpenAI(userPrompt, systemPrompt);

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse article JSON from response");
  }

  const content = JSON.parse(jsonMatch[0]);

  // Calculate word count
  const allText = [
    content.introduction,
    ...content.sections.map((s: { content: string }) => s.content),
    content.conclusion,
  ].join(" ");

  const wordCount = countWords(allText);
  const readingTime = calculateReadingTime(wordCount);

  log(`Article generated: ${wordCount} words, ${readingTime} min read`, "success");

  return {
    title: outline.title,
    metaDescription: outline.metaDescription,
    introduction: content.introduction,
    sections: content.sections.map((s: { heading: string; content: string }, i: number) => ({
      heading: s.heading,
      content: s.content,
      imageUrl: outline.sections[i]?.imagePrompt ? undefined : undefined, // Will be filled later
    })),
    conclusion: content.conclusion,
    keywords: outline.keywords,
    tags: content.tags || [],
    wordCount,
    readingTime,
  };
}

// Generate image using DALL-E
async function generateImage(prompt: string, style: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  log(`Generating image: "${prompt.slice(0, 50)}..."`);

  const styleMap: Record<string, string> = {
    photorealistic: "photorealistic, professional photography, high quality",
    illustration: "digital illustration, clean lines, artistic",
    minimalist: "minimalist design, simple, clean, modern",
  };

  const enhancedPrompt = `${prompt}, ${styleMap[style] || styleMap.photorealistic}`;

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: enhancedPrompt,
      n: 1,
      size: "1792x1024",
      quality: "standard",
      response_format: "url",
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data: OpenAIImageResponse = await response.json();

  if (!data.data?.[0]?.url) {
    throw new Error("No image URL returned from OpenAI");
  }

  log(`Image generated successfully`, "success");

  return data.data[0].url;
}

// Download image from URL
async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const dir = dirname(outputPath);

  ensureDir(dir);
  writeFileSync(outputPath, Buffer.from(buffer));

  log(`Image saved to: ${outputPath}`);
}

// Generate all images for article
async function generateArticleImages(
  outline: ArticleOutline,
  content: ArticleContent,
  options: ArticleOptions,
  outputDir: string
): Promise<ArticleContent> {
  if (options.images === 0) {
    log("Skipping image generation (--images 0)");
    return content;
  }

  const imagesDir = join(outputDir, "images");
  ensureDir(imagesDir);

  // Generate featured image
  log("Generating featured image...");
  const featuredPrompt = `Blog article featured image for: ${content.title}`;
  const featuredUrl = await generateImage(featuredPrompt, options.style);
  const featuredPath = join(imagesDir, "featured.png");
  await downloadImage(featuredUrl, featuredPath);
  content.featuredImageUrl = featuredPath;

  // Generate section images if requested
  if (options.images > 1) {
    log(`Generating ${options.images - 1} section images...`);

    let imageCount = 0;
    for (let i = 0; i < outline.sections.length && imageCount < options.images - 1; i++) {
      const section = outline.sections[i];
      if (section.imagePrompt) {
        try {
          const imageUrl = await generateImage(section.imagePrompt, options.style);
          const imagePath = join(imagesDir, `section-${i + 1}.png`);
          await downloadImage(imageUrl, imagePath);
          content.sections[i].imageUrl = imagePath;
          imageCount++;
        } catch (error) {
          log(`Failed to generate image for section ${i + 1}: ${error}`, "error");
        }
      }
    }
  }

  log(`Generated ${options.images} image(s) successfully`, "success");
  return content;
}

// Export article as Markdown
function exportMarkdown(content: ArticleContent, outputPath: string): void {
  let markdown = `---
title: ${content.title}
description: ${content.metaDescription}
keywords: ${content.keywords.join(", ")}
tags: ${content.tags.join(", ")}
readingTime: ${content.readingTime} min
wordCount: ${content.wordCount}
---

# ${content.title}

`;

  if (content.featuredImageUrl) {
    markdown += `![Featured Image](./images/featured.png)\n\n`;
  }

  markdown += `${content.introduction}\n\n`;

  for (const section of content.sections) {
    markdown += `## ${section.heading}\n\n`;
    markdown += `${section.content}\n\n`;
    if (section.imageUrl) {
      const imageName = section.imageUrl.split("/").pop();
      markdown += `![${section.heading}](./images/${imageName})\n\n`;
    }
  }

  markdown += `## Conclusion\n\n${content.conclusion}\n\n`;

  markdown += `---\n\n`;
  markdown += `**Keywords:** ${content.keywords.join(", ")}\n\n`;
  markdown += `**Tags:** ${content.tags.join(", ")}\n`;

  writeFileSync(outputPath, markdown);
  log(`Markdown exported to: ${outputPath}`);
}

// Export article as HTML
function exportHTML(content: ArticleContent, outputPath: string): void {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(content.metaDescription)}">
  <meta name="keywords" content="${escapeHtml(content.keywords.join(", "))}">
  <title>${escapeHtml(content.title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      color: #333;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 2rem 0;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    h2 {
      font-size: 1.75rem;
      margin-top: 2rem;
      margin-bottom: 1rem;
    }
    .meta {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }
    .tags {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #eee;
    }
    .tags span {
      display: inline-block;
      background: #f0f0f0;
      padding: 0.25rem 0.75rem;
      margin: 0.25rem;
      border-radius: 4px;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <article>
    <header>
      <h1>${escapeHtml(content.title)}</h1>
      <div class="meta">
        ${content.readingTime} min read • ${content.wordCount} words
      </div>
    </header>

`;

  if (content.featuredImageUrl) {
    html += `    <img src="./images/featured.png" alt="Featured Image">\n\n`;
  }

  html += `    <p>${escapeHtml(content.introduction).replace(/\n/g, "</p>\n    <p>")}</p>\n\n`;

  for (const section of content.sections) {
    html += `    <section>
      <h2>${escapeHtml(section.heading)}</h2>
      <p>${escapeHtml(section.content).replace(/\n/g, "</p>\n      <p>")}</p>
`;
    if (section.imageUrl) {
      const imageName = section.imageUrl.split("/").pop();
      html += `      <img src="./images/${imageName}" alt="${escapeHtml(section.heading)}">\n`;
    }
    html += `    </section>\n\n`;
  }

  html += `    <section>
      <h2>Conclusion</h2>
      <p>${escapeHtml(content.conclusion).replace(/\n/g, "</p>\n      <p>")}</p>
    </section>

    <div class="tags">
      <strong>Tags:</strong>
`;

  for (const tag of content.tags) {
    html += `      <span>${escapeHtml(tag)}</span>\n`;
  }

  html += `    </div>
  </article>
</body>
</html>`;

  writeFileSync(outputPath, html);
  log(`HTML exported to: ${outputPath}`);
}

// Export article as JSON
function exportJSON(content: ArticleContent, outputPath: string): void {
  const json = JSON.stringify(content, null, 2);
  writeFileSync(outputPath, json);
  log(`JSON exported to: ${outputPath}`);
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tone: { type: "string", default: "professional" },
      length: { type: "string", default: "medium" },
      images: { type: "string", default: "1" },
      style: { type: "string", default: "photorealistic" },
      seo: { type: "boolean", default: false },
      "outline-only": { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Create Blog Article - Generate complete blog articles with AI-generated images

Usage:
  bun run src/index.ts <topic> [options]

Options:
  --tone <tone>          Writing tone (professional, casual, technical, friendly) [default: professional]
  --length <length>      Article length (short ~500w, medium ~1000w, long ~2000w) [default: medium]
  --images <number>      Number of images (0, 1, 3, 5) [default: 1]
  --style <style>        Image style (photorealistic, illustration, minimalist) [default: photorealistic]
  --seo                  Include SEO metadata and keywords [default: false]
  --outline-only         Generate outline only, no full article [default: false]
  --output, -o <path>    Custom output path
  --help, -h             Show this help

Examples:
  bun run src/index.ts "The Future of AI Development"
  bun run src/index.ts "How to Build REST APIs" --tone technical --length long
  bun run src/index.ts "Travel Tips" --seo --images 3 --style photorealistic
  bun run src/index.ts "Code Reviews" --outline-only
`);
    process.exit(0);
  }

  const topic = positionals.join(" ");

  if (!topic) {
    log("Please provide a topic/title for the article", "error");
    process.exit(1);
  }

  // Validate options
  const validTones = ["professional", "casual", "technical", "friendly"];
  const validLengths = ["short", "medium", "long"];
  const validStyles = ["photorealistic", "illustration", "minimalist"];
  const validImageCounts = [0, 1, 3, 5];

  const tone = values.tone as string;
  const length = values.length as string;
  const style = values.style as string;
  const images = parseInt(values.images as string);

  if (!validTones.includes(tone)) {
    log(`Invalid tone: ${tone}. Must be one of: ${validTones.join(", ")}`, "error");
    process.exit(1);
  }

  if (!validLengths.includes(length)) {
    log(`Invalid length: ${length}. Must be one of: ${validLengths.join(", ")}`, "error");
    process.exit(1);
  }

  if (!validStyles.includes(style)) {
    log(`Invalid style: ${style}. Must be one of: ${validStyles.join(", ")}`, "error");
    process.exit(1);
  }

  if (!validImageCounts.includes(images)) {
    log(`Invalid images count: ${images}. Must be one of: ${validImageCounts.join(", ")}`, "error");
    process.exit(1);
  }

  const options: ArticleOptions = {
    topic,
    tone: tone as ArticleOptions["tone"],
    length: length as ArticleOptions["length"],
    images,
    style: style as ArticleOptions["style"],
    seo: values.seo as boolean,
    outlineOnly: values["outline-only"] as boolean,
    output: values.output as string | undefined,
  };

  try {
    log(`Session ID: ${SESSION_ID}`);
    log(`Topic: "${topic}"`);
    log(`Options: ${tone} tone, ${length} length, ${images} images, ${style} style`);

    // Determine output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
    const titleSlug = slugify(topic);
    const outputDir = options.output || join(EXPORTS_DIR, `export_${timestamp}_${titleSlug}`);
    ensureDir(outputDir);

    log(`Output directory: ${outputDir}`);

    // Step 1: Generate outline
    const outline = await generateOutline(options);

    if (options.outlineOnly) {
      // Export outline only
      const outlineJson = JSON.stringify(outline, null, 2);
      const outlinePath = join(outputDir, "outline.json");
      writeFileSync(outlinePath, outlineJson);

      console.log(`\n✨ Outline generated successfully!`);
      console.log(`   📁 Output: ${outlinePath}`);
      console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
      console.log(`\n📝 Outline:`);
      console.log(`   Title: ${outline.title}`);
      console.log(`   Sections: ${outline.sections.length}`);
      console.log(`   Keywords: ${outline.keywords.join(", ")}`);

      return;
    }

    // Step 2: Generate full article content
    let content = await generateArticleContent(outline, options);

    // Step 3: Generate images
    content = await generateArticleImages(outline, content, options, outputDir);

    // Step 4: Export in all formats
    log("Exporting article in multiple formats...");

    exportMarkdown(content, join(outputDir, "article.md"));
    exportHTML(content, join(outputDir, "article.html"));
    exportJSON(content, join(outputDir, "article.json"));

    console.log(`\n✨ Blog article generated successfully!`);
    console.log(`   📁 Output: ${outputDir}`);
    console.log(`   📄 Formats: article.md, article.html, article.json`);
    if (options.images > 0) {
      console.log(`   🖼️  Images: ${options.images} image(s) in images/`);
    }
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
    console.log(`\n📊 Article Stats:`);
    console.log(`   Title: ${content.title}`);
    console.log(`   Words: ${content.wordCount}`);
    console.log(`   Reading Time: ${content.readingTime} min`);
    console.log(`   Sections: ${content.sections.length}`);
    console.log(`   Tags: ${content.tags.join(", ")}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, "error");
    }
    process.exit(1);
  }
}

main();
