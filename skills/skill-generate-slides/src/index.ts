#!/usr/bin/env bun

/**
 * Generate Slides - Enhanced Presentation Generation Skill
 *
 * Features:
 * - AI-powered slide generation from topics
 * - PPTX export with pptxgenjs
 * - PDF export with puppeteer
 * - HTML/Reveal.js export
 * - Multiple themes and branding options
 */

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, access, unlink } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { constants } from "node:fs";
import PptxGenJS from "pptxgenjs";
import OpenAI from "openai";

// Types
interface SlideOptions {
  // Input
  inputFile?: string;
  text?: string;
  topic?: string;
  outline: boolean;

  // AI Generation
  aiGenerate: boolean;
  slideCount: number;
  audience: string;
  style: string;
  language: string;
  includeImages: boolean;

  // Output
  format: "pptx" | "pdf" | "html" | "revealjs";
  output?: string;
  dir: string;

  // Theme
  theme: "corporate" | "creative" | "minimal" | "dark" | "light" | "tech";

  // Content
  title?: string;
  author?: string;
  date: string;
  notes: boolean;
  footer?: string;
  slideNumbers: boolean;

  // Layout
  aspectRatio: "16:9" | "4:3" | "16:10";

  // Branding
  logo?: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  primaryColor?: string;
  secondaryColor?: string;
  font?: string;

  // Animation
  transition: "none" | "fade" | "slide" | "convex" | "concave" | "zoom";
  transitionSpeed: "slow" | "default" | "fast";

  // Code
  codeTheme: string;
  lineNumbers: boolean;
}

interface Slide {
  type: "title" | "content" | "two-column" | "image" | "code" | "quote" | "bullets";
  title?: string;
  subtitle?: string;
  content: string[];
  notes?: string;
  backgroundImage?: string;
  columns?: { left: string[]; right: string[] };
  codeLanguage?: string;
  imageUrl?: string;
  imagePrompt?: string;
}

interface Presentation {
  title: string;
  subtitle?: string;
  author?: string;
  date: string;
  slides: Slide[];
  metadata: Record<string, any>;
}

// Theme colors
const THEME_COLORS: Record<string, { primary: string; secondary: string; background: string; text: string; accent: string }> = {
  corporate: { primary: "003366", secondary: "0066CC", background: "FFFFFF", text: "333333", accent: "FF6B35" },
  creative: { primary: "FF6B35", secondary: "004E89", background: "FFFFFF", text: "333333", accent: "7209B7" },
  minimal: { primary: "2C3E50", secondary: "7F8C8D", background: "FFFFFF", text: "333333", accent: "3498DB" },
  dark: { primary: "00AAFF", secondary: "FF5577", background: "1A1A2E", text: "EAEAEA", accent: "00FF88" },
  light: { primary: "3498DB", secondary: "9B59B6", background: "F8F9FA", text: "2C3E50", accent: "E74C3C" },
  tech: { primary: "00FF88", secondary: "FF00FF", background: "0A0E27", text: "EAEAEA", accent: "00AAFF" },
};

