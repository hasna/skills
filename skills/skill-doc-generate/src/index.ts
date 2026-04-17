#!/usr/bin/env bun

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  PageNumber,
  NumberFormat,
  Header,
  Footer,
  TableOfContents,
  ImageRun,
  ExternalHyperlink,
  PageBreak,
} from "docx";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import { marked } from "marked";
import OpenAI from "openai";

// Types
interface DocOptions {
  output: string;
  dir: string;
  template: "default" | "report" | "letter" | "memo" | "resume" | "article";
  title: string;
  author: string;
  company: string;
  date: string;
  font: string;
  fontSize: number;
  headingFont: string;
  lineSpacing: number;
  margins: number;
  pageSize: "letter" | "a4" | "legal";
  toc: boolean;
  pageNumbers: boolean;
  header: string;
  footer: string;
  // AI options
  topic: string | null;
  prompt: string | null;
  text: string | null;
  sections: number;
  style: "professional" | "casual" | "formal" | "academic";
  tone: "neutral" | "friendly" | "authoritative";
  length: "short" | "medium" | "long" | "comprehensive";
}

interface ParsedContent {
  title: string;
  sections: ContentSection[];
}

interface ContentSection {
  type: "heading" | "paragraph" | "list" | "table" | "quote" | "code" | "image" | "hr";
  level?: number;
  text?: string;
  items?: string[];
  rows?: string[][];
  language?: string;
  src?: string;
  ordered?: boolean;
}

