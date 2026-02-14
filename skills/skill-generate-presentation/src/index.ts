#!/usr/bin/env bun

/**
 * Generate Presentation Skill
 *
 * Creates professional slide deck presentations from topics or content using AI.
 * Generates Marp-compatible markdown with speaker notes.
 */

import { parseArgs } from "util";
import { mkdir, writeFile, readFile, access } from "fs/promises";
import { join } from "path";
import { constants } from "fs";

// ============================================================================
// Types & Interfaces
// ============================================================================

interface SkillOptions {
  input: string;
  isFile: boolean;
  slides: number;
  style: "business" | "educational" | "pitch-deck" | "technical" | "minimal";
  format: "markdown" | "html" | "pdf";
  includeNotes: boolean;
  template: "default" | "modern" | "dark" | "minimal" | "corporate";
  aiProvider: "openai" | "anthropic";
  output: string;
  language: string;
}

interface SlideContent {
  number: number;
  title: string;
  content: string[];
  notes?: string;
  type: "title" | "agenda" | "content" | "summary" | "qa";
}

interface PresentationStructure {
  title: string;
  subtitle?: string;
  author: string;
  date: string;
  slides: SlideContent[];
}

// ============================================================================
// Security: HTML Escaping to prevent XSS
// ============================================================================

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

// ============================================================================
// Environment & Configuration
// ============================================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || ".skills";
const SKILLS_PROJECT_ROOT = process.env.SKILLS_PROJECT_ROOT || process.cwd();

// ============================================================================
// Logging Utility
// ============================================================================

class Logger {
  private logFile: string;
  private sessionId: string;

  constructor() {
    this.sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = join(
      SKILLS_PROJECT_ROOT,
      SKILLS_OUTPUT_DIR,
      "logs",
      "generate-presentation",
      `${this.sessionId}.log`
    );
    this.initLogFile();
  }

  private async initLogFile() {
    const logDir = join(
      SKILLS_PROJECT_ROOT,
      SKILLS_OUTPUT_DIR,
      "logs",
      "generate-presentation"
    );
    await mkdir(logDir, { recursive: true });
  }

  private timestamp(): string {
    return new Date().toISOString().replace("T", " ").split(".")[0];
  }