// Parse command line arguments
function parseArguments(): SlideOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      // Input
      text: { type: "string" },
      topic: { type: "string" },
      outline: { type: "boolean", default: false },

      // AI Generation
      "ai-generate": { type: "boolean", default: false },
      "slide-count": { type: "string", default: "8" },
      audience: { type: "string", default: "general" },
      style: { type: "string", default: "professional" },
      language: { type: "string", default: "en" },
      "include-images": { type: "boolean", default: false },

      // Output
      format: { type: "string", default: "pptx" },
      output: { type: "string" },
      dir: { type: "string", default: "" },

      // Theme
      theme: { type: "string", default: "minimal" },

      // Content
      title: { type: "string" },
      author: { type: "string" },
      date: { type: "string", default: new Date().toISOString().split("T")[0] },
      notes: { type: "boolean", default: true },
      footer: { type: "string" },
      "slide-numbers": { type: "boolean", default: true },

      // Layout
      "aspect-ratio": { type: "string", default: "16:9" },

      // Branding
      logo: { type: "string" },
      "logo-position": { type: "string", default: "bottom-right" },
      "primary-color": { type: "string" },
      "secondary-color": { type: "string" },
      font: { type: "string" },

      // Animation
      transition: { type: "string", default: "fade" },
      "transition-speed": { type: "string", default: "default" },

      // Code
      "code-theme": { type: "string", default: "github" },
      "line-numbers": { type: "boolean", default: false },

      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const outputDir =
    values.dir ||
    (process.env.SKILLS_OUTPUT_DIR
      ? join(process.env.SKILLS_OUTPUT_DIR, "exports", "generate-slides")
      : join(process.cwd(), ".skills", "exports", "generate-slides"));

  return {
    inputFile: positionals[0],
    text: values.text as string | undefined,
    topic: values.topic as string | undefined,
    outline: values.outline as boolean,
    aiGenerate: values["ai-generate"] as boolean,
    slideCount: parseInt(values["slide-count"] as string) || 8,
    audience: values.audience as string,
    style: values.style as string,
    language: values.language as string,
    includeImages: values["include-images"] as boolean,
    format: values.format as any,
    output: values.output as string | undefined,
    dir: outputDir,
    theme: values.theme as any,
    title: values.title as string | undefined,
    author: values.author as string | undefined,
    date: values.date as string,
    notes: values.notes as boolean,
    footer: values.footer as string | undefined,
    slideNumbers: values["slide-numbers"] as boolean,
    aspectRatio: values["aspect-ratio"] as any,
    logo: values.logo as string | undefined,
    logoPosition: values["logo-position"] as any,
    primaryColor: values["primary-color"] as string | undefined,
    secondaryColor: values["secondary-color"] as string | undefined,
    font: values.font as string | undefined,
    transition: values.transition as any,
    transitionSpeed: values["transition-speed"] as any,
    codeTheme: values["code-theme"] as string,
    lineNumbers: values["line-numbers"] as boolean,
  };
}

function printHelp(): void {
  console.log(`
Generate Slides - Create presentations from markdown or AI

Usage:
  skills run generate-slides -- [input.md] [options]
  skills run generate-slides -- --topic "Your Topic" --ai-generate [options]

AI Generation:
  --topic <text>          Topic for AI to generate slides about
  --ai-generate           Enable AI slide generation
  --slide-count <n>       Number of slides to generate (default: 8)
  --audience <type>       Target audience: general, technical, executive, students
  --style <type>          Presentation style: professional, casual, academic, sales
  --language <code>       Language code: en, es, fr, de, etc.
  --include-images        Generate image suggestions for each slide

Input:
  [file]                  Markdown file with slide content
  --text <markdown>       Direct markdown text input

Output:
  --format <type>         Output format: pptx, pdf, html, revealjs (default: pptx)
  -o, --output <path>     Output file path
  --dir <path>            Output directory

Theme & Branding:
  --theme <name>          Theme: corporate, creative, minimal, dark, light, tech
  --primary-color <hex>   Primary color (without #)
  --secondary-color <hex> Secondary color
  --font <name>           Font family
  --logo <path>           Logo image file
  --logo-position <pos>   Logo position: top-left, top-right, bottom-left, bottom-right

Content:
  --title <text>          Presentation title
  --author <text>         Author name
  --notes                 Include speaker notes (default: true)
  --slide-numbers         Show slide numbers (default: true)
  --footer <text>         Footer text

Examples:
  # AI-generated presentation
  skills run generate-slides -- --topic "Introduction to Machine Learning" --ai-generate --format pptx

  # From markdown file
  skills run generate-slides -- presentation.md --format pptx --theme corporate

  # Quick HTML presentation
  skills run generate-slides -- --topic "Q4 Results" --ai-generate --format html --theme dark
`);
}

// ============================================================================
// AI GENERATION
// ============================================================================

