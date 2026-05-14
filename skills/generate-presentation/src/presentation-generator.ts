import { access, mkdir, readFile, writeFile } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { AnthropicClient, OpenAIClient } from "./ai-clients";
import { Logger } from "./logger";
import { envConfig } from "./runtime";
import { escapeHtml } from "./security";
import type { PresentationStructure, SkillOptions, SlideContent } from "./types";

// Presentation Generator
// ============================================================================

export class PresentationGenerator {
  private logger: Logger;
  private options: SkillOptions;
  private outputDir: string;
  private openaiClient?: OpenAIClient;
  private anthropicClient?: AnthropicClient;

  constructor(options: SkillOptions, logger: Logger) {
    this.logger = logger;
    this.options = options;
    this.outputDir = join(envConfig.SKILLS_PROJECT_ROOT, options.output);

    // Initialize AI clients
    if (options.aiProvider === "openai" && envConfig.OPENAI_API_KEY) {
      this.openaiClient = new OpenAIClient(envConfig.OPENAI_API_KEY);
    } else if (options.aiProvider === "anthropic" && envConfig.ANTHROPIC_API_KEY) {
      this.anthropicClient = new AnthropicClient(envConfig.ANTHROPIC_API_KEY);
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

  private getThemeConfig(): { theme: string; backgroundColor?: string; color?: string } {
    const configs: Record<SkillOptions["template"], { theme: string; backgroundColor?: string; color?: string }> = {
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