  async log(message: string) {
    const logMessage = `[${this.timestamp()}] ${message}`;
    console.log(logMessage);
    try {
      await writeFile(this.logFile, logMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }

  async error(message: string) {
    const errorMessage = `[${this.timestamp()}] ERROR: ${message}`;
    console.error(errorMessage);
    try {
      await writeFile(this.logFile, errorMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
  }

  async success(message: string) {
    const successMessage = `[${this.timestamp()}] SUCCESS: ${message}`;
    console.log(successMessage);
    try {
      await writeFile(this.logFile, successMessage + "\n", { flag: "a" });
    } catch (error) {
      // Silent fail for logging
    }
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
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
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
        max_tokens: 3000,
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
// Presentation Generator
// ============================================================================

class PresentationGenerator {
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
    await this.logger.log(`Starting presentation generation: "${this.options.input}"`);

    // Step 1: Load or prepare input content
    const inputContent = await this.loadInput();
    await this.logger.success(`Input content loaded`);

    // Step 2: Generate presentation structure
    const structure = await this.generateStructure(inputContent);
    await this.logger.success(`Generated presentation structure (${structure.slides.length} slides)`);

    // Step 3: Generate content for each slide
    await this.logger.log("Generating slide content...");
    for (let i = 0; i < structure.slides.length; i++) {
      const slide = structure.slides[i];
      await this.generateSlideContent(slide, inputContent);
      await this.logger.success(`Generated slide ${i + 1}/${structure.slides.length}: ${slide.title}`);
    }

    // Step 4: Compile presentation
    await this.logger.log("Compiling presentation...");
    const markdown = this.compileMarpMarkdown(structure);

    // Step 5: Save output
    await mkdir(this.outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T").join("-").substring(0, 19);
    const baseName = `presentation-${timestamp}`;

    const markdownPath = join(this.outputDir, `${baseName}.md`);
    await writeFile(markdownPath, markdown);
    await this.logger.success(`Saved Markdown: ${markdownPath}`);

    // Step 6: Convert to other formats if requested
    if (this.options.format === "html") {
      await this.convertToHTML(markdown, baseName);
    } else if (this.options.format === "pdf") {
      await this.convertToPDF(markdownPath, baseName);
    }

    // Save metadata
    const metadata = {
      title: structure.title,
      author: structure.author,
      date: structure.date,
      slides: structure.slides.length,
      style: this.options.style,
      format: this.options.format,
      generated: new Date().toISOString(),
    };
    await writeFile(
      join(this.outputDir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    await this.logger.success("Presentation generation complete!");
    console.log(`\nOutput: ${markdownPath}`);
    console.log(`Slides: ${structure.slides.length}`);
    console.log(`Style: ${this.options.style}`);

    if (this.options.format === "markdown") {
      console.log("\nTo convert to PowerPoint or PDF, install Marp CLI:");
      console.log("  npm install -g @marp-team/marp-cli");
      console.log(`  marp ${baseName}.md -o ${baseName}.pptx`);
      console.log(`  marp ${baseName}.md -o ${baseName}.pdf`);
    }
  }

  private async loadInput(): Promise<string> {
    if (this.options.isFile) {
      try {
        await access(this.options.input, constants.R_OK);
        const content = await readFile(this.options.input, "utf-8");
        return content;
      } catch (error) {
        throw new Error(`Cannot read file: ${this.options.input}`);
      }
    }
    return this.options.input;
  }

  private async generateStructure(inputContent: string): Promise<PresentationStructure> {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = `Generate a presentation structure for ${this.options.slides} slides about:

${inputContent}

Requirements:
- Style: ${this.options.style}
- Total slides: ${this.options.slides} (including title, agenda, summary, and Q&A)
- Language: ${this.options.language}
- Structure: Title slide + Agenda + Content slides + Summary + Q&A

Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "title": "Presentation Title",
  "subtitle": "Optional subtitle",
  "author": "skills.md",
  "date": "${new Date().toISOString().split('T')[0]}",
  "slides": [
    {
      "number": 1,
      "title": "Title",
      "content": [],
      "type": "title"
    },
    {
      "number": 2,
      "title": "Agenda",
      "content": ["Topic 1", "Topic 2", "Topic 3"],
      "type": "agenda"
    },
    {
      "number": 3,
      "title": "Content Slide Title",
      "content": ["Point 1", "Point 2", "Point 3"],
      "type": "content"
    }
  ]
}`;

    const response = await this.generateText(prompt, systemPrompt);

    // Clean response
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse
        .replace(/```json\n?/, "")
        .replace(/```\n?$/, "")
        .trim();
    }

    return JSON.parse(cleanedResponse);
  }

  private async generateSlideContent(slide: SlideContent, inputContent: string): Promise<void> {
    // Title and Q&A slides don't need AI-generated content
    if (slide.type === "title" || slide.type === "qa") {
      return;
    }

    const systemPrompt = this.buildSystemPrompt();
    const notesPrompt = this.options.includeNotes
      ? "\n\nAlso provide speaker notes (max 500 characters) for this slide."
      : "";

    const prompt = `Generate content for slide ${slide.number}: "${slide.title}"

Context: ${inputContent.substring(0, 1000)}

Requirements:
- Style: ${this.options.style}
- Type: ${slide.type}
- 3-5 concise bullet points
- Each point should be clear and impactful
- Language: ${this.options.language}${notesPrompt}

Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "content": ["Point 1", "Point 2", "Point 3"],
  "notes": "Speaker notes here"
}`;

    const response = await this.generateText(prompt, systemPrompt);

    // Clean response
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse
        .replace(/```json\n?/, "")
        .replace(/```\n?$/, "")
        .trim();
    }

    const result = JSON.parse(cleanedResponse);
    slide.content = result.content;
    if (this.options.includeNotes && result.notes) {
      slide.notes = result.notes;
    }
  }

  private compileMarpMarkdown(structure: PresentationStructure): string {
    const themeConfig = this.getThemeConfig();

    let markdown = `---
marp: true
theme: ${themeConfig.theme}
paginate: true
${themeConfig.backgroundColor ? `backgroundColor: ${themeConfig.backgroundColor}` : ""}
${themeConfig.color ? `color: ${themeConfig.color}` : ""}
---

`;

    for (const slide of structure.slides) {
      if (slide.type === "title") {
        markdown += `# ${structure.title}\n\n`;
        if (structure.subtitle) {
          markdown += `${structure.subtitle}\n\n`;
        }
        markdown += `${structure.author}\n`;
        markdown += `${structure.date}\n\n`;
      } else if (slide.type === "qa") {
        markdown += `## ${slide.title}\n\n`;
        markdown += `Thank you for your attention\n\n`;
        markdown += `Questions?\n\n`;
      } else {
        markdown += `## ${slide.title}\n\n`;

        if (slide.content && slide.content.length > 0) {
          for (const point of slide.content) {
            markdown += `- ${point}\n`;
          }
          markdown += `\n`;
        }
      }

      if (slide.notes && this.options.includeNotes) {
        markdown += `<!--\nSpeaker Notes:\n${slide.notes}\n-->\n\n`;
      }

      markdown += `---\n\n`;
    }

    return markdown.trim();
  }

  private getThemeConfig() {
    const configs = {
      default: { theme: "default" },
      modern: { theme: "default", backgroundColor: "#f8f9fa" },
      dark: { theme: "gaia", backgroundColor: "#1a1a1a", color: "#ffffff" },
      minimal: { theme: "uncover" },
      corporate: { theme: "default", backgroundColor: "#ffffff" },
    };

    return configs[this.options.template] || configs.default;
  }

  private async convertToHTML(markdown: string, baseName: string): Promise<void> {
    await this.logger.log("Converting to HTML...");

    // Generate a simple Reveal.js HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.0.4/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.0.4/dist/theme/white.css">
  <style>
    .reveal h1 { font-size: 2.5em; }
    .reveal h2 { font-size: 2em; }
    .reveal ul { font-size: 1.2em; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${this.markdownToRevealJS(markdown)}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.0.4/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      transition: 'slide'
    });
  </script>
</body>
</html>`;

    const htmlPath = join(this.outputDir, `${baseName}.html`);
    await writeFile(htmlPath, html);
    await this.logger.success(`Saved HTML: ${htmlPath}`);
  }

  private markdownToRevealJS(markdown: string): string {
    const slides = markdown.split("---\n");
    let html = "";

    for (const slide of slides) {
      const trimmed = slide.trim();
      if (!trimmed || trimmed.startsWith("marp:") || trimmed.startsWith("theme:")) {
        continue;
      }

      // Remove speaker notes
      const content = trimmed.replace(/<!--[\s\S]*?-->/g, "");

      // Convert markdown to HTML with proper escaping
      // First escape all content, then process markdown syntax
      const lines = content.split("\n");
      let slideHTML = "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith("# ")) {
          // H1 heading
          slideHTML += `<h1>${escapeHtml(trimmedLine.slice(2))}</h1>\n`;
        } else if (trimmedLine.startsWith("## ")) {
          // H2 heading
          slideHTML += `<h2>${escapeHtml(trimmedLine.slice(3))}</h2>\n`;
        } else if (trimmedLine.startsWith("- ")) {
          // List item - collect consecutive list items
          slideHTML += `<li>${escapeHtml(trimmedLine.slice(2))}</li>\n`;
        } else {
          // Regular text
          slideHTML += `<p>${escapeHtml(trimmedLine)}</p>\n`;
        }
      }

      // Wrap consecutive list items in ul tags
      slideHTML = slideHTML.replace(/(<li>[\s\S]*?<\/li>\n)+/g, (match) => `<ul>\n${match}</ul>\n`);

      html += `      <section>\n${slideHTML}      </section>\n`;
    }

    return html;
  }

  private async convertToPDF(markdownPath: string, baseName: string): Promise<void> {
    await this.logger.log("Converting to PDF...");

    // Check if Marp CLI is available
    const marpCheck = Bun.spawn(["which", "marp"]);
    await marpCheck.exited;

    if (marpCheck.exitCode === 0) {
      // Use Marp CLI
      const pdfPath = join(this.outputDir, `${baseName}.pdf`);
      const marp = Bun.spawn(["marp", markdownPath, "-o", pdfPath, "--allow-local-files"]);
      await marp.exited;

      if (marp.exitCode === 0) {
        await this.logger.success(`Saved PDF: ${pdfPath}`);
        return;
      }
    }

    // Fallback to Pandoc
    const pandocCheck = Bun.spawn(["which", "pandoc"]);
    await pandocCheck.exited;

    if (pandocCheck.exitCode !== 0) {
      throw new Error("PDF conversion requires either Marp CLI or Pandoc. Install with: npm install -g @marp-team/marp-cli");
    }

    const pdfPath = join(this.outputDir, `${baseName}.pdf`);
    const pandoc = Bun.spawn([
      "pandoc",
      markdownPath,
      "-o",
      pdfPath,
      "-t",
      "beamer",
      "--pdf-engine=xelatex",
    ]);

    await pandoc.exited;

    if (pandoc.exitCode !== 0) {
      throw new Error(`PDF conversion failed with exit code ${pandoc.exitCode}`);
    }

    await this.logger.success(`Saved PDF: ${pdfPath}`);
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
    const styleContext = {
      business: "Create professional, corporate-style content. Focus on metrics, ROI, and business value. Use formal language.",
      educational: "Create clear, instructional content. Focus on teaching and explaining. Use simple, accessible language.",
      "pitch-deck": "Create compelling, persuasive content. Focus on problem-solution and opportunity. Use engaging, impactful language.",
      technical: "Create detailed, technical content. Focus on architecture, implementation, and best practices. Use precise terminology.",
      minimal: "Create concise, impactful content. Focus on key points only. Use brief, powerful statements.",
    };

    return `You are an expert presentation designer. ${styleContext[this.options.style]} Create content optimized for slides with 3-5 bullet points per slide. Each point should be concise yet meaningful. Write in ${this.options.language} language.`;
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

function showHelp(): void {
  console.log(`
skill-generate-presentation - Create professional slide deck presentations using AI

Usage:
  skills run generate-presentation -- "<topic or content>" [options]
  skills run generate-presentation -- ./content.md [options]

Options:
  -h, --help                 Show this help message
  --slides <number>          Number of slides (5-30, default: 10)
  --style <type>             Presentation style:
                             business | educational | pitch-deck | technical | minimal
  --format <type>            Output format: markdown | html | pdf (default: markdown)
  --include-notes            Include speaker notes
  --template <type>          Theme: default | modern | dark | minimal | corporate
  --ai-provider <type>       AI provider: openai | anthropic (default: openai)
  --language <code>          Language code (e.g., en, es, fr)
  --output <path>            Output directory

Examples:
  skills run generate-presentation -- "Introduction to Machine Learning"
  skills run generate-presentation -- "Company Q4 Review" --style business --slides 15
  skills run generate-presentation -- ./outline.md --format pdf --template dark

Requirements:
  Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable.
`);
}

function parseArguments(): SkillOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      slides: { type: "string", default: "10" },
      style: { type: "string", default: "business" },
      format: { type: "string", default: "markdown" },
      "include-notes": { type: "string", default: "false" },
      template: { type: "string", default: "default" },
      "ai-provider": { type: "string", default: "openai" },
      output: { type: "string", default: join(SKILLS_OUTPUT_DIR, "exports", "generate-presentation") },
      language: { type: "string", default: "en" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const input = positionals[0];
  if (!input) {
    throw new Error("Input is required. Usage: skills run generate-presentation -- \"Your Topic\" or ./file.md");
  }

  // Check if input is a file path
  let isFile = false;
  try {
    // Simple heuristic: if it has a path separator or file extension, treat as file
    isFile = input.includes("/") || input.includes("\\") || input.includes(".");
  } catch (error) {
    isFile = false;
  }

  const slides = parseInt(values.slides as string, 10);
  if (isNaN(slides) || slides < 5 || slides > 30) {
    throw new Error("Slides must be between 5 and 30");
  }

  const style = values.style as string;
  if (!["business", "educational", "pitch-deck", "technical", "minimal"].includes(style)) {
    throw new Error("Style must be: business, educational, pitch-deck, technical, or minimal");
  }

  const format = values.format as string;
  if (!["markdown", "html", "pdf"].includes(format)) {
    throw new Error("Format must be: markdown, html, or pdf");
  }

  const template = values.template as string;
  if (!["default", "modern", "dark", "minimal", "corporate"].includes(template)) {
    throw new Error("Template must be: default, modern, dark, minimal, or corporate");
  }

  const aiProvider = values["ai-provider"] as string;
  if (!["openai", "anthropic"].includes(aiProvider)) {
    throw new Error("AI provider must be: openai or anthropic");
  }

  return {
    input,
    isFile,
    slides,
    style: style as any,
    format: format as any,
    includeNotes: values["include-notes"] === "true",
    template: template as any,
    aiProvider: aiProvider as any,
    output: values.output as string,
    language: values.language as string,
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
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const logger = new Logger();

  try {
    console.log("🎨 Generate Presentation - Starting...\n");

    // Parse arguments
    const options = parseArguments();

    // Validate environment
    validateEnvironment(options);

    // Generate presentation
    const generator = new PresentationGenerator(options, logger);
    await generator.generate();

    console.log("\n✅ Done!");
    process.exit(0);
  } catch (error) {
    await logger.error(error instanceof Error ? error.message : String(error));
    console.error("\nUsage: skills run generate-presentation -- \"Your Topic\" [options]");
    console.error("       skills run generate-presentation -- ./content.md [options]");
    console.error("\nOptions:");
    console.error("  --slides <number>        Number of slides (5-30, default: 10)");
    console.error("  --style <type>           Style: business, educational, pitch-deck, technical, minimal");
    console.error("  --format <type>          Format: markdown, html, pdf");
    console.error("  --include-notes          Include speaker notes");
    console.error("  --template <type>        Template: default, modern, dark, minimal, corporate");
    console.error("  --ai-provider <type>     Provider: openai, anthropic");
    console.error("  --language <code>        Language code (e.g., en, es, fr)");
    process.exit(1);
  }
}

main();