// Parse arguments
const args = minimist(process.argv.slice(2), {
  string: ["output", "dir", "template", "title", "author", "company", "date", "font", "heading-font", "header", "footer", "topic", "prompt", "text", "style", "tone", "length", "page-size"],
  boolean: ["toc", "page-numbers", "help"],
  default: {
    dir: ".skills/exports",
    template: "default",
    font: "Calibri",
    "font-size": 11,
    "heading-font": "Calibri Light",
    "line-spacing": 1.15,
    margins: 1,
    "page-size": "letter",
    "page-numbers": true,
    sections: 5,
    style: "professional",
    tone: "neutral",
    length: "medium",
  },
  alias: {
    o: "output",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Generate DOCX - Create Word documents from markdown or AI

Usage:
  skills run generate-docx -- <markdown-file> [options]
  skills run generate-docx -- --topic "Topic" [options]
  skills run generate-docx -- --prompt "Prompt" [options]

Input Options:
  <file>              Input markdown file
  --topic <text>      Topic for AI to write about
  --prompt <text>     Direct prompt for AI generation
  --text <text>       Plain text content

AI Options:
  --sections <n>      Number of sections (default: 5)
  --style <type>      Style: professional, casual, formal, academic
  --tone <type>       Tone: neutral, friendly, authoritative
  --length <type>     Length: short, medium, long, comprehensive

Output Options:
  -o, --output <path> Output file path
  --dir <path>        Output directory (default: .skills/exports)

Template Options:
  --template <name>   Template: default, report, letter, memo, resume, article
  --title <text>      Document title
  --author <text>     Author name
  --company <text>    Company name
  --date <text>       Document date

Styling Options:
  --font <name>       Font family (default: Calibri)
  --font-size <pt>    Base font size (default: 11)
  --heading-font      Heading font (default: Calibri Light)
  --line-spacing <n>  Line spacing (default: 1.15)
  --margins <inches>  Page margins (default: 1)
  --page-size <size>  Page size: letter, a4, legal

Content Options:
  --toc               Include table of contents
  --page-numbers      Include page numbers (default: true)
  --header <text>     Header text
  --footer <text>     Footer text

Examples:
  skills run generate-docx -- document.md -o output.docx
  skills run generate-docx -- --topic "Business Plan" --template report -o plan.docx
  skills run generate-docx -- --prompt "Write a cover letter" --template letter
`);
  process.exit(0);
}

// Build options
const options: DocOptions = {
  output: args.output || "",
  dir: args.dir,
  template: args.template as DocOptions["template"],
  title: args.title || "",
  author: args.author || "",
  company: args.company || "",
  date: args.date || new Date().toLocaleDateString(),
  font: args.font,
  fontSize: parseInt(args["font-size"]) || 11,
  headingFont: args["heading-font"],
  lineSpacing: parseFloat(args["line-spacing"]) || 1.15,
  margins: parseFloat(args.margins) || 1,
  pageSize: args["page-size"] as DocOptions["pageSize"],
  toc: args.toc,
  pageNumbers: args["page-numbers"],
  header: args.header || "",
  footer: args.footer || "",
  topic: args.topic || null,
  prompt: args.prompt || null,
  text: args.text || null,
  sections: parseInt(args.sections) || 5,
  style: args.style as DocOptions["style"],
  tone: args.tone as DocOptions["tone"],
  length: args.length as DocOptions["length"],
};

// Get input file
const inputFile = args._[0] as string | undefined;

// Generate content with AI
async function generateWithAI(topic: string, isPrompt: boolean = false): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI generation");
  }

  const openai = new OpenAI({ apiKey });

  const lengthGuide = {
    short: "Keep it concise, around 500 words total.",
    medium: "Write a moderate length document, around 1000-1500 words.",
    long: "Write a comprehensive document, around 2000-3000 words.",
    comprehensive: "Write a very detailed document, around 4000+ words with thorough coverage.",
  };

  const styleGuide = {
    professional: "Use professional business language.",
    casual: "Use a casual, conversational tone.",
    formal: "Use formal, academic language.",
    academic: "Use scholarly, well-researched language with citations where appropriate.",
  };

  let systemPrompt: string;
  let userPrompt: string;

  if (isPrompt) {
    systemPrompt = `You are a professional document writer. Write in markdown format with proper headings, paragraphs, lists, and formatting. ${styleGuide[options.style]} ${lengthGuide[options.length]}`;
    userPrompt = topic;
  } else {
    systemPrompt = `You are a professional document writer creating a ${options.template} document. Write in markdown format with:
- A clear title (# Title)
- ${options.sections} main sections (## Section headings)
- Proper paragraphs, bullet points, and formatting as needed
- ${styleGuide[options.style]}
- ${lengthGuide[options.length]}

Output ONLY the markdown content, no explanations.`;
    userPrompt = `Write a document about: ${topic}`;
  }

  console.log("Generating content with AI...");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || "";
}

// Parse markdown to structured content
function parseMarkdown(markdown: string): ParsedContent {
  const sections: ContentSection[] = [];
  let title = options.title || "Document";

  // Simple markdown parser
  const lines = markdown.split("\n");
  let i = 0;
  let currentList: { items: string[]; ordered: boolean } | null = null;
  let currentTable: string[][] | null = null;
  let inCodeBlock = false;
  let codeContent = "";
  let codeLanguage = "";

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
        codeContent = "";
      } else {
        inCodeBlock = false;
        sections.push({ type: "code", text: codeContent.trim(), language: codeLanguage });
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + "\n";
      i++;
      continue;
    }

    // Flush current list if we're not on a list line
    if (currentList && !line.match(/^[\s]*[-*+]\s/) && !line.match(/^[\s]*\d+\.\s/) && line.trim() !== "") {
      sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
      currentList = null;
    }

    // Flush current table if we're not on a table line
    if (currentTable && !line.startsWith("|") && line.trim() !== "") {
      sections.push({ type: "table", rows: currentTable });
      currentTable = null;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1 && !options.title) {
        title = text;
      }
      sections.push({ type: "heading", level, text });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}$/)) {
      sections.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteText = line.replace(/^>\s*/, "");
      sections.push({ type: "quote", text: quoteText });
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!currentList || currentList.ordered) {
        if (currentList) {
          sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
        }
        currentList = { items: [], ordered: false };
      }
      currentList.items.push(ulMatch[1]);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!currentList || !currentList.ordered) {
        if (currentList) {
          sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
        }
        currentList = { items: [], ordered: true };
      }
      currentList.items.push(olMatch[1]);
      i++;
      continue;
    }

    // Table
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (!currentTable) {
        currentTable = [];
      }
      // Skip separator row
      if (!cells.every(c => c.match(/^[-:]+$/))) {
        currentTable.push(cells);
      }
      i++;
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      sections.push({ type: "paragraph", text: line });
    }

    i++;
  }

  // Flush remaining list or table
  if (currentList) {
    sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
  }
  if (currentTable) {
    sections.push({ type: "table", rows: currentTable });
  }

  return { title, sections };
}

// Parse inline formatting
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let remaining = text;

  // Simple regex-based parsing for bold, italic, code
  const regex = /(\*\*|__)(.*?)\1|(\*|_)(.*?)\3|`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), font: options.font, size: options.fontSize * 2 }));
    }

    if (match[1]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true, font: options.font, size: options.fontSize * 2 }));
    } else if (match[3]) {
      // Italic
      runs.push(new TextRun({ text: match[4], italics: true, font: options.font, size: options.fontSize * 2 }));
    } else if (match[5]) {
      // Code
      runs.push(new TextRun({ text: match[5], font: "Courier New", size: options.fontSize * 2 }));
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font: options.font, size: options.fontSize * 2 }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: options.font, size: options.fontSize * 2 }));
  }

  return runs;
}

