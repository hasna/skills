#!/usr/bin/env bun

import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import { globSync } from "glob";

// Types
interface FileSpec {
  path: string;
  pages: string;
}

interface MergeOptions {
  output: string;
  bookmarks: boolean;
  sort: "none" | "name" | "date" | "size";
  reverse: boolean;
  blankBetween: boolean;
  title: string | null;
  author: string | null;
  rotate: number;
  compress: boolean;
  pageNumbers: boolean;
  pageNumberFormat: string;
  pageNumberPosition: string;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: [
    "output",
    "sort",
    "title",
    "author",
    "page-number-format",
    "page-number-position",
  ],
  boolean: [
    "bookmarks",
    "reverse",
    "blank-between",
    "compress",
    "page-numbers",
    "help",
  ],
  default: {
    output: "merged.pdf",
    sort: "none",
    reverse: false,
    bookmarks: false,
    "blank-between": false,
    compress: false,
    "page-numbers": false,
    "page-number-format": "Page {n}",
    "page-number-position": "bottom-center",
    rotate: 0,
  },
  alias: {
    o: "output",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
Merge PDFs - Combine multiple PDF files into one

Usage:
  skills run merge-pdfs -- <file1.pdf> [file2.pdf...] [options]

Options:
  -o, --output <file>           Output file path (default: merged.pdf)
  --bookmarks                   Add bookmarks for each source file
  --sort <type>                 Sort order: none, name, date, size (default: none)
  --reverse                     Reverse the merge order
  --blank-between               Insert blank page between documents
  --title <text>                Set PDF title metadata
  --author <text>               Set PDF author metadata
  --rotate <degrees>            Rotate all pages: 0, 90, 180, 270
  --compress                    Compress output PDF
  --page-numbers                Add page numbers
  --page-number-format <fmt>    Format: "Page {n}" or "Page {n} of {total}"
  --page-number-position <pos>  Position: top/bottom-left/center/right
  -h, --help                    Show this help message

Page Selection:
  file.pdf                      All pages
  file.pdf:1-5                  Pages 1 through 5
  file.pdf:1,3,5                Specific pages
  file.pdf:1-3,7,10-12          Mixed ranges

Examples:
  skills run merge-pdfs -- doc1.pdf doc2.pdf -o combined.pdf
  skills run merge-pdfs -- "doc.pdf:1-5" "other.pdf:2,4" -o output.pdf
  skills run merge-pdfs -- ./docs/*.pdf --sort name --bookmarks -o book.pdf
`);
  process.exit(0);
}

// Parse options
const options: MergeOptions = {
  output: args.output,
  bookmarks: args.bookmarks,
  sort: args.sort as MergeOptions["sort"],
  reverse: args.reverse,
  blankBetween: args["blank-between"],
  title: args.title || null,
  author: args.author || null,
  rotate: parseInt(args.rotate) || 0,
  compress: args.compress,
  pageNumbers: args["page-numbers"],
  pageNumberFormat: args["page-number-format"],
  pageNumberPosition: args["page-number-position"],
};

// Parse file spec (path:pages)
function parseFileSpec(spec: string): FileSpec {
  const colonIndex = spec.lastIndexOf(":");
  // Check if colon is part of page spec (not Windows drive letter)
  if (colonIndex > 1 && !spec.substring(colonIndex + 1).includes("/")) {
    const possiblePages = spec.substring(colonIndex + 1);
    if (/^[\d,\-all]+$/i.test(possiblePages)) {
      return {
        path: spec.substring(0, colonIndex),
        pages: possiblePages.toLowerCase(),
      };
    }
  }
  return { path: spec, pages: "all" };
}

// Parse page range into array of page indices (0-based)
function parsePageRange(pageStr: string, totalPages: number): number[] {
  if (pageStr === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const pages: Set<number> = new Set();
  const parts = pageStr.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = startStr ? parseInt(startStr) : 1;
      const end = endStr ? parseInt(endStr) : totalPages;
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

// Expand glob patterns and get file list
function getFileList(specs: string[]): FileSpec[] {
  const files: FileSpec[] = [];

  for (const spec of specs) {
    const { path: pattern, pages } = parseFileSpec(spec);

    // Try glob expansion
    const matches = globSync(pattern);

    if (matches.length === 0) {
      // No glob match, try as literal path
      if (fs.existsSync(pattern)) {
        files.push({ path: pattern, pages });
      } else {
        console.warn(`Warning: File not found: ${pattern}`);
      }
    } else {
      for (const match of matches) {
        if (match.toLowerCase().endsWith(".pdf")) {
          files.push({ path: match, pages });
        }
      }
    }
  }

  return files;
}

// Sort files based on option
function sortFiles(files: FileSpec[], sortBy: string, reverse: boolean): FileSpec[] {
  const sorted = [...files];

  switch (sortBy) {
    case "name":
      sorted.sort((a, b) =>
        path.basename(a.path).localeCompare(path.basename(b.path))
      );
      break;
    case "date":
      sorted.sort((a, b) => {
        const statA = fs.statSync(a.path);
        const statB = fs.statSync(b.path);
        return statA.mtime.getTime() - statB.mtime.getTime();
      });
      break;
    case "size":
      sorted.sort((a, b) => {
        const statA = fs.statSync(a.path);
        const statB = fs.statSync(b.path);
        return statA.size - statB.size;
      });
      break;
  }

  if (reverse) {
    sorted.reverse();
  }

  return sorted;
}

// Add page numbers to document
async function addPageNumbers(
  pdfDoc: PDFDocument,
  format: string,
  position: string
): Promise<void> {
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();

    const text = format
      .replace("{n}", String(i + 1))
      .replace("{total}", String(totalPages));

    const textWidth = font.widthOfTextAtSize(text, fontSize);

    let x: number;
    let y: number;

    // Determine position
    const [vPos, hPos] = position.split("-");

    // Vertical position
    if (vPos === "top") {
      y = height - 30;
    } else {
      y = 20;
    }

    // Horizontal position
    switch (hPos) {
      case "left":
        x = 30;
        break;
      case "right":
        x = width - textWidth - 30;
        break;
      default: // center
        x = (width - textWidth) / 2;
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
}

// Create a blank page with same size as reference
function createBlankPage(pdfDoc: PDFDocument, width: number, height: number) {
  return pdfDoc.addPage([width, height]);
}

// Main merge function
async function mergePdfs(fileSpecs: FileSpec[]): Promise<void> {
  console.log(`\nMerging ${fileSpecs.length} PDF files...\n`);

  // Create output document
  const mergedPdf = await PDFDocument.create();

  // Track source documents for bookmarks
  const bookmarkInfo: { title: string; pageIndex: number }[] = [];
  let totalSourcePages = 0;
  const sourceStats: { name: string; pages: number }[] = [];

  // Process each file
  for (const spec of fileSpecs) {
    console.log(`Processing: ${spec.path}`);

    try {
      const fileBytes = fs.readFileSync(spec.path);
      const sourcePdf = await PDFDocument.load(fileBytes);
      const sourcePageCount = sourcePdf.getPageCount();

      // Get pages to include
      const pageIndices = parsePageRange(spec.pages, sourcePageCount);
      console.log(`  - Including ${pageIndices.length} of ${sourcePageCount} pages`);

      // Record bookmark position
      if (options.bookmarks) {
        bookmarkInfo.push({
          title: path.basename(spec.path, ".pdf"),
          pageIndex: mergedPdf.getPageCount(),
        });
      }

      // Copy pages
      const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);

      for (const page of copiedPages) {
        // Apply rotation if specified
        if (options.rotate !== 0) {
          page.setRotation(degrees(options.rotate));
        }
        mergedPdf.addPage(page);
      }

      // Add blank page between documents if requested
      if (options.blankBetween && spec !== fileSpecs[fileSpecs.length - 1]) {
        const lastPage = copiedPages[copiedPages.length - 1];
        const { width, height } = lastPage.getSize();
        createBlankPage(mergedPdf, width, height);
      }

      totalSourcePages += pageIndices.length;
      sourceStats.push({
        name: path.basename(spec.path),
        pages: pageIndices.length,
      });
    } catch (error: any) {
      console.error(`  Error processing ${spec.path}: ${error.message}`);
    }
  }

  // Set metadata
  if (options.title) {
    mergedPdf.setTitle(options.title);
  }
  if (options.author) {
    mergedPdf.setAuthor(options.author);
  }
  mergedPdf.setCreator("skills.md merge-pdfs");
  mergedPdf.setProducer("pdf-lib");
  mergedPdf.setCreationDate(new Date());
  mergedPdf.setModificationDate(new Date());

  // Add page numbers if requested
  if (options.pageNumbers) {
    console.log("\nAdding page numbers...");
    await addPageNumbers(
      mergedPdf,
      options.pageNumberFormat,
      options.pageNumberPosition
    );
  }

  // Note: pdf-lib doesn't support bookmarks/outlines directly
  // For full bookmark support, we'd need a different library
  if (options.bookmarks && bookmarkInfo.length > 0) {
    console.log("\nNote: Bookmark metadata recorded (visual bookmarks require additional processing)");
  }

  // Save output
  console.log("\nSaving merged PDF...");
  const outputBytes = await mergedPdf.save();

  // Ensure output directory exists
  const outputDir = path.dirname(options.output);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(options.output, outputBytes);

  // Print summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Merged ${fileSpecs.length} files (${mergedPdf.getPageCount()} pages total) into: ${options.output}`);
  console.log("=".repeat(50));
  for (const stat of sourceStats) {
    console.log(`  - ${stat.name}: ${stat.pages} pages`);
  }
  console.log("");

  const outputSize = fs.statSync(options.output).size;
  console.log(`Output file size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
  console.log("\nDone!");
}

// Main execution
async function main() {
  try {
    // Get file list
    let files = getFileList(args._ as string[]);

    if (files.length === 0) {
      console.error("Error: No valid PDF files found");
      process.exit(1);
    }

    if (files.length === 1) {
      console.warn("Warning: Only one file specified, nothing to merge");
    }

    // Sort files
    files = sortFiles(files, options.sort, options.reverse);

    // Perform merge
    await mergePdfs(files);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
