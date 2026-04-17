#!/usr/bin/env bun

import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, extname, dirname, join, resolve } from 'path';
import { parseArgs } from 'util';

interface PageResult {
  pageNumber: number;
  text: string;
}

interface PdfResult {
  file: string;
  pageCount: number;
  pages: PageResult[];
  metadata?: {
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
  };
}

interface ChunkResult {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  text: string;
}

function parsePageRange(spec: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
      for (let i = start; i <= Math.min(end, totalPages); i++) {
        if (i > 0) pages.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (num > 0 && num <= totalPages) pages.add(num);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

async function loadPdfParse() {
  try {
    return (await import('pdf-parse')).default;
  } catch {
    console.error('pdf-parse not available. Install with: bun add pdf-parse');
    process.exit(1);
  }
}

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer, { max: 0 });
  return data.numpages;
}

async function extractPdfText(buffer: Buffer, maxPages?: number): Promise<string> {
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer, maxPages ? { max: maxPages } : undefined);
  return data.text;
}

async function extractPdfMetadata(buffer: Buffer): Promise<PdfResult['metadata']> {
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer, { max: 0 });
  return {
    title: data.info?.Title,
    author: data.info?.Author,
    creator: data.info?.Creator,
    producer: data.info?.Producer,
  };
}

async function readPdfChunked(
  filePath: string,
  chunkSize: number,
  pageRange?: number[]
): Promise<ChunkResult[]> {
  const buffer = await readFile(filePath);
  const totalPages = await getPdfPageCount(buffer);
  const pages = pageRange || Array.from({ length: totalPages }, (_, i) => i + 1);

  const chunks: ChunkResult[] = [];
  for (let i = 0; i < pages.length; i += chunkSize) {
    const chunkPages = pages.slice(i, i + chunkSize);
    const startPage = chunkPages[0];
    const endPage = chunkPages[chunkPages.length - 1];

    const pdfParse = await loadPdfParse();
    const data = await pdfParse(buffer, { max: endPage });
    const text = data.text;

    chunks.push({
      chunkIndex: Math.floor(i / chunkSize),
      startPage,
      endPage,
      text,
    });
  }

  return chunks;
}

async function readSinglePdf(
  filePath: string,
  pageSpec?: string,
  chunkSize?: number
): Promise<PdfResult> {
  const buffer = await readFile(filePath);
  const totalPages = await getPdfPageCount(buffer);
  const metadata = await extractPdfMetadata(buffer);

  let pageRange: number[] | undefined;
  if (pageSpec) {
    pageRange = parsePageRange(pageSpec, totalPages);
  }

  if (chunkSize) {
    const chunks = await readPdfChunked(filePath, chunkSize, pageRange);
    const pages: PageResult[] = chunks.map(c => ({
      pageNumber: c.startPage,
      text: c.text,
    }));
    return { file: filePath, pageCount: totalPages, pages, metadata };
  }

  const maxPage = pageRange ? Math.max(...pageRange) : undefined;
  const text = await extractPdfText(buffer, maxPage);

  return {
    file: filePath,
    pageCount: totalPages,
    pages: [{ pageNumber: 1, text }],
    metadata,
  };
}

async function readMultiplePdfs(
  files: string[],
  pageSpec?: string,
  chunkSize?: number,
  concurrency = 4
): Promise<PdfResult[]> {
  const results: PdfResult[] = [];
  const queue = [...files];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift()!;
      console.log(`Reading: ${basename(file)}`);
      const result = await readSinglePdf(file, pageSpec, chunkSize);
      results.push(result);
      console.log(`  ${result.pageCount} pages, ${result.pages.reduce((s, p) => s + p.text.length, 0)} chars extracted`);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => processNext());
  await Promise.all(workers);

  return results;
}

function formatText(results: PdfResult[]): string {
  return results.map(r => {
    const header = `=== ${basename(r.file)} (${r.pageCount} pages) ===\n`;
    const text = r.pages.map(p => p.text).join('\n\n---\n\n');
    return header + text;
  }).join('\n\n');
}

