/**
 * PDF conversion utilities
 */

import { PDFDocument } from 'pdf-lib';
import pdfParse from 'pdf-parse';
import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import type { ImageFormat, ImageQuality, ConvertOptions, ConvertResult } from '../types';
import { QUALITY_SETTINGS, MAX_SINGLE_PASS_SIZE, DEFAULT_CHUNK_SIZE } from '../types';

/**
 * Extract text from PDF
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Get PDF page count
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const buffer = await readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  return pdfDoc.getPageCount();
}

/**
 * Extract specific pages from PDF
 */
export async function extractPdfPages(
  pdfPath: string,
  pages: number[]
): Promise<Buffer> {
  const buffer = await readFile(pdfPath);
  const sourcePdf = await PDFDocument.load(buffer);
  const newPdf = await PDFDocument.create();

  for (const pageNum of pages) {
    if (pageNum > 0 && pageNum <= sourcePdf.getPageCount()) {
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNum - 1]);
      newPdf.addPage(copiedPage);
    }
  }

  return Buffer.from(await newPdf.save());
}

/**
 * Split PDF into chunks for processing
 */
export async function splitPdfIntoChunks(
  pdfPath: string,
  pagesPerChunk: number = 10
): Promise<Buffer[]> {
  const buffer = await readFile(pdfPath);
  const sourcePdf = await PDFDocument.load(buffer);
  const totalPages = sourcePdf.getPageCount();
  const chunks: Buffer[] = [];

  for (let i = 0; i < totalPages; i += pagesPerChunk) {
    const endPage = Math.min(i + pagesPerChunk, totalPages);
    const chunkPdf = await PDFDocument.create();

    for (let j = i; j < endPage; j++) {
      const [copiedPage] = await chunkPdf.copyPages(sourcePdf, [j]);
      chunkPdf.addPage(copiedPage);
    }

    chunks.push(Buffer.from(await chunkPdf.save()));
  }

  return chunks;
}

/**
 * Convert PDF to text
 */
export async function pdfToText(options: ConvertOptions): Promise<ConvertResult> {
  const startTime = Date.now();
  const inputStat = await stat(options.input);

  const outputPath = options.output || join(
    dirname(options.input),
    `${basename(options.input, extname(options.input))}.txt`
  );

  try {
    const text = await extractPdfText(options.input);
    await writeFile(outputPath, text);
    const outputStat = await stat(outputPath);

    return {
      success: true,
      input: options.input,
      output: outputPath,
      inputFormat: 'pdf',
      outputFormat: 'txt',
      inputSize: inputStat.size,
      outputSize: outputStat.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      input: options.input,
      output: outputPath,
      inputFormat: 'pdf',
      outputFormat: 'txt',
      inputSize: inputStat.size,
      outputSize: 0,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Parse page range string (e.g., "1-5" or "1,3,5" or "1-3,5,7-10")
 */
export function parsePageRange(pageSpec: string, totalPages: number): number[] {
  const pages: Set<number> = new Set();
  const parts = pageSpec.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
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

/**
 * Merge multiple PDFs into one
 */
export async function mergePdfs(pdfPaths: string[], outputPath: string): Promise<void> {
  const mergedPdf = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const buffer = await readFile(pdfPath);
    const sourcePdf = await PDFDocument.load(buffer);
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  await writeFile(outputPath, await mergedPdf.save());
}

/**
 * Create PDF from images
 */
export async function imagesToPdf(
  imagePaths: string[],
  outputPath: string
): Promise<ConvertResult> {
  const startTime = Date.now();
  let totalInputSize = 0;

  try {
    const pdfDoc = await PDFDocument.create();

    for (const imagePath of imagePaths) {
      const imageBuffer = await readFile(imagePath);
      const imgStat = await stat(imagePath);
      totalInputSize += imgStat.size;

      const ext = extname(imagePath).toLowerCase();
      let image;

      if (ext === '.jpg' || ext === '.jpeg') {
        image = await pdfDoc.embedJpg(imageBuffer);
      } else if (ext === '.png') {
        image = await pdfDoc.embedPng(imageBuffer);
      } else {
        // For other formats, we'd need to convert first
        // Skip unsupported formats
        console.warn(`Skipping unsupported image format: ${ext}`);
        continue;
      }

      // Create page with image dimensions
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    await writeFile(outputPath, pdfBytes);
    const outputStat = await stat(outputPath);

    return {
      success: true,
      input: imagePaths.join(', '),
      output: outputPath,
      inputFormat: 'image',
      outputFormat: 'pdf',
      inputSize: totalInputSize,
      outputSize: outputStat.size,
      pagesProcessed: imagePaths.length,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      input: imagePaths.join(', '),
      output: outputPath,
      inputFormat: 'image',
      outputFormat: 'pdf',
      inputSize: totalInputSize,
      outputSize: 0,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get PDF metadata
 */
export async function getPdfMetadata(pdfPath: string): Promise<{
  pageCount: number;
  author?: string;
  title?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}> {
  const buffer = await readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);

  return {
    pageCount: pdfDoc.getPageCount(),
    author: pdfDoc.getAuthor(),
    title: pdfDoc.getTitle(),
    creator: pdfDoc.getCreator(),
    producer: pdfDoc.getProducer(),
    creationDate: pdfDoc.getCreationDate(),
    modificationDate: pdfDoc.getModificationDate(),
  };
}