async function generateSlidesWithAI(options: SlideOptions): Promise<Presentation> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI generation");
  }

  const openai = new OpenAI({ apiKey });

  console.log("🤖 Generating slides with AI...");
  console.log(`   Topic: ${options.topic}`);
  console.log(`   Slides: ${options.slideCount}`);
  console.log(`   Audience: ${options.audience}`);
  console.log(`   Style: ${options.style}`);

  const systemPrompt = `You are an expert presentation designer. Create engaging, well-structured slide content.
Return ONLY valid JSON with no additional text or markdown formatting.`;

  const userPrompt = `Create a ${options.slideCount}-slide presentation about: "${options.topic}"

Target audience: ${options.audience}
Style: ${options.style}
Language: ${options.language}
Include speaker notes: ${options.notes}

Return a JSON object with this exact structure:
{
  "title": "Main presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    {
      "type": "title",
      "title": "Slide title",
      "subtitle": "Optional subtitle for title slide",
      "content": [],
      "notes": "Speaker notes for this slide"
    },
    {
      "type": "bullets",
      "title": "Slide Title",
      "content": ["Bullet point 1", "Bullet point 2", "Bullet point 3"],
      "notes": "Speaker notes"
    },
    {
      "type": "two-column",
      "title": "Comparison Title",
      "columns": {
        "left": ["Left point 1", "Left point 2"],
        "right": ["Right point 1", "Right point 2"]
      },
      "notes": "Speaker notes"
    },
    {
      "type": "quote",
      "title": "Key Insight",
      "content": ["The quote or key message here"],
      "notes": "Speaker notes"
    }
  ]
}

Slide types available: title, bullets, content, two-column, quote, image
- First slide should be type "title"
- Last slide should be a conclusion/thank you
- Use variety of slide types
- Keep bullet points concise (5-8 words each)
- Include 3-5 bullet points per slide
- Make content engaging and valuable`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";

    // Extract JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Clean up common issues
    jsonStr = jsonStr.trim();
    if (!jsonStr.startsWith("{")) {
      const startIdx = jsonStr.indexOf("{");
      if (startIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx);
      }
    }

    const data = JSON.parse(jsonStr);

    console.log(`   ✓ Generated ${data.slides?.length || 0} slides`);

    return {
      title: data.title || options.topic || "Presentation",
      subtitle: data.subtitle,
      author: options.author,
      date: options.date,
      slides: data.slides || [],
      metadata: { generatedBy: "AI", topic: options.topic },
    };
  } catch (error: any) {
    console.error("AI generation error:", error.message);
    throw new Error(`Failed to generate slides: ${error.message}`);
  }
}

// ============================================================================
// MARKDOWN PARSING
// ============================================================================

function parseMarkdown(content: string, options: SlideOptions): Presentation {
  const lines = content.split("\n");
  const slides: Slide[] = [];
  let currentSlide: Slide | null = null;
  let inNotes = false;
  let inColumns = false;
  let currentColumn: "left" | "right" | null = null;
  let inCodeBlock = false;
  let metadata: Record<string, any> = {};

  // Extract frontmatter
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Frontmatter handling
    if (trimmed === "---" && i === 0) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      metadata = parseFrontmatter(frontmatterLines.join("\n"));
      continue;
    }
    if (inFrontmatter) {
      frontmatterLines.push(line);
      continue;
    }

    // Code block tracking
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (!currentSlide) currentSlide = { type: "content", content: [] };
      if (inCodeBlock) {
        const lang = trimmed.substring(3).trim();
        if (lang) currentSlide.codeLanguage = lang;
        currentSlide.type = "code";
      }
      currentSlide.content.push(line);
      continue;
    }

    if (inCodeBlock) {
      if (currentSlide) currentSlide.content.push(line);
      continue;
    }

    // Slide separator
    if ((trimmed === "---" || trimmed === "===") && !inFrontmatter) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = { type: "bullets", content: [] };
      inNotes = false;
      inColumns = false;
      currentColumn = null;
      continue;
    }

    // Notes block
    if (trimmed === "::: notes" || trimmed.startsWith("::: notes")) {
      inNotes = true;
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      currentSlide.notes = "";
      continue;
    }
    if (inNotes && trimmed === ":::") {
      inNotes = false;
      continue;
    }
    if (inNotes) {
      if (currentSlide) {
        currentSlide.notes = (currentSlide.notes || "") + line + "\n";
      }
      continue;
    }

    // Columns block
    if (trimmed === "::: columns") {
      inColumns = true;
      if (!currentSlide) currentSlide = { type: "two-column", content: [] };
      currentSlide.type = "two-column";
      currentSlide.columns = { left: [], right: [] };
      continue;
    }
    if (trimmed === ":::: column") {
      currentColumn = currentColumn ? "right" : "left";
      continue;
    }
    if (trimmed === "::::" && currentColumn) {
      currentColumn = null;
      continue;
    }
    if (trimmed === ":::" && inColumns) {
      inColumns = false;
      continue;
    }
    if (inColumns && currentColumn && currentSlide?.columns) {
      currentSlide.columns[currentColumn].push(trimmed);
      continue;
    }

    // Title slide (# heading)
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = {
        type: "title",
        title: trimmed.substring(2),
        content: [],
      };
      continue;
    }

    // Content slide (## heading)
    if (trimmed.startsWith("## ")) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = {
        type: "bullets",
        title: trimmed.substring(3),
        content: [],
      };
      continue;
    }

    // Subheading (### heading)
    if (trimmed.startsWith("### ")) {
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      currentSlide.subtitle = trimmed.substring(4);
      continue;
    }

    // Quote block
    if (trimmed.startsWith("> ")) {
      if (!currentSlide) currentSlide = { type: "quote", content: [] };
      currentSlide.type = "quote";
      currentSlide.content.push(trimmed.substring(2));
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.match(/^\d+\. /)) {
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      const bulletContent = trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      currentSlide.content.push(bulletContent);
      continue;
    }

    // Image
    if (trimmed.match(/^!\[.*?\]\(.*?\)$/)) {
      if (!currentSlide) currentSlide = { type: "image", content: [] };
      const match = trimmed.match(/^!\[.*?\]\((.*?)\)$/);
      if (match) {
        currentSlide.type = "image";
        currentSlide.imageUrl = match[1];
      }
      continue;
    }

    // Regular content
    if (trimmed && !currentSlide) {
      currentSlide = { type: "content", content: [] };
    }
    if (currentSlide && trimmed) {
      currentSlide.content.push(trimmed);
    }
  }

  // Add last slide
  if (currentSlide) slides.push(currentSlide);

  const title = options.title || metadata.title || (slides[0]?.type === "title" ? slides[0].title : "Presentation");

  return {
    title,
    subtitle: metadata.subtitle,
    author: options.author || metadata.author,
    date: options.date,
    slides,
    metadata,
  };
}