function formatJson(results: PdfResult[]): string {
  return JSON.stringify(results, null, 2);
}

function formatMarkdown(results: PdfResult[]): string {
  return results.map(r => {
    const lines: string[] = [];
    lines.push(`# ${basename(r.file)}`);
    lines.push('');
    if (r.metadata?.title) lines.push(`**Title:** ${r.metadata.title}`);
    if (r.metadata?.author) lines.push(`**Author:** ${r.metadata.author}`);
    lines.push(`**Pages:** ${r.pageCount}`);
    lines.push('');
    for (const page of r.pages) {
      lines.push(`## Page ${page.pageNumber}`);
      lines.push('');
      lines.push(page.text);
      lines.push('');
    }
    return lines.join('\n');
  }).join('\n---\n\n');
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      pages: { type: 'string' },
      'chunk-size': { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string', short: 'o' },
      concurrency: { type: 'string', default: '4' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  const files = positionals.slice(1);

  if (values.help || !command) {
    console.log(`
PDF Read - Extract text from PDF files

Usage:
  skill-pdf-read read <files...> [options]
  skill-pdf-read info <files...>

Commands:
  read          Extract text from PDFs
  info          Show PDF metadata and page counts

Read Options:
  --pages <spec>       Page range (e.g., "1-5", "3,7,10-15")
  --chunk-size <n>     Read in chunks of N pages (for large files)
  --format <fmt>       Output format: text, json, markdown (default: text)
  --output, -o <path>  Write output to file
  --concurrency <n>    Parallel file processing (default: 4)

Examples:
  skill-pdf-read read document.pdf
  skill-pdf-read read report.pdf --pages 1-5 --format json
  skill-pdf-read read *.pdf --chunk-size 10 --output extracted.txt
  skill-pdf-read info document.pdf
`);
    process.exit(0);
  }

  if (files.length === 0) {
    console.error('Error: At least one PDF file is required');
    process.exit(1);
  }

  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
    if (extname(file).toLowerCase() !== '.pdf') {
      console.error(`Not a PDF file: ${file}`);
      process.exit(1);
    }
  }

  switch (command) {
    case 'read': {
      const chunkSize = values['chunk-size'] ? parseInt(values['chunk-size'] as string) : undefined;
      const concurrency = parseInt(values.concurrency as string) || 4;

      console.log(`\nReading ${files.length} PDF file(s)...\n`);

      const results = await readMultiplePdfs(files, values.pages as string, chunkSize, concurrency);

      let output: string;
      switch (values.format) {
        case 'json': output = formatJson(results); break;
        case 'markdown': case 'md': output = formatMarkdown(results); break;
        default: output = formatText(results); break;
      }

      if (values.output) {
        const outputPath = resolve(values.output as string);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
        console.log(`\nOutput saved to: ${outputPath}`);
      } else {
        console.log('\n' + output);
      }

      const totalChars = results.reduce((s, r) => s + r.pages.reduce((ps, p) => ps + p.text.length, 0), 0);
      const totalPages = results.reduce((s, r) => s + r.pageCount, 0);
      console.log(`\nProcessed: ${files.length} files, ${totalPages} pages, ${totalChars.toLocaleString()} characters`);
      break;
    }

    case 'info': {
      for (const file of files) {
        const buffer = await readFile(file);
        const pageCount = await getPdfPageCount(buffer);
        const metadata = await extractPdfMetadata(buffer);
        const fileStats = await stat(file);

        console.log(`\n${basename(file)}:`);
        console.log(`  Pages: ${pageCount}`);
        console.log(`  Size: ${(fileStats.size / 1024).toFixed(1)} KB`);
        if (metadata?.title) console.log(`  Title: ${metadata.title}`);
        if (metadata?.author) console.log(`  Author: ${metadata.author}`);
        if (metadata?.creator) console.log(`  Creator: ${metadata.creator}`);
        if (metadata?.producer) console.log(`  Producer: ${metadata.producer}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
