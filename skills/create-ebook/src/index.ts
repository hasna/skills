#!/usr/bin/env bun

/**
 * Create eBook Skill
 *
 * Generates complete ebooks with AI-powered content, chapter images, and export options.
 * Supports OpenAI GPT-4/DALL-E and Anthropic Claude.
 */

import { parseArgs } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";

// ============================================================================
// Types & Interfaces
// ============================================================================

interface SkillOptions {
  topic: string;
  chapters: number;
  style: "educational" | "narrative" | "technical" | "casual";
  audience: "beginner" | "intermediate" | "expert";
  language: string;
  aiProvider: "openai" | "anthropic";
  format: "markdown" | "pdf";
  includeImages: boolean;
  output: string;
  saveIntermediate: boolean;
}

interface TableOfContents {
  title: string;
  chapters: {
    number: number;
    title: string;
    description: string;
  }[];
}

interface ChapterContent {
  number: number;
  title: string;
  content: string;
}

// ============================================================================
// Environment & Configuration
// ============================================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || ".skills";
const SKILLS_PROJECT_ROOT = process.env.SKILLS_PROJECT_ROOT || process.cwd();
const SKILL_NAME = "create-ebook";
const SESSION_ID = randomUUID().slice(0, 8);

// ============================================================================
// Logging Utility
// ============================================================================

class Logger {
  private logFile: string;
  private sessionId: string;