function parseFrontmatter(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }

  return result;
}

// ============================================================================
// PPTX GENERATION
// ============================================================================

async function generatePPTX(presentation: Presentation, options: SlideOptions): Promise<Buffer> {
  console.log("📊 Generating PPTX...");

  const pptx = new PptxGenJS();
  const theme = THEME_COLORS[options.theme] || THEME_COLORS.minimal;
  const primaryColor = options.primaryColor || theme.primary;
  const secondaryColor = options.secondaryColor || theme.secondary;

  // Set presentation properties
  pptx.title = presentation.title;
  pptx.author = presentation.author || "skills.md";
  pptx.subject = presentation.title;
  pptx.company = "Generated by skills.md";

  // Set layout
  if (options.aspectRatio === "16:9") {
    pptx.layout = "LAYOUT_WIDE";
  } else if (options.aspectRatio === "4:3") {
    pptx.layout = "LAYOUT_4x3";
  }

  // Define master slide
  pptx.defineSlideMaster({
    title: "MASTER_SLIDE",
    background: { color: theme.background },
    objects: [
      // Footer
      ...(options.footer
        ? [
            {
              text: {
                text: options.footer,
                options: {
                  x: 0.5,
                  y: "92%",
                  w: "40%",
                  h: 0.3,
                  fontSize: 10,
                  color: theme.text,
                  align: "left" as const,
                },
              },
            },
          ]
        : []),
      // Slide number placeholder
      ...(options.slideNumbers
        ? [
            {
              text: {
                text: "SLIDE_NUMBER",
                options: {
                  x: "90%",
                  y: "92%",
                  w: 0.5,
                  h: 0.3,
                  fontSize: 10,
                  color: theme.text,
                  align: "right" as const,
                },
              },
            },
          ]
        : []),
    ],
  });

  // Process each slide
  for (let i = 0; i < presentation.slides.length; i++) {
    const slideData = presentation.slides[i];
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // Add slide number
    if (options.slideNumbers && i > 0) {
      slide.addText(`${i + 1}`, {
        x: "92%",
        y: "92%",
        w: 0.5,
        h: 0.3,
        fontSize: 10,
        color: theme.text,
        align: "right",
      });
    }

    switch (slideData.type) {
      case "title":
        // Title slide
        slide.addText(slideData.title || presentation.title, {
          x: 0.5,
          y: "35%",
          w: "90%",
          h: 1.5,
          fontSize: 44,
          bold: true,
          color: primaryColor,
          align: "center",
        });

        if (slideData.subtitle || presentation.subtitle) {
          slide.addText(slideData.subtitle || presentation.subtitle || "", {
            x: 0.5,
            y: "55%",
            w: "90%",
            h: 0.8,
            fontSize: 24,
            color: secondaryColor,
            align: "center",
          });
        }

        if (presentation.author) {
          slide.addText(presentation.author, {
            x: 0.5,
            y: "70%",
            w: "90%",
            h: 0.5,
            fontSize: 18,
            color: theme.text,
            align: "center",
          });
        }

        slide.addText(presentation.date, {
          x: 0.5,
          y: "78%",
          w: "90%",
          h: 0.4,
          fontSize: 14,
          color: theme.text,
          align: "center",
        });
        break;

      case "bullets":
      case "content":
        // Content slide with bullets
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            w: "90%",
            h: 0.8,
            fontSize: 32,
            bold: true,
            color: primaryColor,
          });
        }

        if (slideData.content.length > 0) {
          const bullets = slideData.content.map((text) => ({
            text,
            options: { bullet: { type: "bullet" as const }, indentLevel: 0 },
          }));

          slide.addText(bullets, {
            x: 0.5,
            y: slideData.title ? 1.5 : 0.5,
            w: "90%",
            h: 4,
            fontSize: 20,
            color: theme.text,
            valign: "top",
            paraSpaceAfter: 12,
          });
        }
        break;

      case "two-column":
        // Two-column layout
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            w: "90%",
            h: 0.8,
            fontSize: 32,
            bold: true,
            color: primaryColor,
          });
        }

        if (slideData.columns) {
          // Left column
          const leftBullets = slideData.columns.left.map((text) => ({
            text,
            options: { bullet: { type: "bullet" as const }, indentLevel: 0 },
          }));
          slide.addText(leftBullets, {
            x: 0.5,
            y: 1.5,
            w: "44%",
            h: 3.5,
            fontSize: 18,
            color: theme.text,
            valign: "top",
            paraSpaceAfter: 10,
          });

          // Right column
          const rightBullets = slideData.columns.right.map((text) => ({
            text,
            options: { bullet: { type: "bullet" as const }, indentLevel: 0 },
          }));
          slide.addText(rightBullets, {
            x: "52%",
            y: 1.5,
            w: "44%",
            h: 3.5,
            fontSize: 18,
            color: theme.text,
            valign: "top",
            paraSpaceAfter: 10,
          });
        }
        break;

      case "quote":
        // Quote slide
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            w: "90%",
            h: 0.8,
            fontSize: 28,
            bold: true,
            color: primaryColor,
          });
        }

        const quoteText = slideData.content.join(" ");
        slide.addText(`"${quoteText}"`, {
          x: 1,
          y: "35%",
          w: "80%",
          h: 2,
          fontSize: 28,
          italic: true,
          color: secondaryColor,
          align: "center",
          valign: "middle",
        });
        break;

      case "code":
        // Code slide
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            w: "90%",
            h: 0.8,
            fontSize: 32,
            bold: true,
            color: primaryColor,
          });
        }

        const codeContent = slideData.content.join("\n");
        slide.addText(codeContent, {
          x: 0.5,
          y: 1.5,
          w: "90%",
          h: 4,
          fontSize: 12,
          fontFace: "Courier New",
          color: options.theme === "dark" ? "EAEAEA" : "333333",
          fill: { color: options.theme === "dark" ? "2D2D2D" : "F5F5F5" },
          valign: "top",
        });
        break;

      case "image":
        // Image slide
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            w: "90%",
            h: 0.8,
            fontSize: 32,
            bold: true,
            color: primaryColor,
          });
        }

        // Placeholder for image
        slide.addText("[Image: " + (slideData.imageUrl || slideData.imagePrompt || "Insert image here") + "]", {
          x: 1,
          y: 1.5,
          w: "80%",
          h: 3.5,
          fontSize: 16,
          color: theme.text,
          align: "center",
          valign: "middle",
          fill: { color: "EEEEEE" },
        });
        break;
    }

    // Add speaker notes
    if (slideData.notes && options.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  // Add logo if specified
  if (options.logo) {
    try {
      const logoData = await readFile(options.logo);
      const logoBase64 = logoData.toString("base64");
      const ext = extname(options.logo).toLowerCase().replace(".", "");

      for (let i = 0; i < pptx.slides.length; i++) {
        const logoPos = {
          "top-left": { x: 0.3, y: 0.2 },
          "top-right": { x: 8.5, y: 0.2 },
          "bottom-left": { x: 0.3, y: 4.8 },
          "bottom-right": { x: 8.5, y: 4.8 },
        }[options.logoPosition];

        pptx.slides[i].addImage({
          data: `image/${ext};base64,${logoBase64}`,
          x: logoPos.x,
          y: logoPos.y,
          w: 1,
          h: 0.5,
        });
      }
    } catch (error) {
      console.warn("   ⚠️  Could not add logo:", (error as Error).message);
    }
  }

  // Generate buffer
  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return buffer as Buffer;
}

