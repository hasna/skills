#!/usr/bin/env bun

import { PDFDocument } from "pdf-lib";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import sharp from "sharp";

// Types
interface ParseOptions {
  format: "text" | "markdown" | "json";
  pages: string;
  ocr: boolean;
  extractTables: boolean;
  schema: string | null;
  chunkSize: number;
  output: string | null;
  summary: boolean;
  language: string;
  detail: "low" | "high" | "auto";
  maxTokens: number;
}

interface PageContent {
  page: number;
  text: string;
  tables?: any[];
  metadata?: Record<string, any>;
}

interface ExtractionResult {
  filename: string;
  pages: number;
  extracted_at: string;
  content: PageContent[];
  summary?: string;
  schema_data?: Record<string, any>;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["format", "pages", "schema", "output", "language", "detail"],
  boolean: ["ocr", "extract-tables", "summary", "help"],
  default: {
    format: "markdown",
    pages: "all",
    ocr: false,
    "extract-tables": false,
    "chunk-size": 10,
    summary: false,
    language: "en",
    detail: "high",
    "max-tokens": 4096,
  },
  alias: {
    f: "format",
    p: "pages",
    o: "output",
    s: "schema",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
Parse PDF - Extract content from PDFs using OpenAI Vision

Usage:
  skills run parse-pdf -- <file.pdf> [options]

Options:
  -f, --format <type>      Output format: text, markdown, json (default: markdown)
  -p, --pages <range>      Page selection: "1-5", "1,3,5", "all" (default: all)
  -o, --output <file>      Output file path (default: stdout)
  -s, --schema <json>      JSON schema for structured extraction
  --ocr                    Force OCR mode for scanned documents
  --extract-tables         Detect and extract tables
  --chunk-size <n>         Pages per chunk for large PDFs (default: 10)
  --summary                Generate document summary
  --language <code>        Primary language for OCR (default: en)
  --detail <level>         Vision detail: low, high, auto (default: high)
  --max-tokens <n>         Max tokens per chunk response (default: 4096)
  -h, --help               Show this help message

Examples:
  skills run parse-pdf -- document.pdf
  skills run parse-pdf -- invoice.pdf --format json --extract-tables
  skills run parse-pdf -- scan.pdf --ocr --pages "1-5"
`);
  process.exit(0);
}

// Get input files
const inputFiles = args._.filter((arg: string) => typeof arg === "string");

if (inputFiles.length === 0) {
  console.error("Error: No input PDF file specified");
  process.exit(1);
}

// Check for API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Parse options
const options: ParseOptions = {
  format: args.format as ParseOptions["format"],
  pages: args.pages,
  ocr: args.ocr,
  extractTables: args["extract-tables"],
  schema: args.schema || null,
  chunkSize: parseInt(args["chunk-size"]) || 10,
  output: args.output || null,
  summary: args.summary,
  language: args.language,
  detail: args.detail as ParseOptions["detail"],
  maxTokens: parseInt(args["max-tokens"]) || 4096,
};

// Parse page range string into array of page numbers
function parsePageRange(pageStr: string, totalPages: number): number[] {
  if (pageStr === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const pages: Set<number> = new Set();
  const parts = pageStr.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n.trim()));
      for (let i = start - 1; i < Math.min(end, totalPages); i++) {
        if (i >= 0) pages.add(i);
      }
    } else {
      const pageNum = parseInt(part) - 1;
      if (pageNum >= 0 && pageNum < totalPages) {
        pages.add(pageNum);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

// Convert PDF page to image using pdf-lib and sharp
async function pdfPageToImage(
  pdfBytes: Uint8Array,
  pageIndex: number
): Promise<Buffer> {
  // Use pdf2pic or similar - for now we'll use a workaround with pdftoppm if available
  // In production, this would use pdf2pic or similar library
  const tempDir = process.env.SKILLS_OUTPUT_DIR || "/tmp";
  const tempPdfPath = path.join(tempDir, `temp_page_${pageIndex}.pdf`);
  const tempImgPath = path.join(tempDir, `temp_page_${pageIndex}.png`);

  try {
    // Extract single page
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const singlePagePdf = await PDFDocument.create();
    const [page] = await singlePagePdf.copyPages(pdfDoc, [pageIndex]);
    singlePagePdf.addPage(page);
    const singlePageBytes = await singlePagePdf.save();

    fs.writeFileSync(tempPdfPath, singlePageBytes);

    // Try using pdftoppm (poppler-utils) for conversion
    const { execSync } = await import("child_process");
    try {
      execSync(
        `pdftoppm -png -f 1 -l 1 -r 150 "${tempPdfPath}" "${tempImgPath.replace(".png", "")}"`,
        { stdio: "pipe" }
      );

      // pdftoppm adds -1 suffix
      const actualImgPath = tempImgPath.replace(".png", "-1.png");
      if (fs.existsSync(actualImgPath)) {
        const imgBuffer = fs.readFileSync(actualImgPath);
        fs.unlinkSync(actualImgPath);
        fs.unlinkSync(tempPdfPath);
        return imgBuffer;
      }
    } catch {
      // Fallback: try using ImageMagick convert
      try {
        execSync(
          `convert -density 150 "${tempPdfPath}[0]" -quality 90 "${tempImgPath}"`,
          { stdio: "pipe" }
        );
        if (fs.existsSync(tempImgPath)) {
          const imgBuffer = fs.readFileSync(tempImgPath);
          fs.unlinkSync(tempImgPath);
          fs.unlinkSync(tempPdfPath);
          return imgBuffer;
        }
      } catch {
        // Final fallback: use sharp to create a placeholder with page info
        console.warn(
          `Warning: Could not convert page ${pageIndex + 1} to image. Install poppler-utils or imagemagick for better results.`
        );
      }
    }

    // Clean up temp files
    if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);

    // Return a placeholder - in production would handle this better
    throw new Error("PDF to image conversion not available");
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
    throw error;
  }
}

// Extract text using OpenAI Vision
async function extractWithVision(
  imageBuffer: Buffer,
  pageNum: number,
  options: ParseOptions
): Promise<PageContent> {
  const base64Image = imageBuffer.toString("base64");
  const imageUrl = `data:image/png;base64,${base64Image}`;

  let systemPrompt = `You are a document parser. Extract all text content from this PDF page image accurately.`;

  if (options.extractTables) {
    systemPrompt += ` If you find any tables, extract them as structured data and clearly mark them.`;
  }

  if (options.schema) {
    systemPrompt += ` Also extract data matching this schema: ${options.schema}`;
  }

  const userPrompt =
    options.format === "json"
      ? `Extract all content from page ${pageNum}. Return as JSON with fields: "text" (full text), "tables" (array of tables as objects), "metadata" (any detected metadata like headers, footers, page numbers).`
      : options.format === "markdown"
        ? `Extract all content from page ${pageNum}. Format as clean Markdown. Use headers, lists, and tables where appropriate. Preserve document structure.`
        : `Extract all text content from page ${pageNum}. Return plain text only.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: options.maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: options.detail },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "";

