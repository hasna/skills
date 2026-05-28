#!/usr/bin/env bun

import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Types
interface SplitOptions {
  output: string;
  pages: string;
  chunkSize: number;
  even: boolean;
  odd: boolean;
  first: number | null;
  last: number | null;
  reverse: boolean;
  naming: string;
  startNumber: number;
  padDigits: number;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["output", "pages", "naming"],
  boolean: ["even", "odd", "reverse", "help"],
  default: {
    output: "./split/",
    pages: "all",
    "chunk-size": 1,
    even: false,
    odd: false,
    reverse: false,
    naming: "page-{n}",
    "start-number": 1,
    "pad-digits": 3,
  },
  alias: {
    o: "output",
    p: "pages",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
Split PDF - Split PDF files into pages or ranges

Usage:
  skills run split-pdf -- <file.pdf> [options]

Options:
  -o, --output <path>       Output directory or file (default: ./split/)
  -p, --pages <range>       Pages to extract: "1-5", "1,3,5", "all" (default: all)
  --chunk-size <n>          Pages per output file (default: 1)
  --even                    Extract even pages only
  --odd                     Extract odd pages only
  --first <n>               Extract first N pages
  --last <n>                Extract last N pages
  --reverse                 Reverse page order
  --naming <template>       Output naming: page-{n}, chunk-{n}, {original}-{n}
  --start-number <n>        Starting number for output files (default: 1)
  --pad-digits <n>          Zero-padding digits (default: 3)
  -h, --help                Show this help message

Examples:
  skills run split-pdf -- document.pdf -o ./pages/
  skills run split-pdf -- document.pdf --pages "1-10" -o extract.pdf
  skills run split-pdf -- document.pdf --chunk-size 5 -o ./chunks/
  skills run split-pdf -- document.pdf --even -o even-pages.pdf
`);
  process.exit(0);
}

// Get input file
const inputFile = args._[0] as string;

if (!inputFile) {
  console.error("Error: No input PDF file specified");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Parse options
const options: SplitOptions = {
  output: args.output,
  pages: args.pages,
  chunkSize: parseInt(args["chunk-size"]) || 1,
  even: args.even,
  odd: args.odd,
  first: args.first ? parseInt(args.first) : null,
  last: args.last ? parseInt(args.last) : null,
  reverse: args.reverse,
  naming: args.naming,
  startNumber: parseInt(args["start-number"]) || 1,
  padDigits: parseInt(args["pad-digits"]) || 3,
};

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

// Filter pages based on options
function filterPages(
  pages: number[],
  totalPages: number,
  options: SplitOptions
): number[] {
  let filtered = [...pages];

  // Apply even/odd filter
  if (options.even) {
    filtered = filtered.filter((p) => (p + 1) % 2 === 0);
  } else if (options.odd) {
    filtered = filtered.filter((p) => (p + 1) % 2 === 1);
  }

  // Apply first/last
  if (options.first !== null) {
    filtered = filtered.slice(0, options.first);
  } else if (options.last !== null) {
    filtered = filtered.slice(-options.last);
  }

  // Apply reverse
  if (options.reverse) {
    filtered.reverse();
  }

  return filtered;
}

// Generate output filename
function generateFilename(
  template: string,
  index: number,
  totalPages: number,
  originalName: string,
  padDigits: number
): string {
  const paddedNum = String(index).padStart(padDigits, "0");
  const date = new Date().toISOString().split("T")[0];

  return (
    template
      .replace("{n}", paddedNum)
      .replace("{original}", originalName)
      .replace("{total}", String(totalPages))
      .replace("{date}", date) + ".pdf"
  );
}

// Split into chunks
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Main split function
async function splitPdf(): Promise<void> {
  console.log(`\nLoading: ${inputFile}`);

  // Load source PDF
  const sourceBytes = fs.readFileSync(inputFile);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const totalPages = sourcePdf.getPageCount();

  console.log(`Total pages: ${totalPages}`);

  // Get and filter pages
  let pageIndices = parsePageRange(options.pages, totalPages);
  pageIndices = filterPages(pageIndices, totalPages, options);

  if (pageIndices.length === 0) {
    console.error("Error: No pages match the specified criteria");
    process.exit(1);
  }

  console.log(`Selected pages: ${pageIndices.length}`);

  // Determine output mode
  const outputIsFile = options.output.toLowerCase().endsWith(".pdf");
  const originalName = path.basename(inputFile, ".pdf");

  // Create chunks
  const chunks = chunkArray(pageIndices, options.chunkSize);
  console.log(`Output files: ${chunks.length}\n`);

  // Ensure output directory exists
  if (!outputIsFile) {
    if (!fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }
  } else if (chunks.length > 1) {
    // Multiple chunks but output is a file - create directory instead
    const outputDir = options.output.replace(".pdf", "");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    options.output = outputDir;
  }

  const outputFiles: string[] = [];

  // Process each chunk
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fileNum = options.startNumber + i;

    // Create new PDF for this chunk
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, chunk);

    for (const page of copiedPages) {
      newPdf.addPage(page);
    }

    // Set metadata
    newPdf.setCreator("skills.md split-pdf");
    newPdf.setProducer("pdf-lib");

    // Generate output path
    let outputPath: string;
    if (outputIsFile && chunks.length === 1) {
      outputPath = options.output;
    } else {
      const filename = generateFilename(
        options.chunkSize > 1 ? options.naming.replace("page", "chunk") : options.naming,
        fileNum,
        totalPages,
        originalName,
        options.padDigits
      );
      outputPath = path.join(options.output, filename);
    }

    // Save
    const outputBytes = await newPdf.save();
    fs.writeFileSync(outputPath, outputBytes);
    outputFiles.push(outputPath);

    // Progress
    const pageRange =
      chunk.length === 1
        ? `page ${chunk[0] + 1}`
        : `pages ${chunk[0] + 1}-${chunk[chunk.length - 1] + 1}`;
    console.log(`Created: ${path.basename(outputPath)} (${pageRange})`);
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Split complete!`);
  console.log(`  - Input: ${inputFile} (${totalPages} pages)`);
  console.log(`  - Output: ${outputFiles.length} file(s)`);
  console.log(`  - Location: ${outputIsFile && chunks.length === 1 ? options.output : options.output + "/"}`);
  console.log("=".repeat(50));
}

// Main execution
async function main() {
  try {
    await splitPdf();
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