// ============================================================================
// HTML GENERATION
// ============================================================================

function generateHTML(presentation: Presentation, options: SlideOptions): string {
  const theme = THEME_COLORS[options.theme] || THEME_COLORS.minimal;
  const primaryColor = options.primaryColor || theme.primary;
  const secondaryColor = options.secondaryColor || theme.secondary;

  const slidesHTML = presentation.slides
    .map((slide, index) => {
      let content = "";

      switch (slide.type) {
        case "title":
          content = `
          <div class="slide slide-title">
            <h1>${slide.title || presentation.title}</h1>
            ${slide.subtitle || presentation.subtitle ? `<h2>${slide.subtitle || presentation.subtitle}</h2>` : ""}
            ${presentation.author ? `<p class="author">${presentation.author}</p>` : ""}
            <p class="date">${presentation.date}</p>
          </div>
        `;
          break;

        case "two-column":
          content = `
          <div class="slide">
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <div class="two-column">
              <div class="column">
                <ul>${slide.columns?.left.map((item) => `<li>${item}</li>`).join("") || ""}</ul>
              </div>
              <div class="column">
                <ul>${slide.columns?.right.map((item) => `<li>${item}</li>`).join("") || ""}</ul>
              </div>
            </div>
            ${options.slideNumbers ? `<div class="slide-number">${index + 1}</div>` : ""}
          </div>
        `;
          break;

        case "quote":
          content = `
          <div class="slide slide-quote">
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <blockquote>"${slide.content.join(" ")}"</blockquote>
            ${options.slideNumbers ? `<div class="slide-number">${index + 1}</div>` : ""}
          </div>
        `;
          break;

        case "code":
          content = `
          <div class="slide">
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <pre><code class="language-${slide.codeLanguage || "text"}">${escapeHTML(slide.content.join("\n"))}</code></pre>
            ${options.slideNumbers ? `<div class="slide-number">${index + 1}</div>` : ""}
          </div>
        `;
          break;

        default:
          content = `
          <div class="slide">
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <ul>${slide.content.map((item) => `<li>${item}</li>`).join("")}</ul>
            ${options.slideNumbers ? `<div class="slide-number">${index + 1}</div>` : ""}
          </div>
        `;
      }

      return content;
    })
    .join("\n");

  const css = `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ${options.font || "system-ui"}, -apple-system, sans-serif;
      background: #${theme.background};
      color: #${theme.text};
      line-height: 1.6;
    }

    .slide {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 4rem 6rem;
      page-break-after: always;
    }

    .slide-title {
      text-align: center;
      align-items: center;
    }

    .slide-title h1 {
      font-size: 3.5rem;
      color: #${primaryColor};
      margin-bottom: 1rem;
    }

    .slide-title h2 {
      font-size: 1.8rem;
      color: #${secondaryColor};
      font-weight: normal;
      margin-bottom: 2rem;
    }

    .slide-title .author { font-size: 1.3rem; margin-bottom: 0.5rem; }
    .slide-title .date { font-size: 1rem; opacity: 0.7; }

    .slide h2 {
      font-size: 2.5rem;
      color: #${primaryColor};
      margin-bottom: 2rem;
    }

    .slide ul {
      font-size: 1.5rem;
      margin-left: 2rem;
    }

    .slide li {
      margin-bottom: 1rem;
      line-height: 1.8;
    }

    .two-column {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3rem;
      flex: 1;
    }

    .slide-quote blockquote {
      font-size: 2rem;
      font-style: italic;
      color: #${secondaryColor};
      text-align: center;
      max-width: 80%;
      margin: 0 auto;
    }

    pre {
      background: ${options.theme === "dark" ? "#2d2d2d" : "#f5f5f5"};
      padding: 1.5rem;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 1rem;
    }

    code { font-family: 'Monaco', 'Courier New', monospace; }

    .slide-number {
      position: absolute;
      bottom: 2rem;
      right: 2rem;
      font-size: 0.9rem;
      opacity: 0.6;
    }

    @media print {
      .slide { page-break-after: always; }
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${presentation.title}</title>
  <style>${css}</style>
</head>
<body>
  ${slidesHTML}
</body>
</html>`;
}