  constructor() {
    this.sessionId = SESSION_ID;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);
    this.logFile = join(
      SKILLS_PROJECT_ROOT,
      SKILLS_OUTPUT_DIR,
      "logs",
      SKILL_NAME,
      `log_${timestamp}_${this.sessionId}.log`
    );
    this.initLogFile();
  }

  private async initLogFile() {
    const logDir = join(
      SKILLS_PROJECT_ROOT,
      SKILLS_OUTPUT_DIR,
      "logs",
      SKILL_NAME
    );
    await mkdir(logDir, { recursive: true });
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  async log(message: string, level: "info" | "error" | "success" = "info") {
    const logMessage = `[${this.timestamp()}] [${level.toUpperCase()}] ${message}\n`;
    
    const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
    if (level === "error") {
      console.error(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }

    try {
      await writeFile(this.logFile, logMessage, { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }

  async error(message: string) {
    await this.log(message, "error");
  }

  async success(message: string) {
    await this.log(message, "success");
  }
}

// ============================================================================
// AI Provider Clients
// ============================================================================

class OpenAIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-turbo-preview",
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async generateImage(prompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DALL-E API error: ${error}`);
    }

    const data = await response.json();
    return data.data[0].url;
  }
}

class AnthropicClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2500,
        system: systemPrompt || undefined,
        messages: [
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }
}

// ============================================================================
// eBook Generator
// ============================================================================

class EbookGenerator {
  private logger: Logger;
  private options: SkillOptions;
  private outputDir: string;
  private openaiClient?: OpenAIClient;
  private anthropicClient?: AnthropicClient;

  constructor(options: SkillOptions, logger: Logger) {
    this.logger = logger;
    this.options = options;
    this.outputDir = join(SKILLS_PROJECT_ROOT, options.output);

    // Initialize AI clients
    if (options.aiProvider === "openai" && OPENAI_API_KEY) {
      this.openaiClient = new OpenAIClient(OPENAI_API_KEY);
    } else if (options.aiProvider === "anthropic" && ANTHROPIC_API_KEY) {
      this.anthropicClient = new AnthropicClient(ANTHROPIC_API_KEY);
    }
  }

  async generate(): Promise<void> {
    await this.logger.log(`Starting ebook generation: "${this.options.topic}"`);

    // Step 1: Generate TOC
    const toc = await this.generateTableOfContents();
    await this.logger.success(`Generated table of contents (${toc.chapters.length} chapters)`);

    if (this.options.saveIntermediate) {
      await this.saveTOC(toc);
    }

    // Step 2: Generate chapters
    const chapters: ChapterContent[] = [];
    for (const chapter of toc.chapters) {
      const content = await this.generateChapter(chapter);
      chapters.push(content);
      await this.logger.success(`Generated chapter ${chapter.number}/${toc.chapters.length}: ${chapter.title}`);

      if (this.options.saveIntermediate) {
        await this.saveChapter(content);
      }
    }

    // Step 3: Generate images (if enabled)
    const imageUrls: Map<number, string> = new Map();
    if (this.options.includeImages) {
      await this.logger.log("Generating chapter images...");
      for (const chapter of toc.chapters) {
        try {
          const imageUrl = await this.generateChapterImage(chapter);
          imageUrls.set(chapter.number, imageUrl);
          await this.logger.success(`Generated image for chapter ${chapter.number}`);
        } catch (error) {
          await this.logger.error(`Failed to generate image for chapter ${chapter.number}: ${error}`);
        }
      }
    }

    // Step 4: Compile ebook
    await this.logger.log("Compiling final ebook...");
    const ebookContent = await this.compileEbook(toc, chapters, imageUrls);
    const markdownPath = await this.saveMarkdown(ebookContent);
    await this.logger.success(`Compiled ebook: ${markdownPath}`);

    // Step 5: Convert to PDF (if requested)
    if (this.options.format === "pdf") {
      await this.logger.log("Converting to PDF...");
      try {
        await this.convertToPDF(markdownPath);
        await this.logger.success("Converted to PDF format");
      } catch (error) {
        await this.logger.error(`PDF conversion failed: ${error}`);
      }
    }

    await this.logger.success("eBook generation complete!");
  }

  private async generateTableOfContents(): Promise<TableOfContents> {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = `Generate a table of contents for an ebook about: "${this.options.topic}"

Requirements:
- Create exactly ${this.options.chapters} chapters
- Each chapter should have a clear title and brief description
- Chapters should flow logically and cover the topic comprehensively
- Target audience: ${this.options.audience}
- Writing style: ${this.options.style}
- Language: ${this.options.language}

Return ONLY a valid JSON object in this exact format (no markdown, no code blocks):
{
  "title": "Book Title",
  "chapters": [
    {
      "number": 1,
      "title": "Chapter Title",
      "description": "Brief chapter description"
    }
  ]
}`;

    const response = await this.generateText(prompt, systemPrompt);

    // Clean response - remove markdown code blocks if present
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.replace(/```json\n?/, "").replace(/```\n?$/, "").trim();
    }

    return JSON.parse(cleanedResponse);
  }

  private async generateChapter(chapter: { number: number; title: string; description: string }): Promise<ChapterContent> {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = `Write Chapter ${chapter.number}: "${chapter.title}"

Description: ${chapter.description}
Topic: ${this.options.topic}

Requirements:
- Maximum 2000 characters
- Target audience: ${this.options.audience}
- Writing style: ${this.options.style}
- Language: ${this.options.language}
- Include practical examples where relevant
- Make it engaging and informative

Write the full chapter content now:`;

    const content = await this.generateText(prompt, systemPrompt);

    return {
      number: chapter.number,
      title: chapter.title,
      content: content.trim(),
    };
  }

  private async generateChapterImage(chapter: { number: number; title: string; description: string }): Promise<string> {
    if (!this.openaiClient) {
      throw new Error("Image generation requires OpenAI API key");
    }

    const imagePrompt = `Create a professional, high-quality illustration for a book chapter titled "${chapter.title}".
Description: ${chapter.description}
Style: Clean, modern, and suitable for an educational/professional ebook.
Topic context: ${this.options.topic}`;

    const imageUrl = await this.openaiClient.generateImage(imagePrompt);

    // Download and save image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();

    const imagesDir = join(this.outputDir, "images");
    await mkdir(imagesDir, { recursive: true });

    const imagePath = join(imagesDir, `chapter-${String(chapter.number).padStart(2, "0")}.png`);
    await writeFile(imagePath, Buffer.from(imageBuffer));

    return imagePath;
  }

  private async compileEbook(
    toc: TableOfContents,
    chapters: ChapterContent[],
    imageUrls: Map<number, string>
  ): Promise<string> {
    let markdown = `# ${toc.title}\n\n`;
    markdown += `*Generated with skills.md create-ebook*\n\n`;
    markdown += `---\n\n`;

    // Table of contents
    markdown += `## Table of Contents\n\n`;
    for (const chapter of toc.chapters) {
      markdown += `${chapter.number}. [${chapter.title}](#chapter-${chapter.number})\n`;
    }
    markdown += `\n---\n\n`;

    // Chapters
    for (const chapter of chapters) {
      markdown += `## Chapter ${chapter.number}: ${chapter.title} {#chapter-${chapter.number}}\n\n`;

      // Add image if available
      if (imageUrls.has(chapter.number)) {
        const imagePath = imageUrls.get(chapter.number)!;
        const relativeImagePath = `./images/chapter-${String(chapter.number).padStart(2, "0")}.png`;
        markdown += `![Chapter ${chapter.number} Illustration](${relativeImagePath})\n\n`;
      }

      markdown += `${chapter.content}\n\n`;
      markdown += `---\n\n`;
    }

    return markdown;
  }

  private async saveTOC(toc: TableOfContents): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    const tocPath = join(this.outputDir, "toc.json");
    await writeFile(tocPath, JSON.stringify(toc, null, 2));
  }

  private async saveChapter(chapter: ChapterContent): Promise<void> {
    const chaptersDir = join(this.outputDir, "chapters");
    await mkdir(chaptersDir, { recursive: true });

    const chapterPath = join(chaptersDir, `chapter-${String(chapter.number).padStart(2, "0")}.md`);
    const content = `# Chapter ${chapter.number}: ${chapter.title}\n\n${chapter.content}`;
    await writeFile(chapterPath, content);
  }

  private async saveMarkdown(content: string): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });
    const markdownPath = join(this.outputDir, "ebook.md");
    await writeFile(markdownPath, content);
    return markdownPath;
  }

  private async convertToPDF(markdownPath: string): Promise<void> {
    const pdfPath = join(this.outputDir, "ebook.pdf");

    // Check if pandoc is available
    const pandocCheck = Bun.spawn(["which", "pandoc"]);
    await pandocCheck.exited;

    if (pandocCheck.exitCode !== 0) {
      throw new Error("pandoc not found. Install with: brew install pandoc (macOS) or apt-get install pandoc (Linux)");
    }

    // Convert using pandoc
    const pandoc = Bun.spawn([
      "pandoc",
      markdownPath,
      "-o",
      pdfPath,
      "--pdf-engine=xelatex",
      "-V",
      "geometry:margin=1in",
    ]);

    await pandoc.exited;

    if (pandoc.exitCode !== 0) {
      throw new Error(`PDF conversion failed with exit code ${pandoc.exitCode}`);
    }
  }

  private async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    if (this.openaiClient) {
      return this.openaiClient.generateText(prompt, systemPrompt);
    } else if (this.anthropicClient) {
      return this.anthropicClient.generateText(prompt, systemPrompt);
    } else {
      throw new Error("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY");
    }
  }

  private buildSystemPrompt(): string {
    const audienceContext = {
      beginner: "Write for beginners with simple language, clear explanations, and assume no prior knowledge.",
      intermediate: "Write for intermediate readers with moderate technical knowledge and some experience.",
      expert: "Write for experts with advanced technical knowledge and deep understanding of the subject.",
    };

    const styleContext = {
      educational: "Use a clear, instructional tone. Focus on teaching concepts step-by-step.",
      narrative: "Use storytelling and engaging prose. Make it compelling and enjoyable to read.",
      technical: "Use precise, technical language. Be concise and focus on accuracy.",
      casual: "Use a conversational, friendly tone. Make it approachable and easy to understand.",
    };

    return `You are an expert ebook writer. ${audienceContext[this.options.audience]} ${styleContext[this.options.style]} Write in ${this.options.language} language.`;
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArguments(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      chapters: { type: "string", default: "7" },
      style: { type: "string", default: "educational" },
      audience: { type: "string", default: "intermediate" },
      language: { type: "string", default: "en" },
      "ai-provider": { type: "string", default: "openai" },
      format: { type: "string", default: "markdown" },
      "include-images": { type: "string", default: "true" },
      output: { type: "string", default: join(SKILLS_OUTPUT_DIR, "exports", "create-ebook") },
      "save-intermediate": { type: "string", default: "true" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Create eBook - Generates complete ebooks with AI-powered content

Usage:
  skills run create-ebook -- [options] <topic>

Options:
  --chapters <n>       Number of chapters (5-10, default: 7)
  --style <style>      Writing style: educational, narrative, technical, casual
  --audience <level>   Target audience: beginner, intermediate, expert
  --language <code>    Language code (default: en)
  --ai-provider <name> AI provider: openai, anthropic (default: openai)
  --format <fmt>       Output format: markdown, pdf (default: markdown)
  --include-images     Generate chapter images (default: true)
  --output <path>      Output directory
  --save-intermediate  Save intermediate files (default: true)
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const topic = positionals[0];
  if (!topic) {
    throw new Error("Topic is required. Usage: skills run create-ebook -- \"Your Topic\"");
  }

  const chapters = parseInt(values.chapters as string, 10);
  if (isNaN(chapters) || chapters < 5 || chapters > 10) {
    throw new Error("Chapters must be between 5 and 10");
  }

  const style = values.style as string;
  if (!["educational", "narrative", "technical", "casual"].includes(style)) {
    throw new Error("Style must be: educational, narrative, technical, or casual");
  }

  const audience = values.audience as string;
  if (!["beginner", "intermediate", "expert"].includes(audience)) {
    throw new Error("Audience must be: beginner, intermediate, or expert");
  }

  const aiProvider = values["ai-provider"] as string;
  if (!["openai", "anthropic"].includes(aiProvider)) {
    throw new Error("AI provider must be: openai or anthropic");
  }

  const format = values.format as string;
  if (!["markdown", "pdf"].includes(format)) {
    throw new Error("Format must be: markdown or pdf");
  }

  return {
    topic,
    chapters,
    style: style as any,
    audience: audience as any,
    language: values.language as string,
    aiProvider: aiProvider as any,
    format: format as any,
    includeImages: values["include-images"] === "true",
    output: values.output as string,
    saveIntermediate: values["save-intermediate"] === "true",
  };
}

// ============================================================================
// Validation
// ============================================================================

function validateEnvironment(options: SkillOptions): void {
  if (options.aiProvider === "openai" && !OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI provider");
  }

  if (options.aiProvider === "anthropic" && !ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required for Anthropic provider");
  }

  if (options.includeImages && !OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for image generation (DALL-E)");
  }

  if (options.format === "pdf") {
    // Check will be done at conversion time
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const logger = new Logger();

  try {
    logger.log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);
    
    // Parse arguments
    const options = parseArguments();

    // Validate environment
    validateEnvironment(options);

    // Generate ebook
    const generator = new EbookGenerator(options, logger);
    await generator.generate();

    process.exit(0);
  } catch (error) {
    await logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