    if (options.format === "json") {
      try {
        // Try to parse as JSON
        const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          return {
            page: pageNum,
            text: parsed.text || content,
            tables: parsed.tables,
            metadata: parsed.metadata,
          };
        }
        const parsed = JSON.parse(content);
        return {
          page: pageNum,
          text: parsed.text || content,
          tables: parsed.tables,
          metadata: parsed.metadata,
        };
      } catch {
        return { page: pageNum, text: content };
      }
    }

    return { page: pageNum, text: content };
  } catch (error: any) {
    console.error(`Error processing page ${pageNum}: ${error.message}`);
    return { page: pageNum, text: `[Error extracting page ${pageNum}]` };
  }
}

// Try to extract text directly from PDF (for text-based PDFs)
async function extractTextDirect(
  pdfBytes: Uint8Array,
  pageIndex: number
): Promise<string | null> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(pageIndex);

    // pdf-lib doesn't have built-in text extraction
    // We'd need pdf-parse or similar for this
    // For now, return null to fall back to Vision
    return null;
  } catch {
    return null;
  }
}

// Process a chunk of pages
async function processChunk(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  options: ParseOptions,
  chunkNum: number,
  totalChunks: number
): Promise<PageContent[]> {
  const results: PageContent[] = [];

  console.log(
    `Processing chunk ${chunkNum}/${totalChunks} (pages ${pageIndices[0] + 1}-${pageIndices[pageIndices.length - 1] + 1})...`
  );

  for (const pageIndex of pageIndices) {
    const pageNum = pageIndex + 1;

    // First try direct text extraction (faster, cheaper)
    if (!options.ocr) {
      const directText = await extractTextDirect(pdfBytes, pageIndex);
      if (directText && directText.trim().length > 50) {
        results.push({ page: pageNum, text: directText });
        continue;
      }
    }

    // Fall back to Vision API
    try {
      const imageBuffer = await pdfPageToImage(pdfBytes, pageIndex);
      const content = await extractWithVision(imageBuffer, pageNum, options);
      results.push(content);
    } catch (error: any) {
      console.warn(
        `Warning: Could not process page ${pageNum}: ${error.message}`
      );
      results.push({ page: pageNum, text: `[Could not extract page ${pageNum}]` });
    }

    // Small delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}

// Generate summary using OpenAI
async function generateSummary(content: PageContent[]): Promise<string> {
  const fullText = content.map((c) => c.text).join("\n\n");
  const truncatedText = fullText.slice(0, 30000); // Limit for API

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content:
          "You are a document summarizer. Provide a clear, concise summary of the document content.",
      },
      {
        role: "user",
        content: `Summarize this document:\n\n${truncatedText}`,
      },
    ],
  });

  return response.choices[0]?.message?.content || "";
}