// ============================================================================
// REVEAL.JS GENERATION
// ============================================================================

function generateRevealJS(presentation: Presentation, options: SlideOptions): string {
  const theme = THEME_COLORS[options.theme] || THEME_COLORS.minimal;

  const slidesHTML = presentation.slides
    .map((slide) => {
      let content = "";

      switch (slide.type) {
        case "title":
          content = `
          <section>
            <h1>${slide.title || presentation.title}</h1>
            ${slide.subtitle || presentation.subtitle ? `<h3>${slide.subtitle || presentation.subtitle}</h3>` : ""}
            ${presentation.author ? `<p>${presentation.author}</p>` : ""}
            <p><small>${presentation.date}</small></p>
            ${slide.notes && options.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
          </section>
        `;
          break;

        case "two-column":
          content = `
          <section>
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <div style="display: flex; gap: 2rem;">
              <div style="flex: 1;"><ul>${slide.columns?.left.map((item) => `<li>${item}</li>`).join("") || ""}</ul></div>
              <div style="flex: 1;"><ul>${slide.columns?.right.map((item) => `<li>${item}</li>`).join("") || ""}</ul></div>
            </div>
            ${slide.notes && options.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
          </section>
        `;
          break;

        case "quote":
          content = `
          <section>
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <blockquote>"${slide.content.join(" ")}"</blockquote>
            ${slide.notes && options.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
          </section>
        `;
          break;

        case "code":
          content = `
          <section>
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <pre><code data-trim data-noescape class="language-${slide.codeLanguage || "text"}">${escapeHTML(slide.content.join("\n"))}</code></pre>
            ${slide.notes && options.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
          </section>
        `;
          break;

        default:
          content = `
          <section>
            ${slide.title ? `<h2>${slide.title}</h2>` : ""}
            <ul>${slide.content.map((item) => `<li class="fragment">${item}</li>`).join("")}</ul>
            ${slide.notes && options.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
          </section>
        `;
      }

      return content;
    })
    .join("\n");

  const revealTheme = options.theme === "dark" || options.theme === "tech" ? "black" : "white";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${presentation.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/${revealTheme}.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/monokai.css">
  <style>
    .reveal h1, .reveal h2 { color: #${options.primaryColor || theme.primary}; }
    .reveal blockquote { font-style: italic; border-left: 4px solid #${options.secondaryColor || theme.secondary}; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      ${slidesHTML}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/notes/notes.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/highlight.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      transition: '${options.transition}',
      transitionSpeed: '${options.transitionSpeed}',
      slideNumber: ${options.slideNumbers},
      plugins: [RevealHighlight, RevealNotes]
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// PDF GENERATION
// ============================================================================

async function generatePDF(presentation: Presentation, options: SlideOptions): Promise<Buffer> {
  console.log("📄 Generating PDF...");

  // Generate HTML first
  const html = generateHTML(presentation, options);

  // Write temp HTML file
  const tempDir = options.dir;
  const tempHtml = join(tempDir, `temp-${Date.now()}.html`);
  await writeFile(tempHtml, html);

  try {
    // Use puppeteer to convert to PDF
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`file://${tempHtml}`, { waitUntil: "networkidle0" });

    // Set viewport based on aspect ratio
    const viewport =
      options.aspectRatio === "16:9"
        ? { width: 1920, height: 1080 }
        : options.aspectRatio === "4:3"
          ? { width: 1024, height: 768 }
          : { width: 1920, height: 1200 };

    await page.setViewport(viewport);

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await browser.close();

    // Clean up temp file
    await unlink(tempHtml);

    return Buffer.from(pdfBuffer);
  } catch (error: any) {
    // Clean up temp file on error
    try {
      await unlink(tempHtml);
    } catch {}

    console.warn("   ⚠️  PDF generation failed, falling back to HTML");
    console.warn(`   Error: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    console.log("\n🎨 Generate Slides v2.0\n");

    const options = parseArguments();

    // Validate input
    if (!options.inputFile && !options.text && !options.topic) {
      console.error("❌ Error: Provide a markdown file, --text, or --topic for AI generation");
      console.error("   Run with --help for usage information");
      process.exit(1);
    }

    let presentation: Presentation;

    // Generate or parse content
    if (options.topic && (options.aiGenerate || !options.inputFile)) {
      // AI Generation
      presentation = await generateSlidesWithAI(options);
    } else if (options.text) {
      // Direct text input
      console.log("📝 Parsing text input...");
      presentation = parseMarkdown(options.text, options);
    } else if (options.inputFile) {
      // File input
      try {
        await access(options.inputFile, constants.R_OK);
        const content = await readFile(options.inputFile, "utf-8");
        console.log(`📄 Reading: ${options.inputFile}`);
        presentation = parseMarkdown(content, options);
      } catch (error) {
        console.error(`❌ Cannot read file: ${options.inputFile}`);
        process.exit(1);
      }
    } else {
      console.error("❌ No input provided");
      process.exit(1);
    }

    console.log(`   Title: ${presentation.title}`);
    console.log(`   Slides: ${presentation.slides.length}`);

    // Create output directory
    await mkdir(options.dir, { recursive: true });

    // Generate output filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const baseName = options.output ? basename(options.output, extname(options.output)) : `presentation-${timestamp}`;

    let outputPath: string;
    let outputContent: Buffer | string;

    // Generate based on format
    console.log(`\n🎬 Format: ${options.format.toUpperCase()}`);
    console.log(`   Theme: ${options.theme}`);

    switch (options.format) {
      case "pptx":
        outputContent = await generatePPTX(presentation, options);
        outputPath = options.output || join(options.dir, `${baseName}.pptx`);
        await writeFile(outputPath, outputContent);
        break;

      case "pdf":
        try {
          outputContent = await generatePDF(presentation, options);
          outputPath = options.output || join(options.dir, `${baseName}.pdf`);
          await writeFile(outputPath, outputContent);
        } catch {
          // Fallback to HTML
          outputContent = generateHTML(presentation, options);
          outputPath = options.output || join(options.dir, `${baseName}.html`);
          await writeFile(outputPath, outputContent);
          console.log("   (PDF generation requires puppeteer - saved as HTML)");
        }
        break;

      case "revealjs":
        outputContent = generateRevealJS(presentation, options);
        outputPath = options.output || join(options.dir, `${baseName}.html`);
        await writeFile(outputPath, outputContent);
        break;

      case "html":
      default:
        outputContent = generateHTML(presentation, options);
        outputPath = options.output || join(options.dir, `${baseName}.html`);
        await writeFile(outputPath, outputContent);
        break;
    }

    // Success
    console.log(`\n✅ Presentation generated!`);
    console.log(`\n📊 Summary:`);
    console.log(`   Title: ${presentation.title}`);
    console.log(`   Slides: ${presentation.slides.length}`);
    console.log(`   Format: ${options.format.toUpperCase()}`);
    console.log(`   Theme: ${options.theme}`);
    console.log(`\n💾 Output: ${outputPath}`);

    // Tips
    console.log(`\n💡 Tips:`);
    if (options.format === "pptx") {
      console.log("   • Open in PowerPoint, Keynote, or Google Slides");
      console.log("   • Speaker notes are included in Notes view");
    } else if (options.format === "revealjs") {
      console.log("   • Press 'S' for speaker notes view");
      console.log("   • Press 'F' for fullscreen");
      console.log("   • Press 'O' for slide overview");
    } else {
      console.log("   • Open in browser to view");
      console.log("   • Use Ctrl/Cmd+P to print or save as PDF");
    }
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
    process.exit(1);
  }
}

main();