// Convert page size to dimensions
function getPageSize(size: string): { width: number; height: number } {
  const sizes: Record<string, { width: number; height: number }> = {
    letter: { width: 12240, height: 15840 }, // 8.5 x 11 inches in twips
    a4: { width: 11906, height: 16838 }, // 210 x 297 mm in twips
    legal: { width: 12240, height: 20160 }, // 8.5 x 14 inches in twips
  };
  return sizes[size] || sizes.letter;
}

// Build document from parsed content
function buildDocument(content: ParsedContent): Document {
  const pageSize = getPageSize(options.pageSize);
  const marginTwips = options.margins * 1440; // Convert inches to twips

  const children: any[] = [];

  // Add title page for report template
  if (options.template === "report") {
    children.push(
      new Paragraph({ text: "", spacing: { after: 4000 } }),
      new Paragraph({
        children: [new TextRun({ text: content.title, font: options.headingFont, size: 72, bold: true })],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "", spacing: { after: 1000 } })
    );

    if (options.author) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `By ${options.author}`, font: options.font, size: 28 })],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    if (options.company) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: options.company, font: options.font, size: 24 })],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: options.date, font: options.font, size: 24 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // Add letter/memo header
  if (options.template === "letter" || options.template === "memo") {
    if (options.company) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: options.company, font: options.font, size: options.fontSize * 2, bold: true })],
        })
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: options.date, font: options.font, size: options.fontSize * 2 })],
        spacing: { after: 400 },
      }),
      new Paragraph({ text: "", spacing: { after: 400 } })
    );
  }

  // Add TOC if requested
  if (options.toc) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Table of Contents", font: options.headingFont, size: 32, bold: true })],
        spacing: { after: 400 },
      }),
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // Process sections
  for (const section of content.sections) {
    switch (section.type) {
      case "heading":
        const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 :
                            section.level === 2 ? HeadingLevel.HEADING_2 :
                            section.level === 3 ? HeadingLevel.HEADING_3 :
                            section.level === 4 ? HeadingLevel.HEADING_4 :
                            HeadingLevel.HEADING_5;
        const headingSize = section.level === 1 ? 32 : section.level === 2 ? 26 : section.level === 3 ? 22 : 20;
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: options.headingFont, size: headingSize, bold: true })],
            heading: headingLevel,
            spacing: { before: 400, after: 200 },
          })
        );
        break;

      case "paragraph":
        children.push(
          new Paragraph({
            children: parseInlineFormatting(section.text || ""),
            spacing: { after: 200, line: options.lineSpacing * 240 },
          })
        );
        break;

      case "list":
        for (let i = 0; i < (section.items?.length || 0); i++) {
          children.push(
            new Paragraph({
              children: parseInlineFormatting(section.items![i]),
              bullet: section.ordered ? undefined : { level: 0 },
              numbering: section.ordered ? { reference: "default-numbering", level: 0 } : undefined,
              spacing: { after: 100 },
            })
          );
        }
        break;

      case "quote":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: options.font, size: options.fontSize * 2, italics: true })],
            indent: { left: 720 },
            spacing: { before: 200, after: 200 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "888888" } },
          })
        );
        break;

      case "code":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: "Courier New", size: 20 })],
            shading: { fill: "f5f5f5" },
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      case "table":
        if (section.rows && section.rows.length > 0) {
          const tableRows = section.rows.map((row, rowIndex) =>
            new TableRow({
              children: row.map(cell =>
                new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: cell,
                      font: options.font,
                      size: options.fontSize * 2,
                      bold: rowIndex === 0,
                    })],
                  })],
                  shading: rowIndex === 0 ? { fill: "e0e0e0" } : undefined,
                })
              ),
            })
          );
          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );
          children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
        }
        break;

      case "hr":
        children.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "cccccc" } },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
    }
  }

  // Build document
  const doc = new Document({
    creator: options.author || "skills.md",
    title: content.title,
    description: `Generated by generate-docx skill`,
    styles: {
      default: {
        document: {
          run: { font: options.font, size: options.fontSize * 2 },
        },
      },
    },
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: NumberFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: pageSize,
          margin: {
            top: marginTwips,
            right: marginTwips,
            bottom: marginTwips,
            left: marginTwips,
          },
        },
      },
      headers: options.header ? {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: options.header, font: options.font, size: 18 })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      } : undefined,
      footers: options.pageNumbers || options.footer ? {
        default: new Footer({
          children: [new Paragraph({
            children: [
              ...(options.footer ? [new TextRun({ text: options.footer + "  ", font: options.font, size: 18 })] : []),
              ...(options.pageNumbers ? [
                new TextRun({ children: [PageNumber.CURRENT], font: options.font, size: 18 }),
                new TextRun({ text: " / ", font: options.font, size: 18 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: options.font, size: 18 }),
              ] : []),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      } : undefined,
      children,
    }],
  });

  return doc;
}

// Main execution
async function main(): Promise<void> {
  try {
    let markdown = "";

    // Determine input source
    if (inputFile) {
      if (!fs.existsSync(inputFile)) {
        console.error(`Error: File not found: ${inputFile}`);
        process.exit(1);
      }
      markdown = fs.readFileSync(inputFile, "utf-8");
      console.log(`Reading from: ${inputFile}`);
    } else if (options.topic) {
      markdown = await generateWithAI(options.topic);
    } else if (options.prompt) {
      markdown = await generateWithAI(options.prompt, true);
    } else if (options.text) {
      markdown = options.text;
    } else {
      console.error("Error: No input specified. Provide a markdown file, --topic, --prompt, or --text");
      process.exit(1);
    }

    // Parse content
    console.log("Parsing content...");
    const content = parseMarkdown(markdown);

    // Update title if provided
    if (options.title) {
      content.title = options.title;
    }

    // Build document
    console.log("Building document...");
    const doc = buildDocument(content);

    // Generate output path
    let outputPath = options.output;
    if (!outputPath) {
      const baseName = inputFile
        ? path.basename(inputFile, path.extname(inputFile))
        : content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
      outputPath = path.join(options.dir, `${baseName}.docx`);
    }

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write file
    console.log("Writing document...");
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    // Summary
    console.log(`\n${"=".repeat(50)}`);
    console.log("Document Generated");
    console.log("=".repeat(50));
    console.log(`  Title: ${content.title}`);
    console.log(`  Template: ${options.template}`);
    console.log(`  Sections: ${content.sections.filter(s => s.type === "heading").length}`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log("");

  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