// Extract data according to schema
async function extractSchemaData(
  content: PageContent[],
  schema: string
): Promise<Record<string, any>> {
  const fullText = content.map((c) => c.text).join("\n\n");
  const truncatedText = fullText.slice(0, 30000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content: `You are a data extractor. Extract data from the document according to the provided schema. Return valid JSON only.`,
      },
      {
        role: "user",
        content: `Extract data matching this schema: ${schema}\n\nDocument content:\n${truncatedText}`,
      },
    ],
  });

  const responseText = response.choices[0]?.message?.content || "{}";
  try {
    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    return JSON.parse(responseText);
  } catch {
    return { raw: responseText };
  }
}

// Format output
function formatOutput(result: ExtractionResult, format: string): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "text") {
    let output = result.content.map((c) => c.text).join("\n\n---\n\n");
    if (result.summary) {
      output = `SUMMARY:\n${result.summary}\n\n---\n\n${output}`;
    }
    return output;
  }

  // Markdown format
  let md = `# Document: ${result.filename}\n\n`;
  md += `- **Pages:** ${result.pages}\n`;
  md += `- **Extracted:** ${result.extracted_at}\n\n`;

  if (result.summary) {
    md += `## Summary\n\n${result.summary}\n\n`;
  }

  if (result.schema_data && Object.keys(result.schema_data).length > 0) {
    md += `## Extracted Data\n\n\`\`\`json\n${JSON.stringify(result.schema_data, null, 2)}\n\`\`\`\n\n`;
  }

  md += `## Content\n\n`;

  for (const page of result.content) {
    md += `### Page ${page.page}\n\n`;
    md += page.text + "\n\n";

    if (page.tables && page.tables.length > 0) {
      md += `#### Tables\n\n`;
      for (const table of page.tables) {
        md += "```json\n" + JSON.stringify(table, null, 2) + "\n```\n\n";
      }
    }
  }

  return md;
}

// Main processing function
async function processPdf(filePath: string): Promise<ExtractionResult> {
  console.log(`\nProcessing: ${filePath}`);

  // Read PDF file
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  console.log(`Total pages: ${totalPages}`);

  // Get pages to process
  const pageIndices = parsePageRange(options.pages, totalPages);
  console.log(`Processing ${pageIndices.length} pages`);

  // Split into chunks
  const chunks: number[][] = [];
  for (let i = 0; i < pageIndices.length; i += options.chunkSize) {
    chunks.push(pageIndices.slice(i, i + options.chunkSize));
  }

  console.log(`Split into ${chunks.length} chunks of up to ${options.chunkSize} pages each\n`);

  // Process all chunks
  const allContent: PageContent[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = await processChunk(
      pdfBytes,
      chunks[i],
      options,
      i + 1,
      chunks.length
    );
    allContent.push(...chunkContent);
  }

  // Build result
  const result: ExtractionResult = {
    filename: path.basename(filePath),
    pages: totalPages,
    extracted_at: new Date().toISOString(),
    content: allContent,
  };

  // Generate summary if requested
  if (options.summary) {
    console.log("\nGenerating summary...");
    result.summary = await generateSummary(allContent);
  }

  // Extract schema data if provided
  if (options.schema) {
    console.log("\nExtracting schema data...");
    result.schema_data = await extractSchemaData(allContent, options.schema);
  }

  return result;
}

// Main execution
async function main() {
  try {
    const results: ExtractionResult[] = [];

    for (const inputFile of inputFiles) {
      // Handle glob patterns
      const files = fs.existsSync(inputFile)
        ? [inputFile]
        : (await import("glob")).globSync(inputFile);

      for (const file of files) {
        const result = await processPdf(file);
        results.push(result);
      }
    }

    // Format and output results
    for (const result of results) {
      const output = formatOutput(result, options.format);

      if (options.output) {
        // Determine output path
        let outputPath = options.output;
        if (results.length > 1 || fs.existsSync(options.output) && fs.statSync(options.output).isDirectory()) {
          // Multiple files or output is directory
          const dir = options.output;
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const ext = options.format === "json" ? ".json" : options.format === "text" ? ".txt" : ".md";
          outputPath = path.join(dir, result.filename.replace(".pdf", ext));
        }

        fs.writeFileSync(outputPath, output);
        console.log(`\nOutput saved to: ${outputPath}`);
      } else {
        console.log("\n" + "=".repeat(60) + "\n");
        console.log(output);
      }
    }

    console.log("\nDone!");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
